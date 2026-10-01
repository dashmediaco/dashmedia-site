// POST /api/stripe-webhook — Stripe webhook receiver for Dash onboarding payments.
// Deploy as a Vercel serverless function (or any Node 18+ host).
//
// On checkout.session.completed:
//   1. Builds the 4-phase subscription schedule ($500 -> $500 -> $499 -> $1000/month)
//   2. Relays the payment to GoHighLevel so the onboarding automation can run
//
// Requires these environment variables:
//   STRIPE_SECRET_KEY        Stripe secret key
//   STRIPE_WEBHOOK_SECRET    Live signing secret for this endpoint (whsec_...)
//   STRIPE_SANDBOX_SECRET_KEY Sandbox secret key (sk_test_...)
//   STRIPE_SANDBOX_WEBHOOK_SECRET Sandbox signing secret (whsec_...)
//   STRIPE_PRICE_500         Price ID for the $500/month phase
//   STRIPE_PRICE_499         Price ID for the $499/month phase
//   STRIPE_PRICE_1000        Price ID for the $1000/month phase
//   STRIPE_SANDBOX_PRICE_500 Sandbox $500/month price ID
//   STRIPE_SANDBOX_PRICE_499 Sandbox $499/month price ID
//   STRIPE_SANDBOX_PRICE_1000 Sandbox $1000/month price ID
//   GHL_PAYMENT_WEBHOOK_URL  GHL Inbound Webhook URL for "Payment Received"
//   GHL_SANDBOX_PAYMENT_WEBHOOK_URL Optional sandbox GHL webhook URL

var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
var sandboxStripe = process.env.STRIPE_SANDBOX_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SANDBOX_SECRET_KEY)
  : null;

// Turn off Vercel's automatic JSON body parsing so we can read the raw
// bytes — Stripe's signature check fails on a body that's already been
// parsed and re-serialized.
module.exports.config = {
  api: {
    bodyParser: false
  }
};

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Builds the 4-phase subscription schedule: $500 -> $500 -> $499 -> $1000/month.
async function schedulePriceEscalation(stripeClient, subscriptionId, isSandbox) {
  var prefix = isSandbox ? 'STRIPE_SANDBOX_' : 'STRIPE_';
  var requiredPrices = [
    process.env[prefix + 'PRICE_500'],
    process.env[prefix + 'PRICE_499'],
    process.env[prefix + 'PRICE_1000']
  ];

  if (requiredPrices.some(function (price) { return !price; })) {
    throw new Error('Missing ' + prefix + 'PRICE_* environment variables');
  }

  var schedule = await stripeClient.subscriptionSchedules.create({
    from_subscription: subscriptionId
  });

  await stripeClient.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      { start_date: schedule.phases[0].start_date, items: [{ price: process.env[prefix + 'PRICE_500'], quantity: 1 }], iterations: 1 },
      { items: [{ price: process.env[prefix + 'PRICE_500'], quantity: 1 }], iterations: 1 },
      { items: [{ price: process.env[prefix + 'PRICE_499'], quantity: 1 }], iterations: 1 },
      { items: [{ price: process.env[prefix + 'PRICE_1000'], quantity: 1 }] }
    ]
  });

  return schedule;
}

// Notifies GHL that a payment came in, so "Copy - Dash Payment Received -> Onboarding"
// can tag the contact and move them into the onboarding stage.
async function notifyGHL(session, isSandbox) {
  var webhook = isSandbox
    ? process.env.GHL_SANDBOX_PAYMENT_WEBHOOK_URL
    : process.env.GHL_PAYMENT_WEBHOOK_URL;

  if (!webhook) {
    if (isSandbox) {
      console.log('Sandbox event received; GHL sandbox webhook is not configured, skipping GHL notification');
      return;
    }
    throw new Error('GHL_PAYMENT_WEBHOOK_URL is not configured');
  }

  var details = session.customer_details || {};
  var payload = {
    email: details.email || '',
    phone: details.phone || '',
    fullName: details.name || '',
    source: 'Stripe Checkout - Dash Managed Lead Generation',
    amountPaidToday: (session.amount_total / 100).toFixed(2),
    stripeSessionId: session.id,
    submittedAt: new Date().toISOString()
  };

  var response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('GHL webhook failed: ' + response.status);
  }
}

function verifyStripeEvent(rawBody, signature) {
  var candidates = [
    {
      client: stripe,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
      isSandbox: false
    },
    {
      client: sandboxStripe,
      secret: process.env.STRIPE_SANDBOX_WEBHOOK_SECRET,
      isSandbox: true
    }
  ];

  var lastError;
  for (var i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    if (!candidate.client || !candidate.secret) continue;

    try {
      return {
        event: candidate.client.webhooks.constructEvent(rawBody, signature, candidate.secret),
        stripeClient: candidate.client,
        isSandbox: candidate.isSandbox
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('No Stripe webhook signing secret is configured');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  var sig = req.headers['stripe-signature'];
  if (!sig || (!process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_SANDBOX_WEBHOOK_SECRET)) {
    return res.status(500).json({ ok: false, error: 'Stripe signature verification is not configured' });
  }

  var rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Could not read request body' });
  }

  var verified;
  try {
    verified = verifyStripeEvent(rawBody, sig);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Invalid signature: ' + err.message });
  }

  var event = verified.event;

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ ok: true, skipped: event.type });
  }

  var session = event.data.object;
  var subscriptionId = session.subscription;

  if (subscriptionId) {
    try {
      await schedulePriceEscalation(verified.stripeClient, subscriptionId, verified.isSandbox);
      console.log('Subscription schedule created for ' + subscriptionId);
    } catch (err) {
      console.error('Failed to create schedule for ' + subscriptionId + ':', err);
    }
  } else {
    console.error('No subscription on session ' + session.id + '; skipping schedule');
  }

  try {
    await notifyGHL(session, verified.isSandbox);
    console.log('GHL notified for ' + ((session.customer_details && session.customer_details.email) || session.id));
  } catch (err) {
    console.error('GHL notification failed for ' + session.id + ':', err);
  }

  return res.status(200).json({ ok: true });
};

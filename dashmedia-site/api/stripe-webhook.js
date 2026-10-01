// POST /api/stripe-webhook — Stripe webhook receiver for Dash onboarding payments.
// Deploy as a Vercel serverless function (or any Node 18+ host).
//
// On checkout.session.completed:
//   1. Builds the 4-phase subscription schedule ($500 -> $500 -> $499 -> $1000/month)
//   2. Relays the payment to GoHighLevel so the onboarding automation can run
//
// Requires these environment variables:
//   STRIPE_SECRET_KEY        Stripe secret key
//   STRIPE_WEBHOOK_SECRET    Signing secret for this endpoint (whsec_...)
//   STRIPE_PRICE_500         Price ID for the $500/month phase
//   STRIPE_PRICE_499         Price ID for the $499/month phase
//   STRIPE_PRICE_1000        Price ID for the $1000/month phase
//   GHL_PAYMENT_WEBHOOK_URL  GHL Inbound Webhook URL for "Payment Received"

var stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
async function schedulePriceEscalation(subscriptionId) {
  var schedule = await stripe.subscriptionSchedules.create({
    from_subscription: subscriptionId
  });

  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      { items: [{ price: process.env.STRIPE_PRICE_500, quantity: 1 }], iterations: 1 },
      { items: [{ price: process.env.STRIPE_PRICE_500, quantity: 1 }], iterations: 1 },
      { items: [{ price: process.env.STRIPE_PRICE_499, quantity: 1 }], iterations: 1 },
      { items: [{ price: process.env.STRIPE_PRICE_1000, quantity: 1 }] }
    ]
  });

  return schedule;
}

// Notifies GHL that a payment came in, so "Copy - Dash Payment Received -> Onboarding"
// can tag the contact and move them into the onboarding stage.
async function notifyGHL(session) {
  var webhook = process.env.GHL_PAYMENT_WEBHOOK_URL;
  if (!webhook) {
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  var sig = req.headers['stripe-signature'];
  var webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !webhookSecret) {
    return res.status(500).json({ ok: false, error: 'Stripe signature verification is not configured' });
  }

  var rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Could not read request body' });
  }

  var event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Invalid signature: ' + err.message });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ ok: true, skipped: event.type });
  }

  var session = event.data.object;
  var subscriptionId = session.subscription;

  if (subscriptionId) {
    try {
      await schedulePriceEscalation(subscriptionId);
      console.log('Subscription schedule created for ' + subscriptionId);
    } catch (err) {
      console.error('Failed to create schedule for ' + subscriptionId + ':', err);
    }
  } else {
    console.error('No subscription on session ' + session.id + '; skipping schedule');
  }

  try {
    await notifyGHL(session);
    console.log('GHL notified for ' + ((session.customer_details && session.customer_details.email) || session.id));
  } catch (err) {
    console.error('GHL notification failed for ' + session.id + ':', err);
  }

  return res.status(200).json({ ok: true });
};

// POST /api/contact — relays the quote form to GoHighLevel.
// Deploy as a Vercel serverless function (or any Node 18+ host).
// Requires the environment variable GHL_WEBHOOK_URL (the GHL Inbound Webhook URL).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  var body = req.body || {};
  var required = ['fullName', 'email', 'phone', 'company', 'volume'];
  var missing = required.filter(function (k) {
    return typeof body[k] !== 'string' || !body[k].trim();
  });
  if (missing.length) {
    return res.status(400).json({ ok: false, error: 'Missing fields: ' + missing.join(', ') });
  }
  if (!/.+@.+\..+/.test(body.email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email' });
  }

  var webhook = process.env.GHL_WEBHOOK_URL;
  if (!webhook) {
    return res.status(500).json({ ok: false, error: 'GHL_WEBHOOK_URL is not configured' });
  }

  try {
    var ghl = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: body.fullName.trim(),
        email: body.email.trim(),
        phone: body.phone.trim(),
        company: body.company.trim(),
        volume: body.volume,
        source: 'dashmediaco.com contact form',
        submittedAt: new Date().toISOString()
      })
    });
    if (!ghl.ok) throw new Error('GHL responded ' + ghl.status);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Relay failed' });
  }
};

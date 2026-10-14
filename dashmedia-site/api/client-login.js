// GET /client-login — resolve a Dash client to its assigned GHL subaccount.
var portalStore = require('../lib/client-portal-store');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  try {
    var requestedId = req.query && typeof req.query.client === 'string' ? req.query.client : '';
    var clientId = requestedId || await portalStore.getDefaultClientId();
    if (!portalStore.isValidClientId(clientId)) {
      return res.status(404).send('Client portal not found. Please contact Dash Media.');
    }

    var client = await portalStore.getClient(clientId);
    if (!client || client.status !== 'active') {
      return res.status(404).send('Client portal not found. Please contact Dash Media.');
    }

    var destination = portalStore.getPortalUrl(client);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.statusCode = 302;
    res.setHeader('Location', destination);
    return res.end();
  } catch (err) {
    console.error('Client portal lookup failed:', err && err.message ? err.message : 'unknown error');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(500).send('Client portal is temporarily unavailable. Please contact Dash Media.');
  }
};

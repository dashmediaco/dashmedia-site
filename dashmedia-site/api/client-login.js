// GET /client-login — send every Dash client to the shared HighLevel sign-in.
var portalStore = require('../lib/client-portal-store');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  try {
    // Resolve the shared login domain from Redis, but never preselect a location.
    var clientId = await portalStore.getDefaultClientId();
    if (!portalStore.isValidClientId(clientId)) {
      return res.status(503).send('Client login is temporarily unavailable. Please contact Dash Media.');
    }

    var portal = await portalStore.getClient(clientId);
    if (!portal) {
      return res.status(503).send('Client login is temporarily unavailable. Please contact Dash Media.');
    }

    var destination = portalStore.getUniversalLoginUrl(portal);
    res.statusCode = 302;
    res.setHeader('Location', destination);
    return res.end();
  } catch (err) {
    console.error('Client portal lookup failed:', err && err.message ? err.message : 'unknown error');
    return res.status(500).send('Client login is temporarily unavailable. Please contact Dash Media.');
  }
};

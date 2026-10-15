// GET /api/client-login?client=<id> — send a selected client to its branded sign-in.
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
    // Resolve the selected client domain, but never include a location ID.
    var requestedId = req.query && typeof req.query.client === 'string' ? req.query.client : '';
    var clientId = requestedId || await portalStore.getDefaultClientId();
    if (!portalStore.isValidClientId(clientId)) {
      return res.status(404).send('That agency portal could not be found. Please return to the agency list.');
    }

    var portal = await portalStore.getClient(clientId);
    if (!portal || portal.status !== 'active') {
      return res.status(404).send('That agency portal could not be found. Please return to the agency list.');
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
// GET /api/client-login?client=<id> — send a selected client to its branded sign-in.
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
    // Resolve the selected client domain, but never include a location ID.
    var requestedId = req.query && typeof req.query.client === 'string' ? req.query.client : '';
    var clientId = requestedId || await portalStore.getDefaultClientId();
    if (!portalStore.isValidClientId(clientId)) {
      return res.status(404).send('That agency portal could not be found. Please return to the agency list.');
    }

    var portal = await portalStore.getClient(clientId);
    if (!portal || portal.status !== 'active') {
      return res.status(404).send('That agency portal could not be found. Please return to the agency list.');
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

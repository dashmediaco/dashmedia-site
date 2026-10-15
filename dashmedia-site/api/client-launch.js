var portalAuth = require('../lib/portal-auth');
var portalStore = require('../lib/client-portal-store');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  try {
    var user = portalAuth.getSession(req);
    if (!user) {
      res.statusCode = 302;
      res.setHeader('Location', '/client-login?error=expired');
      return res.end();
    }

    var clientId = req.query && typeof req.query.client === 'string' ? req.query.client : '';
    if (!portalStore.isValidClientId(clientId)) {
      return res.status(404).send('That agency is not available for this account.');
    }
    var clients = await portalStore.getClientsForEmail(user.email);
    var client = clients.find(function (entry) { return entry.id === clientId; });
    if (!client) return res.status(404).send('That agency is not available for this account.');

    var destination = new URL('/v2/location/' + encodeURIComponent(client.locationId) + '/dashboard',
      portalStore.DEFAULT_PORTAL_BASE_URL);
    res.statusCode = 302;
    res.setHeader('Location', destination.toString());
    return res.end();
  } catch (err) {
    console.error('Agency launch failed:', err && err.message ? err.message : 'unknown error');
    return res.status(503).send('Your agency could not be opened right now. Please try again.');
  }
};

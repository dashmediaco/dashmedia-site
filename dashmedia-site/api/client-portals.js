var portalAuth = require('../lib/portal-auth');
var portalStore = require('../lib/client-portal-store');

function sendError(res, status, message) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).json({ error: message });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Cookie');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed');
  }

  try {
    var user = portalAuth.getSession(req);
    if (!user) return sendError(res, 401, 'Sign in to see your agencies.');

    var clients = await portalStore.getClientsForEmail(user.email);
    return res.status(200).json({
      user: { email: user.email, name: user.name },
      clients: clients.map(function (client) {
        return { id: client.id, name: client.name };
      })
    });
  } catch (err) {
    console.error('Private agency list failed:', err && err.message ? err.message : 'unknown error');
    return sendError(res, 503, 'Your agency list is temporarily unavailable. Please try again.');
  }
};

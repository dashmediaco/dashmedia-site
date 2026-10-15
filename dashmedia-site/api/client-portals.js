// GET /api/client-portals — public names for the client workspace chooser.
var portalStore = require('../lib/client-portal-store');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    var clients = await portalStore.listActiveClients();
    return res.status(200).json({ clients: clients });
  } catch (err) {
    console.error('Client portal list failed:', err && err.message ? err.message : 'unknown error');
    return res.status(503).json({ error: 'Agency list is temporarily unavailable.' });
  }
};

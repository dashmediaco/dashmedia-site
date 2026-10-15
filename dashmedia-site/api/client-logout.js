var portalAuth = require('../lib/portal-auth');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Set-Cookie', portalAuth.clearCookie('dash_portal_session'));
  res.statusCode = 302;
  res.setHeader('Location', '/client-login');
  return res.end();
};

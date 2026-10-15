// Compatibility route: always enter through Dash's authenticated portal first.
var LOGIN_URL = '/client-login';

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  res.statusCode = 302;
  res.setHeader('Location', LOGIN_URL);
  return res.end();
};

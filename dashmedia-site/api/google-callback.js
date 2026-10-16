module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  // Legacy Google callbacks no longer create Dash sessions. HighLevel owns sign-in.
  res.statusCode = 302;
  res.setHeader('Location', 'https://login.dashmediaco.com/');
  return res.end();
};

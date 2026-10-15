var crypto = require('node:crypto');
var portalAuth = require('../lib/portal-auth');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  var clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    res.statusCode = 302;
    res.setHeader('Location', '/client-login?error=setup');
    return res.end();
  }

  try {
    var state = crypto.randomBytes(32).toString('base64url');
    var verifier = crypto.randomBytes(48).toString('base64url');
    var challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    var redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      'https://dashmediaco.com/api/google-callback';
    var authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('prompt', 'select_account');

    res.setHeader('Set-Cookie', portalAuth.oauthCookie(state, verifier));
    res.statusCode = 302;
    res.setHeader('Location', authorizationUrl.toString());
    return res.end();
  } catch (err) {
    res.statusCode = 503;
    return res.send('Dash sign-in is being configured. Please try again shortly.');
  }
};

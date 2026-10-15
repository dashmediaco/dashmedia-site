var portalAuth = require('../lib/portal-auth');
var crypto = require('node:crypto');

function safeEqual(left, right) {
  var leftBuffer = Buffer.from(left || '', 'utf8');
  var rightBuffer = Buffer.from(right || '', 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function redirect(res, destination, cookies) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (cookies) res.setHeader('Set-Cookie', cookies);
  res.statusCode = 302;
  res.setHeader('Location', destination);
  return res.end();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  var stateCookie;
  try {
    stateCookie = portalAuth.getOAuthState(req);
  } catch (err) {
    return redirect(res, '/client-login?error=setup', portalAuth.clearCookie('dash_portal_oauth'));
  }
  var clearState = portalAuth.clearCookie('dash_portal_oauth');
  var query = req.query || {};
  var state = typeof query.state === 'string' ? query.state : '';
  var code = typeof query.code === 'string' ? query.code : '';

  if (!stateCookie || !safeEqual(stateCookie.state, state)) {
    return redirect(res, '/client-login?error=expired', clearState);
  }
  if (query.error) return redirect(res, '/client-login?error=cancelled', clearState);
  if (!code || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return redirect(res, '/client-login?error=setup', clearState);
  }

  try {
    var redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      'https://dashmediaco.com/api/google-callback';
    var tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        code_verifier: stateCookie.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    var tokens = await tokenResponse.json();
    if (!tokens || typeof tokens.access_token !== 'string') throw new Error('Google token response is invalid');

    var profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
      signal: AbortSignal.timeout(8000)
    });
    if (!profileResponse.ok) throw new Error('Google profile lookup failed');
    var profile = await profileResponse.json();
    var emailVerified = profile && (profile.email_verified === true || profile.email_verified === 'true');
    if (!profile || typeof profile.sub !== 'string' || !profile.sub || !emailVerified ||
        typeof profile.email !== 'string') {
      return redirect(res, '/client-login?error=unverified', clearState);
    }

    var user = {
      sub: profile.sub,
      email: profile.email.trim().toLowerCase(),
      name: typeof profile.name === 'string' ? profile.name.slice(0, 160) : ''
    };
    var sessionCookie = portalAuth.sessionCookie(user);
    return redirect(res, '/agency', [clearState, sessionCookie]);
  } catch (err) {
    console.error('Dash Google sign-in failed:', err && err.message ? err.message : 'unknown error');
    return redirect(res, '/client-login?error=signin', clearState);
  }
};

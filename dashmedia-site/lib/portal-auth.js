var crypto = require('node:crypto');

var SESSION_COOKIE = 'dash_portal_session';
var OAUTH_COOKIE = 'dash_portal_oauth';
var SESSION_TTL_SECONDS = 8 * 60 * 60;
var OAUTH_TTL_SECONDS = 10 * 60;

function secret() {
  var value = process.env.PORTAL_SESSION_SECRET;
  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('Portal session signing key is not configured');
  }
  return value;
}

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(value) {
  var payload = encode(JSON.stringify(value));
  var signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function verify(value) {
  if (typeof value !== 'string') return null;
  var parts = value.split('.');
  if (parts.length !== 2) return null;

  var expected = crypto.createHmac('sha256', secret()).update(parts[0]).digest();
  var supplied;
  try {
    supplied = Buffer.from(parts[1], 'base64url');
  } catch (err) {
    return null;
  }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;

  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

function cookieValues(req) {
  var header = req.headers && req.headers.cookie;
  var cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(function (part) {
    var separator = part.indexOf('=');
    if (separator < 0) return;
    var name = part.slice(0, separator).trim();
    var value = part.slice(separator + 1).trim();
    cookies[name] = value;
  });
  return cookies;
}

function serializeCookie(name, value, maxAge) {
  return name + '=' + value + '; Path=/; Max-Age=' + maxAge + '; Secure; HttpOnly; SameSite=Lax';
}

function clearCookie(name) {
  return name + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';
}

function sessionCookie(user) {
  var now = Math.floor(Date.now() / 1000);
  var value = sign({
    sub: user.sub,
    email: user.email,
    name: user.name || '',
    exp: now + SESSION_TTL_SECONDS
  });
  return serializeCookie(SESSION_COOKIE, value, SESSION_TTL_SECONDS);
}

function oauthCookie(state, verifier) {
  var value = sign({
    state: state,
    verifier: verifier,
    exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS
  });
  return serializeCookie(OAUTH_COOKIE, value, OAUTH_TTL_SECONDS);
}

function getOAuthState(req) {
  var state = verify(cookieValues(req)[OAUTH_COOKIE]);
  if (!state || typeof state.state !== 'string' || typeof state.verifier !== 'string' ||
      typeof state.exp !== 'number' || state.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return state;
}

function getSession(req) {
  var session = verify(cookieValues(req)[SESSION_COOKIE]);
  if (!session || typeof session.sub !== 'string' || typeof session.email !== 'string' ||
      typeof session.exp !== 'number' || session.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return session;
}

module.exports = {
  clearCookie: clearCookie,
  getOAuthState: getOAuthState,
  getSession: getSession,
  oauthCookie: oauthCookie,
  sessionCookie: sessionCookie
};

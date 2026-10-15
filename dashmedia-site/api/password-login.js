var crypto = require('node:crypto');
var portalStore = require('../lib/client-portal-store');
var portalAuth = require('../lib/portal-auth');

function sendError(res, status, message) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).json({ error: message });
}

function derivePassword(password, salt) {
  return new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, function (err, key) {
      if (err) return reject(err);
      resolve(key);
    });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed');
  }

  var body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return sendError(res, 400, 'Enter your email and password');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendError(res, 400, 'Enter your email and password');
  }

  var email;
  try {
    email = portalStore.normalizeEmail(body.email);
  } catch (err) {
    return sendError(res, 400, 'Enter a valid email and password');
  }
  if (typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 1024) {
    return sendError(res, 400, 'Enter a valid email and password');
  }

  try {
    var attempts = await portalStore.recordPasswordLoginAttempt(email);
    if (attempts > 10) return sendError(res, 429, 'Too many attempts. Wait a few minutes and try again.');

    var credential = await portalStore.getPasswordCredential(email);
    var salt = credential ? credential.salt : 'dash-portal-dummy-salt';
    var suppliedHash = await derivePassword(body.password, salt);
    var matches = false;
    if (credential) {
      var expectedHash = Buffer.from(credential.hash, 'hex');
      matches = expectedHash.length === suppliedHash.length && crypto.timingSafeEqual(expectedHash, suppliedHash);
    }
    if (!matches) return sendError(res, 401, 'Email or password is incorrect, or this account is not set up.');

    var agencies = await portalStore.getClientsForEmail(email);
    if (!agencies.length) return sendError(res, 401, 'Email or password is incorrect, or this account is not set up.');

    await portalStore.clearPasswordLoginAttempts(email);
    var subject = 'password:' + crypto.createHash('sha256').update(email).digest('hex');
    res.setHeader('Set-Cookie', portalAuth.sessionCookie({
      sub: subject,
      email: email,
      name: email.split('@')[0]
    }));
    return res.status(200).json({ ok: true, redirect: '/agency' });
  } catch (err) {
    console.error('Client password sign-in failed:', err && err.message ? err.message : 'unknown error');
    return sendError(res, 500, 'Sign-in is temporarily unavailable. Please try again.');
  }
};

var crypto = require('node:crypto');
var portalStore = require('../lib/client-portal-store');

var MAX_BODY_BYTES = 32 * 1024;
var GHL_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=',
  '-----END PUBLIC KEY-----'
].join('\n');

function sendError(res, status, message) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).json({ error: message });
}

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) {
        var error = new Error('Webhook payload is too large');
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function verifyGhlSignature(rawBody, headerValue) {
  if (typeof headerValue !== 'string' || !headerValue || headerValue === 'N/A') return false;
  try {
    var signature = Buffer.from(headerValue, 'base64');
    if (signature.length !== 64) return false;
    return crypto.verify(null, rawBody, GHL_PUBLIC_KEY, signature);
  } catch (err) {
    return false;
  }
}

function normalizeEventType(value) {
  if (typeof value !== 'string') return '';
  var compact = value.trim().toLowerCase().replace(/[._\s-]/g, '');
  if (compact === 'usercreate' || compact === 'usercreated') return 'UserCreate';
  if (compact === 'userupdate' || compact === 'userupdated') return 'UserUpdate';
  if (compact === 'userdelete' || compact === 'userdeleted') return 'UserDelete';
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed');
  }

  var rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err && err.code === 'PAYLOAD_TOO_LARGE') return sendError(res, 413, 'Webhook payload is too large');
    console.error('HighLevel user webhook body read failed');
    return sendError(res, 400, 'Invalid webhook request');
  }

  if (!verifyGhlSignature(rawBody, req.headers['x-ghl-signature'])) {
    return sendError(res, 401, 'Invalid webhook signature');
  }

  var payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return sendError(res, 400, 'Invalid JSON body');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return sendError(res, 400, 'Invalid webhook body');
  }

  var eventType = normalizeEventType(payload.type || payload.event);
  if (!eventType) return res.status(200).json({ received: true, ignored: true });

  var data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload;
  var locationId = typeof data.locationId === 'string' ? data.locationId.trim() : '';
  var userId = typeof data.id === 'string' ? data.id.trim() : '';
  if (!portalStore.isValidLocationId(locationId) || !portalStore.isValidGhlUserId(userId)) {
    // Agency-wide users have a companyId and locations list, but no single locationId.
    // They must not inherit every client workspace in Dash.
    return res.status(200).json({ received: true, ignored: true });
  }
  if (eventType !== 'UserDelete') {
    try {
      portalStore.normalizeEmail(data.email);
    } catch (err) {
      return res.status(200).json({ received: true, ignored: true });
    }
  }

  try {
    var result = await portalStore.syncGhlUserAccess(eventType, userId, data.email, locationId);
    if (!result.matched) {
      // HighLevel retries non-2xx deliveries. Register the agency record first, then
      // the original invite event can be applied without manual email assignment.
      return sendError(res, 503, 'Agency mapping is not available yet');
    }
    return res.status(200).json({ received: true, synced: true, action: result.action });
  } catch (err) {
    console.error('HighLevel user sync failed:', err && err.message ? err.message : 'unknown error');
    return sendError(res, 500, 'HighLevel user sync failed');
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};

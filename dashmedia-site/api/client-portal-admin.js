var crypto = require('node:crypto');
var portalStore = require('../lib/client-portal-store');

function safeEqual(left, right) {
  var leftBuffer = Buffer.from(left || '', 'utf8');
  var rightBuffer = Buffer.from(right || '', 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendError(res, status, message) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json({ error: message });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed');
  }

  var expectedToken = process.env.CLIENT_PORTAL_ADMIN_TOKEN;
  var authorization = req.headers.authorization || '';
  var suppliedToken = authorization.indexOf('Bearer ') === 0 ? authorization.slice(7) : '';
  if (!expectedToken || !safeEqual(suppliedToken, expectedToken)) {
    return sendError(res, 401, 'Unauthorized');
  }

  var body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return sendError(res, 400, 'Invalid JSON body');
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendError(res, 400, 'Invalid client portal record');
  }

  var id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  var name = typeof body.name === 'string' ? body.name.trim() : '';
  var locationId = typeof body.locationId === 'string' ? body.locationId.trim() : '';
  var status = body.status === 'disabled' ? 'disabled' : 'active';
  var setAsDefault = body.setAsDefault === true;

  if (!portalStore.isValidClientId(id) || !name || name.length > 100 ||
      !/^[A-Za-z0-9_-]{10,64}$/.test(locationId) ||
      (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled')) {
    return sendError(res, 400, 'Client id, name, or location id is invalid');
  }
  if (setAsDefault && status !== 'active') {
    return sendError(res, 400, 'A disabled client cannot be the default portal');
  }

  var client;
  try {
    client = {
      id: id,
      name: name,
      locationId: locationId,
      portalBaseUrl: portalStore.normalizePortalBaseUrl(body.portalBaseUrl),
      status: status,
      updatedAt: new Date().toISOString()
    };
    await portalStore.saveClient(client, setAsDefault);
  } catch (err) {
    console.error('Client portal update failed:', err && err.message ? err.message : 'unknown error');
    return sendError(res, 500, 'Client portal could not be saved');
  }

  return res.status(200).json({
    saved: true,
    client: { id: client.id, name: client.name, status: client.status },
    default: setAsDefault
  });
};

var crypto = require('node:crypto');

var DEFAULT_PORTAL_BASE_URL = 'https://login.dashmediaco.com';

function redisSettings(write) {
  var url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  var token = write
    ? (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
    : (process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.UPSTASH_REDIS_REST_READ_ONLY_TOKEN ||
      process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) throw new Error('Client portal database is not configured');
  return { url: url.replace(/\/+$/, ''), token: token };
}

async function redisCommand(command, write) {
  var settings = redisSettings(write);
  var response = await fetch(settings.url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + settings.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Client portal database request failed');
  var payload = await response.json();
  if (payload.error) throw new Error('Client portal database command failed');
  return payload.result;
}

function isValidClientId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,48}$/.test(value);
}

function isValidLocationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(value);
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('Client email is invalid');
  var email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Client email is invalid');
  }
  return email;
}

function clientKey(clientId) {
  return 'dash:client-portals:client:' + clientId;
}

function userKey(email) {
  var digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return 'dash:client-portals:user:' + digest;
}

function normalizePortalBaseUrl(value) {
  var parsed;
  try {
    parsed = new URL(value || DEFAULT_PORTAL_BASE_URL);
  } catch (err) {
    throw new Error('Client portal URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Client portal URL is invalid');
  }
  return parsed.origin;
}

function parseClient(value, requestedId) {
  if (!value) return null;
  var client;
  try {
    client = JSON.parse(value);
  } catch (err) {
    throw new Error('Client portal record is invalid');
  }
  if (!client || client.id !== requestedId || !isValidClientId(client.id) ||
      typeof client.name !== 'string' || client.name.trim().length < 1 || client.name.length > 100 ||
      !isValidLocationId(client.locationId) ||
      (client.status !== 'active' && client.status !== 'disabled')) {
    throw new Error('Client portal record is invalid');
  }
  return client;
}

async function getClient(clientId) {
  if (!isValidClientId(clientId)) return null;
  var value = await redisCommand(['GET', clientKey(clientId)], false);
  return parseClient(value, clientId);
}

async function getClientsForEmail(emailValue) {
  var email = normalizeEmail(emailValue);
  var raw = await redisCommand(['GET', userKey(email)], false);
  if (!raw) return [];
  var assignment;
  try {
    assignment = JSON.parse(raw);
  } catch (err) {
    throw new Error('Client access record is invalid');
  }
  if (!assignment || assignment.email !== email || !Array.isArray(assignment.clientIds) ||
      assignment.clientIds.some(function (id) { return !isValidClientId(id); })) {
    throw new Error('Client access record is invalid');
  }
  var uniqueIds = Array.from(new Set(assignment.clientIds));
  var clients = await Promise.all(uniqueIds.map(getClient));
  return clients
    .filter(function (client) { return client && client.status === 'active'; })
    .sort(function (left, right) { return left.name.localeCompare(right.name); });
}

async function saveClient(client, setAsDefault) {
  var commands = [
    ['SET', clientKey(client.id), JSON.stringify(client)],
    ['SADD', 'dash:client-portals:ids', client.id]
  ];
  if (setAsDefault) commands.push(['SET', 'dash:client-portals:default', client.id]);
  var settings = redisSettings(true);
  var response = await fetch(settings.url + '/multi-exec', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + settings.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Client portal database request failed');
  var results = await response.json();
  if (!Array.isArray(results) || results.some(function (item) { return item.error; })) {
    throw new Error('Client portal database write failed');
  }
}

async function assignUser(emailValue, clientIdsValue) {
  var email = normalizeEmail(emailValue);
  if (!Array.isArray(clientIdsValue) || clientIdsValue.length > 100 ||
      clientIdsValue.some(function (id) { return !isValidClientId(id); })) {
    throw new Error('Client assignments are invalid');
  }
  var clientIds = Array.from(new Set(clientIdsValue));
  var clients = await Promise.all(clientIds.map(getClient));
  if (clients.some(function (client) { return !client || client.status !== 'active'; })) {
    throw new Error('One or more agencies are unavailable');
  }
  var record = { email: email, clientIds: clientIds, updatedAt: new Date().toISOString() };
  await redisCommand(['SET', userKey(email), JSON.stringify(record)], true);
  return record;
}

module.exports = {
  DEFAULT_PORTAL_BASE_URL: DEFAULT_PORTAL_BASE_URL,
  assignUser: assignUser,
  getClient: getClient,
  getClientsForEmail: getClientsForEmail,
  isValidClientId: isValidClientId,
  isValidLocationId: isValidLocationId,
  normalizeEmail: normalizeEmail,
  normalizePortalBaseUrl: normalizePortalBaseUrl,
  saveClient: saveClient
};

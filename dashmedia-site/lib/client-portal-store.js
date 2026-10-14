var DEFAULT_CLIENT_ID = 'demo';
var DEFAULT_PORTAL_BASE_URL = 'https://app.dashmediaco.com';
var DEMO_CLIENT = {
  id: 'demo',
  name: 'Dash Mortgage Automation Demo',
  locationId: 'hl2OeTzlOLw3T9mv6WvZ',
  portalBaseUrl: DEFAULT_PORTAL_BASE_URL,
  status: 'active'
};

function redisSettings(write) {
  var url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  var token = write
    ? (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
    : (process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.UPSTASH_REDIS_REST_READ_ONLY_TOKEN ||
      process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);

  if (!url || !token) {
    throw new Error('Client portal database is not configured');
  }

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

  if (!response.ok) {
    throw new Error('Client portal database request failed');
  }

  var payload = await response.json();
  if (payload.error) {
    throw new Error('Client portal database command failed');
  }
  return payload.result;
}

function isValidClientId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,48}$/.test(value);
}

function clientKey(clientId) {
  return 'dash:client-portals:client:' + clientId;
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
      typeof client.name !== 'string' ||
      !/^[A-Za-z0-9_-]{10,64}$/.test(client.locationId) ||
      (client.status !== 'active' && client.status !== 'disabled')) {
    throw new Error('Client portal record is invalid');
  }

  return client;
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

function getUniversalLoginUrl(portal) {
  var base = normalizePortalBaseUrl(portal.portalBaseUrl || DEFAULT_PORTAL_BASE_URL).replace('https://app.gohighlevel.com', DEFAULT_PORTAL_BASE_URL);
  return new URL('/', base).toString();
}

async function getClient(clientId) {
  if (!isValidClientId(clientId)) return null;

  var value = await redisCommand(['GET', clientKey(clientId)], false);
  if (value) return parseClient(value, clientId);

  // Initialize the requested test account once; all later changes are stored in Redis.
  if (clientId === DEMO_CLIENT.id) {
    var initialValue = JSON.stringify(DEMO_CLIENT);
    await redisCommand(['SET', clientKey(clientId), initialValue, 'NX'], true);
    value = await redisCommand(['GET', clientKey(clientId)], false);
    return parseClient(value, clientId);
  }

  return null;
}

async function getDefaultClientId() {
  var clientId = await redisCommand(['GET', 'dash:client-portals:default'], false);
  if (clientId && isValidClientId(clientId)) return clientId;

  await getClient(DEFAULT_CLIENT_ID);
  await redisCommand(['SET', 'dash:client-portals:default', DEFAULT_CLIENT_ID, 'NX'], true);
  clientId = await redisCommand(['GET', 'dash:client-portals:default'], false);
  return isValidClientId(clientId) ? clientId : DEFAULT_CLIENT_ID;
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

module.exports = {
  DEFAULT_PORTAL_BASE_URL: DEFAULT_PORTAL_BASE_URL,
  getClient: getClient,
  getDefaultClientId: getDefaultClientId,
  getUniversalLoginUrl: getUniversalLoginUrl,
  isValidClientId: isValidClientId,
  normalizePortalBaseUrl: normalizePortalBaseUrl,
  saveClient: saveClient
};

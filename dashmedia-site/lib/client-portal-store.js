var DEFAULT_PORTAL_BASE_URL = 'https://login.dashmediaco.com';

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

function isValidClientId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,48}$/.test(value);
}

function clientKey(clientId) {
  return 'dash:client-portals:client:' + clientId;
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
  isValidClientId: isValidClientId,
  normalizePortalBaseUrl: normalizePortalBaseUrl,
  saveClient: saveClient
};

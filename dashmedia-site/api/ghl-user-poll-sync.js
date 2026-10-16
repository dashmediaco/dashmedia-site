var crypto = require('node:crypto');
var portalStore = require('../lib/client-portal-store');

var HIGHLEVEL_API_BASE = 'https://services.leadconnectorhq.com';
var HIGHLEVEL_API_VERSION = '2021-07-28';
var USER_PAGE_SIZE = 100;
var MAX_USERS_PER_LOCATION = 5000;
var SYNC_LOCK_TTL_SECONDS = 120;

function sendError(res, status, message) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).json({ error: message });
}

function hasCronAuthorization(req, secret) {
  var authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !secret) return false;

  var expected = Buffer.from('Bearer ' + secret);
  var actual = Buffer.from(authorization);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function highLevelGet(path, token) {
  var response = await fetch(HIGHLEVEL_API_BASE + path, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      Version: HIGHLEVEL_API_VERSION
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error('HighLevel API request failed with status ' + response.status);
  }

  var payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('HighLevel API returned an invalid response');
  }
  return payload;
}

async function getUsersForLocation(locationId, companyId, token) {
  var users = [];
  var skip = 0;

  while (true) {
    if (skip >= MAX_USERS_PER_LOCATION) {
      throw new Error('HighLevel location user list exceeded the sync limit');
    }

    var query = new URLSearchParams({
      companyId: companyId,
      locationId: locationId,
      skip: String(skip),
      limit: String(USER_PAGE_SIZE)
    });
    var payload = await highLevelGet('/users/search?' + query.toString(), token);
    if (!Array.isArray(payload.users)) {
      throw new Error('HighLevel user search returned an invalid response');
    }

    var page = payload.users;
    if (users.length + page.length > MAX_USERS_PER_LOCATION) {
      throw new Error('HighLevel location user list exceeded the sync limit');
    }
    users = users.concat(page);

    if (page.length === 0) return users;

    skip += page.length;
    var count = Number(payload.count);
    if (Number.isFinite(count) && count >= 0 && skip >= count) return users;
    if (page.length < USER_PAGE_SIZE) return users;
  }
}

async function syncLocation(client, token) {
  if (client.status !== 'active') {
    return portalStore.reconcileGhlUsersForLocation(client.locationId, []);
  }

  var locationPayload = await highLevelGet(
    '/locations/' + encodeURIComponent(client.locationId),
    token
  );
  var location = locationPayload.location;
  if (!location || typeof location.companyId !== 'string' || !location.companyId.trim()) {
    throw new Error('HighLevel location did not include an agency ID');
  }

  var users = await getUsersForLocation(client.locationId, location.companyId.trim(), token);
  return portalStore.reconcileGhlUsersForLocation(client.locationId, users);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed');
  }

  var cronSecret = process.env.CRON_SECRET;
  var highLevelToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!cronSecret || !highLevelToken) {
    return sendError(res, 503, 'HighLevel user sync is not configured');
  }
  if (!hasCronAuthorization(req, cronSecret)) {
    return sendError(res, 401, 'Unauthorized');
  }

  var lockValue = crypto.randomBytes(24).toString('hex');
  var lockAcquired = false;

  try {
    lockAcquired = await portalStore.acquireGhlUserSyncLock(lockValue, SYNC_LOCK_TTL_SECONDS);
    if (!lockAcquired) return res.status(200).json({ ok: true, skipped: true });

    var clients = await portalStore.listClientPortals();
    var totals = { locations: 0, usersAdded: 0, usersRemoved: 0 };

    for (var i = 0; i < clients.length; i += 1) {
      var result = await syncLocation(clients[i], highLevelToken);
      if (!result.matched) {
        throw new Error('HighLevel location is not registered in the Dash portal');
      }
      totals.locations += 1;
      totals.usersAdded += result.added || 0;
      totals.usersRemoved += result.removed || 0;
    }

    return res.status(200).json({ ok: true, ...totals });
  } catch (err) {
    console.error('HighLevel portal user sync failed:', err && err.message ? err.message : 'unknown error');
    return sendError(res, 502, 'HighLevel user sync failed; it will retry on the next scheduled run.');
  } finally {
    if (lockAcquired) {
      try {
        await portalStore.releaseGhlUserSyncLock(lockValue);
      } catch (err) {
        console.error('HighLevel portal user sync lock release failed');
      }
    }
  }
};

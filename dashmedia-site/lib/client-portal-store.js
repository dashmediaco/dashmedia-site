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

function emailDigest(emailValue) {
  return crypto.createHash('sha256').update(normalizeEmail(emailValue)).digest('hex');
}

function passwordCredentialKey(emailValue) {
  return 'dash:client-portals:credential:' + emailDigest(emailValue);
}

function passwordAttemptKey(emailValue) {
  var bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  return 'dash:client-portals:login-attempts:' + emailDigest(emailValue) + ':' + bucket;
}

function isValidPortalPassword(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 12 && Buffer.byteLength(value, 'utf8') <= 1024;
}

function userKey(email) {
  var digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return 'dash:client-portals:user:' + digest;
}

function ghlUserAccessKey(email) {
  return 'dash:client-portals:ghl-user:' + emailDigest(email);
}

function ghlUserRecordKey(locationId, userId) {
  var digest = crypto.createHash('sha256').update(locationId + ':' + userId).digest('hex');
  return 'dash:client-portals:ghl-user-record:' + digest;
}

function isValidGhlUserId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
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

async function getClientByLocationId(locationIdValue) {
  if (!isValidLocationId(locationIdValue)) return null;
  var clientIds = await redisCommand(['SMEMBERS', 'dash:client-portals:ids'], false);
  if (!Array.isArray(clientIds)) return null;
  var clients = await Promise.all(clientIds.filter(isValidClientId).map(getClient));
  var matches = clients.filter(function (client) {
    return client && client.locationId === locationIdValue;
  });
  if (matches.length > 1) throw new Error('HighLevel location is mapped to multiple agencies');
  return matches[0] || null;
}

function parseGhlUserRecord(value, locationId, userId) {
  if (!value) return null;
  var record;
  try {
    record = JSON.parse(value);
  } catch (err) {
    throw new Error('HighLevel user sync record is invalid');
  }
  if (!record || record.locationId !== locationId || record.userId !== userId ||
      !isValidLocationId(record.locationId) || !isValidGhlUserId(record.userId) ||
      !isValidClientId(record.clientId) || typeof record.updatedAt !== 'string') {
    throw new Error('HighLevel user sync record is invalid');
  }
  record.email = normalizeEmail(record.email);
  return record;
}

async function redisMultiExec(commands) {
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

async function getClientsForEmail(emailValue) {
  var email = normalizeEmail(emailValue);
  var values = await Promise.all([
    redisCommand(['GET', userKey(email)], false),
    redisCommand(['SMEMBERS', ghlUserAccessKey(email)], false)
  ]);
  var manualIds = [];
  if (values[0]) {
    var assignment;
    try {
      assignment = JSON.parse(values[0]);
    } catch (err) {
      throw new Error('Client access record is invalid');
    }
    if (!assignment || assignment.email !== email || !Array.isArray(assignment.clientIds) ||
        assignment.clientIds.some(function (id) { return !isValidClientId(id); })) {
      throw new Error('Client access record is invalid');
    }
    manualIds = assignment.clientIds;
  }
  var ghlIds = Array.isArray(values[1]) ? values[1] : [];
  if (ghlIds.some(function (id) { return !isValidClientId(id); })) {
    throw new Error('HighLevel client access record is invalid');
  }
  var uniqueIds = Array.from(new Set(manualIds.concat(ghlIds)));
  var clients = await Promise.all(uniqueIds.map(getClient));
  return clients
    .filter(function (client) { return client && client.status === 'active'; })
    .sort(function (left, right) { return left.name.localeCompare(right.name); });
}

async function getPasswordCredential(emailValue) {
  var email = normalizeEmail(emailValue);
  var raw = await redisCommand(['GET', passwordCredentialKey(email)], false);
  if (!raw) return null;
  var record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    throw new Error('Client password record is invalid');
  }
  if (!record || record.email !== email || record.version !== 1 ||
      typeof record.salt !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(record.salt) ||
      typeof record.hash !== 'string' || !/^[a-f0-9]{128}$/.test(record.hash)) {
    throw new Error('Client password record is invalid');
  }
  return record;
}

async function setPasswordCredential(emailValue, password) {
  var email = normalizeEmail(emailValue);
  if (!isValidPortalPassword(password)) throw new Error('Password must be at least 12 characters');
  var salt = crypto.randomBytes(16).toString('base64url');
  var derived = await new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, function (err, key) {
      if (err) return reject(err);
      resolve(key);
    });
  });
  var record = {
    email: email,
    salt: salt,
    hash: derived.toString('hex'),
    version: 1,
    updatedAt: new Date().toISOString()
  };
  await redisCommand(['SET', passwordCredentialKey(email), JSON.stringify(record)], true);
  return { email: email, updatedAt: record.updatedAt };
}

async function recordPasswordLoginAttempt(emailValue) {
  var key = passwordAttemptKey(emailValue);
  var count = Number(await redisCommand(['INCR', key], true));
  await redisCommand(['EXPIRE', key, 900], true);
  return count;
}

async function clearPasswordLoginAttempts(emailValue) {
  await redisCommand(['DEL', passwordAttemptKey(emailValue)], true);
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

function ghlUserSnapshotKey(locationId) {
  return 'dash:client-portals:ghl-user-location:' + locationId;
}

async function listClientPortals() {
  var clientIds = await redisCommand(['SMEMBERS', 'dash:client-portals:ids'], false);
  if (!Array.isArray(clientIds)) return [];
  if (clientIds.length > 1000) throw new Error('Client portal registry exceeds the sync limit');
  var clients = await Promise.all(clientIds.filter(isValidClientId).map(getClient));
  return clients
    .filter(function (client) { return !!client; })
    .sort(function (left, right) { return left.name.localeCompare(right.name); });
}

async function acquireGhlUserSyncLock(lockValue, ttlSeconds) {
  if (typeof lockValue !== 'string' || !/^[a-f0-9]{48}$/.test(lockValue) ||
      !Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) {
    throw new Error('HighLevel sync lock is invalid');
  }
  var result = await redisCommand([
    'SET', 'dash:client-portals:ghl-user-sync-lock', lockValue, 'NX', 'EX', ttlSeconds
  ], true);
  return result === 'OK';
}

async function retryLockRedisCommand(command, write) {
  for (var attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await redisCommand(command, write);
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(function (resolve) {
        setTimeout(resolve, 100 * (attempt + 1));
      });
    }
  }
}

async function releaseGhlUserSyncLock(lockValue) {
  if (typeof lockValue !== 'string' || !/^[a-f0-9]{48}$/.test(lockValue)) {
    throw new Error('HighLevel sync lock is invalid');
  }
  var lockKey = 'dash:client-portals:ghl-user-sync-lock';
  var currentValue = await retryLockRedisCommand(['GET', lockKey], true);
  if (currentValue !== lockValue) return 0;

  // The sync function is limited to 60 seconds and the lock expires after 120,
  // so this compare-then-delete cannot race a newer invocation's lock.
  return retryLockRedisCommand(['DEL', lockKey], true);
}

async function syncGhlUserAccessForClient(client, eventType, userId, emailValue, locationId) {
  var recordKey = ghlUserRecordKey(locationId, userId);
  var rawRecord = await redisCommand(['GET', recordKey], false);
  var existing = parseGhlUserRecord(rawRecord, locationId, userId);
  var commands = [];

  if (eventType === 'UserDelete') {
    var deletedEmail = existing ? existing.email : '';
    if (!deletedEmail && typeof emailValue === 'string') {
      try {
        deletedEmail = normalizeEmail(emailValue);
      } catch (err) {
        deletedEmail = '';
      }
    }
    if (deletedEmail) {
      commands.push(['SREM', ghlUserAccessKey(deletedEmail), existing ? existing.clientId : client.id]);
    }
    commands.push(['SREM', ghlUserSnapshotKey(locationId), userId]);
    commands.push(['DEL', recordKey]);
    await redisMultiExec(commands);
    return { matched: true, clientId: client.id, action: 'removed' };
  }

  var email = normalizeEmail(emailValue);
  var removeExistingAccess = existing && (existing.email !== email || existing.clientId !== client.id);
  if (removeExistingAccess) {
    commands.push(['SREM', ghlUserAccessKey(existing.email), existing.clientId]);
  }
  if (client.status !== 'active') {
    if (existing && !removeExistingAccess) {
      commands.push(['SREM', ghlUserAccessKey(existing.email), existing.clientId]);
    }
    commands.push(['SREM', ghlUserSnapshotKey(locationId), userId]);
    commands.push(['DEL', recordKey]);
    await redisMultiExec(commands);
    return { matched: true, clientId: client.id, action: 'removed-disabled' };
  }

  commands.push(['SADD', ghlUserAccessKey(email), client.id]);
  commands.push(['SADD', ghlUserSnapshotKey(locationId), userId]);
  commands.push(['SET', recordKey, JSON.stringify({
    email: email,
    locationId: locationId,
    userId: userId,
    clientId: client.id,
    updatedAt: new Date().toISOString()
  })]);
  await redisMultiExec(commands);
  return { matched: true, clientId: client.id, action: existing ? 'updated' : 'added' };
}

async function syncGhlUserAccess(eventType, userIdValue, emailValue, locationIdValue) {
  var locationId = typeof locationIdValue === 'string' ? locationIdValue.trim() : '';
  var userId = typeof userIdValue === 'string' ? userIdValue.trim() : '';
  if (!isValidLocationId(locationId) || !isValidGhlUserId(userId) ||
      ['UserCreate', 'UserUpdate', 'UserDelete'].indexOf(eventType) === -1) {
    throw new Error('HighLevel user event is invalid');
  }

  var client = await getClientByLocationId(locationId);
  if (!client) return { matched: false };
  return syncGhlUserAccessForClient(client, eventType, userId, emailValue, locationId);
}

async function reconcileGhlUsersForLocation(locationIdValue, usersValue) {
  var locationId = typeof locationIdValue === 'string' ? locationIdValue.trim() : '';
  if (!isValidLocationId(locationId) || !Array.isArray(usersValue) || usersValue.length > 5000) {
    throw new Error('HighLevel location user list is invalid');
  }

  var client = await getClientByLocationId(locationId);
  if (!client) return { matched: false, added: 0, removed: 0 };

  var desiredUsers = new Map();
  if (client.status === 'active') {
    usersValue.forEach(function (user) {
      if (!user || typeof user !== 'object' || Array.isArray(user)) {
        throw new Error('HighLevel user record is invalid');
      }
      var userId = typeof user.id === 'string' ? user.id.trim() : '';
      if (!isValidGhlUserId(userId)) throw new Error('HighLevel user ID is invalid');
      var email = normalizeEmail(user.email);
      if (desiredUsers.has(userId) && desiredUsers.get(userId) !== email) {
        throw new Error('HighLevel user IDs are not unique');
      }
      desiredUsers.set(userId, email);
    });
  }

  var snapshotKey = ghlUserSnapshotKey(locationId);
  var existingUserIds = await redisCommand(['SMEMBERS', snapshotKey], false);
  if (!Array.isArray(existingUserIds) || existingUserIds.length > 5000 ||
      existingUserIds.some(function (userId) { return !isValidGhlUserId(userId); })) {
    throw new Error('HighLevel user sync snapshot is invalid');
  }

  var added = 0;
  var removed = 0;
  for (var entry of desiredUsers.entries()) {
    var result = await syncGhlUserAccessForClient(client, 'UserUpdate', entry[0], entry[1], locationId);
    if (result.action === 'added') added += 1;
  }

  for (var i = 0; i < existingUserIds.length; i += 1) {
    var existingUserId = existingUserIds[i];
    if (desiredUsers.has(existingUserId)) continue;
    await syncGhlUserAccessForClient(client, 'UserDelete', existingUserId, '', locationId);
    removed += 1;
  }

  return { matched: true, added: added, removed: removed, users: desiredUsers.size };
}

module.exports = {
  DEFAULT_PORTAL_BASE_URL: DEFAULT_PORTAL_BASE_URL,
  clearPasswordLoginAttempts: clearPasswordLoginAttempts,
  assignUser: assignUser,
  getClient: getClient,
  getClientByLocationId: getClientByLocationId,
  getClientsForEmail: getClientsForEmail,
  getPasswordCredential: getPasswordCredential,
  isValidGhlUserId: isValidGhlUserId,
  isValidClientId: isValidClientId,
  isValidLocationId: isValidLocationId,
  isValidPortalPassword: isValidPortalPassword,
  normalizeEmail: normalizeEmail,
  normalizePortalBaseUrl: normalizePortalBaseUrl,
  recordPasswordLoginAttempt: recordPasswordLoginAttempt,
  saveClient: saveClient,
  setPasswordCredential: setPasswordCredential,
  syncGhlUserAccess: syncGhlUserAccess,
  listClientPortals: listClientPortals,
  reconcileGhlUsersForLocation: reconcileGhlUsersForLocation,
  acquireGhlUserSyncLock: acquireGhlUserSyncLock,
  releaseGhlUserSyncLock: releaseGhlUserSyncLock
};

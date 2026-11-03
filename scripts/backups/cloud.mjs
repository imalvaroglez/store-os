import { cert, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { DEV, PROD, fileHash, json, privateDirectory, readJson, sha256 } from './core.mjs';

export const EMULATORS = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' };
export function validateTarget(config, restore = false, env = process.env) {
  if (![DEV, PROD].includes(config.projectId) || !new RegExp(`^${config.projectId}\\.(?:firebasestorage\\.app|appspot\\.com)$`).test(config.bucket ?? '')) throw new Error('INVALID_TARGET');
  const emulatorKeys = Object.keys(env).filter(key => /EMULATOR/.test(key) && env[key]);
  if (config.projectId === PROD) {
    if (restore || emulatorKeys.length) throw new Error('PRODUCTION_TARGET_BLOCKED');
    if (!config.credentials || !config.productionReadApproved) throw new Error('PRODUCTION_APPROVAL_REQUIRED');
  } else {
    for (const [key, value] of Object.entries(EMULATORS)) if (env[key] !== value) throw new Error('LOCAL_EMULATORS_REQUIRED');
    const aliases = { STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', FIREBASE_EMULATOR_HUB: '127.0.0.1:4400', FIREBASE_FIRESTORE_EMULATOR_ADDRESS: '127.0.0.1:8080' };
    if (emulatorKeys.some(k => !(k in EMULATORS) && env[k] !== aliases[k])) throw new Error('UNEXPECTED_EMULATOR');
  }
}
export async function connect(config, restore = false) {
  validateTarget(config, restore);
  let credential;
  if (config.projectId === PROD) {
    const serviceAccount = await readJson(config.credentials);
    if (serviceAccount.project_id !== PROD) throw new Error('CREDENTIAL_PROJECT_MISMATCH');
    credential = cert(serviceAccount);
  }
  const app = initializeApp({ projectId: config.projectId, storageBucket: config.bucket, ...(credential ? { credential } : {}) }, `backup-${Date.now()}`);
  const auth = getAuth(app); const bucket = getStorage(app).bucket();
  const base = config.projectId === DEV ? `http://${EMULATORS.FIRESTORE_EMULATOR_HOST}/v1` : 'https://firestore.googleapis.com/v1';
  const root = `projects/${config.projectId}/databases/(default)/documents`;
  async function request(url, body, method = body ? 'POST' : 'GET') {
    const token = credential ? (await credential.getAccessToken()).access_token : 'owner';
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`CLOUD_HTTP_${response.status}`);
    return response.status === 204 ? {} : response.json();
  }
  const resourcePath = name => name.split('/').map(encodeURIComponent).join('/');
  async function* pages(url, field, body) {
    let token;
    do {
      const page = body ? await request(url, { ...body, ...(token ? { pageToken: token } : {}) }) : await request(`${url}${url.includes('?') ? '&' : '?'}pageSize=500${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      yield page[field] ?? []; token = page.nextPageToken;
    } while (token);
  }
  // REST Value objects preserve int64 strings, doubles, nanoseconds and references exactly.
  // Credentials, Auth and Storage use the Admin SDK; this is the SDK-authenticated Firestore transport.
  async function documents({ maxDocuments = Infinity, maxReads = Infinity, onRead = () => {} } = {}) {
    const result = []; let reads = 0;
    async function visit(parent) {
      for await (const ids of pages(`${base}/${resourcePath(parent)}:listCollectionIds`, 'collectionIds', { pageSize: 500 })) {
        for (const id of ids) {
          let pageToken;
          do {
            const remaining = maxReads - reads;
            if (remaining <= 0) throw new Error('FIRESTORE_READ_LIMIT_EXCEEDED');
            const pageSize = Math.min(500, remaining, maxDocuments - result.length + 1);
            const url = `${base}/${resourcePath(parent)}/${encodeURIComponent(id)}?showMissing=true&pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
            const page = await request(url); const docs = page.documents ?? [];
            const used = Math.max(1, docs.length); reads += used; onRead(used);
            for (const doc of docs) {
              if (doc.createTime || doc.updateTime) {
                if (result.length >= maxDocuments) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
                result.push({ path: doc.name.slice(root.length + 1), fields: doc.fields ?? {} });
              }
              await visit(doc.name);
            }
            pageToken = page.nextPageToken;
          } while (pageToken);
        }
      }
    }
    await visit(root); return result;
  }
  async function users() {
    const result = []; let token;
    do { const page = await auth.listUsers(1000, token); result.push(...page.users.map(u => u.toJSON())); token = page.pageToken; } while (token);
    return result;
  }
  async function authConfig() {
    if (config.projectId === DEV) return { hashConfig: { algorithm: 'SCRYPT', signerKey: '', saltSeparator: '', rounds: 8, memoryCost: 14 }, emulator: true };
    const result = await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROD}/config`);
    const hashConfig = result.signIn?.hashConfig;
    if (hashConfig?.algorithm !== 'SCRYPT' || !hashConfig.signerKey || hashConfig.rounds === undefined || hashConfig.memoryCost === undefined) throw new Error('AUTH_HASH_CONFIG_REQUIRED');
    return { hashConfig };
  }
  async function files() {
    const result = []; let query = { autoPaginate: false, maxResults: 500 };
    do { const [files, next] = await bucket.getFiles(query); for (const file of files) result.push(file.metadata); query = next; } while (query);
    return result;
  }
  async function settings() {
    if (config.projectId === DEV) return { emulator: true };
    const db = await request(`${base}/projects/${PROD}/databases/(default)`);
    const schedules = [];
    for await (const page of pages(`${base}/projects/${PROD}/databases/(default)/backupSchedules`, 'backupSchedules')) schedules.push(...page);
    return { locationId: db.locationId, pointInTimeRecoveryEnablement: db.pointInTimeRecoveryEnablement, backupSchedules: schedules };
  }
  return { auth, bucket, request, documents, users, files, authConfig, settings, root, base, close: () => deleteApp(app) };
}
export function validateUsers(users, emulator = false) {
  const ids = new Set();
  for (const user of users) {
    if (!user.uid || ids.has(user.uid)) throw new Error('INVALID_AUTH_USERS'); ids.add(user.uid);
    if (!emulator && user.providerData?.some(p => p.providerId === 'password') && !user.passwordHash) throw new Error('AUTH_PASSWORD_HASH_REQUIRED');
  }
}
export async function capture(client, config, dir, now = () => new Date().toISOString()) {
  const intervals = {}; const counts = {};
  intervals.firestore = { startedAt: now() };
  const docs = await client.documents(); await json(path.join(dir, 'firestore.json'), docs);
  intervals.firestore.finishedAt = now(); counts.documents = docs.length;
  intervals.auth = { startedAt: now() };
  const hash = await client.authConfig(); const users = await client.users(); validateUsers(users, config.projectId === DEV);
  await json(path.join(dir, 'auth.json'), users); await json(path.join(dir, 'auth-config.json'), hash);
  intervals.auth.finishedAt = now(); counts.users = users.length;
  intervals.storage = { startedAt: now() }; await privateDirectory(path.join(dir, 'objects'));
  const objects = []; let bytes = 0;
  for (const metadata of await client.files()) {
    const object = sha256(metadata.name);
    const output = path.join(dir, 'objects', object);
    // Pin generation: replacement during capture must not silently change the captured object.
    await client.bucket.file(metadata.name, { generation: metadata.generation }).download({ destination: output, validation: 'crc32c', decompress: false });
    if ((await stat(output)).size !== Number(metadata.size)) throw new Error('STORAGE_SIZE_MISMATCH');
    const digest = await fileHash(output);
    objects.push({ metadata, object, sha256: digest }); bytes += Number(metadata.size);
  }
  await json(path.join(dir, 'storage.json'), objects);
  intervals.storage.finishedAt = now(); counts.objects = objects.length; counts.storageBytes = bytes;
  return { intervals, counts };
}
export function remapFields(fields, source, target) {
  const from = `projects/${source}/databases/(default)/documents/`;
  function visit(value) {
    if (value.referenceValue) {
      return { referenceValue: value.referenceValue.startsWith(from) ? value.referenceValue.replace(from, `projects/${target}/databases/(default)/documents/`) : value.referenceValue };
    }
    if (value.mapValue?.fields) return { mapValue: { fields: remapFields(value.mapValue.fields, source, target) } };
    if (value.arrayValue?.values) return { arrayValue: { values: value.arrayValue.values.map(visit) } };
    return value;
  }
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, visit(value)]));
}
function importUser(user) {
  const { uid, email, emailVerified, displayName, disabled, phoneNumber, photoURL, customClaims, metadata, providerData, passwordHash, passwordSalt, multiFactor } = user;
  return { uid, email, emailVerified, displayName, disabled, phoneNumber, photoURL, customClaims, metadata,
    providerData, multiFactor,
    ...(passwordHash ? { passwordHash: Buffer.from(passwordHash, 'base64') } : {}),
    ...(passwordSalt ? { passwordSalt: Buffer.from(passwordSalt, 'base64') } : {}) };
}
export async function restore(client, config, dir, manifest) {
  validateTarget(config, true);
  // An existing emulator must never be overwritten, even when invoked by mistake.
  if ((await client.documents()).length || (await client.users()).length || (await client.files()).length) throw new Error('EMULATORS_NOT_EMPTY');
  const docs = await readJson(path.join(dir, 'firestore.json'));
  const users = await readJson(path.join(dir, 'auth.json'));
  const { hashConfig: hash } = await readJson(path.join(dir, 'auth-config.json'));
  const objects = await readJson(path.join(dir, 'storage.json'));
  if (docs.length !== manifest.counts.documents || users.length !== manifest.counts.users || objects.length !== manifest.counts.objects) throw new Error('COUNT_MISMATCH');
  validateUsers(users, manifest.projectId === DEV);
  for (const entry of objects) {
    if (!/^[a-f0-9]{64}$/.test(entry.object) || sha256(entry.metadata.name) !== entry.object || await fileHash(path.join(dir, 'objects', entry.object)) !== entry.sha256) throw new Error('INVALID_OBJECT');
  }
  const writes = docs.map(doc => {
    if (!doc.path || doc.path.split('/').length % 2 || doc.path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('INVALID_DOCUMENT_PATH');
    return { update: { name: `${client.root}/${doc.path}`, fields: remapFields(doc.fields, manifest.projectId, DEV) }, currentDocument: { exists: false } };
  });
  const hashOptions = { algorithm: hash.algorithm, key: Buffer.from(hash.signerKey ?? '', 'base64'), saltSeparator: Buffer.from(hash.saltSeparator ?? '', 'base64'), rounds: hash.rounds, memoryCost: hash.memoryCost };
  for (let i = 0; i < users.length; i += 1000) {
    const result = await client.auth.importUsers(users.slice(i, i + 1000).map(importUser), { hash: hashOptions });
    if (result.failureCount) throw new Error('AUTH_IMPORT_FAILED');
  }
  // The Auth emulator exports fake hashes containing the fixture password. Its SDK
  // import endpoint does not roundtrip those hashes; reset only synthetic DEV users.
  if (manifest.projectId === DEV) for (const user of users) {
    if (user.passwordHash?.startsWith('fakeHash:salt=') && user.passwordHash.includes(':password=')) await client.auth.updateUser(user.uid, { password: user.passwordHash.slice(user.passwordHash.indexOf(':password=') + 10) });
  }
  for (let i = 0; i < writes.length; i += 100) await client.request(`${client.base}/projects/${DEV}/databases/(default)/documents:commit`, { writes: writes.slice(i, i + 100) });
  const mutableMetadata = ['cacheControl', 'contentDisposition', 'contentEncoding', 'contentLanguage', 'contentType', 'metadata', 'customTime'];
  for (const { metadata, object } of objects) {
    await client.bucket.upload(path.join(dir, 'objects', object), { destination: metadata.name, metadata: Object.fromEntries(mutableMetadata.filter(k => metadata[k] !== undefined).map(k => [k, metadata[k]])) });
  }
  const actualDocs = await client.documents(); const actualUsers = await client.users(); const actualObjects = await client.files();
  const canonical = list => JSON.stringify(list.sort((a, b) => a.path.localeCompare(b.path)).map(d => ({ path: d.path, fields: sortObject(d.fields) })));
  const expected = docs.map(d => ({ path: d.path, fields: remapFields(d.fields, manifest.projectId, DEV) }));
  if (canonical(actualDocs) !== canonical(expected)) throw new Error('FIRESTORE_VERIFY_FAILED');
  if (actualUsers.length !== users.length || actualObjects.length !== objects.length) throw new Error('RESTORE_COUNT_MISMATCH');
  for (const user of users) {
    const actual = actualUsers.find(u => u.uid === user.uid);
    if (!actual || user.email !== actual.email || Boolean(user.disabled) !== Boolean(actual.disabled) || JSON.stringify(sortObject(user.customClaims ?? {})) !== JSON.stringify(sortObject(actual.customClaims ?? {})) || JSON.stringify(sortObject(user.providerData ?? [])) !== JSON.stringify(sortObject(actual.providerData ?? []))) throw new Error('AUTH_VERIFY_FAILED');
  }
  for (const entry of objects) {
    const [buffer] = await client.bucket.file(entry.metadata.name).download({ decompress: false });
    if (sha256(buffer) !== entry.sha256) throw new Error('STORAGE_VERIFY_FAILED');
    const actual = actualObjects.find(m => m.name === entry.metadata.name);
    for (const key of mutableMetadata) if (entry.metadata[key] !== undefined && JSON.stringify(sortObject(actual[key])) !== JSON.stringify(sortObject(entry.metadata[key]))) throw new Error('STORAGE_METADATA_VERIFY_FAILED');
  }
  return { verified: true, counts: manifest.counts, authPasswordLoginVerified: false };
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortObject(value[k])]));
  return value;
}

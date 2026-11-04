import { trash } from './trash.mjs';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEV, command, decryptArchive, fileHash, json, readJson } from './core.mjs';
import { capture, connect, restore, validateTarget, EMULATORS } from './cloud.mjs';
import { checkRecoveryIdentity } from './verification.mjs';
import { preflight, runBackup } from './cli.mjs';

test('complete encrypted backup restores raw Firestore, orphan descendants, Auth and Storage on fresh emulators', async t => {
  Object.assign(process.env, EMULATORS);
  const root = await mkdtemp(path.join(os.tmpdir(), 'store-os-backup-roundtrip-'));
  t.after(() => trash(root));
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home: path.join(root, 'home'), destination: path.join(root, 'cloud'), firebase: execFileSync('/usr/bin/which', ['firebase'], { encoding: 'utf8' }).trim(), age: execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim(), maxDocuments: 1000, maxFirestoreReads: 2000, maxDailyFirestoreReads: 4000, maxStorageBytes: 100000, notifications: false };
  validateTarget(config, true); await mkdir(config.home);
  const client = await connect(config); let ownsFixtures = false;
  t.after(async () => {
    try {
      if (ownsFixtures) {
        validateTarget(config, true);
        for (const endpoint of [`http://${EMULATORS.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${DEV}/databases/(default)/documents`, `http://${EMULATORS.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${DEV}/accounts`]) assert((await fetch(endpoint, { method: 'DELETE' })).ok);
        await client.bucket.deleteFiles();
      }
    } finally { await client.close(); }
  });
  assert.equal((await client.documents()).length, 0); assert.equal((await client.users()).length, 0); assert.equal((await client.files()).length, 0);
  ownsFixtures = true;
  await client.auth.createUser({ uid: 'fixture-owner', email: 'fixture@example.test', password: 'FixturePassword123!', emailVerified: true });
  await client.auth.setCustomUserClaims('fixture-owner', { fixtureRole: 'owner' });
  const fields = { ownerUid: { stringValue: 'fixture-owner' }, memberUids: { arrayValue: { values: [{ stringValue: 'fixture-owner' }] } }, reference: { referenceValue: `${client.root}/users/fixture-owner` }, integer: { integerValue: '9223372036854775807' }, double: { doubleValue: 1.25 }, nan: { doubleValue: 'NaN' }, timestamp: { timestampValue: '2026-11-03T12:00:00.123456789Z' }, bytes: { bytesValue: 'aGVsbG8=' }, boolean: { booleanValue: true }, null: { nullValue: null }, map: { mapValue: { fields: { inside: { geoPointValue: { latitude: 1, longitude: 2 } } } } } };
  await client.request(`${client.base}/projects/${DEV}/databases/(default)/documents:commit`, { writes: [
    { update: { name: `${client.root}/stores/fixture`, fields } },
    { update: { name: `${client.root}/users/fixture-owner`, fields: { role: { stringValue: 'member' } } } },
    { update: { name: `${client.root}/missing/parent%?#/children/child`, fields: { child: { stringValue: 'orphan parent is absent' } } } },
  ] });
  for (let i = 0; i < 501; i += 100) await client.request(`${client.base}/projects/${DEV}/databases/(default)/documents:commit`, { writes: Array.from({ length: Math.min(100, 501 - i) }, (_, j) => ({ update: { name: `${client.root}/pages/p${String(i + j).padStart(4, '0')}`, fields: {} } })) });
  await client.bucket.file('folder/photo.txt').save(Buffer.from('sample photo'), { metadata: { contentType: 'text/plain', cacheControl: 'private, max-age=60', customTime: '2026-11-03T12:00:00Z', metadata: { storeId: 'fixture' } } });
  const compressed = gzipSync(Buffer.from('compressed fixture'));
  await client.bucket.file('folder/compressed.txt.gz').save(compressed, { metadata: { contentType: 'text/plain', contentEncoding: 'gzip' } });
  const key = path.join(root, 'identity'); await command('age-keygen', ['-o', key]);
  config.recipient = execFileSync('age-keygen', ['-y', key], { encoding: 'utf8' }).trim();
  await assert.rejects(client.documents({ maxDocuments: 2, maxReads: 2000 }), /DOCUMENT_LIMIT/);
  await assert.rejects(client.documents({ maxReads: 1 }), /FIRESTORE_READ_LIMIT/);
  await checkRecoveryIdentity(config, key);
  const report = await preflight(config, client);
  assert.equal(report.documents, 504); assert.equal(report.users, 1); assert.equal(report.objects, 2);
  config.reviewedPreflightSha256 = await fileHash(path.join(config.home, 'preflight.json'));
  const result = await runBackup(config);
  assert(result.completed); assert.equal((await runBackup(config)).skipped, true);
  const output = path.join(root, 'unpacked'); const info = await decryptArchive(path.join(config.destination, result.archive), output, key, config.age);
  assert.equal(info.counts.documents, 504); assert.equal(info.counts.users, 1); assert.equal(info.counts.objects, 2);
  assert.equal(info.projectId, DEV);
  await assert.rejects(restore(client, config, output, info), /EMULATORS_NOT_EMPTY/);
  assert((await fetch(`http://${EMULATORS.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${DEV}/databases/(default)/documents`, { method: 'DELETE' })).ok);
  assert((await fetch(`http://${EMULATORS.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${DEV}/accounts`, { method: 'DELETE' })).ok);
  await client.bucket.deleteFiles();
  const restored = await restore(client, config, output, info); assert(restored.verified);
  const docs = await client.documents(); assert.equal(docs.length, 504); assert(!docs.some(d => d.path === 'missing/parent'));
  assert.equal(docs.find(d => d.path === 'stores/fixture').fields.integer.integerValue, '9223372036854775807');
  const store = docs.find(d => d.path === 'stores/fixture');
  assert.equal(store.fields.ownerUid.stringValue, 'fixture-owner');
  assert.equal(store.fields.memberUids.arrayValue.values[0].stringValue, 'fixture-owner');
  assert.deepEqual((await client.auth.getUser('fixture-owner')).customClaims, { fixtureRole: 'owner' });
  const login = await fetch(`http://${EMULATORS.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'fixture@example.test', password: 'FixturePassword123!', returnSecureToken: true }) });
  // The emulator uses its own password representation. This proves the fixture's login,
  // not production SCRYPT verification, which the Auth emulator cannot certify.
  assert(login.ok, 'fixture password must remain usable after restore');
  assert.deepEqual((await client.bucket.file('folder/compressed.txt.gz').download({ decompress: false }))[0], compressed);
  assert.equal((await client.bucket.file('folder/photo.txt').download())[0].toString(), 'sample photo');
});

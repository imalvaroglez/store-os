import { trash } from './trash.mjs';
import { createServer } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { DEV, PROD, command, decryptArchive, encryptDirectory, fileHash, exists, json, manifest, readJson } from './core.mjs';
import { connect, EMULATORS, validateTarget } from './cloud.mjs';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const password = 'SyntheticRecovery123!';
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
}
const documentSnapshot = docs => docs.map(d => sorted(d)).sort((a, b) => a.path.localeCompare(b.path));
function field(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: fields(value) } };
}
const fields = obj => Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, field(value)]));
function decodeFields(value) {
  function decode(item) {
    if ('stringValue' in item) return item.stringValue;
    if ('booleanValue' in item) return item.booleanValue;
    if ('integerValue' in item) return Number(item.integerValue);
    if ('doubleValue' in item) return item.doubleValue;
    if ('arrayValue' in item) return (item.arrayValue.values ?? []).map(decode);
    if ('mapValue' in item) return decodeFields(item.mapValue.fields ?? {});
    throw new Error('Unexpected fixture field type');
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
}
async function reset(client, config) {
  validateTarget(config, true);
  for (const url of [
    `http://${EMULATORS.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${DEV}/databases/(default)/documents`,
    `http://${EMULATORS.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${DEV}/accounts`,
  ]) assert((await fetch(url, { method: 'DELETE' })).ok);
  await client.bucket.deleteFiles();
}
async function assertEmpty(client) {
  assert.equal((await client.documents()).length, 0, 'rejected recovery must not create Firestore documents');
  assert.equal((await client.users()).length, 0, 'rejected recovery must not create Auth accounts');
  assert.equal((await client.files()).length, 0, 'rejected recovery must not create Storage objects');
}
async function runNode(args, env = process.env) {
  env = { ...env }; delete env.NODE_TEST_CONTEXT; // Child test runners must execute independently.
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', data => { stdout += data; });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { code, stdout, stderr };
}
async function invoke(config, action, args = [], env = process.env) {
  const result = await runNode([cli, action, '--config', config, ...args], env);
  return { ...result, result: result.code === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : null };
}
async function until(predicate, timeout = 90000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > end) throw new Error('verification checkpoint timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function success(config, action, args) {
  const result = await invoke(config, action, args); assert.equal(result.code, 0, result.stderr); return result.result;
}
async function signIn(email) {
  return fetch(`http://${EMULATORS.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
}

test('operator CLI creates a usable backup and safely rejects damaged recovery attempts', { timeout: 240000 }, async t => {
  Object.assign(process.env, EMULATORS);
  const root = await mkdtemp(path.join(os.tmpdir(), 'store-os-backup-cli-'));
  const home = path.join(root, 'operator-home'); await mkdir(home);
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home, destination: path.join(root, 'copies'), firebase: execFileSync('/usr/bin/which', ['firebase'], { encoding: 'utf8' }).trim(), age: execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim(), notifications: false };
  validateTarget(config, true);
  const client = await connect(config); await assertEmpty(client);
  t.after(async () => { try { await reset(client, config); } finally { await client.close(); await trash(root); } });
  const configPath = path.join(root, 'config.json');
  const recoveryHome = path.join(root, 'recovery-home'); await mkdir(recoveryHome);
  const recoveryConfig = path.join(root, 'recovery-config.json');
  await json(recoveryConfig, { ...config, home: recoveryHome });
  const key = path.join(root, 'identity'); await command('age-keygen', ['-o', key]);
  const wrongKey = path.join(root, 'wrong-identity'); await command('age-keygen', ['-o', wrongKey]);
  config.recipient = execFileSync('age-keygen', ['-y', key], { encoding: 'utf8' }).trim();
  const profiles = [
    { uid: 'operator-a', email: 'operator-a@example.test', displayName: 'Operadora de prueba', emailVerified: true, password },
    { uid: 'operator-b', email: 'operator-b@example.test', emailVerified: true, password },
    { uid: 'disabled-fixture', email: 'disabled@example.test', emailVerified: true, password, disabled: true },
  ];
  for (const profile of profiles) await client.auth.createUser(profile);
  await client.auth.setCustomUserClaims('operator-a', { fixturePermission: 'operator' });
  const paginated = Array.from({ length: 1001 }, (_, i) => ({ uid: `pagination-${String(i).padStart(4, '0')}` }));
  paginated[0] = { ...paginated[0], email: 'social@example.test', providerData: [{ providerId: 'google.com', uid: 'synthetic-google', email: 'social@example.test', displayName: 'Cuenta Google sintética' }] };
  for (let i = 0; i < paginated.length; i += 1000) assert.equal((await client.auth.importUsers(paginated.slice(i, i + 1000))).failureCount, 0);
  const store = (name, uid) => ({ name, slug: name, type: 'inventory_tiered', ownerUid: uid, memberUids: [uid], pendingInvites: [], createdAt: '2026-11-03T12:00:00Z', updatedAt: '2026-11-03T12:00:00Z' });
  const records = {
    'users/operator-a': { role: 'member', email: profiles[0].email, emailVerified: true },
    'users/operator-b': { role: 'member', email: profiles[1].email, emailVerified: true },
    'stores/store-a': store('store-a', 'operator-a'),
    'adminStores/store-a': { ...store('store-a', 'operator-a'), storeId: 'store-a', retainedPrivacyRequestCount: 0 },
    'stores/store-b': store('store-b', 'operator-b'),
    'adminStores/store-b': { ...store('store-b', 'operator-b'), storeId: 'store-b', retainedPrivacyRequestCount: 0 },
    'customers/customer-a': { storeId: 'store-a', name: 'Clienta sintética' },
    'products/product-a': { storeId: 'store-a', name: 'Pieza sintética', quantityOnHand: 7, prices: { regular: 900 }, cost: 250, isPublic: false },
    'orders/sale-a': { storeId: 'store-a', customerId: 'customer-a', deposit: 700, orderStatus: 'confirmed', paymentStatus: 'partial', items: [{ lineId: 'sale-a_L0', productId: 'product-a', productName: 'Pieza sintética', quantity: 2, unitPrice: 900, subtotal: 1800, cost: 250 }] },
    'customers/customer-b': { storeId: 'store-b', name: 'Clienta sintética B' },
    'products/product-b': { storeId: 'store-b', name: 'Pieza sintética B', quantityOnHand: 4, prices: { regular: 1200 }, cost: 400, isPublic: false },
    'orders/sale-b': { storeId: 'store-b', customerId: 'customer-b', deposit: 200, orderStatus: 'confirmed', paymentStatus: 'partial', items: [{ lineId: 'sale-b_L0', productId: 'product-b', productName: 'Pieza sintética B', quantity: 1, unitPrice: 1200, subtotal: 1200, cost: 400 }] },
    'purchases/purchase-a': { storeId: 'store-a', status: 'received', total: 1250 },
    'products/product-a/evidence/note': { message: 'Descendiente sintético' },
  };
  await client.request(`${client.base}/projects/${DEV}/databases/(default)/documents:commit`, { writes: Object.entries(records).map(([name, value]) => ({ update: { name: `${client.root}/${name}`, fields: fields(value) } })) });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=', 'base64');
  const compressed = gzipSync(Buffer.from('evidencia sintética'));
  await client.bucket.file('stores/store-a/photo.png').save(image, { metadata: { contentType: 'image/png', metadata: { storeId: 'store-a' } } });
  await client.bucket.file('stores/store-a/evidence.gz').save(compressed, { metadata: { contentType: 'text/plain', contentEncoding: 'gzip', cacheControl: 'private, max-age=60' } });
  const expectedDocs = documentSnapshot(await client.documents());
  const expectedUsers = (await client.users()).map(u => sorted({ uid: u.uid, email: u.email ?? null, disabled: u.disabled, emailVerified: u.emailVerified, displayName: u.displayName ?? null, creationTime: u.metadata.creationTime, customClaims: u.customClaims ?? {}, providerData: u.providerData })).sort((a, b) => a.uid.localeCompare(b.uid));
  let archive; let unpacked;

  await t.test('test harness rejects an occupied emulator without deleting source data', async () => {
    const attempt = await runNode(['--test', fileURLToPath(new URL('./roundtrip.emulator.mjs', import.meta.url))]);
    assert.equal(attempt.code, 1); assert.match(attempt.stdout, /ERR_ASSERTION/);
    assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
    assert.equal((await client.users()).length, 1004); assert.equal((await client.files()).length, 2);
  });

  await t.test('preflight, run and verify use the real commands, including Auth pagination', async () => {
    await json(configPath, config);
    const mismatch = await invoke(configPath, 'check-key', ['--identity', wrongKey]); assert.equal(mismatch.code, 1); assert.match(mismatch.stderr, /RECOVERY_KEY_MISMATCH/);
    assert.equal((await success(configPath, 'check-key', ['--identity', key])).recoveryRecipientVerified, true);
    const report = await success(configPath, 'preflight');
    assert.equal(report.users, 1004); assert.equal(report.documents, Object.keys(records).length); assert.equal(report.objects, 2);
    Object.assign(config, { reviewedPreflightSha256: report.approvalSha256, maxDocuments: 30, maxFirestoreReads: report.firestoreReadOperations + 50, maxDailyFirestoreReads: (report.firestoreReadOperations + 50) * 3, maxStorageBytes: 10000 });
    await json(configPath, config);
    const hubFile = path.join(os.tmpdir(), `hub-${DEV}.json`); const hubBefore = await readFile(hubFile, 'utf8');
    const vaultKey = path.join(root, 'vault-identity'); await rename(key, vaultKey);
    let result; try { result = await success(configPath, 'run'); } finally { await rename(vaultKey, key); } assert.equal(result.completed, true);
    assert.equal(result.verification.restoreVerified, true); assert.equal(result.verification.sourceSnapshotVerified, true); assert.equal(result.verification.recoveryRecipientVerified, true);
    assert.equal(await readFile(hubFile, 'utf8'), hubBefore, 'automatic emulators must not alter the source hub locator');
    assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
    assert(!(await readdir(home)).some(name => name.startsWith('capture-')));
    archive = path.join(config.destination, result.archive);
    assert.deepEqual(await readdir(config.destination), [result.archive]);
    const bytes = await readFile(archive); assert(bytes.subarray(0, 50).toString().includes('age-encryption.org/v1'));
    assert(!bytes.includes(Buffer.from('Clienta sintética')));
    const state = await readJson(path.join(home, 'state.json')); assert.equal(state.sha256, await fileHash(archive));
    const verified = await success(recoveryConfig, 'verify', ['--archive', archive, '--identity', key]);
    assert.equal(verified.verified, true); assert.equal(verified.counts.users, 1004);
    unpacked = path.join(root, 'unpacked'); await decryptArchive(archive, unpacked, key, config.age);
    await reset(client, config); await assertEmpty(client);
  });
  if (!archive || !unpacked) return;

  await t.test('killing run during actual decryption cleans private material and preserves the last backup', { timeout: 120000 }, async () => {
    await success(recoveryConfig, 'restore', ['--archive', archive, '--identity', key]);
    const before = await readJson(path.join(home, 'state.json'));
    await json(path.join(home, 'state.json'), { ...before, lastScheduledDate: '2000-01-01' });
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [cli, 'run', '--config', configPath], { env, stdio: 'ignore' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    let scratch;
    try {
      await until(async () => {
        if (child.exitCode !== null) throw new Error('backup finished before crash checkpoint');
        for (const entry of await readdir(home)) {
          if (entry.startsWith('capture-')) {
            const candidate = path.join(home, entry);
            if (await exists(path.join(candidate, 'verification/emulators/payload/firestore.json'))) { scratch = candidate; return true; }
          }
        }
        return false;
      });
      child.kill('SIGKILL'); await exited;
      await until(async () => !await exists(scratch), 15000);
      const after = await readJson(path.join(home, 'state.json'));
      assert.equal(after.lastSuccess, before.lastSuccess); assert.deepEqual(after.verification, before.verification);
      assert.deepEqual(await readdir(config.destination), [before.lastArchive]);
      assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
      assert.equal((await client.users()).length, 1004); assert.equal((await client.files()).length, 2);
    } finally { child.kill('SIGKILL'); await exited; }
  });

  await t.test('failed automatic restoration never publishes or replaces the last verified backup', async () => {
    const before = await readJson(path.join(home, 'state.json'));
    // Force a due cycle without changing its previous successful proof.
    const originalSource = await readJson(path.join(unpacked, 'firestore.json'));
    await client.request(`${client.base}/projects/${DEV}/databases/(default)/documents:commit`, { writes: originalSource.map(doc => ({ update: { name: `${client.root}/${doc.path}`, fields: doc.fields } })) });
    await json(path.join(home, 'state.json'), { ...before, lastScheduledDate: '2000-01-01' });
    const blocker = createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(18080, '127.0.0.1', resolve); });
    try {
      const attempt = await invoke(configPath, 'run'); assert.equal(attempt.code, 1);
    } finally { await new Promise(resolve => blocker.close(resolve)); }
    const after = await readJson(path.join(home, 'state.json'));
    assert.equal(after.lastScheduledDate, '2000-01-01'); assert.equal(after.lastSuccess, before.lastSuccess); assert.equal(after.lastArchive, before.lastArchive);
    assert.deepEqual(after.verification, before.verification); assert.deepEqual(after.ownedArchives, before.ownedArchives);
    assert.deepEqual(await readdir(config.destination), [before.lastArchive]);
    assert(!(await readdir(home)).some(name => name.startsWith('capture-')));
    assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
    await reset(client, config); await assertEmpty(client);
  });

  await t.test('wrong key and truncated ciphertext reject recovery without creating data', async () => {
    const wrong = await invoke(recoveryConfig, 'restore', ['--archive', archive, '--identity', wrongKey]);
    assert.equal(wrong.code, 1); await assertEmpty(client);
    const truncated = path.join(root, 'truncated.age'); const bytes = await readFile(archive); await writeFile(truncated, bytes.subarray(0, bytes.length - 20));
    const damaged = await invoke(recoveryConfig, 'restore', ['--archive', truncated, '--identity', key]);
    assert.equal(damaged.code, 1); await assertEmpty(client);
  });

  await t.test('altered business data inside a decryptable archive fails integrity before writes', async () => {
    const file = path.join(unpacked, 'firestore.json'); const original = await readFile(file, 'utf8');
    const modified = original.replace('"integerValue": "900"', '"integerValue": "901"'); assert.notEqual(modified, original);
    await writeFile(file, modified);
    const damaged = path.join(root, 'tampered.age'); await encryptDirectory(unpacked, damaged, config.recipient, config.age);
    const result = await invoke(recoveryConfig, 'restore', ['--archive', damaged, '--identity', key]);
    assert.equal(result.code, 1); assert.match(result.stderr, /INTEGRITY_FAILED/); await assertEmpty(client);
    await writeFile(file, original);
  });

  await t.test('restored accounts, store isolation, balances, inventory and object bytes match the source', async () => {
    const result = await success(recoveryConfig, 'restore', ['--archive', archive, '--identity', key]); assert.equal(result.verified, true);
    assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
    const actualUsers = (await client.users()).map(u => sorted({ uid: u.uid, email: u.email ?? null, disabled: u.disabled, emailVerified: u.emailVerified, displayName: u.displayName ?? null, creationTime: u.metadata.creationTime, customClaims: u.customClaims ?? {}, providerData: u.providerData })).sort((a, b) => a.uid.localeCompare(b.uid));
    assert.deepEqual(actualUsers, expectedUsers);
    // Golden fixture values and direct GETs are independent of the backup enumerator.
    const recovered = new Map();
    for (const [name, expected] of Object.entries(records)) {
      const response = await fetch(`${client.base}/${client.root}/${name}`, { headers: { Authorization: 'Bearer owner' } });
      assert.equal(response.status, 200); const actual = decodeFields((await response.json()).fields ?? {}); assert.deepEqual(actual, expected); recovered.set(name, actual);
    }
    const authByUid = new Map();
    const seededAccounts = [...profiles, ...paginated];
    for (let i = 0; i < seededAccounts.length; i += 100) {
      const batch = await client.auth.getUsers(seededAccounts.slice(i, i + 100).map(u => ({ uid: u.uid })));
      assert.equal(batch.notFound.length, 0);
      for (const user of batch.users) authByUid.set(user.uid, user);
    }
    assert.equal(authByUid.size, 1004);
    for (const profile of profiles) {
      const actual = authByUid.get(profile.uid);
      assert.equal(actual.email, profile.email); assert.equal(actual.emailVerified, profile.emailVerified);
      assert.equal(actual.disabled, Boolean(profile.disabled)); assert.equal(actual.displayName ?? null, profile.displayName ?? null);
      assert(actual.providerData.some(p => p.providerId === 'password' && p.uid === profile.email));
    }
    assert.deepEqual(authByUid.get('operator-a').customClaims, { fixturePermission: 'operator' });
    for (const profile of paginated) {
      const actual = authByUid.get(profile.uid); assert(actual); assert.equal(actual.disabled, false);
      assert.equal(actual.email, profile.email);
      assert.deepEqual(actual.providerData.map(p => ({ providerId: p.providerId, uid: p.uid, email: p.email, displayName: p.displayName })), profile.providerData ?? []);
    }
    for (const [index, own, other] of [[0, 'a', 'b'], [1, 'b', 'a']]) {
      const login = await signIn(profiles[index].email); assert.equal(login.status, 200); const token = (await login.json()).idToken;
      for (const [collection, id] of [['stores', 'store'], ['adminStores', 'store'], ['products', 'product'], ['customers', 'customer'], ['orders', 'sale']]) {
        const headers = { Authorization: `Bearer ${token}` };
        const allowed = await fetch(`${client.base}/${client.root}/${collection}/${id}-${own}`, { headers }); assert.equal(allowed.status, 200, `${collection}: own store must remain accessible`);
        const denied = await fetch(`${client.base}/${client.root}/${collection}/${id}-${other}`, { headers }); assert.equal(denied.status, 403, `${collection}: other store must remain private`);
      }
    }
    const disabled = await signIn(profiles[2].email); assert.equal(disabled.status, 400); assert.match((await disabled.json()).error.message, /USER_DISABLED/);
    const sale = recovered.get('orders/sale-a'); assert.equal(sale.items[0].subtotal - sale.deposit, 1100);
    const product = (await client.documents()).find(d => d.path === 'products/product-a'); assert.equal(product.fields.quantityOnHand.integerValue, '7');
    assert.deepEqual((await client.bucket.file('stores/store-a/photo.png').download({ decompress: false }))[0], image);
    assert.deepEqual((await client.bucket.file('stores/store-a/evidence.gz').download({ decompress: false }))[0], compressed);
    assert.equal(result.authPasswordLoginVerified, false, 'synthetic login must not certify production SCRYPT');
  });

  await t.test('restore refuses an occupied destination and leaves the recovered data intact', async () => {
    const result = await invoke(recoveryConfig, 'restore', ['--archive', archive, '--identity', key]);
    assert.equal(result.code, 1); assert.match(result.stderr, /EMULATORS_NOT_EMPTY/);
    assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
    assert.equal((await client.users()).length, 1004); assert.equal((await client.files()).length, 2);
    assert(!(await readdir(recoveryHome)).some(name => name.startsWith('capture-') || name === 'run.lock'));
  });
  await t.test('production-shaped password material is restored and checked without production access', async () => {
    const fixture = path.join(root, 'synthetic-scrypt'); await cp(unpacked, fixture, { recursive: true });
    const users = await readJson(path.join(fixture, 'auth.json'));
    for (const user of users) if (user.passwordHash) { user.passwordHash = Buffer.alloc(64, 7).toString('base64'); user.passwordSalt = Buffer.alloc(16, 9).toString('base64'); }
    await json(path.join(fixture, 'auth.json'), users);
    await json(path.join(fixture, 'auth-config.json'), { hashConfig: { algorithm: 'SCRYPT', signerKey: Buffer.alloc(64, 3).toString('base64'), saltSeparator: Buffer.alloc(4, 2).toString('base64'), rounds: 8, memoryCost: 14 } });
    const prior = await readJson(path.join(fixture, 'manifest.json')); await trash(path.join(fixture, 'manifest.json'));
    await manifest(fixture, { projectId: PROD, bucket: `${PROD}.firebasestorage.app`, counts: prior.counts });
    const candidate = path.join(root, 'synthetic-scrypt.age'); await encryptDirectory(fixture, candidate, config.recipient, config.age);
    const result = await success(recoveryConfig, 'verify', ['--archive', candidate, '--identity', key]);
    assert.equal(result.verification.restoreVerified, true); assert.equal(result.verification.sourceProjectId, PROD);
    assert.equal(result.verification.authPasswordHashesVerified, true); assert.equal(result.verification.authPasswordLoginVerified, false);
    assert.deepEqual(documentSnapshot(await client.documents()), expectedDocs);
  });

});

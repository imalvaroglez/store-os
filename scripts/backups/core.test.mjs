import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { acquireLock, backupTime, command, decryptArchive, encryptDirectory, fileHash, isDue, json, manifest, prune, publish, retention, sha256, verifyDirectory, DEFAULT_DESTINATION } from './core.mjs';
import { DEV, PROD } from './core.mjs';
import { capture, remapFields, validateTarget, validateUsers, EMULATORS } from './cloud.mjs';
import { launchAgent } from './install.mjs';
import { parseArgs, preflight, runBackup, safeCode } from './cli.mjs';

async function workspace(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'store-os-backup-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const name = date => `backup-${date.toISOString().replace(/[:.]/g, '-')}.tar.gz.age`;
test('schedule follows Mexico City 21:00 across sleep, restart and timezone changes', () => {
  assert.equal(isDue(new Date('2026-11-04T02:59:00Z'), '2026-11-03T03:00:00Z'), false);
  assert.equal(isDue(new Date('2026-11-04T03:00:00Z'), '2026-11-03T03:00:00Z'), true);
  assert.equal(isDue(new Date('2026-11-05T15:00:00Z'), '2026-11-03T03:00:00Z'), true);
  assert.equal(isDue(new Date('2026-11-04T15:00:00Z'), '2026-11-04T03:15:00Z'), false);
});
test('retains last daily and weekly full copies, ignores unrelated files and duplicate same-day runs', () => {
  const names = Array.from({ length: 110 }, (_, i) => name(new Date(Date.UTC(2026, 10, 3 - i, 4))));
  const { keep, remove } = retention([...names, 'personal.txt', 'backup-bad.tar.gz.age', `${names[0]}.partial`]);
  assert(keep.length >= 30 && keep.length <= 42);
  assert.equal(new Set(keep.map(n => new Date(backupTime(n)).toISOString().slice(0, 10))).size, keep.length);
  assert(names.slice(0, 30).every(n => keep.includes(n)));
  assert(remove.length > 60); assert(!remove.includes('personal.txt'));
  assert.equal(new Date(backupTime(names[0])).toISOString(), '2026-11-03T04:00:00.000Z');
});
test('production and restore target guards reject all mixed or remote emulator configurations', () => {
  const prod = { projectId: PROD, bucket: `${PROD}.firebasestorage.app`, credentials: '/tmp/key', productionReadApproved: true };
  assert.doesNotThrow(() => validateTarget(prod, false, {}));
  assert.throws(() => validateTarget(prod, true, {}));
  assert.throws(() => validateTarget(prod, false, EMULATORS));
  assert.throws(() => validateTarget({ ...prod, bucket: `${DEV}.firebasestorage.app` }, false, {}));
  assert.throws(() => validateTarget({ ...prod, productionReadApproved: false }, false, {}));
  const dev = { projectId: DEV, bucket: `${DEV}.firebasestorage.app` };
  assert.doesNotThrow(() => validateTarget(dev, true, EMULATORS));
  assert.throws(() => validateTarget(dev, true, { ...EMULATORS, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }));
  assert.throws(() => validateTarget(dev, true, {}));
});
test('Firestore raw types survive reference remapping without converting int64, double or timestamp', () => {
  const fields = { n: { integerValue: '9223372036854775807' }, f: { doubleValue: 'NaN' }, t: { timestampValue: '2026-11-03T00:00:00.123456789Z' }, map: { mapValue: { fields: { a: { arrayValue: { values: [{ referenceValue: `projects/${PROD}/databases/(default)/documents/stores/a` }] } } } } } };
  const mapped = remapFields(fields, PROD, DEV);
  assert.deepEqual(mapped.n, fields.n); assert.deepEqual(mapped.t, fields.t); assert.deepEqual(mapped.f, fields.f);
  assert.equal(mapped.map.mapValue.fields.a.arrayValue.values[0].referenceValue, `projects/${DEV}/databases/(default)/documents/stores/a`);
  assert.equal(remapFields({ r: { referenceValue: `projects/${PROD}/databases/archive/documents/a/b` } }, PROD, DEV).r.referenceValue, `projects/${PROD}/databases/archive/documents/a/b`);
});
test('password accounts require hashes, and duplicate UIDs fail', () => {
  assert.throws(() => validateUsers([{ uid: 'a', providerData: [{ providerId: 'password' }] }]));
  assert.doesNotThrow(() => validateUsers([{ uid: 'a', passwordHash: 'abc', providerData: [{ providerId: 'password' }] }]));
  assert.throws(() => validateUsers([{ uid: 'a' }, { uid: 'a' }]));
});
test('manifest detects modified, missing, extra and linked files', async t => {
  const dir = await workspace(t); await json(path.join(dir, 'auth.json'), []);
  await manifest(dir, { projectId: DEV }); await verifyDirectory(dir);
  await writeFile(path.join(dir, 'auth.json'), 'tampered'); await assert.rejects(verifyDirectory(dir), /INTEGRITY/);
  await json(path.join(dir, 'auth.json'), []); await writeFile(path.join(dir, 'extra'), 'x'); await assert.rejects(verifyDirectory(dir), /FILE_SET/);
});
test('real age roundtrip verifies integrity and rejects wrong key or truncated ciphertext', async t => {
  const dir = await workspace(t); const data = path.join(dir, 'data'); await mkdir(data);
  await json(path.join(data, 'firestore.json'), [{ path: 'a/b', fields: {} }]);
  await mkdir(path.join(data, 'objects')); await writeFile(path.join(data, 'objects', 'a'.repeat(64)), 'photo');
  await manifest(data, { projectId: DEV, counts: { documents: 1 } });
  const key = path.join(dir, 'identity'); await command('age-keygen', ['-o', key]);
  const recipient = execFileSync('age-keygen', ['-y', key], { encoding: 'utf8' }).trim();
  const output = path.join(dir, 'backup.age'); await encryptDirectory(data, output, recipient);
  assert(!(await readFile(output)).includes(Buffer.from('firestore')));
  assert.equal((await decryptArchive(output, path.join(dir, 'restored'), key)).counts.documents, 1);
  const wrong = path.join(dir, 'wrong'); await command('age-keygen', ['-o', wrong]);
  await assert.rejects(decryptArchive(output, path.join(dir, 'wrong-out'), wrong));
  await writeFile(output, (await readFile(output)).subarray(0, 100));
  await assert.rejects(decryptArchive(output, path.join(dir, 'truncated'), key));
});
test('publish and retention never expose plaintext or remove unowned files', async t => {
  const dir = await workspace(t); const source = path.join(dir, 'source'); const dest = path.join(dir, 'cloud');
  await writeFile(source, 'encrypted'); const archive = name(new Date('2026-11-04T03:00:00Z'));
  await publish(source, dest, archive); assert.equal(await fileHash(source), await fileHash(path.join(dest, archive)));
  const unowned = name(new Date('2020-01-01T03:00:00Z')); await writeFile(path.join(dest, unowned), 'unowned');
  await prune(dest, [archive]); assert((await readdir(dest)).includes(unowned));
  await assert.rejects(publish(source, '/dev/null/no', archive)); assert((await readdir(dest)).includes(archive));
});
test('lock rejects concurrent runs; release permits subsequent execution', async t => {
  const dir = await workspace(t); const release = await acquireLock(dir);
  await assert.rejects(acquireLock(dir), /LOCKED/); await release(); await (await acquireLock(dir))();
});
test('launchd uses stable absolute paths with catch-up and interval checks', () => {
  const plist = launchAgent('/opt/node', '/data/runtime/cli.mjs', '/data/A & B/config.json');
  assert(plist.includes('RunAtLoad')); assert(plist.includes('StartCalendarInterval')); assert(plist.includes('StartInterval'));
  assert(plist.includes('/data/A &amp; B/config.json')); assert(plist.includes('America/Mexico_City'));
  assert(DEFAULT_DESTINATION.endsWith('/Olivia/cio/backups'));
});
test('CLI rejects unknown options and sanitizes personal error text', () => {
  assert.throws(() => parseArgs(['run', '--prod'])); assert.throws(() => parseArgs(['restore', '--config']));
  assert.equal(safeCode(new Error('secret@example.com')), 'BACKUP_FAILED');
  assert.equal(safeCode(new Error('CLOUD_HTTP_403')), 'CLOUD_HTTP_403');
});
test('failed capture preserves last successful backup, cleans staging and releases lock', async t => {
  const dir = await workspace(t); const home = path.join(dir, 'home'); await mkdir(home); const destination = path.join(dir, 'icloud'); await mkdir(destination);
  const last = { lastSuccess: '2026-11-01T03:00:00Z', ownedArchives: ['prior.age'] }; await json(path.join(home, 'state.json'), last);
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home, destination, notifications: false, recipient: 'test', age: execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim() };
  const fake = { settings: async () => ({}), documents: async () => [], users: async () => [], authConfig: async () => ({ hashConfig: {} }), files: async () => [] };
  await preflight(config, fake); config.reviewedPreflightSha256 = await fileHash(path.join(home, 'preflight.json')); config.maxDocuments = 10; config.maxStorageBytes = 100; config.maxFirestoreReads = 100; config.maxDailyFirestoreReads = 200;
  const original = Object.fromEntries(Object.keys(EMULATORS).map(k => [k, process.env[k]])); Object.assign(process.env, EMULATORS);
  try { await assert.rejects(runBackup(config, async () => ({ ...fake, documents: async () => { throw new Error('private account'); }, close: async () => {} })), /private account/); }
  finally { for (const [k, v] of Object.entries(original)) v === undefined ? delete process.env[k] : process.env[k] = v; }
  const after = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
  assert.equal(after.lastSuccess, last.lastSuccess); assert.deepEqual(after.ownedArchives, last.ownedArchives); assert.equal(after.lastError, 'BACKUP_FAILED');
  assert(!(await readdir(home)).some(n => n.startsWith('capture-') || n === 'run.lock'));
});

test('a killed process cannot leave a lock that blocks the next scheduled backup', async t => {
  const dir = await workspace(t);
  const module = new URL('./core.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireLock } from ${JSON.stringify(module)}; await acquireLock(${JSON.stringify(dir)}); console.log('ready');`], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('child did not acquire lock'))); });
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  await (await acquireLock(dir))();
});

test('budget failures suspend repeated scans; transient retries are bounded per day', async t => {
  const dir = await workspace(t); const home = path.join(dir, 'home'); await mkdir(home);
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home, destination: path.join(dir, 'cloud'), recipient: 'fixture', age: execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim(), notifications: false, maxDocuments: 0, maxStorageBytes: 0, maxFirestoreReads: 10, maxDailyFirestoreReads: 20 };
  const fake = { settings: async () => ({}), documents: async () => [], users: async () => [], authConfig: async () => ({ hashConfig: {} }), files: async () => [], close: async () => {} };
  await preflight(config, fake); config.reviewedPreflightSha256 = await fileHash(path.join(home, 'preflight.json'));
  const original = Object.fromEntries(Object.keys(EMULATORS).map(k => [k, process.env[k]])); Object.assign(process.env, EMULATORS);
  try {
    let attempts = 0;
    const failing = async () => { attempts++; return { ...fake, documents: async () => { throw new Error('FIRESTORE_READ_LIMIT_EXCEEDED'); } }; };
    await assert.rejects(runBackup(config, failing), /READ_LIMIT/);
    assert.equal((await runBackup(config, failing)).suspended, true); assert.equal(attempts, 1);
    await json(path.join(home, 'state.json'), { ownedArchives: [] });
    const transient = async () => { attempts++; return { ...fake, documents: async () => { throw new Error('CLOUD_HTTP_503'); } }; };
    await assert.rejects(runBackup(config, transient), /503/); await assert.rejects(runBackup(config, transient), /503/);
    assert.equal((await runBackup(config, transient)).dailyBudgetExhausted, true); assert.equal(attempts, 3);
    assert.equal(JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8')).reservedReads, 20);
  } finally { for (const [k, v] of Object.entries(original)) v === undefined ? delete process.env[k] : process.env[k] = v; }
});

test('reference remapping preserves empty Firestore maps and arrays exactly', () => {
  const fields = { pendingInvites: { arrayValue: {} }, options: { mapValue: {} }, nested: { mapValue: { fields: { empty: { arrayValue: {} } } } }, list: { arrayValue: { values: [{ mapValue: {} }] } } };
  assert.deepEqual(remapFields(fields, PROD, DEV), fields);
});

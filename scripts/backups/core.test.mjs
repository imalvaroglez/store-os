import { trash } from './trash.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import childProcess, { execFileSync, spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { acquireLock, backupTime, command, decryptArchive, encryptDirectory, fileHash, isDue, dueDate, privateDirectory, json, manifest, prune, publish, retention, sha256, verifyDirectory, exists, DEFAULT_DESTINATION } from './core.mjs';
import { DEV, PROD } from './core.mjs';
import { capture, restore, remapFields, validateTarget, validateUsers, EMULATORS } from './cloud.mjs';
import { startSupervisor, stopSupervisor, supervisedCommand, cleanupStaleWorkspaces } from './supervisor.mjs';
import { launchAgent } from './install.mjs';
import { checkRecoveryIdentity, hasVerifiedBackup, recoveryKeyProof, verificationEnvironment, verifyCandidate } from './verification.mjs';
import { parseArgs, preflight, runBackup, safeCode } from './cli.mjs';

async function workspace(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'store-os-backup-test-')); t.after(() => trash(dir)); return dir; }
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
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home, destination, notifications: false, recipient: 'test', firebase: process.execPath, age: execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim() };
  const fake = { settings: async () => ({}), documents: async () => [], users: async () => [], authConfig: async () => ({ hashConfig: {} }), files: async () => [] };
  const recoveryKey = path.join(dir, 'recovery-key'); await command('age-keygen', ['-o', recoveryKey]); config.recipient = execFileSync('age-keygen', ['-y', recoveryKey], { encoding: 'utf8' }).trim(); await checkRecoveryIdentity(config, recoveryKey);
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
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home, destination: path.join(dir, 'cloud'), recipient: 'fixture', firebase: process.execPath, age: execFileSync('/usr/bin/which', ['age'], { encoding: 'utf8' }).trim(), notifications: false, maxDocuments: 0, maxStorageBytes: 0, maxFirestoreReads: 10, maxDailyFirestoreReads: 20 };
  const fake = { settings: async () => ({}), documents: async () => [], users: async () => [], authConfig: async () => ({ hashConfig: {} }), files: async () => [], close: async () => {} };
  const recoveryKey = path.join(dir, 'recovery-key'); await command('age-keygen', ['-o', recoveryKey]); config.recipient = execFileSync('age-keygen', ['-y', recoveryKey], { encoding: 'utf8' }).trim(); await checkRecoveryIdentity(config, recoveryKey);
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

test('a failed candidate check cannot publish a final archive or remove the previous copy', async t => {
  const dir = await workspace(t); const source = path.join(dir, 'encrypted'); const destination = path.join(dir, 'copies');
  await writeFile(source, 'ciphertext'); await mkdir(destination);
  const prior = name(new Date('2026-11-01T03:00:00Z')); const next = name(new Date('2026-11-02T03:00:00Z'));
  await writeFile(path.join(destination, prior), 'previous');
  await assert.rejects(publish(source, destination, next, async () => { throw new Error('VERIFICATION_FAILED'); }), /VERIFICATION_FAILED/);
  assert.deepEqual(await readdir(destination), [prior]);
});
test('an old success without an actual restore proof is not a verified backup', () => {
  assert.equal(hasVerifiedBackup({ lastSuccess: new Date().toISOString(), lastArchive: 'legacy.age', sha256: 'hash' }), false);
});
test('verification subprocesses cannot inherit source endpoints or credentials', () => {
  const env = verificationEnvironment({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GOOGLE_APPLICATION_CREDENTIALS: '/private/source.json', FIREBASE_TOKEN: 'secret', NODE_TEST_CONTEXT: 'child-v8' });
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined); assert.equal(env.FIRESTORE_EMULATOR_HOST, undefined);
  assert.equal(env.FIREBASE_TOKEN, undefined); assert.equal(env.NODE_TEST_CONTEXT, undefined); assert.equal(env.GCLOUD_PROJECT, DEV);
});
test('automatic verification requires a previously checked recovery recipient', async t => {
  const dir = await workspace(t); const config = { projectId: DEV, home: dir, recipient: 'unapproved' };
  await assert.rejects(recoveryKeyProof(config), /RECOVERY_KEY_CHECK_REQUIRED/);
});

test('a verifier process exiting successfully without a restore receipt is rejected', async t => {
  const dir = await workspace(t); const archive = path.join(dir, 'candidate.age'); await writeFile(archive, 'not a backup');
  const noop = path.join(dir, 'noop-verifier'); await writeFile(noop, '#!/bin/sh\nexit 0\n'); await chmod(noop, 0o700);
  const work = path.join(dir, 'work'); await mkdir(work); const session = await startSupervisor(work);
  try { await assert.rejects(verifyCandidate({ firebase: noop, age: 'age' }, archive, '/unused/identity', path.join(work, 'verify'), undefined, session), /VERIFICATION_RECEIPT_REQUIRED/); } finally { await stopSupervisor(session); }
});

async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > end) throw new Error('condition timed out'); await new Promise(resolve => setTimeout(resolve, 50)); }
}
function isRunning(pid) {
  try { const state = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return Boolean(state && !state.startsWith('Z')); } catch { return false; }
}
test('supervision survives parent SIGKILL, kills detached descendants and removes private workspace', { timeout: 15000 }, async t => {
  const dir = await workspace(t); const root = path.join(dir, 'capture-job'); await mkdir(root);
  const pids = path.join(dir, 'owned-pids.json'); const launcher = path.join(dir, 'launcher.mjs');
  await writeFile(launcher, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid])); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  const module = new URL('./supervisor.mjs', import.meta.url).href;
  const code = `import { startSupervisor, supervisedCommand } from ${JSON.stringify(module)}; import { writeFile } from 'node:fs/promises'; const s = await startSupervisor(${JSON.stringify(root)}); await writeFile(${JSON.stringify(path.join(root, 'temporary-private-key'))}, 'private fixture'); await supervisedCommand(s, process.execPath, [${JSON.stringify(launcher)}], { cwd: ${JSON.stringify(root)}, env: process.env });`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore' });
  let owned = [];
  t.after(() => { parent.kill('SIGKILL'); for (const pid of owned) if (isRunning(pid)) try { process.kill(pid, 'SIGKILL'); } catch {} });
  await until(() => exists(pids)); owned = JSON.parse(await readFile(pids, 'utf8'));
  const exited = new Promise(resolve => parent.once('exit', resolve)); parent.kill('SIGKILL'); await exited;
  await until(async () => !await exists(root) && owned.every(pid => !isRunning(pid)));
});
test('supervision owns a detached child after its launcher exits between scans', { timeout: 12000 }, async t => {
  const dir = await workspace(t); const root = path.join(dir, 'capture-orphan'); await mkdir(root);
  const pidFile = path.join(dir, 'pid'); const launcher = path.join(dir, 'launcher.mjs');
  await writeFile(launcher, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); child.unref();`);
  const session = await startSupervisor(root);
  let pid;
  try { await supervisedCommand(session, process.execPath, [launcher], { cwd: root, env: process.env }); pid = Number(await readFile(pidFile, 'utf8')); assert.equal(isRunning(pid), false); }
  finally { await stopSupervisor(session); if (pid && isRunning(pid)) process.kill(pid, 'SIGKILL'); }
});
test('interrupted pending copy and private workspace are moved to Trash', { timeout: 12000 }, async t => {
  const dir = await workspace(t); const root = path.join(dir, 'capture-cleanup'); await mkdir(root);
  const candidate = path.join(dir, `${name(new Date())}.partial`); await mkdir(candidate);
  const session = await startSupervisor(root, 180000, dir);
  await json(path.join(root, 'pending-publication.json'), { candidate });
  await writeFile(path.join(root, 'secret'), 'fixture'); session.child.kill('SIGTERM');
  await assert.rejects(stopSupervisor(session), /VERIFICATION_CLEANUP_FAILED/);
  assert.equal(await exists(root), false); assert.equal(await exists(candidate), false);
});
test('a hung verifier is forcibly terminated within the supervised deadline', { timeout: 12000 }, async t => {
  const dir = await workspace(t); const root = path.join(dir, 'capture-job'); await mkdir(root);
  const session = await startSupervisor(root, 1000);
  try {
    await assert.rejects(supervisedCommand(session, process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { cwd: root, env: process.env }), /VERIFICATION_TIMEOUT/);
  } finally { await stopSupervisor(session); }
  assert.equal(await exists(root), false);
});
test('a cleanup failure cannot publish a backup and private scratch is removed before final naming', async t => {
  const dir = await workspace(t); const root = path.join(dir, 'private'); await mkdir(root);
  const encrypted = path.join(root, 'encrypted'); await writeFile(encrypted, 'ciphertext');
  const destination = path.join(dir, 'copies'); const archive = name(new Date());
  await assert.rejects(publish(encrypted, destination, archive, async () => { throw new Error('VERIFICATION_CLEANUP_FAILED'); }), /VERIFICATION_CLEANUP_FAILED/);
  assert.deepEqual(await readdir(destination), []);
  await publish(encrypted, destination, archive, async () => { assert.equal(await exists(path.join(destination, archive)), false); await trash(root); return { verified: true }; });
  assert.equal(await exists(root), false); assert.equal((await readFile(path.join(destination, archive), 'utf8')), 'ciphertext');
});
test('stale private scratch is cleaned without requiring a working runtime or preflight', async t => {
  const dir = await workspace(t); const stale = path.join(dir, 'capture-stale'); await mkdir(stale); await writeFile(path.join(stale, 'private-key'), 'fixture');
  await cleanupStaleWorkspaces(dir); assert.equal(await exists(stale), false);
});
test('restoration rejects lost MFA enrollments even when counts and other profile data match', async t => {
  const dir = await workspace(t);
  const user = { uid: 'mfa-fixture', email: 'mfa@example.test', providerData: [], multiFactor: { enrolledFactors: [{ uid: 'factor-fixture', factorId: 'phone', phoneNumber: '+15555550100', enrollmentTime: '2026-11-03T12:00:00Z' }] } };
  await json(path.join(dir, 'firestore.json'), []); await json(path.join(dir, 'storage.json'), []); await json(path.join(dir, 'auth.json'), [user]);
  await json(path.join(dir, 'auth-config.json'), { hashConfig: { algorithm: 'SCRYPT', signerKey: 'AQID', rounds: 8, memoryCost: 14 } });
  let imported = false;
  const fake = { documents: async () => [], files: async () => [], users: async () => imported ? [{ ...user, multiFactor: { enrolledFactors: [] } }] : [], auth: { importUsers: async () => { imported = true; return { failureCount: 0 }; } } };
  const saved = Object.fromEntries(Object.keys(EMULATORS).map(k => [k, process.env[k]])); Object.assign(process.env, EMULATORS);
  try { await assert.rejects(restore(fake, { projectId: DEV, bucket: `${DEV}.firebasestorage.app` }, dir, { projectId: PROD, counts: { documents: 0, users: 1, objects: 0 } }), /AUTH_MFA_VERIFY_FAILED/); }
  finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v; }
});

test('startup without capture workspaces does not inspect processes', async t => {
  const dir = await workspace(t); await writeFile(path.join(dir, 'config.json'), '{}');
  const original = childProcess.execFileSync;
  childProcess.execFileSync = () => { throw new Error('UNEXPECTED_PROCESS_INSPECTION'); };
  syncBuiltinESMExports();
  try { await cleanupStaleWorkspaces(dir); }
  finally { childProcess.execFileSync = original; syncBuiltinESMExports(); }
});
test('timed-out process inspection reports a safe code and preserves unclassified workspaces', async t => {
  const dir = await workspace(t); const capture = path.join(dir, 'capture-unclassified'); await mkdir(capture);
  const original = childProcess.execFileSync;
  childProcess.execFileSync = () => { throw Object.assign(new Error('private fixture details'), { code: 'ETIMEDOUT' }); };
  syncBuiltinESMExports();
  try { await assert.rejects(cleanupStaleWorkspaces(dir), { message: 'PROCESS_INSPECTION_TIMEOUT' }); assert.equal(await exists(capture), true); }
  finally { childProcess.execFileSync = original; syncBuiltinESMExports(); }
});

test('manual backup flag is exclusive to run and rejects duplicate flags', () => {
  assert.deepEqual(parseArgs(['run', '--manual']), { action: 'run', manual: true });
  assert.equal(parseArgs(['run', '--config', '/private/config.json', '--manual']).manual, true);
  for (const args of [['status', '--manual'], ['run', '--manual', '--manual'], ['run', '--manual', 'true']]) assert.throws(() => parseArgs(args), /USAGE/);
});
test('manual copy bypasses only the completed-cycle gate and still requires recovery proof', async t => {
  const originalEnv = Object.fromEntries(Object.keys(EMULATORS).map(k => [k, process.env[k]])); Object.assign(process.env, EMULATORS);
  t.after(() => { for (const [k, v] of Object.entries(originalEnv)) v === undefined ? delete process.env[k] : process.env[k] = v; });
  const dir = await workspace(t);
  const state = {
    lastSuccess: '2026-11-06T03:02:00Z', lastScheduledDate: '2026-11-05', lastArchive: 'backup.age', sha256: 'hash',
    verification: { version: 1, restoreVerified: true, encryptedArchiveVerified: true, sourceSnapshotVerified: true, recoveryRecipientVerified: true, archive: 'backup.age', archiveSha256: 'hash', verifiedAt: '2026-11-06T03:02:00Z' },
  };
  await json(path.join(dir, 'state.json'), state);
  const config = { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, home: dir, notifications: false };
  const now = new Date('2026-11-06T20:00:00Z');
  assert.deepEqual(await runBackup(config, async () => { throw new Error('CLOUD_MUST_NOT_OPEN'); }, now), { skipped: true });
  await assert.rejects(runBackup(config, async () => { throw new Error('CLOUD_MUST_NOT_OPEN'); }, now, { manual: true }), /RECOVERY_KEY_CHECK_REQUIRED/);
  const after = await readFile(path.join(dir, 'state.json'), 'utf8');
  assert.equal(JSON.parse(after).lastScheduledDate, '2026-11-05');
  // A successful manual copy later in the day cannot consume tonight's slot.
  await json(path.join(dir, 'state.json'), { ...state, lastSuccess: '2026-11-06T21:00:00Z', lastRunKind: 'manual' });
  await assert.rejects(runBackup(config, undefined, new Date('2026-11-07T03:00:00Z')), /RECOVERY_KEY_CHECK_REQUIRED/);
  // First-ever manual success has no historical scheduled checkpoint.
  await json(path.join(dir, 'state.json'), { ...state, lastScheduledDate: null, lastRunKind: 'manual' });
  await assert.rejects(runBackup(config, undefined, now), /RECOVERY_KEY_CHECK_REQUIRED/);
});

test('first manual run fails closed so an older installed scheduler cannot lose its nightly slot', async t => {
  const dir = await workspace(t);
  let connected = false;
  await assert.rejects(runBackup({ home: dir, notifications: false }, async () => { connected = true; }, new Date('2026-11-07T03:15:00Z'), { manual: true }), /INITIAL_SCHEDULE_REQUIRED/);
  assert.equal(connected, false);
  // With an existing checkpoint, even the OLD runtime's predicate schedules tonight.
  const state = { lastSuccess: '2026-11-07T03:05:00Z', lastScheduledDate: '2026-11-05' };
  const now = new Date('2026-11-07T03:15:00Z');
  const oldRuntimeSkips = state.lastScheduledDate ? dueDate(now) <= state.lastScheduledDate : !isDue(now, state.lastSuccess);
  assert.equal(oldRuntimeSkips, false);
});

test('secure existing directories need no chmod; insecure directories still fail closed', async t => {
  const dir = await workspace(t);
  const original = fsPromises.chmod;
  await original(dir, 0o700);
  let calls = 0;
  fsPromises.chmod = async () => { calls++; const error = new Error('fixture chmod denied'); error.code = 'EPERM'; throw error; };
  syncBuiltinESMExports();
  try {
    await privateDirectory(dir);
    assert.equal(calls, 0);
    await original(dir, 0o755);
    await assert.rejects(privateDirectory(dir), { code: 'EPERM' });
    assert.equal(calls, 1);
  } finally { fsPromises.chmod = original; syncBuiltinESMExports(); await original(dir, 0o700); }
});

test('retention uses its owned ledger without requiring directory enumeration', async t => {
  const dir = await workspace(t);
  const early = name(new Date('2026-11-06T18:00:00Z'));
  const latest = name(new Date('2026-11-06T19:00:00Z'));
  const unrelated = name(new Date('2000-01-01T12:00:00Z'));
  for (const filename of [early, latest, unrelated]) await writeFile(path.join(dir, filename), 'fixture');
  const original = fsPromises.readdir;
  fsPromises.readdir = async () => { const error = new Error('fixture enumeration denied'); error.code = 'EPERM'; throw error; };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await prune(dir, [early, latest, '../unowned']), [latest, '../unowned']);
    assert.equal(await exists(path.join(dir, early)), false);
    assert.equal(await exists(path.join(dir, latest)), true);
    assert.equal(await exists(path.join(dir, unrelated)), true);
  } finally { fsPromises.readdir = original; syncBuiltinESMExports(); }
});

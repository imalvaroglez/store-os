#!/usr/bin/env node
import { chmod, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireLock, assertRecipient, atomicJson, BACKUP_NAME, backupTime, command, DEFAULT_DESTINATION, DEFAULT_HOME, DEV, PROD, decryptArchive, encryptDirectory, exists, fileHash, dueDate, localDate, isDue, json, manifest, privateDirectory, prune, publish, readJson, sha256 } from './core.mjs';
import { capture, connect, restore, validateTarget, validateUsers } from './cloud.mjs';

export function parseArgs(args) {
  const [action, ...rest] = args;
  if (!['preflight', 'run', 'status', 'restore', 'verify', 'unlock'].includes(action)) throw new Error('USAGE');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--config', '--archive', '--identity'].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--') || flags[rest[i].slice(2)]) throw new Error('USAGE');
    flags[rest[i].slice(2)] = path.resolve(rest[i + 1]);
  }
  return { action, ...flags };
}
export async function loadConfig(file) {
  const config = await readJson(file);
  for (const key of ['home', 'destination', 'age', 'credentials']) if (config[key] && !path.isAbsolute(config[key])) throw new Error('ABSOLUTE_PATH_REQUIRED');
  config.home ??= DEFAULT_HOME; config.destination ??= DEFAULT_DESTINATION;
  if (!path.isAbsolute(config.age ?? '') || path.resolve(config.home) === path.resolve(config.destination)) throw new Error('INVALID_CONFIG');
  if (config.projectId === PROD) {
    assertRecipient(config.recipient);
    if (config.home !== DEFAULT_HOME) throw new Error('INVALID_LOCAL_HOME');
    if (config.destination !== DEFAULT_DESTINATION) throw new Error('INVALID_DESTINATION');
    const forbidden = path.join(homedir(), 'Library/Mobile Documents');
    // Resolve symlinks and require private credential permissions before connecting to production.
    const { realpath } = await import('node:fs/promises');
    const credential = await realpath(config.credentials);
    const home = await realpath(config.home);
    if (home !== DEFAULT_HOME || credential.startsWith(`${forbidden}/`) || home.startsWith(`${forbidden}/`) || !credential.startsWith(`${home}/`) || (await stat(credential)).mode & 0o077) throw new Error('UNSAFE_CREDENTIAL_LOCATION');
  }
  return config;
}
async function stateFor(home) { return await exists(path.join(home, 'state.json')) ? readJson(path.join(home, 'state.json')) : { ownedArchives: [] }; }
async function notify(config, message) {
  if (process.platform === 'darwin' && config.notifications !== false) {
    const noticeFile = path.join(config.home, 'notice.json');
    if (await exists(noticeFile)) { const last = await readJson(noticeFile); if (last.message === message && Date.now() - last.at < 86400000) return; }
    await atomicJson(noticeFile, { message, at: Date.now() });
    try { await command('/usr/bin/osascript', ['-e', `display notification "${message}" with title "Respaldos de Store OS"`]); } catch { /* Status remains authoritative when notifications are disabled by macOS. */ }
  }
}
function configFingerprint(config) { return sha256(JSON.stringify({ projectId: config.projectId, bucket: config.bucket, destination: config.destination, recipient: config.recipient })); }
export async function preflight(config, client) {
  const settings = await client.settings();
  let firestoreReadOperations = 0;
  const documents = await client.documents({ onRead: n => { firestoreReadOperations += n; } });
  const hash = await client.authConfig(); const users = await client.users(); validateUsers(users, config.projectId === DEV);
  const files = await client.files();
  const report = {
    checkedAt: new Date().toISOString(), fingerprint: configFingerprint(config), projectId: config.projectId,
    documents: documents.length, firestoreReadOperations, users: users.length, objects: files.length,
    firestoreJsonBytes: Buffer.byteLength(JSON.stringify(documents)), storageBytes: files.reduce((sum, f) => sum + Number(f.size), 0),
    passwordConfigurationAvailable: Boolean(hash.hashConfig), settings,
    estimates: { dailyDocumentReadsAtLeast: Math.max(documents.length, firestoreReadOperations), monthlyStorageDownloads: files.length * 31, monthlyStorageBytes: files.reduce((sum, f) => sum + Number(f.size), 0) * 31,
      note: 'Estimación mínima: sumar paginación, colecciones vacías, verificación y uso normal. Este preflight también consume lecturas. No confirma saldo gratuito ni ausencia de cargos.' },
  };
  await json(path.join(config.home, 'preflight.json'), report);
  return report;
}
export async function runBackup(config, clientFactory = connect, now = new Date()) {
  await privateDirectory(config.home);
  const stateFile = path.join(config.home, 'state.json');
  let release;
  try { release = await acquireLock(config.home); } catch (error) { await status(config); throw error; }
  let dir; let client;
  try {
    const state = await stateFor(config.home);
    if (state.lastScheduledDate ? dueDate(now) <= state.lastScheduledDate : !isDue(now, state.lastSuccess)) return { skipped: true };
    validateTarget(config);
    if (state.suspendedForApproval && state.suspendedForApproval === config.reviewedPreflightSha256) return { skipped: true, suspended: true };
    const report = await readJson(path.join(config.home, 'preflight.json'));
    if (report.fingerprint !== configFingerprint(config) || config.reviewedPreflightSha256 !== await fileHash(path.join(config.home, 'preflight.json'))) throw new Error('PREFLIGHT_REVIEW_REQUIRED');
    if (!Number.isSafeInteger(config.maxDocuments) || !Number.isSafeInteger(config.maxStorageBytes) || config.maxDocuments < report.documents || config.maxStorageBytes < report.storageBytes) throw new Error('LIMITS_REQUIRED');
    if (!Number.isSafeInteger(config.maxFirestoreReads) || !Number.isSafeInteger(config.maxDailyFirestoreReads) || config.maxFirestoreReads < Math.max(report.documents, report.firestoreReadOperations) || config.maxDailyFirestoreReads < config.maxFirestoreReads) throw new Error('READ_BUDGET_REQUIRED');
    const budgetDate = localDate(now);
    const usedBudget = state.readBudgetDate === budgetDate ? state.reservedReads ?? 0 : 0;
    if (usedBudget + config.maxFirestoreReads > config.maxDailyFirestoreReads) {
      await notify(config, 'Se agotó el presupuesto diario de lecturas para respaldos.');
      return { skipped: true, dailyBudgetExhausted: true };
    }
    // Reserve the whole attempt before cloud access, including crashes and retries.
    state.readBudgetDate = budgetDate; state.reservedReads = usedBudget + config.maxFirestoreReads;
    await atomicJson(stateFile, state);
    // A failed or interrupted previous run never becomes a successful archive.
    for (const name of await readdir(config.home)) if (name.startsWith('capture-')) await rm(path.join(config.home, name), { recursive: true, force: true });
    await command(config.age, ['--version']);
    dir = await mkdtemp(path.join(config.home, 'capture-')); await chmod(dir, 0o700);
    client = await clientFactory(config);
    // Recheck volumes before downloads; budget limits are explicit and reviewed by the operator.
    const captureStartedAt = new Date().toISOString();
    const files = await client.files();
    if (files.reduce((n, f) => n + Number(f.size), 0) > config.maxStorageBytes) throw new Error('STORAGE_LIMIT_EXCEEDED');
    const docs = await client.documents({ maxDocuments: config.maxDocuments, maxReads: config.maxFirestoreReads });
    if (docs.length > config.maxDocuments) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
    // Reuse the exact listings checked above; capture times include enumeration.
    const details = await capture({ ...client, documents: async () => docs, files: async () => files }, config, dir);
    details.intervals.firestore.startedAt = captureStartedAt;
    details.intervals.storage.startedAt = captureStartedAt;
    await manifest(dir, { projectId: config.projectId, bucket: config.bucket, captureStartedAt, createdAt: now.toISOString(), ...details });
    const encrypted = `${dir}.age`;
    try {
      await encryptDirectory(dir, encrypted, config.recipient, config.age);
      const name = `backup-${now.toISOString().replace(/[:.]/g, '-')}.tar.gz.age`;
      await publish(encrypted, config.destination, name);
      const next = { ...state, lastSuccess: new Date().toISOString(), lastScheduledDate: dueDate(now), lastArchive: name, bytes: (await stat(encrypted)).size, sha256: await fileHash(encrypted), cloudAvailability: 'not-verified', ownedArchives: [...new Set([...state.ownedArchives, name])], lastError: null, suspendedForApproval: null };
      await atomicJson(stateFile, next); // Commit success before retention; failures cannot erase the previous backup.
      next.ownedArchives = await prune(config.destination, next.ownedArchives);
      await atomicJson(stateFile, next);
      return { completed: true, archive: name, bytes: next.bytes, cloudAvailability: next.cloudAvailability };
    } finally { await rm(encrypted, { force: true }); }
  } catch (error) {
    const state = await stateFor(config.home);
    await atomicJson(stateFile, { ...state, lastFailure: new Date().toISOString(), lastError: safeCode(error), ...(/^(DOCUMENT_LIMIT_EXCEEDED|FIRESTORE_READ_LIMIT_EXCEEDED|STORAGE_LIMIT_EXCEEDED)$/.test(error.message) ? { suspendedForApproval: config.reviewedPreflightSha256 } : {}) });
    await notify(config, 'El respaldo falló. Revisa el estado local.');
    throw error;
  } finally {
    try { if (dir) await rm(dir, { recursive: true, force: true }); if (client) await client.close(); } finally { await release(); }
  }
}
export function safeCode(error) {
  const message = error?.message ?? '';
  return /^(?:[A-Z_]+|CLOUD_HTTP_\d{3}|COMMAND_(?:FAILED|UNAVAILABLE):[a-z-]+)$/.test(message) ? message : 'BACKUP_FAILED';
}
export async function status(config) {
  const state = await stateFor(config.home);
  const ageHours = state.lastSuccess ? (Date.now() - new Date(state.lastSuccess).getTime()) / 3600000 : null;
  const lastFile = state.lastArchive ? path.join(config.destination, state.lastArchive) : null;
  const locallyAvailable = Boolean(lastFile && await exists(lastFile));
  const overdue = ageHours === null || ageHours > 26 || !locallyAvailable;
  if (overdue) await notify(config, 'No hay un respaldo completo disponible de las últimas 26 horas.');
  return { lastSuccess: state.lastSuccess ?? null, ageHours, overdue, locallyAvailable, bytes: state.bytes ?? null, lastError: state.lastError ?? null, suspended: Boolean(state.suspendedForApproval && state.suspendedForApproval === config.reviewedPreflightSha256), readBudgetDate: state.readBudgetDate ?? null, reservedReads: state.reservedReads ?? 0, cloudAvailability: 'not-verified', locked: await exists(path.join(config.home, 'run.lock')) };
}
export async function main(args = process.argv.slice(2)) {
  process.umask(0o077);
  const options = parseArgs(args);
  const config = await loadConfig(options.config ?? path.join(DEFAULT_HOME, 'config.json'));
  if (options.action === 'status') return status(config);
  if (options.action === 'unlock') {
    const lock = path.join(config.home, 'run.lock'); const owner = await readJson(path.join(lock, 'owner.json'));
    try { process.kill(owner.pid, 0); throw new Error('LOCK_OWNER_RUNNING'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await rm(lock, { recursive: true }); return { unlocked: true };
  }
  if (options.action === 'run') { const result = await runBackup(config); await status(config); return result; }
  if (options.action === 'preflight') {
    await privateDirectory(config.home); const release = await acquireLock(config.home); let client;
    try { client = await connect(config); const report = await preflight(config, client); return { ...report, approvalSha256: await fileHash(path.join(config.home, 'preflight.json')) }; }
    finally { try { if (client) await client.close(); } finally { await release(); } }
  }
  if (!options.archive || !options.identity) throw new Error('USAGE');
  // Neither verify nor restore opens any production connection.
  if (options.action === 'restore') validateTarget(config, true);
  await privateDirectory(config.home); const release = await acquireLock(config.home); let dir; let client;
  try {
    await command(config.age, ['--version']);
    dir = await mkdtemp(path.join(config.home, 'capture-'));
    const info = await decryptArchive(options.archive, dir, options.identity, config.age);
    if (options.action === 'verify') return { verified: true, counts: info.counts, projectId: info.projectId };
    client = await connect(config, true);
    return await restore(client, config, dir, info);
  } finally { try { if (dir) await rm(dir, { recursive: true, force: true }); if (client) await client.close(); } finally { await release(); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => { if (!result?.skipped) console.log(JSON.stringify(result, null, 2)); }).catch(error => { console.error(`Respaldos: ${safeCode(error)}. Consulta docs/BACKUPS.md.`); process.exitCode = error.message === 'LOCKED' ? 0 : 1; });
}

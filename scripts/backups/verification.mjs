import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { supervisedCommand } from './supervisor.mjs';
import { DEV, PROD, assertRecipient, command, fileHash, json, privateDirectory, readJson, verifyDirectory } from './core.mjs';

export const VERIFICATION_VERSION = 1;
export const VERIFICATION_EMULATORS = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:19199',
};
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function verificationEnvironment(env = process.env) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'JAVA_HOME', 'JAVA_TOOL_OPTIONS', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'XDG_CACHE_HOME'];
  const clean = Object.fromEntries(allowed.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  return { ...clean, GCLOUD_PROJECT: DEV, GOOGLE_CLOUD_PROJECT: DEV, FIREBASE_CONFIG: JSON.stringify({ projectId: DEV, storageBucket: `${DEV}.firebasestorage.app` }), CI: 'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true' };
}
export async function checkVerificationRuntime(config) {
  if (!path.isAbsolute(config.firebase ?? '')) throw new Error('VERIFICATION_RUNTIME_REQUIRED');
  await command(config.firebase, ['--version'], { env: verificationEnvironment() });
  await command(path.join(path.dirname(config.age), 'age-keygen'), ['--version']);
}
async function identityRecipient(config, identity) {
  const keygen = path.join(path.dirname(config.age), 'age-keygen');
  return new Promise((resolve, reject) => execFile(keygen, ['-y', identity], { maxBuffer: 4096 }, (error, stdout) => error ? reject(new Error('VERIFICATION_KEY_FAILED')) : resolve(stdout.trim())));
}
export async function checkRecoveryIdentity(config, identity) {
  assertRecipient(config.recipient);
  if (await identityRecipient(config, identity) !== config.recipient) throw new Error('RECOVERY_KEY_MISMATCH');
  const proof = { version: 1, projectId: config.projectId, recipient: config.recipient, verifiedAt: new Date().toISOString() };
  await json(path.join(config.home, 'recovery-key-proof.json'), proof);
  return { recoveryRecipientVerified: true, recipient: config.recipient };
}
export async function recoveryKeyProof(config) {
  let proof;
  try { proof = await readJson(path.join(config.home, 'recovery-key-proof.json')); } catch { throw new Error('RECOVERY_KEY_CHECK_REQUIRED'); }
  if (proof.version !== 1 || proof.projectId !== config.projectId || proof.recipient !== config.recipient || !Number.isFinite(Date.parse(proof.verifiedAt))) throw new Error('RECOVERY_KEY_CHECK_REQUIRED');
  return proof;
}
export async function temporaryIdentity(config, directory, session) {
  await privateDirectory(directory);
  const identity = path.join(directory, 'identity.txt'); const keygen = path.join(path.dirname(config.age), 'age-keygen');
  await supervisedCommand(session, keygen, ['-o', identity], { cwd: directory, env: verificationEnvironment() });
  const recipient = (await readFile(identity, 'utf8')).match(/^# public key: (age1[0-9a-z]+)$/m)?.[1];
  assertRecipient(recipient);
  return { identity, recipient };
}
export async function verifyCandidate(config, archive, identity, workspace, sourceDirectory, session) {
  await privateDirectory(workspace);
  // All emulator state, keys and logs remain outside iCloud and are removed by the caller.
  const temporary = path.join(workspace, 'tmp'); await privateDirectory(temporary);
  const localConfig = path.join(workspace, 'firebase.json');
  await json(localConfig, {
    firestore: { rules: 'firestore.rules' }, storage: { rules: 'storage.rules' },
    emulators: {
      firestore: { host: '127.0.0.1', port: 18080, websocketPort: 19150 },
      auth: { host: '127.0.0.1', port: 19099 }, storage: { host: '127.0.0.1', port: 19199 },
      hub: { host: '127.0.0.1', port: 14400 }, logging: { host: '127.0.0.1', port: 14500 },
      ui: { enabled: false }, singleProjectMode: true,
    },
  });
  await writeFile(path.join(workspace, 'firestore.rules'), "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }", { mode: 0o600 });
  await writeFile(path.join(workspace, 'storage.rules'), "rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{object=**} { allow read, write: if false; } } }", { mode: 0o600 });
  const source = sourceDirectory ? await verifyDirectory(sourceDirectory) : null;
  const archiveSha256 = await fileHash(archive);
  const sourceManifestSha256 = sourceDirectory ? await fileHash(path.join(sourceDirectory, 'manifest.json')) : null;
  const resultFile = path.join(workspace, 'result.json');
  const jobFile = path.join(workspace, 'job.json');
  await json(jobFile, { projectId: DEV, bucket: `${DEV}.firebasestorage.app`, localVerification: true, parentPid: process.pid, age: config.age, archive, identity, sourceManifestSha256, supervisorRoot: session.root, payload: path.join(workspace, 'payload'), resultFile });
  const worker = fileURLToPath(new URL('./verification-worker.mjs', import.meta.url));
  const script = [process.execPath, worker, jobFile].map(shellQuote).join(' ');
  try {
    await supervisedCommand(session, config.firebase, ['emulators:exec', '--project', DEV, '--config', localConfig, '--only', 'auth,firestore,storage', script], { cwd: workspace, env: { ...verificationEnvironment(), TMPDIR: temporary, TMP: temporary, TEMP: temporary } });
  } catch (error) {
    let failure;
    try { failure = await readJson(resultFile); } catch { /* Startup failures have no worker receipt. */ }
    if (/^[A-Z_]+$/.test(failure?.error ?? '')) throw new Error(failure.error);
    throw error;
  }
  let result;
  try { result = await readJson(resultFile); } catch { throw new Error('VERIFICATION_RECEIPT_REQUIRED'); }
  if (result.version !== VERIFICATION_VERSION || result.archiveSha256 !== archiveSha256 || result.restoreVerified !== true || result.encryptedArchiveVerified !== true || result.sourceSnapshotVerified !== Boolean(sourceDirectory) || !Number.isFinite(Date.parse(result.verifiedAt)) || result.sourceManifestSha256 !== sourceManifestSha256 || (source && result.sourceProjectId !== source.projectId) || (result.sourceProjectId === PROD && result.authPasswordHashesVerified !== true) || (source && JSON.stringify(result.counts) !== JSON.stringify(source.counts))) throw new Error('VERIFICATION_FAILED');
  if (await fileHash(archive) !== archiveSha256) throw new Error('VERIFICATION_ARCHIVE_CHANGED');
  return result;
}
export function hasVerifiedBackup(state) {
  return Boolean(state.lastSuccess && state.verification?.version === VERIFICATION_VERSION && state.verification.restoreVerified === true && state.verification.encryptedArchiveVerified === true && Number.isFinite(Date.parse(state.verification.verifiedAt)) && state.verification.recoveryRecipientVerified === true && state.verification.sourceSnapshotVerified === true && state.verification.archive === state.lastArchive && state.verification.archiveSha256 === state.sha256);
}

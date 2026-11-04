// Private child process: the launcher must own fresh emulators on dedicated loopback ports.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, exists, decryptArchive, fileHash, json, readJson } from './core.mjs';
import { connect, restore, validateTarget } from './cloud.mjs';
import { VERIFICATION_VERSION } from './verification.mjs';

async function main() {
  process.umask(0o077);
  const job = await readJson(process.argv[2]);
  if (job.localVerification !== true) throw new Error('VERIFICATION_CONTEXT_REQUIRED');
  validateTarget(job, true);
  await atomicJson(path.join(job.supervisorRoot, 'worker-ready.json'), { pid: process.pid });
  while (!await exists(path.join(job.supervisorRoot, 'worker-go.json'))) await new Promise(resolve => setTimeout(resolve, 50));
  const parentAlive = () => { try { process.kill(job.parentPid, 0); } catch { process.exit(1); } };
  parentAlive(); const watchdog = setInterval(parentAlive, 1000);
  let client;
  try {
    const info = await decryptArchive(job.archive, job.payload, job.identity, job.age);
    const payloadManifestSha256 = await fileHash(path.join(job.payload, 'manifest.json'));
    if (job.sourceManifestSha256 && payloadManifestSha256 !== job.sourceManifestSha256) throw new Error('VERIFICATION_SOURCE_MISMATCH');
    client = await connect(job, true);
    const recovered = await restore(client, job, job.payload, info);
    if (!recovered.verified) throw new Error('VERIFICATION_RESTORE_FAILED');
    await json(job.resultFile, {
      version: VERIFICATION_VERSION, sourceProjectId: info.projectId, verifiedAt: new Date().toISOString(),
      archiveSha256: await fileHash(job.archive), sourceManifestSha256: job.sourceManifestSha256,
      encryptedArchiveVerified: true, sourceSnapshotVerified: Boolean(job.sourceManifestSha256),
      restoreVerified: true, counts: info.counts,
      authPasswordLoginVerified: recovered.authPasswordLoginVerified,
      authPasswordHashesVerified: recovered.authPasswordHashesVerified,
    });
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'VERIFICATION_FAILED';
    await json(job.resultFile, { error: code }); throw error;
  } finally { clearInterval(watchdog); if (client) await client.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('VERIFICATION_FAILED'); process.exitCode = 1; });

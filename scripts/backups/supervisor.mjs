import { trash } from './trash.mjs';
// Outlives the caller so a killed backup cannot leave keys or restored data behind.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, BACKUP_NAME, exists, readJson } from './core.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function processes() {
  const text = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,stat=,lstart='], { encoding: 'utf8', timeout: 1000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  return new Map(text.split('\n').flatMap(row => {
    const match = row.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match ? [[Number(match[1]), { parent: Number(match[2]), state: match[3], born: match[4].trim() }]] : [];
  }));
}
export async function startSupervisor(root, timeoutMs = 180000, destination) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 180000) throw new Error('VERIFICATION_TIMEOUT_INVALID');
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('VERIFICATION_PLATFORM_UNSUPPORTED');
  const bootstrap = path.join(root, 'supervisor.json');
  await atomicJson(bootstrap, { root, parentPid: process.pid, timeoutMs, destination });
  const script = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [script, bootstrap], { detached: true, stdio: 'ignore' });
  let exitCode;
  const ended = new Promise(resolve => { child.once('error', () => { exitCode = 1; resolve(1); }); child.once('exit', code => { exitCode = code ?? 1; resolve(exitCode); }); });
  const session = { root, child, ended, exitCode: () => exitCode, stopped: false };
  for (let i = 0; i < 100; i++) {
    if (await exists(path.join(root, 'supervisor-ready.json'))) return session;
    if (exitCode !== undefined) throw new Error('VERIFICATION_SUPERVISOR_FAILED');
    await delay(50);
  }
  child.kill('SIGTERM'); await ended; throw new Error('VERIFICATION_SUPERVISOR_FAILED');
}
export async function supervisedCommand(session, executable, args, options) {
  const result = path.join(session.root, 'command-result.json');
  await trash(result);
  await atomicJson(path.join(session.root, 'command-request.json'), { executable, args, options });
  while (!await exists(result)) {
    if (session.exitCode() !== undefined) throw new Error('VERIFICATION_SUPERVISOR_FAILED');
    await delay(50);
  }
  const outcome = await readJson(result);
  if (outcome.code !== 0) throw new Error(outcome.error ?? 'VERIFICATION_PROCESS_FAILED');
}
export async function stopSupervisor(session) {
  if (!session || session.stopped) return;
  session.stopped = true;
  if (session.exitCode() === undefined) await atomicJson(path.join(session.root, 'supervisor-finish.json'), { finish: true });
  const code = await session.ended;
  if (code !== 0 || await exists(session.root)) throw new Error('VERIFICATION_CLEANUP_FAILED');
}
export async function cleanupStaleWorkspaces(home) {
  const { readdir } = await import('node:fs/promises');
  const live = processes();
  for (const name of await readdir(home)) {
    if (!name.startsWith('capture-')) continue;
    const root = path.join(home, name);
    let owner;
    try { owner = await readJson(path.join(root, 'supervisor-ready.json')); } catch { /* Interrupted before supervision or an older version. */ }
    if (owner && live.get(owner.pid)?.born === owner.born && !live.get(owner.pid).state.startsWith('Z')) continue;
    await trash(root);
  }
}
async function supervise(bootstrap) {
  const { root, parentPid, timeoutMs, destination } = await readJson(bootstrap);
  const token = `STORE_OS_BACKUP_OWNER=${path.basename(root)}`;
  const self = processes().get(process.pid);
  await atomicJson(path.join(root, 'supervisor-ready.json'), { pid: process.pid, born: self.born });
  let child; let commandCode; let started = 0; let handled = false; let abort = false;
  const owned = new Map();
  const interrupt = () => { abort = true; };
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  function track() {
    const snapshot = processes();
    // Environment tagging also finds detached children whose launcher already exited.
    const tagged = execFileSync('/bin/ps', ['axeww', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 1000, maxBuffer: 32 * 1024 * 1024 });
    for (const row of tagged.split('\n')) {
      const match = row.match(/^\s*(\d+)\s+(.+)$/);
      if (match && match[2].split(/\s+/).includes(token) && snapshot.has(Number(match[1]))) owned.set(Number(match[1]), snapshot.get(Number(match[1])).born);
    }
    let changed;
    do {
      changed = false;
      for (const [pid, info] of snapshot) if (!owned.has(pid) && (pid === child?.pid || owned.has(info.parent))) { owned.set(pid, info.born); changed = true; }
    } while (changed);
    return snapshot;
  }
  async function stopOwned() {
    let snapshot = track();
    for (const [pid, born] of owned) if (snapshot.get(pid)?.born === born && !snapshot.get(pid).state.startsWith('Z')) { try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ } }
    for (let i = 0; i < 30; i++) {
      await delay(100); snapshot = track();
      if (![...owned].some(([pid, born]) => snapshot.get(pid)?.born === born && !snapshot.get(pid).state.startsWith('Z'))) return;
    }
    for (const [pid, born] of owned) if (snapshot.get(pid)?.born === born && !snapshot.get(pid).state.startsWith('Z')) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    for (let i = 0; i < 20; i++) {
      await delay(100); snapshot = processes();
      if (![...owned].some(([pid, born]) => snapshot.get(pid)?.born === born && !snapshot.get(pid).state.startsWith('Z'))) return;
    }
    throw new Error('VERIFICATION_SHUTDOWN_FAILED');
  }
  let cleanExit = false; let aborted = false;
  try {
    while (true) {
      let parentLive = true; try { process.kill(parentPid, 0); } catch { parentLive = false; }
      const finished = await exists(path.join(root, 'supervisor-finish.json'));
      if (abort || !parentLive || finished) { aborted = abort || !parentLive; await stopOwned(); cleanExit = finished && !aborted; return; }
      if (!handled && await exists(path.join(root, 'command-request.json'))) {
        const request = await readJson(path.join(root, 'command-request.json')); handled = true; started = Date.now();
        await trash(path.join(root, 'command-request.json'));
        commandCode = undefined;
        child = spawn(request.executable, request.args, { cwd: request.options.cwd, env: { ...request.options.env, STORE_OS_BACKUP_OWNER: path.basename(root) }, detached: true, stdio: 'ignore' });
        child.once('error', () => { commandCode = 1; }); child.once('exit', code => { commandCode = code ?? 1; });
      }
      if (child) {
        track();
        // The worker cannot decrypt until all running emulator descendants have been tracked.
        if (await exists(path.join(root, 'worker-ready.json'))) {
          const worker = await readJson(path.join(root, 'worker-ready.json'));
          if (!owned.has(worker.pid)) throw new Error('VERIFICATION_OWNERSHIP_FAILED');
          await atomicJson(path.join(root, 'worker-go.json'), { go: true });
        }
        if (commandCode !== undefined || Date.now() - started > timeoutMs) {
          const timeout = commandCode === undefined;
          await stopOwned();
          await atomicJson(path.join(root, 'command-result.json'), { code: timeout ? 1 : commandCode, ...(timeout ? { error: 'VERIFICATION_TIMEOUT' } : {}) });
          child = undefined; handled = false;
        }
      }
      await delay(100);
    }
  } finally {
    try { await stopOwned(); } finally {
      try { if (aborted && destination) {
        let pending; try { pending = await readJson(path.join(root, 'pending-publication.json')); } catch {}
        if (pending?.candidate && path.dirname(pending.candidate) === destination && pending.candidate.endsWith('.partial') && BACKUP_NAME.test(path.basename(pending.candidate).slice(0, -8))) await trash(pending.candidate);
      } } finally { await trash(root); }
    }
    if (!cleanExit) process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) supervise(process.argv[2]).catch(() => { process.exitCode = 1; });

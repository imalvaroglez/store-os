import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const PROD = 'store-os-f7cf8';
export const DEV = 'store-os-dev';
export const ZONE = 'America/Mexico_City';
export const DEFAULT_DESTINATION = path.join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Olivia/cio/backups');
export const DEFAULT_HOME = path.join(homedir(), 'Library/Application Support/Store OS Backups');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function privateDirectory(dir) { await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700); }
export async function json(file, value) { await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function atomicJson(file, value) { await json(`${file}.new`, value); await rename(`${file}.new`, file); }
export async function exists(file) { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export function localDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dueDate(now) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return localDate(new Date(now.getTime() - (hour < 21 ? 86400000 : 0)));
}
export function isDue(now, lastSuccess) { return !lastSuccess || dueDate(now) > dueDate(new Date(lastSuccess)); }
export function weekOf(date) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export const BACKUP_NAME = /^backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.gz\.age$/;
export function backupTime(name) { return name.match(BACKUP_NAME)?.[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z/, 'T$1:$2:$3.$4Z'); }
export function retention(names) {
  const ordered = names.filter(n => BACKUP_NAME.test(n)).sort().reverse();
  const days = new Map(); const weeks = new Map();
  for (const name of ordered) {
    const day = localDate(new Date(backupTime(name)));
    if (!days.has(day)) days.set(day, name);
    const week = weekOf(day);
    if (!weeks.has(week)) weeks.set(week, name);
  }
  const keep = new Set([...days.values()].slice(0, 30).concat([...weeks.values()].slice(0, 12)));
  return { keep: [...keep], remove: ordered.filter(n => !keep.has(n)) };
}
// A kernel-owned loopback socket is released on exit, SIGKILL or reboot.
// The on-disk marker is diagnostic only and cannot permanently block catch-up.
export const LOCK_PORT = 43827;
export async function acquireLock(home) {
  await privateDirectory(home);
  const server = createServer(socket => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? 'LOCKED' : 'LOCK_UNAVAILABLE')));
      server.listen({ host: '127.0.0.1', port: LOCK_PORT, exclusive: true }, resolve);
    });
    const lock = path.join(home, 'run.lock');
    await rm(lock, { recursive: true, force: true });
    await mkdir(lock, { mode: 0o700 });
    await json(path.join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
    return async () => { try { await rm(lock, { recursive: true, force: true }); } finally { await new Promise(resolve => server.close(resolve)); } };
  } catch (error) { server.close(); throw error; }
}
// Never include child stderr in exceptions: cloud errors may contain private resource names.
export async function command(executable, args, options = {}) {
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
  child.stderr?.resume();
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(`COMMAND_UNAVAILABLE:${path.basename(executable)}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`COMMAND_FAILED:${path.basename(executable)}`)));
  });
}
export function assertRecipient(recipient) { if (!/^age1[0-9a-z]{58}$/.test(recipient ?? '')) throw new Error('INVALID_RECIPIENT'); }
export async function encryptDirectory(dir, output, recipient, age = 'age') {
  assertRecipient(recipient);
  // No shell interpolation, and neither archive nor plaintext is published to iCloud.
  const archive = `${dir}.tar.gz`;
  try {
    await command('/usr/bin/tar', ['-czf', archive, '-C', dir, '.']);
    await chmod(archive, 0o600);
    await command(age, ['-r', recipient, '-o', output, archive]);
    await chmod(output, 0o600);
    const handle = await open(output, 'r'); try { await handle.sync(); } finally { await handle.close(); }
  } finally { await rm(archive, { force: true }); }
}
export async function safeEntries(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) for (const sub of await safeEntries(file)) files.push(`${entry.name}/${sub}`);
    else if (entry.isFile()) files.push(entry.name);
    else throw new Error('UNSAFE_ARCHIVE_ENTRY');
  }
  return files.sort();
}
export async function manifest(dir, details) {
  const files = {};
  for (const name of await safeEntries(dir)) files[name] = { sha256: await fileHash(path.join(dir, name)), bytes: (await stat(path.join(dir, name))).size };
  const result = { formatVersion: 1, ...details, files };
  await json(path.join(dir, 'manifest.json'), result);
  return result;
}
export async function verifyDirectory(dir) {
  const result = await readJson(path.join(dir, 'manifest.json'));
  if (result.formatVersion !== 1 || ![PROD, DEV].includes(result.projectId)) throw new Error('INVALID_MANIFEST');
  const names = await safeEntries(dir);
  if (JSON.stringify(names) !== JSON.stringify([...Object.keys(result.files), 'manifest.json'].sort())) throw new Error('FILE_SET_MISMATCH');
  for (const [name, info] of Object.entries(result.files)) {
    if (!name || path.isAbsolute(name) || name.split('/').some(p => p === '..' || p === '.')) throw new Error('INVALID_ARCHIVE_PATH');
    const file = path.join(dir, name);
    if ((await stat(file)).size !== info.bytes || await fileHash(file) !== info.sha256) throw new Error('INTEGRITY_FAILED');
  }
  return result;
}
export async function decryptArchive(input, dir, identity, age = 'age') {
  await privateDirectory(dir);
  const archive = `${dir}.tar.gz`;
  try {
    await command(age, ['-d', '-i', identity, '-o', archive, input]);
    await chmod(archive, 0o600);
    // Only our fixed archive layout is accepted. Reject links and traversal before extraction.
    const child = spawn('/usr/bin/tar', ['-tzvf', archive], { stdio: ['ignore', 'pipe', 'ignore'] });
    let listing = ''; child.stdout.setEncoding('utf8'); for await (const part of child.stdout) listing += part;
    await new Promise((resolve, reject) => { child.on('error', reject); if (child.exitCode !== null) child.exitCode === 0 ? resolve() : reject(new Error('INVALID_ARCHIVE')); else child.once('exit', c => c === 0 ? resolve() : reject(new Error('INVALID_ARCHIVE'))); });
    const rows = listing.trim().split('\n');
    if (rows.some(row => !/^[d-]/.test(row) || !/ \.\/(?:$|manifest\.json$|firestore\.json$|auth\.json$|auth-config\.json$|storage\.json$|objects\/$|objects\/[a-f0-9]{64}$)/.test(row))) throw new Error('UNSAFE_ARCHIVE_ENTRY');
    await command('/usr/bin/tar', ['-xzf', archive, '-C', dir]);
    return await verifyDirectory(dir);
  } finally { await rm(archive, { force: true }); }
}
export async function publish(encrypted, destination, name) {
  if (!BACKUP_NAME.test(name)) throw new Error('INVALID_BACKUP_NAME');
  await privateDirectory(destination);
  const partial = path.join(destination, `${name}.partial`);
  try {
    await pipeline(createReadStream(encrypted), createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    if (await fileHash(partial) !== await fileHash(encrypted)) throw new Error('COPY_FAILED');
    const handle = await open(partial, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    await rename(partial, path.join(destination, name));
  } finally { await rm(partial, { force: true }); }
}
export async function prune(destination, ownedNames) {
  // Local ledger of this installation prevents deletion of unrelated or unowned iCloud files.
  const available = (await readdir(destination)).filter(name => ownedNames.includes(name));
  const { remove } = retention(available);
  for (const name of remove) {
    if (!(await lstat(path.join(destination, name))).isFile()) throw new Error('UNSAFE_RETENTION_ENTRY');
    await rm(path.join(destination, name));
  }
  return ownedNames.filter(name => !remove.includes(name));
}

// Never permanently delete user files, including temporary backup material.
import { lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
export async function trash(file) {
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const executable = process.platform === 'darwin' ? '/usr/bin/trash' : '/usr/bin/trash-put';
  await new Promise((resolve, reject) => execFile(executable, [path.resolve(file)], { timeout: 30000 }, error => error ? reject(new Error('TRASH_FAILED')) : resolve()));
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('TRASH_FAILED');
}

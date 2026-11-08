// Never permanently delete user files, including temporary backup material.
import { lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
export async function trash(file) {
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const executable = process.platform === 'darwin' ? '/usr/bin/trash' : '/usr/bin/trash-put';
  try {
    await new Promise((resolve, reject) => execFile(executable, [path.resolve(file)], { timeout: 30000 }, error => error ? reject(error) : resolve()));
  } catch {
    // The workspace supervisor trashes the whole tree while the parent trashes files inside it;
    // a vanished target means a concurrent cleaner already secured it.
    try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw new Error('TRASH_FAILED');
  }
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('TRASH_FAILED');
}

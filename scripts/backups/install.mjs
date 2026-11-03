#!/usr/bin/env node
// Run only after human integration. Does not create credentials, keys or backups.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { command, DEFAULT_HOME, exists, privateDirectory, readJson } from './core.mjs';

export function launchAgent(node, script, config) {
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const home = path.dirname(config);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>mx.store-os.backups</string>
<key>ProgramArguments</key><array>${[node, script, 'run', '--config', config].map(v => `<string>${escape(v)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>900</integer>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
<key>EnvironmentVariables</key><dict><key>TZ</key><string>America/Mexico_City</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>StandardOutPath</key><string>${escape(path.join(home, 'agent.out.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(home, 'agent.err.log'))}</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
}
async function main() {
  if (process.platform !== 'darwin' || process.argv.slice(2).join(' ') !== '--install-after-merge') throw new Error('Usa macOS y --install-after-merge después del merge humano.');
  process.umask(0o077);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main']) || git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Actualiza origin/main y usa el commit integrado sin cambios locales.');
  const configFile = path.join(DEFAULT_HOME, 'config.json'); const config = await readJson(configFile);
  if (config.home !== DEFAULT_HOME) throw new Error('El instalador requiere el directorio local predeterminado.');
  const destination = path.join(DEFAULT_HOME, 'runtime');
  if (await exists(destination)) throw new Error('Ya existe runtime. Desactiva el agente y sigue la guía de actualización.');
  const stage = path.join(DEFAULT_HOME, 'runtime-install'); await privateDirectory(stage);
  try {
    await mkdir(path.join(stage, 'scripts'), { mode: 0o700 });
    await cp(path.join(root, 'scripts/backups'), path.join(stage, 'scripts/backups'), { recursive: true });
    await mkdir(path.join(stage, 'docs'), { mode: 0o700 });
    await cp(path.join(root, 'docs/BACKUPS.md'), path.join(stage, 'docs/BACKUPS.md'));
    for (const file of ['firebase.emulator.json', 'firestore.rules', 'storage.rules.emulator', 'package.json', 'package-lock.json']) await cp(path.join(root, file), path.join(stage, file));
    await command('/usr/bin/env', ['npm', 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });
    await rename(stage, destination);
    const agents = path.join(homedir(), 'Library/LaunchAgents'); await mkdir(agents, { recursive: true });
    const plist = path.join(agents, 'mx.store-os.backups.plist');
    if (await exists(plist)) throw new Error('El agente ya existe. Sigue la guía de actualización.');
    await writeFile(plist, launchAgent(process.execPath, path.join(destination, 'scripts/backups/cli.mjs'), configFile), { mode: 0o600, flag: 'wx' });
    console.log('Runtime y agente preparados. Revisa config.json, ejecuta el preflight y activa con launchctl según docs/BACKUPS.md.');
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('No se pudo instalar. Revisa requisitos y directorios en docs/BACKUPS.md; no se activó la tarea.'); process.exitCode = 1; });

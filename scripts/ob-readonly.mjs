#!/usr/bin/env node
// Enforce download-only sync before every daemon launch, including restarts.
// This wrapper never logs arguments because login calls contain credentials.
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args[0] === 'sync') {
  const pathIndex = args.indexOf('--path');
  const vaultPath = pathIndex >= 0 ? args[pathIndex + 1] : undefined;
  if (!vaultPath || vaultPath.startsWith('-')) {
    console.error('[readonly] Refusing sync without an explicit vault path.');
    process.exit(1);
  }
  const configured = spawnSync('ob', ['sync-config', '--path', vaultPath, '--mode', 'pull-only'], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (configured.error || configured.status !== 0) {
    console.error('[readonly] Could not enforce pull-only sync; daemon not started.');
    process.exit(1);
  }
  const checked = spawnSync('ob', ['sync-config', '--path', vaultPath, '--json'], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let config;
  try { config = JSON.parse(checked.stdout); } catch {}
  if (checked.error || checked.status !== 0 || config?.syncMode !== 'pull-only') {
    console.error('[readonly] Pull-only mode could not be verified; daemon not started.');
    process.exit(1);
  }
  console.error('[readonly] Verified pull-only sync.');
}
const child = spawn('ob', args, { stdio: 'inherit' });
child.on('error', () => { console.error('[readonly] Obsidian CLI unavailable.'); process.exit(1); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));

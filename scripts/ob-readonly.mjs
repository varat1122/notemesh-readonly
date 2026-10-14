#!/usr/bin/env node
// Enforce download-only sync before every daemon launch, including restarts.
// This wrapper never logs arguments because login calls contain credentials.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { preflight } from './cloud-sync-preflight.mjs';

const args = process.argv.slice(2);
if (args[0] === 'sync') {
  const pathIndex = args.indexOf('--path');
  const vaultPath = pathIndex >= 0 ? args[pathIndex + 1] : undefined;
  if (!vaultPath || vaultPath.startsWith('-')) {
    console.error('[readonly] Refusing sync without an explicit vault path.');
    process.exit(1);
  }
  const cloud = process.env.CLOUD_INTAKE === '1';
  const dataDir = process.env.DATA_DIR || '/data';
  const firstCloudStart = cloud && !fs.existsSync(path.join(dataDir, 'cloud-sync-preflight.json'));
  const mode = cloud && !firstCloudStart ? 'bidirectional' : 'pull-only';
  const configured = spawnSync('ob', ['sync-config', '--path', vaultPath, '--mode', mode], {
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
  if (checked.error || checked.status !== 0 || config?.syncMode !== mode) {
    console.error('[readonly] Pull-only mode could not be verified; daemon not started.');
    process.exit(1);
  }
  if (firstCloudStart) {
    const pulled = spawnSync('ob', ['sync', '--path', vaultPath], {encoding:'utf8', timeout:180000, maxBuffer:8*1024*1024, stdio:['ignore','pipe','pipe']});
    if (pulled.error || pulled.status !== 0 || !pulled.stdout.includes('Fully synced')) {
      console.error('[sync-policy] Initial pull did not finish; upload remains disabled.'); process.exit(1);
    }
    try { preflight(vaultPath, config, dataDir); }
    catch (e) { console.error('[sync-policy] '+e.message); process.exit(1); }
    const enabled = spawnSync('ob', ['sync-config','--path',vaultPath,'--mode','bidirectional','--device-name','Investment OS Cloud'], {encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
    const verified = spawnSync('ob', ['sync-config','--path',vaultPath,'--json'], {encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
    let actual; try { actual=JSON.parse(verified.stdout); } catch {}
    if (enabled.error || enabled.status !== 0 || verified.status !== 0 || actual?.syncMode !== 'bidirectional') { console.error('[sync-policy] Cannot verify cloud Sync mode.'); process.exit(1); }
  }
  console.error(cloud ? '[sync-policy] Verified bidirectional sync.' : '[readonly] Verified pull-only sync.');
}
const child = spawn('ob', args, { stdio: 'inherit' });
child.on('error', () => { console.error('[readonly] Obsidian CLI unavailable.'); process.exit(1); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));

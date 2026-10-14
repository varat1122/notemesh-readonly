import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

// Run after a completed pull-only cycle, before enabling the first upload.
// Refuse unexpected local edits/deletions, and preserve all Markdown content
// outside the vault. Never alter the Sync state database or original notes.
export function preflight(vault, config, dataDir) {
  const marker = path.join(dataDir, 'cloud-sync-preflight.json');
  if (fs.existsSync(marker)) {
    const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (saved.vaultId !== config.vaultId || saved.vault !== vault) throw Error('Preflight vault mismatch');
    return;
  }
  const state = path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, '.config'), 'obsidian-headless', 'sync', config.vaultId, 'state.db');
  const db = new DatabaseSync(state, {readOnly:true});
  const tracked = new Map();
  try {
    for (const row of db.prepare('SELECT path, data FROM local_files').all()) tracked.set(row.path, JSON.parse(row.data));
  } finally { db.close(); }
  const notes = [];
  const walk = dir => {
    for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
      if (item.name.startsWith('.')) continue;
      if (item.isSymbolicLink()) throw Error('Preflight refuses symlinks');
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name.endsWith('.md')) {
        const rel = path.relative(vault, file).split(path.sep).join('/');
        const row = tracked.get(rel), stat = fs.statSync(file);
        if (!row || !row.hash || row.hash !== row.synchash || row.size !== stat.size || row.mtime !== Math.ceil(stat.mtimeMs)) throw Error('Unsynced local Markdown detected; upload not enabled');
        const content = fs.readFileSync(file, 'utf8');
        notes.push({path:rel, sha256:crypto.createHash('sha256').update(content).digest('hex'), content});
      }
    }
  };
  walk(vault);
  if (!notes.length) throw Error('Empty vault; migration refused');
  for (const [rel, row] of tracked) {
    if (!row.folder && rel.endsWith('.md') && !fs.existsSync(path.join(vault, rel))) throw Error('Missing tracked Markdown; upload not enabled');
  }
  const backup = zlib.gzipSync(JSON.stringify(notes));
  const space = fs.statfsSync(dataDir);
  if (space.bavail * space.bsize < 50_000_000 + backup.length) throw Error('Insufficient reserve for migration backup');
  const backupPath = path.join(dataDir, 'before-cloud-markdown.json.gz');
  fs.writeFileSync(backupPath, backup, {flag:'wx', mode:0o600});
  fs.writeFileSync(marker, JSON.stringify({vaultId:config.vaultId,vault,notes:notes.length,backup:backupPath,created:new Date().toISOString()}), {flag:'wx',mode:0o600});
}

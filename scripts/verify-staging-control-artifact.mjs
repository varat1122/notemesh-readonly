// Copied beside main.mjs. Never import the application or open a volume/DB file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const main = new URL('./main.mjs', import.meta.url);
const identity = JSON.parse(fs.readFileSync(new URL('./identity.json', import.meta.url), 'utf8'));
assert.equal(identity.foundation, 'b0aeed37b910efbd3a96a52d41b885621e7f25d7');
assert.match(identity.commit, /^[a-f0-9]{40}$/);
assert.equal(identity.bundleSha256, createHash('sha256').update(fs.readFileSync(main)).digest('hex'));
execFileSync(process.execPath, ['--check', fileURLToPath(main)], { stdio: 'pipe' });
const require = createRequire(import.meta.url);
const NativeSQLite = require('better-sqlite3');
for (const db of [new NativeSQLite(':memory:'), new DatabaseSync(':memory:')]) {
  try { assert.equal(db.prepare('SELECT 1 AS ready').get().ready, 1); }
  finally { db.close(); }
}
if (process.argv.includes('--canary')) {
  const expected = {
    RAILWAY_PROJECT_ID: '8ac4a414-9f0b-4a90-bcce-4995e5736d9d',
    RAILWAY_ENVIRONMENT_ID: 'bce3bde4-29c1-44e5-8cfe-7400db9f7f51',
    RAILWAY_SERVICE_ID: '0f673bc3-e433-4641-85a8-12b2678eb040',
    RAILWAY_GIT_BRANCH: 'fix/ios-staging-control-path-001',
    RAILWAY_GIT_COMMIT_SHA: identity.commit,
    IOS_CONTROL_RECOVERY_ENABLED: '0',
  };
  for (const [name, value] of Object.entries(expected)) {
    // Do not include environment values in assertion errors.
    assert.ok(process.env[name] === value, `${name} rejected`);
  }
  assert.ok(!process.env.IOS_CONTROL_RECOVERY_KEY, 'Recovery key must be absent');
  assert.ok(/^[a-f0-9]{64}$/.test(process.env.IOS_CONTROL_READER_KEY ?? ''), 'Reader key required');
}
console.log(JSON.stringify({ artifact: 'control/main.mjs', commit: identity.commit,
  bundleSha256: identity.bundleSha256, sqliteDependencies: 'ok', canary: process.argv.includes('--canary') }));

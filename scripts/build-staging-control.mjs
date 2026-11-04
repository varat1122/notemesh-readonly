import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
execFileSync(process.execPath, ['scripts/check-staging-control-config.mjs'], { stdio: 'inherit' });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const foundation = 'b0aeed37b910efbd3a96a52d41b885621e7f25d7';
let commit, tree;
if (process.argv.includes('--railway-source')) {
  // Railway's source must be pinned to the locally reviewed candidate SHA.
  // The platform checks out that commit; this does not infer ancestry from an env var.
  commit = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || process.env.RAILWAY_GIT_BRANCH !== 'fix/ios-staging-control-path-001')
    throw Error('Exact reviewed Railway candidate source identity required');
  tree = null;
} else {
  git('merge-base', '--is-ancestor', foundation, 'HEAD');
  if (git('status', '--porcelain=v1', '--untracked-files=all')) throw Error('Commit the reviewed candidate before building its identity');
  commit = git('rev-parse', 'HEAD'); tree = git('rev-parse', 'HEAD^{tree}');
}
const result = await build({ entryPoints: ['src/server/staging-control/main.ts'], outfile: 'dist/staging-control/main.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['better-sqlite3'], metafile: true,
  banner: { js: 'import { createRequire as iosCreateRequire } from "node:module"; const require = iosCreateRequire(import.meta.url);' } });
if (Object.keys(result.metafile.inputs).some(p => /middleware|safe-edit\/engine|vault\/indexer|cloud-intake|server\/auth\.ts/.test(p)))
  throw Error('Forbidden startup dependency in maintenance bundle');
const bundleSha256 = createHash('sha256').update(fs.readFileSync('dist/staging-control/main.mjs')).digest('hex');
const worker = await build({ entryPoints: ['src/server/staging-control/read-worker.ts'], outfile: 'dist/staging-control/read-worker.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true });
if (Object.keys(worker.metafile.inputs).some(p => /middleware|safe-edit\/engine|vault\/indexer|cloud-intake|server\/auth\.ts|staging-control\/recovery/.test(p)))
  throw Error('Forbidden dependency in read-only worker');
const readWorkerSha256 = createHash('sha256').update(fs.readFileSync('dist/staging-control/read-worker.mjs')).digest('hex');
fs.writeFileSync('dist/staging-control/identity.json', JSON.stringify({ foundation, commit, tree, bundleSha256, readWorkerSha256 }) + '\n');
fs.copyFileSync('scripts/verify-staging-control-artifact.mjs', 'dist/staging-control/verify-artifact.mjs');
// COPY preserves host modes; make the assertion readable by the runtime node user.
fs.chmodSync('dist/staging-control/verify-artifact.mjs', 0o644);
await build({ entryPoints: ['scripts/staging-control-acceptance.ts'], outfile: 'dist/staging-control/acceptance.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node24' });

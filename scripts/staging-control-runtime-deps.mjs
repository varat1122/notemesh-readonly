import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const sqlite = require.resolve('better-sqlite3/package.json');
const bindings = createRequire(sqlite).resolve('bindings/package.json');
const uri = createRequire(bindings).resolve('file-uri-to-path/package.json');
for (const pkg of [sqlite, bindings, uri]) {
  const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
  fs.cpSync(path.dirname(pkg), path.join('dist/staging-runtime/node_modules', name), { recursive: true, dereference: true });
}

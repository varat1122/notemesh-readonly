#!/usr/bin/env node
// These two reviewed, unpatched advisories affect build tooling only. Keep
// the exception invalid if either dependency enters a deployed artifact.
import fs from "node:fs";
import path from "node:path";

const excluded = new Set(["node-forge", "braces"]);
const roots = process.argv.slice(2);
if (!roots.length) roots.push(".output");
const visited = new Set();
let files = 0;
function inspect(file) {
  const real = fs.realpathSync(file);
  if (visited.has(real)) return;
  visited.add(real);
  if (fs.statSync(real).isDirectory()) {
    for (const name of fs.readdirSync(real)) inspect(path.join(real, name));
    return;
  }
  files++;
  if (path.basename(real) === "package.json") {
    const pkg = JSON.parse(fs.readFileSync(real, "utf8"));
    if (excluded.has(pkg.name)) throw Error(`Build-only audit exception entered runtime: ${pkg.name} at ${file}`);
  }
  if (/\.[cm]?js$/.test(real)) {
    const source = fs.readFileSync(real, "utf8");
    // Also catch external imports even if a package was not copied/traced.
    if (/(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'](?:node-forge|braces)(?:[/"'])/.test(source)) {
      throw Error(`Build-only dependency reference in runtime: ${file}`);
    }
  }
}
for (const root of roots) inspect(root);
console.log(`check-runtime-exclusions: ${files} files checked; node-forge/braces packages and imports absent.`);

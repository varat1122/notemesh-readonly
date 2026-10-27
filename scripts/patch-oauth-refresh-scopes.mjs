import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Better Auth 1.7.7 still rotates a refresh token with the *access token's* requested
// scopes. A read tool therefore discards a previously granted inbox:submit.
// RFC 6749 section 6 requires a replacement refresh token to retain the
// original refresh token's scope. Access-token narrowing remains unchanged.
// https://www.rfc-editor.org/rfc/rfc6749.html#section-6
const directory = path.dirname(fileURLToPath(import.meta.resolve("@better-auth/oauth-provider")));
const pkg = JSON.parse(fs.readFileSync(path.join(directory, "..", "package.json"), "utf8"));
// Reviewed 1.7.7 createRefreshToken: preserve only the stored grant scopes;
// its new rotation CAS/replay checks and access-token narrowing stay intact.
if (pkg.version !== "1.7.7") throw new Error("Review the refresh-scope patch before changing the pinned OAuth provider version.");
const candidates = fs.readdirSync(directory).filter(f => f.endsWith(".mjs") && fs.readFileSync(path.join(directory, f), "utf8").includes("async function createRefreshToken("));
if (candidates.length !== 1) throw new Error("OAuth provider source layout changed; refusing to patch.");
const target = path.join(directory, candidates[0]);
const source = fs.readFileSync(target, "utf8");
const start = source.indexOf("async function createRefreshToken(");
const end = source.indexOf("\nasync function ", start + 1);
if (end < 0) throw new Error("OAuth provider function boundary not found.");
const body = source.slice(start, end);
const before = "\n\t\tscopes,\n\t\tresources,\n\t\tcreatedAt:";
const after = "\n\t\tscopes: originalRefresh?.scopes ?? scopes,\n\t\tresources,\n\t\tcreatedAt:";
if (body.includes(after)) {
  console.log("OAuth refresh-scope preservation already installed.");
} else {
  if (body.split(before).length !== 2) throw new Error("OAuth provider patch target changed; refusing to patch.");
  fs.writeFileSync(target, source.slice(0, start) + body.replace(before, after) + source.slice(end));
  console.log("Installed OAuth refresh-scope preservation; access-token scope checks unchanged.");
}

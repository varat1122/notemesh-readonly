import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { hash, Hold, TARGET } from "./contract";
export const PLAN = "IN-5B4D964827755821";
export const SOURCE = `00_Inbox/ChatGPT/Investment Intake - ${PLAN}.md`;
export const REVIEW = `10_Knowledge/Industry and Concepts/Investment Review - AI Infrastructure - ${PLAN}.md`;
export const PREVIEW = Object.freeze([
  { id: "ICW-05b126e0aaff09989ad657f79a01bf46", path: SOURCE, after: "f7e7d9f3170ec5975406e27414f56852eae5cfde7a02501c02b51f0ceb4b7f51" },
  { id: "ICW-97139c54c8aa29931bc6705e97fe88c0", path: REVIEW, after: "9c24b956b37f5a08f221555b988e3a487c13f5c45d9261d3fe6f39219db24305" },
]);
const MAX_DB = 256 * 1024 * 1024;
export function exactPath(root: string, rel = "") {
  const p = path.join(root, rel);
  if (path.resolve(p) !== p || (rel && (!p.startsWith(root + "/") || rel.includes("..")))) throw new Hold("PATH_BOUNDARY_HOLD");
  // No symlink components, including dangling symlinks.
  let at = "/";
  for (const part of p.split("/").filter(Boolean)) {
    at = path.join(at, part);
    try { if (fs.lstatSync(at).isSymbolicLink()) throw new Hold("PATH_BOUNDARY_HOLD"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return p;
}
export function openApp(root: string, readOnly = true) {
  const file = exactPath(root, "app.sqlite");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_DB) throw new Hold("DB_MISSING_OR_BOUND_EXCEEDED");
  for (const suffix of ["-wal", "-shm", "-journal"]) exactPath(root, "app.sqlite" + suffix);
  const db = new DatabaseSync(file, { readOnly });
  db.exec(`PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;${readOnly ? "PRAGMA query_only=ON;" : ""}`);
  return db;
}
export function locks(root: string) {
  return Object.fromEntries(["safe-edit.lock", "git-mutation.lock", "vault/.git/index.lock", "vault/.git/MERGE_HEAD", "vault/.git/rebase-merge", "vault/.git/rebase-apply"].map(p => [p, fs.existsSync(exactPath(root, p))]));
}
export function processFence() {
  let unknown = 0, unreadable = 0, ownedChildren = 0;
  const parents = new Map<number, number>();
  for (const pid of fs.readdirSync("/proc").filter(n => /^\d+$/.test(n))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      parents.set(Number(pid), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
    } catch (e) { if (!["ENOENT", "ESRCH"].includes((e as NodeJS.ErrnoException).code ?? "")) unreadable++; }
  }
  for (const pid of parents.keys()) {
    if (pid === process.pid) continue;
    let parent = parents.get(pid), depth = 0;
    while (parent && parent !== process.pid && depth++ < 64) parent = parents.get(parent);
    if (parent === process.pid) { ownedChildren++; continue; }
    try {
      const exe = path.basename(fs.readlinkSync(`/proc/${pid}/exe`));
      if (!["tini", "dumb-init", "railway-init", "docker-init"].includes(exe)) unknown++;
    } catch (e) { if (!["ENOENT", "ESRCH"].includes((e as NodeJS.ErrnoException).code ?? "")) unreadable++; }
  }
  return { unknown, unreadable, owned_children: ownedChildren, state: unknown || unreadable ? "UNKNOWN/HOLD" : "exclusive-process-observed" };
}

function gitView(root: string) {
  const cwd = exactPath(root, "vault");
  const run = (args: string[]) => execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", timeout: 5_000, maxBuffer: 512_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const head = run(["rev-parse", "HEAD"]);
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Hold("GIT_HEAD_UNKNOWN");
    const dirty = Boolean(run(["status", "--porcelain=v1", "--untracked-files=all"]));
    let relationship = "UNKNOWN/HOLD";
    try { const counts = run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      if (/^\d+\s+\d+$/.test(counts)) relationship = counts.replace(/\s+/, "/"); } catch { /* no remote observation */ }
    return { head, worktree: dirty ? "dirty" : "clean", local_remote_ahead_behind: relationship,
      remote_observation: "local-tracking-ref-only; no network fetch" };
  } catch { return { head: null, worktree: "UNKNOWN/HOLD", local_remote_ahead_behind: "UNKNOWN/HOLD" }; }
}
// Conservative content witness, not an assertion that all policy-protected
// state is confined to the Vault. Bounded and output contains no file contents.
export function vaultFingerprint(root: string) {
  const entries: string[] = []; let bytes = 0, visited = 0;
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(exactPath(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 20_000) throw new Hold("FINGERPRINT_BOUND_EXCEEDED");
      if (entry.name === ".git") continue;
      const name = rel + "/" + entry.name, file = exactPath(root, name);
      if (entry.isDirectory()) { walk(name); continue; }
      const stat = fs.statSync(file);
      bytes += stat.size;
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || bytes > 256 * 1024 * 1024) throw new Hold("FINGERPRINT_BOUND_EXCEEDED");
      entries.push(name + ":" + hash(fs.readFileSync(file)));
      const after = fs.statSync(file);
      if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Hold("FINGERPRINT_CHANGED_HOLD");
    }
  };
  walk("vault");
  return { sha256: hash(entries.sort().join("\n")), file_count: entries.length,
    scope: "Vault file content excluding .git; policy completeness and external state unverified",
    status: "OBSERVED_ONLY", accepted_reference: "UNKNOWN/HOLD" };
}
export function inspect(root: string, writer: unknown, build: unknown) {
  const db = openApp(root);
  try {
    db.exec("BEGIN");
    const integrity = db.prepare("PRAGMA integrity_check(10)").all().every(r => r.integrity_check === "ok");
    const fk = Number(db.prepare("SELECT count(*) AS n FROM pragma_foreign_key_check").get()!.n);
    const writing = Number(db.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE status='writing'").get()!.n);
    const receipts = Number(db.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE receipt IS NOT NULL").get()!.n);
    const missing = Number(db.prepare("SELECT count(*) AS n FROM notes n WHERE NOT EXISTS(SELECT 1 FROM notes_fts f WHERE f.path=n.path)").get()!.n);
    const orphan = Number(db.prepare("SELECT count(*) AS n FROM notes_fts f WHERE NOT EXISTS(SELECT 1 FROM notes n WHERE n.path=f.path)").get()!.n);
    const duplicate = Number(db.prepare("SELECT count(*) AS n FROM (SELECT path FROM notes_fts GROUP BY path HAVING count(*)<>1)").get()!.n);
    return { observed_at: new Date().toISOString(), build, target: TARGET, data_root_exists: true, db_exists: true,
      integrity: integrity ? "ok" : "HOLD", fk_count: fk, writing, receipts, locks: locks(root), writer,
      git: gitView(root), index: { missing, orphan, duplicate, scope: "path parity only; not full FTS integrity" },
      protected_boundary: vaultFingerprint(root) };
  } finally { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); }
}
function physical(root: string, rel: string) {
  const file = exactPath(root, "vault/" + rel);
  if (!fs.existsSync(file)) return { exists: false, sha256: null, preview_marker: false };
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 100_000) throw new Hold("NOTE_BOUND_EXCEEDED");
  const raw = fs.readFileSync(file);
  return { exists: true, sha256: hash(raw), preview_marker: raw.includes(Buffer.from(PLAN)) };
}
export function previewStatus(root: string) {
  const db = openApp(root);
  try {
    db.exec("BEGIN");
    const rows = db.prepare(`SELECT id,status,after_hash,actor,receipt IS NOT NULL AS receipt_exists,json_extract(payload,'$.path') AS path
      FROM safe_edit_operations WHERE json_extract(payload,'$.path') LIKE ? ORDER BY id LIMIT 21`).all(`%${PLAN}.md`);
    if (rows.length > 20) throw new Hold("PREVIEW_BOUND_EXCEEDED");
    const reviews = new Set([REVIEW, ...rows.map(r => String(r.path)).filter(p => new RegExp(`^10_Knowledge/(Company Research|Industry and Concepts|Macro and Markets)/Investment Review - [^/]+ - ${PLAN}\\.md$`).test(p))]);
    // Include physical/indexed reviews even when no operation row survives.
    const indexed = db.prepare("SELECT path FROM notes WHERE path LIKE ? LIMIT 21").all(`10_Knowledge/%/Investment Review - % - ${PLAN}.md`);
    if (indexed.length > 20) throw new Hold("PREVIEW_BOUND_EXCEEDED");
    for (const r of indexed) reviews.add(String(r.path));
    for (const dir of ["Company Research", "Industry and Concepts", "Macro and Markets"]) {
      const folder = exactPath(root, `vault/10_Knowledge/${dir}`);
      if (!fs.existsSync(folder)) continue;
      let n = 0;
      for (const entry of fs.readdirSync(folder)) {
        if (++n > 10_000) throw new Hold("PREVIEW_BOUND_EXCEEDED");
        if (entry.startsWith("Investment Review - ") && entry.endsWith(` - ${PLAN}.md`)) reviews.add(`10_Knowledge/${dir}/${entry}`);
      }
    }
    if (reviews.size > 20) throw new Hold("PREVIEW_BOUND_EXCEEDED");
    const expected = PREVIEW.map(e => {
      const r = rows.find(r => r.id === e.id);
      return { operation_id: e.id, matches: Boolean(r && r.path === e.path && r.status === "preview" &&
        r.after_hash === e.after && r.actor === "oauth:LjEgaziFWfTLZoNNpxKkatmJLWAYmYbp" && !r.receipt_exists) };
    });
    const files = [SOURCE, ...reviews].map(p => ({ kind: p === SOURCE ? "Source" : "Review", path: p, physical: physical(root, p),
      fts_count: Number(db.prepare("SELECT count(*) AS n FROM notes_fts WHERE path=?").get(p)!.n),
      links: Number(db.prepare("SELECT count(*) AS n FROM links WHERE source_path=? OR resolved_path=?").get(p, p)!.n),
      operations: rows.filter(r => r.path === p).map(r => ({ id: r.id, state: r.status, receipt_exists: Boolean(r.receipt_exists) })) }));
    return { observed_at: new Date().toISOString(), item: "m000038", plan: PLAN,
      association: "Owner accepted Wave 3 recovery HOLD artifact", expected, files,
      accepted_state_matches: expected.every(e => e.matches) && files.length === 2 && files.every(f => !f.physical.exists && f.fts_count === 0 && f.links === 0 && f.operations.length === 1),
      competing: reviews.size > 1 || files.some(f => f.operations.length > 1),
      review_path_status: reviews.size === 1 ? "resolved" : "UNKNOWN/HOLD", preview_edited: false };
  } finally { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); }
}

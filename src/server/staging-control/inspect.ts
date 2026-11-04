import { untimed, type PhaseRun } from "./read-timing";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { hash, Hold, TARGET } from "./contract";
import { authWitness, WAVE3_OWNERSHIP } from "./auth-witness";
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
  return Object.fromEntries(["safe-edit.lock", "git-mutation.lock", "vault/.git/index.lock", "vault/.git/MERGE_HEAD", "vault/.git/rebase-merge", "vault/.git/rebase-apply", "vault/.git/CHERRY_PICK_HEAD", "vault/.git/REVERT_HEAD", "vault/.git/REBASE_HEAD", "vault/.git/sequencer", "vault/.git/packed-refs.lock", "vault/.git/HEAD.lock"].map(p => [p, fs.existsSync(exactPath(root, p))]));
}
export { processFence } from "./process-fence";
export const ACCEPTED_HEAD = "b69de8c57bafdbd3c75a32c0b056b47103ed87c4";
export const ACCEPTED_PROTECTED = "dd2196159259d4c7fecd8a8ee11f3358e2fdf9708cb16f9adbb38531aa8bfcc8";

export function gitView(root: string) {
  const cwd = exactPath(root, "vault"), deadline = performance.now() + 3_000;
  const run = (args: string[]) => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw new Hold("GIT_BUDGET_EXCEEDED");
    return execFileSync("git", ["--no-optional-locks", "-c", `safe.directory=${cwd}`, "-c", "core.fsmonitor=false",
      "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", timeout: remaining, killSignal: "SIGKILL",
      maxBuffer: 2_000_000, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } }).trim();
  };
  try {
    if (!fs.statSync(exactPath(root, "vault/.git")).isDirectory()) throw new Hold("GIT_LAYOUT_UNKNOWN");
    const head = run(["rev-parse", "HEAD"]), tree = run(["rev-parse", "HEAD^{tree}"]);
    if (![head, tree].every(h => /^[a-f0-9]{40}$/.test(h))) throw new Hold("GIT_HEAD_UNKNOWN");
    const status = run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
    const entries = status.split("\0").filter(Boolean);
    const ignored = entries.filter(e => e.startsWith("!! ")).length;
    const dirty = entries.some(e => !e.startsWith("!! "));
    const tracked = run(["ls-files", "-v", "-z"]).split("\0").filter(Boolean);
    // Lowercase flags (assume-unchanged) and S (skip-worktree) hide changes.
    const hidden = tracked.filter(e => !e.startsWith("H ")).length;
    const stage = run(["ls-files", "--stage", "-z"]);
    let upstream: string | null = null, relationship = "UNKNOWN/HOLD", remoteHead: string | null = null;
    try {
      upstream = run(["rev-parse", "@{upstream}"]);
      const counts = run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      if (!/^[a-f0-9]{40}$/.test(upstream) || !/^\d+\s+\d+$/.test(counts)) throw new Hold("UPSTREAM_UNKNOWN");
      relationship = counts.replace(/\s+/, "/");
      // Accepted remote is a local bare repo. Read its actual ref without fetch,
      // network, arbitrary configured transport or credential helper execution.
      const remote = exactPath(root, "wave1-local-git/vault.git");
      const branch = run(["symbolic-ref", "--short", "HEAD"]);
      if (branch === "ios-p3-remainder-wave1" && run(["config", "--get", `branch.${branch}.remote`]) === "origin" &&
          run(["config", "--get", `branch.${branch}.merge`]) === `refs/heads/${branch}` &&
          run(["config", "--get", "remote.origin.url"]) === remote) {
        const observed = run([`--git-dir=${remote}`, "rev-parse", `refs/heads/${branch}`]);
        if (/^[a-f0-9]{40}$/.test(observed)) remoteHead = observed;
      }
    } catch { /* missing/unexpected upstream or accepted remote remains explicit */ }
    return { head, tree, upstream_head: upstream, remote_head: remoteHead, worktree: dirty ? "dirty" : "clean",
      ignored_entries: ignored, hidden_index_entries: hidden, tracked_files: tracked.length, tracked_manifest_sha256: hash(stage),
      local_remote_ahead_behind: relationship, local_equals_remote: remoteHead === head,
      accepted_head_matches: head === ACCEPTED_HEAD,
      remote_observation: remoteHead ? "fresh read of accepted local bare remote ref; no fetch" : "UNKNOWN/HOLD; local tracking refs only" };
  } catch { return { head: null, tree: null, upstream_head: null, remote_head: null, worktree: "UNKNOWN/HOLD",
    ignored_entries: null, hidden_index_entries: null, tracked_files: null, tracked_manifest_sha256: null,
    local_remote_ahead_behind: "UNKNOWN/HOLD", local_equals_remote: false, accepted_head_matches: false,
    remote_observation: "UNKNOWN/HOLD" }; }
}
export function protectedEvidence(git: ReturnType<typeof gitView>) {
  const equivalent = git.accepted_head_matches && git.worktree === "clean" && git.hidden_index_entries === 0 && git.ignored_entries === 0;
  return { accepted_reference: ACCEPTED_PROTECTED, accepted_head: ACCEPTED_HEAD,
    sha256: null, hash_equality: null, recomputed: false,
    proof_level: equivalent ? "TRACKED_VAULT_GIT_EQUIVALENCE" : "UNKNOWN/HOLD",
    tracked_scope: "entire Git-tracked Vault, including tracked Protected records",
    tracked_files: git.tracked_files, tracked_manifest_sha256: git.tracked_manifest_sha256, git_tree: git.tree,
    scope_limit: "Git HEAD + clean tree + no hidden/ignored entries; not a recomputation of the historical Protected hash; external/untracked baseline scope not established",
    provenance: "Owner accepted HOLD Vault HEAD and Protected reference; fresh Git observation" };
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
function receiptWitness(db: DatabaseSync, root: string) {
  const rows = db.prepare("SELECT id,actor,status,after_hash,receipt,json_extract(payload,'$.path') AS path FROM safe_edit_operations WHERE receipt IS NOT NULL LIMIT 1001").all();
  if (rows.length > 1000) throw new Hold("RECEIPT_BOUND_EXCEEDED");
  const scoped = rows.filter(r => String(r.actor).startsWith("oauth:") && hash(String(r.actor).slice(6)) === WAVE3_OWNERSHIP.clientHash);
  const evidence = scoped.map(r => {
    let valid = false;
    try {
      if (Buffer.byteLength(String(r.receipt)) > 100_000) throw new Hold("RECEIPT_BOUND_EXCEEDED");
      const receipt = JSON.parse(String(r.receipt)), file = physical(root, String(r.path));
      valid = r.status === "written" && receipt.operationId === r.id && receipt.path === r.path && receipt.afterHash === r.after_hash &&
        receipt.write === "written" && receipt.readback === "verified" && receipt.reindex === "verified" &&
        file.exists && file.sha256 === r.after_hash &&
        db.prepare("SELECT count(*) AS n FROM notes_fts WHERE path=?").get(String(r.path))!.n === 1;
    } catch { /* Invalid receipt remains visible, without echoing payload/auth */ }
    return { operation_id: String(r.id), receipt_sha256: hash(String(r.receipt)), path_sha256: hash(String(r.path)), valid };
  });
  return { total_receipts: rows.length, wave3_receipts: scoped.length, accepted_expected: 3,
    scope: "accepted Wave 3 client fingerprint; written/readback/reindex receipts with physical and FTS readback",
    evidence, accepted_state_matches: scoped.length === 3 && evidence.every(e => e.valid) };
}
export function databaseLocks(root: string, procLocks = "/proc/locks") {
  try {
    const files = ["app.sqlite", "app.sqlite-wal", "app.sqlite-shm", "app.sqlite-journal"].flatMap(name => {
      const file = exactPath(root, name);
      if (!fs.existsSync(file)) return [];
      const s = fs.statSync(file, { bigint: true }), dev = s.dev;
      const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
      const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
      return [{ major, minor, inode: s.ino }];
    });
    const raw = fs.readFileSync(procLocks, "utf8");
    if (raw.length > 1_000_000) throw new Hold("LOCK_BOUND_EXCEEDED");
    const matched = raw.split("\n").filter(line => {
      const m = /\s([a-f0-9]+):([a-f0-9]+):(\d+)\s/i.exec(line);
      return m && files.some(f => f.major === BigInt("0x" + m[1]) && f.minor === BigInt("0x" + m[2]) && f.inode === BigInt(m[3]));
    });
    return { count: matched.length, write_count: matched.filter(l => /\sWRITE\s/.test(l)).length,
      state: matched.length ? "LOCKED/HOLD" : "no-lock-observed", scope: "visible proc namespace advisory locks on SQLite files; observed before opening read transaction" };
  } catch { return { count: null, write_count: null, state: "UNKNOWN/HOLD", scope: "proc SQLite locks unavailable" }; }
}
export function inspect(root: string, writer: unknown, build: unknown, phase: PhaseRun = untimed) {
  const started = performance.now(), dbLocks = phase("sqlite_locks", () => databaseLocks(root)), db = phase("db_open", () => openApp(root));
  try {
    db.exec("BEGIN");
    const count = (sql: string) => Number(db.prepare(sql).get()!.n);
    const integrityRows = phase("integrity", () => db.prepare("PRAGMA integrity_check(10)").all());
    const integrity = integrityRows.length === 1 && integrityRows[0].integrity_check === "ok";
    const fk = phase("foreign_keys", () => count("SELECT count(*) AS n FROM pragma_foreign_key_check"));
    const { writing, links } = phase("counts", () => ({ writing: count("SELECT count(*) AS n FROM safe_edit_operations WHERE status='writing'"), links: count("SELECT count(*) AS n FROM links") }));
    const { notes, fts, missing, orphan, duplicate } = phase("notes_fts", () => {
      const notes = db.prepare("SELECT path FROM notes LIMIT 10001").all();
      const fts = db.prepare("SELECT path FROM notes_fts LIMIT 10001").all();
      if (notes.length > 10_000 || fts.length > 10_000) throw new Hold("INDEX_BOUND_EXCEEDED");
      // FTS path is UNINDEXED: correlated subqueries were quadratic. Compare sets.
      const noteSet = new Set(notes.map(r => String(r.path))), ftsSet = new Set(fts.map(r => String(r.path)));
      const missing = [...noteSet].filter(p => !ftsSet.has(p)).length, orphan = [...ftsSet].filter(p => !noteSet.has(p)).length;
      const duplicate = fts.length - ftsSet.size;
      return { notes, fts, missing, orphan, duplicate };
    });
    const receipts = phase("receipts", () => receiptWitness(db, root)), auth = phase("auth", () => authWitness(db));
    const git = phase("git", () => gitView(root)), fileLocks = phase("file_locks", () => locks(root));
    const protectedBoundary = phase("protected_boundary", () => protectedEvidence(git));
    return { observed_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - started), build, target: TARGET,
      data_root_exists: true, db_exists: true, notes: notes.length, fts: fts.length, links,
      integrity: integrity ? "ok" : "HOLD", fk_count: fk, writing, receipts: receipts.total_receipts, receipt_evidence: receipts,
      locks: fileLocks, lock_count: Object.values(fileLocks).filter(Boolean).length, database_locks: dbLocks,
      in_progress: Object.entries(fileLocks).filter(([k, v]) => v && /MERGE|REBASE|REVERT|CHERRY|rebase|sequencer/.test(k)).map(([k]) => k),
      writer, git, auth, index: { missing, orphan, duplicate, scope: "path parity; PRAGMA integrity_check reported separately" },
      protected_boundary: protectedBoundary,
      accepted_baseline: { provenance: "Owner accepted HOLD; expected values, not substituted observations", notes: 3955, fts: 3955, links: 64007,
        wave3_receipts: 3, verified: "2/90", accepted_batches: 0, head: ACCEPTED_HEAD, protected_reference: ACCEPTED_PROTECTED },
      canonical_counts_match: notes.length === 3955 && fts.length === 3955 && links === 64007 && writing === 0 && integrity && fk === 0,
    };
  } finally { phase("db_close", () => { if (db.isTransaction) db.exec("ROLLBACK"); db.close(); }); }
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

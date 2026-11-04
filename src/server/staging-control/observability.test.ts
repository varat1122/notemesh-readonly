import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { processFence } from "./process-fence";
import { authWitness } from "./auth-witness";
import { databaseLocks, gitView, inspect, PREVIEW, previewStatus, protectedEvidence, ACCEPTED_HEAD } from "./inspect";
import { boundedRead, READ_BUDGET_MS } from "./bounded-read";
import { hash, Hold, OPERATIONS, sign, TARGET } from "./contract";
import { Journal } from "./journal";
import { Runner, type Handlers } from "./runner";
import { controlServer } from "./server";

let root: string, workerRoot: string, worker: URL;
beforeAll(async () => {
  workerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-read-worker-"));
  const file = path.join(workerRoot, "read-worker.mjs");
  await build({ entryPoints: ["src/server/staging-control/read-worker.ts"], outfile: file, bundle: true, platform: "node", format: "esm", target: "node24" });
  worker = pathToFileURL(file);
});
afterAll(() => fs.rmSync(workerRoot, { recursive: true, force: true }));
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-observe-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

function proc(pid: number, parent: number, comm: string, exe?: string) {
  const dir = path.join(root, "proc", String(pid)); fs.mkdirSync(path.join(dir, "fd"), { recursive: true }); fs.mkdirSync(path.join(dir, "fdinfo"));
  const fields = Array(20).fill("0"); fields[0] = "S"; fields[1] = String(parent); fields[19] = String(100 + pid);
  fs.writeFileSync(path.join(dir, "stat"), `${pid} (${comm}) ${fields.join(" ")}\n`);
  fs.writeFileSync(path.join(dir, "comm"), comm + "\n");
  if (exe) fs.symlinkSync(exe, path.join(dir, "exe"));
  return dir;
}
const fence = () => processFence(path.join(root, "data"), path.join(root, "proc"), 10);
it.each(["tini", "dumb-init", "railway-init", "docker-init"])("classifies unreadable expected ancestor %s only using verified stat/comm lineage", name => {
  proc(1, 0, name); proc(10, 1, "node", "/usr/bin/node");
  const result = fence();
  expect(result).toMatchObject({ state: "exclusive-process-observed", unreadable: 0, expected_ancestors: 1, ancestor_exe_fallback: 1, fd_unreadable: 0 });
  expect(result.observations[0]).toMatchObject({ classification: "expected-ancestor", reason: "INIT_COMM_AND_VERIFIED_LINEAGE_EXE_UNREADABLE" });
});
it("follows multi-generation ancestors instead of trusting arbitrary init executable names", () => {
  proc(1, 0, "railway-init", "/sbin/railway-init"); proc(2, 1, "tini"); proc(10, 2, "node", "/usr/bin/node");
  expect(fence().expected_ancestors).toBe(2);
  proc(20, 1, "tini", "/sbin/tini");
  expect(fence()).toMatchObject({ state: "UNKNOWN/HOLD", unknown: 1 });
});
it("unrelated unreadable process remains HOLD", () => {
  proc(1, 0, "tini", "/sbin/tini"); proc(10, 1, "node", "/usr/bin/node"); proc(20, 1, "node");
  expect(fence()).toMatchObject({ state: "UNKNOWN/HOLD", unreadable: 1 });
});
it.each(["bash", "node", "custom-writer"])("unknown readable process %s remains HOLD and exposes no executable path", name => {
  proc(10, 0, "node", "/usr/bin/node"); proc(20, 0, name, "/sensitive/" + name);
  const result = fence(); expect(result).toMatchObject({ state: "UNKNOWN/HOLD", unknown: 1 });
  expect(JSON.stringify(result)).not.toContain("sensitive");
});
it("an ancestor writable FD inside Wave 3 root remains HOLD even with verified init lineage", () => {
  const init = proc(1, 0, "tini"); proc(10, 1, "node", "/usr/bin/node");
  fs.symlinkSync(path.join(root, "data", "app.sqlite"), path.join(init, "fd/9"));
  fs.writeFileSync(path.join(init, "fdinfo/9"), "flags:\t0100002\n");
  expect(fence()).toMatchObject({ state: "UNKNOWN/HOLD", writable_data_fds: 1 });
  fs.writeFileSync(path.join(init, "fdinfo/9"), "flags:\t0100000\n");
  expect(fence().state).toBe("exclusive-process-observed");
});
it("unreadable ancestor FD inventory is not waived by the exe fallback", () => {
  const init = proc(1, 0, "tini"); proc(10, 1, "node", "/usr/bin/node");
  const original = fs.readdirSync;
  vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, ...args: unknown[]) => {
    if (String(p) === path.join(init, "fd")) throw Object.assign(Error(), { code: "EACCES" });
    return (original as (...args: unknown[]) => unknown)(p, ...args);
  }) as typeof fs.readdirSync);
  expect(fence()).toMatchObject({ state: "UNKNOWN/HOLD", fd_unreadable: 1 });
});
it("missing lineage or changing PID identity cannot classify an ancestor as safe", () => {
  proc(10, 99, "node", "/usr/bin/node"); expect(fence().state).toBe("UNKNOWN/HOLD");
});

function database() {
  fs.mkdirSync(path.join(root, "vault"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "app.sqlite"));
  db.exec(`CREATE TABLE notes(path TEXT PRIMARY KEY);
    CREATE VIRTUAL TABLE notes_fts USING fts5(path UNINDEXED,title,headings,body);
    CREATE TABLE links(source_path TEXT,target TEXT,resolved_path TEXT,PRIMARY KEY(source_path,target));
    CREATE TABLE safe_edit_operations(id TEXT PRIMARY KEY,actor TEXT,payload TEXT,status TEXT,receipt TEXT,after_hash TEXT);
    CREATE TABLE oauthClient(clientId TEXT,name TEXT,userId TEXT);
    CREATE TABLE session(id TEXT,userId TEXT,token TEXT);
    CREATE TABLE oauthAccessToken(clientId TEXT,sessionId TEXT,token TEXT);
    CREATE TABLE oauthRefreshToken(clientId TEXT,sessionId TEXT,token TEXT);`);
  return db;
}
function git(...args: string[]) {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args],
    { cwd: path.join(root, "vault"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function gitFixture() {
  git("init", "-b", "ios-p3-remainder-wave1"); git("add", "."); git("commit", "-m", "fixture");
  fs.mkdirSync(path.join(root, "wave1-local-git"));
  const remote = path.join(root, "wave1-local-git/vault.git");
  git("clone", "--bare", ".", remote); git("remote", "add", "origin", remote); git("fetch", "origin");
  git("branch", "--set-upstream-to=origin/ios-p3-remainder-wave1");
}
it("auth read-only witness compares internally resolved IDs/hashes and owner, never returns raw IDs or tokens", () => {
  const db = database();
  db.exec("INSERT INTO oauthClient VALUES('fixture-client','fixture-wave3','owner'); INSERT INTO session VALUES('fixture-session','owner','never-output')");
  const accepted = { name: "fixture-wave3", clientHash: hash("fixture-client"), sessionHash: hash("fixture-session") };
  const before = hash(fs.readFileSync(path.join(root, "app.sqlite")));
  const result = authWitness(db, accepted);
  expect(result).toMatchObject({ counts: { client: 1, session: 1, token: 0 }, ownership_matches: true, accepted_state_matches: true,
    clientID_SHA256: accepted.clientHash, sessionID_SHA256: accepted.sessionHash, mutated: false });
  expect(JSON.stringify(result)).not.toMatch(/fixture-client|fixture-session|never-output/);
  expect(hash(fs.readFileSync(path.join(root, "app.sqlite")))).toBe(before);
  db.exec("UPDATE session SET userId='other'"); expect(authWitness(db, accepted).accepted_state_matches).toBe(false);
  db.exec("UPDATE session SET userId='owner'; INSERT INTO oauthRefreshToken VALUES('fixture-client','fixture-session','secret')");
  expect(authWitness(db, accepted)).toMatchObject({ counts: { token: 1 }, accepted_state_matches: false });
  db.exec("UPDATE oauthClient SET name='renamed'"); expect(authWitness(db, accepted).ownership_matches).toBe(false);
  db.close();
});
it("realistic 3955 notes/FTS and 64007 links finish inside the bounded live budget without Vault content hashing", async () => {
  const db = database(); db.exec("BEGIN");
  const note = db.prepare("INSERT INTO notes VALUES(?)"), fts = db.prepare("INSERT INTO notes_fts VALUES(?,?,?,?)"), link = db.prepare("INSERT INTO links VALUES(?,?,?)");
  for (let i = 0; i < 3955; i++) {
    const p = `fixture-${i}.md`; note.run(p); fts.run(p, "title", "headings", "realistic content ".repeat(200));
    fs.writeFileSync(path.join(root, "vault", p), "# fixture\n".repeat(100));
  }
  for (let i = 0; i < 64007; i++) link.run(`fixture-${i % 3955}.md`, String(i), `fixture-${(i + 1) % 3955}.md`);
  for (const p of PREVIEW) db.prepare("INSERT INTO safe_edit_operations VALUES(?,?,?,'preview',NULL,?)")
    .run(p.id, "oauth:LjEgaziFWfTLZoNNpxKkatmJLWAYmYbp", JSON.stringify({ path: p.path }), p.after);
  const receipt = db.prepare("INSERT INTO safe_edit_operations VALUES(?,?,?,'written',?,?)");
  for (let i = 0; i < 3; i++) {
    const p = `fixture-${i}.md`, id = `fixture-receipt-${i}`, after = hash(fs.readFileSync(path.join(root, "vault", p)));
    receipt.run(id, "oauth:LjEgaziFWfTLZoNNpxKkatmJLWAYmYbp", JSON.stringify({ path: p }), JSON.stringify({ operationId: id,
      path: p, afterHash: after, write: "written", readback: "verified", reindex: "verified" }), after);
  }
  db.exec("COMMIT"); db.close(); gitFixture();
  // A sparse, untracked large file must be reported dirty, never fully hashed.
  const sparse = fs.openSync(path.join(root, "vault", "untracked-large.bin"), "w"); fs.ftruncateSync(sparse, 300 * 1024 * 1024); fs.closeSync(sparse);
  const before = hash(fs.readFileSync(path.join(root, "app.sqlite"))), start = performance.now();
  const result = await boundedRead({ operation: "inspect", root, writer: { state: "stopped" }, build: {} }, worker) as ReturnType<typeof inspect>;
  const elapsed = performance.now() - start;
  console.info(JSON.stringify({ fixture: "3955-notes-64007-links", elapsed_ms: Math.round(elapsed), budget_ms: READ_BUDGET_MS }));
  expect(elapsed).toBeLessThan(READ_BUDGET_MS);
  expect(result).toMatchObject({ notes: 3955, fts: 3955, links: 64007, integrity: "ok", fk_count: 0, writing: 0, receipts: 3,
    canonical_counts_match: true, receipt_evidence: { wave3_receipts: 3, accepted_state_matches: true },
    index: { missing: 0, orphan: 0, duplicate: 0 }, git: { worktree: "dirty", local_equals_remote: true },
    protected_boundary: { recomputed: false, hash_equality: null } });
  expect(hash(fs.readFileSync(path.join(root, "app.sqlite")))).toBe(before);
  expect(await boundedRead({ operation: "reconcile_preview_status", root }, worker)).toMatchObject({ accepted_state_matches: true, competing: false });
}, 20_000);
it("Git evidence checks actual local bare remote, untracked files and hidden index flags without writes", () => {
  database().close(); fs.writeFileSync(path.join(root, "vault", "fixture.md"), "fixture"); gitFixture();
  const clean = gitView(root); expect(clean).toMatchObject({ worktree: "clean", local_equals_remote: true, local_remote_ahead_behind: "0/0", hidden_index_entries: 0 });
  if (clean.head === null) throw Error("fixture Git witness unavailable");
  expect(clean.head).toBe(clean.upstream_head); expect(clean.head).toBe(clean.remote_head);
  expect(protectedEvidence({ ...clean, head: ACCEPTED_HEAD, accepted_head_matches: true })).toMatchObject({ proof_level: "TRACKED_VAULT_GIT_EQUIVALENCE", sha256: null, hash_equality: null });
  fs.writeFileSync(path.join(root, "vault", "untracked.md"), "unexpected"); expect(gitView(root).worktree).toBe("dirty");
  fs.unlinkSync(path.join(root, "vault", "untracked.md")); git("update-index", "--assume-unchanged", "fixture.md");
  expect(gitView(root).hidden_index_entries).toBe(1);
  expect(protectedEvidence({ ...gitView(root), accepted_head_matches: true }).proof_level).toBe("UNKNOWN/HOLD");
  git("config", "remote.origin.url", "https://unapproved.invalid/private"); expect(gitView(root).remote_head).toBe(null);
});
it("proc lock evidence matches database device/inode and never converts an unreadable inventory to zero", () => {
  database().close();
  const file = path.join(root, "locks"), s = fs.statSync(path.join(root, "app.sqlite"), { bigint: true });
  const major = ((s.dev >> 8n) & 0xfffn) | ((s.dev >> 32n) & 0xfffff000n), minor = (s.dev & 0xffn) | ((s.dev >> 12n) & 0xffffff00n);
  fs.writeFileSync(file, `1: POSIX ADVISORY WRITE 999 ${major.toString(16)}:${minor.toString(16)}:${s.ino} 0 EOF\n`);
  expect(databaseLocks(root, file)).toMatchObject({ count: 1, write_count: 1, state: "LOCKED/HOLD" });
  expect(databaseLocks(root, file + "-missing")).toMatchObject({ count: null, state: "UNKNOWN/HOLD" });
});
it("m000038 links and missing/competing preview records fail reconciliation without mutation", () => {
  const db = database();
  for (const p of PREVIEW) db.prepare("INSERT INTO safe_edit_operations VALUES(?,?,?,'preview',NULL,?)")
    .run(p.id, "oauth:LjEgaziFWfTLZoNNpxKkatmJLWAYmYbp", JSON.stringify({ path: p.path }), p.after);
  expect(previewStatus(root).accepted_state_matches).toBe(true);
  db.prepare("INSERT INTO links VALUES(?,?,?)").run(PREVIEW[0].path, "target", "elsewhere");
  const before = hash(fs.readFileSync(path.join(root, "app.sqlite")));
  expect(previewStatus(root).accepted_state_matches).toBe(false);
  expect(hash(fs.readFileSync(path.join(root, "app.sqlite")))).toBe(before); db.close();
});

it("a stuck read worker is killed before a terminal HOLD is journaled and admission is released", async () => {
  const stuck = path.join(root, "stuck.mjs"); fs.writeFileSync(stuck, "process.stdin.resume(); setInterval(() => {}, 1000);");
  const journal = new Journal(path.join(root, "journal.sqlite"), "fixture");
  const handlers = Object.fromEntries(OPERATIONS.map(op => [op, () => ({ op })])) as unknown as Handlers;
  handlers.inspect = () => boundedRead({ operation: "inspect", root }, pathToFileURL(stuck), 100);
  const runner = new Runner(journal, () => ({ reader: "a".repeat(64) }), () => {}, handlers, () => false);
  const body = JSON.stringify({ request_id: randomUUID(), nonce: randomUUID(), operation: "inspect", target: TARGET, issued_at: new Date().toISOString() });
  const result = await runner.execute(body, "reader", sign(body, "a".repeat(64)));
  expect(result.body).toMatchObject({ terminal: "HOLD", error: "READ_BUDGET_EXCEEDED_HOLD" });
  expect(journal.summary().recent[0].terminal).toBe("HOLD"); journal.close();
});
it.each([false, true])("client disconnect after admission still produces a durable terminal event (failure=%s)", async failed => {
  const journal = new Journal(path.join(root, "journal.sqlite"), "fixture");
  let admitted!: () => void, release!: () => void, terminal!: () => void;
  const admittedPromise = new Promise<void>(r => { admitted = r; }), releasePromise = new Promise<void>(r => { release = r; });
  const terminalPromise = new Promise<void>(r => { terminal = r; });
  const append = journal.append.bind(journal);
  journal.append = event => { const anchor = append(event); if (["HOLD", "SUCCEEDED"].includes(String(event.terminal))) terminal(); return anchor; };
  const handlers = Object.fromEntries(OPERATIONS.map(op => [op, () => ({ op })])) as unknown as Handlers;
  handlers.inspect = async () => { admitted(); await releasePromise; if (failed) throw new Hold("FIXTURE_READ_ONLY_FAILURE"); return { fresh: true }; };
  const runner = new Runner(journal, () => ({ reader: "a".repeat(64) }), () => {}, handlers, () => false), server = controlServer(runner);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const body = JSON.stringify({ request_id: randomUUID(), nonce: randomUUID(), operation: "inspect", target: TARGET, issued_at: new Date().toISOString() });
  const req = request({ hostname: "127.0.0.1", port: (server.address() as { port: number }).port, path: "/v1/maintenance", method: "POST",
    headers: { "x-ios-key-id": "reader", "x-ios-signature": sign(body, "a".repeat(64)), "Content-Length": Buffer.byteLength(body) } });
  req.on("error", () => {}); req.end(body);
  try {
    await admittedPromise; expect(journal.summary().recent[0].terminal).toBe("RUNNING");
    req.destroy(); runner.closeAdmission();
    let idle = false;
    const waiting = runner.waitForIdle().then(() => { idle = true; });
    await Promise.resolve(); expect(idle).toBe(false);
    release(); await terminalPromise; await waiting; expect(idle).toBe(true);
    expect(journal.summary().recent[0]).toMatchObject({ terminal: failed ? "HOLD" : "SUCCEEDED" });
    expect(journal.summary().recent[0].result_digest).toMatch(/^[a-f0-9]{64}$/);
    const disk = new DatabaseSync(path.join(root, "journal.sqlite"), { readOnly: true });
    expect(disk.prepare("SELECT count(*) AS n FROM events WHERE json_extract(body,'$.terminal') IN ('HOLD','SUCCEEDED')").get()!.n).toBe(1); disk.close();
  } finally { release(); await new Promise<void>(r => server.close(() => r())); journal.close(); }
});
it("restart closes interrupted admission as unknown HOLD without ever replaying the operation", () => {
  const file = path.join(root, "journal.sqlite"), journal = new Journal(file, "old");
  journal.admit({ request_id: randomUUID(), nonce: randomUUID(), operation: "inspect", target: TARGET, issued_at: new Date().toISOString() }, "reader");
  journal.close(); const next = new Journal(file, "new");
  expect(next.summary().recent[0]).toMatchObject({ terminal: "HOLD", error: "PROCESS_INTERRUPTED_OUTCOME_UNKNOWN_HOLD" }); next.close();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertRuntimeIdentity, hash, OPERATIONS, sign, TARGET } from "./contract";
import { Journal } from "./journal";
import { Runner, type Handlers } from "./runner";
import { controlServer } from "./server";
import { cleanupOwnedRows, cleanupWave3, WAVE3_OWNERSHIP } from "./recovery";
import { inspect, previewStatus, PREVIEW, SOURCE, vaultFingerprint } from "./inspect";
let root: string, journal: Journal, runner: Runner, handlers: Handlers;
const reader = "a".repeat(64), recovery = "b".repeat(64);
const payload = (overrides: Record<string, unknown> = {}) => ({ request_id: randomUUID(), nonce: randomUUID(),
  operation: "inspect", target: { ...TARGET }, issued_at: new Date().toISOString(), ...overrides });
function send(p: unknown, keyId = "reader", key = reader) {
  const raw = typeof p === "string" ? p : JSON.stringify(p);
  return runner.execute(raw, keyId, sign(raw, key));
}
function fixture() {
  const db = new DatabaseSync(path.join(root, "app.sqlite"));
  db.exec(`CREATE TABLE safe_edit_operations(id TEXT PRIMARY KEY, actor TEXT, payload TEXT, status TEXT, receipt TEXT, after_hash TEXT);
    CREATE TABLE notes(path TEXT PRIMARY KEY); CREATE VIRTUAL TABLE notes_fts USING fts5(path,body);
    CREATE TABLE links(source_path TEXT, resolved_path TEXT);
    CREATE TABLE oauthClient(id TEXT PRIMARY KEY,clientId TEXT UNIQUE,name TEXT,userId TEXT);
    CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,token TEXT);
    CREATE TABLE oauthAccessToken(id TEXT,clientId TEXT,sessionId TEXT,token TEXT);
    CREATE TABLE oauthRefreshToken(id TEXT,clientId TEXT,sessionId TEXT,token TEXT);`);
  for (const p of PREVIEW) db.prepare("INSERT INTO safe_edit_operations VALUES(?,?,?,'preview',NULL,?)")
    .run(p.id, "oauth:LjEgaziFWfTLZoNNpxKkatmJLWAYmYbp", JSON.stringify({ path: p.path }), p.after);
  fs.mkdirSync(path.join(root, "vault"));
  db.close();
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-control-"));
  journal = new Journal(path.join(root, "control.sqlite"), "fixture-implementation");
  handlers = Object.fromEntries(OPERATIONS.map(op => [op, vi.fn(() => ({ op, observed_at: new Date().toISOString() }))])) as unknown as Handlers;
  runner = new Runner(journal, () => ({ reader, recovery }), () => {}, handlers, () => true);
});
afterEach(() => { journal.close(); fs.rmSync(root, { recursive: true, force: true }); });
it("admits authenticated read-only execution with complete fresh evidence", async () => {
  const result = await send(payload());
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ terminal: "SUCCEEDED", operation: "inspect", target: TARGET, implementation: "fixture-implementation" });
  expect(result.body).toHaveProperty("result_digest");
  expect(result.body).toHaveProperty("finished_at");
  if (!("result_digest" in result.body)) throw Error("terminal result missing");
  const d = new DatabaseSync(path.join(root, "control.sqlite"), { readOnly: true });
  const event = d.prepare("SELECT body,previous,digest FROM events WHERE seq=?").get(result.body.audit.seq)!;
  expect(hash(String(event.previous) + String(event.body))).toBe(result.body.audit.digest);
  expect(hash(String(event.body))).toBe(result.body.audit.body_sha256);
  expect(JSON.parse(String(event.body))).toMatchObject({ terminal: "SUCCEEDED", result_digest: result.body.result_digest });
  d.close();
});
it.each(["project", "environment", "service", "volume", "data_root", "foundation", "tier"])("rejects wrong target %s", async key => {
  const result = await send(payload({ target: { ...TARGET, [key]: key === "tier" ? "production" : "wrong" } }));
  expect(result.status).toBe(400); expect(handlers.inspect).not.toHaveBeenCalled();
});
it("rejects missing target, unknown operation and arbitrary operation arguments", async () => {
  for (const p of [payload({ target: undefined }), payload({ operation: "/exec" }), payload({ command: "id" }),
    payload({ operation: "auth_cleanup_wave3", sql: "DELETE FROM session" }), payload({ operation: "writer_start", config: "/tmp/x" })]) {
    expect((await send(p, "recovery", recovery)).body.terminal).toBe("REJECTED");
  }
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
});
it("rejects malformed JSON, arrays, null, extra keys, stale requests and oversized bodies", async () => {
  for (const raw of ["{", "null", "[]", JSON.stringify(payload({ issued_at: "2000-01-01T00:00:00Z" })), "x".repeat(4097)])
    expect((await send(raw)).body.terminal).toBe("REJECTED");
});
it("rejects invalid auth before any operation; read-only key cannot mutate", async () => {
  expect((await send(payload(), "reader", recovery)).status).toBe(401);
  expect((await send(payload({ operation: "writer_start" }))).body.terminal).toBe("REJECTED");
  expect(handlers.writer_start).not.toHaveBeenCalled();
  expect((await runner.execute(JSON.stringify(payload()), "reader", "")).status).toBe(401);
});
it.each([
  { mode: false, keyPresent: false },
  { mode: false, keyPresent: true },
  { mode: true, keyPresent: false },
])("canary rejects every recovery operation before dispatch: %j", async ({ mode, keyPresent }) => {
  runner = new Runner(journal, () => ({ reader, recovery: keyPresent ? recovery : undefined }), () => {}, handlers, () => mode);
  for (const operation of ["inspect", "writer_status", "reconcile_preview_status"])
    expect((await send(payload({ operation }))).body.terminal).toBe("SUCCEEDED");
  for (const operation of ["auth_cleanup_wave3", "writer_start", "writer_drain", "writer_stop"] as const) {
    expect((await send(payload({ operation }))).body).toMatchObject({ terminal: "REJECTED", error: "RECOVERY_DISABLED" });
    expect((await send(payload({ operation }), "recovery", recovery)).body).toMatchObject({
      terminal: "REJECTED", error: keyPresent ? "RECOVERY_DISABLED" : "AUTH_REJECTED",
    });
    expect(handlers[operation]).not.toHaveBeenCalled();
  }
});
it("durably consumes nonce before dispatch, including failures and across restart/key rotation", async () => {
  const p = payload({ operation: "writer_start" });
  expect((await send(p, "recovery", recovery)).status).toBe(200);
  journal.close(); journal = new Journal(path.join(root, "control.sqlite"), "new-implementation");
  runner = new Runner(journal, () => ({ reader, recovery: "c".repeat(64) }), () => {}, handlers, () => true);
  expect((await send(p, "recovery", "c".repeat(64))).body).toMatchObject({ error: "NO_REEXECUTION" });
  expect(handlers.writer_start).toHaveBeenCalledTimes(1);
  const fail = payload({ diagnostic: "controlled_read_only_failure" });
  expect((await send(fail)).body).toMatchObject({ terminal: "HOLD", error: "CONTROLLED_READ_ONLY_FAILURE" });
  expect((await send(fail)).status).toBe(409);
});
it("does not replay an admission whose process died before terminal audit", async () => {
  const p = payload(); journal.admit(p as any, "reader");
  expect((await send(p)).body).toMatchObject({ error: "NO_REEXECUTION" });
  expect(handlers.inspect).not.toHaveBeenCalled();
});
it("serializes operations and rejects concurrent retry without executing it", async () => {
  let finish!: () => void;
  handlers.inspect = vi.fn(() => new Promise<void>(r => { finish = r; }));
  const p = payload(), first = send(p);
  expect((await send(p)).status).toBe(409);
  expect((await send(payload())).body).toMatchObject({ error: "BUSY_HOLD" });
  finish(); await first; expect(handlers.inspect).toHaveBeenCalledTimes(1);
});
it("audit failure prevents execution and raw secret-like failures are redacted", async () => {
  handlers.inspect = () => { throw Error("password=never-log-me"); };
  const result = await send(payload());
  expect(JSON.stringify(result)).not.toContain("never-log-me");
  expect(result.body).toMatchObject({ terminal: "HOLD", error: "OPERATION_FAILED_HOLD" });
  const original = journal.append.bind(journal);
  journal.append = () => { throw Error("disk full"); };
  await expect(send(payload())).rejects.toThrow();
  journal.append = original;
});
it("append-only journal rejects update/delete", () => {
  journal.append({ event: "test" });
  const d = new DatabaseSync(path.join(root, "control.sqlite"));
  expect(() => d.exec("DELETE FROM events")).toThrow(/append only/);
  expect(() => d.exec("UPDATE events SET body='{}'")).toThrow(/append only/);
  d.close();
});
it("runtime identity rejects missing, production, wrong target and unknown replica count", () => {
  const env = { RAILWAY_PROJECT_ID: TARGET.project, RAILWAY_ENVIRONMENT_ID: TARGET.environment,
    RAILWAY_SERVICE_ID: TARGET.service, RAILWAY_VOLUME_ID: TARGET.volume, RAILWAY_VOLUME_MOUNT_PATH: "/pilot-001-data",
    RAILWAY_ENVIRONMENT_NAME: "staging", DATA_DIR: TARGET.data_root, RAILWAY_DEPLOYMENT_ID: "fixture",
    RAILWAY_GIT_COMMIT_SHA: TARGET.foundation, RAILWAY_REPLICA_COUNT: "1" };
  expect(() => assertRuntimeIdentity(env)).not.toThrow();
  for (const key of Object.keys(env)) expect(() => assertRuntimeIdentity({ ...env, [key]: undefined })).toThrow();
  expect(() => assertRuntimeIdentity({ ...env, RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow();
});
it("real SQLite inspect and exact preview reconciliation do not mutate checkpoint bytes", () => {
  fixture(); const before = hash(fs.readFileSync(path.join(root, "app.sqlite")));
  expect(inspect(root, { state: "stopped" }, { fixture: true })).toMatchObject({ integrity: "ok", fk_count: 0, writing: 0 });
  expect(previewStatus(root)).toMatchObject({ accepted_state_matches: true, competing: false, preview_edited: false });
  expect(hash(fs.readFileSync(path.join(root, "app.sqlite")))).toBe(before);
  fs.mkdirSync(path.join(root, "vault", path.dirname(SOURCE)), { recursive: true });
  fs.writeFileSync(path.join(root, "vault", SOURCE), "unexpected source");
  expect(previewStatus(root).accepted_state_matches).toBe(false);
});
it("preview detects competing operations and receipt/FTS changes", () => {
  fixture(); const d = new DatabaseSync(path.join(root, "app.sqlite"));
  d.prepare("INSERT INTO safe_edit_operations VALUES('other','actor',?,'preview',NULL,'hash')").run(JSON.stringify({ path: SOURCE }));
  d.prepare("INSERT INTO notes_fts(path,body) VALUES(?,?)").run(SOURCE, "not written by this test's runner");
  d.close(); const r = previewStatus(root); expect(r.accepted_state_matches).toBe(false); expect(r.competing).toBe(true);
});
it("read-only filesystem boundaries reject symlinks and missing DB without creating it", () => {
  expect(() => previewStatus(root)).toThrow(); expect(fs.existsSync(path.join(root, "app.sqlite"))).toBe(false);
  fs.symlinkSync("/etc/passwd", path.join(root, "app.sqlite")); expect(() => previewStatus(root)).toThrow(/PATH_BOUNDARY/);
});
function authFixture() {
  fixture(); const d = new DatabaseSync(path.join(root, "app.sqlite"));
  d.exec(`INSERT INTO oauthClient VALUES('client-pk','fixture-client','fixture-Wave3','owner');
    INSERT INTO session VALUES('fixture-session','owner','fixture-secret');
    INSERT INTO session VALUES('unrelated','other','never-output');`);
  d.close();
  return { name: "fixture-Wave3", clientHash: hash("fixture-client"), sessionHash: hash("fixture-session") };
}
it("auth cleanup ownership mismatch is rejected without deleting any row", () => {
  authFixture(); const d = new DatabaseSync(path.join(root, "app.sqlite"));
  d.prepare("UPDATE oauthClient SET name=?").run(WAVE3_OWNERSHIP.name); d.close();
  const before = hash(fs.readFileSync(path.join(root, "app.sqlite")));
  expect(() => cleanupWave3(root, () => true, () => {})).toThrow(/OWNERSHIP/);
  expect(hash(fs.readFileSync(path.join(root, "app.sqlite")))).toBe(before);
});
it("fixture cleanup matches hashes+owner, preserves unrelated records and is idempotent", () => {
  const ownership = authFixture();
  const result = cleanupOwnedRows(root, ownership, () => true, () => {});
  expect(result).toMatchObject({ before: { client: 1, session: 1, token: 0 }, after: { client: 0, session: 0, token: 0 }, mutated: true });
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(cleanupOwnedRows(root, ownership, () => true, () => {}).mutated).toBe(false);
  const d = new DatabaseSync(path.join(root, "app.sqlite"));
  expect(d.prepare("SELECT count(*) AS n FROM session").get()!.n).toBe(1); d.close();
});
it.each(["duplicate", "token", "owner", "hash", "running", "writing", "lock"])("cleanup refuses %s in isolated fixture", condition => {
  const ownership = authFixture(); const d = new DatabaseSync(path.join(root, "app.sqlite"));
  if (condition === "duplicate") d.exec("INSERT INTO oauthClient VALUES('x','other','fixture-Wave3','owner')");
  if (condition === "token") d.exec("INSERT INTO oauthAccessToken VALUES('x','fixture-client','fixture-session','never-log')");
  if (condition === "owner") d.exec("UPDATE session SET userId='different' WHERE id='fixture-session'");
  if (condition === "writing") d.exec("UPDATE safe_edit_operations SET status='writing'");
  if (condition === "hash") ownership.clientHash = hash("mismatch");
  if (condition === "lock") fs.mkdirSync(path.join(root, "safe-edit.lock"));
  d.close();
  expect(() => cleanupOwnedRows(root, ownership, () => condition !== "running", () => {})).toThrow();
});
it("loopback HTTP integration: five fresh reads and all eight negative cases", async () => {
  const server = controlServer(runner); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/maintenance`;
  const http = async (p: unknown, key = reader) => { const body = typeof p === "string" ? p : JSON.stringify(p);
    const r = await fetch(url, { method: "POST", headers: { "x-ios-key-id": "reader", "x-ios-signature": sign(body, key) }, body });
    return { status: r.status, body: await r.json() }; };
  try {
    const ids = new Set<string>(); const first = payload();
    for (let i = 0; i < 5; i++) { const r = await http(i === 0 ? first : payload()); expect(r.status).toBe(200); ids.add(r.body.execution_id); }
    expect(ids.size).toBe(5);
    for (const p of [first, payload({ operation: "exec" }), payload({ target: { ...TARGET, environment: "wrong" } }),
      payload({ target: { ...TARGET, service: "wrong" } }), payload({ target: { ...TARGET, tier: "production" } }), "{",
      payload({ diagnostic: "controlled_read_only_failure" })]) expect((await http(p)).status).toBeGreaterThanOrEqual(400);
    expect((await http(payload(), recovery)).status).toBe(401);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
it("read-only fingerprint changes on fixture Protected-like content and never writes it", () => {
  fixture(); const dir = path.join(root, "vault", "06_Portfolio"); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "fixture.md"), "# fixture only");
  const first = vaultFingerprint(root);
  fs.appendFileSync(path.join(dir, "fixture.md"), "\nowner fixture edit");
  const second = vaultFingerprint(root);
  expect(first.sha256).not.toBe(second.sha256); expect(second.file_count).toBe(1);
  expect(second.accepted_reference).toBe("UNKNOWN/HOLD");
});
it("failure to durably audit cleanup before-counts rolls back without deleting", () => {
  const ownership = authFixture();
  expect(() => cleanupOwnedRows(root, ownership, () => true, () => { throw Error("fixture disk full"); })).toThrow();
  const d = new DatabaseSync(path.join(root, "app.sqlite"));
  expect(d.prepare("SELECT count(*) AS n FROM oauthClient").get()!.n).toBe(1);
  expect(d.prepare("SELECT count(*) AS n FROM session").get()!.n).toBe(2); d.close();
});
it("terminal audit failure closes subsequent admission without replay", async () => {
  const append = journal.append.bind(journal);
  journal.append = event => { if (event.terminal === "SUCCEEDED") throw Error("fixture disk failure"); return append(event); };
  await expect(send(payload())).rejects.toThrow(/AUDIT_COMPLETION/);
  expect((await send(payload())).body).toMatchObject({ error: "AUDIT_COMPLETION_UNKNOWN_HOLD" });
  expect(handlers.inspect).toHaveBeenCalledTimes(1);
});
it("closing the server admission gate rejects new operations", async () => {
  runner.closeAdmission(); expect((await send(payload())).body).toMatchObject({ error: "SHUTTING_DOWN" });
  expect(handlers.inspect).not.toHaveBeenCalled();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const script = path.resolve("scripts/d1-offline-recovery.mjs");
const { inspectEvidence } = await import(pathToFileURL(script).href);
const digest = (b: string | Buffer) => crypto.createHash("sha256").update(b).digest("hex");
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-g06f-fixture-")); });
afterEach(() => { vi.restoreAllMocks(); fs.chmodSync(root, 0o700); fs.rmSync(root, { recursive: true, force: true }); });
const witnessFile = () => path.join(root, ".d1-native-outcome.pending");
function snapshot(dir = root): unknown {
  return fs.readdirSync(dir).sort().map(name => {
    const p = path.join(dir, name), s = fs.lstatSync(p);
    return { name, mode: s.mode, mtime: s.mtimeMs, ctime: s.ctimeMs,
      value: s.isSymbolicLink() ? fs.readlinkSync(p) : s.isDirectory() ? snapshot(p) : digest(fs.readFileSync(p)) };
  });
}
function unchangedInspection() {
  const before = snapshot(), result = inspectEvidence(root);
  expect(snapshot()).toEqual(before);
  expect(result).toMatchObject({ recovery: "HOLD", recoveryAuthorized: false, outcome: "UNKNOWN", sourceSQLiteOpened: false, sourceBytesModifiedByTool: false });
  return result;
}
function seedJournal(rows = 0) {
  const d = new Database(path.join(root, "app.sqlite"));
  d.pragma("journal_mode=DELETE");
  d.exec(`CREATE TABLE safe_edit_operations(id TEXT PRIMARY KEY,actor TEXT,payload TEXT,before_text TEXT,after_text TEXT,
    before_hash TEXT,after_hash TEXT,token_hash TEXT,expires INTEGER,status TEXT,approval TEXT,receipt TEXT);
    CREATE TABLE safe_edit_events(at TEXT,operation_id TEXT,actor TEXT,event TEXT,detail TEXT);`);
  for (let i = 0; i < rows; i++) d.prepare("INSERT INTO safe_edit_operations(id,status,after_hash,receipt) VALUES(?,?,?,?)")
    .run("fixture-" + i, "written", digest("fixture"), JSON.stringify({ operationId: "fixture-" + i, afterHash: digest("fixture"),
      write: "written", readback: "verified", reindex: "verified", secret: "NOT_AN_AUTHENTIC_RECEIPT_OR_REAL_CREDENTIAL" }));
  d.close();
}
function seedWitness(version = 2, extra: Record<string, unknown> = {}, physical = true) {
  const lock = path.join(root, ".d1-native-launch.lock");
  if (physical) fs.mkdirSync(lock);
  const st = physical ? fs.statSync(lock) : { dev: 1, ino: 1 };
  const start = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ")[1].split(" ")[19];
  const w = { version, id: crypto.randomUUID(), owner: { pid: process.pid, start }, lock: { dev: st.dev, ino: st.ino }, kind: "business",
    ...(version === 2 ? { operation: "sqlite.commit", phase: "native_launch_pending" } : {}), ...extra };
  fs.writeFileSync(witnessFile(), JSON.stringify(w)); return w;
}
function child(code: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code],
    { env: { PATH: process.env.PATH, DATA_DIR: root }, encoding: "utf8", timeout: 5000 });
}
function walCrash() {
  const m = pathToFileURL(path.resolve("src/server/maintenance.ts")).href;
  const r = child(`import D from 'better-sqlite3';const m=await import(${JSON.stringify(m)});
    const d=new D(${JSON.stringify(path.join(root, "app.sqlite"))});d.pragma('journal_mode=WAL');d.pragma('synchronous=FULL');d.pragma('wal_autocheckpoint=0');
    d.exec("CREATE TABLE safe_edit_operations(id,status,receipt);INSERT INTO safe_edit_operations VALUES('fixture','writing','pending')");
    m.withD1NativeInterlock('business',()=>{d.exec("UPDATE safe_edit_operations SET status='written'");process.kill(process.pid,'SIGKILL');});`);
  expect(r.signal).toBe("SIGKILL"); expect(fs.existsSync(path.join(root, "app.sqlite-wal"))).toBe(true);
}

it("normal bounded memory inspection never authenticates synthetic receipts or authorizes recovery", () => {
  seedJournal(1); const r = unchangedInspection();
  expect(r.inspection).toBe("COMPLETE_BOUNDED"); expect(r.reasons).toEqual([]);
  expect(r.journal).toMatchObject({ snapshotQuickCheck: "ok", state: "BOUNDED_MEMORY_SNAPSHOT_INSPECTED", receiptAuthenticity: "NOT_VERIFIED" });
  expect(r.journal.records[0]).toMatchObject({ status: "written", receipt: "METADATA_CONSISTENT_NOT_AUTHENTICATED" });
  expect(r.snapshot).toEqual({ observationsMatch: true, atomic: false, provesWriterExclusion: false });
  expect(JSON.stringify(r)).not.toContain("NOT_AN_AUTHENTIC_RECEIPT_OR_REAL_CREDENTIAL");
  expect(JSON.stringify(r)).not.toContain("fixture-0");
});
it("filesystem write APIs are never called, source opens use read-only/noatime flags, and read-only evidence stays byte-identical", () => {
  seedJournal(1); const before = snapshot(); const open = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: number) => {
    expect(typeof flags).toBe("number"); expect(flags & 3).toBe(fs.constants.O_RDONLY);
    expect(flags & fs.constants.O_NOFOLLOW).not.toBe(0); expect(flags & fs.constants.O_NOATIME).not.toBe(0);
    return open(p, flags);
  }) as typeof fs.openSync);
  for (const method of ["writeFileSync", "writeSync", "unlinkSync", "rmSync", "mkdirSync", "rmdirSync", "renameSync", "fsyncSync", "ftruncateSync", "chmodSync"] as const)
    vi.spyOn(fs, method).mockImplementation(() => { throw Error("INSPECTOR_ATTEMPTED_WRITE:" + method); });
  expect(inspectEvidence(root).inspection).toBe("COMPLETE_BOUNDED"); vi.restoreAllMocks(); expect(snapshot()).toEqual(before);
  fs.chmodSync(path.join(root, "app.sqlite"), 0o400); fs.chmodSync(root, 0o500);
  expect(unchangedInspection().inspection).toBe("COMPLETE_BOUNDED");
});
it.each(["outcome_unknown", "release_failed", "pre_effect_failed"])("recorded %s is not success or proof of zero writes", phase => {
  seedJournal(); seedWitness(2, { phase }); const r = unchangedInspection();
  expect(r.witness).toMatchObject({ recordedPhase: phase, outcome: "UNKNOWN", owner: { state: "MATCH_OBSERVED", provesWriterExclusion: false } });
  expect(r.reasons).toContain("RECORDED_UNCERTAIN_OUTCOME");
});
it("stale or PID-reused witness remains namespace-limited, never permission to steal", () => {
  seedJournal(); seedWitness(2, { owner: { pid: process.pid, start: "0" } }); const r = unchangedInspection();
  expect(r.witness.owner.state).toBe("START_MISMATCH_OBSERVED"); expect(r.reasons).toContain("STALE_OR_FOREIGN_NAMESPACE_WITNESS");
});
it("missing owner identity remains explicitly unknown", () => {
  seedJournal(); seedWitness(2, { owner: null }); const r = unchangedInspection();
  expect(r.witness.owner.state).toBe("UNKNOWN"); expect(r.reasons).toContain("OWNER_IDENTITY_UNKNOWN");
});
it("legacy v1 witness is observed without migration or invented phase", () => {
  seedJournal(); seedWitness(1); const r = unchangedInspection();
  expect(r.witness).toMatchObject({ state: "LEGACY", version: 1, outcome: "UNKNOWN" });
  expect(r.witness.recordedPhase).toBeUndefined(); expect(r.reasons).toContain("LEGACY_WITNESS_OUTCOME_UNAVAILABLE");
});
it.each(["{broken", JSON.stringify({ version: 9 }), JSON.stringify({ version: 2, id: [crypto.randomUUID()] })])("malformed/unsupported witness is preserved and never trusted: %s", content => {
  seedJournal(); fs.writeFileSync(witnessFile(), content); expect(unchangedInspection().reasons).toContain("WITNESS_MALFORMED_OR_UNSUPPORTED");
});
it("lock-only and witness-only states have distinct exact reasons", () => {
  seedJournal(); fs.mkdirSync(path.join(root, ".d1-native-launch.lock"));
  expect(unchangedInspection().reasons).toContain("LOCK_ONLY_OWNER_UNVERIFIED");
  // Fixture construction only. Inspector does not clear the prior lock.
  fs.rmdirSync(path.join(root, ".d1-native-launch.lock")); seedWitness(2, {}, false);
  expect(unchangedInspection().reasons).toContain("WITNESS_ONLY_PHYSICAL_LOCK_ABSENT");
});
it("mismatched lock identity and Safe Edit/maintenance markers remain restrictive", () => {
  seedJournal(); seedWitness(2, { lock: { dev: 0, ino: 1 } }); fs.mkdirSync(path.join(root, "safe-edit.lock"));
  fs.writeFileSync(path.join(root, "maintenance-resume.json"), "malformed"); const r = unchangedInspection();
  expect(r.reasons).toEqual(expect.arrayContaining(["WITNESS_LOCK_IDENTITY_CONFLICT", "SAFE_EDIT_LOCK_REQUIRES_OPERATOR_RECONCILIATION", "MAINTENANCE_RECORD_UNREADABLE_OR_MALFORMED"]));
});
it("symlink/hardlink files and symlink root are not followed", () => {
  seedJournal(); fs.symlinkSync("app.sqlite", witnessFile());
  expect(unchangedInspection().files[".d1-native-outcome.pending"].state).toBe("UNSAFE_FILE_TYPE");
  fs.unlinkSync(witnessFile()); fs.linkSync(path.join(root, "app.sqlite"), witnessFile());
  expect(unchangedInspection().files["app.sqlite"].state).toBe("UNSAFE_FILE_TYPE");
  const link = path.join(root, "root-link"); fs.symlinkSync(root, link);
  expect(inspectEvidence(link).reasons).toContain("UNSAFE_DIRECTORY_COMPONENT");
});
it("oversized witness/database and bounded journal/event overflow are explicit incomplete coverage", () => {
  seedJournal(129); let r = unchangedInspection(); expect(r.journal.records).toHaveLength(128); expect(r.reasons).toContain("JOURNAL_RECORDS_TRUNCATED");
  const d = new Database(path.join(root, "app.sqlite"));
  for (let n = 0; n < 129; n++) d.prepare("INSERT INTO safe_edit_events VALUES('fixture',?,'fixture','write_started','{}')").run("fixture-" + n);
  d.close(); r = unchangedInspection(); expect(r.journal.events).toHaveLength(128); expect(r.reasons).toContain("JOURNAL_EVENTS_TRUNCATED");
  fs.writeFileSync(witnessFile(), " ".repeat(16385));
  expect(unchangedInspection().files[".d1-native-outcome.pending"].state).toBe("LIMIT_EXCEEDED");
  fs.truncateSync(path.join(root, "app.sqlite"), 16 * 1024 * 1024 + 1);
  expect(unchangedInspection().files["app.sqlite"].state).toBe("LIMIT_EXCEEDED");
});
it("written journal with conflicting receipt and partial writing journal are not verified", () => {
  seedJournal(2); const d = new Database(path.join(root, "app.sqlite"));
  d.prepare("UPDATE safe_edit_operations SET receipt=? WHERE id='fixture-0'").run(JSON.stringify({ operationId: "wrong", afterHash: digest("wrong"), write: "pending" }));
  d.exec("UPDATE safe_edit_operations SET status='writing' WHERE id='fixture-1'; INSERT INTO safe_edit_events VALUES('fixture','fixture-1','fixture','interrupted','sensitive-not-exported')");d.close();
  const r = unchangedInspection(); expect(r.reasons).toEqual(expect.arrayContaining(["SQLITE_RECEIPT_BINDING_CONFLICT", "JOURNAL_WRITING_OUTCOME_UNRESOLVED", "JOURNAL_EVENTS_REQUIRE_ORDERED_RECONCILIATION"]));
  expect(JSON.stringify(r)).not.toContain("sensitive-not-exported");
});
it("malformed/missing receipts and corrupt SQLite are diagnostic HOLD without repair", () => {
  seedJournal(2); const d = new Database(path.join(root, "app.sqlite"));d.exec("UPDATE safe_edit_operations SET receipt=NULL WHERE id='fixture-0'; UPDATE safe_edit_operations SET receipt='broken' WHERE id='fixture-1'");d.close();
  expect(unchangedInspection().reasons).toEqual(expect.arrayContaining(["WRITTEN_WITHOUT_RECEIPT", "RECEIPT_MALFORMED_OR_OVERSIZED"]));
  fs.writeFileSync(path.join(root, "app.sqlite"), "corrupt-disposable"); expect(unchangedInspection().reasons).toContain("SQLITE_HEADER_INVALID");
});
it("actual crash leaves WAL/SHM and witness: fresh inspector does not replay or publish receipt success", () => {
  walCrash(); const before = snapshot(); const r = unchangedInspection();
  expect(r.witness.owner.state).toBe("NOT_OBSERVED"); expect(r.reasons).toContain("STALE_OR_FOREIGN_NAMESPACE_WITNESS");
  expect(r.wal).toMatchObject({ state: "HEADER_OBSERVED_UNVERIFIED", checksumsVerified: false, databaseBindingVerified: false, provesCommit: false });
  expect(r.wal.commitMarkersObserved).toBeGreaterThan(0); expect(r.journal.state).toBe("UNSUPPORTED");
  expect(r.reasons).toContain("WAL_REPLAY_UNSUPPORTED_NO_SOURCE_SQLITE_OPEN");
  const fresh = spawnSync(process.execPath, [script, "--evidence-dir", root], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5000 });
  expect(fresh.status).toBe(2); expect(JSON.parse(fresh.stdout)).toMatchObject({ outcome: "UNKNOWN", recoveryAuthorized: false, journal: { state: "UNSUPPORTED" } });
  expect(snapshot()).toEqual(before);
});
it("WAL partial frame and page-size conflict cannot be read as a settled main-file receipt", () => {
  walCrash(); const p = path.join(root, "app.sqlite-wal"); fs.truncateSync(p, fs.statSync(p).size - 3);
  expect(unchangedInspection().reasons).toContain("WAL_PARTIAL_FRAME");
  const b = fs.readFileSync(p); b.writeUInt32BE(b.readUInt32BE(8) === 4096 ? 8192 : 4096, 8); fs.writeFileSync(p, b);
  expect(unchangedInspection().reasons).toContain("WAL_SQLITE_PAGE_SIZE_CONFLICT");
});
it("actual rollback-journal crash is inspected without SQLite recovery or journal deletion", () => {
  const r = child(`import D from 'better-sqlite3';const d=new D(${JSON.stringify(path.join(root, "app.sqlite"))});
    d.pragma('journal_mode=DELETE');d.exec('CREATE TABLE t(v);INSERT INTO t VALUES(1);BEGIN IMMEDIATE;UPDATE t SET v=2');process.kill(process.pid,'SIGKILL');`);
  expect(r.signal).toBe("SIGKILL"); expect(fs.existsSync(path.join(root, "app.sqlite-journal"))).toBe(true);
  const report = unchangedInspection(); expect(report.journal.state).toBe("UNSUPPORTED"); expect(report.reasons).toContain("SQLITE_SIDECAR_REPLAY_OR_SHARED_MEMORY_UNSUPPORTED");
});
it("closed WAL-mode database without sidecars is explicitly unsupported, not silently treated as current main image", () => {
  const d = new Database(path.join(root, "app.sqlite"));d.pragma("journal_mode=WAL");d.exec("CREATE TABLE t(v)");d.close();
  expect(unchangedInspection().reasons).toContain("WAL_MODE_MEMORY_SNAPSHOT_UNSUPPORTED");
});
it("external evidence drift during reading forces explicit non-atomic snapshot HOLD", () => {
  seedJournal(); seedWitness(); const read = fs.readSync;let fired = false;
  vi.spyOn(fs, "readSync").mockImplementation(((...args: any[]) => {
    const count = (read as any)(...args);
    if (!fired) { fired = true; fs.writeFileSync(witnessFile(), "external-fixture-writer-changed-evidence"); }
    return count;
  }) as typeof fs.readSync);
  const r = inspectEvidence(root); expect(fired).toBe(true); expect(r.snapshot.observationsMatch).toBe(false);
  expect(r.reasons).toContain("EVIDENCE_CHANGED_DURING_INSPECTION"); expect(r.recoveryAuthorized).toBe(false);
});
it("CLI normal inspection exits HOLD; apply/resume/recovery flags and unspecified directory are refused", () => {
  seedJournal(); const before = snapshot();
  for (const args of [["--evidence-dir", root], ["--apply", root], ["--evidence-dir", root, "--resume"], []]) {
    const r = spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5000 });
    expect(r.signal).toBeNull(); expect(r.status).toBe(args.length === 2 && args[0] === "--evidence-dir" ? 2 : 64);
    expect(JSON.parse(r.stdout)).toMatchObject({ recovery: "HOLD", recoveryAuthorized: false });
  }
  expect(snapshot()).toEqual(before);
});

it("main-file written receipt cannot override newer writing state committed only in WAL", () => {
  seedJournal(1);
  const r = child(`import D from 'better-sqlite3';import fs from 'node:fs';const file=${JSON.stringify(path.join(root, "app.sqlite"))};
    const d=new D(file);d.pragma('journal_mode=WAL');d.pragma('wal_autocheckpoint=0');
    if(d.prepare("SELECT status FROM safe_edit_operations WHERE id='fixture-0'").get().status!=='written')throw Error('fixture-precondition');
    const before=fs.readFileSync(file);d.exec("UPDATE safe_edit_operations SET status='writing' WHERE id='fixture-0'");
    console.log(JSON.stringify({mainUnchanged:before.equals(fs.readFileSync(file)),status:d.prepare("SELECT status FROM safe_edit_operations WHERE id='fixture-0'").get().status}));
    process.kill(process.pid,'SIGKILL');`);
  expect(r.signal).toBe("SIGKILL"); expect(JSON.parse(r.stdout)).toEqual({ mainUnchanged: true, status: "writing" });
  const report = unchangedInspection(); expect(report.journal.state).toBe("UNSUPPORTED"); expect(report.journal.records).toBeUndefined();
  expect(report.reasons).toContain("WAL_REPLAY_UNSUPPORTED_NO_SOURCE_SQLITE_OPEN");
});
it("source read denial returns a specific sanitized reason without treating absent readback as empty journal", () => {
  seedJournal(1); const before = snapshot(), open = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...args: any[]) => {
    if (String(p).endsWith("/app.sqlite")) throw Object.assign(Error("sensitive-diagnostic-must-not-leak"), { code: "EACCES" });
    return (open as any)(p, ...args);
  }) as typeof fs.openSync);
  const r = inspectEvidence(root);vi.restoreAllMocks();
  expect(r.files["app.sqlite"]).toMatchObject({ state: "UNREADABLE", code: "EACCES" });
  expect(r.reasons).toContain("SQLITE_IMAGE_UNAVAILABLE"); expect(r.journal.state).toBe("UNSUPPORTED");
  expect(JSON.stringify(r)).not.toContain("sensitive-diagnostic-must-not-leak");expect(snapshot()).toEqual(before);
});

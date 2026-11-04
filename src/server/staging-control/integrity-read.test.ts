import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { openApp } from "./inspect";
import { configureIntegrityRead, dbCharacteristics, FULL_INTEGRITY_SQL, fullIntegrity } from "./integrity-read";
import { dbCharacteristicsSchema, INSPECT_CACHE_KIB, MAX_INSPECT_DB_BYTES, type DbReadProfile } from "./read-diagnostics";
import { ReadHold, ReadTiming } from "./read-timing";
import { boundedRead } from "./bounded-read";
import { hash } from "./contract";

const profiles: DbReadProfile["profile"][] = ["baseline", "cache64", "mmap-bounded", "cache64-mmap-bounded"];
let root: string, buildRoot: string, probe: string;
beforeAll(async () => {
  buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ios-integrity-build-")); probe = path.join(buildRoot, "probe.mjs");
  await build({ stdin: { contents: `import {DatabaseSync} from 'node:sqlite'; import fs from 'node:fs';
    import {dbCharacteristics,configureIntegrityRead,fullIntegrity} from './src/server/staging-control/integrity-read';
    const [file,profile]=process.argv.slice(2), db=new DatabaseSync(file,{readOnly:true});
    db.exec('PRAGMA query_only=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF');
    const before=dbCharacteristics(db,{database:{exists:true,bytes:fs.statSync(file).size},wal:{exists:false,bytes:null},shm:{exists:false,bytes:null}});
    const effective=configureIntegrityRead(db,before,profile), start=performance.now();
    db.exec('BEGIN');const result=fullIntegrity(db);db.exec('ROLLBACK');db.close();
    console.log(JSON.stringify({before,effective,result,integrity_ms:performance.now()-start,peak_rss_bytes:process.resourceUsage().maxRSS*1024}));`, resolveDir: process.cwd() },
    outfile: probe, bundle: true, platform: "node", format: "esm", target: "node24" });
});
afterAll(() => fs.rmSync(buildRoot, { recursive: true, force: true }));
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-integrity-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const file = () => path.join(root, "app.sqlite");
function create(sql = "CREATE TABLE t(v TEXT); INSERT INTO t VALUES('private-fixture-content')") {
  const db = new DatabaseSync(file()); db.exec(sql); db.close();
}
function characteristics(db: DatabaseSync) {
  const stat = (suffix: string) => fs.existsSync(file() + suffix) ? { exists: true, bytes: fs.statSync(file() + suffix).size } : { exists: false, bytes: null };
  return dbCharacteristics(db, { database: stat(""), wal: stat("-wal"), shm: stat("-shm") });
}
const snapshot = () => Object.fromEntries(["", "-wal", "-shm"].map(suffix => {
  const p = file() + suffix;
  return [suffix, fs.existsSync(p) ? { bytes: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs, sha256: hash(fs.readFileSync(p)) } : null];
}));

it("uses the unchanged full statement and requires exactly one ok row", () => {
  expect(FULL_INTEGRITY_SQL).toBe("PRAGMA integrity_check(10)");
  const results = [[], [{ integrity_check: "ok" }], [{ integrity_check: "ok" }, { integrity_check: "index error secret" }], [{ integrity_check: "bad /private-path" }]];
  for (const rows of results) {
    const prepare = vi.fn(() => ({ all: () => rows }));
    const result = fullIntegrity({ prepare } as unknown as DatabaseSync);
    expect(prepare).toHaveBeenCalledWith("PRAGMA integrity_check(10)");
    expect(result.ok).toBe(rows.length === 1 && rows[0].integrity_check === "ok");
    expect(JSON.stringify(result)).not.toMatch(/secret|private-path|index error/);
  }
});
it.each(profiles)("%s stays read-only/query-only and changes no persistent configuration or bytes", profile => {
  create(); const beforeBytes = snapshot(), db = openApp(root), before = characteristics(db);
  const exec = vi.spyOn(db, "exec");
  const effective = configureIntegrityRead(db, before, profile);
  const commands = [
    ...(profile.includes("cache64") ? ["PRAGMA main.cache_size=-65536"] : []),
    ...(profile.includes("mmap") ? [`PRAGMA main.mmap_size=${before.database.bytes}`] : []),
  ];
  expect(exec.mock.calls.map(([sql]) => sql)).toEqual(commands);
  expect(effective).toMatchObject({ query_only: 1, foreign_keys: 1, ignore_check_constraints: 0, trusted_schema: 0, persistent_configuration_changes: false });
  expect(fullIntegrity(db).ok).toBe(true);
  expect(() => db.exec("INSERT INTO t VALUES('forbidden')")).toThrow(/readonly/);
  db.exec("PRAGMA query_only=OFF"); // Fixture proves the underlying readOnly open is independent of query_only.
  expect(() => db.exec("DELETE FROM t")).toThrow(/readonly/); db.close();
  expect(snapshot()).toEqual(beforeBytes);
  const reopened = openApp(root); expect(characteristics(reopened)).toEqual(before); reopened.close();
  expect(JSON.stringify({ before, effective })).not.toMatch(/private-fixture-content|ios-integrity-|app\.sqlite|credential/);
});
it("WAL characteristics do not checkpoint or change DB/WAL bytes; only reader-mark SHM slots may change", () => {
  const owner = new DatabaseSync(file()); owner.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(v TEXT); INSERT INTO t VALUES('fixture')");
  const before = snapshot(), shmBefore = fs.readFileSync(file() + "-shm"), db = openApp(root), data = characteristics(db);
  expect(data.wal.exists).toBe(true); expect(data.shm.exists).toBe(true);
  expect(data.wal.bytes).toBeGreaterThan(0); expect(data.shm.bytes).toBeGreaterThan(0);
  configureIntegrityRead(db, data); expect(fullIntegrity(db).ok).toBe(true); db.close();
  const after = snapshot(); expect(after[""]).toEqual(before[""]); expect(after["-wal"]).toEqual(before["-wal"]);
  const shmAfter = fs.readFileSync(file() + "-shm"); expect(shmAfter.length).toBe(shmBefore.length);
  // SQLite WAL-index header aReadMark[5] occupies bytes 100..119. Reader coordination is not canonical content.
  for (let i = 0; i < shmBefore.length; i++) if (shmBefore[i] !== shmAfter[i]) expect(i >= 100 && i < 120).toBe(true);
  owner.close();
});
it.each(profiles)("%s preserves UNIQUE, malformed NOT NULL records and missing-index-entry detection", profile => {
  for (const corruption of ["unique", "not-null", "missing-index"] as const) {
    fs.rmSync(file(), { force: true });
    if (corruption === "unique") {
      create("CREATE TABLE t(v TEXT UNIQUE); INSERT INTO t VALUES('fixture01'),('fixture02')");
      const bytes = fs.readFileSync(file()); let count = 0, at = -1;
      while ((at = bytes.indexOf("fixture02", at + 1)) >= 0) { bytes.write("fixture01", at); count++; }
      expect(count).toBe(2); fs.writeFileSync(file(), bytes);
    } else if (corruption === "not-null") {
      create("CREATE TABLE t(v TEXT NOT NULL); INSERT INTO t VALUES('fixture')");
      const bytes = fs.readFileSync(file()), at = bytes.indexOf("fixture");
      expect(bytes[at - 1]).toBe(27); bytes[at - 1] = 0; fs.writeFileSync(file(), bytes);
    } else {
      create("CREATE TABLE t(v TEXT); CREATE INDEX ix ON t(v); INSERT INTO t VALUES('private-value')");
      const reader = openApp(root); const page = Number(reader.prepare("SELECT rootpage FROM sqlite_schema WHERE name='ix'").get()!.rootpage); reader.close();
      const bytes = fs.readFileSync(file()), offset = (page - 1) * 4096;
      expect(bytes[offset]).toBe(10); // Leaf index page: remove its cells without changing the table.
      bytes.fill(0, offset + 1, offset + 8); bytes.writeUInt16BE(4096, offset + 5); fs.writeFileSync(file(), bytes);
    }
    const before = snapshot(), db = openApp(root);
    configureIntegrityRead(db, characteristics(db), profile);
    const result = fullIntegrity(db); expect(result.ok).toBe(false); expect(result.result_rows).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/private-value|fixture0|sqlite_autoindex|index ix/);
    db.close(); expect(snapshot()).toEqual(before);
  }
});
it("CHECK-constraint behavior is compared with the exact existing readOnly runtime, never claimed beyond that baseline", () => {
  create("CREATE TABLE t(v INTEGER CHECK(v>0)); PRAGMA ignore_check_constraints=ON; INSERT INTO t VALUES(-1); PRAGMA ignore_check_constraints=OFF");
  const results = profiles.map(profile => { const db = openApp(root); configureIntegrityRead(db, characteristics(db), profile); const result = fullIntegrity(db); db.close(); return { profile, ...result }; });
  for (const result of results) expect(result.ok).toBe(results[0].ok);
  // Some SQLite runtimes skip CHECK expressions on a readOnly schema. Report, never mask, this pre-existing limitation.
  console.info(JSON.stringify({ fixture: "check-constraint-readonly-baseline", sqlite_version: process.versions.sqlite, results }));
});
it("malformed database remains HOLD and never exposes the SQLite error or content", () => {
  const prepare = () => { throw Error("private-path credential-value database disk image is malformed"); };
  expect(() => fullIntegrity({ prepare } as unknown as DatabaseSync)).toThrow("FULL_INTEGRITY_QUERY_FAILED_HOLD");
  create(); const bytes = fs.readFileSync(file()); bytes[4096] = 255; fs.writeFileSync(file(), bytes);
  const db = openApp(root);
  try { expect(() => fullIntegrity(db)).toThrow("FULL_INTEGRITY_QUERY_FAILED_HOLD"); } finally { db.close(); }
});
it("mmap is capped at physical database bytes and the accepted logical maximum", () => {
  create(); const db = openApp(root), before = characteristics(db), result = configureIntegrityRead(db, before);
  expect(result.cache_size_effective).toBe(-INSPECT_CACHE_KIB);
  expect(result.mmap_requested_bytes).toBeLessThanOrEqual(before.database.bytes!);
  expect(result.mmap_size_effective).toBeLessThanOrEqual(MAX_INSPECT_DB_BYTES); db.close();
  expect(dbCharacteristicsSchema.safeParse({ ...before, page_count: MAX_INSPECT_DB_BYTES / before.page_size + 1 }).success).toBe(false);
});
it("unsupported mmap remains explicit and uses the cache without weakening full integrity", () => {
  create(); const db = openApp(root), before = characteristics(db), original = db.prepare.bind(db);
  vi.spyOn(db, "prepare").mockImplementation((sql: string) => sql === "PRAGMA mmap_size" ? { get: () => undefined } as ReturnType<DatabaseSync["prepare"]> : original(sql));
  expect(configureIntegrityRead(db, { ...before, mmap_size: null })).toMatchObject({ mmap_size_effective: null, mmap_active: false, cache_size_effective: -INSPECT_CACHE_KIB });
  expect(fullIntegrity(db).ok).toBe(true); db.close();
});
it("query-only or constraint guard mismatch fails before a profile is accepted", () => {
  create(); const db = openApp(root); db.exec("PRAGMA ignore_check_constraints=ON");
  expect(() => characteristics(db)).toThrow("DB_CHARACTERISTICS_UNAVAILABLE_HOLD"); db.close();
});
it("numeric characteristics/profile survive worker SIGKILL in timeout telemetry", async () => {
  create(); const db = openApp(root), before = characteristics(db), effective = configureIntegrityRead(db, before); db.close();
  const stuck = path.join(root, "stuck.mjs");
  const messages = [
    { seq: 1, phase: "db_characteristics", event: "start", elapsed_ms: 0 }, { kind: "db_characteristics", data: before },
    { seq: 2, phase: "db_characteristics", event: "end", elapsed_ms: 1 },
    { seq: 3, phase: "db_read_profile", event: "start", elapsed_ms: 1 }, { kind: "db_read_profile", data: effective },
    { seq: 4, phase: "db_read_profile", event: "end", elapsed_ms: 2 }, { seq: 5, phase: "integrity", event: "start", elapsed_ms: 2 },
  ];
  fs.writeFileSync(stuck, `import fs from 'node:fs'; fs.writeSync(3,${JSON.stringify(messages.map(e => JSON.stringify(e)).join("\n") + "\n")});setInterval(()=>{},1000);`);
  const error: unknown = await boundedRead({ operation: "inspect", root }, pathToFileURL(stuck), 300).catch(e => e);
  expect(error).toBeInstanceOf(ReadHold); if (!(error instanceof ReadHold)) throw Error("HOLD required");
  expect(error.code).toBe("READ_BUDGET_EXCEEDED_HOLD");
  expect(error.timing).toMatchObject({ current_phase: "integrity", db_characteristics: before, db_read_profile: effective });
});
it("diagnostic IPC rejects extra paths/content, duplicate metadata and out-of-phase metadata", () => {
  create(); const db = openApp(root), before = characteristics(db); db.close();
  for (const data of [{ ...before, path: "/private" }, { ...before, cache_size: "credential" }, { ...before, sqlite_version: "secret" }]) {
    const timing = new ReadTiming(); timing.accept(JSON.stringify({ seq: 1, phase: "db_characteristics", event: "start", elapsed_ms: 0 }));
    expect(() => timing.accept(JSON.stringify({ kind: "db_characteristics", data }))).toThrow("READ_TELEMETRY_INVALID_HOLD");
    expect(JSON.stringify(timing.snapshot(1, 8000))).not.toMatch(/private|credential|secret/);
  }
  const timing = new ReadTiming(), event = JSON.stringify({ kind: "db_characteristics", data: before });
  expect(() => timing.accept(event)).toThrow();
  timing.accept(JSON.stringify({ seq: 1, phase: "db_characteristics", event: "start", elapsed_ms: 0 })); timing.accept(event);
  expect(() => timing.accept(event)).toThrow();
});
it("benchmarks bounded profiles on an indexed >192 MiB fixture with unchanged full integrity and bounded RSS", () => {
  const db = new DatabaseSync(file());
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, k TEXT UNIQUE, body BLOB NOT NULL); CREATE INDEX secondary ON t(body,k); BEGIN");
  const insert = db.prepare("INSERT INTO t VALUES(?,?,?)"), body = Buffer.alloc(700, 120);
  for (let i = 0; i < 120_000; i++) insert.run(i, hash(String(i)), body);
  db.exec("COMMIT"); db.close();
  expect(fs.statSync(file()).size).toBeGreaterThan(192 * 1024 * 1024);
  expect(fs.statSync(file()).size).toBeLessThan(MAX_INSPECT_DB_BYTES);
  const before = snapshot(), results: unknown[] = [];
  // Alternate order to reduce ordering bias; OS page cache is warm, not a staging-volume latency simulation.
  for (const profile of [...profiles, ...profiles.slice().reverse()]) {
    const child = spawnSync(process.execPath, [probe, file(), profile], { encoding: "utf8", timeout: 8000, killSignal: "SIGKILL", maxBuffer: 16_384 });
    expect(child.status, profile + " " + child.stderr).toBe(0);
    const result = JSON.parse(child.stdout); results.push(result);
    expect(result.result).toMatchObject({ ok: true, statement: "PRAGMA integrity_check(10)", result_rows: 1 });
    expect(result.peak_rss_bytes).toBeLessThan(512 * 1024 * 1024);
  }
  expect(snapshot()).toEqual(before);
  console.info(JSON.stringify({ benchmark: "full-integrity-session-profiles", fixture_only: true, os_cache: "warm", results }));
}, 60_000);

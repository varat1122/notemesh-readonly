import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { FSWatcher } from "chokidar";

/**
 * P3 S1: the rebuild reuses the nine fixed statements indexFile prepares for
 * every note, within one synchronous batch of at most 50 notes on one
 * connection, and drops them at every yield, failed note, connection change
 * and the end of the loop.
 *
 * These tests watch the native better-sqlite3 surface underneath the guarded
 * facade — db.ts is unchanged and never bypassed — to pin what was compiled,
 * what ran, on which connection, inside which transaction, and whether the D1
 * witness and launch lock were held at that moment. Only counters and object
 * identities are kept: no SQL, source or row data is logged.
 */

const N = 60; // two batches: 50 + 10
const BATCH = 50;
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();
const FIXED = {
  upsertNote: norm(`INSERT INTO notes (path, title, mtime, size, frontmatter, word_count, modified, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET title=excluded.title, mtime=excluded.mtime, size=excluded.size,
    frontmatter=excluded.frontmatter, word_count=excluded.word_count, modified=excluded.modified,
    created=excluded.created RETURNING rowid`),
  deleteFts: "DELETE FROM notes_fts WHERE rowid = ?",
  insertFts: "INSERT INTO notes_fts (rowid, path, title, headings, body) VALUES (?, ?, ?, ?, ?)",
  deleteLinks: "DELETE FROM links WHERE source_path = ?",
  insertLink: "INSERT OR IGNORE INTO links (source_path, target, resolved_path) VALUES (?, ?, NULL)",
  deleteTags: "DELETE FROM tags WHERE path = ?",
  insertTag: "INSERT OR IGNORE INTO tags (path, tag) VALUES (?, ?)",
  deleteTasks: "DELETE FROM tasks WHERE path = ?",
  insertTask: "INSERT OR REPLACE INTO tasks (path, line, text, done) VALUES (?, ?, ?, ?)",
} as const;
type Key = keyof typeof FIXED;
const KEYS = Object.keys(FIXED) as Key[];
const BY_SQL = new Map<string, Key>(KEYS.map((k) => [FIXED[k], k]));
const CREATED_SQL = "SELECT created FROM notes WHERE path = ?";

type Fn = (...args: unknown[]) => unknown;
interface NativeStatement { source: string; database: Database.Database }
interface Use { key: Key; count: number; min: number; max: number; database: Database.Database }
interface Recorder {
  upserts: number;
  order: string[];
  prepareCalls: Record<Key, number>;
  prepared: Record<Key, NativeStatement[]>;
  runs: Record<Key, number>;
  used: Map<NativeStatement, Use>;
  unguarded: number;
  outsideTx: number;
  wrongMethod: number;
  begin: number;
  commit: number;
  rollback: number;
  beforeRun?: (key: Key) => void;
  beforePrepare?: (key: Key) => void;
  afterOther?: (sql: string) => void;
  onOpen?: () => void;
  reset(): void;
}
interface D1StateView { quarantine: string | null; owner?: unknown }

let root: string;
let vault: string;
const restores: (() => void)[] = [];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-s1-reuse-")));
  vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 5).toString("base64");
  delete (globalThis as Record<string, unknown>).__vaultIndexer;
  vi.resetModules();
});

afterEach(async () => {
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
  delete process.env.NOTEMESH_MAINTENANCE;
  const live = (globalThis as Record<string, unknown>).__vaultIndexer as { stop?: () => Promise<void> } | undefined;
  await live?.stop?.();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const pad = (i: number) => String(i).padStart(2, "0");
const witnessPath = () => path.join(root, ".d1-native-outcome.pending");
const lockPath = () => path.join(root, ".d1-native-launch.lock");

// Every note has frontmatter, headings, at least one link, tag and task, in
// varying numbers, under two folders with unique basenames.
function seed(): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < N; i++) {
    const rel = `${i % 2 ? "odd" : "even"}/n${pad(i)}.md`;
    const content = [
      "---", `tags: [fm${i % 3}]`, "---",
      `# Note ${i}`, "", `## Part ${i % 4}`, "",
      `Body ${i} zebra ${"word ".repeat(i % 7)}#t${i % 5}${i % 3 ? "" : " #extra"}`,
      `See [[n${pad((i + 1) % N)}]]${i % 2 ? ` and [[gone-${i}]]` : ""}.`, "",
      `- [ ] task ${i} one`, ...(i % 3 === 1 ? [`- [x] task ${i} two`] : []), "",
    ].join("\n");
    const abs = path.join(vault, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    files.set(rel, content);
  }
  return files;
}

function patch(target: object, name: string, wrap: (orig: Fn) => Fn) {
  const t = target as Record<string, Fn>;
  if (!Object.hasOwn(t, name) || typeof t[name] !== "function") throw Error(`instrumentation_target_missing:${name}`);
  const orig = t[name];
  t[name] = wrap(orig);
  restores.push(() => { t[name] = orig; });
}

// Held by the native launch currently running: a v2 business witness naming
// this operation, pending, and the launch lock it recorded.
function guarded(operation: string): boolean {
  try {
    const w = JSON.parse(fs.readFileSync(witnessPath(), "utf8"));
    const lock = fs.lstatSync(lockPath());
    return w.version === 2 && w.kind === "business" && w.operation === operation &&
      w.phase === "native_launch_pending" && lock.isDirectory() && w.lock.ino === lock.ino && w.lock.dev === lock.dev;
  } catch { return false; }
}

const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<Key, number>;
const none = () => Object.fromEntries(KEYS.map((k) => [k, [] as NativeStatement[]])) as Record<Key, NativeStatement[]>;

// Installed after the connection is open and migrated, so only the work under
// test is counted. Patches the shared native prototypes the guarded facade
// itself calls into; restored after each test.
function instrument(d: Database.Database): Recorder {
  const rec: Recorder = {
    upserts: 0, order: [], prepareCalls: zero(), prepared: none(), runs: zero(), used: new Map(),
    unguarded: 0, outsideTx: 0, wrongMethod: 0, begin: 0, commit: 0, rollback: 0,
    reset() {
      Object.assign(rec, { upserts: 0, order: [], prepareCalls: zero(), prepared: none(), runs: zero(), used: new Map(),
        unguarded: 0, outsideTx: 0, wrongMethod: 0, begin: 0, commit: 0, rollback: 0,
        beforeRun: undefined, beforePrepare: undefined, afterOther: undefined, onOpen: undefined });
    },
  };
  const dbProto = Object.getPrototypeOf(d) as object;
  const stmtProto = Object.getPrototypeOf(d.prepare("SELECT 1")) as object;
  patch(dbProto, "prepare", (orig) => function (this: unknown, ...args: unknown[]) {
    const key = BY_SQL.get(norm(String(args[0])));
    if (!key) return orig.apply(this, args);
    rec.prepareCalls[key]++;
    rec.beforePrepare?.(key);
    if (!guarded("sqlite.step")) rec.unguarded++;
    const statement = orig.apply(this, args) as NativeStatement;
    rec.prepared[key].push(statement);
    return statement;
  });
  patch(dbProto, "exec", (orig) => function (this: unknown, ...args: unknown[]) {
    const sql = String(args[0]);
    if (sql === "BEGIN IMMEDIATE") rec.begin++;
    else if (sql === "COMMIT") rec.commit++;
    else if (sql === "ROLLBACK") rec.rollback++;
    return orig.apply(this, args);
  });
  for (const method of ["run", "get", "all"]) {
    patch(stmtProto, method, (orig) => function (this: NativeStatement, ...args: unknown[]) {
      const key = BY_SQL.get(norm(this.source));
      if (!key) {
        const result = orig.apply(this, args);
        rec.afterOther?.(this.source);
        return result;
      }
      rec.beforeRun?.(key);
      if (method !== (key === "upsertNote" ? "get" : "run")) rec.wrongMethod++;
      const note = key === "upsertNote" ? rec.upserts : rec.upserts - 1;
      if (key === "upsertNote") { rec.upserts++; rec.order.push(String(args[0])); }
      rec.runs[key]++;
      if (!guarded("sqlite.statement")) rec.unguarded++;
      if (!this.database.inTransaction) rec.outsideTx++;
      const use = rec.used.get(this) ?? { key, count: 0, min: note, max: note, database: this.database };
      use.count++; use.min = Math.min(use.min, note); use.max = Math.max(use.max, note);
      rec.used.set(this, use);
      return orig.apply(this, args);
    });
  }
  patch(fs, "openSync", (orig) => function (this: unknown, ...args: unknown[]) {
    const p = String(args[0]);
    if (p.startsWith(vault + path.sep) && p.endsWith(".md")) rec.onOpen?.();
    return orig.apply(this, args);
  });
  return rec;
}

async function load() {
  const files = seed();
  const ix = await import("~/server/vault/indexer");
  const { db, d1DatabaseStatus } = await import("~/server/db");
  const { registry } = await import("~/server/maintenance");
  const rec = instrument(db());
  const state = () =>
    (globalThis as unknown as Record<symbol, Map<string, D1StateView>>)[Symbol.for("notemesh.d1.database-owners.v1")]
      .get(path.join(root, "app.sqlite"))!;
  const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { ...ix, db, d1DatabaseStatus, registry, rec, files, state, count };
}

type Parse = (rel: string, content: string) => { links: string[]; tags: string[]; tasks: unknown[] };
function expectedRuns(files: Map<string, string>, parseNote: Parse, paths: string[] = [...files.keys()]) {
  const r = zero();
  for (const rel of paths) {
    const p = parseNote(rel, files.get(rel)!);
    for (const k of ["upsertNote", "deleteFts", "insertFts", "deleteLinks", "deleteTags", "deleteTasks"] as const) r[k]++;
    r.insertLink += p.links.length;
    r.insertTag += p.tags.length;
    r.insertTask += p.tasks.length;
  }
  return r;
}

// No native statement served notes on both sides of any boundary.
function crossings(rec: Recorder, boundaries: number[]) {
  return [...rec.used.values()].filter((u) => boundaries.some((b) => u.min < b && u.max >= b)).length;
}
const counts = (rec: Recorder, key: Key) => rec.prepared[key].map((s) => rec.used.get(s)?.count ?? 0);

function snapshot(d: Database.Database) {
  const all = (sql: string) => d.prepare(sql).all();
  return {
    notes: all("SELECT rowid AS id, * FROM notes ORDER BY path"),
    fts: all("SELECT rowid AS id, path, title, headings, body FROM notes_fts ORDER BY rowid"),
    links: all("SELECT * FROM links ORDER BY source_path, target"),
    tags: all("SELECT * FROM tags ORDER BY path, tag"),
    tasks: all("SELECT * FROM tasks ORDER BY path, line"),
  };
}

function expectParsed(d: Database.Database, files: Map<string, string>,
  parseNote: typeof import("~/server/vault/indexer").parseNote) {
  for (const [rel, content] of files) {
    const p = parseNote(rel, content);
    const note = d.prepare("SELECT rowid AS id, title, word_count FROM notes WHERE path = ?").get(rel) as
      { id: number; title: string; word_count: number };
    expect(note, rel).toMatchObject({ title: p.title, word_count: p.wordCount });
    expect(d.prepare("SELECT rowid AS id, path, title, headings, body FROM notes_fts WHERE rowid = ?").get(note.id), rel)
      .toEqual({ id: note.id, path: rel, title: p.title, headings: p.headings.join("\n"), body: p.body });
    const col = (sql: string) => (d.prepare(sql).all(rel) as { v: string }[]).map((r) => r.v);
    expect(col("SELECT tag AS v FROM tags WHERE path = ? ORDER BY tag"), rel).toEqual([...new Set(p.tags)].sort());
    expect(col("SELECT target AS v FROM links WHERE source_path = ? ORDER BY target"), rel).toEqual([...new Set(p.links)].sort());
    expect(d.prepare("SELECT line, text, done FROM tasks WHERE path = ? ORDER BY line").all(rel), rel)
      .toEqual(p.tasks.map((t) => ({ line: t.line, text: t.text, done: t.done ? 1 : 0 })).sort((a, b) => a.line - b.line));
  }
}

function expectCleanRebuild(rec: Recorder, files: Map<string, string>, parseNote: Parse) {
  expect(rec.order).toHaveLength(N);
  expect(new Set(rec.order)).toEqual(new Set(files.keys()));
  for (const k of KEYS) {
    expect(rec.prepareCalls[k], k).toBe(2);
    expect(rec.prepared[k], k).toHaveLength(2);
  }
  expect(rec.runs).toEqual(expectedRuns(files, parseNote));
  expect(counts(rec, "upsertNote")).toEqual([BATCH, N - BATCH]);
  expect(counts(rec, "deleteTasks")).toEqual([BATCH, N - BATCH]);
  expect(crossings(rec, [BATCH])).toBe(0);
  const prepared = new Set(KEYS.flatMap((k) => rec.prepared[k]));
  expect([...rec.used.keys()].every((s) => prepared.has(s))).toBe(true);
  expect(new Set([...rec.used.values()].map((u) => u.database)).size).toBe(1);
  expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx, wrongMethod: rec.wrongMethod }).toEqual({ unguarded: 0, outsideTx: 0, wrongMethod: 0 });
  expect({ begin: rec.begin, commit: rec.commit, rollback: rec.rollback }).toEqual({ begin: N + 2, commit: N + 2, rollback: 0 });
}

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("S1 scoped statement reuse in the rebuild note loop", () => {
  it("indexes two batches exactly as the unscoped per-note path does, with nine prepares per batch", async () => {
    const { indexer, reindexPath, parseNote, db, rec, files } = await load();
    await indexer().rebuild();
    expect(indexer().ready).toBe(true);
    expectCleanRebuild(rec, files, parseNote);
    const scoped = snapshot(db());
    expect(scoped.notes).toHaveLength(N);
    expectParsed(db(), files, parseNote);
    const first = new Set(KEYS.flatMap((k) => rec.prepared[k]));

    // The oracle: the tool/watcher path, which passes no scope and prepares
    // all nine for every note, re-indexes every note over the same rows.
    rec.reset();
    for (const rel of files.keys()) reindexPath(rel);
    for (const k of KEYS) {
      expect(rec.prepareCalls[k], k).toBe(N);
      expect(new Set(rec.prepared[k]).size, k).toBe(N);
    }
    expect(rec.runs).toEqual(expectedRuns(files, parseNote));
    expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx, wrongMethod: rec.wrongMethod }).toEqual({ unguarded: 0, outsideTx: 0, wrongMethod: 0 });
    expect({ begin: rec.begin, commit: rec.commit, rollback: rec.rollback }).toEqual({ begin: 2 * N, commit: 2 * N, rollback: 0 });
    expect(snapshot(db())).toEqual(scoped);
    for (const k of KEYS) for (const s of rec.prepared[k]) first.add(s);

    // Nothing survives a rebuild: the next one compiles its own statements.
    rec.reset();
    await indexer().rebuild();
    expectCleanRebuild(rec, files, parseNote);
    expect(KEYS.flatMap((k) => rec.prepared[k]).some((s) => first.has(s))).toBe(false);
    expect(snapshot(db()).notes).toHaveLength(N);
  }, 180_000);

  it("the watcher path still prepares per event and never sees a rebuild's statements", async () => {
    const { indexer, rec, files } = await load();
    const i = indexer();
    await i.start();
    const rebuilt = new Set(KEYS.flatMap((k) => rec.prepared[k]));
    expect(rebuilt.size).toBe(2 * KEYS.length);
    rec.reset();
    const watcher = (i as unknown as { watcher: FSWatcher }).watcher;
    const [a, b] = [...files.keys()];
    watcher.emit("change", path.join(vault, a));
    watcher.emit("change", path.join(vault, a));
    watcher.emit("change", path.join(vault, b));
    for (const k of KEYS) {
      expect(rec.prepareCalls[k], k).toBe(3);
      expect(new Set(rec.prepared[k]).size, k).toBe(3);
      expect(rec.prepared[k].some((s) => rebuilt.has(s)), k).toBe(false);
    }
    expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx }).toEqual({ unguarded: 0, outsideTx: 0 });
    expect({ begin: rec.begin, commit: rec.commit, rollback: rec.rollback }).toEqual({ begin: 3, commit: 3, rollback: 0 });
    expect(i.ready).toBe(true);
    expect(i.lastRebuildError).toBeNull();
  }, 120_000);

  it("a statement failure rolls back only that note and drops the batch's statements", async () => {
    const { indexer, parseNote, db, rec, files, count } = await load();
    quiet();
    let fired = false;
    rec.beforeRun = (key) => {
      if (key === "deleteTags" && rec.upserts === 11 && !fired) {
        fired = true;
        throw Object.assign(new Error("s1_injected_run_failure"), { code: "S1_INJECTED" });
      }
    };
    await expect(indexer().rebuild()).rejects.toThrow(/index_incomplete:1/);
    expect(fired).toBe(true);
    const failed = rec.order[10];
    for (const k of KEYS) expect(rec.prepareCalls[k], k).toBe(3);
    expect(counts(rec, "upsertNote")).toEqual([11, BATCH - 11, N - BATCH]);
    expect(counts(rec, "deleteTasks")).toEqual([10, BATCH - 11, N - BATCH]);
    expect(crossings(rec, [11, BATCH])).toBe(0);
    expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx }).toEqual({ unguarded: 0, outsideTx: 0 });
    expect({ begin: rec.begin, commit: rec.commit, rollback: rec.rollback }).toEqual({ begin: N + 2, commit: N + 1, rollback: 1 });
    expect(count("notes")).toBe(N - 1);
    for (const [table, column] of [["notes", "path"], ["notes_fts", "path"], ["links", "source_path"], ["tags", "path"], ["tasks", "path"]])
      expect((db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(failed) as { n: number }).n, table).toBe(0);

    rec.reset();
    await indexer().rebuild();
    expectCleanRebuild(rec, files, parseNote);
    expect(indexer().ready).toBe(true);
    expect(indexer().lastRebuildError).toBeNull();
    expectParsed(db(), files, parseNote);
  }, 180_000);

  it("a prepare failure rolls back only that note and the next note compiles afresh", async () => {
    const { indexer, parseNote, rec, files, count } = await load();
    quiet();
    let fired = false;
    rec.beforePrepare = (key) => {
      if (key === "insertTask" && rec.upserts === BATCH + 1 && !fired) {
        fired = true;
        throw Object.assign(new Error("s1_injected_prepare_failure"), { code: "S1_INJECTED" });
      }
    };
    await expect(indexer().rebuild()).rejects.toThrow(/index_incomplete:1/);
    expect(fired).toBe(true);
    for (const k of KEYS) expect(rec.prepareCalls[k], k).toBe(3);
    expect(rec.prepared.insertTask).toHaveLength(2);
    expect(counts(rec, "upsertNote")).toEqual([BATCH, 1, N - BATCH - 1]);
    expect(counts(rec, "deleteTasks")).toEqual([BATCH, 1, N - BATCH - 1]);
    expect(crossings(rec, [BATCH, BATCH + 1])).toBe(0);
    expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx }).toEqual({ unguarded: 0, outsideTx: 0 });
    expect({ begin: rec.begin, commit: rec.commit, rollback: rec.rollback }).toEqual({ begin: N + 2, commit: N + 1, rollback: 1 });
    expect(count("notes")).toBe(N - 1);

    rec.reset();
    await indexer().rebuild();
    expectCleanRebuild(rec, files, parseNote);
    expect(indexer().ready).toBe(true);
  }, 180_000);

  it("a connection replaced mid-batch is never reused: the scope re-prepares on the new one", async () => {
    const { indexer, parseNote, db, rec, files } = await load();
    let fired = false;
    rec.onOpen = () => {
      if (rec.upserts === 21 && !fired) { fired = true; db().close(); }
    };
    await indexer().rebuild();
    expect(fired).toBe(true);
    expect(indexer().ready).toBe(true);
    for (const k of KEYS) expect(rec.prepareCalls[k], k).toBe(3);
    const [oldDb, newDb] = [rec.prepared.upsertNote[0].database, rec.prepared.upsertNote[1].database];
    expect(oldDb).not.toBe(newDb);
    expect(oldDb.open).toBe(false);
    expect(newDb.open).toBe(true);
    for (const k of KEYS) expect(rec.prepared[k].map((s) => s.database), k).toEqual([oldDb, newDb, newDb]);
    expect(counts(rec, "upsertNote")).toEqual([21, BATCH - 21, N - BATCH]);
    expect(crossings(rec, [21, BATCH])).toBe(0);
    expect(rec.runs).toEqual(expectedRuns(files, parseNote));
    expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx }).toEqual({ unguarded: 0, outsideTx: 0 });
    expect({ begin: rec.begin, commit: rec.commit, rollback: rec.rollback }).toEqual({ begin: N + 2, commit: N + 2, rollback: 0 });
    expectParsed(db(), files, parseNote);
  }, 180_000);

  it("maintenance before a rebuild refuses it outright: no wipe and nothing compiled", async () => {
    const { indexer, parseNote, rec, files, count } = await load();
    await indexer().rebuild();
    rec.reset();
    process.env.NOTEMESH_MAINTENANCE = "1";
    await expect(indexer().rebuild()).rejects.toThrow("Maintenance is active; the index is not rebuilt");
    expect(KEYS.reduce((n, k) => n + rec.prepareCalls[k], 0)).toBe(0);
    expect(rec.upserts).toBe(0);
    expect(rec.begin).toBe(0);
    delete process.env.NOTEMESH_MAINTENANCE;
    expect(count("notes")).toBe(N);
    rec.reset();
    await indexer().rebuild();
    expectCleanRebuild(rec, files, parseNote);
  }, 180_000);

  interface Hold {
    name: string;
    at: "open" | "created";
    note: number;
    inject(state: D1StateView): void;
    reject: RegExp;
    rollback: number;
    leaves: "none" | "lock" | "witness";
    clear(state: D1StateView): void;
  }
  const LEGACY = '{"version":1}\n';
  const HOLDS: Hold[] = [
    { name: "maintenance raised at the batch boundary", at: "open", note: BATCH, reject: /maintenance/i, rollback: 0, leaves: "none",
      inject: () => { process.env.NOTEMESH_MAINTENANCE = "1"; }, clear: () => { delete process.env.NOTEMESH_MAINTENANCE; } },
    { name: "maintenance raised mid-batch, before a reused statement runs", at: "created", note: 21, reject: /maintenance/i, rollback: 1, leaves: "none",
      inject: () => { process.env.NOTEMESH_MAINTENANCE = "1"; }, clear: () => { delete process.env.NOTEMESH_MAINTENANCE; } },
    { name: "database quarantined mid-batch, before a reused statement runs", at: "created", note: 21, reject: /d1_database_quarantined/, rollback: 1, leaves: "none",
      inject: (s) => { s.quarantine = "s1_injected_hold"; }, clear: (s) => { expect(s.quarantine).toBe("s1_injected_hold"); s.quarantine = null; } },
    { name: "another research owner between notes of a batch", at: "open", note: 21, reject: /d1_research_owner_busy/, rollback: 0, leaves: "none",
      inject: (s) => { s.owner = { id: Symbol("s1"), kind: "research", live: true, deadline: Infinity }; }, clear: (s) => { s.owner = undefined; } },
    { name: "launch lock held at the batch boundary", at: "open", note: BATCH, reject: /d1_native_lock_recovery_hold/, rollback: 0, leaves: "lock",
      inject: () => { fs.mkdirSync(lockPath(), { mode: 0o700 }); }, clear: () => { fs.rmdirSync(lockPath()); } },
    { name: "legacy pending witness mid-batch", at: "open", note: 21, reject: /d1_native_legacy_witness_recovery_hold/, rollback: 0, leaves: "witness",
      inject: () => { fs.writeFileSync(witnessPath(), LEGACY, { mode: 0o600 }); }, clear: () => { fs.unlinkSync(witnessPath()); } },
  ];

  it.each(HOLDS)("$name: denied before any further native work, then a fresh rebuild recovers", async (hold) => {
    const { indexer, parseNote, rec, files, state, count, d1DatabaseStatus, registry } = await load();
    quiet();
    let fired = false;
    const fire = () => { if (rec.upserts === hold.note && !fired) { fired = true; hold.inject(state()); } };
    if (hold.at === "open") rec.onOpen = fire;
    else rec.afterOther = (sql) => { if (sql.startsWith(CREATED_SQL)) fire(); };
    await expect(indexer().rebuild()).rejects.toThrow(hold.reject);
    expect(fired).toBe(true);
    expect(indexer().ready).toBe(false);
    // Nothing fixed ran or compiled once the hold was in place.
    expect(rec.upserts).toBe(hold.note);
    for (const k of KEYS) expect(rec.prepareCalls[k], k).toBe(1);
    expect({ unguarded: rec.unguarded, outsideTx: rec.outsideTx }).toEqual({ unguarded: 0, outsideTx: 0 });
    expect(rec.rollback).toBe(hold.rollback);
    expect(d1DatabaseStatus().openTransactions).toBe(0);
    expect((globalThis as unknown as Record<symbol, unknown>)[Symbol.for("notemesh.d1.native-interlock.v1")])
      .toEqual({ active: false, poisoned: false });
    expect(registry().heldClosed).toBeNull();
    // The indexer left no witness or lock of its own; an injected one is untouched.
    expect(fs.existsSync(lockPath())).toBe(hold.leaves === "lock");
    if (hold.leaves === "witness") expect(fs.readFileSync(witnessPath(), "utf8")).toBe(LEGACY);
    else expect(fs.existsSync(witnessPath())).toBe(false);

    hold.clear(state());
    expect(count("notes")).toBe(hold.note);
    rec.reset();
    await indexer().rebuild();
    expectCleanRebuild(rec, files, parseNote);
    expect(indexer().ready).toBe(true);
    expect(indexer().lastRebuildError).toBeNull();
    expect(count("notes")).toBe(N);
  }, 180_000);
});

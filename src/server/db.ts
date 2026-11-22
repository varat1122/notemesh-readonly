import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import { env } from "./env";
import { maintenanceActive, registerConnection, withD1NativeInterlock } from "./maintenance";
import {c1Pilot} from "./c1-pilot";
import {enrollPilotIdentity} from "../../scripts/c1-pilot-identity.cjs";

// G01 lab: all bundles share ownership. Research never owns a transaction
// across await; Auth's bounded internal-DB exception uses a separate handle.
interface D1Owner { id: symbol; kind: "research" | "auth"; live: boolean; deadline: number; commitUnknown?: Error }
interface D1State {
  research?: Database.Database; auth?: Database.Database;
  context: AsyncLocalStorage<D1Owner>; owner?: D1Owner;
  quarantine: string | null; authWaiting: number; authTail: Promise<void>;
}
const D1_DATABASES = Symbol.for("notemesh.d1.database-owners.v1");
function d1State(): D1State {
  const g = globalThis as unknown as Record<symbol, Map<string, D1State> | undefined>;
  const map = g[D1_DATABASES] ??= new Map();
  let state = map.get(env.dbPath);
  if (!state) {
    state = { context: new AsyncLocalStorage(), quarantine: null, authWaiting: 0, authTail: Promise.resolve() };
    map.set(env.dbPath, state);
  }
  return state;
}
export function assertResearchEntry(): void {
  const s = d1State(), context = s.context.getStore();
  if (s.quarantine) throw Error(`d1_database_quarantined:${s.quarantine}`);
  if (context && (!context.live || context.kind !== "research")) throw Error("d1_research_foreign_context");
  if (s.owner && s.owner !== context) throw Error("d1_research_owner_busy");
  if (maintenanceActive()) throw Error("Maintenance: d1_maintenance_admission_denied");
}
function assertNativeOwner(kind: "research" | "auth", termination = false) {
  const s = d1State(), context = s.context.getStore();
  if (termination && context && context === s.owner) return;
  if (s.quarantine) throw Error(`d1_database_quarantined:${s.quarantine}`);
  if (context && (!context.live || context.kind !== kind || Date.now() > context.deadline))
    throw Error("d1_native_owner_expired_or_foreign");
  if (s.owner && s.owner !== context) throw Error("d1_native_owner_busy");
  if (kind === "auth" && (!context || context !== s.owner)) throw Error("d1_auth_owner_required");
}
function commitUnknown(cause?: unknown): Error {
  const state = d1State(), owner = state.context.getStore();
  state.quarantine = "commit_outcome_unknown";
  const error = owner?.commitUnknown ?? Object.assign(new Error("COMMIT_UNKNOWN", { cause }), { code: "COMMIT_UNKNOWN" });
  if (owner) owner.commitUnknown = error;
  return error;
}
function attachRollbackError(primary: unknown, secondary: unknown) {
  if (primary instanceof Error && primary !== secondary && !Object.hasOwn(primary, "rollbackError")) {
    // Never replace the primary outcome even when an Error is frozen.
    try { Object.defineProperty(primary, "rollbackError", { value: secondary }); } catch { /* Preserve primary. */ }
  }
}
function guardedDatabase(raw: Database.Database, kind: "research" | "auth"): Database.Database {
  const s = d1State();
  const launch = <T>(run: () => T, termination = false, operation = "sqlite.step"): T => {
    assertNativeOwner(kind, termination);
    return withD1NativeInterlock(termination ? "termination" : "business", () => {
      const inTransaction = raw.inTransaction;
      try {
        const result = run();
        if (inTransaction && !raw.inTransaction && !termination &&
            operation !== "sqlite.commit" && operation !== "sqlite.release")
          throw commitUnknown(Error("transaction_ended_outside_owner"));
        return result;
      } catch (error) {
        // Includes implicit transaction termination on native IO failure.
        if (inTransaction && !raw.inTransaction && !termination) throw commitUnknown(error);
        throw error;
      }
    }, { operation,
      uncertainOnError: error => /^SQLITE_(?:IOERR|FULL|CORRUPT|NOTADB)(?:_|$)/.test(String((error as { code?: unknown })?.code)) });
  };
  const statement = (q: Database.Statement, sql: string): Database.Statement => {
    const rollback = /^\s*rollback\s*;?\s*$/i.test(sql);
    const commit = /^\s*(commit|end)\s*;?\s*$/i.test(sql);
    const begin = /^\s*begin(?:\s+(?:deferred|immediate|exclusive))?(?:\s+transaction)?\s*;?\s*$/i.test(sql);
    if ((rollback || commit || begin) && !s.context.getStore()) throw Error("d1_transaction_owner_required");
    const wrapped: Database.Statement = new Proxy(q, { get(target, key) {
      if (key === "database") return facade;
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (["run", "all", "get"].includes(String(key))) return (...args: unknown[]) => {
        try { return launch(() => {
          // Classify while the pre-effect witness still exists, not after its
          // release. Kysely may replace this error with a failed rollback.
          try { return Reflect.apply(value, target, args); }
          catch (error) { if (commit && !raw.inTransaction) throw commitUnknown(error); throw error; }
        }, rollback, commit ? (kind === "research" ? "sqlite.manual_end" : "sqlite.commit") : rollback ? "sqlite.rollback" : "sqlite.statement"); }
        catch (error) {
          if (commit && !raw.inTransaction) throw commitUnknown(error);
          throw error;
        }
      };
      if (key === "iterate") return (...args: unknown[]) => {
        if (!target.readonly) throw Error("d1_mutating_iterator_forbidden");
        const it = launch(() => Reflect.apply(value, target, args)) as Iterator<unknown>;
        return { next: () => launch(() => it.next()), return: () => launch(() => it.return?.() ?? { done: true, value: undefined }),
          [Symbol.iterator]() { return this; } };
      };
      return (...args: unknown[]) => {
        const result = launch(() => Reflect.apply(value, target, args));
        return result === target ? wrapped : result;
      };
    } });
    return wrapped;
  };
  const transaction = (work: (...args: unknown[]) => unknown) => {
    const invoke = (...args: unknown[]) => {
      assertNativeOwner(kind);
      const existing = s.context.getStore();
      if (kind !== "research") throw Error("d1_auth_requires_owned_async_transaction");
      const owner = existing ?? { id: Symbol(), kind: "research" as const, live: true, deadline: Infinity };
      const nested = raw.inTransaction;
      const savepoint = `d1_${crypto.randomBytes(8).toString("hex")}`;
      if (!existing) s.owner = owner;
      return s.context.run(owner, () => {
        try {
          launch(() => raw.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE"));
          const result = work(...args);
          if (result && typeof (result as { then?: unknown }).then === "function") throw Error("d1_research_transaction_await_forbidden");
          if (!raw.inTransaction) throw commitUnknown(Error("transaction_ended_outside_owner"));
          try { launch(() => {
            try { return raw.exec(nested ? `RELEASE ${savepoint}` : "COMMIT"); }
            catch (error) { if (!raw.inTransaction) throw commitUnknown(error); throw error; }
          }, false, nested ? "sqlite.release" : "sqlite.commit"); }
          catch (error) {
            if (!raw.inTransaction) throw commitUnknown(error);
            throw error;
          }
          return result;
        } catch (error) {
          if (raw.inTransaction) {
            try { launch(() => raw.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK"), true); }
            catch (rollbackError) {
              s.quarantine ??= "rollback_unsettled";
              attachRollbackError(error, rollbackError);
            }
          }
          throw error;
        } finally { if (!existing) { owner.live = false; s.owner = undefined; } }
      });
    };
    return Object.assign(invoke, { deferred: invoke, immediate: invoke, exclusive: invoke });
  };
  const facade: Database.Database = new Proxy(raw, { get(target, key) {
    if (key === "prepare") return (sql: string) => {
      const normalized = kind === "auth" && /^\s*begin\s*;?\s*$/i.test(sql) ? "BEGIN IMMEDIATE" : sql;
      const rollback = /^\s*rollback\s*;?\s*$/i.test(normalized);
      return statement(launch(() => target.prepare(normalized), rollback), normalized);
    };
    if (key === "transaction") return transaction;
    if (key === "backup" || key === "loadExtension" || key === "unsafeMode") return () => { throw Error("d1_unsupported_native_surface"); };
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      if (key === "exec" && !s.context.getStore() && /^\s*(begin|commit|end|savepoint|release|rollback)\b/i.test(String(args[0])))
        throw Error("d1_transaction_owner_required");
      const commit = key === "exec" && /^\s*(commit|end)(?:\s+transaction)?\s*;?\s*$/i.test(String(args[0]));
      let result: unknown;
      try {
        result = launch(() => {
          try { return Reflect.apply(value, target, args); }
          catch (error) { if (commit && !raw.inTransaction) throw commitUnknown(error); throw error; }
        }, false, commit ? (kind === "research" ? "sqlite.manual_end" : "sqlite.commit") : `sqlite.${String(key)}`);
      } catch (error) { if (commit && !raw.inTransaction) throw commitUnknown(error); throw error; }
      if (key === "exec" && raw.inTransaction && !s.context.getStore()) {
        s.quarantine = "unowned_transaction";
        throw Error("d1_unowned_transaction");
      }
      return result === target ? facade : result;
    };
  } });
  return facade;
}

function drainConnection(raw: Database.Database) {
  const state = d1State();
  const control = <T>(run: () => T) => {
    if (state.owner) throw Error("d1_drain_owner_live");
    return withD1NativeInterlock("termination", run);
  };
  return {
    get open() { return raw.open; },
    get inTransaction() { return raw.inTransaction; },
    pragma(sql: string, options?: { simple?: boolean }) {
      if (!/^\s*(busy_timeout(?:\s*=\s*\d+)?|query_only(?:\s*=\s*ON)?)\s*$/i.test(sql)) throw Error("d1_control_pragma_refused");
      return control(() => raw.pragma(sql, options));
    },
    exec(sql: string) {
      if (sql !== "BEGIN IMMEDIATE" && sql !== "ROLLBACK") throw Error("d1_control_sql_refused");
      return control(() => raw.exec(sql));
    },
    prepare(sql: string) {
      if (!/^SELECT /i.test(sql)) throw Error("d1_control_read_required");
      const q = control(() => raw.prepare(sql));
      if (!q.readonly) throw Error("d1_control_read_required");
      return { get: () => control(() => q.get()) };
    },
  };
}
export function d1DatabaseStatus() {
  const s = d1State();
  return { ownerActive: Boolean(s.owner), quarantine: s.quarantine,
    openTransactions: [s.research, s.auth].filter(d => d?.open && d.inTransaction).length };
}

export function db(): Database.Database {
  assertResearchEntry();
  const s = d1State();
  if (s.research?.open === false) s.research = undefined;
  const pilot = c1Pilot(s.research);
  if (!s.research) {
    // Only bootstrap the disposable/existing instance before opening SQLite.
    // DATA_DIR is the pre-created isolated instance root. Each child mkdir is
    // a separate primitive; a callback-wide completion permit is not issued.
    if (!fs.statSync(env.dataDir).isDirectory()) throw Error("d1_instance_directory_required");
    for (const dir of [env.vaultDir, env.obHomeDir])
      withD1NativeInterlock("business", () => fs.mkdirSync(dir, { recursive: true }));
    const opened = withD1NativeInterlock("business", () => new Database(env.dbPath, { timeout: 0 }));
    const guarded = guardedDatabase(opened, "research");
    try {
      c1Pilot(guarded);
      guarded.pragma("synchronous = FULL");
      guarded.pragma("journal_mode = WAL");
      guarded.pragma("foreign_keys = ON");
      if (pilot) enrollPilotIdentity(guarded);
      migrate(guarded);
      registerConnection(drainConnection(opened));
      s.research = guarded;
    } catch (error) {
      try { withD1NativeInterlock("termination", () => opened.close()); } catch { s.quarantine = "bootstrap_close_unsettled"; }
      throw error;
    }
  }
  return s.research;
}

/** Lab-only Auth queue: bounded waiting, no synchronous BUSY sleep. Native
 * ownership is checked for each launch; expiry is denial, not cancellation. */
export async function withAuthDatabaseOwner<T>(work: (connection: Database.Database) => Promise<T>): Promise<T> {
  const s = d1State(), inherited = s.context.getStore();
  if (inherited) {
    if (inherited !== s.owner || inherited.kind !== "auth" || !inherited.live) throw Error("d1_auth_owner_mismatch");
    return work(s.auth!);
  }
  if (s.authWaiting >= 16) throw Error("d1_auth_queue_full");
  // Bootstrap Research schema synchronously before an Auth transaction exists.
  if (!s.research) db();
  const predecessor = s.authTail;
  let release!: () => void;
  s.authTail = new Promise<void>(resolve => { release = resolve; });
  s.authWaiting++;
  const queuedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([predecessor, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error("d1_auth_queue_deadline")), 2000);
    })]);
  } catch (error) {
    // Expired tickets cannot let later callers overtake the unsettled owner.
    void predecessor.then(release);
    throw error;
  } finally { clearTimeout(timer); s.authWaiting--; }
  const owner: D1Owner = { id: Symbol(), kind: "auth", live: true, deadline: queuedAt + 2000 };
  try {
    if (Date.now() > owner.deadline || s.owner || s.quarantine) throw Error("d1_auth_admission_hold");
    s.owner = owner;
    return await s.context.run(owner, async () => {
      if (!s.auth || !s.auth.open) {
        const raw = withD1NativeInterlock("business", () => new Database(env.dbPath, { timeout: 0 }));
        const guarded = guardedDatabase(raw, "auth");
        try {
          guarded.pragma("synchronous = FULL");
          guarded.pragma("foreign_keys = ON");
          registerConnection(drainConnection(raw));
          // Publish only the fully configured handle; a transient failure
          // must not make retry reuse SQLite's default durability settings.
          s.auth = guarded;
        } catch (error) {
          try { withD1NativeInterlock("termination", () => raw.close()); }
          catch (closeError) {
            s.quarantine ??= "auth_bootstrap_close_unsettled";
            s.auth = guarded; // Retain ownership under quarantine, never reuse.
            attachRollbackError(error, closeError);
          }
          throw error;
        }
      }
      let primary: unknown;
      let failed = false;
      let result: T | undefined;
      try { result = await work(s.auth); }
      catch (error) { primary = error; failed = true; }
      // Kysely can replace COMMIT's exception with its own failed ROLLBACK.
      // The owner retained the original native uncertainty before that await.
      // It stays terminal even if caller code swallowed the adapter exception.
      if (owner.commitUnknown) {
        if (failed) attachRollbackError(owner.commitUnknown, primary);
        primary = owner.commitUnknown; failed = true;
      }
      try {
        if (s.auth.inTransaction) s.auth.prepare("ROLLBACK").run();
      } catch (error) {
        s.quarantine ??= "auth_rollback_unsettled";
        if (!failed) { failed = true; primary = error; }
        else attachRollbackError(primary, error);
      }
      if (failed) throw primary;
      return result as T;
    });
  } finally { owner.live = false; if (s.owner === owner) s.owner = undefined; release(); }
}

// App-owned tables. Better Auth manages its own tables in the same file via
// its runtime migrator (see auth.ts).
function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS notes (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      frontmatter TEXT,          -- JSON object or null
      word_count INTEGER NOT NULL DEFAULT 0,
      modified INTEGER,          -- last change as a person means it; see vault/modified.ts
      created INTEGER            -- first appearance, the same way
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path UNINDEXED,
      title,
      headings,
      body,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS links (
      source_path TEXT NOT NULL,
      target TEXT NOT NULL,        -- raw link target as written
      resolved_path TEXT,          -- resolved note path, null if unresolved
      PRIMARY KEY (source_path, target)
    );
    CREATE INDEX IF NOT EXISTS idx_links_resolved ON links(resolved_path);

    -- Non-markdown vault files (images, PDFs, audio…). Tracked so that embeds
    -- like ![[Diagram.png]] resolve instead of being reported as broken links.
    CREATE TABLE IF NOT EXISTS attachments (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      modified INTEGER,
      created INTEGER
    );

    CREATE TABLE IF NOT EXISTS tags (
      path TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (path, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

    CREATE TABLE IF NOT EXISTS tasks (
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL,
      PRIMARY KEY (path, line)
    );
    -- Original source bytes are stored separately outside Obsidian Vault.
    -- This is an additive index/lineage registry; no historical Vault
    -- original source or protected Thesis is rewritten by the archive.
    CREATE TABLE IF NOT EXISTS source_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      original_source TEXT NOT NULL,
      source_key TEXT NOT NULL,
      sha256 TEXT NOT NULL CHECK(length(sha256)=64),
      byte_length INTEGER NOT NULL CHECK(byte_length > 0),
      revision INTEGER NOT NULL CHECK(revision > 0),
      captured_at TEXT NOT NULL,
      content_type TEXT NOT NULL,
      capture_method TEXT NOT NULL,
      retrieved_from TEXT NOT NULL,
      operator_label TEXT NOT NULL,
      response_etag TEXT,
      response_last_modified TEXT,
      UNIQUE(source_key,sha256),
      UNIQUE(source_key,revision)
    );
    CREATE INDEX IF NOT EXISTS idx_source_snapshots_source_rev ON source_snapshots(source_key,revision);

    -- Server-controlled primary CLAIM adjudications, intentionally separate
    -- from caller-authored Vault notes and Safe Edit source receipts. There is
    -- no MCP insert/update surface for this table. An independently authorized
    -- operator workflow must issue an approval before one can be consumed.
    CREATE TABLE IF NOT EXISTS primary_claim_verifications (
      receipt_id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES source_snapshots(snapshot_id),
      source_sha256 TEXT NOT NULL,
      original_source TEXT NOT NULL,
      entity TEXT NOT NULL,
      metric TEXT NOT NULL,
      period TEXT NOT NULL,
      unit TEXT NOT NULL,
      verified_value TEXT NOT NULL,
      source_locator TEXT NOT NULL,
      raw_source_excerpt TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      primary_origin_adjudicated INTEGER NOT NULL DEFAULT 0 CHECK(primary_origin_adjudicated IN (0,1)),
      conflicting_values_adjudicated INTEGER NOT NULL DEFAULT 0 CHECK(conflicting_values_adjudicated IN (0,1)),
      status TEXT NOT NULL CHECK(status IN ('approved','revoked'))
    );
    CREATE INDEX IF NOT EXISTS idx_primary_claim_verifications_snapshot
      ON primary_claim_verifications(snapshot_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_claim_exact_scope
      ON primary_claim_verifications(snapshot_id,lower(entity),lower(metric),lower(period),lower(unit),verified_value);
    -- One-way revocation and append-only audit. Neither approval state nor
    -- past observations can be silently restored by an ordinary app action.
    CREATE TABLE IF NOT EXISTS primary_claim_receipt_revocations (
      receipt_id TEXT PRIMARY KEY REFERENCES primary_claim_verifications(receipt_id),
      revoked_at TEXT NOT NULL,
      revoked_by TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS primary_claim_receipt_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL,
      event TEXT NOT NULL CHECK(event IN ('issued','revoked')),
      occurred_at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL
    );
  `);
  // Additive columns for databases created before them. The index is rebuilt
  // at every boot, so a new column needs no backfill beyond existing.
  addColumn(d, "notes", "modified", "INTEGER");
  addColumn(d, "attachments", "modified", "INTEGER");
  addColumn(d, "notes", "created", "INTEGER");
  addColumn(d, "attachments", "created", "INTEGER");
  // Additive for staging databases that initialized the draft table before
  // the signed-issuance extension. Unsigned legacy entries fail closed.
  addColumn(d, "primary_claim_verifications", "reviewed_at", "TEXT");
  addColumn(d, "primary_claim_verifications", "reviewer_key_id", "TEXT");
  addColumn(d, "primary_claim_verifications", "reviewer_signature", "TEXT");
  addColumn(d, "primary_claim_verifications", "approver_key_id", "TEXT");
  addColumn(d, "primary_claim_verifications", "approver_signature", "TEXT");
  addColumn(d, "primary_claim_verifications", "counter_claims_json", "TEXT");
  d.exec(`
    CREATE TRIGGER IF NOT EXISTS primary_claim_approved_immutable_update
      BEFORE UPDATE ON primary_claim_verifications
      BEGIN SELECT RAISE(ABORT,'primary_claim_receipt_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS primary_claim_approved_immutable_delete
      BEFORE DELETE ON primary_claim_verifications
      BEGIN SELECT RAISE(ABORT,'primary_claim_receipt_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS primary_claim_revocation_immutable_update
      BEFORE UPDATE ON primary_claim_receipt_revocations
      BEGIN SELECT RAISE(ABORT,'primary_claim_revocation_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS primary_claim_revocation_immutable_delete
      BEFORE DELETE ON primary_claim_receipt_revocations
      BEGIN SELECT RAISE(ABORT,'primary_claim_revocation_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS primary_claim_event_immutable_update
      BEFORE UPDATE ON primary_claim_receipt_events
      BEGIN SELECT RAISE(ABORT,'primary_claim_event_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS primary_claim_event_immutable_delete
      BEFORE DELETE ON primary_claim_receipt_events
      BEGIN SELECT RAISE(ABORT,'primary_claim_event_immutable'); END;
  `);
}

function addColumn(d: Database.Database, table: string, column: string, type: string) {
  const columns = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getSetting(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    )
    .run(key, value);
}

export function deleteSetting(key: string) {
  db().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

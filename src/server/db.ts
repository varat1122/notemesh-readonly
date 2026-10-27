import Database from "better-sqlite3";
import { env, ensureDataDirs } from "./env";

let _db: Database.Database | undefined;

export function db(): Database.Database {
  if (!_db) {
    ensureDataDirs();
    _db = new Database(env.dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
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

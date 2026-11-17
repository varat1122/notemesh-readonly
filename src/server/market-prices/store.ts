import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import Database from "better-sqlite3";
import { inProcessDrWriterFence } from "../backup/writer-fence.ts";
import { instrument, isoDate, PRICE_POLICY, PriceError, type InstrumentInput, type PriceBar, type PriceSnapshot } from "./model.ts";
import { priceRights } from "./rights.ts";
import { prepareHistoryBatch, historyHash, HISTORY_IMPORT_SCHEMA, HISTORY_SOURCE_SCHEMA, SYNTHETIC_HISTORY_REF,
  type HistoryImportOptions, type HistoryImportResult, type HistoryReceipt } from "./history-import.ts";

export function priceDatabaseLimit(): number {
  const mb = Number(process.env.MARKET_PRICES_MAX_DB_MB ?? "4");
  if (![4, 8, 16].includes(mb)) throw new PriceError("invalid_price_database_limit");
  return mb * 1024 * 1024;
}
const DISK_RESERVE = 50 * 1000 * 1000;
export function priceDbPath(): string {
  const data = path.resolve(process.env.DATA_DIR ?? "./data");
  const dir = path.resolve(process.env.MARKET_PRICES_DIR ?? path.join(data, "market-prices"));
  const vault = path.join(data, "vault");
  const canonical = (value: string): string => {
    const rest: string[] = [];
    let cursor = value;
    while (!fs.existsSync(cursor)) { rest.unshift(path.basename(cursor)); cursor = path.dirname(cursor); }
    return path.join(fs.realpathSync(cursor), ...rest);
  };
  const relative = path.relative(canonical(vault), canonical(dir));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new PriceError("price_database_must_be_outside_vault");
  }
  return path.join(dir, "prices.sqlite");
}

export class PriceStore {
  readonly db: Database.Database;
  readonly filename: string;
  readonly writable: boolean;
  readonly memory: boolean;
  private releaseWriter: (()=>void)|null = null;
  #disposableHistoryFixture = false;

  /** The only admitted import target in v0: a newly allocated disposable test DB.
   * No path/flag from a caller can turn an existing runtime DB into this target.
   */
  static createDisposableHistoryFixture(): { store: PriceStore; root: string } {
    if (process.env.NODE_ENV !== "test") throw new PriceError("D1_HOLD");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-history-fixture-"));
    try {
      const store = new PriceStore(path.join(root, "market-prices", "prices.sqlite"), true);
      store.#disposableHistoryFixture = true;
      return { store, root };
    } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
  }
  constructor(filename: string | Buffer, writable = false) {
    this.memory = Buffer.isBuffer(filename) || filename === ":memory:";
    this.filename = typeof filename === "string" ? filename : ":memory:";
    this.writable = writable;
    // Keep one admission ticket for the entire writable on-disk SQLite
    // handle lifetime, including direct PriceStore.db calls. Otherwise the
    // freeze could begin between write methods while a caller held the DB.
    this.releaseWriter = writable && !this.memory ?
      inProcessDrWriterFence.acquireWriteTicket("market_price_sqlite") : null;
    let opened: Database.Database | null = null;
    try {
    if (!this.memory) try {
      const stats = fs.lstatSync(filename);
      if (stats.isSymbolicLink() || stats.nlink > 1) throw new PriceError("linked_price_database_refused");
      if (writable && stats.size > priceDatabaseLimit()) throw new PriceError("price_database_exceeds_configured_limit");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (writable && !this.memory) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      this.assertSpace();
    }
    this.db = new Database(filename, { readonly: !writable, fileMustExist: !writable, timeout: 5000 });
    opened = this.db;
    this.db.pragma("foreign_keys = ON");
    if (writable) {
      // DELETE journal bounds disk usage and allows safe read-only clients without creating a WAL.
      this.db.pragma("journal_mode = DELETE");
      this.db.pragma("synchronous = FULL");
      const pageSize = this.db.pragma("page_size", { simple: true }) as number;
      this.db.pragma(`max_page_count = ${Math.floor(priceDatabaseLimit() / pageSize)}`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS instruments (
          id TEXT PRIMARY KEY, market TEXT NOT NULL, symbol TEXT NOT NULL, yahoo_symbol TEXT NOT NULL,
          currency TEXT NOT NULL, time_zone TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bars (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL,
          open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
          volume INTEGER NOT NULL CHECK(volume >= 0), adjusted_close REAL, fetched_at TEXT NOT NULL,
          PRIMARY KEY(instrument_id,date),
          CHECK(open>0 AND close>0 AND low>0 AND high>=open AND high>=close AND high>=low AND low<=open AND low<=close)
        );
        CREATE TABLE IF NOT EXISTS actions (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), event_key TEXT NOT NULL, date TEXT NOT NULL,
          kind TEXT NOT NULL, value REAL NOT NULL, denominator REAL, fetched_at TEXT NOT NULL,
          PRIMARY KEY(instrument_id,event_key)
        );
        CREATE TABLE IF NOT EXISTS refreshes (
          id INTEGER PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id), attempted_at TEXT NOT NULL,
          success INTEGER NOT NULL, error_code TEXT, row_count INTEGER, inserted INTEGER, revised INTEGER,
          missing_bars INTEGER, excluded_current INTEGER, payload_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS refreshes_instrument ON refreshes(instrument_id,id DESC);
        CREATE TABLE IF NOT EXISTS revisions (
          id INTEGER PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL,
          observed_at TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collector_lease (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, expires_at INTEGER NOT NULL);
        -- Additive extension: retain legacy full bars without rewriting their schema/history.
        CREATE TABLE IF NOT EXISTS partial_bars (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL,
          open REAL, high REAL, low REAL, close REAL NOT NULL CHECK(close>0),
          volume INTEGER CHECK(volume IS NULL OR volume>=0), adjusted_close REAL, fetched_at TEXT NOT NULL,
          PRIMARY KEY(instrument_id,date),
          CHECK((open IS NULL AND high IS NULL AND low IS NULL) OR
            (open IS NOT NULL AND high IS NOT NULL AND low IS NOT NULL AND open>0 AND low>0 AND high>=open AND high>=close AND high>=low AND low<=open AND low<=close))
        );
        CREATE TABLE IF NOT EXISTS series_metadata (instrument_id TEXT PRIMARY KEY REFERENCES instruments(id), metadata_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS quality_issues (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL, reason TEXT NOT NULL,
          values_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, resolved_at TEXT,
          PRIMARY KEY(instrument_id,date,reason)
        );
      `);
    } else this.db.pragma("query_only = ON");
    } catch (error) {
      try { opened?.close(); } catch { /* Preserve original open/migration failure. */ }
      this.releaseWriter?.();
      this.releaseWriter = null;
      throw error;
    }
  }

  assertSpace(): void {
    // Drive mode uses a bounded, private in-memory DB; it never writes a local price file.
    if (this.memory) return;
    const stats = fs.statfsSync(path.dirname(this.filename));
    // Reserve one full DB rollback journal plus the existing application's database, if larger.
    const appDb = path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "app.sqlite");
    let appBytes = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      try { appBytes += fs.statSync(appDb + suffix).size; } catch { /* Absent in standalone CLI. */ }
    }
    const availableBytes = stats.bavail * stats.bsize, applicationReserveBytes = Math.max(DISK_RESERVE, appBytes);
    const priceBudgetBytes = priceDatabaseLimit() * 2;
    if (availableBytes < applicationReserveBytes + priceBudgetBytes) throw new PriceError("insufficient_price_disk_reserve",
      { availableBytes, applicationIndexBytes: appBytes, applicationReserveBytes, priceBudgetBytes,
        requiredAvailableBytes: applicationReserveBytes + priceBudgetBytes });
  }

  close(): void {
    try { this.db.close(); }
    finally {
      const release = this.releaseWriter;
      this.releaseWriter = null;
      release?.();
    }
  }

  acquireLease(now: Date): string | null {
    if (!this.writable) throw new PriceError("read_only_price_store");
    const token = crypto.randomUUID();
    const result = this.db.prepare(`INSERT INTO collector_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET
      token=excluded.token,expires_at=excluded.expires_at WHERE collector_lease.expires_at<=?`)
      .run(token, now.getTime() + 3 * 60 * 60 * 1000, now.getTime());
    return result.changes ? token : null;
  }
  releaseLease(token: string): void {
    this.db.prepare("DELETE FROM collector_lease WHERE id=1 AND token=?").run(token);
  }

  ensureInstrument(input: InstrumentInput): void {
    const i = instrument(input);
    this.db.prepare(`INSERT OR IGNORE INTO instruments VALUES (?,?,?,?,?,?)`).run(i.id, i.market, i.symbol, i.yahooSymbol, i.currency, i.timeZone);
  }

  private hasPartialBars() { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='partial_bars'").get(); }
  private barSource() { return this.hasPartialBars() ? "(SELECT * FROM bars UNION ALL SELECT * FROM partial_bars)" : "bars"; }
  private hasTable(name: string) { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  private seriesMetadata(id: string): Record<string, unknown> | null {
    if (!this.hasTable("series_metadata")) return null;
    const row = this.db.prepare("SELECT metadata_json FROM series_metadata WHERE instrument_id=?").get(id) as { metadata_json: string } | undefined;
    return row ? JSON.parse(row.metadata_json) as Record<string, unknown> : null;
  }
  private assertUniqueBarKeys(id: string): void {
    if (this.hasPartialBars() && this.db.prepare(`SELECT 1 FROM bars b JOIN partial_bars p
      ON b.instrument_id=p.instrument_id AND b.date=p.date WHERE b.instrument_id=? LIMIT 1`).get(id)) throw new PriceError("ambiguous_price_bar_key");
  }

  /** One-source/one-listing import through this native Store, lease and SQLite transaction.
   * Real-file admission is deliberately unavailable until ORCH proves native D1/recovery.
   * Default does not parse, write, or replace either existing preview/audit command.
   */
  importHistory(bytes: Uint8Array, options: HistoryImportOptions = {}): HistoryImportResult {
    const fileSha256 = historyHash(bytes);
    const hold = (status: HistoryImportResult["status"], reason: string): HistoryImportResult => ({ status, applied: false, fileSha256, reason });
    if (options.mode !== "APPLY") return hold("NO_APPLY", "explicit_disposable_fixture_apply_required");
    if (!this.#disposableHistoryFixture || !this.writable || process.env.NODE_ENV !== "test") return hold("D1_HOLD", "native_runtime_admission_recovery_not_proven");
    if (options.rights?.scope !== "synthetic_fixture_only" || options.rights.evidenceRef !== SYNTHETIC_HISTORY_REF) return hold("RIGHTS_HOLD", "synthetic_storage_scope_required");
    if (options.mapping?.instrumentId !== "US:AAPL" || options.mapping.currency !== "USD" || options.mapping.evidenceRef !== SYNTHETIC_HISTORY_REF) return hold("MAPPING_HOLD", "exact_synthetic_mapping_required");
    const now = new Date();
    let batch: ReturnType<typeof prepareHistoryBatch>;
    try { batch = prepareHistoryBatch(bytes, now); }
    catch (error) {
      return hold(error instanceof PriceError && error.code === "real_file_apply_requires_D1" ? "D1_HOLD" : "INPUT_HOLD",
        error instanceof PriceError ? error.code : "invalid_history_csv");
    }
    this.assertSpace();
    return this.db.transaction((): HistoryImportResult => {
      const id = batch.target.id;
      const metadata = this.seriesMetadata(id);
      const old = this.db.prepare(`SELECT date,open,high,low,close,volume,adjusted_close AS adjustedClose FROM ${this.barSource()} WHERE instrument_id=? ORDER BY date`).all(id) as PriceBar[];
      const conflict = (reason: string, existing: unknown, incoming: unknown): HistoryImportResult => ({ ...hold("HOLD_CONFLICT", reason), conflict: { existing, incoming } });
      if (new Set(old.map(b => b.date)).size !== old.length) return conflict("ambiguous_price_bar_key", metadata, batch.rows);
      if ((metadata && (metadata.source !== batch.source || metadata.priceBasis !== batch.priceBasis || metadata.sourceRef !== batch.sourceRef)) || (old.length && !metadata)) {
        return conflict("source_or_basis_conflict", { series: metadata, dates: old.map(b => b.date) }, { source: batch.source, sourceRef: batch.sourceRef, priceBasis: batch.priceBasis, fileSha256 });
      }
      const hasProvenance = this.hasTable("history_bar_provenance");
      const previous = new Map(old.map(b => [b.date, b]));
      const additions = [] as typeof batch.rows;
      for (const row of batch.rows) {
        const prior = previous.get(row.date);
        const provenance = hasProvenance ? this.db.prepare("SELECT value_hash,provenance_json FROM history_bar_provenance WHERE instrument_id=? AND date=?").get(id, row.date) as { value_hash: string; provenance_json: string } | undefined : undefined;
        if (prior && (!provenance || provenance.value_hash !== row.inputValueHash ||
          ["open", "high", "low", "close", "volume", "adjustedClose"].some(k => prior[k as keyof PriceBar] !== row[k as keyof PriceBar]))) {
          return conflict("overlapping_history_conflict", { bar: prior, provenance: provenance ? JSON.parse(provenance.provenance_json) : metadata }, { bar: row, source: batch.source, priceBasis: batch.priceBasis, fileSha256 });
        }
        if (!prior && provenance) return conflict("orphan_history_provenance", provenance, row);
        if (this.db.prepare("SELECT 1 FROM quality_issues WHERE instrument_id=? AND date=? AND resolved_at IS NULL").get(id, row.date)) return conflict("unresolved_quality_issue", { date: row.date }, row);
        if (!prior) additions.push(row);
      }
      const receiptId = historyHash(JSON.stringify([HISTORY_IMPORT_SCHEMA, id, fileSha256]));
      const replay = this.hasTable("history_import_receipts") ? this.db.prepare("SELECT receipt_json FROM history_import_receipts WHERE receipt_id=?").get(receiptId) as { receipt_json: string } | undefined : undefined;
      if (replay) {
        if (additions.length) return conflict("receipt_readback_drift", JSON.parse(replay.receipt_json), batch.rows);
        return { status: "IDEMPOTENT", applied: false, fileSha256, receipt: JSON.parse(replay.receipt_json) as HistoryReceipt };
      }
      const token = this.acquireLease(now);
      if (!token) return hold("WRITER_BUSY", "collector_lease_active");
      try {
        this.ensureInstrument(batch.target);
        // Metadata belongs to this same SQLite database and commits with its bars.
        this.db.exec(`CREATE TABLE IF NOT EXISTS history_import_receipts (
          receipt_id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id),
          file_sha256 TEXT NOT NULL, revision INTEGER NOT NULL, receipt_json TEXT NOT NULL,
          UNIQUE(instrument_id,revision));
          CREATE TABLE IF NOT EXISTS history_source_versions (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), revision INTEGER NOT NULL, record_json TEXT NOT NULL,
          PRIMARY KEY(instrument_id,revision));
          CREATE TABLE IF NOT EXISTS history_bar_provenance (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL, value_hash TEXT NOT NULL,
          provenance_json TEXT NOT NULL, PRIMARY KEY(instrument_id,date));`);
        const revision = (this.db.prepare("SELECT COALESCE(MAX(revision),0)+1 AS n FROM history_import_receipts WHERE instrument_id=?").get(id) as { n: number }).n;
        const importedAt = now.toISOString();
        for (const row of additions) {
          const table = row.open === null || row.volume === null ? "partial_bars" : "bars";
          // No UPSERT and no deletion of a competing source/representation.
          this.db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?)`).run(id, row.date, row.open, row.high, row.low, row.close, row.volume, row.adjustedClose, importedAt);
          this.db.prepare("INSERT INTO history_bar_provenance VALUES (?,?,?,?)").run(id, row.date, row.inputValueHash, JSON.stringify({
            source: batch.source, sourceRef: batch.sourceRef, dataOrigin: "synthetic_fixture", priceBasis: batch.priceBasis,
            fileSha256, receiptId, revision, sourceLine: row.sourceLine, decimalValues: row.decimalValues,
            observedAt: row.observedAt, retrievedAt: row.retrievedAt, importedAt, independentVerification: false,
          }));
        }
        const total = this.db.prepare(`SELECT COUNT(*) AS rows,MIN(date) AS firstSession,MAX(date) AS lastSession FROM ${this.barSource()} WHERE instrument_id=?`).get(id) as { rows: number; firstSession: string; lastSession: string };
        const receipt: HistoryReceipt = { schema: HISTORY_IMPORT_SCHEMA, receiptId, fileSha256, source: batch.source,
          dataOrigin: "synthetic_fixture", instrumentId: id, sourceRef: batch.sourceRef, priceBasis: batch.priceBasis,
          importedAt, revision, sourceRecordVersion: HISTORY_SOURCE_SCHEMA, inserted: additions.length,
          unchanged: batch.rows.length - additions.length, inputRows: batch.rows.length, totalRows: total.rows,
          coverage: { ...total, officialCalendarVerified: false }, rights: { status: "SYNTHETIC_ONLY_NOT_ENTITLED", evidenceRef: options.rights!.evidenceRef },
          mappingEvidenceRef: options.mapping!.evidenceRef, independentVerification: false };
        this.db.prepare("INSERT INTO history_import_receipts VALUES (?,?,?,?,?)").run(receiptId, id, fileSha256, revision, JSON.stringify(receipt));
        const sourceRecord = { schema: HISTORY_SOURCE_SCHEMA, revision, receiptId, source: batch.source, sourceRef: batch.sourceRef,
          fileSha256, priceBasis: batch.priceBasis, dataOrigin: "synthetic_fixture", rights: receipt.rights,
          mappingVerification: "synthetic_fixture_only_not_independently_verified", coverage: receipt.coverage, importedAt };
        this.db.prepare("INSERT INTO history_source_versions VALUES (?,?,?)").run(id, revision, JSON.stringify(sourceRecord));
        this.db.prepare("INSERT INTO series_metadata VALUES (?,?) ON CONFLICT(instrument_id) DO UPDATE SET metadata_json=excluded.metadata_json")
          .run(id, JSON.stringify({ ...sourceRecord, seriesSchemaVersion: 2, instrument: batch.target }));
        this.db.prepare(`INSERT INTO refreshes(instrument_id,attempted_at,success,row_count,inserted,revised,payload_hash)
          VALUES (?,?,1,?,?,0,?)`).run(id, importedAt, batch.rows.length, additions.length, fileSha256);
        return { status: "APPLIED_SYNTHETIC", applied: true, fileSha256, receipt };
      } finally { this.releaseLease(token); }
    }).immediate();
  }

  lastAttempt(input: InstrumentInput): { attempted_at: string; success: number; error_code: string | null } | undefined {
    return this.db.prepare("SELECT attempted_at,success,error_code FROM refreshes WHERE instrument_id=? ORDER BY id DESC LIMIT 1")
      .get(instrument(input).id) as { attempted_at: string; success: number; error_code: string | null } | undefined;
  }

  providerCoolingDown(now: Date): boolean {
    return !!this.db.prepare(`SELECT 1 FROM refreshes WHERE error_code IN ('provider_rate_limited','provider_http_401','provider_http_403')
      AND attempted_at > ? LIMIT 1`).get(new Date(now.getTime() - 60 * 60 * 1000).toISOString());
  }

  failure(input: InstrumentInput, code: string, now: Date): void {
    if (!this.writable) throw new PriceError("read_only_price_store");
    this.assertSpace();
    this.db.transaction(() => {
      this.ensureInstrument(input);
      this.db.prepare("INSERT INTO refreshes(instrument_id,attempted_at,success,error_code) VALUES (?,?,0,?)")
        .run(instrument(input).id, now.toISOString(), code);
      this.pruneAudit();
    })();
  }

  save(snapshot: PriceSnapshot): { inserted: number; revised: number; unchanged: number; rowCount: number } {
    if (!this.writable) throw new PriceError("read_only_price_store");
    this.assertSpace();
    const id = snapshot.instrument.id;
    const expected = instrument(snapshot.instrument);
    // The provider parser is the only producer; also validate at this persistence boundary.
    if (id !== expected.id || snapshot.instrument.currency !== expected.currency || snapshot.instrument.timeZone !== expected.timeZone ||
      snapshot.instrument.yahooSymbol !== expected.yahooSymbol || snapshot.source !== "yahoo-chart" || !snapshot.bars.length || snapshot.bars.length > 10000 ||
      !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new PriceError("invalid_snapshot");
    for (const bar of snapshot.bars) {
      isoDate.parse(bar.date);
      const full = bar.open !== null && bar.high !== null && bar.low !== null;
      const closeOnly = bar.open === null && bar.high === null && bar.low === null;
      if (!Number.isFinite(bar.close) || bar.close <= 0 || (!full && !closeOnly) ||
        (full && (![bar.open, bar.high, bar.low].every(Number.isFinite) || bar.open! <= 0 || bar.low! <= 0 ||
          bar.high! < Math.max(bar.open!, bar.close, bar.low!) || bar.low! > Math.min(bar.open!, bar.close, bar.high!))) ||
        (bar.volume !== null && (!Number.isSafeInteger(bar.volume) || bar.volume < 0)) ||
        (bar.adjustedClose !== null && (!Number.isFinite(bar.adjustedClose) || bar.adjustedClose <= 0))) {
        throw new PriceError("invalid_snapshot");
      }
    }
    if (new Set(snapshot.bars.map(b => b.date)).size !== snapshot.bars.length) throw new PriceError("duplicate_snapshot_date");
    return this.db.transaction(() => {
      this.assertUniqueBarKeys(id);
      const storedSource = this.seriesMetadata(id)?.source;
      if (storedSource && storedSource !== snapshot.source) throw new PriceError("price_source_conflict");
      this.ensureInstrument(snapshot.instrument);
      const before = new Map((this.db.prepare(`SELECT date,open,high,low,close,volume,adjusted_close AS adjustedClose FROM ${this.barSource()} WHERE instrument_id=?`).all(id) as PriceBar[])
        .map(bar => [bar.date, bar]));
      const upsert = this.db.prepare(`INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(instrument_id,date) DO UPDATE SET
        open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,
        adjusted_close=excluded.adjusted_close,fetched_at=excluded.fetched_at`);
      const upsertPartial = this.db.prepare(`INSERT INTO partial_bars VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(instrument_id,date) DO UPDATE SET
        open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,
        adjusted_close=excluded.adjusted_close,fetched_at=excluded.fetched_at`);
      let inserted = 0, revised = 0, unchanged = 0;
      for (const bar of snapshot.bars) {
        const old = before.get(bar.date);
        if (!old) inserted++;
        else if (["open", "high", "low", "close", "volume"].some(key => old[key as keyof PriceBar] !== bar[key as keyof PriceBar]) ||
          (old.adjustedClose !== bar.adjustedClose && (old.adjustedClose === null || bar.adjustedClose === null ||
            Math.abs(old.adjustedClose - bar.adjustedClose) > Math.max(Math.abs(old.adjustedClose), Math.abs(bar.adjustedClose)) * 0.000001))) {
          revised++;
          this.db.prepare("INSERT INTO revisions(instrument_id,date,observed_at,before_json,after_json) VALUES (?,?,?,?,?)")
            .run(id, bar.date, snapshot.fetchedAt, JSON.stringify(old), JSON.stringify(bar));
        } else unchanged++;
        const partial = bar.open === null || bar.volume === null;
        this.db.prepare(`DELETE FROM ${partial ? "bars" : "partial_bars"} WHERE instrument_id=? AND date=?`).run(id, bar.date);
        (partial ? upsertPartial : upsert).run(id, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.adjustedClose, snapshot.fetchedAt);
        this.db.prepare("UPDATE quality_issues SET resolved_at=? WHERE instrument_id=? AND date=? AND resolved_at IS NULL")
          .run(snapshot.fetchedAt, id, bar.date);
      }
      for (const issue of snapshot.quarantinedBars) {
        // A source correction can make an earlier cached row invalid. Quarantine it too, rather than
        // continuing to return a stale value as analysis-ready. Historical revisions remain auditable.
        const old = before.get(issue.date);
        if (old) {
          revised++;
          this.db.prepare("INSERT INTO revisions(instrument_id,date,observed_at,before_json,after_json) VALUES (?,?,?,?,?)")
            .run(id, issue.date, snapshot.fetchedAt, JSON.stringify(old), JSON.stringify({ quarantined: true, ...issue }));
        }
        this.db.prepare("DELETE FROM bars WHERE instrument_id=? AND date=?").run(id, issue.date);
        this.db.prepare("DELETE FROM partial_bars WHERE instrument_id=? AND date=?").run(id, issue.date);
        this.db.prepare(`INSERT INTO quality_issues VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(instrument_id,date,reason) DO UPDATE SET
          values_json=excluded.values_json,last_seen_at=excluded.last_seen_at,resolved_at=NULL`)
          .run(id, issue.date, issue.reason, JSON.stringify(issue.values), snapshot.fetchedAt, snapshot.fetchedAt);
      }
      // Missing rows are retained with their earlier fetchedAt, rather than silently deleted.
      // Events use source event IDs and are corrected by upsert, without duplicating dividends/splits.
      for (const action of snapshot.actions) {
        this.db.prepare(`INSERT INTO actions VALUES (?,?,?,?,?,?,?) ON CONFLICT(instrument_id,event_key) DO UPDATE SET
          date=excluded.date,kind=excluded.kind,value=excluded.value,denominator=excluded.denominator,fetched_at=excluded.fetched_at`)
          .run(id, action.key, action.date, action.kind, action.value, action.denominator, snapshot.fetchedAt);
      }
      const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ bars: snapshot.bars, actions: snapshot.actions })).digest("hex");
      this.db.prepare(`INSERT INTO refreshes(instrument_id,attempted_at,success,row_count,inserted,revised,missing_bars,excluded_current,payload_hash)
        VALUES (?,?,1,?,?,?,?,?,?)`).run(id, snapshot.fetchedAt, snapshot.bars.length, inserted, revised, snapshot.missingBars, snapshot.excludedCurrentSession, payloadHash);
      this.pruneAudit();
      this.db.prepare("INSERT INTO series_metadata VALUES (?,?) ON CONFLICT(instrument_id) DO UPDATE SET metadata_json=excluded.metadata_json")
        .run(id, JSON.stringify({ seriesSchemaVersion: 2, instrument: expected, source: snapshot.source,
          dataOrigin: snapshot.dataOrigin ?? "provider_response_not_independently_verified",
          sourceUrl: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(expected.yahooSymbol)}`,
          priceBasis: PRICE_POLICY.priceBasis, rights: priceRights(snapshot.instrument, new Date(snapshot.fetchedAt)),
          fetchedAt: snapshot.fetchedAt, mappingVerification: "configured_mapping_not_independent_market_certification" }));
      return { inserted, revised, unchanged, rowCount: snapshot.bars.length };
    })();
  }

  private pruneAudit(): void {
    // Keep the latest 10,000 refresh receipts and 5,000 detailed corrections globally.
    this.db.exec("DELETE FROM refreshes WHERE id <= (SELECT COALESCE(MAX(id),0)-10000 FROM refreshes); DELETE FROM revisions WHERE id <= (SELECT COALESCE(MAX(id),0)-5000 FROM revisions);");
  }

  instruments() {
    const rows = this.db.prepare(`SELECT i.id,i.market,i.symbol,i.yahoo_symbol AS yahooSymbol,i.currency,i.time_zone AS timeZone,
      COUNT(b.date) AS barCount,MIN(b.date) AS firstDate,MAX(b.date) AS lastDate,MAX(b.fetched_at) AS lastFetchedAt,
      (SELECT attempted_at FROM refreshes r WHERE r.instrument_id=i.id AND success=1 ORDER BY id DESC LIMIT 1) AS lastSuccessfulRefresh,
      (SELECT error_code FROM refreshes r WHERE r.instrument_id=i.id ORDER BY id DESC LIMIT 1) AS lastError
      FROM instruments i LEFT JOIN ${this.barSource()} b ON b.instrument_id=i.id GROUP BY i.id ORDER BY i.id`).all() as
      (InstrumentInput & { id: string; barCount: number; firstDate: string | null; lastDate: string | null;
        lastFetchedAt: string | null; lastSuccessfulRefresh: string | null; lastError: string | null })[];
    return rows.map(row => {
      const series = this.seriesMetadata(row.id);
      return { ...row, ...instrument(row), ...(series?.source === "owner_csv" ? {
        source: "owner_csv", priceBasis: String(series.priceBasis), dataOrigin: series.dataOrigin,
        sourceRecordRevision: series.revision,
      } : {}) };
    });
  }

  read(input: InstrumentInput, start?: string, end?: string, limit = 100) {
    const target = instrument(input);
    this.assertUniqueBarKeys(target.id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1500) throw new PriceError("invalid_price_limit");
    if (start) isoDate.parse(start);
    if (end) isoDate.parse(end);
    if (start && end && start > end) throw new PriceError("invalid_price_date_range");
    const dates = [target.id, start ?? "0001-01-01", end ?? "9999-12-31"];
    const count = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.barSource()} WHERE instrument_id=? AND date BETWEEN ? AND ?`).get(...dates) as { n: number }).n;
    const bars = this.db.prepare(`SELECT date,open,high,low,close,volume,adjusted_close AS adjustedClose,fetched_at AS fetchedAt
      FROM ${this.barSource()} WHERE instrument_id=? AND date BETWEEN ? AND ? ORDER BY date DESC LIMIT ?`).all(...dates, limit).reverse() as (PriceBar & { fetchedAt: string })[];
    const series = this.seriesMetadata(target.id) ?? { rights: { status: "RIGHTS_HOLD" }, provenance: "legacy_metadata_unavailable" };
    const imported = series.source === "owner_csv";
    const source = imported ? "owner_csv" : "yahoo-chart";
    const basis = imported ? String(series.priceBasis) : "provider_quote_v1";
    if (imported && !this.hasTable("history_bar_provenance")) throw new PriceError("history_provenance_missing");
    const policy = imported ? { ...PRICE_POLICY, source, priceBasis: basis,
      completion: "Owner-supplied session dates; no official calendar or market verification.",
      adjustment: "Preserve supplied values and separate adjustedClose; no conversion, forward-fill or basis splicing.",
      revisionNoise: "Conflicting import values HOLD; immutable import receipts and source revisions are retained." } : PRICE_POLICY;
    const actions = this.db.prepare(`SELECT date,kind,value,denominator,fetched_at AS fetchedAt FROM actions
      WHERE instrument_id=? AND date BETWEEN ? AND ? ORDER BY date,event_key LIMIT 200`).all(...dates);
    const qualityIssues = this.db.prepare(`SELECT date,reason,last_seen_at AS lastSeenAt FROM quality_issues
      WHERE instrument_id=? AND date BETWEEN ? AND ? AND resolved_at IS NULL ORDER BY date LIMIT 100`).all(...dates);
    const issueCount = (this.db.prepare(`SELECT COUNT(*) AS n FROM quality_issues WHERE instrument_id=? AND date BETWEEN ? AND ? AND resolved_at IS NULL`).get(...dates) as { n: number }).n;
    return { instrument: target, policy, total: count, count: bars.length, truncated: count > bars.length, qualityIssues,
      qualityIssueCount: issueCount, qualityIssuesTruncated: issueCount > qualityIssues.length,
      seriesSchemaVersion: 2, series,
      selection: "Latest bars in the inclusive requested range, returned oldest first. Narrow start/end to retrieve earlier history.",
      bars: bars.map(b => {
        let provenance: Record<string, unknown> | undefined;
        if (imported) {
          const row = this.db.prepare("SELECT provenance_json FROM history_bar_provenance WHERE instrument_id=? AND date=?").get(target.id, b.date) as { provenance_json: string } | undefined;
          if (!row) throw new PriceError("history_provenance_missing");
          provenance = JSON.parse(row.provenance_json) as Record<string, unknown>;
        }
        return { ...b, ...(provenance ? { source, priceBasis: basis, provenance } : {}), completeness: b.open === null ? "close_only" : b.volume === null ? "ohlc_without_volume" : "ohlcv",
          valueHash: crypto.createHash("sha256").update(JSON.stringify([target.id, source, basis, b.date,
            b.open, b.high, b.low, b.close, b.volume, b.adjustedClose])).digest("hex") };
      }), actions,
      revisionAudit: { detailedHistoryBounded: true, maxDetailedCorrectionsPerPartition: 5000,
        ...(imported ? { importReceipts: this.db.prepare("SELECT receipt_json FROM history_import_receipts WHERE instrument_id=? ORDER BY revision DESC LIMIT 20").all(target.id).map(row => JSON.parse((row as { receipt_json: string }).receipt_json) as HistoryReceipt), importReceiptLimit: 20, importReceiptsPruned: false } : {}),
        valueHash: `SHA-256 JSON array [instrumentId, ${source}, ${basis}, date, open, high, low, close, volume, adjustedClose]; excludes download timestamp` },
      latestRefresh: this.lastAttempt(input) ?? null,
      warnings: ["No live prices. Do not substitute another listing, ADR or DR.",
        "Missing trading dates are not filled. Retained rows can have older fetchedAt values; inspect freshness before analysis."] };
  }

  status() {
    const instruments = this.instruments();
    const policy = instruments.some(i => i.source === "owner_csv") ? { ...PRICE_POLICY, source: "per_series",
      priceBasis: "Source/basis differ by series; inspect read_price_bars provenance. Owner CSV is not Yahoo or independently verified." } : PRICE_POLICY;
    return { enabled: process.env.MARKET_PRICES_ENABLED === "1", policy, instruments,
      receipts: this.db.prepare(`SELECT instrument_id AS instrumentId,attempted_at AS attemptedAt,success,error_code AS errorCode,
        row_count AS rowCount,inserted,revised,missing_bars AS missingBars,excluded_current AS excludedCurrent,payload_hash AS payloadHash
        FROM refreshes ORDER BY id DESC LIMIT 20`).all(),
      storage: { bytes: this.memory ? (this.db.pragma("page_count", { simple: true }) as number) *
        (this.db.pragma("page_size", { simple: true }) as number) : fs.statSync(this.filename).size,
        mode: this.memory ? "memory" : "disk", maxDatabaseBytes: priceDatabaseLimit(), diskReserveBytes: DISK_RESERVE },
      qualityIssues: this.db.prepare(`SELECT instrument_id AS instrumentId,date,reason,first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt
        FROM quality_issues WHERE resolved_at IS NULL ORDER BY last_seen_at DESC LIMIT 100`).all(),
      automatedWritesToVault: false };
  }
}

export function readPriceStore<T>(read: (store: PriceStore) => T): T | { available: false; reason: string; policy: typeof PRICE_POLICY } {
  const filename = priceDbPath();
  if (!fs.existsSync(filename)) return { available: false, reason: "price_database_not_initialized", policy: PRICE_POLICY };
  const store = new PriceStore(filename);
  try { return read(store); } finally { store.close(); }
}

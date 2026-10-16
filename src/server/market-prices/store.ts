import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { instrument, isoDate, PRICE_POLICY, PriceError, type InstrumentInput, type PriceBar, type PriceSnapshot } from "./model.ts";

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
  constructor(filename: string | Buffer, writable = false) {
    this.memory = Buffer.isBuffer(filename) || filename === ":memory:";
    this.filename = typeof filename === "string" ? filename : ":memory:";
    this.writable = writable;
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
        CREATE TABLE IF NOT EXISTS quality_issues (
          instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL, reason TEXT NOT NULL,
          values_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, resolved_at TEXT,
          PRIMARY KEY(instrument_id,date,reason)
        );
      `);
    } else this.db.pragma("query_only = ON");
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

  close(): void { this.db.close(); }

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
    // The provider parser is the only producer; also validate at this persistence boundary.
    if (id !== instrument(snapshot.instrument).id || !snapshot.bars.length || snapshot.bars.length > 10000 ||
      !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new PriceError("invalid_snapshot");
    for (const bar of snapshot.bars) {
      isoDate.parse(bar.date);
      if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
        !Number.isSafeInteger(bar.volume) || bar.volume < 0 || (bar.adjustedClose !== null && (!Number.isFinite(bar.adjustedClose) || bar.adjustedClose <= 0))) {
        throw new PriceError("invalid_snapshot");
      }
    }
    if (new Set(snapshot.bars.map(b => b.date)).size !== snapshot.bars.length) throw new PriceError("duplicate_snapshot_date");
    return this.db.transaction(() => {
      this.ensureInstrument(snapshot.instrument);
      const before = new Map((this.db.prepare(`SELECT date,open,high,low,close,volume,adjusted_close AS adjustedClose FROM bars WHERE instrument_id=?`).all(id) as PriceBar[])
        .map(bar => [bar.date, bar]));
      const upsert = this.db.prepare(`INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(instrument_id,date) DO UPDATE SET
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
        upsert.run(id, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.adjustedClose, snapshot.fetchedAt);
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
      return { inserted, revised, unchanged, rowCount: snapshot.bars.length };
    })();
  }

  private pruneAudit(): void {
    // Keep the latest 10,000 refresh receipts and 5,000 detailed corrections globally.
    this.db.exec("DELETE FROM refreshes WHERE id <= (SELECT COALESCE(MAX(id),0)-10000 FROM refreshes); DELETE FROM revisions WHERE id <= (SELECT COALESCE(MAX(id),0)-5000 FROM revisions);");
  }

  instruments() {
    return this.db.prepare(`SELECT i.id,i.market,i.symbol,i.yahoo_symbol AS yahooSymbol,i.currency,i.time_zone AS timeZone,
      COUNT(b.date) AS barCount,MIN(b.date) AS firstDate,MAX(b.date) AS lastDate,MAX(b.fetched_at) AS lastFetchedAt,
      (SELECT attempted_at FROM refreshes r WHERE r.instrument_id=i.id AND success=1 ORDER BY id DESC LIMIT 1) AS lastSuccessfulRefresh,
      (SELECT error_code FROM refreshes r WHERE r.instrument_id=i.id ORDER BY id DESC LIMIT 1) AS lastError
      FROM instruments i LEFT JOIN bars b ON b.instrument_id=i.id GROUP BY i.id ORDER BY i.id`).all();
  }

  read(input: InstrumentInput, start?: string, end?: string, limit = 100) {
    const target = instrument(input);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1500) throw new PriceError("invalid_price_limit");
    if (start) isoDate.parse(start);
    if (end) isoDate.parse(end);
    if (start && end && start > end) throw new PriceError("invalid_price_date_range");
    const dates = [target.id, start ?? "0001-01-01", end ?? "9999-12-31"];
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM bars WHERE instrument_id=? AND date BETWEEN ? AND ?").get(...dates) as { n: number }).n;
    const bars = this.db.prepare(`SELECT date,open,high,low,close,volume,adjusted_close AS adjustedClose,fetched_at AS fetchedAt
      FROM bars WHERE instrument_id=? AND date BETWEEN ? AND ? ORDER BY date DESC LIMIT ?`).all(...dates, limit).reverse();
    const actions = this.db.prepare(`SELECT date,kind,value,denominator,fetched_at AS fetchedAt FROM actions
      WHERE instrument_id=? AND date BETWEEN ? AND ? ORDER BY date,event_key LIMIT 200`).all(...dates);
    const qualityIssues = this.db.prepare(`SELECT date,reason,last_seen_at AS lastSeenAt FROM quality_issues
      WHERE instrument_id=? AND date BETWEEN ? AND ? AND resolved_at IS NULL ORDER BY date LIMIT 100`).all(...dates);
    const issueCount = (this.db.prepare(`SELECT COUNT(*) AS n FROM quality_issues WHERE instrument_id=? AND date BETWEEN ? AND ? AND resolved_at IS NULL`).get(...dates) as { n: number }).n;
    return { instrument: target, policy: PRICE_POLICY, total: count, count: bars.length, truncated: count > bars.length, qualityIssues,
      qualityIssueCount: issueCount, qualityIssuesTruncated: issueCount > qualityIssues.length,
      selection: "Latest bars in the inclusive requested range, returned oldest first. Narrow start/end to retrieve earlier history.", bars, actions,
      latestRefresh: this.lastAttempt(input) ?? null,
      warnings: ["No live prices. Do not substitute another listing, ADR or DR.",
        "Missing trading dates are not filled. Retained rows can have older fetchedAt values; inspect freshness before analysis."] };
  }

  status() {
    return { enabled: process.env.MARKET_PRICES_ENABLED === "1", policy: PRICE_POLICY, instruments: this.instruments(),
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

import { setTimeout as delay } from "node:timers/promises";
import { PriceStore } from "./store.ts";
import { PRICE_POLICY, PriceError, instrument, type InstrumentInput } from "./model.ts";
import { collectIntoPriceStore, priceWatchlistFrom, scheduledCutoff, pendingPriceListings, type RefreshOptions } from "./collector.ts";
import { GoogleDriveArchives, packDriveArchive, unpackDriveArchive, DRIVE_DB_LIMIT, type ArchiveRepository } from "./drive-archive.ts";
import { emptyCatalogue, packPriceCatalogue, unpackPriceCatalogue, type CatalogueEntry, type PriceCatalogue } from "./drive-catalogue.ts";
import { fetchIncremental } from "./incremental.ts";

export interface PriceReader {
  read: PriceStore["read"];
  instruments(): unknown;
  status(): unknown;
}
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_PARTITIONS = 8;
function batchSize() {
  const n = Number(process.env.MARKET_PRICES_BATCH_SIZE ?? "5");
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new PriceError("invalid_price_batch_size");
  return n;
}
function due(entry: CatalogueEntry | undefined, now: Date): boolean {
  if (!entry) return true;
  const at = Date.parse(entry.lastAttemptAt);
  return entry.lastAttemptSuccess ? at < scheduledCutoff(now) : now.getTime() - at >= 60 * 60 * 1000;
}
export class DrivePriceCache {
  private catalogue: PriceCatalogue = emptyCatalogue();
  private catalogueId: string | null = null;
  private verifiedAt: string | null = null;
  private loaded = false;
  private catalogueCheckedAt = 0;
  private catalogueRevision = 0;
  private busy = false;
  private retryAfter = 0;
  private providerRetryUntil = 0;
  private lastError: string | null = null;
  private queryChain: Promise<void> = Promise.resolve();
  private queuedQueries = 0;
  private cache = new Map<string, { archiveId: string; store: PriceStore; bytes: number }>();
  private readonly archives: ArchiveRepository;
  private readonly catalogues: ArchiveRepository;
  constructor(archives: ArchiveRepository = new GoogleDriveArchives(), catalogues: ArchiveRepository = new GoogleDriveArchives("priceCatalogue")) {
    this.archives = archives; this.catalogues = catalogues;
  }
  private failed(error: unknown): PriceError {
    this.lastError = error instanceof PriceError ? error.code : "drive_collection_failed";
    this.retryAfter = Date.now() + (/drive_http_(401|403|429)/.test(this.lastError) ? 60 : 10) * 60 * 1000;
    return new PriceError(this.lastError);
  }
  private acceptCatalogue(bytes: Buffer, id: string) {
    const next = unpackPriceCatalogue(bytes), ids = new Map(next.entries.map(e => [instrument(e.instrument).id, e.archiveId]));
    for (const [key, cached] of this.cache) if (ids.get(key) !== cached.archiveId) { cached.store.close(); this.cache.delete(key); }
    this.catalogue = next; this.catalogueId = id; this.verifiedAt = new Date().toISOString(); this.loaded = true; this.catalogueCheckedAt = Date.now(); this.catalogueRevision++;
  }
  async loadVerified(force = false) {
    if (this.loaded && !force && Date.now() - this.catalogueCheckedAt < 60000) return;
    if (Date.now() < this.retryAfter) throw new PriceError("drive_retry_backoff");
    try {
      const revision = this.catalogueRevision;
      const prior = await this.catalogues.latest();
      // A delayed read must not replace a catalogue published while it waited.
      if (revision !== this.catalogueRevision) return;
      if (prior) {
        this.acceptCatalogue(prior.bytes, prior.id);
        console.log("[market-prices] drive_catalogue_loaded", JSON.stringify({ catalogueId: this.catalogueId, instruments: this.catalogue.entries.length, verifiedAt: this.verifiedAt }));
      } else {
        if (this.catalogueId) throw new PriceError("drive_catalogue_missing");
        this.loaded = true; this.catalogueCheckedAt = Date.now();
      }
    } catch (error) { throw this.failed(error); }
  }
  private openPartition(bytes: Buffer, entry: CatalogueEntry, writable = false): PriceStore {
    const decoded = unpackDriveArchive(bytes);
    if (decoded.database.length !== entry.databaseBytes) throw new PriceError("drive_partition_integrity_failed");
    const store = new PriceStore(decoded.database, writable);
    try {
      const instruments = store.instruments() as { id: string; barCount: number }[];
      if (store.db.pragma("quick_check", { simple: true }) !== "ok" || instruments.length !== 1 ||
        instruments[0].id !== instrument(entry.instrument).id || instruments[0].barCount !== entry.barCount) throw new PriceError("drive_partition_integrity_failed");
      return store;
    } catch (error) { store.close(); throw error; }
  }
  private async ensurePartition(input: InstrumentInput) {
    const id = instrument(input).id, entry = this.catalogue.entries.find(e => instrument(e.instrument).id === id);
    if (!entry) throw new PriceError("price_instrument_not_cached");
    const cached = this.cache.get(id);
    if (cached?.archiveId === entry.archiveId) { this.cache.delete(id); this.cache.set(id, cached); return; }
    if (Date.now() < this.retryAfter) throw new PriceError("drive_retry_backoff");
    const bytes = await this.archives.get(entry.archiveId);
    // Collection can publish a newer catalogue while the download is in flight.
    if (this.catalogue.entries.find(e => instrument(e.instrument).id === id)?.archiveId !== entry.archiveId) throw new PriceError("drive_catalogue_changed_retry_read");
    const store = this.openPartition(bytes, entry);
    let used = [...this.cache.values()].reduce((sum, item) => sum + item.bytes, 0);
    while (this.cache.size >= MAX_CACHE_PARTITIONS || used + entry.databaseBytes > MAX_CACHE_BYTES) {
      const oldest = this.cache.entries().next().value;
      if (!oldest) { store.close(); throw new PriceError("drive_cache_budget_exceeded"); }
      oldest[1].store.close(); used -= oldest[1].bytes; this.cache.delete(oldest[0]);
    }
    this.cache.set(id, { archiveId: entry.archiveId, store, bytes: entry.databaseBytes });
  }
  private reader(): PriceReader {
    return {
      read: (input, start, end, limit) => {
        const entry = this.cache.get(instrument(input).id);
        if (!entry) throw new PriceError("drive_partition_not_loaded");
        return entry.store.read(input, start, end, limit);
      },
      instruments: () => this.catalogue.entries.map(e => ({ ...instrument(e.instrument), barCount: e.barCount, firstDate: e.firstDate,
        lastDate: e.lastDate, lastFetchedAt: e.lastFetchedAt, lastSuccessfulRefresh: e.lastSuccessfulRefresh, lastError: e.lastError })),
      status: () => ({ enabled: process.env.MARKET_PRICES_ENABLED === "1", policy: PRICE_POLICY,
        instruments: this.reader().instruments(), receipts: [...this.catalogue.entries].sort((a, b) => b.lastAttemptAt.localeCompare(a.lastAttemptAt)).slice(0, 20)
          .map(e => ({ instrumentId: instrument(e.instrument).id, attemptedAt: e.lastAttemptAt, success: e.lastAttemptSuccess, errorCode: e.lastError, rowCount: e.barCount })),
        storage: { mode: "google-drive-partitions", maxPartitionDatabaseBytes: DRIVE_DB_LIMIT,
          cachedPartitionCount: this.cache.size, maxCachedPartitions: MAX_CACHE_PARTITIONS, maxCachedDatabaseBytes: MAX_CACHE_BYTES,
          cachedDatabaseBytes: [...this.cache.values()].reduce((sum, item) => sum + item.bytes, 0),
          totalDatabaseBytes: this.catalogue.entries.reduce((sum, item) => sum + item.databaseBytes, 0) },
        providerRetryAfter: this.catalogue.providerRetryAfter,
        quality: this.catalogue.entries.map(e => ({ instrumentId: instrument(e.instrument).id, issueCount: e.qualityIssueCount })),
        automatedWritesToVault: false }),
    };
  }
  /** Remote READS only on a cold cache. Never fetches quotes, publishes files or refreshes data. */
  async read<T>(read: (store: PriceReader) => T, requested: InstrumentInput[] = []): Promise<unknown> {
    if (requested.length > 2) throw new PriceError("drive_query_partition_limit");
    requested.forEach(input => instrument(input));
    if (this.queuedQueries >= 16) throw new PriceError("drive_query_busy");
    this.queuedQueries++;
    const run = this.queryChain.then(async () => {
      await this.loadVerified();
      if (!this.catalogueId) return { available: false, reason: this.lastError ?? "drive_price_catalogue_not_initialized", policy: PRICE_POLICY };
      for (const input of requested) await this.ensurePartition(input);
      return { ...read(this.reader()), archive: { backend: "google-drive", catalogueId: this.catalogueId,
        verifiedAt: this.verifiedAt, lastError: this.lastError, warning: this.lastError ? "Latest storage attempt failed; inspect freshness." : null } };
    });
    this.queryChain = run.then(() => {}, () => {});
    try { return await run; } catch (error) {
      if (error instanceof PriceError && (!error.code.startsWith("drive_") ||
        ["drive_catalogue_changed_retry_read", "drive_partition_not_loaded"].includes(error.code))) throw error;
      throw this.failed(error);
    } finally { this.queuedQueries--; }
  }
  async refresh(options: RefreshOptions = {}) {
    const watchlist = priceWatchlistFrom(options), count = batchSize(), now = options.now ?? new Date();
    if (process.env.MARKET_PRICES_DRIVE_SINGLE_WRITER !== "1") throw new PriceError("drive_single_writer_required");
    if (this.busy) return { status: "collector_busy", results: [] };
    if (Date.now() < this.retryAfter) return { status: "drive_retry_backoff", results: [] };
    this.busy = true;
    const results: Awaited<ReturnType<typeof collectIntoPriceStore>>["results"] = [];
    try {
      await this.loadVerified(true);
      if (Math.max(this.providerRetryUntil, this.catalogue.providerRetryAfter ? Date.parse(this.catalogue.providerRetryAfter) : 0) > now.getTime()) return { status: "provider_cooldown", results };
      const allowed = new Set(watchlist.map(i => instrument(i).id));
      const next: PriceCatalogue = { ...this.catalogue, updatedAt: now.toISOString(), providerRetryAfter: null,
        entries: this.catalogue.entries.filter(e => allowed.has(instrument(e.instrument).id)) };
      const entries = new Map(next.entries.map(e => [instrument(e.instrument).id, e]));
      const selected = watchlist.filter(i => options.force || due(entries.get(instrument(i).id), now)).slice(0, count);
      for (const [index, input] of selected.entries()) {
        if (index > 0) await (options.pause ?? delay)(3000);
        const id = instrument(input).id, old = entries.get(id);
        const working = old ? this.openPartition(await this.archives.get(old.archiveId), old, true) : new PriceStore(":memory:", true);
        try {
          let full = false;
          const collected = await collectIntoPriceStore(working, { ...options, watchlist: [input], fetcher: async target => {
            const next = await fetchIncremental(working, target, { now, lastFullRefreshAt: old?.lastFullRefreshAt ?? null,
              fetcher: options.fetcher, pause: options.pause ?? delay });
            full = next.full; return next.snapshot;
          } });
          results.push(...collected.results);
          const throttled = collected.results.some(row => ["provider_rate_limited", "provider_http_401", "provider_http_403"].includes(row.errorCode ?? ""));
          if (throttled) {
            this.providerRetryUntil = now.getTime() + 60 * 60 * 1000;
            next.providerRetryAfter = new Date(this.providerRetryUntil).toISOString();
          }
          if (!collected.results.some(r => ["updated", "failed"].includes(r.status))) continue;
          const database = working.db.serialize(), packed = packDriveArchive(database);
          const published = await this.archives.publish(packed);
          if (!published.bytes.equals(packed)) throw new PriceError("drive_readback_mismatch");
          unpackDriveArchive(published.bytes);
          const coverage = working.instruments()[0] as { barCount: number; firstDate: string | null; lastDate: string | null;
            lastFetchedAt: string | null; lastSuccessfulRefresh: string | null; lastError: string | null };
          const last = working.lastAttempt(input)!;
          const issues = working.db.prepare("SELECT COUNT(*) AS n FROM quality_issues WHERE resolved_at IS NULL").get() as { n: number };
          entries.set(id, { instrument: input, archiveId: published.id, databaseBytes: database.length,
            barCount: coverage.barCount, firstDate: coverage.firstDate, lastDate: coverage.lastDate, lastFetchedAt: coverage.lastFetchedAt,
            lastSuccessfulRefresh: coverage.lastSuccessfulRefresh, lastError: coverage.lastError, lastAttemptAt: last.attempted_at,
            lastAttemptSuccess: !!last.success, qualityIssueCount: issues.n,
            lastFullRefreshAt: full && last.success ? now.toISOString() : old?.lastFullRefreshAt ?? null });
          if (throttled) break;
        } finally { working.close(); }
      }
      next.entries = [...entries.values()];
      if (results.length || next.entries.length !== this.catalogue.entries.length) {
        const packed = packPriceCatalogue(next), published = await this.catalogues.publish(packed);
        if (!published.bytes.equals(packed)) throw new PriceError("drive_readback_mismatch");
        this.acceptCatalogue(published.bytes, published.id);
      }
      this.lastError = null; this.retryAfter = 0;
      const dueNow = watchlist.filter(i => due(entries.get(instrument(i).id), now)).length;
      const remainingDue = pendingPriceListings(next.entries.map(e => ({ id: instrument(e.instrument).id, barCount: e.barCount,
        lastSuccessfulRefresh: e.lastSuccessfulRefresh, lastError: e.lastError })), watchlist, now);
      return { status: results.some(r => r.status === "failed") ? "partial_failure" : dueNow ? "batch_complete" : remainingDue ? "pending_retry_or_coverage" : "complete",
        scope: "bounded_batch", universeSize: watchlist.length, remainingDue, results,
        storage: { backend: "google-drive", catalogueId: this.catalogueId, verifiedAt: this.verifiedAt, readBackVerified: !!this.catalogueId } };
    } catch (error) { throw this.failed(error); } finally { this.busy = false; }
  }
  close() { for (const item of this.cache.values()) item.store.close(); this.cache.clear(); }
}
let singleton: DrivePriceCache | undefined;
export function drivePriceCache(): DrivePriceCache { return singleton ??= new DrivePriceCache(); }

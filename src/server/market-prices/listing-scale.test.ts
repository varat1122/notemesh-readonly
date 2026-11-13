import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { PriceStore, priceDatabaseLimit, priceDbPath } from "./store";
import { instrument, type InstrumentInput, type PriceBar } from "./model";
import { runPriceRefresh, collectIntoPriceStore } from "./collector";
import { fetchYahooDaily } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";
import { DrivePriceCache } from "./drive-backend";
import { packDriveArchive, unpackDriveArchive, type ArchiveRepository } from "./drive-archive";
import { unpackPriceCatalogue } from "./drive-catalogue";

class MemoryRepository implements ArchiveRepository {
  files = new Map<string, Buffer>(); writes = 0; reads = 0;
  async latest() { const id = [...this.files.keys()].at(-1); return id ? { id, bytes: Buffer.from(this.files.get(id)!) } : null; }
  async get(id: string) { this.reads++; const bytes = this.files.get(id); if (!bytes) throw Error("mock_missing_snapshot"); return Buffer.from(bytes); }
  async publish(bytes: Buffer) { const id = `mock${++this.writes}`; this.files.set(id, Buffer.from(bytes)); return { id, bytes: await this.get(id) }; }
}
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "listing-scale-"));
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("MARKET_PRICES_PROFILE", "");
  vi.stubEnv("MARKET_PRICES_MAX_DB_MB", "4"); vi.stubEnv("MARKET_PRICES_STORAGE", "disk");
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1");
  vi.stubEnv("MARKET_PRICES_SCHEDULE", "external"); vi.stubEnv("MARKET_PRICES_DRIVE_SINGLE_WRITER", "1");
  vi.stubEnv("MARKET_PRICES_BATCH_SIZE", "5"); vi.stubEnv("ENCRYPTION_KEY", "34".repeat(32));
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw Error("REAL_NETWORK_FORBIDDEN_IN_SCALE_TEST"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const watchlist = Array.from({ length: 50 }, (_, i) => ({ market: "US" as const, symbol: `SYN${i}` }));
// 1250 observed synthetic weekdays/listing; never claimed to be a historical exchange calendar.
const bars: PriceBar[] = [];
for (const day = new Date("2026-10-15T12:00:00Z"); bars.length < 1250; day.setUTCDate(day.getUTCDate() - 1)) {
  if ([0, 6].includes(day.getUTCDay())) continue;
  const close = 100 + bars.length / 100;
  bars.unshift({ date: day.toISOString().slice(0, 10), open: close - 1, high: close + 2, low: close - 2, close, volume: 100000 + bars.length, adjustedClose: close });
}
function rawChart(input: InstrumentInput) {
  const raw = chartFixture(input), r = raw.chart.result[0];
  r.timestamp = bars.map(b => Date.parse(b.date + "T12:00:00Z") / 1000);
  const q = r.indicators.quote[0];
  for (const key of ["open", "high", "low", "close", "volume"] as const) q[key] = bars.map(b => b[key]!);
  r.indicators.adjclose[0].adjclose = bars.map(b => b.adjustedClose!);
  r.events = { dividends: {}, splits: {} } as typeof r.events;
  return raw;
}
function provider() {
  let calls = 0, active = 0, maxActive = 0, observedMaxRss = process.memoryUsage().rss;
  const latencies: number[] = [];
  const fetcher: typeof fetchYahooDaily = async (input, options = {}) => {
    active++; maxActive = Math.max(maxActive, active); const start = performance.now();
    try {
      const snapshot = await fetchYahooDaily(input, { ...options, fetcher: async () => {
        calls++; await Promise.resolve(); return new Response(JSON.stringify(rawChart(input)));
      } });
      snapshot.dataOrigin = "synthetic_fixture"; return snapshot;
    } finally { active--; latencies.push(performance.now() - start); observedMaxRss = Math.max(observedMaxRss, process.memoryUsage().rss); }
  };
  return { fetcher, metrics: () => ({ calls, maxActive, observedMaxRss, mockedFetchAndParseMs: latencies.reduce((a, b) => a + b, 0) }) };
}
function evidence(name: string, value: unknown) {
  const folder = process.env.IOS_ORCH_EVIDENCE_DIR;
  if (folder) { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify(value, null, 2)); }
  console.log("P4_METRICS", name, JSON.stringify(value));
}

it("measures 8 to 20 listings in the real bounded SQLite store using offline Yahoo responses", async () => {
  const source = provider(), started = performance.now(), pauses: number[] = [];
  const options = { trigger: "job" as const, now: TEST_NOW, fetcher: source.fetcher, pause: async (ms: number) => { pauses.push(ms); } };
  const first = await runPriceRefresh({ ...options, watchlist: watchlist.slice(0, 8) });
  expect(first.status).toBe("complete");
  const bytes8 = fs.statSync(priceDbPath()).size;
  const second = await runPriceRefresh({ ...options, watchlist: watchlist.slice(0, 20) });
  expect(second.status).toBe("complete"); expect(source.metrics().calls).toBe(20);
  const store = new PriceStore(priceDbPath());
  try {
    const bytes20 = fs.statSync(priceDbPath()).size;
    const rows = (store.db.prepare("SELECT COUNT(*) AS n FROM bars").get() as { n: number }).n;
    expect(rows).toBe(25000); expect(bytes20).toBeLessThan(priceDatabaseLimit());
    expect(store.status().qualityIssues).toHaveLength(0);
    const bytesPerListing = (bytes20 - bytes8) / 12;
    evidence("stage-a", { fixtureOnly: true, barsPerListing: bars.length, bars8: 10000, bars20: rows, bytes8, bytes20,
      incrementalBytesPerListing: bytesPerListing, budgetBytes: priceDatabaseLimit(),
      estimatedWholeHistoryListingsAtCap: Math.floor(20 + (priceDatabaseLimit() - bytes20) / bytesPerListing),
      estimatedListingsAt80PercentBudget: Math.floor(20 + (priceDatabaseLimit() * 0.8 - bytes20) / bytesPerListing),
      durationMs: performance.now() - started, requestedPauseMs: pauses.reduce((a, b) => a + b, 0),
      providerFailures: second.results.filter(r => r.status === "failed").length, ...source.metrics(), realNetworkCalls: 0 });
  } finally { store.close(); }
}, 60000);

it("binds a published catalogue to exact snapshot bytes, rejecting another authentic generation", async () => {
  const archives = new MemoryRepository(), catalogues = new MemoryRepository(), writer = new DrivePriceCache(archives, catalogues);
  const input = watchlist[0], source = provider();
  try { await writer.refresh({ watchlist: [input], now: TEST_NOW, fetcher: source.fetcher }); } finally { writer.close(); }
  const entry = unpackPriceCatalogue((await catalogues.latest())!.bytes).entries[0];
  const decoded = unpackDriveArchive(await archives.get(entry.archiveId));
  const changed = new PriceStore(decoded.database, true);
  // Same listing, row count, file size and a valid authenticator; deliberately different valid prices.
  changed.db.prepare("UPDATE bars SET close=close+0.25 WHERE date=?").run(bars[0].date);
  archives.files.set(entry.archiveId, packDriveArchive(changed.db.serialize())); changed.close();
  const reader = new DrivePriceCache(archives, catalogues);
  try { await expect(reader.read(s => s.read(input), [input])).rejects.toThrow("drive_partition_checksum_mismatch"); }
  finally { reader.close(); }
});

it("completes 50 listing partitions through bounded request budgets and cold reads only selected ranges", async () => {
  const archives = new MemoryRepository(), catalogues = new MemoryRepository(), writer = new DrivePriceCache(archives, catalogues);
  const source = provider(), started = performance.now(), runs: { status: string; requests: number }[] = [], pauses: number[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const run = await runPriceRefresh({ trigger: "job", now: TEST_NOW, watchlist, fetcher: source.fetcher,
        pause: async ms => { pauses.push(ms); }, batch: o => writer.refresh(o) });
      runs.push({ status: run.status, requests: run.providerRequests });
    }
    expect(runs).toEqual([{ status: "pending_request_limit", requests: 24 }, { status: "pending_request_limit", requests: 24 }, { status: "complete", requests: 2 }]);
    expect(source.metrics().calls).toBe(50); expect(source.metrics().maxActive).toBe(1);
    const replay = await runPriceRefresh({ trigger: "job", now: TEST_NOW, watchlist, fetcher: source.fetcher, batch: o => writer.refresh(o) });
    expect(replay.status).toBe("complete"); expect(replay.providerRequests).toBe(0);
  } finally { writer.close(); }
  const manifest = unpackPriceCatalogue((await catalogues.latest())!.bytes);
  expect(manifest.entries).toHaveLength(50);
  expect(manifest.entries.reduce((sum, e) => sum + e.barCount, 0)).toBe(62500);
  expect(new Set(manifest.entries.map(e => instrument(e.instrument).id)).size).toBe(50);
  expect(archives.writes).toBe(50);
  const reader = new DrivePriceCache(archives, catalogues), coldReadTimes: number[] = [], readsBefore = archives.reads;
  try {
    await reader.read(s => s.status()); expect(archives.reads).toBe(readsBefore);
    for (const input of watchlist.slice(0, 12)) {
      const start = performance.now();
      const result = await reader.read(s => s.read(input, "2026-10-01", "2026-10-15", 20), [input]);
      coldReadTimes.push(performance.now() - start);
      expect(result).toMatchObject({ canonicalListingId: null, dataScope: "listing-local", total: 11, count: 11, truncated: false });
    }
    expect(archives.reads - readsBefore).toBe(12);
    const status = await reader.read(s => s.status()) as { storage: { cachedPartitionCount: number; cachedDatabaseBytes: number } };
    expect(status.storage.cachedPartitionCount).toBe(8); expect(status.storage.cachedDatabaseBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    const warmStart = performance.now(); await reader.read(s => s.read(watchlist[11]), [watchlist[11]]);
    expect(archives.reads - readsBefore).toBe(12);
    expect(fs.existsSync(priceDbPath())).toBe(false);
    evidence("stage-b", { fixtureOnly: true, listings: 50, bars: 62500, runs, ...source.metrics(), durationMs: performance.now() - started,
      archiveWrites: archives.writes, catalogueWrites: catalogues.writes, totalUncompressedBytes: manifest.entries.reduce((s, e) => s + e.databaseBytes, 0),
      maxPartitionBytes: Math.max(...manifest.entries.map(e => e.databaseBytes)), compressedArchiveBytes: [...archives.files.values()].reduce((s, b) => s + b.length, 0),
      catalogueSha256: crypto.createHash("sha256").update((await catalogues.latest())!.bytes).digest("hex"),
      requestedPauseMs: pauses.reduce((a, b) => a + b, 0), coldReadTimesMs: coldReadTimes, warmReadMs: performance.now() - warmStart,
      requestedPartitions: 12, archiveReads: archives.reads - readsBefore, cache: status.storage, realNetworkCalls: 0 });
  } finally { reader.close(); }
}, 60000);

it("leaves the old generation readable after an incomplete snapshot upload", async () => {
  const archives = new MemoryRepository(), catalogues = new MemoryRepository(), writer = new DrivePriceCache(archives, catalogues);
  const input = watchlist[0], source = provider(), options = { watchlist: [input], now: TEST_NOW, fetcher: source.fetcher };
  try {
    await writer.refresh(options); const prior = await catalogues.latest();
    vi.spyOn(archives, "publish").mockImplementation(async bytes => {
      archives.files.set("incomplete", bytes.subarray(0, bytes.length / 2)); throw Error("mock_upload_interrupted");
    });
    await expect(writer.refresh({ ...options, force: true })).rejects.toThrow();
    expect(await catalogues.latest()).toEqual(prior);
  } finally { writer.close(); }
  const reader = new DrivePriceCache(archives, catalogues);
  try { expect(await reader.read(s => s.read(input), [input])).toMatchObject({ total: 1250 }); }
  finally { reader.close(); }
});

it("stops at the DB budget with a rolled-back listing and an explicit capacity hold", async () => {
  const store = new PriceStore(priceDbPath(), true);
  try {
    const fetcher: typeof fetchYahooDaily = async input => ({ instrument: instrument(input), source: "yahoo-chart", dataOrigin: "synthetic_fixture",
      fetchedAt: TEST_NOW.toISOString(), bars, actions: [], missingBars: 0, quarantinedBars: [], excludedCurrentSession: 0 });
    const result = await collectIntoPriceStore(store, { watchlist, now: TEST_NOW, pause: async () => {}, fetcher });
    expect(result.status).toBe("storage_budget_hold");
    expect(result.results.at(-1)).toMatchObject({ status: "failed", errorCode: "price_database_budget_exhausted" });
    expect(store.db.pragma("quick_check", { simple: true })).toBe("ok");
    const accepted = store.instruments();
    expect(accepted.every(i => i.barCount === 1250)).toBe(true);
    expect(store.read(watchlist[0]).total).toBe(1250);
    const bytes = fs.statSync(priceDbPath()).size;
    expect(bytes).toBeLessThanOrEqual(priceDatabaseLimit());
    evidence("capacity-boundary", { budgetBytes: priceDatabaseLimit(), bytes, acceptedListings: accepted.length,
      firstRejectedListing: result.results.at(-1)?.instrumentId, status: result.status, integrityCheck: "ok", partialListingCommitted: false });
  } finally { store.close(); }
});

it("measures 50 listing operational working sets without raising the DB cap or activating retention", async () => {
  const store = new PriceStore(priceDbPath(), true);
  try {
    for (const input of watchlist) store.save({ instrument: instrument(input), source: "yahoo-chart", dataOrigin: "synthetic_fixture",
      fetchedAt: TEST_NOW.toISOString(), bars: bars.slice(-252), actions: [], missingBars: 0, quarantinedBars: [], excludedCurrentSession: 0 });
    const bytes = fs.statSync(priceDbPath()).size;
    expect(bytes).toBeLessThan(priceDatabaseLimit() * 0.8);
    expect(store.instruments()).toHaveLength(50);
    evidence("hot-working-set", { fixtureOnly: true, listings: 50, barsPerListing: 252, totalBars: 12600, bytes,
      budgetBytes: priceDatabaseLimit(), automaticRetentionActivated: false });
  } finally { store.close(); }
});

it("enforces single-run concurrency and durable 429 backoff across a cold restart for a 50-listing watchlist", async () => {
  const archives = new MemoryRepository(), catalogues = new MemoryRepository(), writer = new DrivePriceCache(archives, catalogues);
  let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const source: typeof fetchYahooDaily = (input, options = {}) => fetchYahooDaily(input, { ...options, fetcher: async () => {
    await blocked; return new Response("fixture_throttle", { status: 429 });
  } });
  const first = runPriceRefresh({ trigger: "job", now: TEST_NOW, watchlist, fetcher: source, batch: o => writer.refresh(o) });
  try {
    expect((await runPriceRefresh({ trigger: "job", now: TEST_NOW, watchlist, fetcher: source, batch: o => writer.refresh(o) })).status).toBe("collector_busy");
    unblock();
    const failed = await first;
    expect(failed.status).toBe("partial_failure"); expect(failed.providerRequests).toBe(1);
  } finally { unblock(); await first; writer.close(); }
  const resumed = new DrivePriceCache(archives, catalogues), retry = vi.fn(source);
  try {
    expect((await resumed.refresh({ watchlist, now: TEST_NOW, force: true, fetcher: retry })).status).toBe("provider_cooldown");
    expect(retry).not.toHaveBeenCalled();
    evidence("scheduler-backoff", { watchlistSize: 50, concurrentRun: "collector_busy", throttleRequests: 1,
      coldRestart: "provider_cooldown", additionalRequests: 0, cooldownMinutes: 60 });
  } finally { resumed.close(); }
});

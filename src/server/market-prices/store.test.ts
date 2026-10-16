import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceStore, readPriceStore, priceDbPath, priceDatabaseLimit } from "./store";
import { parseYahooChart } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";

let root: string;
let store: PriceStore;
const input = { market: "US", symbol: "NVDA" } as const;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "market-prices-"));
  vi.stubEnv("DATA_DIR", root);
  store = new PriceStore(priceDbPath(), true);
});
afterEach(() => { store.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const snapshot = () => parseYahooChart(chartFixture(), input, TEST_NOW);

it("persists, reads back, and retries without duplicate bars or actions", () => {
  expect(store.save(snapshot())).toEqual({ inserted: 2, revised: 0, unchanged: 0, rowCount: 2 });
  expect(store.save(snapshot())).toEqual({ inserted: 0, revised: 0, unchanged: 2, rowCount: 2 });
  const data = readPriceStore(s => s.read(input)) as ReturnType<PriceStore["read"]>;
  expect(data.total).toBe(2); expect(data.actions).toHaveLength(2);
  expect(data.bars[0]).toMatchObject({ open: 10, adjustedClose: 10.5 });
  expect(fs.existsSync(path.join(root, "vault"))).toBe(false);
});
it("records corrections separately and preserves rows omitted by a later response", () => {
  store.save(snapshot()); const corrected = snapshot(); corrected.bars[0].close = 11.2; corrected.bars.pop();
  expect(store.save(corrected)).toMatchObject({ inserted: 0, revised: 1 });
  expect(store.read(input).total).toBe(2);
  expect(store.db.prepare("SELECT COUNT(*) AS n FROM revisions").get()).toEqual({ n: 1 });
});
it("rolls back the entire batch if a later bar violates database integrity", () => {
  const data = snapshot(); data.bars[1].low = -1;
  expect(() => store.save(data)).toThrow();
  expect(store.instruments()).toHaveLength(0);
  expect(store.read(input).total).toBe(0);
});
it("reports date bounds, truncation, freshness and provider errors", () => {
  store.save(snapshot()); store.failure(input, "provider_unavailable", TEST_NOW);
  const data = store.read(input, undefined, undefined, 1);
  expect(data).toMatchObject({ total: 2, count: 1, truncated: true, latestRefresh: { error_code: "provider_unavailable" } });
  expect(data.bars[0]).toMatchObject({ date: "2026-10-15", fetchedAt: TEST_NOW.toISOString() });
  expect(store.read(input, "2026-10-14", "2026-10-14").count).toBe(1);
  expect(() => store.read(input, "2026-10-15", "2026-10-14")).toThrow("invalid_price_date_range");
  expect(() => store.read(input, undefined, undefined, 10000)).toThrow("invalid_price_limit");
});
it("uses a durable lease so independent collector processes cannot overlap", () => {
  const other = new PriceStore(priceDbPath(), true);
  try {
    const lease = store.acquireLease(TEST_NOW)!;
    expect(other.acquireLease(TEST_NOW)).toBeNull();
    other.releaseLease("not-the-owner"); expect(other.acquireLease(TEST_NOW)).toBeNull();
    store.releaseLease(lease); expect(other.acquireLease(TEST_NOW)).toBeTypeOf("string");
  } finally { other.close(); }
});
it("opens MCP reads query-only and refuses writes", () => {
  store.save(snapshot()); const reader = new PriceStore(priceDbPath());
  try {
    expect(() => reader.save(snapshot())).toThrow("read_only_price_store");
    expect(() => reader.db.exec("DELETE FROM bars")).toThrow();
  } finally { reader.close(); }
});
it("fails closed on disk reserve and keeps prior data", () => {
  store.save(snapshot());
  vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 1, bsize: 4096 } as fs.StatsFs);
  expect(() => store.save(snapshot())).toThrow("insufficient_price_disk_reserve");
  expect(store.read(input).total).toBe(2);
});
it("uses a small pilot budget and exposes reserve arithmetic without reducing the vault reserve", () => {
  expect(priceDatabaseLimit()).toBe(4 * 1024 * 1024);
  vi.stubEnv("MARKET_PRICES_MAX_DB_MB", "8"); expect(priceDatabaseLimit()).toBe(8 * 1024 * 1024);
  vi.stubEnv("MARKET_PRICES_MAX_DB_MB", "1"); expect(() => priceDatabaseLimit()).toThrow("invalid_price_database_limit");
  vi.stubEnv("MARKET_PRICES_MAX_DB_MB", "4");
  vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 1, bsize: 4096 } as fs.StatsFs);
  try { store.assertSpace(); throw new Error("should refuse"); }
  catch (error) { expect(error).toMatchObject({ code: "insufficient_price_disk_reserve", details: {
    availableBytes: 4096, applicationReserveBytes: 50000000, priceBudgetBytes: 8 * 1024 * 1024,
    requiredAvailableBytes: 50000000 + 8 * 1024 * 1024,
  } }); }
});
it("rejects a database configured inside the vault", () => {
  vi.stubEnv("MARKET_PRICES_DIR", path.join(root, "vault", "prices"));
  expect(() => priceDbPath()).toThrow("price_database_must_be_outside_vault");
});
it("refuses a directory symlink into the vault and linked database files", () => {
  const vault = path.join(root, "vault"); fs.mkdirSync(vault);
  const alias = path.join(root, "price-alias"); fs.symlinkSync(vault, alias, "dir");
  vi.stubEnv("MARKET_PRICES_DIR", alias);
  expect(() => priceDbPath()).toThrow("price_database_must_be_outside_vault");
  const linked = path.join(root, "linked.sqlite"); fs.linkSync(store.filename, linked);
  expect(() => new PriceStore(linked, true)).toThrow("linked_price_database_refused");
});
it("quarantines a newly invalid source bar, exposes the gap, then resolves it on repair", () => {
  store.save(snapshot());
  const bad = snapshot();
  const original = bad.bars.shift()!;
  bad.quarantinedBars.push({ date: original.date, reason: "invalid_provider_bar", values: { open: 10, high: 9, low: 8, close: 11, volume: 100 } });
  store.save(bad);
  expect(store.read(input)).toMatchObject({ total: 1, qualityIssues: [{ date: "2026-10-14", reason: "invalid_provider_bar" }] });
  expect(store.db.prepare("SELECT COUNT(*) AS n FROM revisions").get()).toEqual({ n: 1 });
  store.save(snapshot());
  expect(store.read(input)).toMatchObject({ total: 2, qualityIssues: [] });
});
it("records actual OHLC corrections but avoids adjusted-close floating point audit noise", () => {
  store.save(snapshot());
  const jitter = snapshot(); jitter.bars[0].adjustedClose! += 0.000001;
  expect(store.save(jitter).revised).toBe(0);
  expect((store.read(input).bars[0] as { adjustedClose: number }).adjustedClose).toBe(jitter.bars[0].adjustedClose);
  jitter.bars[0].close += 0.000001;
  expect(store.save(jitter).revised).toBe(1);
});

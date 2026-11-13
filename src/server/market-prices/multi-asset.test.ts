import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { instrument, type InstrumentInput } from "./model";
import { REVIEWED_PILOT } from "./universe";
import { chartFixture, TEST_NOW } from "./fixtures";
import { parseYahooChart, fetchYahooDaily } from "./yahoo";
import { PriceStore } from "./store";
import { expectedClosedSession } from "./sessions";
import { priceProviderBudget, priceDeadline } from "./request-budget";
import { runPriceRefresh, scheduledCutoff } from "./collector";
import { priceRights } from "./rights";

beforeEach(() => { vi.stubEnv("MARKET_PRICES_PROFILE", "reviewed-pilot-v1"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("keeps stock, ETF, index level, gold ETF, spot and continuous future distinct", () => {
  expect(REVIEWED_PILOT).toHaveLength(8);
  expect(instrument({ market: "US", symbol: "^GSPC" })).toMatchObject({ id: "US:^GSPC", assetClass: "index_level", yahooSymbol: "^GSPC" });
  expect(instrument({ market: "US", symbol: "SPY" }).assetClass).toBe("equity_etf");
  expect(instrument({ market: "US", symbol: "GLD" }).assetClass).toBe("gold_etf");
  expect(priceRights({ market: "US", symbol: "XAUUSD=X" }).status).toBe("UNSUPPORTED");
  expect(priceRights({ market: "US", symbol: "GC=F" }).status).toBe("UNSUPPORTED");
  expect(() => instrument({ market: "US", symbol: "^UNREVIEWED" })).toThrow();
});
it.each(REVIEWED_PILOT)("binds mapped provider type, venue, currency and timezone: $symbol", input => {
  const raw = chartFixture(input);
  expect(parseYahooChart(raw, input, TEST_NOW).bars).toHaveLength(2);
  raw.chart.result[0].meta.exchangeName = "WRONG";
  expect(() => parseYahooChart(raw, input, TEST_NOW)).toThrow("provider_instrument_mismatch");
});
it("includes a closed US session at 03:23 UTC in both DST seasons, excludes still-open Asian sessions", () => {
  const summer = new Date("2026-10-16T03:23:00Z"), winter = new Date("2026-12-16T03:23:00Z");
  expect(expectedClosedSession("US", "America/New_York", summer)).toBe("2026-10-15");
  expect(expectedClosedSession("US", "America/New_York", winter)).toBe("2026-12-15");
  expect(() => parseYahooChart(chartFixture(), { market: "US", symbol: "NVDA" }, summer)).toThrow("provider_instrument_mismatch");
  const input = { market: "US", symbol: "AAPL" } as const;
  expect(parseYahooChart(chartFixture(input), input, summer).bars.map(b => b.date)).toEqual(["2026-10-14", "2026-10-15"]);
  expect(expectedClosedSession("TH", "Asia/Bangkok", summer)).toBe("2026-10-15");
  expect(expectedClosedSession("JP", "Asia/Tokyo", summer)).toBe("2026-10-15");
  expect(scheduledCutoff(summer)).toBe(Date.parse("2026-10-16T03:23:00Z"));
  expect(expectedClosedSession("US", "America/New_York", new Date("2026-10-19T03:23Z"))).toBe("2026-10-16");
  expect(expectedClosedSession("US", "America/New_York", new Date("2026-12-26T03:23Z"), ["2026-12-25"])).toBe("2026-12-24");
});
it("stores null volume and close-only rows without synthesizing OHLC, then revisions can replace partial rows", () => {
  const input = { market: "US", symbol: "^GSPC" } as const;
  const raw = chartFixture(input), quote = raw.chart.result[0].indicators.quote[0];
  (quote.volume as (number | null)[])[0] = null;
  for (const key of ["open", "high", "low"] as const) (quote[key] as (number | null)[])[1] = null;
  const store = new PriceStore(":memory:", true);
  try {
    const snapshot = parseYahooChart(raw, input, TEST_NOW);
    expect(store.save(snapshot)).toMatchObject({ inserted: 2, revised: 0 });
    const firstHash = store.read(input).bars[0].valueHash;
    expect(store.read(input).bars).toMatchObject([{ volume: null, completeness: "ohlc_without_volume" }, { open: null, high: null, low: null, completeness: "close_only" }]);
    expect(store.save(snapshot)).toMatchObject({ inserted: 0, revised: 0, unchanged: 2 });
    expect(store.read(input).bars[0].valueHash).toBe(firstHash);
    expect(store.save(parseYahooChart(chartFixture(input), input, TEST_NOW))).toMatchObject({ revised: 2 });
    expect(store.read(input).total).toBe(2);
    expect(store.read(input).bars[0].valueHash).not.toBe(firstHash);
    expect(store.db.prepare("SELECT count(*) AS n FROM partial_bars").get()).toEqual({ n: 0 });
    expect(store.read(input).series).toMatchObject({ seriesSchemaVersion: 2, rights: { status: "RIGHTS_HOLD" } });
  } finally { store.close(); }
});
it("reads a legacy signed-store payload without extension tables and labels absent provenance", () => {
  const input = { market: "US", symbol: "AAPL" } as const;
  const writer = new PriceStore(":memory:", true);
  writer.save(parseYahooChart(chartFixture(input), input, TEST_NOW));
  writer.db.exec("DROP TABLE partial_bars; DROP TABLE series_metadata");
  const reader = new PriceStore(writer.db.serialize());
  try {
    expect(reader.read(input)).toMatchObject({ total: 2, seriesSchemaVersion: 2, series: { rights: { status: "RIGHTS_HOLD" }, provenance: "legacy_metadata_unavailable" } });
    expect(reader.instruments()[0]).toMatchObject({ id: "US:AAPL", assetClass: "equity", venue: "XNAS" });
  } finally { reader.close(); writer.close(); }
});
it("blocks default provider/Drive access on rights hold and reports all listings without opening a lock", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_SCHEDULE", "external");
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", "");
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not call"));
  const result = await runPriceRefresh({ trigger: "job", now: TEST_NOW });
  expect(result).toMatchObject({ status: "rights_hold", batches: 0, providerRequests: 0, writesPerformed: false });
  expect(result.listingReceipts).toHaveLength(8);
  expect(result.listingReceipts.every(r => r.status === "RIGHTS_HOLD")).toBe(true);
  expect(network).not.toHaveBeenCalled();
});
it("counts actual provider requests and refuses the next request when the bounded budget is spent", async () => {
  const input: InstrumentInput = { market: "US", symbol: "AAPL" };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(chartFixture(input))));
  await priceProviderBudget.run({ requests: 0, limit: 1 }, async () => {
    await fetchYahooDaily(input, { now: TEST_NOW, fetcher });
    await expect(fetchYahooDaily(input, { now: TEST_NOW, fetcher })).rejects.toThrow("provider_request_budget_exhausted");
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("never accepts NaN or a forged snapshot identity at the SQLite boundary", () => {
  const input = { market: "US", symbol: "AAPL" } as const, s = parseYahooChart(chartFixture(input), input, TEST_NOW);
  const store = new PriceStore(":memory:", true);
  try {
    s.instrument.currency = "THB";
    expect(() => store.save(s)).toThrow("invalid_snapshot");
    s.instrument.currency = "USD"; s.bars[0].close = NaN;
    expect(() => store.save(s)).toThrow("invalid_snapshot");
    expect(store.instruments()).toHaveLength(0);
  } finally { store.close(); }
});
it("rejects an empty provider series without inventing a latest bar", () => {
  const input = { market: "US", symbol: "AAPL" } as const, raw = chartFixture(input);
  raw.chart.result[0].timestamp = [];
  for (const values of Object.values(raw.chart.result[0].indicators.quote[0])) values.length = 0;
  raw.chart.result[0].indicators.adjclose[0].adjclose = [];
  expect(() => parseYahooChart(raw, input, TEST_NOW)).toThrow("no_completed_bars");
});
it("aborts an in-flight mock provider request at the run deadline without leaking error text", async () => {
  const input = { market: "US", symbol: "AAPL" } as const;
  const fetcher: typeof fetch = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("synthetic-private-upstream-error")), { once: true });
  }));
  await expect(priceDeadline.run(Date.now() + 1000, () => fetchYahooDaily(input, { now: TEST_NOW, fetcher })))
    .rejects.toThrow("provider_unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

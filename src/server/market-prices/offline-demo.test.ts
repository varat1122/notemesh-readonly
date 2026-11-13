import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { runOfflinePriceDemo, offlineWatchlist } from "./offline-demo";
import { MVP_PILOT } from "./universe";
import { priceWatchlist, priceWatchlistFrom } from "./collector";
import { parseYahooChart } from "./yahoo";
import { syntheticDailyChart, DEMO_CLOSURES } from "./offline-fixtures";
import { expectedClosedSession } from "./sessions";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("demonstrates a one-year synthetic history, increment, replay, correction, holiday, quality failures and MCP readback without network", async () => {
  const sentinel = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("must never access network"));
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", "owner-environment-sentinel-not-a-license");
  vi.stubEnv("MARKET_PRICES_ENABLED", "0");
  const result = await runOfflinePriceDemo();
  expect(result).toMatchObject({ status: "OFFLINE_DEMO_COMPLETE", syntheticOnly: true,
    rights: { liveStatus: "RIGHTS_HOLD", operatorAttestationUsed: false },
    cost: { networkAttempts: 0, marketApiRequests: 0, googleDriveRequests: 0, apiCostUSD: 0, maxSymbols: 5, maxRequestsPerRun: 10, automaticRetries: 0 },
    activation: { schedulerEnabled: false, realDriveEnabled: false, liveProviderEnabled: false }, integrity: { tamperRejected: true } });
  const stages = result.receipts.map(r => r.body) as { phase: string; status: string; fixtureRequests: number;
    newArchiveGenerations: number; changes: { inserted: number; revised: number }[];
    listings: { instrumentId: string; rowCount: number; correctionCount: number; status: string; latestSessionDate: string }[] }[];
  expect(stages[0].listings.every(r => r.rowCount > 250 && r.status === "UPDATED")).toBe(true);
  expect(stages[1].changes.every(r => r.inserted === 1 && r.revised === 0)).toBe(true);
  expect(stages[2]).toMatchObject({ fixtureRequests: 0, newArchiveGenerations: 0 });
  expect(stages[3].listings.find(r => r.instrumentId === "US:AAPL")?.correctionCount).toBe(1);
  expect(result.revisionEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ date: "2026-10-01" })]));
  expect(stages[5].listings.map(r => r.rowCount)).toEqual(stages[4].listings.map(r => r.rowCount));
  expect(stages[5].listings.every(r => r.latestSessionDate === "2026-12-24" && r.status === "ALREADY_CURRENT")).toBe(true);
  expect(stages[6]).toMatchObject({ status: "partial_failure", listings: expect.arrayContaining([
    expect.objectContaining({ instrumentId: "US:AAPL", status: "FAILED", reason: "incomplete_or_invalid_provider_bars" }),
    expect.objectContaining({ instrumentId: "US:MSFT", status: "FAILED", reason: "incomplete_or_invalid_provider_bars" }),
  ]) });
  expect(stages[7]).toMatchObject({ status: "partial_failure", fixtureRequests: 1 });
  expect(result.aiReader.results).toEqual(expect.arrayContaining([expect.objectContaining({ instrument: expect.objectContaining({ id: "US:^GSPC", assetClass: "index_level" }),
    series: expect.objectContaining({ dataOrigin: "synthetic_fixture", rights: { status: "RIGHTS_HOLD", reason: expect.any(String) } }),
    bars: expect.arrayContaining([expect.objectContaining({ volume: null, completeness: "ohlc_without_volume" })]) })]));
  expect(new Set(result.receipts.map(r => r.receiptId)).size).toBe(8);
  expect(result.receipts.every(r => /^[a-f0-9]{64}$/.test(r.sha256))).toBe(true);
  expect(result.cost.fixtureRequests).toBeLessThanOrEqual(40);
  expect(stages.every(r => r.fixtureRequests <= 10)).toBe(true);
  expect(sentinel).not.toHaveBeenCalled();
  expect(process.env.MARKET_PRICES_RIGHTS_REVIEW).toBe("owner-environment-sentinel-not-a-license");
  expect(process.env.MARKET_PRICES_ENABLED).toBe("0");
}, 15000);
it("allows only one to five distinct reviewed pilot examples", () => {
  expect(offlineWatchlist([MVP_PILOT[3]])).toEqual([MVP_PILOT[3]]);
  for (const value of [[], [...MVP_PILOT, MVP_PILOT[0]], [MVP_PILOT[0], MVP_PILOT[0]], [{ market: "TH", symbol: "NVDA80" }], [{ market: "US", symbol: "GC=F" }]])
    expect(() => offlineWatchlist(value)).toThrow("invalid_offline_watchlist");
});
it("enforces the MVP cap in ordinary collector configuration and explicit batch inputs", () => {
  vi.stubEnv("MARKET_PRICES_PROFILE", "free-first-mvp-v1"); vi.stubEnv("MARKET_PRICES_WATCHLIST", "");
  expect(priceWatchlist()).toEqual(MVP_PILOT);
  expect(() => priceWatchlistFrom({ watchlist: [...MVP_PILOT, { market: "US", symbol: "QQQ" }] })).toThrow();
  vi.stubEnv("MARKET_PRICES_WATCHLIST", JSON.stringify([...MVP_PILOT, { market: "US", symbol: "QQQ" }]));
  expect(() => priceWatchlist()).toThrow("invalid_price_watchlist");
});
it("honours explicit closures in provider normalization and refuses malformed calendars", () => {
  vi.stubEnv("MARKET_PRICES_PROFILE", "free-first-mvp-v1");
  vi.stubEnv("MARKET_PRICES_SESSION_CLOSURES", JSON.stringify({ US: DEMO_CLOSURES }));
  const now = new Date("2026-12-26T03:23Z");
  expect(expectedClosedSession("US", "America/New_York", now)).toBe("2026-12-24");
  const s = parseYahooChart(syntheticDailyChart(MVP_PILOT[0], now), MVP_PILOT[0], now);
  expect(s.bars.some(b => b.date === "2026-12-25")).toBe(false);
  vi.stubEnv("MARKET_PRICES_SESSION_CLOSURES", '{"US":["2026-02-30"]}');
  expect(() => expectedClosedSession("US", "America/New_York", now)).toThrow("invalid_price_session_closures");
});
it("accepts a one-symbol watchlist through the manual CLI and rejects a six-symbol configuration before the demo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "offline-cli-"));
  try {
    const file = path.join(root, "watchlist.json"); fs.writeFileSync(file, JSON.stringify([MVP_PILOT[2]]));
    const out = execFileSync(process.execPath, ["scripts/market-prices.ts", "dry-run", "--watchlist", file], { encoding: "utf8", timeout: 20000 });
    const body = JSON.parse(out.slice(out.indexOf('{\n  "status": "OFFLINE_DEMO_COMPLETE"')));
    expect(body.requested).toMatchObject([{ id: "US:SPY" }]);
    expect(body.cost.marketApiRequests).toBe(0);
    fs.writeFileSync(file, JSON.stringify([...MVP_PILOT, MVP_PILOT[0]]));
    expect(() => execFileSync(process.execPath, ["scripts/market-prices.ts", "dry-run", "--watchlist", file], { stdio: "pipe", timeout: 10000 })).toThrow();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 25000);

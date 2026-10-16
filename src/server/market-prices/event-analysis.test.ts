import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceStore, priceDbPath } from "./store";
import { analyzePriceEvent } from "./event-analysis";
import { instrument, type PriceSnapshot } from "./model";

let root: string, store: PriceStore;
let stock: PriceSnapshot, benchmark: PriceSnapshot;
const dates: string[] = [];
for (let date = new Date("2026-01-05T12:00Z"); dates.length < 30; date = new Date(date.getTime() + 86400000)) {
  if (![0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
}
const request = { market: "US", symbol: "NVDA", eventSessionDate: dates[20], timing: "before_open", horizons: [1, 5, 20] } as const;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "event-study-")); vi.stubEnv("DATA_DIR", root);
  store = new PriceStore(priceDbPath(), true);
  const snapshot = (symbol: string, step: number): PriceSnapshot => ({ instrument: instrument({ market: "US", symbol }),
    source: "yahoo-chart", fetchedAt: "2026-10-16T06:00:00Z", missingBars: 0, quarantinedBars: [], excludedCurrentSession: 0, actions: [],
    bars: dates.map((date, i) => ({ date, open: 100 + i * step, close: 100 + i * step, low: 99 + i * step, high: 101 + i * step,
      volume: i === 20 ? 300 : 100, adjustedClose: 100 + i * step })) });
  stock = snapshot("NVDA", 1); benchmark = snapshot("SPY", 0.1);
  store.save(stock); store.save(benchmark);
});
afterEach(() => { store.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const run = () => analyzePriceEvent(store, { ...request, horizons: [...request.horizons] });

it("compares close-to-close returns and volume on exact shared sessions", () => {
  const result = run();
  expect(result.status).toBe("partial");
  expect(result.eventVolumeRatioVsPrior20).toBe(3);
  expect(result.windows[0]).toMatchObject({ status: "calculated", baselineDate: dates[19], endDate: dates[20], horizon: 1 });
  expect(result.windows[0].stockReturnPct).toBeCloseTo((120 / 119 - 1) * 100);
  expect(result.windows[0].benchmarkReturnPct).toBeCloseTo((102 / 101.9 - 1) * 100);
  expect(result.windows[1].endDate).toBe(dates[24]);
  expect(result.windows[2].status).toBe("window_not_mature_or_missing_benchmark_data");
  expect(result.windows[0].sampleHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.methodology.excessReturn).toContain("Not a beta-adjusted");
});
it("does not calculate when publication timing or session alignment is unknown", () => {
  expect(analyzePriceEvent(store, { ...request, horizons: [1], timing: "unknown" }).status).toBe("needs_event_timing");
  expect(analyzePriceEvent(store, { ...request, horizons: [1], eventSessionDate: "2026-01-10" }).status).toBe("event_session_not_cached");
});
it("does not compress a missing stock day into an apparent N-day result", () => {
  store.db.prepare("DELETE FROM bars WHERE instrument_id='US:NVDA' AND date=?").run(dates[21]);
  const result = run();
  expect(result.windows[0].status).toBe("calculated");
  expect(result.windows[1].status).toBe("missing_stock_session");
});
it("blocks windows crossing known quarantined benchmark/stock data", () => {
  benchmark.bars = benchmark.bars.filter(b => b.date !== dates[21]);
  benchmark.quarantinedBars.push({ date: dates[21], reason: "invalid_provider_bar", values: { close: 0 } });
  store.save(benchmark);
  expect(run().windows[1].status).toBe("quarantined_data_in_window");
});
it("refuses a cross-market comparator and keeps split-contaminated volume unavailable", () => {
  expect(() => analyzePriceEvent(store, { ...request, horizons: [1], benchmark: { market: "HK", symbol: "2800" } })).toThrow("cross_market_benchmark_refused");
  stock.actions.push({ date: dates[15], kind: "split", key: "s1", value: 10, denominator: 1 }); store.save(stock);
  expect(run().eventVolumeRatioVsPrior20).toBeNull();
});
it("distinguishes missing adjusted prices from missing future observations", () => {
  store.db.prepare("UPDATE bars SET adjusted_close=NULL WHERE instrument_id='US:NVDA' AND date=?").run(dates[20]);
  const result = analyzePriceEvent(store, { ...request, horizons: [1], basis: "adjustedClose" });
  expect(result.windows[0].status).toBe("return_basis_missing");
});

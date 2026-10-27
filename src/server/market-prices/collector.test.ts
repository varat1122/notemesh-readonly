import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshPrices, scheduledCutoff, priceWatchlist, runPriceRefresh } from "./collector";
import { priceFreshness } from "./status";
import { priceDeadline } from "./request-budget";
import { PriceStore, priceDbPath } from "./store";
import { PILOT_INSTRUMENTS, PriceError, type InstrumentInput } from "./model";
import { parseYahooChart, fetchYahooDaily } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "price-collector-")); vi.stubEnv("DATA_DIR", root); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const pause = vi.fn(async () => {});
const fetcher = vi.fn(async (input: InstrumentInput, options: { now?: Date } = {}) => parseYahooChart(chartFixture(input), input, options.now ?? TEST_NOW));

it("refreshes four markets once daily and permits the post-06:00 refresh after an earlier boot", async () => {
  const before = new Date("2026-10-16T03:00Z");
  expect(scheduledCutoff(before)).toBe(Date.parse("2026-10-15T06:00Z"));
  const first = await refreshPrices({ now: before, fetcher, pause });
  expect(first.results.filter(r => r.status === "updated")).toHaveLength(8);
  const next = await refreshPrices({ now: TEST_NOW, fetcher, pause });
  expect(next.results.every(r => r.status === "updated")).toBe(true);
  const sameDay = await refreshPrices({ now: TEST_NOW, fetcher, pause });
  expect(sameDay.results.every(r => r.status === "not_due")).toBe(true);
  expect(scheduledCutoff(TEST_NOW)).toBe(Date.parse("2026-10-16T06:00Z"));
});
it("records individual failures while retaining usable cached bars", async () => {
  await refreshPrices({ now: TEST_NOW, fetcher, pause });
  const failed = await refreshPrices({ now: TEST_NOW, force: true, pause, fetcher: async () => { throw new PriceError("provider_unavailable"); } });
  expect(failed.status).toBe("partial_failure");
  const store = new PriceStore(priceDbPath());
  try { expect(store.read(PILOT_INSTRUMENTS[0]).total).toBe(2); expect(store.instruments()).toHaveLength(8); }
  finally { store.close(); }
});
it("stops the entire provider after 429 and respects durable cooldown even with force", async () => {
  const limited = vi.fn(async () => { throw new PriceError("provider_rate_limited"); });
  const result = await refreshPrices({ now: TEST_NOW, fetcher: limited, pause });
  expect(result.results).toHaveLength(1); expect(limited).toHaveBeenCalledTimes(1);
  const again = await refreshPrices({ now: TEST_NOW, force: true, fetcher: limited, pause });
  expect(again.status).toBe("provider_cooldown"); expect(limited).toHaveBeenCalledTimes(1);
});
it("validates watchlists before creating a database or making a request", async () => {
  vi.stubEnv("MARKET_PRICES_WATCHLIST", '[{"market":"US","symbol":"NVDA"},{"market":"US","symbol":"NVDA"}]');
  expect(() => priceWatchlist()).toThrow("invalid_price_watchlist");
  await expect(refreshPrices({ fetcher, pause })).rejects.toThrow("invalid_price_watchlist");
  expect(fs.existsSync(priceDbPath())).toBe(false);
});

function enableRun() {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1");
  vi.stubEnv("MARKET_PRICES_SCHEDULE", "external");
}
it("fails closed before disk/network when a run is disabled, mis-scheduled or forced", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "0");
  await expect(runPriceRefresh({ trigger: "admin" })).rejects.toThrow("price_refresh_disabled");
  enableRun(); vi.stubEnv("MARKET_PRICES_SCHEDULE", "in-process");
  await expect(runPriceRefresh({ trigger: "job" })).rejects.toThrow("price_job_requires_external_schedule");
  await expect(runPriceRefresh({ trigger: "admin", force: true })).rejects.toThrow("bounded_refresh_does_not_force");
  expect(fs.readdirSync(root)).toEqual([]);
});
it("runs the whole disk watchlist, skips an already collected day and catches up after restart", async () => {
  enableRun(); const pull = vi.fn(async (i: InstrumentInput, o: { now?: Date } = {}) => fetcher(i, o));
  expect((await runPriceRefresh({ trigger: "job", now: TEST_NOW, fetcher: pull, pause })).status).toBe("complete");
  expect(pull).toHaveBeenCalledTimes(8);
  expect((await runPriceRefresh({ trigger: "admin", now: TEST_NOW, fetcher: pull, pause })).status).toBe("complete");
  expect(pull).toHaveBeenCalledTimes(8);
  expect((await runPriceRefresh({ trigger: "job", now: new Date("2026-10-19T07:00Z"), fetcher: pull, pause })).status).toBe("complete");
  expect(pull).toHaveBeenCalledTimes(16);
  const store = new PriceStore(priceDbPath());
  try { expect(store.read(PILOT_INSTRUMENTS[0]).total).toBe(3); } finally { store.close(); }
});
it("excludes an overlapping manual/job run and never removes a pre-existing crash lock", async () => {
  enableRun(); let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const first = runPriceRefresh({ trigger: "job", now: TEST_NOW, pause, fetcher: async (i, o) => { await blocked; return fetcher(i, o); } });
  expect((await runPriceRefresh({ trigger: "admin", now: TEST_NOW, fetcher, pause })).status).toBe("collector_busy");
  unblock(); expect((await first).status).toBe("complete");
  const lock = path.join(path.dirname(priceDbPath()), "refresh-run.lock"); fs.mkdirSync(lock);
  expect((await runPriceRefresh({ trigger: "job", now: TEST_NOW, fetcher, pause })).status).toBe("collector_busy");
  expect(fs.existsSync(lock)).toBe(true);
});
it("reports batch/time limits as incomplete and stops without another request", async () => {
  enableRun(); const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
  const batch = vi.fn(async () => ({ status: "batch_complete", remainingDue: 3,
    results: [{ instrumentId: "US:NVDA", status: "updated" }] }));
  expect((await runPriceRefresh({ trigger: "job", batch, maxBatches: 1 })).status).toBe("pending_batch_limit");
  batch.mockImplementationOnce(async () => { clock.mockReturnValue(12000); return { status: "batch_complete", remainingDue: 3,
    results: [{ instrumentId: "US:NVDA", status: "updated" }] }; });
  expect((await runPriceRefresh({ trigger: "admin", batch, maxDurationMs: 1000 })).status).toBe("pending_time_limit");
  expect(batch).toHaveBeenCalledTimes(2);
});
it("retains old prices on provider throttling and never retries that run", async () => {
  enableRun(); await runPriceRefresh({ trigger: "job", now: TEST_NOW, fetcher, pause });
  const limited = vi.fn(async () => { throw new PriceError("provider_rate_limited"); });
  expect((await runPriceRefresh({ trigger: "job", now: new Date("2026-10-19T07:00Z"), fetcher: limited, pause })).status).toBe("partial_failure");
  expect((await runPriceRefresh({ trigger: "job", now: new Date("2026-10-19T07:00Z"), fetcher: limited, pause })).status).toBe("provider_cooldown");
  expect(limited).toHaveBeenCalledTimes(1);
  const store = new PriceStore(priceDbPath()); try { expect(store.read(PILOT_INSTRUMENTS[0]).total).toBe(2); } finally { store.close(); }
});
it("does not start a provider request after the job deadline", async () => {
  const pull = vi.fn();
  await expect(priceDeadline.run(Date.now() - 1, () => fetchYahooDaily(PILOT_INSTRUMENTS[0], { now: TEST_NOW, fetcher: pull }))).rejects.toThrow("price_refresh_deadline_exceeded");
  expect(pull).not.toHaveBeenCalled();
});
it("separates collection freshness from the actual price date and exposes missing/failed listings", () => {
  const f = priceFreshness([{ id: "US:NVDA", lastDate: "2026-10-09", lastSuccessfulRefresh: TEST_NOW.toISOString(), lastError: null },
    { id: "TH:PTT", lastDate: "2026-10-15", lastSuccessfulRefresh: "2026-10-15T06:30:00Z", lastError: "provider_rate_limited" }], TEST_NOW);
  expect(f.listings[0]).toMatchObject({ refreshState: "updated_this_cycle", lastPriceDate: "2026-10-09" });
  expect(f.listings[1].refreshState).toBe("failed"); expect(f.listings[2].refreshState).toBe("not_cached");
  expect(f.warning).toContain("no official holiday calendar");
});

it("does not call a temporarily deferred failed listing complete just because no retry is due", async () => {
  enableRun();
  const unavailable = vi.fn(async () => { throw new PriceError("provider_unavailable"); });
  expect((await runPriceRefresh({ trigger: "job", now: TEST_NOW, fetcher: unavailable, pause })).status).toBe("partial_failure");
  const next = await runPriceRefresh({ trigger: "job", now: TEST_NOW, fetcher: unavailable, pause });
  expect(next).toMatchObject({ status: "pending_retry_or_coverage", remainingDue: 8 }); expect(unavailable).toHaveBeenCalledTimes(8);
});

import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshPrices, scheduledCutoff, priceWatchlist } from "./collector";
import { PriceStore, priceDbPath } from "./store";
import { PILOT_INSTRUMENTS, PriceError, type InstrumentInput } from "./model";
import { parseYahooChart } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "price-collector-")); vi.stubEnv("DATA_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const pause = vi.fn(async () => {});
const fetcher = vi.fn(async (input: InstrumentInput, options: { now?: Date } = {}) => parseYahooChart(chartFixture(input), input, options.now ?? TEST_NOW));

it("refuses market-price refresh when the process-local DR writer fence is frozen",async()=>{
  const {inProcessDrWriterFence}=await import("../backup/writer-fence");
  await inProcessDrWriterFence.withFrozenWriters(async()=>{
    await expect(refreshPrices({now:TEST_NOW,fetcher,pause})).rejects.toThrow(/freeze_active/);
    expect(fs.existsSync(priceDbPath())).toBe(false);
  });
});
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

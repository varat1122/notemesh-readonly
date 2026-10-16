import { expect, it, vi } from "vitest";
import { PriceStore } from "./store";
import { fetchIncremental } from "./incremental";
import { fetchYahooDaily, parseYahooChart } from "./yahoo";
import { PriceError } from "./model";
import { chartFixture, TEST_NOW } from "./fixtures";
const input = { market: "US", symbol: "NVDA" } as const;
const tomorrow = new Date("2026-10-17T06:30:00Z");
function seeded() { const store = new PriceStore(":memory:", true); store.save(parseYahooChart(chartFixture(), input, TEST_NOW)); return store; }
it("backfills once, then appends the new session with overlap and no duplicate dates", async () => {
  const store = new PriceStore(":memory:", true);
  const fetcher = vi.fn(async () => parseYahooChart(chartFixture(), input, TEST_NOW));
  const first = await fetchIncremental(store, input, { now: TEST_NOW, lastFullRefreshAt: null, fetcher });
  expect(first.full).toBe(true); expect(fetcher.mock.calls[0]).toEqual([input, { now: TEST_NOW, start: undefined }]); store.save(first.snapshot);
  const daily = vi.fn(async () => parseYahooChart(chartFixture(), input, tomorrow));
  const next = await fetchIncremental(store, input, { now: tomorrow, lastFullRefreshAt: TEST_NOW.toISOString(), fetcher: daily });
  expect(next.full).toBe(false); expect(daily).toHaveBeenCalledTimes(1);
  expect(daily.mock.calls[0]).toEqual([input, { now: tomorrow, start: "2026-09-15" }]);
  store.save(next.snapshot); store.save(next.snapshot); expect(store.read(input).total).toBe(3); store.close();
});
it("rechecks full history weekly, beginning at the earliest stored session", async () => {
  const store = seeded(), fetcher = vi.fn(async () => parseYahooChart(chartFixture(), input, tomorrow));
  const now = new Date("2026-10-24T06:30Z");
  expect((await fetchIncremental(store, input, { now, lastFullRefreshAt: TEST_NOW.toISOString(), fetcher })).full).toBe(true);
  expect(fetcher.mock.calls[0]).toEqual([input, { now, start: "2026-10-14" }]); store.close();
});
it("detects an adjusted-price overlap change before saving and refetches the full basis", async () => {
  const store = seeded(), changed = parseYahooChart(chartFixture(), input, tomorrow); changed.bars[0].adjustedClose = 5;
  const fetcher = vi.fn(async () => changed), pause = vi.fn(async () => {});
  expect((await fetchIncremental(store, input, { now: tomorrow, lastFullRefreshAt: TEST_NOW.toISOString(), fetcher, pause })).full).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(pause).toHaveBeenCalledWith(3000);
  expect((store.read(input).bars[0] as { adjustedClose: number }).adjustedClose).toBe(10.5); store.close();
});
it("detects new dividends/splits but does not repeatedly rebase already known actions", async () => {
  const store = seeded(), changed = parseYahooChart(chartFixture(), input, tomorrow);
  changed.actions.push({ key: "dividend:new", date: "2026-10-16", kind: "dividend", value: 0.2, denominator: null });
  const fetcher = vi.fn(async () => changed);
  expect((await fetchIncremental(store, input, { now: tomorrow, lastFullRefreshAt: TEST_NOW.toISOString(), fetcher, pause: async () => {} })).full).toBe(true);
  store.save(changed); fetcher.mockClear();
  expect((await fetchIncremental(store, input, { now: tomorrow, lastFullRefreshAt: tomorrow.toISOString(), fetcher })).full).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1); store.close();
});
it("keeps old values intact if a required full rebase is throttled", async () => {
  const store = seeded(), changed = parseYahooChart(chartFixture(), input, tomorrow); changed.bars[0].close = 11.2;
  const fetcher = vi.fn().mockResolvedValueOnce(changed).mockRejectedValueOnce(new PriceError("provider_rate_limited"));
  await expect(fetchIncremental(store, input, { now: tomorrow, lastFullRefreshAt: TEST_NOW.toISOString(), fetcher, pause: async () => {} })).rejects.toThrow("provider_rate_limited");
  expect((store.read(input).bars[0] as { close: number }).close).toBe(11); store.close();
});
it("bounds the actual provider request to the requested incremental window", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(chartFixture())));
  await fetchYahooDaily(input, { now: tomorrow, start: "2026-10-15", fetcher });
  const request = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(request[0].searchParams.get("period1")).toBe(String(Date.parse("2026-10-15T00:00Z") / 1000));
  await expect(fetchYahooDaily(input, { now: tomorrow, start: "2027-01-01", fetcher })).rejects.toThrow("invalid_provider_window");
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PriceStore } from "./store";
import { collectIntoPriceStore } from "./collector";
import { chartFixture, TEST_NOW } from "./fixtures";
import { parseYahooChart } from "./yahoo";
import { listingSessionQuality } from "./listing-quality";
import { completedPriceSessionPredicate } from "./sessions";

const input = { market: "US", symbol: "NVDA" } as const;
let store: PriceStore;
beforeEach(() => { vi.stubEnv("MARKET_PRICES_PROFILE", ""); store = new PriceStore(":memory:", true); });
afterEach(() => { store.close(); vi.unstubAllEnvs(); });
const snapshot = () => parseYahooChart(chartFixture(input), input, TEST_NOW);

it("holds a provider response that silently omits an already stored requested session", async () => {
  store.save(snapshot());
  const partial = snapshot(); partial.bars.shift();
  const result = await collectIntoPriceStore(store, { watchlist: [input], now: TEST_NOW, force: true, fetcher: async () => partial });
  expect(result.results[0]).toMatchObject({ status: "failed", errorCode: "provider_partial_response" });
  expect(store.read(input).bars).toHaveLength(2);
});

it.each(["changed", "omitted", "backdated"])("holds %s corporate actions without overwriting accepted bars/actions", async kind => {
  const before = snapshot(); store.save(before);
  const next = snapshot(); next.bars[0].close = 10.25;
  if (kind === "changed") next.actions[0].value += 1;
  if (kind === "omitted") next.actions.shift();
  if (kind === "backdated") next.actions.push({ ...next.actions[0], key: "dividend:late-declaration" });
  const result = await collectIntoPriceStore(store, { watchlist: [input], now: TEST_NOW, force: true, fetcher: async () => next });
  expect(result.results[0]).toMatchObject({ status: "failed", errorCode: "unexpected_corporate_action_revision" });
  expect(store.read(input).bars[0].close).toBe(before.bars[0].close);
  expect(store.db.prepare("SELECT COUNT(*) AS n FROM revisions").get()).toEqual({ n: 0 });
});

it("quarantines a newly incomplete bar and reports failure instead of retaining it as current", async () => {
  store.save(snapshot());
  const raw = chartFixture(input);
  (raw.chart.result[0].indicators.quote[0].open as (number | null)[])[0] = null;
  const incomplete = parseYahooChart(raw, input, TEST_NOW);
  const result = await collectIntoPriceStore(store, { watchlist: [input], now: TEST_NOW, force: true, fetcher: async () => incomplete });
  expect(result.results[0]).toMatchObject({ status: "failed", errorCode: "incomplete_or_invalid_provider_bars" });
  expect(store.read(input)).toMatchObject({ total: 1, qualityIssues: [{ date: "2026-10-14", reason: "incomplete_provider_bar" }] });
});

it("keeps an ordinary source correction receipt and idempotent same-day replay", async () => {
  store.save(snapshot());
  const changed = snapshot(); changed.bars[0].close = 10.25;
  const result = await collectIntoPriceStore(store, { watchlist: [input], now: TEST_NOW, force: true, fetcher: async () => changed });
  expect(result.results[0]).toMatchObject({ status: "updated", revised: 1 });
  const fetcher = vi.fn(async () => changed);
  const replay = await collectIntoPriceStore(store, { watchlist: [input], now: TEST_NOW, fetcher });
  expect(replay.results[0].status).toBe("not_due"); expect(fetcher).not.toHaveBeenCalled();
  const receipt = store.db.prepare("SELECT before_json,after_json FROM revisions").get() as { before_json: string; after_json: string };
  expect(JSON.parse(receipt.before_json).close).toBe(11);
  expect(JSON.parse(receipt.after_json).close).toBe(10.25);
});

it("reports internal missing weekdays without inventing bars or declaring holidays verified", () => {
  const result = listingSessionQuality(input, ["2026-10-12", "2026-10-14", "2026-10-15"], TEST_NOW);
  expect(result).toMatchObject({ missingSessionCount: 1, missingSessions: ["2026-10-13"], canonicalListingId: null,
    calendar: "weekday_plus_configured_closures_not_official" });
  vi.stubEnv("MARKET_PRICES_SESSION_CLOSURES", JSON.stringify({ US: ["2026-10-13"] }));
  expect(listingSessionQuality(input, ["2026-10-12", "2026-10-14", "2026-10-15"], TEST_NOW).missingSessionCount).toBe(0);
});

it.each([
  ["2026-03-06T21:59:00Z", "2026-03-06", false],
  ["2026-03-06T22:00:00Z", "2026-03-06", true],
  ["2026-03-09T20:59:00Z", "2026-03-09", false],
  ["2026-03-09T21:00:00Z", "2026-03-09", true],
  ["2026-11-02T21:59:00Z", "2026-11-02", false],
  ["2026-11-02T22:00:00Z", "2026-11-02", true],
] as const)("uses exchange timezone and publication lag across DST: %s", (now, date, expected) => {
  expect(completedPriceSessionPredicate("US", "America/New_York", new Date(now))(date)).toBe(expected);
});

it.each([NaN, Infinity, -Infinity])("refuses non-finite provider numbers: %s", bad => {
  const raw = chartFixture(input); raw.chart.result[0].indicators.quote[0].close[0] = bad;
  expect(() => parseYahooChart(raw, input, TEST_NOW)).toThrow("invalid_provider_response");
});

it.each([-1, Number.MAX_SAFE_INTEGER + 1, 0.25])("quarantines impossible volume: %s", bad => {
  const raw = chartFixture(input); raw.chart.result[0].indicators.quote[0].volume[0] = bad;
  expect(parseYahooChart(raw, input, TEST_NOW)).toMatchObject({ quarantinedBars: [{ date: "2026-10-14", reason: "invalid_provider_bar" }] });
});

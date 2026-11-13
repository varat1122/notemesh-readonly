import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { parseYahooChart } from "./yahoo";
import { chartFixture } from "./fixtures";
import { priceWatchlistFrom, scheduledCutoff } from "./collector";
import { stalePriceSession } from "./receipts";
import { assertPriceRights } from "./rights";

afterEach(() => vi.unstubAllEnvs());
it("admits a completed US session at the following UTC morning for a bounded listing-local profile", () => {
  vi.stubEnv("MARKET_PRICES_PROFILE", "listing-local-bounded-v1");
  const input = { market: "US", symbol: "NVDA" } as const, now = new Date("2026-10-16T03:23:00Z");
  const raw = chartFixture(input); raw.chart.result[0].meta.exchangeName = "MOCK_VENUE";
  const parsed = parseYahooChart(raw, input, now);
  expect(parsed.bars.at(-1)?.date).toBe("2026-10-15");
  expect(parsed.providerIdentity).toMatchObject({ exchange: "MOCK_VENUE", sourceSymbol: "NVDA", currency: "USD", timeZone: "America/New_York",
    authority: "provider_response_claim_not_registry_verification" });
  expect(scheduledCutoff(now)).toBe(now.getTime());
  expect(stalePriceSession(input, "2026-10-14", now)).toBe(true);
});
it("refuses missing exchange metadata instead of guessing a venue from a ticker", () => {
  vi.stubEnv("MARKET_PRICES_PROFILE", "listing-local-bounded-v1");
  const raw = chartFixture(); raw.chart.result[0].meta.exchangeName = "";
  expect(() => parseYahooChart(raw, { market: "US", symbol: "NVDA" })).toThrow("provider_exchange_metadata_missing");
});
it("caps the explicit profile at 20 and retains the separate live archive rights gate", () => {
  vi.stubEnv("MARKET_PRICES_PROFILE", "listing-local-bounded-v1"); vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", "");
  const watchlist = JSON.parse(fs.readFileSync("integrations/market-prices/go-bounded-watchlist.example.json", "utf8"));
  expect(priceWatchlistFrom({ watchlist })).toHaveLength(20);
  expect(new Set(watchlist.map((i: { market: string; symbol: string }) => `${i.market}:${i.symbol}`)).size).toBe(20);
  expect(() => priceWatchlistFrom({ watchlist: [...watchlist, { market: "US", symbol: "EXTRA" }] })).toThrow();
  expect(() => assertPriceRights(watchlist[0], new Date())).toThrow("price_rights_hold");
});

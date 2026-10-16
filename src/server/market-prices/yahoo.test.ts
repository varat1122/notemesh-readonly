import { describe, it, expect, vi } from "vitest";
import { instrument, PILOT_INSTRUMENTS, isoDate, localDate } from "./model";
import { fetchYahooDaily, parseYahooChart } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";

describe("four-market identity and dates", () => {
  it("keeps local shares, alphanumeric Japanese codes and Thai DRs distinct", () => {
    expect(PILOT_INSTRUMENTS.map(i => instrument(i).yahooSymbol)).toEqual(["NVDA", "PTT.BK", "9988.HK", "7203.T"]);
    expect(instrument({ market: "JP", symbol: "285a" }).yahooSymbol).toBe("285A.T");
    expect(instrument({ market: "TH", symbol: "NVDA80" }).id).not.toBe(instrument({ market: "US", symbol: "NVDA" }).id);
    expect(() => instrument({ market: "HK", symbol: "9988.HK" })).toThrow();
    expect(() => instrument({ market: "US", symbol: "../NVDA" })).toThrow();
  });
  it("uses exchange-local dates, validates leap days and rejects impossible dates", () => {
    expect(localDate(Date.parse("2026-10-16T02:00Z"), "America/New_York")).toBe("2026-10-15");
    expect(localDate(Date.parse("2026-10-16T02:00Z"), "Asia/Tokyo")).toBe("2026-10-16");
    expect(isoDate.safeParse("2024-02-29").success).toBe(true);
    expect(isoDate.safeParse("2026-02-29").success).toBe(false);
  });
});

describe("daily Yahoo normalization", () => {
  it.each(PILOT_INSTRUMENTS)("normalizes $market and excludes the current exchange date", input => {
    const data = parseYahooChart(chartFixture(input), input, TEST_NOW);
    expect(data.bars.map(b => b.date)).toEqual(["2026-10-14", "2026-10-15"]);
    expect(data.bars[0]).toMatchObject({ open: 10, close: 11, adjustedClose: 10.5, volume: 100 });
    expect(data.excludedCurrentSession).toBe(1);
    expect(data.actions).toHaveLength(2);
  });
  it("excludes the just-closed US day until its exchange calendar date ends", () => {
    const data = parseYahooChart(chartFixture(), { market: "US", symbol: "NVDA" }, new Date("2026-10-16T02:00Z"));
    expect(data.bars.map(b => b.date)).toEqual(["2026-10-14"]);
  });
  it("retains zero volume but never manufactures null or missing bars", () => {
    const raw = chartFixture(); raw.chart.result[0].indicators.quote[0].volume[0] = 0;
    expect(parseYahooChart(raw, { market: "US", symbol: "NVDA" }, TEST_NOW).bars[0].volume).toBe(0);
    (raw.chart.result[0].indicators.quote[0].open as (number | null)[])[1] = null;
    const data = parseYahooChart(raw, { market: "US", symbol: "NVDA" }, TEST_NOW);
    expect(data.bars).toHaveLength(1); expect(data.missingBars).toBe(1);
  });
  it.each(["currency", "symbol", "exchangeTimezoneName", "instrumentType"] as const)("refuses wrong provider %s", field => {
    const raw = chartFixture(); raw.chart.result[0].meta[field] = "wrong";
    expect(() => parseYahooChart(raw, { market: "US", symbol: "NVDA" }, TEST_NOW)).toThrow("provider_instrument_mismatch");
  });
  it.each(["high", "volume"] as const)("quarantines invalid %s without rounding or inventing a replacement", field => {
    const raw = chartFixture(); raw.chart.result[0].indicators.quote[0][field][0] = field === "high" ? 1 : 0.5;
    const data = parseYahooChart(raw, { market: "US", symbol: "NVDA" }, TEST_NOW);
    expect(data.quarantinedBars).toMatchObject([{ date: "2026-10-14", reason: "invalid_provider_bar" }]);
    expect(data.bars.map(b => b.date)).toEqual(["2026-10-15"]);
  });
  it("refuses mismatched arrays and duplicate session dates", () => {
    const raw = chartFixture(); raw.chart.result[0].indicators.quote[0].low.pop();
    expect(() => parseYahooChart(raw, { market: "US", symbol: "NVDA" }, TEST_NOW)).toThrow("provider_array_mismatch");
    const duplicate = chartFixture(); duplicate.chart.result[0].timestamp[1] = duplicate.chart.result[0].timestamp[0];
    expect(() => parseYahooChart(duplicate, { market: "US", symbol: "NVDA" }, TEST_NOW)).toThrow("duplicate_provider_date");
  });
  it("requests a fixed HTTPS host, five years, daily bars and corporate actions", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(chartFixture())));
    await fetchYahooDaily({ market: "US", symbol: "NVDA" }, { now: TEST_NOW, fetcher });
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://query1.finance.yahoo.com");
    expect(url.searchParams.get("interval")).toBe("1d");
    expect(url.searchParams.get("events")).toBe("div,splits");
    expect(options.redirect).toBe("error");
  });
  it("stops on rate limits and oversized responses without leaking upstream text", async () => {
    const input = { market: "US", symbol: "NVDA" } as const;
    await expect(fetchYahooDaily(input, { fetcher: vi.fn(async () => new Response("secret", { status: 429 })) })).rejects.toThrow("provider_rate_limited");
    await expect(fetchYahooDaily(input, { fetcher: vi.fn(async () => new Response("x".repeat(3 * 1024 * 1024))) })).rejects.toThrow("provider_response_too_large");
    await expect(fetchYahooDaily(input, { fetcher: vi.fn(async () => { throw new Error("credentials/internal/path"); }) })).rejects.toThrow("provider_unavailable");
  });
});

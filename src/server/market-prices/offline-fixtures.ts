import { instrument, type InstrumentInput } from "./model.ts";
import { assetDefinition } from "./universe.ts";
import { configuredPriceClosures, expectedClosedSession } from "./sessions.ts";

// Fabricated prices and an illustrative closure list; NEVER a market-data extract/calendar service.
export const DEMO_CLOSURES = ["2025-12-25", "2026-01-01", "2026-07-03", "2026-12-25"];
export function syntheticDailyChart(input: InstrumentInput, now: Date, options: {
  start?: string; correction?: boolean; fault?: "anomaly" | "partial";
} = {}) {
  const i = instrument(input), definition = assetDefinition(i.id)!;
  const last = expectedClosedSession(i.market, i.timeZone, now), dates: string[] = [], closures = configuredPriceClosures(i.market);
  for (const d = new Date("2025-10-01T12:00Z"); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (![0, 6].includes(d.getUTCDay()) && !closures.includes(date) && date >= (options.start ?? "2025-10-01")) dates.push(date);
  }
  const close = dates.map(date => 100 + Math.round((Date.parse(date) - Date.parse("2025-10-01")) / 86400000) / 10 +
    (options.correction && input.symbol === "AAPL" && date === "2026-10-01" ? 0.25 : 0));
  const quote = { open: close.map(c => c - 0.5) as (number | null)[], high: close.map(c => c + 1),
    low: close.map(c => c - 1), close, volume: dates.map(() => input.symbol === "^GSPC" ? null : 10000) };
  if (options.fault === "anomaly" && dates.length) quote.high[dates.length - 1] = 1;
  if (options.fault === "partial" && dates.length) quote.open[dates.length - 1] = null;
  return { chart: { error: null, result: [{ meta: { symbol: i.yahooSymbol, currency: i.currency,
    exchangeTimezoneName: i.timeZone, instrumentType: definition.providerType, exchangeName: definition.providerVenue },
    timestamp: dates.map(date => Date.parse(date + "T12:00Z") / 1000), indicators: { quote: [quote],
      adjclose: [{ adjclose: close.map(c => c * 0.98) }] } }] } };
}

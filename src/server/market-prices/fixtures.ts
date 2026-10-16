// Synthetic data only. Real market responses/prices are not committed as fixtures.
import { instrument, type InstrumentInput } from "./model.ts";

export const TEST_NOW = new Date("2026-10-16T06:30:00Z");
export function chartFixture(input: InstrumentInput = { market: "US", symbol: "NVDA" }) {
  const i = instrument(input);
  // Noon UTC maps to the correct exchange calendar date in all four markets.
  return { chart: { error: null, result: [{
    meta: { symbol: i.yahooSymbol, currency: i.currency, exchangeTimezoneName: i.timeZone, instrumentType: "EQUITY" },
    timestamp: [Date.parse("2026-10-14T12:00Z") / 1000, Date.parse("2026-10-15T12:00Z") / 1000, Date.parse("2026-10-16T12:00Z") / 1000],
    indicators: { quote: [{ open: [10, 11, 12], high: [12, 13, 14], low: [9, 10, 11], close: [11, 12, 13], volume: [100, 200, 300] }],
      adjclose: [{ adjclose: [10.5, 11.5, 12.5] }] },
    events: { dividends: { "a": { date: Date.parse("2026-10-15T12:00Z") / 1000, amount: 0.5 } },
      splits: { "b": { date: Date.parse("2026-10-14T12:00Z") / 1000, numerator: 10, denominator: 1 } } },
  }] } };
}

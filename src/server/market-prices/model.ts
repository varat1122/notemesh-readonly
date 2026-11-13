import { z } from "zod";
import { assetDefinition } from "./universe.ts";

export const marketSchema = z.enum(["US", "TH", "HK", "JP"]);
export type Market = z.infer<typeof marketSchema>;
// Capacity: 200 research listings plus up to four explicitly identified comparator ETFs.
export const MAX_PRICE_INSTRUMENTS = 204;
export const MARKETS = {
  US: { currency: "USD", timeZone: "America/New_York", suffix: "" },
  TH: { currency: "THB", timeZone: "Asia/Bangkok", suffix: ".BK" },
  HK: { currency: "HKD", timeZone: "Asia/Hong_Kong", suffix: ".HK" },
  JP: { currency: "JPY", timeZone: "Asia/Tokyo", suffix: ".T" },
} as const;

export const instrumentSchema = z.object({
  market: marketSchema,
  symbol: z.string().trim().toUpperCase().min(1).max(20),
}).strict().superRefine(({ market, symbol }, ctx) => {
  const patterns = {
    US: /^[A-Z][A-Z0-9-]{0,14}$/,
    TH: /^[A-Z0-9][A-Z0-9-]{0,19}$/,
    HK: /^\d{4,5}$/,
    JP: /^[0-9][A-Z0-9]{3}$/,
  };
  if (!patterns[market].test(symbol) && !(market === "US" && assetDefinition(`US:${symbol}`))) ctx.addIssue({ code: "custom", message: "Use a reviewed provider mapping or a local symbol without a Yahoo suffix (HK: 4–5 digits; JP: 4 characters)." });
});

export type InstrumentInput = z.infer<typeof instrumentSchema>;
export type Instrument = InstrumentInput & { id: string; yahooSymbol: string; currency: string; timeZone: string; assetClass: string; venue: string; identityStatus: string };
export function instrument(input: InstrumentInput): Instrument {
  const value = instrumentSchema.parse({ market: input.market, symbol: input.symbol });
  const market = MARKETS[value.market];
  const definition = assetDefinition(`${value.market}:${value.symbol}`);
  return { ...value, id: `${value.market}:${value.symbol}`, yahooSymbol: value.symbol + market.suffix,
    currency: market.currency, timeZone: market.timeZone, assetClass: definition?.assetClass ?? "equity_or_etf_unverified",
    venue: definition?.venue ?? `UNVERIFIED_${value.market}`, identityStatus: "configured_mapping_live_response_not_verified" };
}

// Examples for a connectivity pilot, not the user's holdings or an investment recommendation.
export const PILOT_INSTRUMENTS = [
  { market: "US", symbol: "NVDA" }, { market: "TH", symbol: "PTT" },
  { market: "HK", symbol: "9988" }, { market: "JP", symbol: "7203" },
] satisfies InstrumentInput[];

// Explicit ETF proxies; not official index levels and not interchangeable with the stock.
export const BENCHMARKS = {
  US: { market: "US", symbol: "SPY", label: "SPY ETF proxy" },
  TH: { market: "TH", symbol: "TDEX", label: "TDEX SET50 ETF proxy" },
  HK: { market: "HK", symbol: "2800", label: "Tracker Fund ETF proxy" },
  JP: { market: "JP", symbol: "1306", label: "TOPIX ETF proxy" },
} satisfies Record<Market, InstrumentInput & { label: string }>;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a real calendar date: YYYY-MM-DD");

export function localDate(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(timestamp));
}

export interface PriceBar {
  date: string;
  open: number | null; high: number | null; low: number | null; close: number; volume: number | null;
  adjustedClose: number | null;
}
export interface CorporateAction {
  key: string; date: string; kind: "dividend" | "split";
  value: number; denominator: number | null;
}
export interface PriceSnapshot {
  dataOrigin?: "synthetic_fixture";
  instrument: Instrument;
  fetchedAt: string;
  source: "yahoo-chart";
  bars: PriceBar[];
  actions: CorporateAction[];
  excludedCurrentSession: number;
  missingBars: number;
  quarantinedBars: { date: string; reason: string; values: Record<string, number | null> }[];
}
export const PRICE_POLICY = {
  seriesSchemaVersion: 2,
  interval: "1d",
  source: "yahoo-chart",
  priceBasis: "Provider quote OHLC (may already be split-adjusted); not dividend-adjusted. adjustedClose is a separate provider field. Not an as-traded archive or point-in-time backtest dataset.",
  completion: "Legacy mode excludes the current exchange date. reviewed-pilot-v1 uses normal venue close plus publication lag and a proposed 03:23 UTC run. Weekday-only session expectation is not an official holiday calendar. No live quotes or manufactured holiday bars.",
  adjustment: "Initial target is five years. Drive partitions use daily updates with a 30-calendar-day overlap before the last cached session, weekly full-history checks, and a full re-fetch on overlap or corporate-action changes. Disk mode still refreshes the full window. Never synthesize adjusted OHLC or volume from adjustedClose. Source corrections are recorded; omitted rows retain their older fetchedAt.",
  revisionNoise: "Store every returned value. Detailed correction receipts ignore adjustedClose-only relative changes <= 0.000001 (provider floating-point jitter); OHLC and volume changes are always recorded.",
  deviceSync: "Price database is server data outside the Obsidian vault; it is not replicated by Obsidian Sync.",
  quality: "Invalid OHLCV bars are quarantined, never repaired or forward-filled. Inspect quality issues and missing sessions before event/portfolio analysis.",
} as const;

export class PriceError extends Error {
  readonly code: string;
  readonly details?: Record<string, number>;
  constructor(code: string, details?: Record<string, number>) { super(code); this.code = code; this.details = details; this.name = "PriceError"; }
}

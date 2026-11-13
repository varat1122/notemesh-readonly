import { z } from "zod";
import crypto from "node:crypto";
import { priceRequestSignal } from "./request-budget.ts";
import { claimPriceRequest } from "./request-budget.ts";
import { assetDefinition, reviewedPriceProfile, listingLocalPriceProfile } from "./universe.ts";
import { completedPriceSessionPredicate } from "./sessions.ts";
import { assertPriceRights } from "./rights.ts";
import { instrument, localDate, isoDate, PriceError, type InstrumentInput, type PriceSnapshot } from "./model.ts";

const optionalNumber = z.number().finite().nullable();
const chartSchema = z.object({ chart: z.object({
  error: z.unknown().nullable(),
  result: z.array(z.object({
    meta: z.object({ symbol: z.string().max(128), currency: z.string().max(12), exchangeTimezoneName: z.string().max(100), instrumentType: z.string().max(32), exchangeName: z.string().max(64).optional() }),
    timestamp: z.array(z.number().int().nonnegative()).max(10000),
    indicators: z.object({
      quote: z.array(z.object({ open: z.array(optionalNumber), high: z.array(optionalNumber), low: z.array(optionalNumber),
        close: z.array(optionalNumber), volume: z.array(optionalNumber) })).length(1),
      adjclose: z.array(z.object({ adjclose: z.array(optionalNumber) })).length(1).optional(),
    }),
    events: z.object({
      dividends: z.record(z.string(), z.object({ date: z.number().int(), amount: z.number().finite().positive() })).optional(),
      splits: z.record(z.string(), z.object({ date: z.number().int(), numerator: z.number().finite().positive(), denominator: z.number().finite().positive() })).optional(),
    }).optional(),
  })).length(1).nullable(),
}) });

export function startOfWindow(now: Date): string {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  return start.toISOString().slice(0, 10);
}

export type RequestedPriceSnapshot = PriceSnapshot & { requestedRange?: { start: string; end: string };
  providerIdentity?: { sourceSymbol: string; exchange: string; currency: string; timeZone: string; instrumentType: string;
    observedAt: string; authority: "provider_response_claim_not_registry_verification"; responseSha256?: string; sourceUrl?: string } };
export function parseYahooChart(body: unknown, input: InstrumentInput, now = new Date(), windowStart?: string): RequestedPriceSnapshot {
  const target = instrument(input);
  const parsed = chartSchema.safeParse(body);
  if (!parsed.success || parsed.data.chart.error || !parsed.data.chart.result) throw new PriceError("invalid_provider_response");
  const result = parsed.data.chart.result[0];
  const definition = assetDefinition(target.id);
  if (result.meta.symbol.toUpperCase() !== target.yahooSymbol || result.meta.currency !== target.currency ||
    result.meta.exchangeTimezoneName !== target.timeZone || !["EQUITY", "ETF", "INDEX"].includes(result.meta.instrumentType) ||
    (reviewedPriceProfile() && (!definition?.supported || result.meta.instrumentType !== definition.providerType || result.meta.exchangeName !== definition.providerVenue))) {
    throw new PriceError("provider_instrument_mismatch");
  }
  if (listingLocalPriceProfile() && !result.meta.exchangeName?.trim()) throw new PriceError("provider_exchange_metadata_missing");
  const quote = result.indicators.quote[0];
  const adjusted = result.indicators.adjclose?.[0].adjclose;
  if ([...Object.values(quote), ...(adjusted ? [adjusted] : [])].some(a => a.length !== result.timestamp.length)) {
    throw new PriceError("provider_array_mismatch");
  }
  const today = localDate(now.getTime(), target.timeZone);
  // Reuse ICU formatters: constructing one per historical row causes large native-memory churn.
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: target.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const sessionDate = (seconds: number) => formatter.format(seconds * 1000);
  const isComplete = reviewedPriceProfile() || listingLocalPriceProfile() ? completedPriceSessionPredicate(target.market, target.timeZone, now) : (date: string) => date < today;
  const start = windowStart ? isoDate.parse(windowStart) : startOfWindow(now);
  const snapshot: RequestedPriceSnapshot = { instrument: target, fetchedAt: now.toISOString(), source: "yahoo-chart", bars: [], actions: [], excludedCurrentSession: 0, missingBars: 0, quarantinedBars: [],
    requestedRange: { start, end: today } };
  if (result.meta.exchangeName) snapshot.providerIdentity = { sourceSymbol: result.meta.symbol, exchange: result.meta.exchangeName,
    currency: result.meta.currency, timeZone: result.meta.exchangeTimezoneName, instrumentType: result.meta.instrumentType,
    observedAt: now.toISOString(), authority: "provider_response_claim_not_registry_verification" };
  const seen = new Set<string>();
  for (const [i, timestamp] of result.timestamp.entries()) {
    const date = sessionDate(timestamp);
    if (!isComplete(date)) { snapshot.excludedCurrentSession++; continue; }
    if (date < start) continue;
    if (seen.has(date)) throw new PriceError("duplicate_provider_date");
    seen.add(date);
    const open = quote.open[i], high = quote.high[i], low = quote.low[i], close = quote.close[i], volume = quote.volume[i];
    if (close === null || ([open, high, low].some(v => v === null) && ![open, high, low].every(v => v === null))) {
      snapshot.missingBars++;
      snapshot.quarantinedBars.push({ date, reason: "incomplete_provider_bar", values: { open, high, low, close, volume } });
      continue;
    }
    const fullOhlc = open !== null && high !== null && low !== null;
    if (close <= 0 || (fullOhlc && (Math.min(open, high, low) <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high))) ||
      (volume !== null && (!Number.isSafeInteger(volume) || volume < 0)) || (adjusted?.[i] != null && adjusted[i]! <= 0)) {
      snapshot.quarantinedBars.push({ date, reason: "invalid_provider_bar", values: { open, high, low, close, volume } });
      continue;
    }
    snapshot.bars.push({ date, open, high, low, close, volume, adjustedClose: adjusted?.[i] ?? null });
  }
  snapshot.bars.sort((a, b) => a.date.localeCompare(b.date));
  if (!snapshot.bars.length) throw new PriceError("no_completed_bars");
  if (snapshot.quarantinedBars.length > 10 || snapshot.quarantinedBars.length > snapshot.bars.length) throw new PriceError("too_many_invalid_provider_bars");
  for (const [key, action] of Object.entries(result.events?.dividends ?? {})) {
    const date = sessionDate(action.date);
    if (date >= start && isComplete(date)) snapshot.actions.push({ key: `dividend:${key}`, date, kind: "dividend", value: action.amount, denominator: null });
  }
  for (const [key, action] of Object.entries(result.events?.splits ?? {})) {
    const date = sessionDate(action.date);
    if (date >= start && isComplete(date)) snapshot.actions.push({ key: `split:${key}`, date, kind: "split", value: action.numerator, denominator: action.denominator });
  }
  return snapshot;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export async function fetchYahooDaily(input: InstrumentInput, options: { now?: Date; fetcher?: typeof fetch; start?: string } = {}): Promise<RequestedPriceSnapshot> {
  const target = instrument(input), now = options.now ?? new Date();
  // Explicit fetcher is an internal fixture seam, never an HTTP/MCP input.
  if (!options.fetcher) assertPriceRights(input, now);
  // Host and path are fixed; neither notes nor MCP callers can supply a URL.
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(target.yahooSymbol)}`);
  const start = options.start ? isoDate.parse(options.start) : startOfWindow(now);
  if (start >= localDate(now.getTime(), target.timeZone) || start < "1970-01-01") throw new PriceError("invalid_provider_window");
  url.search = new URLSearchParams({ period1: String(Date.parse(`${start}T00:00:00Z`) / 1000),
    period2: String(Math.floor(now.getTime() / 1000)), interval: "1d", events: "div,splits", includePrePost: "false" }).toString();
  try {
    claimPriceRequest();
    const response = await (options.fetcher ?? fetch)(url, { headers: { "User-Agent": "InvestmentOS-PersonalResearch/0.1", Accept: "application/json" },
      signal: priceRequestSignal(), redirect: "error" });
    if (response.status === 429) throw new PriceError("provider_rate_limited");
    if (!response.ok) throw new PriceError(`provider_http_${response.status}`);
    if (!response.body) throw new PriceError("empty_provider_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new PriceError("provider_response_too_large"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks), snapshot = parseYahooChart(JSON.parse(bytes.toString("utf8")), input, now, start);
    if (snapshot.providerIdentity) {
      snapshot.providerIdentity.responseSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      snapshot.providerIdentity.sourceUrl = url.toString();
    }
    return snapshot;
  } catch (error) {
    if (error instanceof PriceError) throw error;
    throw new PriceError("provider_unavailable");
  }
}

import crypto from "node:crypto";
import { z } from "zod";
import { instrumentSchema, isoDate, instrument, BENCHMARKS, PRICE_POLICY, PriceError, type InstrumentInput, type PriceBar } from "./model.ts";
import type { PriceStore } from "./store.ts";

export const eventAnalysisSchema = z.object({
  market: z.enum(["US", "TH", "HK", "JP"]),
  symbol: z.string().min(1).max(20),
  eventSessionDate: isoDate.describe("First affected exchange session, established from publication time/market calendar. After-close news uses the next session. Do not guess from ingestion date."),
  timing: z.enum(["before_open", "during_session", "after_prior_close", "unknown"]).describe("How publication aligns with the caller-specified first affected session. Unknown timing refuses calculation."),
  basis: z.enum(["close", "adjustedClose"]).default("close"),
  horizons: z.array(z.number().int().min(1).max(60)).min(1).max(10).default([1, 3, 5, 10, 20, 60]),
  benchmark: instrumentSchema.optional().describe("Optional explicit same-market benchmark. Default is an ETF proxy, not an official index."),
}).strict();
export type EventAnalysisInput = z.input<typeof eventAnalysisSchema>;
type CachedBar = PriceBar & { fetchedAt: string };

/** Deterministic, read-only computation shared by MCP and future web/mobile HTTP adapters. */
export function analyzePriceEvent(store: Pick<PriceStore, "read">, input: EventAnalysisInput) {
  const args = eventAnalysisSchema.parse(input);
  const target = instrument({ market: args.market, symbol: args.symbol });
  const benchmarkInput: InstrumentInput = args.benchmark ?? BENCHMARKS[args.market];
  if (benchmarkInput.market !== target.market) throw new PriceError("cross_market_benchmark_refused");
  const benchmark = instrument(benchmarkInput);
  if (benchmark.id === target.id) throw new PriceError("benchmark_must_differ_from_stock");
  const stockData = store.read(target, undefined, undefined, 1500);
  const benchmarkData = store.read(benchmark, undefined, undefined, 1500);
  const methodology = {
    version: "event-window-v1",
    alignment: "Caller supplies the first affected exchange session after checking source publication time. This tool does not infer it from note/import dates.",
    sessionCalendar: "Observed same-market benchmark dates; provisional, not an official exchange calendar. Unknown missing benchmark sessions cannot be detected without a licensed/verified calendar.",
    horizon: "N observed benchmark sessions including the first affected session. Baseline is the preceding benchmark session close.",
    returnBasis: args.basis,
    excessReturn: "Stock cumulative return minus benchmark cumulative return, in percentage points. Not a beta-adjusted abnormal return, CAR or causal estimate.",
    volume: "First affected session volume / mean volume of the preceding 20 benchmark sessions; no fill for missing stock dates.",
    caution: "Daily bars cannot isolate an intraday news response, after-hours moves or distinguish overlapping news. Current adjusted history is not point-in-time data. No trading recommendation or assumed execution price.",
  };
  const common = { instrument: target, benchmark, benchmarkLabel: args.benchmark ? "Caller-specified comparator" : BENCHMARKS[args.market].label,
    eventSessionDate: args.eventSessionDate, baselineDate: null, eventVolumeRatioVsPrior20: null, methodology, pricePolicy: PRICE_POLICY,
    dataRefresh: { stock: stockData.latestRefresh, benchmark: benchmarkData.latestRefresh },
    warnings: ["Changes after news are associations, not proof that this news caused the price change.",
      ...(args.timing === "during_session" ? ["Baseline close precedes the entire session; it includes pre-news trading."] : []),
      ...([stockData.latestRefresh, benchmarkData.latestRefresh].some(r => r?.success === 0) ? ["Latest refresh failed; results use older cached data."] : [])] };
  if (args.timing === "unknown") return { ...common, status: "needs_event_timing", windows: [] };
  if (stockData.qualityIssuesTruncated || benchmarkData.qualityIssuesTruncated) return { ...common, status: "quality_check_truncated", windows: [] };
  const stock = stockData.bars as CachedBar[], bench = benchmarkData.bars as CachedBar[];
  const index = bench.findIndex(b => b.date === args.eventSessionDate);
  if (index < 0) return { ...common, status: "event_session_not_cached", windows: [] };
  if (index === 0) return { ...common, status: "baseline_not_cached", windows: [] };
  const baseline = bench[index - 1];
  const stockByDate = new Map(stock.map(b => [b.date, b]));
  const baseStock = stockByDate.get(baseline.date);
  const value = (bar: CachedBar | undefined) => bar ? bar[args.basis] : null;
  const stockStart = value(baseStock), benchStart = value(baseline);
  if (stockStart == null || benchStart == null) return { ...common, status: "baseline_price_missing", windows: [] };
  const priorDates = bench.slice(Math.max(0, index - 20), index).map(b => b.date);
  const priorVolumes = priorDates.map(date => stockByDate.get(date)?.volume);
  const meanVolume = priorVolumes.length === 20 && priorVolumes.every(v => v != null) ?
    (priorVolumes as number[]).reduce((a, b) => a + b, 0) / 20 : null;
  const eventVolume = stockByDate.get(args.eventSessionDate)?.volume;
  const splitInVolumeWindow = (stockData.actions as { date: string; kind: string }[])
    .some(a => a.kind === "split" && a.date >= priorDates[0] && a.date <= args.eventSessionDate);
  const volumeRatio = !splitInVolumeWindow && meanVolume && eventVolume != null ? eventVolume / meanVolume : null;
  const windows = [...new Set(args.horizons)].sort((a, b) => a - b).map(horizon => {
    const sessions = bench.slice(index, index + horizon);
    if (sessions.length < horizon) return { horizon, status: "window_not_mature_or_missing_benchmark_data" };
    const end = sessions.at(-1)!;
    const issues = [...stockData.qualityIssues, ...benchmarkData.qualityIssues] as { date: string }[];
    if (issues.some(issue => issue.date >= baseline.date && issue.date <= end.date)) return { horizon, endDate: end.date, status: "quarantined_data_in_window" };
    if (sessions.some(s => !stockByDate.has(s.date))) return { horizon, endDate: end.date, status: "missing_stock_session" };
    const stockEnd = value(stockByDate.get(end.date)), benchEnd = value(end);
    if (stockEnd == null || benchEnd == null) return { horizon, endDate: end.date, status: "return_basis_missing" };
    const stockReturn = (stockEnd / stockStart - 1) * 100, benchmarkReturn = (benchEnd / benchStart - 1) * 100;
    const closes = sessions.map(s => stockByDate.get(s.date)!.close);
    return { horizon, status: "calculated", baselineDate: baseline.date, endDate: end.date,
      stockReturnPct: stockReturn, benchmarkReturnPct: benchmarkReturn, excessReturnPp: stockReturn - benchmarkReturn,
      closingPricePath: { maxVsBaselinePct: (Math.max(...closes) / baseStock!.close - 1) * 100,
        minVsBaselinePct: (Math.min(...closes) / baseStock!.close - 1) * 100 },
      sampleHash: crypto.createHash("sha256").update(JSON.stringify({ basis: args.basis, baseline: [baseStock, baseline],
        sample: sessions.map(b => [stockByDate.get(b.date), b]) })).digest("hex") };
  });
  return { ...common, status: windows.every(w => w.status === "calculated") ? "calculated" : "partial",
    baselineDate: baseline.date, eventVolumeRatioVsPrior20: volumeRatio, windows };
}

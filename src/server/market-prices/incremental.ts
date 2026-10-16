import { fetchYahooDaily } from "./yahoo.ts";
import { setTimeout as delay } from "node:timers/promises";
import { instrument, type InstrumentInput, type PriceBar } from "./model.ts";
import type { PriceStore } from "./store.ts";

/** Incremental Drive collection; full history is rechecked weekly or on an overlap/action change. */
export async function fetchIncremental(store: PriceStore, input: InstrumentInput, options: {
  now: Date; lastFullRefreshAt: string | null; fetcher?: typeof fetchYahooDaily; pause?: (ms: number) => Promise<unknown>;
}) {
  const coverage = store.instruments().find(value => (value as { id: string }).id === instrument(input).id) as
    { firstDate: string | null; lastDate: string | null } | undefined;
  const fullStart = coverage?.firstDate ?? undefined;
  const fetcher = options.fetcher ?? fetchYahooDaily;
  const fullDue = !coverage?.lastDate || !options.lastFullRefreshAt ||
    options.now.getTime() - Date.parse(options.lastFullRefreshAt) >= 7 * 24 * 60 * 60 * 1000;
  if (fullDue) return { snapshot: await fetcher(input, { now: options.now, start: fullStart }), full: true };
  const overlap = new Date(coverage.lastDate + "T00:00:00Z"); overlap.setUTCDate(overlap.getUTCDate() - 30);
  const start = overlap.toISOString().slice(0, 10);
  const snapshot = await fetcher(input, { now: options.now, start });
  const old = new Map((store.read(input, start, undefined, 1500).bars as PriceBar[]).map(bar => [bar.date, bar]));
  const differs = (a: PriceBar, b: PriceBar) => ["open", "high", "low", "close", "volume"].some(key => a[key as keyof PriceBar] !== b[key as keyof PriceBar]) ||
    (a.adjustedClose !== b.adjustedClose && (a.adjustedClose === null || b.adjustedClose === null ||
      Math.abs(a.adjustedClose - b.adjustedClose) > Math.max(a.adjustedClose, b.adjustedClose) * 0.000001));
  const known = store.db.prepare("SELECT event_key AS key,date,kind,value,denominator FROM actions WHERE instrument_id=?").all(instrument(input).id) as
    { key: string; date: string; kind: string; value: number; denominator: number | null }[];
  const actions = new Map(known.map(a => [a.key, a]));
  const needsRebase = snapshot.quarantinedBars.length > 0 || !snapshot.bars.some(bar => old.has(bar.date)) ||
    snapshot.bars.some(bar => old.has(bar.date) && differs(old.get(bar.date)!, bar)) ||
    snapshot.actions.some(action => !actions.has(action.key) || actions.get(action.key)!.date !== action.date || actions.get(action.key)!.kind !== action.kind ||
      actions.get(action.key)!.value !== action.value || actions.get(action.key)!.denominator !== action.denominator);
  if (!needsRebase) return { snapshot, full: false };
  // Do not store a changed adjustment basis together with old history. Respect source request spacing.
  await (options.pause ?? delay)(3000);
  return { snapshot: await fetcher(input, { now: options.now, start: fullStart }), full: true };
}

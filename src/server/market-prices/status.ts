import { readCachedPrices } from "./backend.ts";
import { priceWatchlist, priceScheduleMode, scheduledCutoff } from "./collector.ts";
import { instrument } from "./model.ts";

export function priceFreshness(rows: unknown, now = new Date()) {
  const records = Array.isArray(rows) ? rows as { id: string; lastDate: string | null; lastSuccessfulRefresh: string | null; lastError: string | null }[] : [];
  const cutoff = scheduledCutoff(now);
  return { checkedAt: now.toISOString(), refreshCutoff: new Date(cutoff).toISOString(),
    schedule: { mode: priceScheduleMode(), time: "13:00", timeZone: "Asia/Bangkok", inProcessRequiresAwakeServer: true },
    warning: "A successful refresh is not proof of the latest exchange session. Inspect lastPriceDate; no official holiday calendar is assumed.",
    listings: priceWatchlist().map(input => {
      const id = instrument(input).id, row = records.find(r => r.id === id);
      const refreshed = row?.lastSuccessfulRefresh ? Date.parse(row.lastSuccessfulRefresh) : NaN;
      return { instrumentId: id, lastPriceDate: row?.lastDate ?? null, lastSuccessfulRefresh: row?.lastSuccessfulRefresh ?? null,
        refreshState: !row ? "not_cached" : row.lastError ? "failed" : !row.lastDate ? "no_usable_bars" : refreshed >= cutoff && refreshed <= now.getTime() ? "updated_this_cycle" : "due",
        lastError: row?.lastError ?? null };
    }) };
}
export async function priceDataStatus() {
  const status = await readCachedPrices(store => store.status()) as Record<string, unknown>;
  return { ...status, freshness: priceFreshness(status.instruments) };
}

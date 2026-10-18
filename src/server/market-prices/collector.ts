import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { instrumentSchema, instrument, PILOT_INSTRUMENTS, BENCHMARKS, MAX_PRICE_INSTRUMENTS, PriceError, type InstrumentInput } from "./model.ts";
import { PriceStore, priceDbPath } from "./store.ts";
import { fetchYahooDaily } from "./yahoo.ts";
import { inProcessDrWriterFence } from "../backup/writer-fence";

export function priceWatchlist(): InstrumentInput[] {
  try {
    const value = process.env.MARKET_PRICES_WATCHLIST ? JSON.parse(process.env.MARKET_PRICES_WATCHLIST) :
      [...PILOT_INSTRUMENTS, ...Object.values(BENCHMARKS).map(({ market, symbol }) => ({ market, symbol }))];
    const list = z.array(instrumentSchema).min(1).max(MAX_PRICE_INSTRUMENTS).parse(value);
    if (new Set(list.map(i => instrument(i).id)).size !== list.length) throw new Error("duplicate");
    return list;
  } catch { throw new PriceError("invalid_price_watchlist"); }
}

// Run after 06:00 UTC (13:00 Bangkok): the previous session date has ended in all four markets.
// A boot-time preview before that time does not consume the next scheduled refresh.
export function scheduledCutoff(now: Date): number {
  const scheduled = new Date(now);
  scheduled.setUTCHours(6, 0, 0, 0);
  if (scheduled.getTime() > now.getTime()) scheduled.setUTCDate(scheduled.getUTCDate() - 1);
  return scheduled.getTime();
}

export interface RefreshOptions {
  filename?: string; watchlist?: InstrumentInput[]; now?: Date; force?: boolean;
  fetcher?: typeof fetchYahooDaily; pause?: (ms: number) => Promise<unknown>;
}
export async function refreshPrices(options: RefreshOptions = {}) {
  // Keep one writer ticket throughout provider I/O, price-store mutation and
  // cleanup, so a coordinated freeze cannot enter mid-refresh.
  return inProcessDrWriterFence.withWrite(async () => {
  priceWatchlistFrom(options);
  const backend = process.env.MARKET_PRICES_STORAGE ?? "disk";
  if (!["disk", "google-drive"].includes(backend)) throw new PriceError("invalid_price_storage_backend");
  // Explicit filenames are a local CLI/test path; the production Drive collector never creates one.
  if (backend === "google-drive" && !options.filename) {
    const { drivePriceCache } = await import("./drive-backend.ts");
    return drivePriceCache().refresh(options);
  }
  // Validate before creating a local file.
  priceWatchlistFrom(options);
  const store = new PriceStore(options.filename ?? priceDbPath(), true);
  try { return await collectIntoPriceStore(store, options); } finally { store.close(); }
  });
}
export function priceWatchlistFrom(options: RefreshOptions) {
  const list = z.array(instrumentSchema).min(1).max(MAX_PRICE_INSTRUMENTS).parse(options.watchlist ?? priceWatchlist());
  if (new Set(list.map(i => instrument(i).id)).size !== list.length) throw new PriceError("duplicate_price_instrument");
  return list;
}
export async function collectIntoPriceStore(store: PriceStore, options: RefreshOptions) {
  const now = options.now ?? new Date();
  const list = priceWatchlistFrom(options);
  let lease: string | null = null;
  const results: { instrumentId: string; status: string; inserted?: number; revised?: number; unchanged?: number; rowCount?: number; errorCode?: string }[] = [];
  try {
    lease = store.acquireLease(now);
    if (!lease) return { status: "collector_busy", results };
    if (store.providerCoolingDown(now)) return { status: "provider_cooldown", results };
    for (const [index, input] of list.entries()) {
      const last = store.lastAttempt(input);
      const lastAt = last ? Date.parse(last.attempted_at) : 0;
      const due = !last || (last.success ? lastAt < scheduledCutoff(now) : now.getTime() - lastAt >= 60 * 60 * 1000);
      if (!options.force && !due) { results.push({ instrumentId: instrument(input).id, status: "not_due" }); continue; }
      if (index > 0) await (options.pause ?? delay)(3000);
      try {
        const snapshot = await (options.fetcher ?? fetchYahooDaily)(input, { now });
        const counts = store.save(snapshot);
        results.push({ instrumentId: instrument(input).id, status: "updated", ...counts });
      } catch (error) {
        const code = error instanceof PriceError ? error.code : "price_refresh_failed";
        // Error text from providers/native filesystems is never copied to tools or receipts.
        store.failure(input, code, now);
        results.push({ instrumentId: instrument(input).id, status: "failed", errorCode: code });
        // Respect throttling; no alternate IP, endpoint or aggressive retries.
        if (["provider_rate_limited", "provider_http_401", "provider_http_403", "insufficient_price_disk_reserve"].includes(code)) break;
      }
    }
    return { status: results.some(r => r.status === "failed") ? "partial_failure" : "complete", results };
  } finally {
    if (lease) store.releaseLease(lease);
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
export function ensurePriceCollectorStarted(): void {
  if (process.env.MARKET_PRICES_ENABLED !== "1" || timer) return;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await refreshPrices();
      if (result.results.some(r => ["updated", "failed"].includes(r.status))) console.log("[market-prices]", JSON.stringify(result));
    } catch (error) {
      console.error("[market-prices]", error instanceof PriceError ? error.code : "collector_failed",
        error instanceof PriceError && error.details ? JSON.stringify(error.details) : "");
    } finally { busy = false; }
  };
  // A single server replica, with a durable cross-process lease for CLI/restarts.
  timer = setInterval(() => { void tick(); }, 60 * 1000);
  timer.unref();
  void tick();
}

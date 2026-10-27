import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { instrumentSchema, instrument, PILOT_INSTRUMENTS, BENCHMARKS, MAX_PRICE_INSTRUMENTS, PriceError, type InstrumentInput } from "./model.ts";
import { PriceStore, priceDbPath } from "./store.ts";
import { fetchYahooDaily } from "./yahoo.ts";
import { assertPriceTime, priceDeadline } from "./request-budget.ts";

export function priceScheduleMode() {
  const mode = process.env.MARKET_PRICES_SCHEDULE ?? "in-process";
  if (!["in-process", "manual", "external"].includes(mode)) throw new PriceError("invalid_price_schedule_mode");
  return mode;
}

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

export function pendingPriceListings(rows: { id: string; barCount: number; lastSuccessfulRefresh: string | null; lastError: string | null }[], watchlist: InstrumentInput[], now: Date) {
  return watchlist.filter(i => {
    const row = rows.find(r => r.id === instrument(i).id);
    const refreshed = row?.lastSuccessfulRefresh ? Date.parse(row.lastSuccessfulRefresh) : NaN;
    return !row || row.barCount < 1 || !!row.lastError || !Number.isFinite(refreshed) || refreshed < scheduledCutoff(now) || refreshed > now.getTime();
  }).length;
}

export interface RefreshOptions {
  filename?: string; watchlist?: InstrumentInput[]; now?: Date; force?: boolean;
  fetcher?: typeof fetchYahooDaily; pause?: (ms: number) => Promise<unknown>;
}
export async function refreshPrices(options: RefreshOptions = {}) {
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
      assertPriceTime();
      const last = store.lastAttempt(input);
      const lastAt = last ? Date.parse(last.attempted_at) : 0;
      const due = !last || (last.success ? lastAt < scheduledCutoff(now) : now.getTime() - lastAt >= 60 * 60 * 1000);
      if (!options.force && !due) { results.push({ instrumentId: instrument(input).id, status: "not_due" }); continue; }
      if (index > 0) await (options.pause ?? delay)(3000);
      assertPriceTime();
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
    const remainingDue = pendingPriceListings(store.instruments() as Parameters<typeof pendingPriceListings>[0], list, now);
    return { status: results.some(r => r.status === "failed") ? "partial_failure" : remainingDue ? "pending_retry_or_coverage" : "complete", remainingDue, results };
  } finally {
    if (lease) store.releaseLease(lease);
  }
}

export interface PriceRunOptions extends RefreshOptions {
  trigger: "admin" | "job" | "background";
  maxBatches?: number;
  maxDurationMs?: number;
  // Internal fixture seam; no URL, path or fetch function accepted by HTTP.
  batch?: typeof refreshPrices;
}
export async function runPriceRefresh(options: PriceRunOptions) {
  if (process.env.MARKET_PRICES_ENABLED !== "1" ||
    (options.trigger !== "background" && process.env.MARKET_PRICES_REFRESH_ENABLED !== "1")) throw new PriceError("price_refresh_disabled");
  const mode = priceScheduleMode();
  if (options.trigger === "job" && mode !== "external") throw new PriceError("price_job_requires_external_schedule");
  if (options.trigger === "background" && mode !== "in-process") throw new PriceError("price_background_schedule_disabled");
  if (options.force) throw new PriceError("bounded_refresh_does_not_force");
  const maxBatches = options.maxBatches ?? MAX_PRICE_INSTRUMENTS;
  const maxDurationMs = options.maxDurationMs ?? (options.trigger === "admin" ? 300000 : 600000);
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > MAX_PRICE_INSTRUMENTS ||
    !Number.isInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 900000) throw new PriceError("invalid_price_run_budget");
  const watchlist = priceWatchlistFrom(options), started = Date.now();
  // All supported entrypoints share this lock. Drive additionally requires a
  // genuinely single writer with this same persistent root; separate volumes
  // are NOT coordinated by this lock or by an environment assertion.
  const folder = path.dirname(priceDbPath()), lock = path.join(folder, "refresh-run.lock");
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(folder).isSymbolicLink()) throw new PriceError("linked_price_directory_refused");
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return { status: "collector_busy", batches: 0, results: [], remainingDue: null }; throw e; }
  const parent = fs.openSync(folder, "r"); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  const results: Awaited<ReturnType<typeof collectIntoPriceStore>>["results"] = [];
  let batches = 0, remainingDue: number | null = null;
  const summary = (status: string, errorCode?: string) => ({ status, trigger: options.trigger, startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(), universeSize: watchlist.length, batches, remainingDue, results, ...(errorCode ? { errorCode } : {}) });
  try {
    return await priceDeadline.run(started + maxDurationMs, async () => {
      while (batches < maxBatches) {
        assertPriceTime();
        const result = await (options.batch ?? refreshPrices)({ ...options, watchlist, now: options.now ?? new Date() });
        batches++; results.push(...result.results);
        remainingDue = "remainingDue" in result && typeof result.remainingDue === "number" ? result.remainingDue : result.status === "complete" ? 0 : null;
        assertPriceTime();
        if (result.status === "complete") return summary("complete");
        if (result.status !== "batch_complete") return summary(result.status);
        if (!result.results.some(r => r.status === "updated")) return summary("pending_no_progress");
      }
      return summary("pending_batch_limit");
    });
  } catch (e) {
    const code = e instanceof PriceError ? e.code : "price_run_failed";
    return summary(code === "price_refresh_deadline_exceeded" ? "pending_time_limit" : "failed", code);
  } finally { fs.rmdirSync(lock); }
}

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
export function ensurePriceCollectorStarted(): void {
  if (process.env.MARKET_PRICES_ENABLED !== "1" || timer) return;
  try { if (priceScheduleMode() !== "in-process") return; }
  catch { console.error("[market-prices] invalid_price_schedule_mode"); return; }
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await runPriceRefresh({ trigger: "background", maxBatches: 1 });
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

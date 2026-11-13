import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { inProcessDrWriterFence } from "../backup/writer-fence.ts";
import { priceWatchlist, runPriceRefresh, type PriceRunOptions } from "./collector.ts";
import { priceDbPath } from "./store.ts";
import { allRightsHeld, priceRunReceipts } from "./receipts.ts";
import { PriceError } from "./model.ts";
import { reviewedPriceProfile } from "./universe.ts";

type RunResult = { status: string; listingReceipts?: unknown[]; providerRequests?: number; remainingDue?: number | null };
interface DailyReceipt { version: 1; jobId: string; day: string; startedAt: string; finishedAt: string; status: string; result: RunResult; }
const jobRoot = () => path.join(path.dirname(priceDbPath()), "daily-jobs");
function readReceipt(file: string): DailyReceipt | null {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024) throw new PriceError("unsafe_daily_receipt");
  let r: DailyReceipt;
  try { r = JSON.parse(fs.readFileSync(file, "utf8")) as DailyReceipt; }
  catch { throw new PriceError("invalid_daily_receipt"); }
  if (!r || r.version !== 1 || r.day + ".json" !== path.basename(file) ||
    typeof r.jobId !== "string" || !Number.isFinite(Date.parse(r.startedAt)) || !Number.isFinite(Date.parse(r.finishedAt)) ||
    !r.result || !["COMPLETE", "PARTIAL", "FAILED"].includes(r.status)) throw new PriceError("invalid_daily_receipt");
  return r;
}
function writeReceipt(file: string, value: DailyReceipt) {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > 256 * 1024) throw new PriceError("daily_receipt_too_large");
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
/** One bounded attempt/day, same persistent root ONLY; not a scheduler or distributed lock. */
export async function runDailyPriceJob(options: { now?: Date; run?: (o: PriceRunOptions) => Promise<RunResult> } = {}) {
  if (process.env.MARKET_PRICES_ENABLED !== "1" || process.env.MARKET_PRICES_REFRESH_ENABLED !== "1") throw new PriceError("price_refresh_disabled");
  if (!reviewedPriceProfile() || process.env.MARKET_PRICES_SCHEDULE !== "external") throw new PriceError("daily_requires_reviewed_external_profile");
  if (process.env.MARKET_PRICES_STORAGE !== "google-drive" || process.env.MARKET_PRICES_DRIVE_SINGLE_WRITER !== "1") throw new PriceError("daily_requires_exclusive_drive_writer");
  const now = options.now ?? new Date(), day = now.toISOString().slice(0, 10);
  if (now.getTime() < Date.parse(day + "T03:23:00Z")) return { status: "NOT_DUE", writesPerformed: false };
  const watchlist = priceWatchlist(), hold = allRightsHeld(watchlist, now);
  if (hold) return { ...hold, status: "RIGHTS_HOLD" };
  return inProcessDrWriterFence.withWrite(async () => {
    const folder = jobRoot();
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(folder).isSymbolicLink() || fs.realpathSync(folder) !== folder) throw new PriceError("unsafe_daily_job_directory");
    const lock = path.join(folder, "daily.lock");
    const jobId = crypto.randomUUID(), startedAt = now.toISOString();
    try {
      const fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ jobId, day, startedAt, state: "attempt_started_outcome_unknown" })); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      const parent = fs.openSync(folder, "r"); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return { status: "BUSY_OR_CRASH_HOLD", writesPerformed: false }; throw error; }
    let releaseLock = false;
    try {
      const file = path.join(folder, day + ".json"), prior = readReceipt(file);
      if (prior) { releaseLock = true; return { status: "REPLAY_NO_NEW_ATTEMPT", receipt: prior, writesPerformed: false }; }
      let result: RunResult;
      try { result = await (options.run ?? runPriceRefresh)({ trigger: "job", now, watchlist }); }
      catch (error) { result = { status: error instanceof PriceError ? error.code : "daily_job_failed",
        listingReceipts: priceRunReceipts(watchlist, []) }; }
      const receipt: DailyReceipt = { version: 1, jobId, day, startedAt, finishedAt: new Date().toISOString(),
        status: result.status === "complete" ? "COMPLETE" : result.status === "partial_failure" ? "PARTIAL" : "FAILED", result };
      // If this fails after collection, retain the lock: an uncertain attempt must not replay.
      try { writeReceipt(file, receipt); } catch (error) { throw new PriceError(error instanceof PriceError ? error.code : "daily_receipt_persistence_unknown"); }
      releaseLock = true;
      return { status: receipt.status, receipt, writesPerformed: true };
    } finally {
      // Successful replay can release this invocation's lock; failed attempts keep it.
      if (releaseLock) fs.unlinkSync(lock);
    }
  }, "background_price_collector");
}
export function dailyPriceJobStatus(now = new Date()) {
  const day = now.toISOString().slice(0, 10), folder = jobRoot();
  const receipt = readReceipt(path.join(folder, day + ".json"));
  return { scheduleProposed: "23 3 * * *", timeZone: "UTC", activatedByThisCode: false,
    status: fs.existsSync(path.join(folder, "daily.lock")) ? "BUSY_OR_CRASH_HOLD" : receipt?.status ??
      (now.getTime() > Date.parse(day + "T04:53:00Z") ? "MISSING_OR_NOT_ACTIVATED" : "AWAITING_RUN"),
    receipt, distributedWriterExclusionVerified: false };
}

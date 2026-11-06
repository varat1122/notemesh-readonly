import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { db } from "./db";
import { gitBackend } from "./sync/git";
import { supervisor } from "./ob/supervisor";
import { indexer } from "./vault/indexer";
import { cloudIntakeBusy, stopCloudIntake } from "./cloud-intake";
import { priceCollectorBusy, stopPriceCollector } from "./market-prices/collector";
import {
  beginMaintenance,
  inflightRequests,
  isMaintenanceLatched,
  maintenanceResponse,
  maintenanceStatus,
  settleMaintenance,
  trackRequest,
  type DrainReport,
  type MaintenanceRecord,
} from "./maintenance";

// Whether this process has admitted any request, i.e. may have started
// workers through the first-request hooks in the middleware.
let admitted = false;
let draining: Promise<MaintenanceRecord> | null = null;

/**
 * The first thing every request meets. Outside maintenance it counts the
 * request (for drain) and lets it through. In maintenance it answers without
 * touching the DB, and — if maintenance appeared under a process that had
 * already started workers (file written from outside, no in-process entry) —
 * adopts it and drains those workers too.
 */
export function maintenanceGate(event: { request: Request }): Response | null {
  const status = maintenanceStatus();
  if (!status.active) {
    admitted = true;
    trackRequest(event);
    return null;
  }
  if (admitted && !isMaintenanceLatched()) void enterMaintenanceAndDrain({ ownRequests: 0 }).catch(() => {});
  return maintenanceResponse(event.request, status);
}

function writingRows(): number {
  try {
    const d = db();
    if (!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get()) return 0;
    return (d.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE status='writing'").get() as { n: number }).n;
  } catch {
    // Unknown is not zero.
    return -1;
  }
}

/**
 * Every condition must be observed, not assumed. Timers being cleared is not
 * quiescence: an admitted request, a Git cycle, a Safe Edit write or an index
 * rebuild can still be running, and each is waited for here.
 */
export function drainReport(ownRequests: number): { quiescent: boolean; report: DrainReport } {
  const http = inflightRequests();
  const rows = writingRows();
  const report: DrainReport = {
    httpInflight: Math.max(0, http.inflight - ownRequests),
    httpUntracked: http.untracked,
    gitQuiescent: gitBackend().isQuiescent(),
    obsidianQuiescent: supervisor().isQuiescent(),
    indexerQuiescent: indexer().isQuiescent(),
    cloudIntakeIdle: !cloudIntakeBusy(),
    priceCollectorIdle: !priceCollectorBusy(),
    safeEditLockAbsent: !fs.existsSync(path.join(env.dataDir, "safe-edit.lock")),
    gitMutationLockAbsent: !fs.existsSync(path.join(env.dataDir, "git-mutation.lock")),
    safeEditWritingRows: rows,
  };
  const quiescent = report.httpInflight === 0 && report.httpUntracked === 0 && rows === 0 &&
    Object.values(report).every((v) => v !== false);
  return { quiescent, report };
}

/**
 * Enter maintenance from a running process: record it durably first, stop
 * every worker, then wait — bounded — until nothing admitted earlier is still
 * running. The outcome is "active" only on observed quiescence; a timeout is
 * "drain_failed", which still refuses every request and survives restart.
 * Idempotent: a second call joins the drain already in progress.
 */
export function enterMaintenanceAndDrain(opts: { timeoutMs?: number; ownRequests?: number } = {}): Promise<MaintenanceRecord> {
  if (draining) return draining;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const ownRequests = opts.ownRequests ?? 0;
  draining = (async () => {
    beginMaintenance();
    gitBackend().stop();
    supervisor().stop();
    stopCloudIntake();
    stopPriceCollector();
    await indexer().stopForMaintenance();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { quiescent, report } = drainReport(ownRequests);
      if (quiescent) return settleMaintenance("active", report);
      if (Date.now() >= deadline) {
        console.error("[maintenance] drain timed out; maintenance stays active:", JSON.stringify(report));
        return settleMaintenance("drain_failed", report);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  return draining;
}

/** Test seam only. */
export function resetMaintenanceDrainForTests() {
  admitted = false;
  draining = null;
}

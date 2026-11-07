import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { gitBackend } from "./sync/git";
import { supervisor } from "./ob/supervisor";
import { indexer } from "./vault/indexer";
import { cloudIntakeBusy, stopCloudIntake } from "./cloud-intake";
import { priceCollectorBusy, stopPriceCollector } from "./market-prices/collector";
import {
  admitRequest,
  beginMaintenance,
  bundleCount,
  excludeOwnRequest,
  isMaintenanceLatched,
  maintenanceResponse,
  maintenanceStatus,
  pendingWork,
  registry,
  settleMaintenance,
  writerLocks,
  type DrainReport,
  type MaintenanceRecord,
} from "./maintenance";

/**
 * The first thing every request meets, in every router bundle. Outside
 * maintenance it admits the request as pending work and lets it through. In
 * maintenance it answers without touching the DB, and — if maintenance
 * appeared under a process that had already admitted requests (record written
 * from outside) — adopts it and drains this process's workers too.
 */
export function maintenanceGate(event: { request: Request }): Response | null {
  const status = maintenanceStatus();
  if (!status.active) {
    admitRequest(event);
    return null;
  }
  if (registry().admitted && !isMaintenanceLatched()) {
    // Adopt BEFORE answering: the record is rewritten "draining" (or latched as
    // persistUncertain), so no answer advertises an earlier process's
    // quiescence while this process still has work in flight.
    try {
      beginMaintenance();
    } catch {
      // Not entered: the record vanished; the next request re-evaluates.
    }
    void enterMaintenanceAndDrain().catch(() => {});
    return maintenanceResponse(event.request, maintenanceStatus());
  }
  return maintenanceResponse(event.request, status);
}

/** Read through a connection this process already holds; never opens one. */
function writingRows(): number {
  let rows = 0;
  for (const c of registry().connections as Set<unknown>) {
    try {
      const d = c as { open?: boolean; prepare(sql: string): { get(): unknown } };
      if (d.open === false) continue;
      if (!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get()) return 0;
      rows = (d.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE status='writing'").get() as { n: number }).n;
      return rows;
    } catch {
      return -1;
    }
  }
  return rows;
}

/**
 * Every condition is observed, not assumed. Cleared timers are not
 * quiescence: an admitted request (until its handler settles), an MCP tool
 * call, a Git cycle, the Obsidian daemon or a detached helper, an index
 * rebuild or link pass, an intake or price tick, a Safe Edit write — each is
 * waited for. The admin entry requests are excluded by identity only.
 */
export function drainReport(): { quiescent: boolean; report: DrainReport } {
  const work = pendingWork();
  const rows = writingRows();
  const writers = writerLocks();
  const report: DrainReport = {
    pendingWork: work.count,
    pendingHttp: work.kinds.filter((k) => k === "http").length,
    pendingTools: work.kinds.filter((k) => k.startsWith("mcp")).length,
    untrackedRequests: work.untracked,
    bundles: bundleCount(),
    gitQuiescent: gitBackend().isQuiescent(),
    obsidianQuiescent: supervisor().isQuiescent(),
    indexerQuiescent: indexer().isQuiescent(),
    cloudIntakeIdle: !cloudIntakeBusy(),
    priceCollectorIdle: !priceCollectorBusy(),
    safeEditLockAbsent: !fs.existsSync(path.join(env.dataDir, "safe-edit.lock")),
    gitMutationLockAbsent: !fs.existsSync(path.join(env.dataDir, "git-mutation.lock")),
    safeEditWritingRows: rows,
    // Writers in any process (the price CLI included) announce a lock before
    // checking maintenance; a drain waits for every one, stale ones included.
    crossProcessWriters: writers.count,
    staleWriterLocks: writers.stale,
  };
  const quiescent = work.count === 0 && work.untracked === 0 && rows === 0 && writers.count === 0 &&
    Object.values(report).every((v) => v !== false);
  return { quiescent, report };
}

class DrainDeadline extends Error {}
function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DrainDeadline()), Math.max(0, deadline - Date.now()));
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Enter maintenance from a running process: record it durably first, then stop
 * every worker and wait until nothing admitted earlier is still running. The
 * deadline starts before the first stop; a stop that throws or hangs, an
 * unexpected error or an unverifiable record all end in "drain_failed". Only
 * observed quiescence with a verified record is "active". Either way the
 * mutation fence goes up. A second call joins the same drain; its own entry
 * request is excluded by identity.
 */
export function enterMaintenanceAndDrain(opts: { timeoutMs?: number; event?: unknown } = {}): Promise<MaintenanceRecord> {
  const r = registry();
  if (opts.event) excludeOwnRequest(opts.event);
  if (r.draining) return r.draining;
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  try {
    beginMaintenance();
  } catch (e) {
    // Nothing was stopped and nothing is latched: no maintenance was entered.
    return Promise.reject(e);
  }
  r.draining = (async () => {
    const failures: DrainReport = {};
    const stop = async (name: string, run: () => unknown) => {
      try {
        await beforeDeadline(Promise.resolve().then(run), deadline);
      } catch (e) {
        failures[e instanceof DrainDeadline ? `${name}StopTimedOut` : `${name}StopFailed`] = true;
      }
    };
    try {
      await stop("git", () => gitBackend().stop());
      await stop("obsidian", () => supervisor().stop());
      await stop("cloudIntake", () => stopCloudIntake());
      await stop("priceCollector", () => stopPriceCollector());
      await stop("indexer", () => indexer().stopForMaintenance());
      for (;;) {
        const { quiescent, report } = drainReport();
        const failed = Object.keys(failures).length > 0;
        if (quiescent && !failed) return settleMaintenance("active", report);
        if (failed || Date.now() >= deadline) {
          console.error("[maintenance] drain did not reach quiescence; maintenance stays active:", JSON.stringify({ ...report, ...failures }));
          return settleMaintenance("drain_failed", { ...report, ...failures });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } catch (e) {
      console.error("[maintenance] drain error; maintenance stays active:", e instanceof Error ? e.message : e);
      return settleMaintenance("drain_failed", { ...failures, drainError: true });
    }
  })();
  return r.draining;
}

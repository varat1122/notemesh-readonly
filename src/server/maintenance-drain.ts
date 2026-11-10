import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "./env";
import { c1Pilot } from "./c1-pilot";
import { priceDbPath } from "./market-prices/store";
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
  inventoryState,
  isMaintenanceLatched,
  maintenanceResponse,
  maintenanceStatus,
  pendingWork,
  registerServer,
  registry,
  resolveServerBoot,
  settleMaintenance,
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
  // The server's own boot step (resume, durable-openness check) runs here and
  // only here — never as a side effect in another process.
  resolveServerBoot();
  let status = maintenanceStatus();
  // Pilot identity must be valid before registering a serving process or
  // admitting any startup hooks. Active maintenance remains DB-free.
  if (!status.active) c1Pilot();
  // Admission needs a registered presence; failing that, the server holds closed.
  if (!status.active && registerServer()) {
    admitRequest(event);
    return null;
  }
  status = maintenanceStatus();
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
export function drainReport(): { quiescent: boolean; report: DrainReport; inventoryUncertain: string | null } {
  const work = pendingWork();
  const rows = writingRows();
  const writers = inventoryState();
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
    pendingRemote: work.kinds.filter((k) => k === "remote").length,
    // Writers in any process (the price CLI included) announce a lock before
    // checking maintenance; a drain waits for every one, stale ones included.
    // An uncertain inventory is never read as zero.
    crossProcessWriters: writers.writers,
    staleWriterLocks: writers.stale,
    otherLiveServers: writers.otherServers,
    writerInventoryIntact: writers.uncertain === null,
  };
  const quiescent = work.count === 0 && work.untracked === 0 && rows === 0 && writers.writers === 0 &&
    writers.otherServers === 0 && writers.uncertain === null && Object.values(report).every((v) => v !== false);
  return { quiescent, report, inventoryUncertain: writers.uncertain };
}

/**
 * Take and release the write lock of every SQLite file a writer outside this
 * process's request tracking may write (price stores in any process, operator
 * scripts). Those writers re-check maintenance INSIDE their write
 * transaction, and this runs after maintenance is recorded: a transaction
 * either committed before the barrier or sees maintenance and writes nothing.
 * Synchronous with short lock waits, immediately followed by settle; a busy
 * lock is retried by the drain loop until its deadline. A non-empty rollback
 * journal (a writer mid-transaction, or a crashed one) is never touched.
 */
function sqliteBarrier(): DrainReport {
  const out: DrainReport = { appDbBarrier: false, priceDbBarrier: false };
  const take = (db: { exec(sql: string): unknown }) => {
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
  };
  if (!fs.existsSync(env.dbPath)) out.appDbBarrier = true;
  else {
    // The server's own connection where it has one (a fresh one could checkpoint the WAL on close).
    const own = [...registry().connections].find((c) => c.open !== false) as unknown as
      { exec(sql: string): unknown; pragma(sql: string, o?: { simple?: boolean }): unknown; inTransaction?: boolean } | undefined;
    if (own && !own.inTransaction) {
      const wait = own.pragma("busy_timeout", { simple: true });
      try {
        own.pragma("busy_timeout = 100");
        take(own);
        out.appDbBarrier = true;
      } catch {
        out.appDbBarrier = false;
      } finally {
        own.pragma(`busy_timeout = ${Number(wait) || 5000}`);
      }
    } else if (!own) out.appDbBarrier = barrierOn(env.dbPath, take);
  }
  let file: string | null = null;
  try {
    file = priceDbPath();
  } catch {
    file = null;
  }
  if (file && !fs.existsSync(file)) out.priceDbBarrier = true;
  else if (file) {
    let journal = 0;
    try {
      journal = fs.statSync(file + "-journal").size;
    } catch {
      journal = 0;
    }
    out.priceDbBarrier = journal === 0 && barrierOn(file, take);
  }
  return out;
}

function barrierOn(file: string, take: (db: Database.Database) => void): boolean {
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { fileMustExist: true, timeout: 100 });
    take(db);
    return true;
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // The barrier outcome is already decided.
    }
  }
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
      let barrier: DrainReport = {};
      for (;;) {
        const { quiescent, report, inventoryUncertain } = drainReport();
        // A lost or replaced writer inventory does not heal by waiting.
        if (inventoryUncertain) failures[`inventory_${inventoryUncertain}`] = true;
        const failed = Object.keys(failures).length > 0;
        if (quiescent && !failed) {
          barrier = sqliteBarrier();
          if (Object.values(barrier).every((v) => v === true)) return settleMaintenance("active", { ...report, ...barrier });
        }
        if (failed || Date.now() >= deadline) {
          console.error("[maintenance] drain did not reach quiescence; maintenance stays active:", JSON.stringify({ ...report, ...barrier, ...failures }));
          return settleMaintenance("drain_failed", { ...report, ...barrier, ...failures });
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

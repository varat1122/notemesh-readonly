import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// Explicit extension: the price CLI imports this module under plain Node.
import { env } from "./env.ts";

/**
 * Restart-persistent maintenance barrier.
 *
 * Strict contract: while maintenance is active this process admits no request
 * and starts no worker that could touch the database, the Vault, Git/Obsidian
 * sync, the index, intake or prices. The only answer served is a DB-free
 * liveness/status reply from /api/health. This module therefore imports
 * nothing but env and the filesystem: deciding "are we in maintenance?" must
 * never open the DB (opening it runs migrations).
 *
 * State lives in DATA_DIR/maintenance.json — on the volume, outside the Vault
 * and outside the DB — so it survives restarts and redeploys. A present but
 * unreadable, oversized, symlinked or malformed file is maintenance (fail
 * closed). NOTEMESH_MAINTENANCE=1 forces maintenance from boot without a file.
 *
 * Resume is never an HTTP action (authenticating would write sessions and run
 * auth migrations). The owner sets NOTEMESH_MAINTENANCE_RESUME to the exact
 * maintenance id and restarts; it is consumed once, at the first request of a
 * process that has not entered maintenance itself, and the record is archived
 * under DATA_DIR/maintenance-history rather than deleted.
 */

export type MaintenanceState = "draining" | "active" | "drain_failed";
export type DrainReport = Record<string, boolean | number>;
export interface MaintenanceRecord {
  version: 1;
  id: string;
  state: MaintenanceState;
  requestedAt: string;
  settledAt: string | null;
  drain: DrainReport | null;
}
export interface MaintenanceStatus {
  active: boolean;
  /** "process": this process entered (or adopted) maintenance and drained its own workers. */
  source: "process" | "file" | "env" | null;
  state: MaintenanceState | "unknown" | null;
  id: string | null;
  requestedAt: string | null;
  settledAt: string | null;
  forcedByEnv: boolean;
  drain: DrainReport | null;
}

const MAX_RECORD_BYTES = 16 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const recordPath = () => path.join(env.dataDir, "maintenance.json");

type Read = { present: false } | { present: true; record: MaintenanceRecord | null };

function parseRecord(raw: string): MaintenanceRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<MaintenanceRecord>;
    if (r?.version !== 1 || typeof r.id !== "string" || !ID.test(r.id) ||
        !["draining", "active", "drain_failed"].includes(String(r.state)) ||
        typeof r.requestedAt !== "string" || (r.settledAt !== null && typeof r.settledAt !== "string")) return null;
    const drain = r.drain && typeof r.drain === "object" && !Array.isArray(r.drain) ? r.drain : null;
    return { version: 1, id: r.id, state: r.state as MaintenanceState, requestedAt: r.requestedAt,
      settledAt: r.settledAt ?? null, drain };
  } catch {
    return null;
  }
}

/** Anything other than "no such file" means maintenance; contents decide only the detail. */
export function readMaintenanceRecord(): Read {
  let fd: number;
  try {
    fd = fs.openSync(recordPath(), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "ENOENT" ? { present: false } : { present: true, record: null };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_RECORD_BYTES) return { present: true, record: null };
    return { present: true, record: parseRecord(fs.readFileSync(fd, "utf8")) };
  } catch {
    return { present: true, record: null };
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(dir: string) {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // Some filesystems refuse fsync on a directory; the rename itself happened.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Durable, atomic replace: a crash leaves the old record or the new one, never a torn file. */
function writeRecord(record: MaintenanceRecord) {
  const dir = env.dataDir;
  const tmp = path.join(dir, `.maintenance.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(record) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, recordPath());
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fsyncDir(dir);
}

// Set once this process enters or adopts maintenance; cleared only by exit.
// Deleting the file underneath a running process therefore never resumes it.
let latched: MaintenanceRecord | null = null;
let bootResolved = false;

/**
 * Consume NOTEMESH_MAINTENANCE_RESUME once per process. Only an exact id match
 * on a valid record resumes; anything else leaves maintenance active.
 */
function resolveResumeAtBoot() {
  if (bootResolved) return;
  bootResolved = true;
  const wanted = process.env.NOTEMESH_MAINTENANCE_RESUME?.trim();
  if (!wanted || latched) return;
  const current = readMaintenanceRecord();
  if (!current.present) return;
  if (!current.record || current.record.id !== wanted) {
    console.error("[maintenance] NOTEMESH_MAINTENANCE_RESUME does not match the maintenance record; maintenance stays active");
    return;
  }
  try {
    const history = path.join(env.dataDir, "maintenance-history");
    fs.mkdirSync(history, { recursive: true, mode: 0o700 });
    fs.renameSync(recordPath(), path.join(history, `${Date.now()}-${wanted}.json`));
    fsyncDir(history);
    fsyncDir(env.dataDir);
    console.log(`[maintenance] resumed ${wanted} (recorded state ${current.record.state}); normal startup follows`);
  } catch (e) {
    console.error("[maintenance] resume failed; maintenance stays active:", e instanceof Error ? e.message : e);
  }
}

export function maintenanceStatus(): MaintenanceStatus {
  resolveResumeAtBoot();
  const forcedByEnv = process.env.NOTEMESH_MAINTENANCE === "1";
  const file = readMaintenanceRecord();
  const record = latched ?? (file.present ? file.record : null);
  const active = Boolean(latched) || file.present || forcedByEnv;
  const source = latched ? "process" : file.present ? "file" : forcedByEnv ? "env" : null;
  const state = record?.state ?? (file.present ? "unknown" : forcedByEnv ? "active" : null);
  return { active, source, state, id: record?.id ?? null, requestedAt: record?.requestedAt ?? null,
    settledAt: record?.settledAt ?? null, forcedByEnv, drain: record?.drain ?? null };
}

/** The guard every worker and sync entry point checks. Never opens the DB. */
export function maintenanceActive(): boolean {
  return maintenanceStatus().active;
}

export function isMaintenanceLatched(): boolean {
  return latched !== null;
}

/**
 * Durably record "draining" BEFORE anything is stopped, so a crash mid-drain
 * still boots into maintenance. Adopting keeps an existing valid record (for a
 * file that appeared under a running process) and never overwrites one that
 * cannot be read.
 */
export function beginMaintenance(): MaintenanceRecord {
  if (latched) return latched;
  const current = readMaintenanceRecord();
  if (current.present) {
    latched = current.record ? { ...current.record, state: "draining", settledAt: null } :
      { version: 1, id: "unreadable-record", state: "draining", requestedAt: new Date().toISOString(), settledAt: null, drain: null };
    return latched;
  }
  const record: MaintenanceRecord = { version: 1, id: crypto.randomUUID(), state: "draining",
    requestedAt: new Date().toISOString(), settledAt: null, drain: null };
  writeRecord(record);
  latched = record;
  return record;
}

/** Record the drain outcome. A record that is not ours (or unreadable) is left untouched. */
export function settleMaintenance(state: "active" | "drain_failed", drain: DrainReport): MaintenanceRecord {
  if (!latched) throw Error("maintenance_not_entered");
  const next: MaintenanceRecord = { ...latched, state, settledAt: new Date().toISOString(), drain };
  latched = next;
  const current = readMaintenanceRecord();
  if (current.present && current.record?.id === next.id) {
    try {
      writeRecord(next);
    } catch (e) {
      console.error("[maintenance] could not persist drain outcome; maintenance stays active:", e instanceof Error ? e.message : e);
    }
  }
  return next;
}

// ---- in-flight HTTP requests -------------------------------------------

let inflight = 0;
let untracked = 0;

/**
 * Count an admitted request until its underlying Node response closes — after
 * a streamed body ends, or the client goes away. A request whose response
 * cannot be observed is counted as untracked forever, so drain cannot claim
 * quiescence it did not see (fail closed).
 */
export function trackRequest(event: unknown) {
  const res = (event as { nativeEvent?: { node?: { res?: NodeJS.EventEmitter } } })?.nativeEvent?.node?.res;
  if (!res || typeof res.once !== "function") {
    untracked++;
    return;
  }
  inflight++;
  res.once("close", () => {
    inflight--;
  });
}

export function inflightRequests(): { inflight: number; untracked: number } {
  return { inflight, untracked };
}

// ---- the answer served while active --------------------------------------

export function maintenanceResponse(request: Request, status: MaintenanceStatus): Response {
  const { pathname } = new URL(request.url);
  const view = { active: true, source: status.source, state: status.state, id: status.id,
    requestedAt: status.requestedAt, settledAt: status.settledAt, forcedByEnv: status.forcedByEnv,
    drainedByThisProcess: status.source === "process" && status.state === "active", drain: status.drain };
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(JSON.stringify({ ok: true, serving: "maintenance_only", maintenance: view }), { status: 200, headers });
  }
  return new Response(
    JSON.stringify({ error: "maintenance", message: "This server is in maintenance. No request is admitted until the owner resumes it.", maintenance: view }),
    { status: 503, headers: { ...headers, "Retry-After": "300" } },
  );
}

/** Test seam only: forget process-level state. */
export function resetMaintenanceForTests() {
  latched = null;
  bootResolved = false;
  inflight = 0;
  untracked = 0;
}

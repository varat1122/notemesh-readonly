import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// Explicit extension: the price CLI imports this module under plain Node.
import { env } from "./env.ts";

/**
 * Restart-persistent maintenance barrier.
 *
 * Strict contract: while maintenance is active no request, worker or helper
 * may mutate the database, the Vault, Git/Obsidian sync, the index, intake or
 * prices. The only answer served is a DB-free liveness/status reply from
 * /api/health. Deciding "are we in maintenance?" never opens the DB.
 *
 * State lives in DATA_DIR/maintenance.json (volume, outside Vault and DB) so it
 * survives restarts. A present but unreadable, oversized, symlinked or
 * malformed file is maintenance (fail closed). NOTEMESH_MAINTENANCE=1 forces
 * maintenance from boot and always wins over any resume variable.
 *
 * The built server evaluates this module more than once (one copy per vinxi
 * router: the page/API router and the /_server router). Everything a drain
 * must see — the latch, in-flight work, DB connections, worker timers — is
 * therefore kept in ONE process-wide registry on globalThis, never in module
 * scope.
 *
 * Resume is never an HTTP action (authenticating writes sessions and runs auth
 * migrations): see resolveResumeAtBoot and docs/maintenance-barrier.md.
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

interface Connection { readonly open?: boolean; pragma(source: string, options?: { simple?: boolean }): unknown }
interface Worker { timer: ReturnType<typeof setInterval> | undefined; busy: boolean }
interface Holder { id: number; claimed: boolean; closed: boolean; deferred: boolean }
interface Registry {
  latched: MaintenanceRecord | null;
  persistUncertain: boolean;
  bootResolved: boolean;
  admitted: boolean;
  fenced: boolean;
  work: Map<number, string>;
  nextWork: number;
  untracked: number;
  /** Work ids of the admin entry requests themselves, excluded by identity. */
  own: Set<number>;
  draining: Promise<MaintenanceRecord> | null;
  bundles: Set<string>;
  connections: Set<Connection>;
  workers: Map<string, Worker>;
}

const REGISTRY = Symbol.for("notemesh.maintenance.registry.v1");
function freshRegistry(): Registry {
  return { latched: null, persistUncertain: false, bootResolved: false, admitted: false, fenced: false,
    work: new Map(), nextWork: 1, untracked: 0, own: new Set(), draining: null,
    bundles: new Set(), connections: new Set(), workers: new Map() };
}
export function registry(): Registry {
  const g = globalThis as Record<symbol, Registry | undefined>;
  return (g[REGISTRY] ??= freshRegistry());
}
// Each evaluated copy of this module announces itself, so a drain report can
// show how many bundles share the registry.
registry().bundles.add(crypto.randomUUID());

const MAX_RECORD_BYTES = 16 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const recordPath = () => path.join(env.dataDir, "maintenance.json");
const historyDir = () => path.join(env.dataDir, "maintenance-history");

type Read = { present: false } | { present: true; record: MaintenanceRecord | null };

function parseRecord(raw: string): MaintenanceRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<MaintenanceRecord>;
    if (r?.version !== 1 || typeof r.id !== "string" || !ID.test(r.id) ||
        !["draining", "active", "drain_failed"].includes(String(r.state)) ||
        typeof r.requestedAt !== "string" || (r.settledAt !== null && typeof r.settledAt !== "string")) return null;
    let drain: DrainReport | null = null;
    if (r.drain !== null && r.drain !== undefined) {
      if (typeof r.drain !== "object" || Array.isArray(r.drain) ||
          !Object.values(r.drain).every((v) => typeof v === "boolean" || typeof v === "number")) return null;
      drain = r.drain;
    }
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
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Atomic replace, then read back: true only when the new record is verifiably on disk. */
function writeRecord(record: MaintenanceRecord): boolean {
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
  let synced = true;
  try {
    fsyncDir(dir);
  } catch {
    synced = false;
  }
  const back = readMaintenanceRecord();
  return synced && back.present && back.record?.id === record.id && back.record.state === record.state &&
    back.record.settledAt === record.settledAt;
}

// ---- status and fence ----------------------------------------------------

/**
 * Consume NOTEMESH_MAINTENANCE_RESUME once per process. Order and refusals:
 * forced maintenance wins; only an exact id on a valid record; an id already
 * in maintenance-history is a replay; a record that never reached "active"
 * also needs NOTEMESH_MAINTENANCE_RESUME_UNDRAINED=<same id>. The history entry
 * is written and fsynced (O_EXCL) BEFORE the record is removed, so a crash
 * between the two leaves maintenance active, never a silent resume.
 */
function resolveResumeAtBoot(r: Registry) {
  if (r.bootResolved) return;
  r.bootResolved = true;
  const wanted = process.env.NOTEMESH_MAINTENANCE_RESUME?.trim();
  if (!wanted || r.latched) return;
  const refuse = (why: string) => console.error(`[maintenance] resume refused (${why}); maintenance stays active`);
  if (process.env.NOTEMESH_MAINTENANCE === "1") return refuse("NOTEMESH_MAINTENANCE=1 takes precedence");
  const current = readMaintenanceRecord();
  if (!current.present) return;
  if (!current.record) return refuse("record unreadable");
  if (current.record.id !== wanted) return refuse("id does not match");
  if (current.record.state !== "active" && process.env.NOTEMESH_MAINTENANCE_RESUME_UNDRAINED?.trim() !== wanted)
    return refuse(`record is ${current.record.state}; NOTEMESH_MAINTENANCE_RESUME_UNDRAINED=<id> required`);
  const entry = path.join(historyDir(), `${wanted}.json`);
  try {
    fs.mkdirSync(historyDir(), { recursive: true, mode: 0o700 });
    if (fs.existsSync(entry)) return refuse("id already resumed once (replay)");
    const fd = fs.openSync(entry, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ ...current.record, resumedAt: new Date().toISOString() }) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncDir(historyDir());
    fs.unlinkSync(recordPath());
    fsyncDir(env.dataDir);
    if (readMaintenanceRecord().present) return refuse("record still present after removal");
    console.log(`[maintenance] resumed ${wanted} (recorded state ${current.record.state}); normal startup follows`);
  } catch (e) {
    refuse(e instanceof Error ? e.message : String(e));
  }
}

export function maintenanceStatus(): MaintenanceStatus {
  const r = registry();
  resolveResumeAtBoot(r);
  const forcedByEnv = process.env.NOTEMESH_MAINTENANCE === "1";
  const file = readMaintenanceRecord();
  const record = r.latched ?? (file.present ? file.record : null);
  const active = Boolean(r.latched) || file.present || forcedByEnv;
  const source = r.latched ? "process" : file.present ? "file" : forcedByEnv ? "env" : null;
  const state = record?.state ?? (file.present ? "unknown" : forcedByEnv ? "active" : null);
  return { active, source, state, id: record?.id ?? null, requestedAt: record?.requestedAt ?? null,
    settledAt: record?.settledAt ?? null, forcedByEnv, drain: record?.drain ?? null };
}

/** The guard every worker and sync entry point checks. Never opens the DB. */
export function maintenanceActive(): boolean {
  return maintenanceStatus().active;
}

/**
 * True when no mutation may start or continue. Work admitted before
 * maintenance may finish only while THIS process is still draining; once the
 * drain settles (or in a process that booted in maintenance) every mutation
 * primitive refuses, including late continuations of disconnected requests.
 */
export function mutationFenced(): boolean {
  const r = registry();
  if (r.fenced) return true;
  if (r.latched) return r.latched.state !== "draining";
  return maintenanceActive();
}

export function assertMutationAllowed(what: string) {
  if (mutationFenced()) throw Error(`Maintenance is active; ${what} refused`);
}

export function isMaintenanceLatched(): boolean {
  return registry().latched !== null;
}

// ---- entering and settling ------------------------------------------------

/**
 * Durably record "draining" BEFORE anything is stopped, so a crash mid-drain
 * still boots into maintenance. Adopting keeps an existing valid record (for a
 * file that appeared under a running process) and never overwrites one that
 * cannot be read. Throws, entering nothing, if the record cannot be written.
 */
export function beginMaintenance(): MaintenanceRecord {
  const r = registry();
  if (r.latched) return r.latched;
  const current = readMaintenanceRecord();
  if (current.present) {
    r.latched = current.record ? { ...current.record, state: "draining", settledAt: null } :
      { version: 1, id: "unreadable-record", state: "draining", requestedAt: new Date().toISOString(), settledAt: null, drain: null };
    r.persistUncertain = !current.record;
    return r.latched;
  }
  const record: MaintenanceRecord = { version: 1, id: crypto.randomUUID(), state: "draining",
    requestedAt: new Date().toISOString(), settledAt: null, drain: null };
  let verified = false;
  try {
    verified = writeRecord(record);
  } catch (e) {
    if (!readMaintenanceRecord().present) throw e;
  }
  r.latched = record;
  r.persistUncertain = !verified;
  return record;
}

/**
 * Record the drain outcome and raise the fence. "active" is reported only
 * when the outcome is verifiably on disk; otherwise it is drain_failed with
 * persistFailed. The fence goes up in every case.
 */
export function settleMaintenance(state: "active" | "drain_failed", drain: DrainReport): MaintenanceRecord {
  const r = registry();
  if (!r.latched) throw Error("maintenance_not_entered");
  const fence = fenceConnections();
  let report: DrainReport = { ...drain, dbConnections: fence.connections, dbFenced: fence.fenced };
  let outcome: "active" | "drain_failed" = fence.fenced === fence.connections ? state : "drain_failed";
  let persisted = false;
  const next = (): MaintenanceRecord => ({ ...r.latched!, state: outcome, settledAt: new Date().toISOString(), drain: report });
  let record = next();
  const current = readMaintenanceRecord();
  if (!r.persistUncertain && current.present && current.record?.id === record.id) {
    try {
      persisted = writeRecord(record);
    } catch {
      persisted = false;
    }
  }
  if (!persisted && outcome === "active") {
    outcome = "drain_failed";
    report = { ...report, persistFailed: true };
    record = next();
    try {
      const onDisk = readMaintenanceRecord();
      if (!r.persistUncertain && onDisk.present && onDisk.record?.id === record.id) writeRecord(record);
    } catch {
      // The on-disk record still says "draining": restart stays in maintenance.
    }
  }
  r.latched = record;
  r.fenced = true;
  return record;
}

// ---- process-wide work, connections and workers ---------------------------

export function beginWork(kind: string): number {
  const r = registry();
  const id = r.nextWork++;
  r.work.set(id, kind);
  return id;
}

export function endWork(id: number) {
  registry().work.delete(id);
}

/** Pending work, excluding the admin entry requests by identity. */
export function pendingWork(): { count: number; kinds: string[]; untracked: number } {
  const r = registry();
  const kinds = [...r.work].filter(([id]) => !r.own.has(id)).map(([, k]) => k);
  return { count: kinds.length, kinds, untracked: r.untracked };
}

export function registerConnection(c: Connection) {
  registry().connections.add(c);
}

/** query_only on every app DB connection in the process; verified by reading it back. */
export function fenceConnections(): { connections: number; fenced: number } {
  let fenced = 0;
  const all = registry().connections;
  // A closed connection can write nothing; forget it rather than count it.
  for (const c of [...all]) if (c.open === false) all.delete(c);
  for (const c of all) {
    try {
      c.pragma("query_only = ON");
      if (Number(c.pragma("query_only", { simple: true })) === 1) fenced++;
    } catch {
      // A connection that cannot be fenced leaves the outcome drain_failed.
    }
  }
  return { connections: all.size, fenced };
}

/** Timer and busy flag of a background worker, shared by every bundle. */
export function worker(name: string): Worker {
  const workers = registry().workers;
  let w = workers.get(name);
  if (!w) workers.set(name, (w = { timer: undefined, busy: false }));
  return w;
}

export function bundleCount(): number {
  return registry().bundles.size;
}

// ---- requests -----------------------------------------------------------------

const HOLDER = Symbol.for("notemesh.maintenance.request");
type Native = { node?: { res?: NodeJS.EventEmitter } } & Record<symbol, Holder | undefined>;
const nativeOf = (event: unknown) => (event as { nativeEvent?: Native })?.nativeEvent;

/**
 * Admit a request as pending work until its HANDLER has finished — not until
 * its socket closes, which happens early when a client disconnects. Released by
 * the API route wrapper (tracked), by the middleware when it answers itself, or
 * by onBeforeResponse for handlers that are not wrapped. A request that cannot
 * be followed is untracked forever, so a drain cannot report quiescence.
 */
export function admitRequest(event: unknown) {
  const r = registry();
  r.admitted = true;
  const native = nativeOf(event);
  if (!native) {
    r.untracked++;
    return;
  }
  const holder: Holder = { id: beginWork("http"), claimed: false, closed: false, deferred: false };
  native[HOLDER] = holder;
  native.node?.res?.once("close", () => {
    holder.closed = true;
    if (holder.deferred) endWork(holder.id);
  });
}

export function requestWorkId(event: unknown): number | null {
  return nativeOf(event)?.[HOLDER]?.id ?? null;
}

export function releaseRequest(event: unknown) {
  const holder = nativeOf(event)?.[HOLDER];
  if (holder && !holder.deferred) endWork(holder.id);
}

/** onBeforeResponse: only for handlers no route wrapper claimed. */
export function releaseUnclaimedRequest(event: unknown) {
  const holder = nativeOf(event)?.[HOLDER];
  if (holder && !holder.claimed) endWork(holder.id);
}

/**
 * Wrap an API route handler so its request stays pending work until the
 * handler settles (returns or throws), regardless of the client. With
 * holdUntilClose (MCP), it also stays pending until the streamed response
 * closes; MCP tool execution is tracked separately (mcp/http.ts).
 */
export function tracked<A extends unknown[], R>(handler: (...args: A) => R, opts: { holdUntilClose?: boolean } = {}) {
  return (...args: A): R => {
    const holder = nativeOf(args[0])?.[HOLDER];
    if (holder) holder.claimed = true;
    const settle = () => {
      if (!holder) return;
      if (opts.holdUntilClose && !holder.closed) holder.deferred = true;
      else endWork(holder.id);
    };
    let result: R;
    try {
      result = handler(...args);
    } catch (e) {
      if (holder) endWork(holder.id);
      throw e;
    }
    // Synchronous handlers stay synchronous; asynchronous ones are followed
    // until they settle.
    if (result && typeof (result as { then?: unknown }).then === "function") {
      return (result as unknown as Promise<unknown>).then(
        (value) => {
          settle();
          return value;
        },
        (e: unknown) => {
          if (holder) endWork(holder.id);
          throw e;
        },
      ) as R;
    }
    settle();
    return result;
  };
}

export function excludeOwnRequest(event: unknown) {
  const id = requestWorkId(event);
  if (id !== null) registry().own.add(id);
}

// ---- the answer served while active ---------------------------------------

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

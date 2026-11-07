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
 * migrations) and never a side effect of reading state: only the server's own
 * boot step (resolveServerBoot) performs it. See docs/maintenance-barrier.md.
 *
 * One enforcement mechanism for every writer outside the server's own request
 * and tool tracking (price stores, price CLI, Drive calls, operator scripts):
 *   1. durable state: writers treat the system as closed unless there is no
 *      record or resume marker AND that absence is durable (fsync verified);
 *   2. announced writers: a writer registers in an integrity-checked
 *      inventory before it checks maintenance; a drain treats a missing,
 *      replaced, corrupt or unreadable inventory as uncertain, never as empty;
 *   3. checks under the target's lock: every SQLite write re-checks
 *      maintenance inside a write transaction, and a drain takes the same
 *      write lock (a barrier) after recording maintenance — so no check can
 *      be overtaken by a drain; remote mutations are checked at the single
 *      HTTP choke point immediately before they are initiated.
 */

export type MaintenanceState = "draining" | "active" | "drain_failed";
export type DrainReport = Record<string, boolean | number>;
/** The process that last owned the record: pid plus kernel start time (pid reuse safe). */
export interface Owner { pid: number; start: string }
export interface MaintenanceRecord {
  version: 1;
  id: string;
  state: MaintenanceState;
  requestedAt: string;
  settledAt: string | null;
  drain: DrainReport | null;
  /** null for records written before ownership existed: never treated as proven quiescence. */
  owner: Owner | null;
}
export interface MaintenanceStatus {
  active: boolean;
  /** "process": this process entered (or adopted) maintenance and drained its own workers.
   * "resume": a resume was started and has not been durably committed. */
  source: "process" | "file" | "resume" | "env" | null;
  state: MaintenanceState | "unknown" | "resume_incomplete" | "open_unverified" | null;
  id: string | null;
  requestedAt: string | null;
  settledAt: string | null;
  forcedByEnv: boolean;
  drain: DrainReport | null;
  owner: Owner | null;
}

interface Connection { readonly open?: boolean; pragma(source: string, options?: { simple?: boolean }): unknown }
interface Worker { timer: ReturnType<typeof setInterval> | undefined; busy: boolean }
interface Holder { id: number; claimed: boolean; closed: boolean; deferred: boolean }
interface InventoryIdentity { id: string; dev: number; ino: number }
interface Registry {
  latched: MaintenanceRecord | null;
  persistUncertain: boolean;
  /** Why this process stays closed until restart, whatever the files say (failed resume, unverifiable openness). */
  heldClosed: string | null;
  bootResolved: boolean;
  /** Writer inventory identity this process registered with; changes are evidence of loss. */
  inventory: InventoryIdentity | null;
  presenceLock: string | null;
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
  return { latched: null, persistUncertain: false, heldClosed: null, bootResolved: false, inventory: null, presenceLock: null, admitted: false, fenced: false,
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
/** Present while a resume is in progress or failed part-way: maintenance for every process. */
const resumeMarkerPath = () => path.join(env.dataDir, "maintenance-resume.json");
const historyDir = () => path.join(env.dataDir, "maintenance-history");
const writersDir = () => path.join(env.dataDir, "maintenance-writers");
const sentinelPath = () => path.join(writersDir(), ".inventory.json");

function startOf(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}
const SELF: Owner = { pid: process.pid, start: startOf(process.pid) ?? `t${Math.round(performance.timeOrigin)}` };
export function selfOwner(): Owner {
  return SELF;
}
/** Alive means the same pid with the same start time; without /proc, an existing pid counts as alive. */
export function ownerAlive(o: Owner): boolean {
  if (o.pid === SELF.pid && o.start === SELF.start) return true;
  if (fs.existsSync("/proc/self/stat")) return startOf(o.pid) === o.start;
  try {
    process.kill(o.pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}
function parseOwner(raw: unknown): Owner | null {
  const o = raw as Partial<Owner> | null | undefined;
  return o && Number.isSafeInteger(o.pid) && (o.pid as number) > 0 && typeof o.start === "string" && o.start.length <= 64 ?
    { pid: o.pid as number, start: o.start } : null;
}

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
      settledAt: r.settledAt ?? null, drain, owner: parseOwner(r.owner) };
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

type Marker = { present: false } | { present: true; id: string | null; record: MaintenanceRecord | null };
function readResumeMarker(): Marker {
  let raw: string;
  try {
    const st = fs.lstatSync(resumeMarkerPath());
    if (!st.isFile() || st.size > MAX_RECORD_BYTES) return { present: true, id: null, record: null };
    raw = fs.readFileSync(resumeMarkerPath(), "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "ENOENT" ? { present: false } : { present: true, id: null, record: null };
  }
  try {
    const m = JSON.parse(raw) as { id?: unknown; record?: unknown };
    const record = parseRecord(JSON.stringify(m.record ?? null));
    return { present: true, id: record && m.id === record.id ? record.id : null, record: record && m.id === record.id ? record : null };
  } catch {
    return { present: true, id: null, record: null };
  }
}

/**
 * Publish a complete, fsynced file under a new name (fails if it exists):
 * readers — and a restart after a crash — never see it partly written.
 */
function publishExclusive(file: string, body: unknown) {
  const tmp = path.join(path.dirname(file), `.tmp-${crypto.randomUUID()}`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(body) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.linkSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  // One directory fsync makes the new name (and the temporary's removal) durable.
  fsyncDir(path.dirname(file));
}

/**
 * The server's boot step, run once by the request gate of the server process
 * only (never by a CLI or any other importer, whose environment may carry the
 * same variables). Two parts:
 *
 * Resume (NOTEMESH_MAINTENANCE_RESUME). Refusals, in order: NOTEMESH_MAINTENANCE=1
 * wins; only an exact id; another live server registered on this volume (an
 * adopter whose own record write may have failed) refuses; a record whose
 * owner process is still alive refuses; a record that is not "active", or
 * has no owner (written before ownership existed), also needs
 * NOTEMESH_MAINTENANCE_RESUME_UNDRAINED with the same id; an id already
 * committed to maintenance-history is a replay. Steps, each durable before
 * the next, with the gate closed throughout (the marker is maintenance for
 * every process): (1) write the intent marker; (2) remove the record; (3)
 * write the history entry; (4) remove the marker.
 *
 * Openness. With no record, marker or forced variable, the server still opens
 * only after it has verified that this absence is durable (fsync of DATA_DIR).
 * Every other writer process does the same before each write
 * (assertWritePermitted). So an unconfirmed final resume step — even when the
 * marker cannot be restored — opens no process until the filesystem confirms
 * it; a crash before confirmation leaves the marker, or a durable absence.
 * Any failure holds this process closed until restart.
 */
export function resolveServerBoot() {
  const r = registry();
  if (r.bootResolved) return;
  r.bootResolved = true;
  const wanted = process.env.NOTEMESH_MAINTENANCE_RESUME?.trim();
  if (wanted && !r.latched) resume(r, wanted);
  if (!r.heldClosed && !r.latched && process.env.NOTEMESH_MAINTENANCE !== "1" &&
      !readMaintenanceRecord().present && !readResumeMarker().present) {
    try {
      fsyncDir(env.dataDir);
    } catch {
      r.heldClosed = "open_state_not_durably_verified";
      console.error("[maintenance] DATA_DIR could not be fsynced; the server stays closed until restart");
    }
  }
}

function resume(r: Registry, wanted: string) {
  const refuse = (why: string) => console.error(`[maintenance] resume refused (${why}); maintenance stays active`);
  if (process.env.NOTEMESH_MAINTENANCE === "1") return refuse("NOTEMESH_MAINTENANCE=1 takes precedence");
  const marker = readResumeMarker();
  const current = readMaintenanceRecord();
  const entry = path.join(historyDir(), `${wanted}.json`);
  let target: MaintenanceRecord;
  if (marker.present) {
    if (!marker.record || marker.id !== wanted) return refuse("an interrupted resume of another or unreadable maintenance is pending");
    if (current.present && current.record?.id !== wanted) return refuse("record does not match the interrupted resume");
    target = marker.record;
  } else {
    if (!current.present) return;
    if (!current.record) return refuse("record unreadable");
    if (current.record.id !== wanted) return refuse("id does not match");
    if (fs.existsSync(entry)) return refuse("id already resumed once (replay)");
    target = current.record;
  }
  const others = otherLiveServers();
  if (others !== null && others > 0) return refuse("another server process is live on this volume");
  if (target.owner && !(target.owner.pid === SELF.pid && target.owner.start === SELF.start) && ownerAlive(target.owner))
    return refuse("the process that owns the record is still running");
  // Quiescence is proven only by a settled "active" of a known (now dead)
  // owner with no other server that could have adopted it since.
  const unproven = target.state !== "active" ? `record is ${target.state}` : !target.owner ? "record has no owner" :
    others === null ? "writer inventory missing or unreadable; an adopting server cannot be ruled out" : null;
  if (unproven && process.env.NOTEMESH_MAINTENANCE_RESUME_UNDRAINED?.trim() !== wanted)
    return refuse(`${unproven}; NOTEMESH_MAINTENANCE_RESUME_UNDRAINED=<id> required`);
  const intent = { version: 1, id: wanted, record: target, startedAt: new Date().toISOString() };
  try {
    if (!marker.present) publishExclusive(resumeMarkerPath(), intent);
    if (readMaintenanceRecord().present) fs.unlinkSync(recordPath());
    fsyncDir(env.dataDir);
    fs.mkdirSync(historyDir(), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(entry)) publishExclusive(entry, { ...target, resumedAt: intent.startedAt });
    fsyncDir(historyDir());
    fs.unlinkSync(resumeMarkerPath());
    fsyncDir(env.dataDir);
    if (readMaintenanceRecord().present || readResumeMarker().present) throw Error("maintenance state still present after resume");
    console.log(`[maintenance] resumed ${wanted} (recorded state ${target.state}); normal startup follows`);
  } catch (e) {
    r.heldClosed = "resume_incomplete";
    try {
      if (!readResumeMarker().present) publishExclusive(resumeMarkerPath(), intent);
    } catch {
      // Best effort only. Safety does not depend on it: this process is held
      // closed, and every other process must verify durable openness itself.
    }
    refuse(e instanceof Error ? e.message : String(e));
  }
}

export function maintenanceStatus(): MaintenanceStatus {
  const r = registry();
  const forcedByEnv = process.env.NOTEMESH_MAINTENANCE === "1";
  const file = readMaintenanceRecord();
  const resuming = readResumeMarker().present || r.heldClosed === "resume_incomplete";
  const unverified = r.heldClosed !== null && !resuming;
  const record = r.latched ?? (file.present ? file.record : null);
  const active = Boolean(r.latched) || file.present || resuming || unverified || forcedByEnv;
  const source = r.latched ? "process" : file.present ? "file" : resuming || unverified ? "resume" : forcedByEnv ? "env" : null;
  const state = record?.state ?? (file.present ? "unknown" : resuming ? "resume_incomplete" : unverified ? "open_unverified" : forcedByEnv ? "active" : null);
  return { active, source, state, id: record?.id ?? null, requestedAt: record?.requestedAt ?? null,
    settledAt: record?.settledAt ?? null, forcedByEnv, drain: record?.drain ?? null, owner: record?.owner ?? null };
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
 * still boots into maintenance. Adopting a record that appeared under a
 * running process rewrites it as "draining" (same id, saved drain report
 * dropped) before anything is advertised, so no reader sees an earlier
 * process's "active" evidence for work this process still has in flight. An
 * unreadable record is never overwritten; adoption that cannot be persisted
 * is latched as persistUncertain and can never settle "active".
 * Throws, entering nothing, if a fresh record cannot be written.
 */
export function beginMaintenance(): MaintenanceRecord {
  const r = registry();
  if (r.latched) return r.latched;
  const current = readMaintenanceRecord();
  if (current.present) {
    if (!current.record) {
      r.latched = { version: 1, id: "unreadable-record", state: "draining", requestedAt: new Date().toISOString(), settledAt: null, drain: null, owner: SELF };
      r.persistUncertain = true;
      return r.latched;
    }
    // This process becomes the owner: the earlier owner's "active" is not evidence for work in flight here.
    const adopted: MaintenanceRecord = { ...current.record, state: "draining", settledAt: null, drain: null, owner: SELF };
    let verified = false;
    try {
      verified = writeRecord(adopted);
    } catch {
      verified = false;
    }
    r.latched = adopted;
    r.persistUncertain = !verified;
    return adopted;
  }
  const record: MaintenanceRecord = { version: 1, id: crypto.randomUUID(), state: "draining",
    requestedAt: new Date().toISOString(), settledAt: null, drain: null, owner: SELF };
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

// ---- one mechanism for writers outside request/tool tracking ------------------------

function maintenanceRefusal(what: string) {
  return Object.assign(Error("maintenance_active"), { code: "maintenance_active", detail: `${what} refused` });
}

/** Cheap check for writers in any process: any maintenance state at all refuses. */
export function assertNoMaintenance(what: string) {
  if (maintenanceActive()) throw maintenanceRefusal(what);
}

/**
 * The check a writer outside the server's request/tool tracking makes before
 * EVERY persistent write (inside the target's write lock where there is one):
 * no maintenance state, and that absence durably on disk. If DATA_DIR cannot
 * be fsynced, openness is not proven and the write is refused.
 */
export function assertWritePermitted(what: string) {
  assertNoMaintenance(what);
  try {
    fsyncDir(env.dataDir);
  } catch {
    throw maintenanceRefusal(`${what} (maintenance state durability unverified)`);
  }
}

// The inventory: DATA_DIR/maintenance-writers holds a sentinel with a random
// id and one lock per announced writer (and per running server, its presence).
const LOCK = /^(price|drive|server|writer)\.(\d+)\.([0-9a-f-]{36})\.lock$/;

function readInventoryIdentity(): InventoryIdentity | null {
  try {
    const dir = fs.lstatSync(writersDir());
    if (!dir.isDirectory() || dir.isSymbolicLink()) return null;
    const st = fs.lstatSync(sentinelPath());
    if (!st.isFile() || st.size > MAX_RECORD_BYTES) return null;
    const id = (JSON.parse(fs.readFileSync(sentinelPath(), "utf8")) as { id?: unknown }).id;
    return typeof id === "string" && ID.test(id) ? { id, dev: dir.dev, ino: dir.ino } : null;
  } catch {
    return null;
  }
}

/** Normal mode only: create the inventory (or its missing sentinel) and return its identity. */
function ensureInventory(): InventoryIdentity {
  fs.mkdirSync(writersDir(), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(sentinelPath())) {
    try {
      publishExclusive(sentinelPath(), { version: 1, id: crypto.randomUUID() });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
  }
  const ident = readInventoryIdentity();
  if (!ident) throw maintenanceRefusal("writer inventory unreadable");
  return ident;
}

export interface WriterHandle { lock: string; inventoryId: string; release(): void; verify(): void }

/**
 * Announce a writer: register in the inventory FIRST, then check. A drain
 * records maintenance first, then reads the inventory, so either the writer
 * sees maintenance and stops or the drain sees the writer and waits. verify()
 * must be called before every write: it re-checks maintenance and durable
 * openness, and that this writer's own lock is still in the same inventory —
 * a lost or replaced inventory stops the writer (it never writes unannounced).
 */
export function announceWriter(kind: "price" | "drive" | "writer"): WriterHandle {
  assertNoMaintenance(kind);
  const ident = ensureInventory();
  const lock = path.join(writersDir(), `${kind}.${SELF.pid}.${crypto.randomUUID()}.lock`);
  publishExclusive(lock, { kind, owner: SELF, inventoryId: ident.id, startedAt: new Date().toISOString() });
  let released = false;
  const handle: WriterHandle = {
    lock,
    inventoryId: ident.id,
    release() {
      if (released) return;
      released = true;
      try {
        fs.unlinkSync(lock);
        fsyncDir(writersDir());
      } catch {
        // A lock that cannot be removed keeps every drain from claiming quiescence.
      }
    },
    verify() {
      if (released) throw maintenanceRefusal(`${kind} writer already released`);
      assertWritePermitted(kind);
      if (!fs.existsSync(lock) || readInventoryIdentity()?.id !== ident.id) throw maintenanceRefusal(`${kind} writer inventory lost`);
    },
  };
  try {
    handle.verify();
  } catch (e) {
    handle.release();
    throw e;
  }
  return handle;
}

/** Run a writer that may live in another process or outlive a request. */
export async function withMaintenanceWriter<T>(kind: "price" | "drive" | "writer", run: (writer: WriterHandle) => Promise<T> | T): Promise<T> {
  const writer = announceWriter(kind);
  try {
    return await run(writer);
  } finally {
    writer.release();
  }
}

/**
 * Called by the server before it admits its first request (normal mode only):
 * remember the inventory identity, register this server's presence (so a
 * resume elsewhere sees a live adopter), and clear locks whose process is
 * verifiably dead (pid + start time). Returns false when the server cannot
 * register: it is then held closed — an unregistered server would be
 * invisible to a resume in another process.
 */
export function registerServer(): boolean {
  const r = registry();
  if (r.inventory) return true;
  try {
    const ident = ensureInventory();
    for (const name of fs.readdirSync(writersDir())) {
      if (!LOCK.test(name)) continue;
      const owner = lockOwner(path.join(writersDir(), name));
      if (owner && !ownerAlive(owner)) fs.unlinkSync(path.join(writersDir(), name));
    }
    const lock = path.join(writersDir(), `server.${SELF.pid}.${crypto.randomUUID()}.lock`);
    publishExclusive(lock, { kind: "server", owner: SELF, inventoryId: ident.id, startedAt: new Date().toISOString() });
    r.presenceLock = lock;
    r.inventory = ident;
    process.once("exit", () => {
      try {
        fs.unlinkSync(lock);
      } catch {
        // A dead server's lock is cleared by the next server start.
      }
    });
    return true;
  } catch (e) {
    r.heldClosed ??= "writer_inventory_unavailable";
    console.error("[maintenance] writer inventory unavailable; this server stays closed until restart:", e instanceof Error ? e.message : e);
    return false;
  }
}

function lockOwner(file: string): Owner | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_RECORD_BYTES) return null;
    return parseOwner((JSON.parse(fs.readFileSync(file, "utf8")) as { owner?: unknown }).owner);
  } catch {
    return null;
  }
}

export interface InventoryState { writers: number; stale: number; otherServers: number; uncertain: string | null }

/**
 * What a drain may conclude about writers in any process. Missing, replaced,
 * corrupt or unreadable inventory is "uncertain" — never zero writers.
 */
export function inventoryState(): InventoryState {
  const r = registry();
  const none = (why: string): InventoryState => ({ writers: 0, stale: 0, otherServers: 0, uncertain: why });
  if (!r.inventory) return none("no_inventory_baseline");
  const ident = readInventoryIdentity();
  if (!ident) return none("inventory_missing_or_unreadable");
  if (ident.id !== r.inventory.id || ident.dev !== r.inventory.dev || ident.ino !== r.inventory.ino) return none("inventory_replaced");
  let names: string[];
  try {
    names = fs.readdirSync(writersDir());
  } catch {
    return none("inventory_unreadable");
  }
  const out: InventoryState = { writers: 0, stale: 0, otherServers: 0, uncertain: null };
  for (const name of names) {
    // Sentinel, and a lock not yet published (its writer has not checked yet).
    if (name === ".inventory.json" || /^\.tmp-[0-9a-f-]{36}$/.test(name)) continue;
    const m = LOCK.exec(name);
    const file = path.join(writersDir(), name);
    if (!m) return none("inventory_corrupt");
    if (file === r.presenceLock) continue;
    let body: { inventoryId?: unknown };
    try {
      body = JSON.parse(fs.readFileSync(file, "utf8")) as { inventoryId?: unknown };
    } catch {
      return none("inventory_corrupt");
    }
    const owner = lockOwner(file);
    if (body.inventoryId !== ident.id || !owner) return none("inventory_corrupt");
    const alive = ownerAlive(owner);
    if (m[1] === "server") {
      if (alive) out.otherServers++;
      continue;
    }
    out.writers++;
    if (!alive) out.stale++;
  }
  return out;
}

/** Live servers other than this one; null when it cannot be told (missing or unreadable inventory). */
function otherLiveServers(): number | null {
  if (!readInventoryIdentity()) return null;
  try {
    let n = 0;
    for (const name of fs.readdirSync(writersDir())) {
      const m = LOCK.exec(name);
      if (!m || m[1] !== "server") continue;
      const owner = lockOwner(path.join(writersDir(), name));
      if (!owner) return null;
      if (!(owner.pid === SELF.pid && owner.start === SELF.start) && ownerAlive(owner)) n++;
    }
    return n;
  } catch {
    return null;
  }
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
  const r = registry(), work = pendingWork();
  // Current process state first. A saved drain report describes the process
  // that wrote it; it is shown only as such, and only once this process has
  // settled its own drain may it count as this process's evidence.
  const phase = r.latched ? (r.latched.state === "draining" ? "draining" : "settled") :
    r.admitted ? "admitted_requests_not_adopted" : "booted_in_maintenance_started_nothing";
  const view = { active: true, source: status.source, state: status.state, id: status.id,
    requestedAt: status.requestedAt, settledAt: status.settledAt, forcedByEnv: status.forcedByEnv,
    process: { phase, pendingWork: work.count, untrackedRequests: work.untracked, persistUncertain: r.persistUncertain,
      heldClosed: r.heldClosed },
    // Whose drain the record describes: a stale "active" of an earlier process is not this process's quiescence.
    recordOwner: !status.owner ? "unknown" : status.owner.pid === SELF.pid && status.owner.start === SELF.start ? "this_process" :
      ownerAlive(status.owner) ? "other_live_process" : "earlier_process",
    drainedByThisProcess: phase === "settled" && status.state === "active" && !r.persistUncertain,
    // drain_failed, adoption without persistence or an earlier process's report are never a strict window.
    quiescenceProven: phase === "settled" && status.state === "active" && !r.persistUncertain,
    recordedDrain: phase === "settled" ? status.drain : null,
    earlierProcessDrain: phase === "settled" ? null : status.source === "file" ? status.drain : null };
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(JSON.stringify({ ok: true, serving: "maintenance_only", maintenance: view }), { status: 200, headers });
  }
  return new Response(
    JSON.stringify({ error: "maintenance", message: "This server is in maintenance. No request is admitted until the owner resumes it.", maintenance: view }),
    { status: 503, headers: { ...headers, "Retry-After": "300" } },
  );
}

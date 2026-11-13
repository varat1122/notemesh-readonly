import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import { gateBindingSchema, gateDigest, gateHash, gateId, type GateBinding, type SignedGatePermit } from "./drive-pilot-approval.ts";
import { PriceError } from "./model.ts";
import type { PilotCheckpoint } from "./drive-pilot.ts";

export type GateStage = "PREPARED" | "BOOTSTRAP_APPROVED" | "READY" | "UPLOAD_STARTED" | "ARCHIVE_VERIFIED" | "CATALOGUE_VERIFIED" | "READBACK_VERIFIED" | "DONE" | "HOLD";
/** An invocation capability, never serialized or shared with another invocation. */
export type PilotLease = symbol;
export interface GateRecord {
  version: 1; binding: GateBinding; stage: GateStage; holdCode: string | null;
  bootstrapPermitDigest: string | null; uploadPermitDigest: string | null;
  folderAttempted: boolean; folderId: string | null; folderEvidenceSha256: string | null;
  allocatedIds: { archive: string; catalogue: string } | null;
  bootstrapBudget: { driveRequests: number; oauthTokenCalls: number; folderCreates: number };
  upload: PilotCheckpoint | null; readback: Record<string, unknown> | null;
}
const count = (cap: number) => z.number().int().min(0).max(cap);
const checkpointSchema = z.object({ startedAt: z.number().int().nonnegative(), stopped: z.string().max(100).nullable(),
  counters: z.object({ requests: count(24), uploadedWireBytes: count(1048576), downloadedBytes: count(2097152), downloadReservationBytes: count(2097152), uploadAttempts: count(2) }).strict(),
  objects: z.array(z.object({ role: z.enum(["priceArchive", "priceCatalogue"]), phase: z.enum(["prepared", "uncertain", "confirmed"]), id: gateId.optional(), sha256: gateHash, bytes: count(262144) }).strict()).max(2),
}).strict();
const recordSchema = z.object({ version: z.literal(1), binding: gateBindingSchema,
  stage: z.enum(["PREPARED", "BOOTSTRAP_APPROVED", "READY", "UPLOAD_STARTED", "ARCHIVE_VERIFIED", "CATALOGUE_VERIFIED", "READBACK_VERIFIED", "DONE", "HOLD"]), holdCode: z.string().max(100).nullable(),
  bootstrapPermitDigest: gateHash.nullable(), uploadPermitDigest: gateHash.nullable(), folderAttempted: z.boolean(), folderId: gateId.nullable(), folderEvidenceSha256: gateHash.nullable(),
  allocatedIds: z.object({ archive: gateId, catalogue: gateId }).strict().nullable(),
  bootstrapBudget: z.object({ driveRequests: count(8), oauthTokenCalls: count(2), folderCreates: count(1) }).strict(),
  upload: checkpointSchema.nullable(), readback: z.record(z.string(), z.unknown()).nullable(),
}).strict();
function parseRecord(raw: string): GateRecord {
  try {
    if (Buffer.byteLength(raw) > 65536) throw Error();
    return recordSchema.parse(JSON.parse(raw));
  } catch { throw new PriceError("pilot_journal_corrupt_hold"); }
}
function monotonic(before: GateRecord, after: GateRecord) {
  const stages: GateStage[] = ["PREPARED", "BOOTSTRAP_APPROVED", "READY", "UPLOAD_STARTED", "ARCHIVE_VERIFIED", "CATALOGUE_VERIFIED", "READBACK_VERIFIED", "DONE", "HOLD"];
  const sameOnceSet = (a: unknown, b: unknown) => a === null || gateDigest(a) === gateDigest(b);
  if (gateDigest(before.binding) !== gateDigest(after.binding) ||
    !sameOnceSet(before.bootstrapPermitDigest, after.bootstrapPermitDigest) || !sameOnceSet(before.uploadPermitDigest, after.uploadPermitDigest) ||
    !sameOnceSet(before.folderId, after.folderId) || !sameOnceSet(before.folderEvidenceSha256, after.folderEvidenceSha256) || !sameOnceSet(before.allocatedIds, after.allocatedIds) ||
    before.folderAttempted && !after.folderAttempted || stages.indexOf(after.stage) < stages.indexOf(before.stage) ||
    Object.keys(before.bootstrapBudget).some(k => after.bootstrapBudget[k as keyof GateRecord["bootstrapBudget"]] < before.bootstrapBudget[k as keyof GateRecord["bootstrapBudget"]]))
    throw new PriceError("pilot_journal_regression_hold");
  const a = before.upload, b = after.upload;
  if (b && (new Set(b.objects.map(o => o.role)).size !== b.objects.length || b.counters.downloadedBytes > b.counters.downloadReservationBytes)) throw new PriceError("pilot_journal_regression_hold");
  if (!a) return;
  const phases = ["prepared", "uncertain", "confirmed"];
  if (!b || b.startedAt !== a.startedAt || a.stopped && b.stopped !== a.stopped ||
    Object.keys(a.counters).some(k => b.counters[k as keyof PilotCheckpoint["counters"]] < a.counters[k as keyof PilotCheckpoint["counters"]]) ||
    a.objects.some(old => {
      const next = b.objects.find(o => o.role === old.role);
      return !next || next.sha256 !== old.sha256 || next.bytes !== old.bytes || old.id && next.id !== old.id || phases.indexOf(next.phase) < phases.indexOf(old.phase);
    })) throw new PriceError("pilot_journal_regression_hold");
}
/** One local SQLite journal, FULL synchronous transactions; OS fsync failures stop before further dispatch. */
export class PilotJournal {
  readonly filename: string;
  private db: Database.Database;
  private leaseNonce: string | null = null;
  private owner: PilotLease | null = null;
  private directory: string;
  private hostIdentity: string;
  private constructor(directory: string, create?: GateBinding) {
    // PID liveness is meaningful only in this same kernel boot/PID namespace. Other hosts HOLD.
    try { this.hostIdentity = gateDigest({ boot: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), namespace: fs.readlinkSync("/proc/self/ns/pid") }); }
    catch { throw new PriceError("pilot_journal_host_identity_unavailable_hold"); }
    this.directory = path.resolve(directory); this.filename = path.join(this.directory, "pilot-journal.sqlite");
    const d = fs.lstatSync(this.directory);
    if (!d.isDirectory() || d.isSymbolicLink() || fs.realpathSync(this.directory) !== this.directory || (d.mode & 0o077) || (process.getuid && d.uid !== process.getuid())) throw new PriceError("pilot_journal_directory_unsafe");
    if (create) {
      if (fs.readdirSync(this.directory).length) throw new PriceError("pilot_journal_already_exists");
      fs.closeSync(fs.openSync(this.filename, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600));
    }
    let f: fs.Stats;
    try { f = fs.lstatSync(this.filename); } catch { throw new PriceError("pilot_missing_journal_hold"); }
    if (!f.isFile() || f.isSymbolicLink() || f.nlink !== 1 || (f.mode & 0o077) || (process.getuid && f.uid !== process.getuid())) throw new PriceError("pilot_journal_file_unsafe");
    this.db = new Database(this.filename, { fileMustExist: true, timeout: 1000 });
    try {
      this.db.pragma("journal_mode = DELETE"); this.db.pragma("synchronous = FULL"); this.db.pragma("busy_timeout = 1000");
      if (create) {
        this.db.exec("CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE approvals (permit_id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,phase TEXT NOT NULL); CREATE TABLE lease (id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL,host TEXT NOT NULL);");
        const record: GateRecord = { version: 1, binding: gateBindingSchema.parse(create), stage: "PREPARED", holdCode: null,
          bootstrapPermitDigest: null, uploadPermitDigest: null, folderAttempted: false, folderId: null, folderEvidenceSha256: null, allocatedIds: null,
          bootstrapBudget: { driveRequests: 0, oauthTokenCalls: 0, folderCreates: 0 }, upload: null, readback: null };
        this.db.prepare("INSERT INTO state VALUES (1,0,?,?)").run(gateDigest(record), JSON.stringify(record)); this.sync();
      }
      this.read();
    } catch (e) { this.db.close(); throw e instanceof PriceError ? e : new PriceError("pilot_journal_open_failed_hold"); }
  }
  static prepare(directory: string, binding: GateBinding) { return new PilotJournal(directory, binding); }
  static open(directory: string) { return new PilotJournal(directory); }
  private sync() {
    for (const target of [this.filename, this.directory]) {
      const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  }
  read(): GateRecord {
    try {
      const row = this.db.prepare("SELECT payload,digest FROM state WHERE id=1").get() as { payload: string; digest: string };
      const r = parseRecord(row.payload); if (gateDigest(r) !== row.digest) throw Error(); return r;
    } catch { throw new PriceError("pilot_journal_corrupt_hold"); }
  }
  assertOwned(lease: PilotLease) {
    if (!this.db.open || !this.owner || this.owner !== lease || !this.leaseNonce) throw new PriceError("pilot_journal_lease_required");
    const row = this.db.prepare("SELECT pid,nonce,host FROM lease WHERE id=1").get() as { pid: number; nonce: string; host: string } | undefined;
    if (!row || row.pid !== process.pid || row.nonce !== this.leaseNonce || row.host !== this.hostIdentity) throw new PriceError("pilot_journal_lease_lost_hold");
  }
  owns(lease: PilotLease | undefined): lease is PilotLease {
    try { if (!lease) return false; this.assertOwned(lease); return true; } catch { return false; }
  }
  assertActive(lease: PilotLease) {
    this.assertOwned(lease);
    if (["HOLD", "DONE"].includes(this.read().stage)) throw new PriceError("pilot_terminal_journal_hold");
  }
  update(change: (r: GateRecord) => void, lease: PilotLease, admit: () => void = () => {}) {
    this.db.transaction(() => {
      this.assertActive(lease); admit();
      const before = this.read(), r = structuredClone(before); change(r); parseRecord(JSON.stringify(r)); monotonic(before, r); admit();
      this.db.prepare("UPDATE state SET revision=revision+1,digest=?,payload=? WHERE id=1").run(gateDigest(r), JSON.stringify(r));
    }).immediate(); this.sync();
  }
  acquire() {
    if (this.owner) throw new PriceError("pilot_single_writer_busy_hold");
    const nonce = crypto.randomUUID();
    this.db.transaction(() => {
      const prior = this.db.prepare("SELECT pid,host FROM lease WHERE id=1").get() as { pid: number; host: string } | undefined;
      if (prior) {
        if (prior.host !== this.hostIdentity) throw new PriceError("pilot_journal_host_or_namespace_changed_hold");
        let alive = true; try { process.kill(prior.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
        if (alive) throw new PriceError("pilot_single_writer_busy_hold");
      }
      this.db.prepare("INSERT OR REPLACE INTO lease VALUES (1,?,?,?)").run(process.pid, nonce, this.hostIdentity);
    }).immediate(); this.sync(); this.leaseNonce = nonce; this.owner = Symbol("pilot invocation");
    return this.owner;
  }
  consume(approved: SignedGatePermit, recover: boolean, lease: PilotLease) {
    this.db.transaction(() => {
      this.assertActive(lease);
      const r = this.read(), p = approved.permit, digest = gateDigest(p);
      if (["HOLD", "DONE"].includes(r.stage)) throw new PriceError("pilot_terminal_journal_hold");
      const old = this.db.prepare("SELECT digest FROM approvals WHERE permit_id=?").get(p.permitId) as { digest: string } | undefined;
      if (recover) {
        if (!old || old.digest !== digest || (p.phase === "bootstrap" ? r.bootstrapPermitDigest : r.uploadPermitDigest) !== digest ||
          !(p.phase === "bootstrap" ? ["BOOTSTRAP_APPROVED"] : ["UPLOAD_STARTED", "ARCHIVE_VERIFIED", "CATALOGUE_VERIFIED", "READBACK_VERIFIED"]).includes(r.stage)) throw new PriceError("pilot_recovery_permit_mismatch_hold");
      } else {
        if (old || p.phase === "bootstrap" && r.stage !== "PREPARED" || p.phase === "upload" && r.stage !== "READY") throw new PriceError("pilot_permit_used_or_wrong_stage");
        this.db.prepare("INSERT INTO approvals VALUES (?,?,?)").run(p.permitId, digest, p.phase);
        if (p.phase === "bootstrap") { r.bootstrapPermitDigest = digest; r.stage = "BOOTSTRAP_APPROVED"; }
        else { r.uploadPermitDigest = digest; r.stage = "UPLOAD_STARTED"; }
      }
      // Reserve the duration before waiting on custody/grants, including a pre-request crash.
      // An old journal with no start checkpoint uses the signed lower bound, never a fresh window.
      if (p.phase === "upload" && !r.upload) r.upload = { startedAt: recover ? Date.parse(p.notBefore) : Date.now(), stopped: null,
        counters: { requests: 0, uploadedWireBytes: 0, downloadedBytes: 0, downloadReservationBytes: 0, uploadAttempts: 0 }, objects: [] };
      this.db.prepare("UPDATE state SET revision=revision+1,digest=?,payload=? WHERE id=1").run(gateDigest(r), JSON.stringify(r));
    }).immediate(); this.sync();
  }
  hold(code: string, lease: PilotLease) {
    this.assertOwned(lease);
    if (["HOLD", "DONE"].includes(this.read().stage)) return; // Terminal states and their first cause are absorbing.
    this.update(r => { r.stage = "HOLD"; r.holdCode = code; }, lease);
  }
  close(lease?: PilotLease) {
    if (!this.db.open) return;
    if (this.owner && this.owner !== lease) return; // Invalid/busy invocations may share this handle.
    try {
      if (this.leaseNonce) { this.db.prepare("DELETE FROM lease WHERE id=1 AND pid=? AND nonce=? AND host=?").run(process.pid, this.leaseNonce, this.hostIdentity); this.sync(); }
    } finally { this.leaseNonce = null; this.owner = null; this.db.close(); }
  }
  durability() { return { engine: "SQLite", journalMode: this.db.pragma("journal_mode", { simple: true }), synchronous: this.db.pragma("synchronous", { simple: true }), explicitFileAndDirectoryFsync: true, automaticStaleLeaseTimeout: false }; }
}

// G06-F disposable inspection only. No application/bootstrap imports, source
// SQLite connection, filesystem writes, WAL replay, repair or recovery permit.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const RECORD_LIMIT = 16 * 1024;
const IMAGE_LIMIT = 16 * 1024 * 1024;
const ROW_LIMIT = 128;
const FRAME_LIMIT = 512;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const FILES = {
  ".d1-native-outcome.pending": RECORD_LIMIT,
  "maintenance.json": RECORD_LIMIT,
  "maintenance-resume.json": RECORD_LIMIT,
  "app.sqlite": IMAGE_LIMIT,
  "app.sqlite-wal": IMAGE_LIMIT,
  "app.sqlite-shm": IMAGE_LIMIT,
  "app.sqlite-journal": IMAGE_LIMIT,
};
const LOCKS = [".d1-native-launch.lock", "safe-edit.lock"];
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const identity = st => ({ dev: String(st.dev), ino: String(st.ino), size: String(st.size),
  mode: String(st.mode), mtimeNs: String(st.mtimeNs), ctimeNs: String(st.ctimeNs) });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const errorCode = error => /^[A-Z0-9_]{1,64}$/.test(error?.code ?? "") ? error.code : "INSPECTION_ERROR";

function readFileAt(root, name, limit) {
  let fd;
  try {
    const file = `${root}/${name}`;
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) return { state: "UNSAFE_FILE_TYPE" };
    if (before.size > BigInt(limit)) return { state: "LIMIT_EXCEEDED" };
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW |
      fs.constants.O_NONBLOCK | fs.constants.O_NOATIME);
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!equal(identity(before), identity(opened))) return { state: "CHANGED_DURING_READ" };
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    let n = 0, count;
    while (n < buffer.length && (count = fs.readSync(fd, buffer, n, buffer.length - n, n))) n += count;
    if (n !== Number(opened.size) || !equal(identity(opened), identity(fs.fstatSync(fd, { bigint: true }))))
      return { state: "CHANGED_DURING_READ" };
    const bytes = buffer.subarray(0, n);
    return { state: "READ", identity: identity(opened), sha256: hash(bytes), bytes };
  } catch (error) { return { state: error?.code === "ENOENT" ? "ABSENT" : "UNREADABLE", code: errorCode(error) }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function lockAt(root, name) {
  try {
    const st = fs.lstatSync(`${root}/${name}`, { bigint: true });
    return { state: st.isDirectory() && !st.isSymbolicLink() ? "PRESENT" : "UNSAFE_LOCK_TYPE", identity: identity(st) };
  } catch (error) { return { state: error?.code === "ENOENT" ? "ABSENT" : "UNREADABLE", code: errorCode(error) }; }
}
function capture(root) {
  return Object.fromEntries([...Object.entries(FILES).map(([name, limit]) => [name, readFileAt(root, name, limit)]),
    ...LOCKS.map(name => [name, lockAt(root, name)])]);
}
function publicFiles(files) {
  return Object.fromEntries(Object.entries(files).map(([name, value]) => {
    const { bytes: _bytes, ...metadata } = value; return [name, metadata];
  }));
}
function parseRecord(file) {
  if (file.state !== "READ") return null;
  try { const value = JSON.parse(file.bytes.toString("utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
  catch { return null; }
}
function ownerObservation(owner) {
  const result = { scope: "CURRENT_PID_NAMESPACE_ONLY", provesWriterExclusion: false, state: "UNKNOWN" };
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 ||
      typeof owner.start !== "string" || !/^(?:[0-9]{1,32}|t[0-9]{1,32})$/.test(owner.start)) return result;
  result.pid = owner.pid;
  result.start = owner.start;
  try {
    const stat = fs.readFileSync(`/proc/${owner.pid}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    result.state = start === owner.start ? "MATCH_OBSERVED" : "START_MISMATCH_OBSERVED";
  } catch (error) { result.state = error?.code === "ENOENT" ? "NOT_OBSERVED" : "UNKNOWN"; }
  // Neither NOT_OBSERVED nor a matching PID authenticates an owner in a
  // different container/boot, nor proves that children/untracked writers died.
  return result;
}
function inspectWitness(file, lock, issue) {
  if (file.state === "ABSENT") {
    if (lock.state !== "ABSENT") issue("LOCK_ONLY_OWNER_UNVERIFIED");
    return { state: "ABSENT", outcome: "UNKNOWN" };
  }
  const w = parseRecord(file);
  if (!w || ![1, 2].includes(w.version) || typeof w.id !== "string" || !UUID.test(w.id) ||
      !["business", "barrier", "termination"].includes(w.kind) ||
      !Number.isSafeInteger(w.lock?.dev) || w.lock.dev < 0 || !Number.isSafeInteger(w.lock?.ino) || w.lock.ino < 1) {
    issue("WITNESS_MALFORMED_OR_UNSUPPORTED"); return { state: "INVALID", outcome: "UNKNOWN" };
  }
  const owner = ownerObservation(w.owner);
  if (owner.state === "UNKNOWN") issue("OWNER_IDENTITY_UNKNOWN");
  else if (owner.state === "MATCH_OBSERVED") issue("OWNER_MATCH_NOT_SETTLEMENT_PROOF");
  else issue("STALE_OR_FOREIGN_NAMESPACE_WITNESS");
  if (lock.state === "ABSENT") issue("WITNESS_ONLY_PHYSICAL_LOCK_ABSENT");
  else if (lock.state !== "PRESENT" || String(w.lock.dev) !== lock.identity.dev || String(w.lock.ino) !== lock.identity.ino)
    issue("WITNESS_LOCK_IDENTITY_CONFLICT");
  if (w.version === 1) {
    issue("LEGACY_WITNESS_OUTCOME_UNAVAILABLE");
    return { state: "LEGACY", version: 1, id: w.id, kind: w.kind, owner, outcome: "UNKNOWN" };
  }
  if (typeof w.operation !== "string" || !/^[a-z0-9_.:-]{1,80}$/.test(w.operation) ||
      !["native_launch_pending", "pre_effect_failed", "outcome_unknown", "release_failed"].includes(w.phase)) {
    issue("WITNESS_MALFORMED_OR_UNSUPPORTED"); return { state: "INVALID", outcome: "UNKNOWN" };
  }
  issue(w.phase === "native_launch_pending" ? "NATIVE_SETTLEMENT_UNPROVEN" : "RECORDED_UNCERTAIN_OUTCOME");
  return { state: "OBSERVED", version: 2, id: w.id, kind: w.kind, operation: w.operation,
    recordedPhase: w.phase, owner, outcome: "UNKNOWN" };
}
function sqliteHeader(file, issue) {
  if (file.state !== "READ") { issue("SQLITE_IMAGE_UNAVAILABLE"); return null; }
  const b = file.bytes;
  if (b.length < 100 || b.subarray(0, 16).toString("binary") !== "SQLite format 3\0") {
    issue("SQLITE_HEADER_INVALID"); return null;
  }
  const pageSize = b.readUInt16BE(16) === 1 ? 65536 : b.readUInt16BE(16);
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) ||
      b.length % pageSize || ![1, 2].includes(b[18]) || ![1, 2].includes(b[19])) {
    issue("SQLITE_HEADER_INVALID"); return null;
  }
  return { pageSize, writeVersion: b[18], readVersion: b[19], physicalPages: b.length / pageSize,
    declaredPages: b.readUInt32BE(28), headerOnly: true, provesCommit: false };
}
function inspectWal(file, header, issue) {
  if (file.state === "ABSENT") return { state: "ABSENT", provesCommit: false };
  issue("WAL_REPLAY_UNSUPPORTED_NO_SOURCE_SQLITE_OPEN");
  if (file.state !== "READ") return { state: "UNREADABLE", provesCommit: false };
  const b = file.bytes;
  if (b.length === 0) return { state: "EMPTY_OBSERVED", provesCommit: false };
  if (b.length < 32 || ![0x377f0682, 0x377f0683].includes(b.readUInt32BE(0)) || b.readUInt32BE(4) !== 3007000) {
    issue("WAL_HEADER_INVALID_OR_PARTIAL"); return { state: "INVALID", provesCommit: false };
  }
  const size = b.readUInt32BE(8);
  if (size < 512 || size > 65536 || (size & (size - 1))) {
    issue("WAL_PAGE_SIZE_INVALID"); return { state: "INVALID", provesCommit: false };
  }
  if (header && header.pageSize !== size) issue("WAL_SQLITE_PAGE_SIZE_CONFLICT");
  const frames = Math.floor((b.length - 32) / (size + 24));
  const trailingBytes = (b.length - 32) % (size + 24);
  if (trailingBytes) issue("WAL_PARTIAL_FRAME");
  if (frames > FRAME_LIMIT) issue("WAL_FRAME_INSPECTION_TRUNCATED");
  let commitMarkers = 0;
  for (let i = 0; i < Math.min(frames, FRAME_LIMIT); i++) {
    const offset = 32 + i * (size + 24);
    if (!b.readUInt32BE(offset) || !b.subarray(offset + 8, offset + 16).equals(b.subarray(16, 24))) issue("WAL_FRAME_HEADER_CONFLICT");
    if (b.readUInt32BE(offset + 4)) commitMarkers++;
  }
  return { state: "HEADER_OBSERVED_UNVERIFIED", frames, inspectedFrames: Math.min(frames, FRAME_LIMIT),
    trailingBytes, commitMarkersObserved: commitMarkers, checksumsVerified: false, databaseBindingVerified: false, provesCommit: false };
}
function inspectMemoryJournal(bytes, issue) {
  let d;
  const result = { state: "UNKNOWN", receiptAuthenticity: "NOT_VERIFIED", vaultReadback: "NOT_PERFORMED", records: [], events: [] };
  try {
    // The Buffer constructor deserializes into private SQLite memory. Never
    // supply the source filename/URI, copy files, replay WAL or load app code.
    d = new Database(Buffer.from(bytes));
    if (!d.memory) { issue("SQLITE_PRIVATE_MEMORY_REQUIRED"); return result; }
    d.pragma("temp_store = MEMORY"); d.pragma("trusted_schema = OFF"); d.pragma("query_only = ON");
    const checks = d.pragma("quick_check(1)");
    if (checks.length !== 1 || checks[0].quick_check !== "ok") { issue("SQLITE_MEMORY_INTEGRITY_HOLD"); return result; }
    result.snapshotQuickCheck = "ok";
    for (const table of ["safe_edit_operations", "safe_edit_events"]) {
      const def = d.prepare("SELECT type,sql FROM sqlite_schema WHERE name=?").get(table);
      if (!def) { issue("JOURNAL_SCHEMA_ABSENT"); continue; }
      if (def.type !== "table" || !/^CREATE TABLE\b/i.test(def.sql ?? "")) { issue("JOURNAL_SCHEMA_UNSUPPORTED"); continue; }
      if (table === "safe_edit_operations") {
        const rows = d.prepare("SELECT id,status,after_hash,substr(receipt,1,16385) receipt,length(CAST(receipt AS BLOB)) receipt_bytes FROM safe_edit_operations LIMIT 129").all();
        if (rows.length > ROW_LIMIT) issue("JOURNAL_RECORDS_TRUNCATED");
        for (const row of rows.slice(0, ROW_LIMIT)) {
          const entry = { operationIdSha256: hash(String(row.id)), status: ["preview", "writing", "written"].includes(row.status) ? row.status : "UNKNOWN", receipt: "MISSING" };
          if (entry.status === "UNKNOWN") issue("JOURNAL_STATUS_UNKNOWN");
          if (row.status === "writing") issue("JOURNAL_WRITING_OUTCOME_UNRESOLVED");
          if (row.receipt != null) {
            let receipt;
            try { if (row.receipt_bytes > RECORD_LIMIT) throw Error(); receipt = JSON.parse(row.receipt); } catch { issue("RECEIPT_MALFORMED_OR_OVERSIZED"); }
            if (receipt && typeof receipt === "object" && !Array.isArray(receipt)) {
              const consistent = receipt.operationId === row.id && HASH.test(row.after_hash) && receipt.afterHash === row.after_hash &&
                (row.status !== "written" || receipt.write === "written");
              entry.receipt = consistent ? "METADATA_CONSISTENT_NOT_AUTHENTICATED" : "CONFLICT";
              if (!consistent) issue("SQLITE_RECEIPT_BINDING_CONFLICT");
              if (row.status === "written" && (receipt.readback !== "verified" || receipt.reindex !== "verified")) issue("RECEIPT_VERIFICATION_INCOMPLETE");
            } else { entry.receipt = "INVALID"; issue("RECEIPT_MALFORMED_OR_OVERSIZED"); }
          } else if (row.status === "written") issue("WRITTEN_WITHOUT_RECEIPT");
          result.records.push(entry);
        }
      } else {
        const rows = d.prepare("SELECT operation_id,event FROM safe_edit_events WHERE event IN ('write_started','written','interrupted') LIMIT 129").all();
        if (rows.length > ROW_LIMIT) issue("JOURNAL_EVENTS_TRUNCATED");
        result.events = rows.slice(0, ROW_LIMIT).map(row => ({ operationIdSha256: hash(String(row.operation_id)), event: row.event }));
        if (rows.some(row => row.event === "write_started" || row.event === "interrupted")) issue("JOURNAL_EVENTS_REQUIRE_ORDERED_RECONCILIATION");
      }
    }
    result.state = "BOUNDED_MEMORY_SNAPSHOT_INSPECTED";
  } catch (error) { issue(`SQLITE_MEMORY_INSPECTION_${errorCode(error)}`); }
  finally { if (d) d.close(); }
  return result;
}

export function inspectEvidence(directory) {
  const issues = new Set();
  const issue = code => issues.add(code);
  const result = { contract: "D1-OFFLINE-INSPECTION-1", inspection: "PARTIAL", recovery: "HOLD", recoveryAuthorized: false,
    outcome: "UNKNOWN", sourceSQLiteOpened: false, sourceBytesModifiedByTool: false,
    limitations: ["WRITER_EXCLUSION_NOT_PROVEN", "NONATOMIC_OBSERVATION", "RECEIPT_AUTHENTICITY_NOT_VERIFIED", "POWER_LOSS_NOT_TESTED", "NO_RECOVERY_AUTHORITY"],
    bounds: { imageBytes: IMAGE_LIMIT, recordBytes: RECORD_LIMIT, rowsPerTable: ROW_LIMIT, walFrames: FRAME_LIMIT }, reasons: [] };
  let fd;
  try {
    if (process.platform !== "linux" || !fs.constants.O_NOATIME || !fs.constants.O_NOFOLLOW) {
      issue("UNSUPPORTED_READONLY_FILE_PRIMITIVES"); return result;
    }
    if (typeof directory !== "string" || !path.isAbsolute(directory) || path.normalize(directory) !== directory || directory === "/") {
      issue("EXPLICIT_OFFLINE_DIRECTORY_REQUIRED"); return result;
    }
    const ancestors = [];
    let current = "/";
    for (const part of directory.split("/").filter(Boolean)) {
      current = path.join(current, part);
      const st = fs.lstatSync(current, { bigint: true });
      if (!st.isDirectory() || st.isSymbolicLink()) { issue("UNSAFE_DIRECTORY_COMPONENT"); return result; }
      ancestors.push({ path: current, dev: st.dev, ino: st.ino });
    }
    fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NOATIME);
    const root = fs.fstatSync(fd, { bigint: true }), last = ancestors.at(-1);
    if (root.dev !== last.dev || root.ino !== last.ino) { issue("DIRECTORY_IDENTITY_CHANGED"); return result; }
    result.instance = { pathSha256: hash(directory), dev: String(root.dev), ino: String(root.ino) };
    const anchored = `/proc/self/fd/${fd}`, first = capture(anchored);
    result.files = publicFiles(first);
    for (const [name, file] of Object.entries(first)) if (!["READ", "ABSENT", "PRESENT"].includes(file.state)) issue(`${name}:${file.state}`);
    result.witness = inspectWitness(first[".d1-native-outcome.pending"], first[".d1-native-launch.lock"], issue);
    if (first["safe-edit.lock"].state !== "ABSENT") issue("SAFE_EDIT_LOCK_REQUIRES_OPERATOR_RECONCILIATION");
    for (const name of ["maintenance.json", "maintenance-resume.json"]) {
      const file = first[name];
      if (file.state !== "ABSENT") { issue("MAINTENANCE_RECORD_PRESENT_NOT_RESUME_AUTHORITY"); if (!parseRecord(file)) issue("MAINTENANCE_RECORD_UNREADABLE_OR_MALFORMED"); }
    }
    const header = sqliteHeader(first["app.sqlite"], issue);
    result.sqlite = { header, semanticIntegrity: "UNKNOWN" };
    result.wal = inspectWal(first["app.sqlite-wal"], header, issue);
    result.journal = { state: "UNSUPPORTED", receiptAuthenticity: "NOT_VERIFIED" };
    const sidecars = ["app.sqlite-wal", "app.sqlite-shm", "app.sqlite-journal"].some(name => first[name].state !== "ABSENT");
    if (sidecars) issue("SQLITE_SIDECAR_REPLAY_OR_SHARED_MEMORY_UNSUPPORTED");
    else if (header?.writeVersion === 2 || header?.readVersion === 2) issue("WAL_MODE_MEMORY_SNAPSHOT_UNSUPPORTED");
    else if (header) result.journal = inspectMemoryJournal(first["app.sqlite"].bytes, issue);
    const second = capture(anchored);
    const stable = equal(publicFiles(first), publicFiles(second)) && ancestors.every(a => {
      const st = fs.lstatSync(a.path, { bigint: true }); return st.isDirectory() && !st.isSymbolicLink() && st.dev === a.dev && st.ino === a.ino;
    });
    result.snapshot = { observationsMatch: stable, atomic: false, provesWriterExclusion: false };
    if (!stable) issue("EVIDENCE_CHANGED_DURING_INSPECTION");
    result.inspection = stable && !issues.size ? "COMPLETE_BOUNDED" : "PARTIAL";
  } catch (error) { issue(`INSPECTION_${errorCode(error)}`); }
  finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { issue("INSPECTION_HANDLE_CLOSE_UNKNOWN"); } }
    result.reasons = [...issues].sort();
    if (issues.size) result.inspection = "PARTIAL";
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4 || process.argv[2] !== "--evidence-dir") {
    console.log(JSON.stringify({ contract: "D1-OFFLINE-INSPECTION-1", recovery: "HOLD", recoveryAuthorized: false,
      reasons: ["USAGE_INSPECT_ONLY: --evidence-dir /absolute/offline/disposable/directory"] }));
    process.exitCode = 64;
  } else {
    console.log(JSON.stringify(inspectEvidence(process.argv[3]), null, 2));
    process.exitCode = 2; // Even a complete inspection is never recovery success.
  }
}

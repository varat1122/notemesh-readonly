/**
 * OFFLINE FIXTURE ONLY: a conservative, crash-sticky cross-process exclusion
 * primitive for DR rehearsal. NOT a production writer lock or distributed lease.
 *
 * The mkdir operation is atomic on the shared local filesystem. Every fixture
 * participant must opt in; non-cooperating processes and remote Obsidian devices
 * are not stopped. We deliberately do not auto-reap a stale lock on PID age:
 * a wrong stale-lock decision can admit a snapshot over a real writer.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const RAILWAY_KEYS = [
  "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_NAME", "RAILWAY_SERVICE_NAME",
];
const PREFIX = "nm-dr-ipc-fixture-";
const LOCK = ".notemesh-fixture-exclusive";
const OWNER = "holder";

export function assertIsolatedInterprocessFixture(root) {
  if (RAILWAY_KEYS.some(k => process.env[k]))
    throw Error("dr_ipc_fixture_only_no_railway");
  if (typeof root !== "string" || !root)
    throw Error("dr_ipc_fixture_root_required");
  const abs = path.resolve(root);
  // The only admissible roots are directories created for this rehearsal
  // beneath OS scratch. Reject a symlink alias or anything pointing at /data.
  const temp = fs.realpathSync(os.tmpdir());
  if (path.dirname(abs) !== temp || !path.basename(abs).startsWith(PREFIX))
    throw Error("dr_ipc_fixture_root_outside_scratch");
  const info = fs.lstatSync(abs);
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(abs) !== abs)
    throw Error("dr_ipc_fixture_root_unsafe");
  return abs;
}

/**
 * Exclusive for BOTH fixture writers and fixture snapshot capture. This
 * intentionally serializes fixture mutators; it does not claim shared-reader
 * semantics or readiness for multiple NoteMesh replicas.
 *
 * On process death the directory stays locked until an operator has proved
 * that no writer remains and manually cleared it. Never unlock another owner.
 */
/**
 * Acquire a crash-sticky fixture ticket for the ENTIRE writable-resource
 * lifetime. Unlike a short callback wrapper, the owner may retain this ticket
 * until an async worker / SQLite handle has actually closed.
 *
 * IMPORTANT: This is a cooperative OFFLINE-ONLY exclusion gate. It does not
 * register an OS-wide lock, block nonparticipants or certify Production DR.
 * When the holder crashes, the directory remains occupied and requires
 * independent operator review; never re-acquire based on stale PID/time.
 */
export function acquireFixtureInterprocessTicket(root, purpose) {
  if (purpose !== "writer" && purpose !== "snapshot")
    throw Error("dr_ipc_invalid_purpose");
  const fixture = assertIsolatedInterprocessFixture(root);
  const lockDir = path.join(fixture, LOCK);
  try {
    fs.mkdirSync(lockDir, { mode: 0o700 });
  } catch (e) {
    if (e?.code === "EEXIST") throw Error("dr_ipc_gate_occupied_fail_closed");
    throw e;
  }

  const owner = crypto.randomBytes(32).toString("hex");
  const ownerFile = path.join(lockDir, OWNER);
  const lockStat = fs.lstatSync(lockDir);
  // A failed holder write must leave the gate sticky, never admit snapshot.
  fs.writeFileSync(ownerFile, owner, { flag: "wx", mode: 0o600 });
  let released = false;
  return Object.freeze({
    release() {
      if (released) throw Error("dr_ipc_ticket_already_released");
      const now = fs.lstatSync(lockDir);
      if (!now.isDirectory() || now.isSymbolicLink() ||
          now.dev !== lockStat.dev || now.ino !== lockStat.ino ||
          fs.readFileSync(ownerFile, "utf8") !== owner)
        throw Error("dr_ipc_gate_ownership_lost_fail_closed");
      // Never recursively delete other writers' data or a tampered directory.
      fs.unlinkSync(ownerFile);
      fs.rmdirSync(lockDir);
      released = true;
    },
  });
}

export async function withFixtureInterprocessExclusion(root, purpose, perform) {
  if (typeof perform !== "function") throw Error("dr_ipc_callback_required");
  const ticket = acquireFixtureInterprocessTicket(root, purpose);
  try {
    return await perform();
  } finally {
    // If cleanup cannot independently prove ownership, fail closed; the
    // directory must remain sticky for review, even after callback failure.
    ticket.release();
  }
}

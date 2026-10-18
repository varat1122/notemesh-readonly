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
export async function withFixtureInterprocessExclusion(root, purpose, perform) {
  if (purpose !== "writer" && purpose !== "snapshot")
    throw Error("dr_ipc_invalid_purpose");
  if (typeof perform !== "function") throw Error("dr_ipc_callback_required");
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
  try {
    // No PID-based "stale lease" override. The random value is used only for
    // ownership checks and is never printed in errors or CI output.
    fs.writeFileSync(ownerFile, owner, { flag: "wx", mode: 0o600 });
    return await perform();
  } finally {
    // If another actor replaced or modified the lock, do not delete it.
    // Never use recursive remove: an unexpected file must prevent release.
    const now = fs.lstatSync(lockDir);
    if (!now.isDirectory() || now.isSymbolicLink() ||
        now.dev !== lockStat.dev || now.ino !== lockStat.ino ||
        fs.readFileSync(ownerFile, "utf8") !== owner)
      throw Error("dr_ipc_gate_ownership_lost_fail_closed");
    fs.unlinkSync(ownerFile);
    fs.rmdirSync(lockDir);
  }
}

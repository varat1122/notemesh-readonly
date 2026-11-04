// Standalone entrypoint. NEVER imports middleware, auth, canonical apply,
// indexer, intake workers or the normal application entrypoint.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertRuntimeIdentity, hash, Hold, TARGET } from "./contract";
import { Journal } from "./journal";
import { Runner } from "./runner";
import { controlServer } from "./server";
import { exactPath, inspect, previewStatus, processFence, openApp } from "./inspect";
import { assertQuiescent, cleanupWave3, loadRecoveryPacket } from "./recovery";
import type { GitBackend } from "../sync/git";

const CONTROL = "/pilot-001-data/ios-staging-control-001";
const root = TARGET.data_root;
function boundary() {
  const identity = assertRuntimeIdentity(process.env);
  const build = JSON.parse(fs.readFileSync(new URL("./identity.json", import.meta.url), "utf8"));
  if (build.foundation !== TARGET.foundation || build.commit !== identity.commit || build.bundleSha256 !== hash(fs.readFileSync(new URL("./main.mjs", import.meta.url)))) throw new Hold("BUILD_IDENTITY_REJECTED");
  exactPath(root);
  if (!fs.statSync(root).isDirectory()) throw new Hold("DATA_ROOT_MISSING");
  const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n").map(l => l.split(" ")[4]).filter(Boolean);
  if (mounts.filter(m => m === "/pilot-001-data").length !== 1 || mounts.some(m => m === "/data" || m.startsWith("/data/")) ||
      fs.statSync(root).dev !== fs.statSync("/pilot-001-data").dev) throw new Hold("MOUNT_BOUNDARY_REJECTED");
  return { ...identity, ...build };
}
async function main() {
  const build = boundary();
  if (!/^[a-f0-9]{64}$/.test(process.env.IOS_CONTROL_READER_KEY ?? "")) throw new Hold("READER_KEY_MISSING");
  if (process.env.IOS_CONTROL_RECOVERY_KEY === process.env.IOS_CONTROL_READER_KEY) throw new Hold("AUTH_KEYS_MUST_BE_DISTINCT");
  // Journal is the only startup write and lives outside the Wave 3 root.
  exactPath(CONTROL);
  fs.mkdirSync(CONTROL, { mode: 0o700, recursive: true });
  const lock = path.join(CONTROL, "runner.lock");
  fs.mkdirSync(lock, { mode: 0o700 }); // stale lock: HOLD, never steal by PID/TTL
  const owner = randomUUID();
  fs.writeFileSync(path.join(lock, "owner"), owner, { flag: "wx", mode: 0o600 });
  const journal = new Journal(exactPath(CONTROL, "control.sqlite"), build.commit);
  let writer: GitBackend | undefined;
  const boot = new Date().toISOString();
  const status = () => {
    const fence = processFence();
    return { ...(writer?.maintenanceStatus() ?? { state: "stopped", active: 0, accepting: false, pid: process.pid, last_transition: boot }),
      ...(fence.state === "UNKNOWN/HOLD" ? { state: "unknown", active: null, disposition: "UNKNOWN/HOLD" } : {}), process_fence: fence };
  };
  const requireExclusive = () => { if (processFence().state === "UNKNOWN/HOLD") throw new Hold("EXTERNAL_WRITER_UNKNOWN_HOLD"); };
  const getWriter = async () => { writer ??= new (await import("../sync/git")).GitBackend(); return writer; };
  const runner = new Runner(journal, () => ({ reader: process.env.IOS_CONTROL_READER_KEY!, recovery: process.env.IOS_CONTROL_RECOVERY_KEY }), boundary, {
    inspect: () => inspect(root, status(), boundary()), writer_status: status, reconcile_preview_status: () => previewStatus(root),
    auth_cleanup_wave3: run => { requireExclusive(); return cleanupWave3(root, () =>
      !writer || writer.maintenanceStatus().state === "stopped-controlled",
        counts => journal.append({ ...run, phase: "AUTH_OWNERSHIP_VERIFIED_BEFORE", counts })); },
    writer_start: async () => {
      requireExclusive(); assertQuiescent(root);
      const packet = loadRecoveryPacket(process.env);
      const db = openApp(root);
      try {
        const setting = (key: string) => db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
        if (setting("sync_backend") !== "git" || setting("vault_configured") !== "true" ||
            setting("git_remote") !== packet.writerRemote || setting("git_branch") !== packet.writerBranch ||
            process.env.SAFE_EDIT_GIT_REMOTE !== packet.writerRemote || process.env.SAFE_EDIT_GIT_BRANCH !== packet.writerBranch ||
            process.env.SAFE_EDIT_SINGLE_WRITER !== "1") throw new Hold("WRITER_CONFIG_REJECTED");
      } finally { db.close(); }
      return (await getWriter()).startControlled();
    },
    writer_drain: async () => { requireExclusive(); return (await getWriter()).drainControlled(); },
    writer_stop: async () => { requireExclusive(); if (!writer) throw new Hold("DRAIN_REQUIRED"); return writer.stopControlled(); },
  }, () => process.env.IOS_CONTROL_RECOVERY_ENABLED === "1");
  const server = controlServer(runner);
  server.listen(8080, "0.0.0.0");
  journal.append({ event: "RUNNER_STARTED", at: boot, target: TARGET, recovery_enabled: process.env.IOS_CONTROL_RECOVERY_ENABLED === "1" });
  // Do not describe a signal/restart as a drain; only release ownership after
  // the owned writer's controlled lifecycle has completed. Unknown => lock stays.
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    runner.closeAdmission();
    try {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (writer) { await writer.drainControlled(); writer.stopControlled(); }
      journal.append({ event: "RUNNER_STOPPED", at: new Date().toISOString(), target: TARGET });
      journal.close();
      if (fs.readFileSync(path.join(lock, "owner"), "utf8") !== owner) throw new Hold("RUNNER_LOCK_LOST");
      fs.unlinkSync(path.join(lock, "owner")); fs.rmdirSync(lock);
      process.exitCode = 0;
    } catch { process.exitCode = 1; }
  };
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
}
main().catch(() => { console.error("IOS_CONTROL_STARTUP_HOLD"); process.exitCode = 1; });

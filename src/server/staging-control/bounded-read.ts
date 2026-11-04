import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Hold } from "./contract";
import { ReadHold, ReadTiming } from "./read-timing";

// A pipe close can precede a grandchild finishing exit. This is cleanup after the read deadline,
// never additional operation time. On an unprovable cleanup the runner closes further admission.
async function settleGroup(pid: number | undefined): Promise<boolean> {
  if (!pid) return true;
  const deadline = performance.now() + 250;
  try {
    do {
      let live = false;
      const ids = fs.readdirSync("/proc").filter(id => /^\d+$/.test(id));
      if (ids.length > 4096) return false;
      for (const id of ids) {
        let raw: string;
        try { raw = fs.readFileSync(`/proc/${id}/stat`, "utf8"); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; return false; }
        const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
        if (Number(fields[2]) === pid) {
          // Detached worker owns this session as well as this process group.
          if (Number(fields[3]) !== pid) return false;
          if (!["Z", "X", "x"].includes(fields[0])) live = true;
        }
      }
      if (!live) return true;
      await new Promise<void>(resolve => setTimeout(resolve, 5));
    } while (performance.now() < deadline);
  } catch { /* no raw proc errors leave the cleanup witness */ }
  return false;
}

export const READ_BUDGET_MS = 8_000;
export function boundedRead(input: { operation: "inspect" | "reconcile_preview_status"; root: string; writer?: unknown; build?: unknown },
  worker = new URL("./read-worker.mjs", import.meta.url), budget = READ_BUDGET_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // No shell, generic command, request-controlled arguments or inherited keys.
    // The process group includes any fixed git inspection subprocesses.
    const child = spawn(process.execPath, [fileURLToPath(worker)], { detached: true, stdio: ["pipe", "pipe", "ignore", "pipe"],
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "production" } });
    const started = performance.now(), timing = new ReadTiming();
    let output = "", telemetry = "", telemetryBytes = 0, failure: string | undefined;
    const snapshot = () => timing.snapshot(performance.now() - started, budget);
    const stop = (code: string) => {
      failure ??= code;
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    child.stdio[3]!.on("data", (chunk: Buffer) => {
      telemetryBytes += chunk.length;
      if (telemetryBytes > 16_384) { stop("READ_TELEMETRY_BOUND_EXCEEDED"); return; }
      telemetry += chunk.toString("utf8");
      let end: number;
      while ((end = telemetry.indexOf("\n")) >= 0) {
        const line = telemetry.slice(0, end); telemetry = telemetry.slice(end + 1);
        try { timing.accept(line); } catch { stop("READ_TELEMETRY_INVALID_HOLD"); return; }
      }
    });
    child.stdio[3]!.on("error", () => stop("READ_TELEMETRY_UNAVAILABLE_HOLD"));
    // Kill the entire owned group even if the worker exits before a helper closes its pipes.
    child.on("exit", () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already gone */ } } });
    const timer = setTimeout(() => stop("READ_BUDGET_EXCEEDED_HOLD"), budget);
    child.stdout!.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(output) + chunk.length > 262_144) stop("READ_OUTPUT_BOUND_EXCEEDED");
      else output += chunk.toString("utf8");
    });
    child.stdin!.on("error", () => { stop("READ_WORKER_INPUT_FAILED"); });
    child.on("error", () => { failure ??= "READ_WORKER_UNAVAILABLE"; });
    child.on("close", async code => {
      clearTimeout(timer);
      // Verify termination after SIGKILL even when a descendant did not inherit stdout.
      if (!await settleGroup(child.pid)) failure = "READ_WORKER_CLEANUP_UNKNOWN_HOLD";
      // Do not free admission on an unknown cleanup outcome.
      if (failure) { reject(new ReadHold(failure, snapshot())); return; }
      try {
        const decoded = JSON.parse(output);
        if (code !== 0 || decoded.error) throw new Hold(typeof decoded.error === "string" && /^[A-Z_]+$/.test(decoded.error) ? decoded.error : "READ_WORKER_FAILED_HOLD");
        if (telemetry || !snapshot().events.length || snapshot().current_phase) throw new Hold("READ_TELEMETRY_INCOMPLETE_HOLD");
        resolve({ ...decoded.result, read_timing: snapshot() });
      } catch (e) { reject(new ReadHold(e instanceof Hold ? e.code : "READ_WORKER_RESULT_INVALID", snapshot())); }
    });
    child.stdin!.end(JSON.stringify(input));
  });
}

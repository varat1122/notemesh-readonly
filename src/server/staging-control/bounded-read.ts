import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Hold } from "./contract";

export const READ_BUDGET_MS = 8_000;
export function boundedRead(input: { operation: "inspect" | "reconcile_preview_status"; root: string; writer?: unknown; build?: unknown },
  worker = new URL("./read-worker.mjs", import.meta.url), budget = READ_BUDGET_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // No shell, generic command, request-controlled arguments or inherited keys.
    // The process group includes any fixed git inspection subprocesses.
    const child = spawn(process.execPath, [fileURLToPath(worker)], { detached: true, stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "production" } });
    let output = "", failure: string | undefined;
    const stop = (code: string) => {
      failure ??= code;
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => stop("READ_BUDGET_EXCEEDED_HOLD"), budget);
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(output) + chunk.length > 262_144) stop("READ_OUTPUT_BOUND_EXCEEDED");
      else output += chunk.toString("utf8");
    });
    child.stdin.on("error", () => { stop("READ_WORKER_INPUT_FAILED"); });
    child.on("error", () => { failure ??= "READ_WORKER_UNAVAILABLE"; });
    child.on("close", code => {
      clearTimeout(timer);
      // Do not free admission or journal a timeout while a helper is still alive.
      if (failure) { reject(new Hold(failure)); return; }
      try {
        const decoded = JSON.parse(output);
        if (code !== 0 || decoded.error) throw new Hold(typeof decoded.error === "string" && /^[A-Z_]+$/.test(decoded.error) ? decoded.error : "READ_WORKER_FAILED_HOLD");
        resolve(decoded.result);
      } catch (e) { reject(e instanceof Hold ? e : new Hold("READ_WORKER_RESULT_INVALID")); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

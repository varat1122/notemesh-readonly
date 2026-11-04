// Standalone child: fixed read-only operations, no app startup or credentials.
import fs from "node:fs";
import { inspect, previewStatus } from "./inspect";
import { Hold } from "./contract";
import { phaseReporter } from "./read-timing";
import type { DiagnosticReporter } from "./read-diagnostics";

const report: DiagnosticReporter = event => { fs.writeSync(3, JSON.stringify(event) + "\n"); };
const phase = phaseReporter(event => { fs.writeSync(3, JSON.stringify(event) + "\n"); });

try {
  const { operation, root, writer, build } = phase("worker_input", () => {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.length > 32_768) throw new Hold("WORKER_INPUT_BOUND");
  return JSON.parse(raw);
  });
  if (typeof root !== "string" || !root.startsWith("/")) throw new Hold("WORKER_INPUT_REJECTED");
  const result = operation === "inspect" ? inspect(root, writer, build, phase, report) :
    operation === "reconcile_preview_status" ? phase("preview", () => previewStatus(root)) : null;
  if (!result) throw new Hold("WORKER_OPERATION_REJECTED");
  process.stdout.write(JSON.stringify({ result }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e instanceof Hold ? e.code : "READ_WITNESS_FAILED_HOLD" }));
  process.exitCode = 1;
}

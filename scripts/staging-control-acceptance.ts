// Read-only acceptance client. Never sends recovery operations or prints keys.
import { randomUUID } from "node:crypto";
import { hash, sign, TARGET } from "../src/server/staging-control/contract";
const URL = "https://notemesh-pilot-001-staging.up.railway.app/v1/maintenance";
const key = process.env.IOS_CONTROL_READER_KEY;
if (!key || !/^[a-f0-9]{64}$/.test(key)) throw Error("Reader key required through environment");
const request = (operation = "inspect") => ({ request_id: randomUUID(), nonce: randomUUID(), operation, target: { ...TARGET }, issued_at: new Date().toISOString() });
async function call(raw: object | string, invalidAuth = false) {
  const body = typeof raw === "string" ? raw : JSON.stringify(raw);
  const res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", "x-ios-key-id": "reader",
    "x-ios-signature": invalidAuth ? "0".repeat(64) : sign(body, key!) }, body, signal: AbortSignal.timeout(30_000), redirect: "error" });
  const record = await res.json();
  console.log(JSON.stringify({ http_status: res.status, ...record }));
  return { status: res.status, record };
}
let vaultWitness: string | undefined;
const first = request(), seen = new Set<string>();
for (const r of [first, request("writer_status"), request("reconcile_preview_status"), request(), request("writer_status")]) {
  const { status, record } = await call(r);
  if (status !== 200 || record.terminal !== "SUCCEEDED" || record.nonce !== r.nonce || record.request_id !== r.request_id ||
      seen.has(record.execution_id) || record.result_digest !== hash(JSON.stringify({ result: record.result, error: record.error })) ||
      JSON.stringify(record.target) !== JSON.stringify(TARGET)) throw Error("FRESH_READ_ACCEPTANCE_FAILED");
  if (r.operation === "reconcile_preview_status" && record.result.accepted_state_matches !== true) throw Error("WAVE3_PREVIEW_BOUNDARY_HOLD");
  const state = r.operation === "inspect" ? record.result.writer : r.operation === "writer_status" ? record.result : null;
  if (state && (!["stopped", "stopped-controlled"].includes(state.state) || state.active !== 0)) throw Error("WRITER_BOUNDARY_HOLD");
  if (r.operation === "inspect") {
    const x = record.result;
    if (x.integrity !== "ok" || x.fk_count !== 0 || x.writing !== 0 || Object.values(x.locks).some(Boolean) ||
        x.index.missing || x.index.orphan || x.index.duplicate) throw Error("INSPECT_BOUNDARY_HOLD");
    if (vaultWitness && vaultWitness !== x.protected_boundary.sha256) throw Error("VAULT_WITNESS_CHANGED_HOLD");
    vaultWitness = x.protected_boundary.sha256;
  }
  seen.add(record.execution_id);
}
const negative: [object | string, boolean, string][] = [
  [first, false, "NO_REEXECUTION"], [ { ...request(), operation: "exec" }, false, "UNKNOWN_OPERATION" ],
  [{ ...request(), target: { ...TARGET, environment: "wrong" } }, false, "PAYLOAD_OR_TARGET_REJECTED"],
  [{ ...request(), target: { ...TARGET, service: "wrong" } }, false, "PAYLOAD_OR_TARGET_REJECTED"],
  [{ ...request(), target: { ...TARGET, tier: "production" } }, false, "PAYLOAD_OR_TARGET_REJECTED"],
  ["{", false, "MALFORMED_PAYLOAD"], [request(), true, "AUTH_REJECTED"],
  [{ ...request(), diagnostic: "controlled_read_only_failure" }, false, "CONTROLLED_READ_ONLY_FAILURE"],
];
for (const [r, invalid, error] of negative) {
  const response = await call(r, invalid);
  if (response.status < 400 || response.record.error !== error) throw Error("NEGATIVE_ACCEPTANCE_FAILED");
}
console.log(JSON.stringify({ acceptance: "READ_ONLY_CONTROL_PATH_PASS", mutations: 0, fresh_runs: seen.size }));

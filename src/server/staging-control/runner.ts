import { randomUUID } from "node:crypto";
import { authenticate, hash, Hold, OPERATIONS, READ_ONLY, requestSchema, TARGET, VERSION, type Keys, type Operation } from "./contract";
import { Journal } from "./journal";
import { ReadHold } from "./read-timing";
export type Handlers = Record<Operation, (run: ReturnType<Journal["admit"]>) => unknown | Promise<unknown>>;

export class Runner {
  private busy = false;
  private poisoned = false;
  private closing = false;
  private pending = new Set<Promise<unknown>>();
  closeAdmission() { this.closing = true; }
  async waitForIdle() {
    await Promise.allSettled([...this.pending]);
    if (this.poisoned) throw new Hold("AUDIT_COMPLETION_UNKNOWN_HOLD");
  }
  constructor(private journal: Journal, private keys: () => Keys, private targetCheck: () => void,
    private handlers: Handlers, private recoveryEnabled: () => boolean) {}
  execute(body: string, keyId: string, signature: string) {
    const execution = this.run(body, keyId, signature);
    this.pending.add(execution);
    void execution.then(() => this.pending.delete(execution), () => this.pending.delete(execution));
    return execution;
  }
  private async run(body: string, keyId: string, signature: string) {
    let safe: { request_id: string | null; nonce: string | null; operation: string | null } = { request_id: null, nonce: null, operation: null };
    const rejected = (code: string, actor = "unauthenticated") => {
      const at = new Date().toISOString();
      const response = { ...safe, execution_id: randomUUID(), implementation: this.journal.implementation, started_at: at, finished_at: at, terminal: "REJECTED", error: code, version: VERSION };
      // Do not echo untrusted payloads, supplied targets, auth headers or errors.
      const audit = this.journal.append({ ...response, admission: "REJECTED", actor, target: null, configured_target: TARGET, request_digest: hash(body) });
      return { status: code === "AUTH_REJECTED" ? 401 : code === "NO_REEXECUTION" ? 409 : 400, body: { ...response, audit } };
    };
    let actor: string;
    let r;
    try {
      if (Buffer.byteLength(body) > 4096) return rejected("MALFORMED_PAYLOAD");
      actor = authenticate(body, keyId, signature, this.keys());
      let raw;
      try { raw = JSON.parse(body); } catch { return rejected("MALFORMED_PAYLOAD", actor); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return rejected("MALFORMED_PAYLOAD", actor);
      if (!OPERATIONS.includes(raw.operation)) return rejected("UNKNOWN_OPERATION", actor);
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return rejected("PAYLOAD_OR_TARGET_REJECTED", actor);
      r = parsed.data;
      safe = { request_id: r.request_id, nonce: r.nonce, operation: r.operation };
      if (Math.abs(Date.now() - Date.parse(r.issued_at)) > 60_000) return rejected("REQUEST_EXPIRED", actor);
      this.targetCheck();
      if (this.closing) return rejected("SHUTTING_DOWN", actor);
      if (!READ_ONLY.has(r.operation) && (actor !== "recovery" || !this.recoveryEnabled())) return rejected("RECOVERY_DISABLED", actor);
      if (this.poisoned) return rejected("AUDIT_COMPLETION_UNKNOWN_HOLD", actor);
    } catch (error) { return rejected(error instanceof Hold ? error.code : "ADMISSION_UNAVAILABLE"); }
    let run;
    try { run = this.journal.admit(r, actor); }
    catch (error) { return rejected(error instanceof Hold ? error.code : "ADMISSION_UNAVAILABLE", actor); }
    let result: unknown = null, error: string | null = null;
    const acquired = !this.busy;
    try {
      if (!acquired) throw new Hold("BUSY_HOLD");
      this.busy = true;
      this.targetCheck();
      if (r.diagnostic) throw new Hold("CONTROLLED_READ_ONLY_FAILURE");
      result = await this.handlers[r.operation](run);
    } catch (e) {
      error = e instanceof Hold ? e.code : "OPERATION_FAILED_HOLD";
      if (e instanceof ReadHold) {
        result = { read_timing: e.timing, witness_complete: false };
        if (e.code === "READ_WORKER_CLEANUP_UNKNOWN_HOLD") this.poisoned = true;
      }
    }
    const response = { ...run, finished_at: new Date().toISOString(), terminal: error ? "HOLD" : "SUCCEEDED",
      result, error, result_digest: hash(JSON.stringify({ result, error })), implementation: this.journal.implementation, version: VERSION };
    let audit;
    try { audit = this.journal.append({ ...response, admission: "ADMITTED" }); }
    catch { this.poisoned = true; throw new Hold("AUDIT_COMPLETION_UNKNOWN_HOLD"); }
    finally { if (acquired) this.busy = false; }
    return { status: error ? 409 : 200, body: { ...response, audit, audit_status: this.journal.summary() } };
  }
}

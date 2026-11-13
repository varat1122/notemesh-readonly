import { PilotJournal, type GateRecord, type PilotLease } from "./drive-pilot-journal.ts";
import { PriceError } from "./model.ts";

/** Pilot-only invocation admission. An abort cannot undo a dispatched HTTP request;
 * durable reservations remain consumed and late continuations must re-enter this guard. */
export class PilotOperation {
  private active = true;
  readonly journal: PilotJournal;
  readonly lease: PilotLease;
  readonly deadlineAt: number;
  constructor(journal: PilotJournal, lease: PilotLease, deadlineAt: number) {
    this.journal = journal; this.lease = lease; this.deadlineAt = deadlineAt;
    if (!Number.isFinite(deadlineAt)) throw new PriceError("pilot_deadline_invalid");
    this.check();
  }
  check(signal?: AbortSignal | null) {
    if (!this.active) throw new PriceError("pilot_operation_closed_hold");
    this.journal.assertOwned(this.lease);
    const shared = this.journal.read();
    // A failed session may have just committed HOLD before this post-await check.
    // Preserve that first cause instead of masking it with a generic terminal error.
    if (shared.stage === "HOLD") throw new PriceError(shared.holdCode ?? "pilot_terminal_journal_hold");
    if (shared.stage === "DONE") throw new PriceError("pilot_terminal_journal_hold");
    if (Date.now() >= this.deadlineAt) throw new PriceError("pilot_absolute_deadline_exceeded");
    if (signal?.aborted) throw new PriceError("pilot_cancelled_hold");
  }
  update(change: (r: GateRecord) => void) { this.check(); this.journal.update(change, this.lease, () => this.check()); }
  /** Bounds even cooperative callbacks/streams that ignore AbortSignal. Nothing in their
   * late result is accepted; trusted adapters must put storage effects inside commit(). */
  async run<T>(action: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal | null, timeoutMs = Infinity): Promise<T> {
    this.check(caller);
    const remaining = this.deadlineAt - Date.now(), duration = Math.min(remaining, timeoutMs);
    const controller = new AbortController(), signal = caller ? AbortSignal.any([controller.signal, caller]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined, aborted: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      aborted = () => reject(new PriceError(caller?.aborted ? "pilot_cancelled_hold" : remaining <= timeoutMs ? "pilot_absolute_deadline_exceeded" : "drive_request_failed"));
      signal.addEventListener("abort", aborted, { once: true });
      timer = setTimeout(() => controller.abort(), Math.max(1, duration));
    });
    try {
      const work = Promise.resolve().then(() => { this.check(signal); return action(signal); });
      const value = await Promise.race([work, cancelled]);
      this.check(caller); return value;
    } catch (error) {
      controller.abort(); this.check(caller); throw error;
    } finally {
      clearTimeout(timer); if (aborted) signal.removeEventListener("abort", aborted);
    }
  }
  /** Scope this separately for each adapter invocation. The admitted effect must be
   * synchronous; async preparation belongs before commit, never inside the effect. */
  custodyCommit() {
    let committed = false, accepting = true;
    return {
      commit: (effect: () => void) => {
        this.check();
        if (!accepting || committed) throw new PriceError("pilot_custody_commit_refused");
        committed = true; effect(); this.check();
      },
      finish: () => { accepting = false; this.check(); if (!committed) throw new PriceError("pilot_custody_commit_missing"); },
      close: () => { accepting = false; },
    };
  }
  close() { this.active = false; }
}

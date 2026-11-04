import { Hold } from "./contract";

export const READ_PHASES = ["worker_input", "sqlite_locks", "db_open", "integrity", "foreign_keys", "counts", "notes_fts",
  "receipts", "auth", "git", "file_locks", "protected_boundary", "db_close", "preview"] as const;
export type ReadPhase = typeof READ_PHASES[number];
export type PhaseEvent = { seq: number; phase: ReadPhase; event: "start" | "end"; elapsed_ms: number };
export type PhaseRun = <T>(phase: ReadPhase, fn: () => T) => T;
export const untimed: PhaseRun = (_phase, fn) => fn();
export function phaseReporter(emit: (event: PhaseEvent) => void): PhaseRun {
  const started = performance.now(); let seq = 0;
  return (phase, fn) => {
    emit({ seq: ++seq, phase, event: "start", elapsed_ms: Math.round(performance.now() - started) });
    const result = fn();
    emit({ seq: ++seq, phase, event: "end", elapsed_ms: Math.round(performance.now() - started) });
    return result;
  };
}
// Validate IPC instead of relaying worker strings. The journal sees only this fixed vocabulary and bounded numbers.
export class ReadTiming {
  private events: PhaseEvent[] = [];
  accept(line: string) {
    const e = JSON.parse(line), prior = this.events.at(-1);
    if (!e || Object.keys(e).sort().join() !== "elapsed_ms,event,phase,seq" || !READ_PHASES.includes(e.phase) ||
      !["start", "end"].includes(e.event) || e.seq !== this.events.length + 1 || e.seq > 64 ||
      !Number.isSafeInteger(e.elapsed_ms) || e.elapsed_ms < (prior?.elapsed_ms ?? 0) || e.elapsed_ms > 60_000 ||
      (e.event === "end" && (prior?.event !== "start" || prior.phase !== e.phase)) ||
      (e.event === "start" && prior?.event === "start" && e.phase !== "db_close")) throw new Hold("READ_TELEMETRY_INVALID_HOLD");
    this.events.push({ seq: e.seq, phase: e.phase, event: e.event, elapsed_ms: e.elapsed_ms });
  }
  snapshot(elapsed: number, budget: number) {
    const last = this.events.at(-1), open = new Map<ReadPhase, number>();
    const completed: { phase: ReadPhase; duration_ms: number }[] = [];
    for (const e of this.events) {
      if (e.event === "start") open.set(e.phase, e.elapsed_ms);
      else { completed.push({ phase: e.phase, duration_ms: e.elapsed_ms - open.get(e.phase)! }); open.delete(e.phase); }
    }
    return { budget_ms: budget, parent_elapsed_ms: Math.round(elapsed), last_phase: last?.phase ?? null,
      current_phase: last?.event === "start" ? last.phase : null, events: [...this.events], completed, unfinished_phases: [...open.keys()],
      provenance: "validated worker fd3 phase events retained by parent before terminal audit; no DB values or paths" };
  }
}
export class ReadHold extends Hold {
  constructor(code: string, readonly timing: ReturnType<ReadTiming["snapshot"]>) { super(code); }
}

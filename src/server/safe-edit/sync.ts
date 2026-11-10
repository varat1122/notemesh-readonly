import { assertEnabled } from "./engine";
import { syncKind, syncBackend } from "../sync";
import { supervisor } from "../ob/supervisor";
import { c1Pilot } from "../c1-pilot";
import { worker, assertNoMaintenance } from "../maintenance";
import { gitBackend } from "../sync/git";

// The only supported deployment is one server replica with a cloud-owned
// vault. Drain the selected backend before CAS/rename; resume after release.
export async function withPausedSync<T>(run:()=>T):Promise<T> {
  assertEnabled();
  if (c1Pilot()) {
    // This opt-in instance has no external writer. Never use this branch for
    // shared/synchronised vaults; CLI, importer and raw writer entrypoints are
    // independently fenced. Apply still owns the existing filesystem lock.
    assertNoMaintenance("C1 pilot Safe Edit");
    const w = worker("cloudIntake");
    if (w.busy || w.timer || !supervisor().isQuiescent() || !gitBackend().isQuiescent())
      throw Error("c1_pilot_external_writer_hold");
    return run();
  }
  if (syncKind() === "git" && process.env.CLOUD_INTAKE === "1") {
    const backend = syncBackend();
    if (backend.kind !== "git" || !backend.withPausedForEdit) throw Error("Git Safe Edit pause is unavailable");
    return backend.withPausedForEdit(run);
  }
  if(syncKind()!=="obsidian"||process.env.CLOUD_INTAKE!=="1") throw Error("Safe Edit requires the guarded Obsidian cloud deployment");
  const s=supervisor(),state=s.status();
  if(state.state!=="running"||state.activity.active||!s.getLogs().some(l=>l.line==="[sync-policy] Verified bidirectional sync."&&l.ts>=(state.startedAt??Infinity))) throw Error("Wait for verified, idle bidirectional Sync before applying edits");
  return s.withPausedForEdit(run);
}

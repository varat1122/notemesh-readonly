import { assertEnabled } from "./engine";
import { syncKind } from "../sync";
import { supervisor } from "../ob/supervisor";

// The only supported deployment is one server replica with a cloud-owned
// vault. Pause and await the real sync child before CAS/rename; restart after.
export async function withPausedSync<T>(run:()=>T):Promise<T> {
  assertEnabled();
  if(syncKind()!=="obsidian"||process.env.CLOUD_INTAKE!=="1") throw Error("Safe Edit requires the guarded Obsidian cloud deployment");
  const s=supervisor(),state=s.status();
  if(state.state!=="running"||state.activity.active||!s.getLogs().some(l=>l.line==="[sync-policy] Verified bidirectional sync."&&l.ts>=(state.startedAt??Infinity))) throw Error("Wait for verified, idle bidirectional Sync before applying edits");
  return s.withPausedForEdit(run);
}

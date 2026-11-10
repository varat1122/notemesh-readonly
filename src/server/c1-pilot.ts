/** Explicit whole-instance restriction, never a caller-supplied intake flag.
 * Only an owner-created disposable directory may enable this pilot. It is not
 * an isolation mechanism for a shared volume or an uncooperative OS process. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {env} from "./env";
import {assertPilotIdentity} from "../../scripts/c1-pilot-identity.cjs";
export const C1_PILOT_POLICY="C1-ANALYST-REVIEW-1";
export function c1Pilot(existing?:Database.Database){
 const mode=process.env.C1_RESEARCH_PILOT;
 assertPilotIdentity(env.dataDir,mode,Database,existing);
 if(mode===undefined)return false;
 if(mode!=="disposable")throw Error("c1_pilot_invalid_mode_hold");
 const root=fs.realpathSync(env.dataDir),tmp=fs.realpathSync(os.tmpdir());
 if(root!==env.dataDir||!root.startsWith(tmp+path.sep)||!path.basename(root).startsWith("ios-c1-pilot-")||
  env.vaultDir!==path.join(root,"vault")||fs.realpathSync(env.vaultDir)!==env.vaultDir||process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_SERVICE_ID)
  throw Error("c1_pilot_disposable_isolation_required");
 return true;
}
export function denyPilotRawWriter(){if(c1Pilot())throw Error("c1_pilot_canonical_reviewed_writer_required");}
/** Same cross-process lock as Safe Edit Apply. Preview rotation, Judge
 * enrollment and reviewer decisions cannot overtake a reviewed publication. */
export function withPilotAdmissionLock<T>(run:()=>T):T {
 if(!c1Pilot())return run();
 const lock=path.join(env.dataDir,"safe-edit.lock");fs.mkdirSync(lock,{mode:0o700});
 try{return run();}finally{fs.rmdirSync(lock);}
}

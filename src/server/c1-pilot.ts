/** Explicit whole-instance restriction, never a caller-supplied intake flag.
 * Only an owner-created disposable directory may enable this pilot. It is not
 * an isolation mechanism for a shared volume or an uncooperative OS process. */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {env} from "./env";
import {assertPilotIdentity} from "../../scripts/c1-pilot-identity.cjs";
export const C1_PILOT_POLICY="C1-ANALYST-REVIEW-1";
export function c1Pilot(existing?:Database.Database){
 return assertPilotIdentity(env.dataDir,process.env.C1_RESEARCH_PILOT,Database,existing);
}
/** Revision/Event pilot is instance-scoped, never a caller's payload switch. */
export const revisionPilotRequired=()=>process.env.IOS_C1_REVISION_PILOT!==undefined||path.basename(env.dataDir).startsWith("ios-revision-pilot-");
export function denyPilotRawWriter(){
 if(revisionPilotRequired())throw Error("source_event_canonical_writer_required");
 if(c1Pilot())throw Error("c1_pilot_canonical_reviewed_writer_required");
}
/** Same cross-process lock as Safe Edit Apply. Preview rotation, Judge
 * enrollment and reviewer decisions cannot overtake a reviewed publication. */
export function withPilotAdmissionLock<T>(run:()=>T):T {
 if(!c1Pilot()&&!revisionPilotRequired())return run();
 const lock=path.join(env.dataDir,"safe-edit.lock");fs.mkdirSync(lock,{mode:0o700});
 try{return run();}finally{fs.rmdirSync(lock);}
}

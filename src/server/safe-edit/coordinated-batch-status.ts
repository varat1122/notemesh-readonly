/**
 * Authenticated, read-only query for a coordinated writeback's real
 * Safe Edit journal. Caller passes ONLY the deterministic intake Plan ID.
 * Paths, write states, readback and reindex are loaded from the server's own
 * actor-scoped operation records, never accepted from a model or vault note.
 *
 * This is NOT permission to advance to a dependent step: the caller must
 * compare receipts with a fresh source-verified plan and reviewed diff.
 */
import fs from "node:fs";
import {createHash} from "node:crypto";
import {resolveNotePath,openNoFollow} from "../vault/paths";
import {db} from "../db";
import { status } from "./engine";
import { coordinatedStageIds, type CoordinatedKind } from "../vault/investment-writeback-coordination";

export type JournalStageState =
  "not_found_or_not_owned"|"preview_pending"|"locally_verified"|
  "repair_required"|"stale_local_bytes"|"unexpected_target"|"unrecognized_state";
export interface JournalStage {
  kind:CoordinatedKind;
  operationId:string;
  path:string|null;
  state:JournalStageState;
  journalStatus:string|null;
  beforeHash:string|null;
  afterHash:string|null;
  receipt:{
    write:string|null;readback:string|null;reindex:string|null;
    remoteSync:string|null;mobileSync:string|null;
  }|null;
}
const expected=(kind:CoordinatedKind,p:string,planId:string)=>{
  if(kind==="raw_input")return p==="00_Inbox/ChatGPT/Investment Intake - "+planId+".md";
  if(kind==="research_review")return /^10_Knowledge\/(?:Company Research|Macro and Markets|Industry and Concepts)\/Investment Review - [A-Za-z0-9 ._-]+ - IN-[A-F0-9]{16}\.md$/.test(p)&&
    p.endsWith(planId+".md");
  return /^08_Daily_Weekly\/Research Indexes\/Company Evolution - [A-Z0-9._-]+\.md$/.test(p);
};
/** A completed receipt is historical evidence; inspect CURRENT stored bytes,
 * because an Obsidian peer or another authorized editor may have changed them.
 * This is read-only and fail closed on unsafe inode, missing path or bad bytes. */
function currentLocalDigestMatches(rel:string,expectedHash:string):boolean {
  if(!/^[a-f0-9]{64}$/.test(expectedHash))return false;
  let fd:number|undefined;
  try {
    fd=openNoFollow(resolveNotePath(rel));
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.size>100_000)return false;
    const content=fs.readFileSync(fd);
    if(content.length!==st.size||content.includes(0))return false;
    if(createHash("sha256").update(content).digest("hex")!==expectedHash)return false;
    const indexed=db().prepare("SELECT mtime,size FROM notes WHERE path=?")
      .get(rel) as {mtime:number;size:number}|undefined;
    // A historic reindex receipt is not proof that the current file is still
    // correctly represented in the live full-text index.
    return indexed?.size===st.size&&indexed.mtime===Math.round(st.mtimeMs);
  }catch{return false;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function inspectCoordinatedWritebackBatch(planId:string,actor:string) {
  const ids=coordinatedStageIds(planId);
  const stages:JournalStage[]=ids.map(({kind,operationId}):JournalStage=>{
    let record:ReturnType<typeof status>;
    try {record=status(operationId,actor);}
    catch(e) {
      // Do not leak another actor's operation or path. Internal errors should
      // still surface instead of masquerading as "not found".
      if(!(e instanceof Error)||!["Unknown operation","Operation belongs to another OAuth client"].includes(e.message))throw e;
      return {kind,operationId,path:null,state:"not_found_or_not_owned",
        journalStatus:null,beforeHash:null,afterHash:null,receipt:null};
    }
    const rec=record.receipt;
    const stageReceipt=rec?{
      write:typeof rec.write==="string"?rec.write:null,
      readback:typeof rec.readback==="string"?rec.readback:null,
      reindex:typeof rec.reindex==="string"?rec.reindex:null,
      remoteSync:typeof rec.remoteSync==="string"?rec.remoteSync:null,
      mobileSync:typeof rec.mobileSync==="string"?rec.mobileSync:null,
    }:null;
    const pathOK=expected(kind,record.path,planId);
    const receiptOK=rec?.path===record.path&&rec?.afterHash===record.afterHash;
    let state:JournalStageState;
    if(!pathOK||(rec&&!receiptOK))state="unexpected_target";
    else if(record.status==="preview")state="preview_pending";
    else if(record.status==="writing")state="repair_required";
    else if(record.status==="written"){
      const historic=rec?.write==="written"&&rec.readback==="verified"&&
        rec.reindex==="verified"&&/^[a-f0-9]{64}$/.test(record.afterHash);
      state=!historic?"repair_required":
        currentLocalDigestMatches(record.path,record.afterHash)?"locally_verified":"stale_local_bytes";
    }else state="unrecognized_state";
    return {kind,operationId,path:record.path,state,journalStatus:record.status,
      beforeHash:record.beforeHash,afterHash:record.afterHash,receipt:stageReceipt};
  });
  return {
    status:"actor_scoped_safe_edit_journal_inspection_only" as const,
    batchId:planId,stages,
    gates:{
      sourceIdentityChecked:false,sourceOriginalVerified:false,duplicateAdjudicated:false,
      chronologyReviewed:false,approvalGiven:false,canAutoWrite:false,
      canAutoUpdateThesis:false,
    },
    warnings:[
      "Status is retrieved from Safe Edit's actual actor-scoped journal, not a user-provided receipt.",
      "locally_verified requires prior Safe Edit write/readback/reindex, fresh local SHA-256 equality and current matching index size/mtime; remote/mobile Sync remains unverified.",
      "No dependent operation may be created or applied without a fresh matching plan, evidence review, prior-step receipt and explicit Safe Edit approval.",
      "A writing/interrupted record requires administrator investigation; never replay or automatically rollback a multi-note sequence.",
    ],
  };
}

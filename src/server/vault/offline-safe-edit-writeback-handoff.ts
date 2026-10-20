/**
 * PR #100 — Safe Edit two-note handoff CONTRACT, not an MCP/Vault writer.
 *
 * The only allowed automatic effect is PREVIEW via an injected port. The
 * existing NoteMesh Safe Edit tool requires a separately reviewed, host-
 * authorized apply_edit token for EACH write. This module never calls
 * apply_edit, sends no request to a real connector and has no endpoint.
 *
 * It rechecks PR #98 physical canonicals + PR #99 temp-only rehearsal before
 * previewing Analysis Note, then waits for a successful externally retrieved
 * durable save/readback/reindex receipt before previewing Timeline append.
 * Two separate writes are not atomic: partial failures are held for repair.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {extractStructure,splitFrontmatter}
  from "./markdown";
import {planOfflineCanonicalInvestmentAutolinks}
  from "./offline-canonical-autolink-writeback-plan";
import {rehearseOfflineSyntheticInvestmentWriteback,
  type OfflineSyntheticWritebackInput}
  from "./offline-synthetic-writeback-rehearsal";

type Evidence={
  entity:string;event:string;period:string;originalSource:string;
  classification:"unresolved";delta:string;
  independent:false;verification:"unverified";
  sourceType:"user_supplied";
  event_date:string|null;published_at:null;received_at:null;
  imported_at:null;verified_at:null;relatedPaths:string[];
};
type CreatePreview={
  operationId:string;path:string;reason:string;
  content:string;evidence:Evidence;
};
type AppendPreview={
  operationId:string;path:string;reason:string;
  heading:string;content:string;date:string;evidence:Evidence;
};
type PreviewAcknowledgement={
  operationId:string;
  previewOnly:true;
  requiresHostAuthorizedApply:true;
};
type SavedStatus={
  operationId:string;
  state:"preview_only"|"applied"|"failed";
  writeReadbackVerified:boolean;
  reindexVerified:boolean;
  expectedAfterHashMatched:boolean;
};
/**
 * An adapter for the existing Safe Edit Chat create_note, append_section and
 * get_edit_status tools. This is a NON-authenticating port, injected for
 * deterministic offline tests. A future real adapter must be constructed
 * inside an authenticated scope, normalize ACTUAL tool responses and never
 * trust model-provided flags as receipts.
 */
export type OfflineSafeEditPreviewPort={
  createNotePreview(input:CreatePreview):Promise<PreviewAcknowledgement>;
  appendSectionPreview(input:AppendPreview):Promise<PreviewAcknowledgement>;
  getEditStatus(input:{operationId:string}):Promise<SavedStatus|null>;
};
export type OfflineSafeEditHandoffInput=OfflineSyntheticWritebackInput&{
  handoff:{timelineDate:string;timelineHeading:string};
};
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const HEADING=/^#{1,4} [A-Za-z][A-Za-z0-9 _-]{1,75}$/;
const ref=(s:string)=>"[["+s.slice(0,-3)+"]]";
function validateDate(date:unknown):date is string{
  return typeof date==="string"&&DATE.test(date)&&
    !Number.isNaN(Date.parse(date+"T00:00:00.000Z"))&&
    new Date(date+"T00:00:00.000Z").toISOString().startsWith(date);
}
function checkStatus(status:SavedStatus|null,id:string){
  if(status===null)return null;
  if(!status||status.operationId!==id||
    !["preview_only","applied","failed"].includes(status.state)||
    typeof status.writeReadbackVerified!=="boolean"||
    typeof status.reindexVerified!=="boolean"||
    typeof status.expectedAfterHashMatched!=="boolean")
    throw Error("safe_edit_handoff_forged_or_mismatched_status_hold");
  if(status.state!=="applied"&&(
    status.writeReadbackVerified||status.reindexVerified||
    status.expectedAfterHashMatched))
    throw Error("safe_edit_handoff_non_applied_receipt_overclaim_hold");
  return status;
}
const completed=(r:SavedStatus|null)=>
  r?.state==="applied"&&r.writeReadbackVerified&&
  r.reindexVerified&&r.expectedAfterHashMatched;
type Stage=
  "analysis_preview_ready_awaiting_authorized_apply"|
  "analysis_preview_already_pending_authorized_apply"|
  "analysis_unverified_receipt_requires_repair"|
  "timeline_preview_ready_awaiting_authorized_apply"|
  "timeline_preview_already_pending_authorized_apply"|
  "timeline_unverified_receipt_requires_repair"|
  "two_server_save_receipts_reported_by_test_port"|
  "failed_or_out_of_order_receipts_require_manual_reconciliation";
export async function coordinateOfflineSyntheticSafeEditHandoff(
  input:OfflineSafeEditHandoffInput,port:OfflineSafeEditPreviewPort,
){
  if(!input||!input.handoff||
    !validateDate(input.handoff.timelineDate)||
    typeof input.handoff.timelineHeading!=="string"||
    !HEADING.test(input.handoff.timelineHeading)||
    !port||typeof port.createNotePreview!=="function"||
    typeof port.appendSectionPreview!=="function"||
    typeof port.getEditStatus!=="function")
    throw Error("safe_edit_handoff_invalid_stage_or_port_hold");
  // First-stage checks must be recomputed from exact synthetic bytes,
  // not an externally asserted "approved" or "links verified" boolean.
  const routing=planOfflineCanonicalInvestmentAutolinks(input);
  const rehearsal=rehearseOfflineSyntheticInvestmentWriteback(input);
  if(!rehearsal.sandboxReadbackVerified||
    !rehearsal.sandboxMarkdownSqliteFtsReconciled||
    rehearsal.productionVaultWritten!==false)
    throw Error("safe_edit_handoff_offline_rehearsal_failed_hold");
  const route=input.routing;
  const timeline=route.targets.find(t=>t.role==="company_evolution");
  const issuer=input.claims[0].candidate.source.review.evidence.incoming.entity;
  const event=input.claims[0].candidate.source.review.evidence.incoming;
  if(!timeline||issuer!=="SYNTH")
    throw Error("safe_edit_handoff_fixture_and_timeline_required");
  const src=path.join(
    event && input.claims[0].candidate.source.review.evidence.snapshotRoot,
    "vault",...timeline.path.split("/"));
  const history=fs.readFileSync(src,"utf8");
  if(hash(history)!==timeline.expectedSha256)
    throw Error("safe_edit_handoff_timeline_changed_hold");
  const heading=input.handoff.timelineHeading;
  const sections=extractStructure(splitFrontmatter(history).body).headings;
  const noMarker=heading.replace(/^#+ /,"");
  if(!sections.some(x=>x.text===noMarker&&
    x.level===heading.indexOf(" ")))
    throw Error("safe_edit_handoff_append_heading_missing_hold");
  const op=route.operationId;
  const analysisOp=op+"-analysis",timelineOp=op+"-timeline";
  if(analysisOp.length>128||timelineOp.length>128)
    throw Error("safe_edit_handoff_operation_id_limit_hold");
  const [analysisState,timelineState]=await Promise.all([
    port.getEditStatus({operationId:analysisOp}),
    port.getEditStatus({operationId:timelineOp}),
  ]);
  const first=checkStatus(analysisState,analysisOp);
  const second=checkStatus(timelineState,timelineOp);
  const evidence:Evidence={
    entity:issuer,event:event.eventKey??"unresolved",
    period:event.period??"unresolved",
    originalSource:event.sourceUrl??"unresolved",
    classification:"unresolved",
    delta:"Synthetic study only; no issuer fact verified.",
    independent:false,verification:"unverified",
    sourceType:"user_supplied",
    event_date:event.eventDate??null,
    published_at:null,received_at:null,imported_at:null,
    verified_at:null,relatedPaths:route.targets.map(t=>t.path),
  };
  const marker="<!-- investment-os-operation:"+op+" -->";
  const eventMarker="<!-- investment-os-event:"+event.eventKey+" -->";
  const analysisText=[
    "---","type: investment_review","entity: "+issuer,
    "event_key: "+event.eventKey,"status: draft",
    "verification: not_reverified","source_type: archived_ai",
    "analysis_origin: synthetic_ai_draft",
    "operation_id: "+op,"---",
    "# Synthetic Investment Review",marker,eventMarker,
    "No issuer claims or AI conclusions independently verified.",
    "## Canonical References",
    ...route.targets.map(t=>ref(t.path)),
    "## Thesis Review",
    "Revenue conversion is a hypothetical review topic, not a verified fact.",
    "Unverified reasoning requires an analyst and owner decision.","",
  ].join("\n");
  const appendText=[
    marker,eventMarker,
    "- "+ref(route.proposedAnalysisNotePath)+
      " — unverified synthetic review; no protected Thesis edit.",
  ].join("\n");
  const summary=(stage:Stage,previewIssued:boolean)=>({
    status:"offline_synthetic_safe_edit_handoff_not_authorized" as const,
    stage,operationRootHash:routing.operationIdSha256,
    sourceSnapshotHash:routing.sourceSnapshotSha256,
    previewIssued,
    expectedStages:2 as const,
    firstOperationIdHash:hash(analysisOp),
    secondOperationIdHash:hash(timelineOp),
    approvedSourceFacts:false as const,
    originalSourceAuthenticated:false as const,
    modelInvestmentReasoningPerformed:false as const,
    hostAuthorizationObtainedInThisFunction:false as const,
    appliedByThisFunction:false as const,
    realSaveReceiptsIndependentlyVerified:false as const,
    reportedStatusIsTestPortOnly:true as const,
    protectedThesisOrEvidenceRegisterModified:false as const,
    realVaultModified:false as const,
    productionReleaseAllowed:false as const,
    crossDeviceObsidianSyncVerified:false as const,
    twoNoteAtomicityEstablished:false as const,
    noteContentsOrPathsReturned:false as const,
  });
  // Never preview or apply the second change before first durable status.
  if(!completed(first)){
    if(second!==null)
      return summary("failed_or_out_of_order_receipts_require_manual_reconciliation",false);
    if(first?.state==="failed"||
      first?.state==="applied")
      return summary("analysis_unverified_receipt_requires_repair",false);
    if(first?.state==="preview_only")
      return summary("analysis_preview_already_pending_authorized_apply",false);
    const request:CreatePreview={
      operationId:analysisOp,path:route.proposedAnalysisNotePath,
      reason:"Synthetic unverified investment analysis index, source linked",
      content:analysisText,evidence,
    };
    const ack=await port.createNotePreview(request);
    if(!ack||ack.operationId!==analysisOp||
      ack.previewOnly!==true||ack.requiresHostAuthorizedApply!==true)
      throw Error("safe_edit_handoff_create_preview_not_acknowledged_hold");
    return summary("analysis_preview_ready_awaiting_authorized_apply",true);
  }
  if(!completed(second)){
    if(second?.state==="failed"||second?.state==="applied")
      return summary("timeline_unverified_receipt_requires_repair",false);
    if(second?.state==="preview_only")
      return summary("timeline_preview_already_pending_authorized_apply",false);
    const request:AppendPreview={
      operationId:timelineOp,path:timeline.path,heading,
      content:appendText,date:input.handoff.timelineDate,
      reason:"Append only an unverified synthetic analysis event link",
      evidence,
    };
    const ack=await port.appendSectionPreview(request);
    if(!ack||ack.operationId!==timelineOp||
      ack.previewOnly!==true||ack.requiresHostAuthorizedApply!==true)
      throw Error("safe_edit_handoff_append_preview_not_acknowledged_hold");
    return summary("timeline_preview_ready_awaiting_authorized_apply",true);
  }
  return summary("two_server_save_receipts_reported_by_test_port",false);
}

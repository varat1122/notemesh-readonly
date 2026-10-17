/**
 * P1a: read-only, deterministic handoff from intake routing to separately
 * authorized Safe Edit operations. This module NEVER calls preview/apply.
 *
 * Every transition after preview MUST be backed by get_edit_status obtained
 * by the same OAuth actor, never by a caller-provided "success" flag.
 * There is no atomic multi-note transaction; interrupted writes are held.
 */
export type CoordinatedKind = "raw_input"|"research_review"|"company_timeline_candidate";
export type StageAction = "preview_create"|"preview_append"|"inspect_existing"|"hold";
export type StageState = "ready_for_preview"|"awaiting_dependency"|"awaiting_approval"|
  "applied_verified"|"hold"|"inspect_existing"|"repair_required"|"conflict";

export interface CoordinatorInput {
  planId:string;
  inputFormat:"text"|"screenshot"|"pdf"|"mixed";
  rawAttachmentVerified:boolean;
  eventDate:string|null;
  duplicateCandidate:boolean;
  duplicateAdjudicated:boolean;
  sourceIndependenceVerified:boolean;
  routes:ReadonlyArray<{kind:string;action:string;path:string|null}>;
}
export interface CoordinatedStage {
  kind:CoordinatedKind;
  operationId:string;
  path:string|null;
  action:StageAction;
  dependsOn:string[];
  holdReasons:string[];
}
export interface CoordinatedWriteback {
  status:"read_only_coordination_not_written";
  batchId:string;
  steps:CoordinatedStage[];
  durability:"safe_edit_receipts_required";
  retries:"reuse_operation_id_and_query_existing_receipt_never_blindly_reapply";
  partialFailure:"halt_and_propose_verified_repair_no_automatic_rollback";
  sync:"local_readback_and_reindex_only_remote_and_mobile_unverified";
  sourceAndReviewSeparate:true;
  protectedThesisWrites:false;
}
// Safe Edit returns this shape from get_edit_status. It must be collected
// from the authorized server under the SAME actor; no MCP input accepts it.
export interface TrustedEditStatus {
  operationId:string;
  path:string;
  status:string;
  afterHash:string;
  receipt:null|{
    path?:string;afterHash?:string;write?:string;readback?:string;
    reindex?:string;remoteSync?:string;mobileSync?:string;
  };
}
export interface StageObservation {
  operationId:string;
  path:string|null;
  state:StageState;
  reason:string;
}
const stageId=(batchId:string,kind:CoordinatedKind)=>
  "ios_"+batchId.toLowerCase().replace(/[^a-z0-9_-]/g,"")+"_"+(
    kind==="raw_input"?"raw":kind==="research_review"?"review":"timeline")+"_v1";
/** Stable batch stage identifiers; read-only Safe Edit receipt inspector uses exactly these. */
export function coordinatedStageIds(planId:string):Array<{kind:CoordinatedKind;operationId:string}> {
  if(!/^IN-[A-F0-9]{16}$/.test(planId))throw Error("Invalid server-issued coordination plan ID");
  return (["raw_input","research_review","company_timeline_candidate"] as const)
    .map(kind=>({kind,operationId:stageId(planId,kind)}));
}
const route=(input:CoordinatorInput,kind:CoordinatedKind)=>
  input.routes.find(r=>r.kind===kind);

export function buildCoordinatedWriteback(input:CoordinatorInput):CoordinatedWriteback {
  if(!/^IN-[A-F0-9]{16}$/.test(input.planId))
    throw Error("Only deterministic, server-issued writeback plan IDs are supported");
  const raw=route(input,"raw_input");
  const review=route(input,"research_review");
  if(!raw?.path||!review?.path)
    throw Error("Source and separate AI review routes are both required");
  const batchId=input.planId;
  const rawId=stageId(batchId,"raw_input"),reviewId=stageId(batchId,"research_review");
  const originalRequired=input.inputFormat!=="text";
  const rawReasons=originalRequired&&!input.rawAttachmentVerified?
    ["original_user_binary_not_sha_readback_verified"]:[];
  const timeline=route(input,"company_timeline_candidate");
  const timelineReasons:string[]=[];
  if(timeline) {
    if(!input.eventDate) timelineReasons.push("economic_event_date_unknown");
    if(input.duplicateCandidate)timelineReasons.push("exact_claim_duplicate_candidate_link_dont_recreate");
    if(!input.duplicateAdjudicated)timelineReasons.push("historical_event_and_source_family_dedup_not_adjudicated");
    if(!input.sourceIndependenceVerified)timelineReasons.push("original_source_not_independently_verified");
    if(timeline.action==="link_existing_or_hold")timelineReasons.push("timeline_missing_or_existing_claim_requires_review");
  }
  const mk=(kind:CoordinatedKind,path:string|null,dependsOn:string[],
    sourceAction:string,reasons:string[]):CoordinatedStage=>{
    // A path found by a bounded lexical search is not permission to update.
    const action:StageAction=reasons.length?"hold":
      sourceAction==="candidate_create"?"preview_create":
      sourceAction==="candidate_append_after_review"?"preview_append":
      "inspect_existing";
    return {kind,operationId:stageId(batchId,kind),path,dependsOn,
      action,holdReasons:reasons};
  };
  const steps:CoordinatedStage[]=[
    mk("raw_input",raw.path,[],raw.action,rawReasons),
    mk("research_review",review.path,[rawId],review.action,[]),
  ];
  if(timeline)steps.push(mk("company_timeline_candidate",timeline.path,
    [rawId,reviewId],timeline.action,timelineReasons));
  return {
    status:"read_only_coordination_not_written",batchId,steps,
    durability:"safe_edit_receipts_required",
    retries:"reuse_operation_id_and_query_existing_receipt_never_blindly_reapply",
    partialFailure:"halt_and_propose_verified_repair_no_automatic_rollback",
    sync:"local_readback_and_reindex_only_remote_and_mobile_unverified",
    sourceAndReviewSeparate:true,protectedThesisWrites:false,
  };
}

/**
 * Pure, fail-closed recovery decision from ACTUAL actor-scoped Safe Edit
 * statuses. No status here is allowed to authorize apply: preview tokens,
 * beforeHash, OAuth permission and explicit diff approval stay in Safe Edit.
 *
 * This function intentionally reports conflicts instead of reapplying a
 * partially published note or treating an existing pathname as identity.
 */
export function reconcileCoordinatedWriteback(
  plan:CoordinatedWriteback,statuses:ReadonlyArray<TrustedEditStatus>,
):StageObservation[] {
  const seen=new Set<string>(),index=new Map<string,TrustedEditStatus>();
  const repeated=new Set<string>();
  for(const value of statuses) {
    if(seen.has(value.operationId))repeated.add(value.operationId);
    seen.add(value.operationId);
    index.set(value.operationId,value);
  }
  const outcome=new Map<string,StageObservation>();
  for(const step of plan.steps){
    let state:StageState="ready_for_preview",reason="preview_exact_diff_with_authorized_safe_edit";
    const record=index.get(step.operationId);
    if(repeated.has(step.operationId)){state="conflict";reason="duplicate_operation_receipts";}
    else if(record&&(record.path!==step.path||record.receipt?.path&&record.receipt.path!==step.path)){
      state="conflict";reason="receipt_target_path_mismatch";
    }
    else if(record&&record.receipt?.afterHash&&record.receipt.afterHash!==record.afterHash){
      state="conflict";reason="receipt_after_hash_mismatch";
    }
    else if(record?.status==="writing"||record?.receipt?.write==="written"&&record.status!=="written"){
      state="repair_required";reason="possibly_published_interrupted_safe_edit_never_replay";
    }
    else if(record?.status==="written"){
      if(record.receipt?.write==="written"&&record.receipt.readback==="verified"&&
        record.receipt.reindex==="verified"&&/^[a-f0-9]{64}$/.test(record.afterHash)){
        state="applied_verified";reason="actor_scoped_write_readback_reindex_receipt";
      }else {state="repair_required";reason="write_record_lacks_verified_local_readback_or_index";}
    }
    else if(record?.status==="preview"){
      if(step.holdReasons.length||step.action==="hold"){
        state="hold";reason=step.holdReasons.join(",")||"guarded_route_cannot_be_applied";
      }else if(step.action==="inspect_existing"){
        state="conflict";reason="preview_attempted_for_existing_identity_not_verified";
      }else if(step.dependsOn.some(id=>outcome.get(id)?.state!=="applied_verified")){
        state="awaiting_dependency";reason="preview_exists_but_dependency_not_locally_verified";
      }else {
        state="awaiting_approval";reason="review_diff_and_apply_token_required";
      }
    }
    else if(record){state="conflict";reason="unexpected_safe_edit_journal_state";}
    else if(step.holdReasons.length){state="hold";reason=step.holdReasons.join(",");}
    else if(step.action==="inspect_existing"){state="inspect_existing";reason="existing_path_requires_source_digest_and_identity_review";}
    else if(step.action==="hold"){state="hold";reason="guarded_route_cannot_be_applied";}
    else if(step.dependsOn.some(id=>outcome.get(id)?.state!=="applied_verified")){
      state="awaiting_dependency";reason="prior_source_or_review_receipt_not_locally_verified";
    }
    // Even a verified write performed out-of-order or while a safety gate was
    // closed must be escalated, rather than legitimized retroactively.
    if(state==="applied_verified"&&
      (step.holdReasons.length||step.dependsOn.some(id=>outcome.get(id)?.state!=="applied_verified"))){
      state="conflict";reason="write_violated_source_or_dependency_gate";
    }
    const result={operationId:step.operationId,path:step.path,state,reason};
    outcome.set(step.operationId,result);
  }
  return [...outcome.values()];
}

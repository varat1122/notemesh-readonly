/**
 * PR #93 — conservative OFFLINE structured-evidence override for PR #92.
 *
 * Always keeps every unverified semantic finding in a visible review queue.
 * Recomputes PR #84's structured classification from supplied SYNTH claims
 * instead of trusting an analyst/model-supplied "duplicate" label.
 *
 * Declared offline snapshot metadata is NOT independent proof of coverage,
 * publisher authenticity, semantic truth, owner permission or a safe write.
 * No network, Vault access, model inference or production integration.
 */
import {classifyHistoricalClaim,
  type ClaimEvidence,type HistoricalClassification}
  from "./historical-change-classifier";
import {buildOfflineExceptionReviewQueue}
  from "./offline-exception-review-queue";

type Packet=Parameters<typeof buildOfflineExceptionReviewQueue>[0];
export type OfflineEvidenceCheck={
  interpretationIndex:number;
  incoming:ClaimEvidence;
  priorClaims:ClaimEvidence[];
  scope:{
    scannedNotes:number;
    completeIndexScan:boolean;
    /** Claimed physical snapshot fingerprint, not independent verification. */
    snapshotSha256:string;
    /** False/unknown means hold, not a successful empty historical search. */
    snapshotCurrent:boolean;
  };
};
export type OfflineTriageInput={
  packet:Packet;
  checks:OfflineEvidenceCheck[];
};
type HistoryStatus=HistoricalClassification|"unresolved_scope_hold";
const SHA=/^[a-f0-9]{64}$/;
const RELATIONS=[
  "confirmation_candidate","incremental_candidate","duplicate_candidate",
  "contradiction_candidate","thesis_changing_hypothesis","unresolved",
] as const;
const DIRECTIONS=["supports","challenges","unclear"] as const;
const normalized=(v:string|null)=>typeof v==="string"?
  v.trim().normalize("NFC").toLowerCase():"";
const same=(a:ClaimEvidence,b:ClaimEvidence,fields:
  Array<keyof ClaimEvidence>)=>fields.every(k=>
  normalized(a[k])===normalized(b[k]));
const sourceHash=(s:string|null)=>!!s&&SHA.test(s);

/** A changed declared source hash must override even another exact match. */
function hasSameUrlRevision(a:ClaimEvidence,prior:ClaimEvidence[]){
  return prior.some(p=>sourceHash(a.originalSourceSha256)&&
    sourceHash(p.originalSourceSha256)&&
    a.originalSourceSha256!==p.originalSourceSha256&&
    !!normalized(a.sourceUrl)&&
    normalized(a.sourceUrl)===normalized(p.sourceUrl)&&
    same(a,p,["entity","eventKey","metric","period","unit"]));
}
/** A numeric literal from another financial period is never period proof. */
function hasCrossPeriodValue(a:ClaimEvidence,prior:ClaimEvidence[]){
  return prior.some(p=>!!normalized(a.period)&&!!normalized(p.period)&&
    normalized(a.period)!==normalized(p.period)&&
    same(a,p,["entity","metric","unit","value"]));
}

export function buildOfflineEvidenceSafeTriage(input:OfflineTriageInput){
  if(!input||!Array.isArray(input.checks)||
    input.checks.length<1||input.checks.length>6)
    throw Error("evidence_triage_unbounded_or_missing_checks_hold");
  const base=buildOfflineExceptionReviewQueue(input.packet);
  const original=[...base.ownerPriority,...base.analystReview];
  if(input.checks.length!==original.length)
    throw Error("evidence_triage_missing_case_no_silent_drop_hold");
  const checkByIndex=new Map<number,OfflineEvidenceCheck>();
  for(const check of input.checks){
    if(!check||!Number.isSafeInteger(check.interpretationIndex)||
      check.interpretationIndex<0||
      checkByIndex.has(check.interpretationIndex)||
      !Array.isArray(check.priorClaims)||check.priorClaims.length>200||
      !check.scope||!Number.isSafeInteger(check.scope.scannedNotes)||
      check.scope.scannedNotes<0||
      typeof check.scope.completeIndexScan!=="boolean"||
      typeof check.scope.snapshotCurrent!=="boolean"||
      typeof check.scope.snapshotSha256!=="string"||
      (check.scope.snapshotSha256.length>128))
      throw Error("evidence_triage_invalid_or_unbounded_check_hold");
    checkByIndex.set(check.interpretationIndex,check);
  }
  const tasks=original.map(t=>{
    const check=checkByIndex.get(t.interpretationIndex);
    if(!check)
      throw Error("evidence_triage_cross_case_or_missing_check_hold");
    if(!RELATIONS.includes(t.proposedRelation)||
      !DIRECTIONS.includes(t.proposedDirection))
      throw Error("evidence_triage_forged_semantic_label_hold");
    const stale=!SHA.test(check.scope.snapshotSha256)||
      check.scope.snapshotSha256!==base.snapshotSha256||
      check.scope.snapshotCurrent!==true;
    const incomplete=check.scope.completeIndexScan!==true;
    let historicalClassification:HistoryStatus="unresolved_scope_hold";
    let historicalReasonCodes:string[]=[];
    if(!stale&&!incomplete){
      // PR #84 can still say no-match only within this declared scan scope.
      const comparison=classifyHistoricalClaim(check.incoming,
        check.priorClaims,check.scope);
      historicalClassification=comparison.classification;
      historicalReasonCodes=comparison.reasonCodes;
    }
    const revised=hasSameUrlRevision(check.incoming,check.priorClaims);
    const crossPeriod=hasCrossPeriodValue(check.incoming,check.priorClaims);
    const duplicate=t.proposedRelation==="duplicate_candidate";
    const disputed=historicalClassification===
      "possible_correction_or_contradiction";
    const conflictingDuplicate=duplicate&&
      historicalClassification!=="duplicate_exact_metadata_same_source";
    const high=t.priority===1||stale||incomplete||disputed||revised||
      (duplicate&&crossPeriod)||conflictingDuplicate;
    const hardeningReasons:string[]=[];
    if(stale)hardeningReasons.push("stale_or_unverified_snapshot_hold");
    if(incomplete)hardeningReasons.push("incomplete_bounded_index_hold");
    if(disputed)hardeningReasons.push(
      "structured_numerical_conflict_priority_review");
    if(revised)hardeningReasons.push(
      "same_url_different_declared_source_sha_revision_check");
    if(crossPeriod)hardeningReasons.push(
      "same_numeric_value_different_period_not_duplicate");
    if(conflictingDuplicate)hardeningReasons.push(
      "model_duplicate_disagrees_with_structured_history");
    if(duplicate&&historicalClassification===
      "duplicate_exact_metadata_same_source")
      hardeningReasons.push("metadata_duplicate_not_verified_fact");
    const queue=high?"owner_priority_unverified":
      duplicate?"analyst_duplicate_check":"analyst_evidence_check";
    return {
      interpretationIndex:t.interpretationIndex,
      queue,
      priority:high?1 as const:2 as const,
      proposedRelation:t.proposedRelation,
      proposedDirection:t.proposedDirection,
      historicalClassification,
      // Codes are computed locally by deterministic code, not echoed text.
      reasonCodes:[...new Set([...t.reasonCodes,...historicalReasonCodes,
        ...hardeningReasons])],
      status:"unverified_declared_offline_metadata_only" as const,
      canDismissWithoutReview:false as const,
      actionableOwnerInvestmentDecision:false as const,
      protectedTextReturned:false as const,
    };
  });
  tasks.sort((a,b)=>a.priority-b.priority||
    a.interpretationIndex-b.interpretationIndex);
  const ownerPriority=tasks.filter(t=>t.queue==="owner_priority_unverified");
  const analystReview=tasks.filter(t=>t.queue!=="owner_priority_unverified");
  return {
    status:"offline_evidence_safe_exception_candidates_only" as const,
    snapshotSha256:base.snapshotSha256,
    ownerPriority,analystReview,
    count:{
      total:tasks.length,
      ownerPriority:ownerPriority.length,
      analystReview:analystReview.length,
      duplicateCandidatesRetained:tasks.filter(t=>
        t.proposedRelation==="duplicate_candidate").length,
      escalatedFromAnalystToOwner:tasks.filter(t=>
        t.queue==="owner_priority_unverified"&&original.some(o=>
          o.interpretationIndex===t.interpretationIndex&&o.priority===2))
        .length,
      automaticallyDiscarded:0 as const,
      automaticallyWritten:0 as const,
    },
    declaredOfflineSnapshotIsNotIndependentCoverageProof:true as const,
    publisherAuthenticityVerified:false as const,
    factOrSemanticTruthEstablished:false as const,
    actualVaultReadOrWriteByThisFunction:false as const,
    independentOwnerAuthorizationPresent:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    duplicateSuppressionEnabled:false as const,
    productionReleaseAllowed:false as const,
  };
}

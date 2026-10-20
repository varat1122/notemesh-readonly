/**
 * PR #92 — offline, deterministic review-by-exception triage.
 *
 * Consumes the UNVERIFIED, reference-validated analyst proposal packet
 * from PR #89. It does not call a model or grant human approval.
 *
 * Crucial invariant: "duplicate_candidate" NEVER means a headline is
 * safe to delete, silence, discard or count as verified duplicate.
 * Every candidate remains visible to the analyst queue.
 */
import type {judgeOfflineThesisSemanticDraft}
  from "./offline-semantic-thesis-judge";

type SemanticPacket=ReturnType<typeof judgeOfflineThesisSemanticDraft>;
type Finding=SemanticPacket["findings"][number];
const SHA=/^[a-f0-9]{64}$/;
type Queue="owner_priority_unverified"|"analyst_duplicate_check"|
  "analyst_evidence_check";

function reasonCodes(f:Finding):string[]{
  const reasons:string[]=[];
  if(f.modelProposedRelation==="contradiction_candidate")
    reasons.push("possible_conflict_with_historical_evidence");
  if(f.modelProposedRelation==="thesis_changing_hypothesis")
    reasons.push("possible_investment_thesis_reassessment");
  if(f.modelProposedDirection==="challenges")
    reasons.push("proposed_challenge_to_existing_assumption");
  if(f.modelProposedRelation==="duplicate_candidate")
    reasons.push("duplicate_is_only_a_candidate_never_silence_or_drop");
  if(f.citedHistoricalCounterEvidence.length===0)
    reasons.push("counterevidence_not_yet_cited");
  if(f.citedHistoricalSupport.some(e=>
    e.independence!=="not_assessed"))
    reasons.push("derivative_or_archived_ai_evidence_is_not_independent");
  if(f.evidenceGaps.length>0)
    reasons.push("primary_source_or_economic_mechanism_still_unverified");
  return reasons;
}
export function buildOfflineExceptionReviewQueue(packet:SemanticPacket){
  if(!packet||packet.status!=="unverified_offline_semantic_review_candidates_only"||
    !SHA.test(packet.sourceSnapshotSha256)||
    !SHA.test(packet.thesisSha256)||
    packet.ownerApprovalGranted!==false||
    packet.canAutoWrite!==false||
    packet.canAutoUpdateThesis!==false||
    packet.vaultModified!==false||
    packet.independentSemanticVerificationPerformed!==false||
    packet.originalIssuerSourceChecked!==false||
    !Array.isArray(packet.findings)||packet.findings.length===0||
    packet.findings.length>6)
    throw Error("review_queue_untrusted_or_overprivileged_packet_hold");
  const indices=new Set<number>();
  const tasks=packet.findings.map(f=>{
    if(!f||!Number.isSafeInteger(f.interpretationIndex)||
      f.interpretationIndex<0||indices.has(f.interpretationIndex)||
      f.semanticClaimVerified!==false||f.thesisImpactEstablished!==false||
      !Array.isArray(f.citedThesisLines)||f.citedThesisLines.length===0||
      !Array.isArray(f.citedHistoricalSupport)||
      f.citedHistoricalSupport.length===0||
      !Array.isArray(f.citedHistoricalCounterEvidence)||
      !Array.isArray(f.evidenceGaps)||f.evidenceGaps.length===0)
      throw Error("review_queue_missing_grounding_or_unverified_flags_hold");
    indices.add(f.interpretationIndex);
    const material=f.modelProposedRelation==="contradiction_candidate"||
      f.modelProposedRelation==="thesis_changing_hypothesis"||
      f.modelProposedDirection==="challenges";
    const queue:Queue=material?"owner_priority_unverified":
      f.modelProposedRelation==="duplicate_candidate"?
        "analyst_duplicate_check":"analyst_evidence_check";
    return {
      interpretationIndex:f.interpretationIndex,
      queue,
      priority:material?1 as const:2 as const,
      proposedRelation:f.modelProposedRelation,
      proposedDirection:f.modelProposedDirection,
      reasonCodes:reasonCodes(f),
      thesisQuoteCount:f.citedThesisLines.length,
      historicalSupportCount:f.citedHistoricalSupport.length,
      historicalCounterEvidenceCount:f.citedHistoricalCounterEvidence.length,
      evidenceGapCount:f.evidenceGaps.length,
      // Deliberately omit protected Thesis text, historical quotes, file
      // paths, model free-form content and any identifying source URL.
      protectedTextReturned:false as const,
      modelProposedRelationNotVerified:true as const,
      canDismissWithoutReview:false as const,
      actionableOwnerInvestmentDecision:false as const,
    };
  });
  tasks.sort((a,b)=>a.priority-b.priority||
    a.interpretationIndex-b.interpretationIndex);
  const ownerPriority=tasks.filter(t=>t.queue==="owner_priority_unverified");
  const analystReview=tasks.filter(t=>t.queue!=="owner_priority_unverified");
  const duplicates=tasks.filter(t=>t.queue==="analyst_duplicate_check");
  return {
    status:"offline_unverified_review_tasks_not_owner_approval" as const,
    company:packet.company,
    snapshotSha256:packet.sourceSnapshotSha256,
    thesisSha256:packet.thesisSha256,
    ownerPriority,
    analystReview,
    count:{
      total:tasks.length,
      ownerPriority:ownerPriority.length,
      analystReview:analystReview.length,
      duplicateCandidatesRequiringHumanAnalystCheck:duplicates.length,
      automaticallyDiscarded:0 as const,
      automaticallyWritten:0 as const,
    },
    // Owner attention is just a queue proposal. No actual owner identity or
    // independent permission check exists in this codepath.
    verifiedOwnerAttentionDelivered:false as const,
    duplicateSuppressionEnabled:false as const,
    userApprovalRequiredForThesisWrites:true as const,
    independentOwnerAuthorizationPresent:false as const,
    completePrimarySourceReview:false as const,
    semanticTruthEstablished:false as const,
    actualVaultReadOrWriteByThisFunction:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    ownerApprovalGranted:false as const,
    productionReleaseAllowed:false as const,
  };
}

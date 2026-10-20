/**
 * PR #94 — offline-only, synthetic-fixture orchestration.
 *
 * Runs PR #89, which re-executes the physical snapshot / indexed history,
 * narrative context, evidence citations and selected Thesis-line crosswalk
 * from PRs #84-88; then PR #92 exception routing. Independently reruns the
 * physical structured classifier and final snapshot reconciliation so a
 * caller-supplied "duplicate" cannot override observed historical context.
 *
 * PR #93's standalone caller-declared check is deliberately NOT used as
 * physical evidence: its snapshotCurrent/priors are not independently
 * authenticated. The physical readback here is the stronger gate.
 *
 * No model call, HTTP/MCP endpoint, Vault production operation, consent,
 * original issuer verification, semantic verdict, notification or writes.
 */
import {judgeOfflineThesisSemanticDraft,
  type OfflineSemanticReviewInput} from "./offline-semantic-thesis-judge";
import {buildOfflineExceptionReviewQueue}
  from "./offline-exception-review-queue";
import {reviewHistoricalChangeOffline}
  from "./offline-historical-change-review";
import {verifyOfflineSnapshotCoverage}
  from "./snapshot-coverage-acceptance";

const SHA=/^[a-f0-9]{64}$/;
const RELATIONS=[
  "confirmation_candidate","incremental_candidate","duplicate_candidate",
  "contradiction_candidate","thesis_changing_hypothesis","unresolved",
] as const;
const DIRECTIONS=["supports","challenges","unclear"] as const;
export type OfflineSyntheticPipelineInput={
  /** Caller declaration for test isolation; NOT actual authorization. */
  fixtureKind:"synthetic_offline_test_only";
  candidate:OfflineSemanticReviewInput;
};
export function runOfflineSyntheticInvestmentPipeline(
  input:OfflineSyntheticPipelineInput,
){
  if(!input||input.fixtureKind!=="synthetic_offline_test_only"||
    !input.candidate?.source?.review?.evidence)
    throw Error("synthetic_pipeline_explicit_offline_fixture_required");
  const evidence=input.candidate.source.review.evidence;
  if(!SHA.test(evidence.expectedMarkdownManifestSha256))
    throw Error("synthetic_pipeline_invalid_expected_snapshot_hash");

  // #89 re-executes #88 -> #87 -> #86 -> #84/#85, verifying
  // exact file bytes, FTS/index agreement, selection lines and references.
  // This returns untrusted hypotheses; do not expose its private excerpts.
  const judged=judgeOfflineThesisSemanticDraft(input.candidate);
  const proposedQueue=buildOfflineExceptionReviewQueue(judged);

  // Recompute #84 directly from the physically reconciled offline
  // SQLite/Markdown snapshot. Do not accept #93 caller-provided priorClaims
  // or snapshotCurrent flags as independent evidence.
  const observed=reviewHistoricalChangeOffline({
    snapshotRoot:evidence.snapshotRoot,
    expectedMarkdownManifestSha256:evidence.expectedMarkdownManifestSha256,
    incoming:evidence.incoming,
  });
  if(observed.scope.physicalMarkdownManifestSha256!==
    judged.sourceSnapshotSha256||
    observed.scope.allIndexRowsEnumerated!==true||
    observed.status!=="offline_structured_historical_comparison_needs_review")
    throw Error("synthetic_pipeline_history_semantic_manifest_mismatch_hold");

  const final=verifyOfflineSnapshotCoverage(evidence.snapshotRoot);
  if(final.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
    final.markdownContentManifestSha256!==judged.sourceSnapshotSha256)
    throw Error("synthetic_pipeline_snapshot_changed_after_review_hold");

  const current=[...proposedQueue.ownerPriority,
    ...proposedQueue.analystReview];
  if(current.length!==judged.findings.length||
    current.length<1||current.length>6)
    throw Error("synthetic_pipeline_queue_cardinality_hold");

  const historical=observed.classification;
  const noReliableHistory=historical==="unresolved_missing_structured_fields"||
    historical==="not_found_in_scanned_snapshot"||
    historical==="historical_archived_ai_mention_only";
  const conflict=historical==="possible_correction_or_contradiction";
  const incompleteStructured=observed.scope.incompleteStructuredClaims>0;
  const tasks=current.map(t=>{
    if(!RELATIONS.includes(t.proposedRelation)||
      !DIRECTIONS.includes(t.proposedDirection)||
      !Number.isSafeInteger(t.interpretationIndex))
      throw Error("synthetic_pipeline_forged_candidate_label_hold");
    const duplicate=t.proposedRelation==="duplicate_candidate";
    const relationDisagrees=duplicate&&
      historical!=="duplicate_exact_metadata_same_source";
    const sourceVersion=duplicate&&
      historical==="same_value_new_source_not_corroborated";
    const differentEvent=duplicate&&
      historical==="related_claim_different_or_missing_event_key";
    const priority=t.priority===1||conflict||relationDisagrees||
      (duplicate&&incompleteStructured);
    const codes:string[]=[...t.reasonCodes,
      ...observed.comparison.reasonCodes];
    if(conflict)codes.push("physically_indexed_numeric_conflict_hold");
    if(relationDisagrees)codes.push(
      "duplicate_label_not_supported_by_reconciled_history");
    if(sourceVersion)codes.push("changed_source_version_requires_review");
    if(differentEvent)codes.push("different_event_or_period_not_duplicate");
    if(duplicate&&incompleteStructured)
      codes.push("legacy_structured_claim_gaps_require_review");
    if(noReliableHistory)
      codes.push("historical_coverage_cannot_prove_novelty_or_duplicate");
    if(historical==="duplicate_exact_metadata_same_source")
      codes.push("exact_metadata_duplicate_not_source_truth");
    return {
      interpretationIndex:t.interpretationIndex,
      queue:priority?"owner_priority_unverified" as const:
        duplicate?"analyst_duplicate_check" as const:
          "analyst_evidence_check" as const,
      priority:priority?1 as const:2 as const,
      proposedRelation:t.proposedRelation,
      historicalClassification:historical,
      reasonCodes:[...new Set(codes)],
      // No quote, note path, URL, claim value, model prose or free-text
      // source data in this owner-facing REVIEW CANDIDATE envelope.
      privateSourceContentsIncluded:false as const,
      verifiedDecision:false as const,
      canDismissWithoutReview:false as const,
    };
  });
  tasks.sort((a,b)=>a.priority-b.priority||
    a.interpretationIndex-b.interpretationIndex);
  const ownerPriority=tasks.filter(t=>t.queue==="owner_priority_unverified");
  const analystReview=tasks.filter(t=>t.queue!=="owner_priority_unverified");
  if(ownerPriority.length+analystReview.length!==current.length)
    throw Error("synthetic_pipeline_candidate_loss_hold");

  return {
    status:"synthetic_offline_read_only_review_candidates" as const,
    sourceSnapshotSha256:judged.sourceSnapshotSha256,
    stages:{
      physicalMarkdownSqliteFtsReconciled:true as const,
      structuredHistoryCompared:true as const,
      narrativeLexicalRecallExecuted:true as const,
      selectedThesisLineHashesRechecked:true as const,
      callerCitationMembershipChecked:true as const,
      semanticOrEconomicTruthIndependentlyVerified:false as const,
      exceptionQueueBuilt:true as const,
      finalSnapshotRechecked:true as const,
    },
    historicalClassification:historical,
    scope:{
      scannedIndexedNotes:observed.scope.scannedIndexedNotes,
      incompleteStructuredClaims:observed.scope.incompleteStructuredClaims,
      notesWithoutStructuredClaims:observed.scope.notesWithoutStructuredClaims,
      fullSemanticHistoryCoverageEstablished:false as const,
      crossDeviceCoverageEstablished:false as const,
    },
    ownerPriority,analystReview,
    count:{
      total:tasks.length,
      ownerPriority:ownerPriority.length,
      analystReview:analystReview.length,
      duplicateCandidatesRetained:tasks.filter(t=>
        t.proposedRelation==="duplicate_candidate").length,
      automaticallyDiscarded:0 as const,
      automaticallyWritten:0 as const,
    },
    fixtureIsSyntheticIndependentlyProven:false as const,
    protectedThesisOrHistoricalProseReturned:false as const,
    sourcePublisherAuthenticated:false as const,
    factVerified:false as const,
    modelInvoked:false as const,
    independentOwnerReadPermissionEstablished:false as const,
    realOwnerNotificationSent:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    productionReleaseAllowed:false as const,
    vaultModified:false as const,
  };
}

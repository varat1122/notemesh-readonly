/**
 * PR #95 — bounded, OFFLINE single-release / multi-claim reconciliation.
 *
 * Composes PR #94's physically checked single-claim synthetic pipeline.
 * Reconciles multiple caller-declared claims in ONE synthetic issuer event,
 * never treating repeated claims as independent corroboration or allowing
 * a benign claim to suppress a conflict elsewhere in the release.
 *
 * Deliberately NOT a live news parser, autonomous model inference, owner
 * authorization, source authenticity proof, or Production Vault operation.
 */
import {runOfflineSyntheticInvestmentPipeline,
  type OfflineSyntheticPipelineInput}
  from "./offline-synthetic-investment-pipeline";
import {verifyOfflineSnapshotCoverage}
  from "./snapshot-coverage-acceptance";

export type OfflineMultiClaimInput={
  fixtureKind:"synthetic_offline_test_only";
  claims:OfflineSyntheticPipelineInput[];
};
const SHA=/^[0-9a-f]{64}$/;
const bounded=(x:unknown,max=300):x is string=>
  typeof x==="string"&&x.trim().length>0&&x.length<=max&&
  !/[\0\r\n]/.test(x);
const norm=(x:string)=>x.trim().normalize("NFC").toLowerCase();
type Row={
  caseIndex:number;metric:string;period:string;unit:string;value:string;
  category:string[];
  result:ReturnType<typeof runOfflineSyntheticInvestmentPipeline>;
};
type FixedReason=
  "batch_same_dimension_conflicting_value_requires_review"|
  "batch_repeated_literal_not_independent_confirmation"|
  "batch_same_value_different_period_not_duplicate";
const hardReasons=new Map<number,Set<FixedReason>>();
function flag(i:number,code:FixedReason){
  const prior=hardReasons.get(i)??new Set<FixedReason>();
  prior.add(code);hardReasons.set(i,prior);
}
export function runOfflineSyntheticMultiClaimReview(input:OfflineMultiClaimInput){
  if(!input||input.fixtureKind!=="synthetic_offline_test_only"||
    !Array.isArray(input.claims)||input.claims.length<2||
    input.claims.length>6)
    throw Error("multi_claim_requires_two_to_six_synthetic_cases_hold");
  const first=input.claims[0]?.candidate?.source?.review?.evidence;
  const original=first?.incoming;
  if(!first||!original||!bounded(first.snapshotRoot,700)||
    !SHA.test(first.expectedMarkdownManifestSha256)||
    !bounded(original.entity,100)||!bounded(original.eventKey,300)||
    !bounded(original.sourceUrl,300)||
    !SHA.test(original.originalSourceSha256??""))
    throw Error("multi_claim_release_identity_missing_hold");
  const rows:Row[]=[];
  // No results are returned until EVERY case and final physical snapshot
  // reconciliation succeeds. Failure of any claim aborts the entire batch.
  for(const [index,claim] of input.claims.entries()){
    const evidence=claim?.candidate?.source?.review?.evidence;
    const incoming=evidence?.incoming;
    const findings=claim?.candidate?.findings;
    const proposals=claim?.candidate?.source?.review?.proposals;
    if(claim?.fixtureKind!=="synthetic_offline_test_only"||
      !evidence||!incoming||!Array.isArray(findings)||
      findings.length!==1||findings[0]?.interpretationIndex!==0||
      !Array.isArray(proposals)||proposals.length!==1||
      evidence.snapshotRoot!==first.snapshotRoot||
      evidence.expectedMarkdownManifestSha256!==
        first.expectedMarkdownManifestSha256||
      incoming.entity!==original.entity||
      incoming.eventKey!==original.eventKey||
      incoming.sourceUrl!==original.sourceUrl||
      incoming.originalSourceSha256!==original.originalSourceSha256||
      !bounded(incoming.metric,100)||!bounded(incoming.period,100)||
      !bounded(incoming.unit,100)||!bounded(incoming.value,300)||
      (original.eventDate&&incoming.eventDate&&
        incoming.eventDate!==original.eventDate)||
      (original.publishedAt&&incoming.publishedAt&&
        incoming.publishedAt!==original.publishedAt))
      throw Error("multi_claim_cross_source_or_unbounded_case_hold");
    const result=runOfflineSyntheticInvestmentPipeline(claim);
    if(result.sourceSnapshotSha256!==first.expectedMarkdownManifestSha256||
      result.count.total!==1||
      result.count.ownerPriority+result.count.analystReview!==1||
      result.count.automaticallyDiscarded!==0||
      result.count.automaticallyWritten!==0||
      result.canAutoWrite!==false||result.ownerApprovalGranted!==false)
      throw Error("multi_claim_untrusted_single_case_output_hold");
    const channels=findings[0].economicMechanisms.map(m=>m.channel);
    rows.push({caseIndex:index,metric:incoming.metric,period:incoming.period,
      unit:incoming.unit,value:incoming.value,category:channels,result});
  }
  // Compare ONLY declared entity/event/source-equal claims, with
  // metric+period+unit as the identity key. Distinct periods/metrics may
  // not corroborate one another, even if two values look identical.
  hardReasons.clear();
  for(let i=0;i<rows.length;i++){
    for(let j=i+1;j<rows.length;j++){
      const a=rows[i],b=rows[j];
      if(norm(a.metric)!==norm(b.metric)||norm(a.unit)!==norm(b.unit))
        continue;
      const samePeriod=norm(a.period)===norm(b.period);
      const sameValue=norm(a.value)===norm(b.value);
      if(samePeriod&&!sameValue){
        flag(i,"batch_same_dimension_conflicting_value_requires_review");
        flag(j,"batch_same_dimension_conflicting_value_requires_review");
      }else if(samePeriod&&sameValue){
        flag(i,"batch_repeated_literal_not_independent_confirmation");
        flag(j,"batch_repeated_literal_not_independent_confirmation");
      }else if(!samePeriod&&sameValue){
        flag(i,"batch_same_value_different_period_not_duplicate");
        flag(j,"batch_same_value_different_period_not_duplicate");
      }
    }
  }
  const final=verifyOfflineSnapshotCoverage(first.snapshotRoot);
  if(final.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
    final.markdownContentManifestSha256!==
      first.expectedMarkdownManifestSha256)
    throw Error("multi_claim_snapshot_changed_at_batch_end_hold");

  const tasks=rows.map(row=>{
    const task=[...row.result.ownerPriority,
      ...row.result.analystReview][0];
    if(!task||task.interpretationIndex!==0)
      throw Error("multi_claim_unexpected_case_identity_hold");
    const flags=[...(hardReasons.get(row.caseIndex)??new Set<FixedReason>())];
    const conflict=flags.includes(
      "batch_same_dimension_conflicting_value_requires_review");
    const high=task.priority===1||conflict;
    return {
      caseIndex:row.caseIndex,
      interpretationIndex:0 as const,
      priority:high?1 as const:2 as const,
      queue:high?"owner_priority_unverified" as const:
        task.queue,
      historicalClassification:row.result.historicalClassification,
      modelProposedRelation:task.proposedRelation,
      proposedEconomicChannels:[...new Set(row.category)],
      reasonCodes:[...new Set([...task.reasonCodes,...flags])],
      claimedReleaseFactVerified:false as const,
      safeToSilentlyDismiss:false as const,
      sourceTextReturned:false as const,
    };
  });
  tasks.sort((a,b)=>a.priority-b.priority||a.caseIndex-b.caseIndex);
  const ownerPriority=tasks.filter(x=>x.queue==="owner_priority_unverified");
  const analystReview=tasks.filter(x=>x.queue!=="owner_priority_unverified");
  if(tasks.length!==rows.length||
    ownerPriority.length+analystReview.length!==rows.length)
    throw Error("multi_claim_task_count_mismatch_hold");
  return {
    status:"unverified_synthetic_multi_claim_release_review_only" as const,
    snapshotSha256:first.expectedMarkdownManifestSha256,
    ownerPriority,analystReview,
    releaseReviewPriority:ownerPriority.length>0?
      "potentially_material_human_review_required" as const:
      "analyst_review_still_required" as const,
    count:{
      claims:rows.length,ownerPriority:ownerPriority.length,
      analystReview:analystReview.length,
      claimsWithBatchValueConflict:tasks.filter(t=>t.reasonCodes.includes(
        "batch_same_dimension_conflicting_value_requires_review")).length,
      repeatedLiteralClaims:tasks.filter(t=>t.reasonCodes.includes(
        "batch_repeated_literal_not_independent_confirmation")).length,
      duplicateCandidatesRetained:tasks.filter(t=>
        t.modelProposedRelation==="duplicate_candidate").length,
      automaticallyDiscarded:0 as const,
      automaticallyWritten:0 as const,
    },
    entireBatchPhysicallyReconciled:true as const,
    callerDeclaredSyntheticOnly:true as const,
    independentlyProvedSyntheticFixture:false as const,
    independentSourcePublisherVerification:false as const,
    originalIssuerFactsVerified:false as const,
    actualModelInferencePerformed:false as const,
    semanticThesisImpactEstablished:false as const,
    ownerIdentityOrReadConsentVerified:false as const,
    protectedTextOrUserClaimValuesReturned:false as const,
    actualOwnerNotificationSent:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    productionReleaseAllowed:false as const,
    vaultModified:false as const,
  };
}

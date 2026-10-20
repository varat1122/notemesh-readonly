/**
 * PR #97 — OFFLINE institutional investment reasoning CONTRACT.
 *
 * Code validates structure, citation-index membership, uncertainty and
 * approval boundaries of externally supplied CAUSAL HYPOTHESES.
 * It never generates economic insight or decides semantic truth.
 *
 * Reuses PR #95 physically reconciled synthetic multi-claim review and its
 * safe exception queue; the model/API remains PAUSED. No Vault write.
 */
import {runOfflineSyntheticMultiClaimReview,
  type OfflineMultiClaimInput}
  from "./offline-synthetic-multi-claim-review";

const CHANNELS=[
  "demand","revenue_conversion","gross_profit","operating_profit",
  "earnings","cash_flow","return_on_capital","valuation",
] as const;
type Channel=typeof CHANNELS[number];
const RISKS=[
  "demand_risk","conversion_risk","execution_risk","economic_risk",
  "balance_sheet_risk","valuation_risk",
] as const;
type Risk=typeof RISKS[number];
const BOTTLENECKS=[
  "demand","conversion","execution","economic","balance_sheet",
  "valuation","undetermined",
] as const;
type Bottleneck=typeof BOTTLENECKS[number];
const RELATIONS=[
  "confirmation_candidate","incremental_candidate",
  "contradiction_candidate","thesis_changing_hypothesis",
  "duplicate_candidate","unresolved",
] as const;
type Relation=typeof RELATIONS[number];
const DIRECTIONS=["supports","challenges","unclear"] as const;
type Direction=typeof DIRECTIONS[number];
type EvidenceCaseIndices=number[];
type CausalStep={
  from:Channel;to:Channel;
  /** Claim ordinals from the SAME, physically checked synthetic batch. */
  evidenceCaseIndices:EvidenceCaseIndices;
  hypothesis:string;
  bridge:"adjacent_candidate"|"intermediate_mechanism_not_established";
  epistemicStatus:"unverified_hypothesis";
};
type BottleneckCandidate={
  kind:Bottleneck;
  evidenceCaseIndices:EvidenceCaseIndices;
  rationale:string;
  confidence:"low_unverified"|"medium_unverified";
};
type RiskCandidate={
  kind:Risk;
  evidenceCaseIndices:EvidenceCaseIndices;
  rationale:string;
};
type CounterEvidenceReview={
  status:"cited_not_exhaustive"|"not_identified_not_exhaustive";
  contraryCaseIndices:EvidenceCaseIndices;
  alternativeHypotheses:string[];
  evidenceStillNeeded:string[];
};
type ThesisProposal={
  relation:Relation;direction:Direction;
  evidenceCaseIndices:EvidenceCaseIndices;
  explanation:string;
  impactMagnitude:"not_quantified";
  confidence:"low_unverified"|"medium_unverified";
};
type ReasoningDraft={
  causalChain:CausalStep[];
  bottleneck:BottleneckCandidate;
  risks:RiskCandidate[];
  counterEvidence:CounterEvidenceReview;
  thesis:ThesisProposal;
  marketExpectation:{
    status:"not_assessed_no_current_market_data";
    priceInConclusion:"not_determined";
  };
};
export type OfflineReasoningContractInput=OfflineMultiClaimInput&{
  draft:ReasoningDraft;
};
type ReasonCode=
  "causal_mechanism_skips_unverified_intermediate_steps"|
  "competing_hypotheses_not_independent_counterevidence"|
  "no_cited_counterevidence_not_proof_of_absence"|
  "potential_thesis_challenge_requires_owner_review"|
  "owner_priority_inherited_from_evidence"|
  "market_expectation_not_checked_no_price_in_conclusion"|
  "reasoning_is_unverified_external_proposal";
const only=(x:unknown,fields:readonly string[])=>!!x&&
  typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).every(k=>fields.includes(k))&&
  fields.every(k=>Object.hasOwn(x,k));
const bounded=(s:unknown,n:number)=>typeof s==="string"&&
  s.trim().length>0&&s.length<=n&&!/[\0\r]/.test(s);
const CASE_LIMIT=6;
function indices(v:unknown,n:number,allowEmpty=false):v is number[]{
  return Array.isArray(v)&&(allowEmpty?v.length<=CASE_LIMIT:
    v.length>=1&&v.length<=CASE_LIMIT)&&
    v.every(x=>Number.isSafeInteger(x)&&x>=0&&x<n)&&
    new Set(v).size===v.length;
}
function explanatoryStrings(v:unknown,maxItems:number){
  return Array.isArray(v)&&v.length>=1&&v.length<=maxItems&&
    v.every(x=>bounded(x,400));
}
const STEP_KEYS=[
  "from","to","evidenceCaseIndices","hypothesis","bridge","epistemicStatus",
];
function validateDraft(input:OfflineReasoningContractInput){
  const d=input.draft;
  const n=input.claims?.length;
  if(!Number.isSafeInteger(n)||n<2||n>CASE_LIMIT||
    !d||!only(d,["causalChain","bottleneck","risks",
      "counterEvidence","thesis","marketExpectation"])||
    !Array.isArray(d.causalChain)||d.causalChain.length<1||
    d.causalChain.length>6)
    throw Error("reasoning_contract_missing_bounded_structure_hold");
  const raw=input.claims;
  const channels=raw.map(c=>c?.candidate?.findings?.[0]?
    c.candidate.findings[0].economicMechanisms.map(m=>m.channel):[]);
  const steps=d.causalChain.map((s,index)=>{
    if(!only(s,STEP_KEYS)||!CHANNELS.includes(s.from)||
      !CHANNELS.includes(s.to)||!indices(s.evidenceCaseIndices,n)||
      !bounded(s.hypothesis,750)||
      !["adjacent_candidate",
        "intermediate_mechanism_not_established"].includes(s.bridge)||
      s.epistemicStatus!=="unverified_hypothesis")
      throw Error("reasoning_contract_invalid_or_overclaimed_step_hold");
    const from=CHANNELS.indexOf(s.from),to=CHANNELS.indexOf(s.to);
    if(from<0||to<=from||
      (index>0&&d.causalChain[index-1].to!==s.from)||
      (to-from>1&&s.bridge!=="intermediate_mechanism_not_established"))
      throw Error("reasoning_contract_causal_chain_broken_or_skipped_hold");
    if(!s.evidenceCaseIndices.some(i=>channels[i].includes(s.from)||
      channels[i].includes(s.to)))
      throw Error("reasoning_contract_mechanism_unanchored_to_case_hold");
    return {
      from:s.from,to:s.to,
      evidenceCaseIndices:[...s.evidenceCaseIndices],
      bridge:s.bridge,
      unverifiedCausalHypothesisOnly:true as const,
    };
  });
  const b=d.bottleneck;
  if(!only(b,["kind","evidenceCaseIndices","rationale","confidence"])||
    !BOTTLENECKS.includes(b.kind)||
    !indices(b.evidenceCaseIndices,n,b.kind==="undetermined")||
    !bounded(b.rationale,600)||
    !["low_unverified","medium_unverified"].includes(b.confidence)||
    (b.kind==="undetermined"&&b.evidenceCaseIndices.length!==0))
    throw Error("reasoning_contract_bottleneck_overclaim_hold");
  if(!Array.isArray(d.risks)||d.risks.length>3||
    new Set(d.risks.map(x=>x?.kind)).size!==d.risks.length)
    throw Error("reasoning_contract_invalid_risks_hold");
  const risks=d.risks.map(r=>{
    if(!only(r,["kind","evidenceCaseIndices","rationale"])||
      !RISKS.includes(r.kind)||!indices(r.evidenceCaseIndices,n)||
      !bounded(r.rationale,550))
      throw Error("reasoning_contract_unsupported_risk_hold");
    return {
      kind:r.kind,evidenceCaseIndices:[...r.evidenceCaseIndices],
      verifiedRisk:false as const,
    };
  });
  const counter=d.counterEvidence;
  if(!only(counter,["status","contraryCaseIndices",
      "alternativeHypotheses","evidenceStillNeeded"])||
    !["cited_not_exhaustive",
      "not_identified_not_exhaustive"].includes(counter.status)||
    !indices(counter.contraryCaseIndices,n,true)||
    (counter.status==="cited_not_exhaustive")!==
      (counter.contraryCaseIndices.length>0)||
    !explanatoryStrings(counter.alternativeHypotheses,4)||
    !explanatoryStrings(counter.evidenceStillNeeded,5))
    throw Error("reasoning_contract_counterevidence_not_assessed_hold");
  const t=d.thesis;
  if(!only(t,["relation","direction","evidenceCaseIndices",
      "explanation","impactMagnitude","confidence"])||
    !RELATIONS.includes(t.relation)||!DIRECTIONS.includes(t.direction)||
    !indices(t.evidenceCaseIndices,n)||
    !bounded(t.explanation,800)||
    t.impactMagnitude!=="not_quantified"||
    !["low_unverified","medium_unverified"].includes(t.confidence)||
    (t.relation==="thesis_changing_hypothesis"&&
      t.direction==="supports")||
    (t.relation==="duplicate_candidate"&&t.direction==="challenges"))
    throw Error("reasoning_contract_thesis_not_grounded_or_overclaimed_hold");
  if(!only(d.marketExpectation,["status","priceInConclusion"])||
    d.marketExpectation.status!==
      "not_assessed_no_current_market_data"||
    d.marketExpectation.priceInConclusion!=="not_determined")
    throw Error("reasoning_contract_current_market_data_unavailable_hold");

  return {steps,risks};
}
export function reviewOfflineInvestmentReasoningContract(
  input:OfflineReasoningContractInput,
){
  if(!input||input.fixtureKind!=="synthetic_offline_test_only")
    throw Error("reasoning_contract_explicit_synthetic_fixture_required");
  // Reject malformed or forged assertions before private offline readback.
  const {steps,risks}=validateDraft(input);
  // Existing PR #95 checks physical snapshot, bounded original historical
  // references, selected Thesis line hashes, and all claim exceptions.
  const historical=runOfflineSyntheticMultiClaimReview(input);
  if(historical.count.claims!==input.claims.length||
    !historical.entireBatchPhysicallyReconciled||
    historical.canAutoWrite!==false)
    throw Error("reasoning_contract_historical_reconciliation_hold");
  const baseline=[...historical.ownerPriority,...historical.analystReview];
  const hasUnderlyingPriority=historical.ownerPriority.length>0;
  const t=input.draft.thesis;
  const thesisChallenge=t.relation==="contradiction_candidate"||
    t.relation==="thesis_changing_hypothesis"||
    t.direction==="challenges";
  const skipped=steps.some(s=>
    s.bridge==="intermediate_mechanism_not_established");
  const codeReasons:ReasonCode[]=[
    "reasoning_is_unverified_external_proposal",
    "competing_hypotheses_not_independent_counterevidence",
    "market_expectation_not_checked_no_price_in_conclusion",
    ...(input.draft.counterEvidence.status===
      "not_identified_not_exhaustive"?
      ["no_cited_counterevidence_not_proof_of_absence" as const]:[]),
    ...(skipped?[
      "causal_mechanism_skips_unverified_intermediate_steps" as const]:[]),
    ...(thesisChallenge?[
      "potential_thesis_challenge_requires_owner_review" as const]:[]),
    ...(hasUnderlyingPriority?[
      "owner_priority_inherited_from_evidence" as const]:[]),
  ];
  // Never trust a thesis-changing label as a decision. It merely raises
  // the review priority, and keeps every source claim in its PR #95 queue.
  const requiresOwnerReview=thesisChallenge||hasUnderlyingPriority;
  return {
    status:"unverified_offline_investment_reasoning_contract_only" as const,
    sourceSnapshotSha256:historical.snapshotSha256,
    reasoningPath:steps,
    riskCandidates:risks,
    bottleneckCandidate:{
      kind:input.draft.bottleneck.kind,
      evidenceCaseIndices:[...input.draft.bottleneck.evidenceCaseIndices],
      establishedByEvidence:false as const,
    },
    counterEvidenceReview:{
      declaredStatus:input.draft.counterEvidence.status,
      contraryCaseIndices:[
        ...input.draft.counterEvidence.contraryCaseIndices],
      independentCounterEvidenceSearchComplete:false as const,
      alternativeHypothesesValidatedForTruth:false as const,
    },
    thesisCandidate:{
      proposedRelation:t.relation,proposedDirection:t.direction,
      evidenceCaseIndices:[...t.evidenceCaseIndices],
      magnitudeEstablished:false as const,
      confidenceCalibrated:false as const,
      independentlyComparedWithFullThesis:false as const,
    },
    review:{
      queue:requiresOwnerReview?
        "owner_priority_unverified" as const:
        "analyst_reasoning_review_required" as const,
      reasonCodes:codeReasons,
      allSourceClaimCaseIndices:baseline.map(c=>c.caseIndex)
        .sort((a,b)=>a-b),
      underlyingOwnerPriorityCaseIndices:historical.ownerPriority.map(
        c=>c.caseIndex).sort((a,b)=>a-b),
      sourceClaimsRetained:baseline.length,
      automaticallyDiscarded:0 as const,
    },
    marketExpectationNotAssessed:true as const,
    originalIssuerSourcesIndependentlyVerified:false as const,
    reasoningProducedByModelInThisFunction:false as const,
    economicMechanismsValidatedForTruth:false as const,
    businessBottleneckEstablished:false as const,
    investmentThesisChangeApproved:false as const,
    valuationOrPortfolioUpdateSupported:false as const,
    independentOwnerAccessConsentVerified:false as const,
    protectedThesisSourceNotesOrFreeFormProseReturned:false as const,
    externalNotificationsSent:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    productionReleaseAllowed:false as const,
    vaultModified:false as const,
  };
}

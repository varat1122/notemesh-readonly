/**
 * PR #89: Offline Semantic Review CONTRACT + Evidence Judge.
 *
 * AI/analysts can propose MEANING hypotheses, but the proposal must cite
 * already verified byte/line references from PR #84-88. This module checks
 * grounding + completeness, NOT semantic truth. No model invocation/network,
 * protected note export, save, user authentication, or production access.
 *
 * It explicitly does NOT provide an LLM callable endpoint: PR #88 scopes
 * include caller-selected protected Thesis text but no independently
 * authenticated owner/reader entitlement.
 */
import {prepareOfflineScopedThesisComparison,
  type OfflineScopedThesisRequest} from "./offline-thesis-scoped-excerpt-crosswalk";

const RELATIONS=[
  "confirmation_candidate","incremental_candidate","duplicate_candidate",
  "contradiction_candidate","thesis_changing_hypothesis","unresolved",
] as const;
const DIRECTIONS=["supports","challenges","unclear"] as const;
const CHANNELS=["demand","revenue_conversion","gross_profit",
  "operating_profit","earnings","cash_flow","return_on_capital",
  "valuation","risk"] as const;
type Relation=typeof RELATIONS[number];
type Direction=typeof DIRECTIONS[number];
type Channel=typeof CHANNELS[number];
type ModelFinding={
  interpretationIndex:number;
  relation:Relation;
  selectedThesisRefIds:string[];
  historicalSupportRefIds:string[];
  historicalCounterRefIds:string[];
  direction:Direction;
  economicMechanisms:{
    channel:Channel;
    causalExplanation:string;
    epistemicStatus:"hypothesis";
  }[];
  evidenceGaps:string[];
  whyThisIsNotProven:string;
  counterEvidenceAssessment:
    "some_cited_but_not_exhaustive"|"not_yet_found_or_read";
  candidateSummary:string;
};
export type OfflineSemanticReviewInput={
  source:OfflineScopedThesisRequest;
  /** Caller/model produced; cannot be taken as actual evaluated truth. */
  findings:ModelFinding[];
};
const nonblank=(v:unknown,n:number):v is string=>
  typeof v==="string"&&v.trim().length>0&&v.length<=n&&
  !/[\0\r]/.test(v);
const id=(s:unknown):s is string=>
  typeof s==="string"&&/^(?:T\d+|I\d+[SC]\d+)$/.test(s);
const only=(v:unknown,keys:string[])=>!!v&&typeof v==="object"&&
  !Array.isArray(v)&&
  Object.keys(v).every(k=>keys.includes(k))&&
  keys.every(k=>Object.hasOwn(v,k));
const entryKeys=[
  "interpretationIndex","relation","selectedThesisRefIds",
  "historicalSupportRefIds","historicalCounterRefIds","direction",
  "economicMechanisms","evidenceGaps","whyThisIsNotProven",
  "counterEvidenceAssessment","candidateSummary",
];
export function judgeOfflineThesisSemanticDraft(input:OfflineSemanticReviewInput){
  if(!input||!Array.isArray(input.findings)||
    input.findings.length<1||input.findings.length>6)
    throw Error("semantic_review_unbounded_or_missing_findings");
  // This reruns all independent offline physical snapshot + FTS + history
  // checks and exact selected Thesis note/line SHA checks from PR #88.
  const packet=prepareOfflineScopedThesisComparison(input.source);
  const map=new Map<string,{
    id:string;kind:"thesis"|"structured_history"|"prose_history";
    interpretationIndex:number;notePath:string;
    noteSha256:string|null;line:number|null;excerpt:string|null;
    sourceSha256:string|null;independence:string|null;
  }>();
  packet.selectedQuotes.forEach((q,index)=>{
    map.set("T"+index,{
      id:"T"+index,kind:"thesis",
      interpretationIndex:q.interpretationIndex,
      notePath:q.path,noteSha256:q.noteSha256,
      line:q.absoluteLine,excerpt:q.excerpt,
      sourceSha256:null,independence:null,
    });
  });
  packet.historicalInterpretations.forEach((item,index)=>{
    item.historicalSupportingRefs.forEach((r,n)=>{
      map.set("I"+index+"S"+n,{
        id:"I"+index+"S"+n,
        kind:r.kind==="historical_prose"?"prose_history":"structured_history",
        interpretationIndex:index,notePath:r.path,
        noteSha256:"noteSha256" in r?(r.noteSha256??null):null,
        line:"line" in r?(r.line??null):null,
        excerpt:"excerpt" in r?(r.excerpt??null):null,
        sourceSha256:"sourceSha256" in r?(r.sourceSha256??null):null,
        independence:r.independence,
      });
    });
    item.historicalCounterEvidenceRefs.forEach((r,n)=>{
      map.set("I"+index+"C"+n,{
        id:"I"+index+"C"+n,
        kind:r.kind==="historical_prose"?"prose_history":"structured_history",
        interpretationIndex:index,notePath:r.path,
        noteSha256:"noteSha256" in r?r.noteSha256:null,
        line:"line" in r?r.line:null,
        excerpt:"excerpt" in r?r.excerpt:null,
        sourceSha256:"sourceSha256" in r?r.sourceSha256:null,
        independence:r.independence,
      });
    });
  });
  const seen=new Set<number>();
  const findings=input.findings.map(f=>{
    if(!only(f,entryKeys)||
      !Number.isSafeInteger(f.interpretationIndex)||
      f.interpretationIndex<0||
      f.interpretationIndex>=packet.historicalInterpretations.length||
      seen.has(f.interpretationIndex)||!RELATIONS.includes(f.relation)||
      !DIRECTIONS.includes(f.direction)||
      !nonblank(f.candidateSummary,700)||
      !nonblank(f.whyThisIsNotProven,650)||
      !Array.isArray(f.selectedThesisRefIds)||
      f.selectedThesisRefIds.length<1||
      f.selectedThesisRefIds.length>3||
      !Array.isArray(f.historicalSupportRefIds)||
      f.historicalSupportRefIds.length<1||
      f.historicalSupportRefIds.length>6||
      !Array.isArray(f.historicalCounterRefIds)||
      f.historicalCounterRefIds.length>4||
      !Array.isArray(f.evidenceGaps)||f.evidenceGaps.length<1||
      f.evidenceGaps.length>6||f.evidenceGaps.some(g=>!nonblank(g,280))||
      !Array.isArray(f.economicMechanisms)||
      f.economicMechanisms.length<1||f.economicMechanisms.length>5||
      f.economicMechanisms.some(m=>
        !only(m,["channel","causalExplanation","epistemicStatus"])||
        !CHANNELS.includes(m.channel)||!nonblank(m.causalExplanation,450)||
        m.epistemicStatus!=="hypothesis")||
      !["some_cited_but_not_exhaustive",
        "not_yet_found_or_read"].includes(f.counterEvidenceAssessment))
      throw Error("semantic_review_invalid_or_overclaimed_finding_hold");
    seen.add(f.interpretationIndex);
    const unique=[...f.selectedThesisRefIds,...f.historicalSupportRefIds,
      ...f.historicalCounterRefIds];
    if(new Set(unique).size!==unique.length||unique.some(x=>!id(x)))
      throw Error("semantic_review_bad_or_repeated_citation_id_hold");
    function grounded(ids:string[],kind:"thesis"|"support"|"counter"){
      return ids.map(key=>{
        const item=map.get(key);
        if(!item||item.interpretationIndex!==f.interpretationIndex||
          (kind==="thesis"&&item.kind!=="thesis")||
          (kind==="support"&&!/^I\d+S\d+$/.test(key))||
          (kind==="counter"&&!/^I\d+C\d+$/.test(key)))
          throw Error("semantic_review_hallucinated_or_cross_case_citation_hold");
        return item;
      });
    }
    const thesis=grounded(f.selectedThesisRefIds,"thesis");
    const supports=grounded(f.historicalSupportRefIds,"support");
    const counters=grounded(f.historicalCounterRefIds,"counter");
    if((f.counterEvidenceAssessment==="some_cited_but_not_exhaustive")!==
      (counters.length>0))
      throw Error("semantic_review_counterevidence_status_not_consistent");
    const item=packet.historicalInterpretations[f.interpretationIndex];
    if(f.relation==="duplicate_candidate"&&
      item.reviewQueue==="mandatory_human_thesis_or_conflict_review")
      throw Error("semantic_review_duplicate_cannot_override_conflict_hold");
    const aligns=item.economicChannels.some(c=>
      f.economicMechanisms.some(m=>m.channel===c));
    if(!aligns)
      throw Error("semantic_review_mechanism_outside_historical_hypothesis_hold");
    const derived= supports.some(s=>
      s.independence!=="not_assessed");
    const isImportant=f.relation==="contradiction_candidate"||
      f.relation==="thesis_changing_hypothesis"||
      f.direction==="challenges";
    return {
      interpretationIndex:f.interpretationIndex,
      originalClaimLabel:item.claimLabel,
      modelProposedRelation:f.relation,modelProposedDirection:f.direction,
      candidateSummary:f.candidateSummary,
      mechanismHypotheses:f.economicMechanisms,
      citedThesisLines:thesis,citedHistoricalSupport:supports,
      citedHistoricalCounterEvidence:counters,
      evidenceGaps:f.evidenceGaps,
      whyThisIsNotProven:f.whyThisIsNotProven,
      counterEvidenceAssessment:f.counterEvidenceAssessment,
      reviewQueue:isImportant?
        "must_review_potential_thesis_change_or_conflict" as const:
        derived?"manual_derivative_source_review" as const:
          "analyst_review_unverified_interpretation" as const,
      warnings:[
        ...(derived?["At least one cited prior is derivative/archived AI, not independent issuer evidence."]:[]),
        ...(counters.length===0?["No cited counterevidence; absence is NOT evidence none exists."]:[]),
        "Model interpretation and mechanism are not verified by citation membership.",
        "Actual owner consent to release protected Thesis content is not established.",
      ],
      eventClassifiedAsVerifiedNew:false as const,
      semanticClaimVerified:false as const,thesisImpactEstablished:false as const,
      factualCounterevidenceSearchComplete:false as const,
    };
  });
  return {
    status:"unverified_offline_semantic_review_candidates_only" as const,
    company:packet.company,
    sourceSnapshotSha256:packet.snapshotManifestSha256,
    thesisSha256:packet.thesisSha256,
    callerModelProposalsChecked:true as const,
    independentSemanticVerificationPerformed:false as const,
    freshPhysicalCitationsChecked:true as const,
    modelInvokedByThisCode:false as const,
    allThesisRead:false as const,
    originalIssuerSourceChecked:false as const,
    originalSourceFactEstablished:false as const,
    independentOwnerAccessApproval:false as const,
    findings,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,canAutoUpdateThesis:false as const,
    safeEditPreview:null,vaultModified:false as const,
  };
}

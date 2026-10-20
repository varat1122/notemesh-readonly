/**
 * PR #90 — SYNTHETIC-ONLY semantic benchmark scorer.
 *
 * Evaluates externally supplied responses against fixed HAND-LABELED FICTION.
 * Does NOT call an LLM, verify investment facts, score the quality of any
 * production model, read private notes, make authorizations, or write files.
 * The harness MUST NEVER be used as a production approval gate.
 */
import {SYNTHETIC_SEMANTIC_CASES,type SemanticRelation,
  type EconomicChannel,type ReviewQueue}
  from "./offline-semantic-benchmark-corpus";

export type SyntheticModelPrediction={
  caseId:string;
  proposedRelation:SemanticRelation;
  citedIds:string[];
  abstainsForMissingEvidence:boolean;
  proposedEconomicChannel:EconomicChannel;
  economicReasoning:"hypothesis";
  primarySourceStillRequired:string;
  counterEvidenceCoverage:"not_exhaustively_checked";
  limitations:string;
};
const K=[
  "caseId","proposedRelation","citedIds","abstainsForMissingEvidence",
  "proposedEconomicChannel","economicReasoning",
  "primarySourceStillRequired","counterEvidenceCoverage","limitations",
];
const RELATIONS=[
  "duplicate_candidate","incremental_candidate","contradiction_candidate",
  "confirmation_candidate","thesis_changing_hypothesis","unresolved",
];
const CHANNELS=["demand","revenue_conversion","gross_profit",
  "operating_profit","earnings","cash_flow","return_on_capital",
  "valuation","risk"];
const textOk=(v:unknown,n:number)=>
  typeof v==="string"&&v.trim().length>0&&v.length<=n&&
  !/[\0\r]/.test(v);
function validatePrediction(candidate:SyntheticModelPrediction){
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate)||
    Object.keys(candidate).length!==K.length||
    !K.every(k=>Object.hasOwn(candidate,k))||
    !textOk(candidate.caseId,100)||
    !RELATIONS.includes(candidate.proposedRelation)||
    !CHANNELS.includes(candidate.proposedEconomicChannel)||
    !Array.isArray(candidate.citedIds)||candidate.citedIds.length<1||
    candidate.citedIds.length>6||
    candidate.citedIds.some((id:string)=>!textOk(id,20))||
    new Set(candidate.citedIds).size!==candidate.citedIds.length||
    typeof candidate.abstainsForMissingEvidence!=="boolean"||
    candidate.abstainsForMissingEvidence!==(candidate.proposedRelation==="unresolved")||
    candidate.economicReasoning!=="hypothesis"||
    candidate.counterEvidenceCoverage!=="not_exhaustively_checked"||
    !textOk(candidate.primarySourceStillRequired,250)||
    !textOk(candidate.limitations,400))
    throw Error("synthetic_semantic_prediction_schema_or_overclaim_hold");
}
function queueFromPrediction(p:SyntheticModelPrediction):ReviewQueue{
  if(p.proposedRelation==="contradiction_candidate"||
    p.proposedRelation==="thesis_changing_hypothesis")
    return "human_priority_review";
  if(p.proposedRelation==="duplicate_candidate")
    return "quiet_candidate_only";
  return "analyst_review";
}
export function scoreSyntheticSemanticPredictions(
  inputs:readonly SyntheticModelPrediction[],
){
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("synthetic_semantic_benchmark_refused_in_railway");
  if(!Array.isArray(inputs)||inputs.length!==SYNTHETIC_SEMANTIC_CASES.length)
    throw Error("synthetic_semantic_requires_complete_fixed_case_set");
  const seen=new Set<string>();
  for(const p of inputs){
    validatePrediction(p);
    if(seen.has(p.caseId))throw Error("synthetic_semantic_duplicate_case_id_hold");
    seen.add(p.caseId);
  }
  const answers=new Map(inputs.map(p=>[p.caseId,p]));
  const results=SYNTHETIC_SEMANTIC_CASES.map(s=>{
    const p=answers.get(s.id);
    if(!p)throw Error("synthetic_semantic_unknown_or_missing_case_hold");
    const permissible=new Set(s.historicalExcerpts.map(e=>e.id));
    const citationsValid=p.citedIds.includes("T0")&&
      p.citedIds.some((id:string)=>id.startsWith("I"))&&
      p.citedIds.every((id:string)=>permissible.has(id));
    const relationCorrect=p.proposedRelation===s.goldRelation;
    const abstentionCorrect=p.abstainsForMissingEvidence===s.goldAbstain;
    const mechanismCorrect=p.proposedEconomicChannel===s.goldChannel;
    const candidateQueue=queueFromPrediction(p);
    const queueCorrect=candidateQueue===s.requiredReviewQueue;
    const unsafeFalseDuplicate=p.proposedRelation==="duplicate_candidate"&&
      s.goldRelation!=="duplicate_candidate";
    const missedCriticalReview=s.requiredReviewQueue==="human_priority_review"&&
      candidateQueue!=="human_priority_review";
    const passed=citationsValid&&relationCorrect&&abstentionCorrect&&
      mechanismCorrect&&queueCorrect;
    return {
      caseId:s.id,relationCorrect,abstentionCorrect,mechanismCorrect,
      citationsValid,queueCorrect,passed,unsafeFalseDuplicate,
      missedCriticalReview,candidateReviewQueue:candidateQueue,
      expectedReviewQueue:s.requiredReviewQueue,
    };
  });
  const count=(pred:(r:typeof results[number])=>boolean)=>
    results.filter(pred).length;
  const total=results.length;
  const unsafeFalseDuplicates=count(r=>r.unsafeFalseDuplicate);
  const missedCriticalReviews=count(r=>r.missedCriticalReview);
  const invalidCitations=count(r=>!r.citationsValid);
  const missedAbstentions=count(r=>!r.abstentionCorrect);
  const totalCorrect=count(r=>r.passed);
  const safetyChecksPassed=unsafeFalseDuplicates===0&&
    missedCriticalReviews===0&&invalidCitations===0&&
    missedAbstentions===0;
  return {
    status:"synthetic_semantic_fixture_score_only_not_a_model_validation" as const,
    dataOrigin:"handwritten_fictional_S Y N T H_cases".replaceAll(" ",""),
    cases:total,caseResults:results,
    metrics:{
      fullCasePassCount:totalCorrect,
      casePassRate:totalCorrect/total,
      relationCorrectCount:count(r=>r.relationCorrect),
      abstentionCorrectCount:count(r=>r.abstentionCorrect),
      groundedCitationCount:count(r=>r.citationsValid),
      unsafeFalseDuplicates,missedCriticalReviews,
      invalidCitations,missedAbstentions,
      safetyChecksPassed,
      allFixtureExpectationsMatched:totalCorrect===total,
    },
    syntheticFixturePracticeOnly:true as const,
    heldOutEvaluationPerformed:false as const,
    independentRealWorldAccuracyMeasured:false as const,
    realModelInvokedByThisCode:false as const,
    actualVaultRead:false as const,
    authorizedPrivateDataDisclosure:false as const,
    ownerIdentityVerified:false as const,
    ownerApprovalGranted:false as const,
    productionReleaseAllowed:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    vaultModified:false as const,
    blockers:[
      "No real owner-enrolled independent read entitlement or key custody.",
      "No actual model has been called or benchmarked on unseen cases.",
      "The fictional gold labels are embedded in code and NOT held-out proof of semantic accuracy.",
      "No issuer fact/counter-evidence/Thesis-version authorization or live semantic verification.",
      "No production or write approval follows from synthetic test scores.",
    ],
  };
}

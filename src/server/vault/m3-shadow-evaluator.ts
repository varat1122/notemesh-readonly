/**
 * M3a synthetic shadow benchmark: compare unchanged M5.5.1 with externally
 * supplied model judgments. This module does NOT call a provider or Vault,
 * write notes, grant authorization, or imply held-out model performance.
 */
import {z} from "zod";
import {M2_POLICY} from "./research-decision-v2";
import {validateResearchM55} from "./research-quality-m55";
import {M3_SHADOW_CASES,getM3ShadowModelInputs} from "./m3-shadow-corpus";

export const m3ShadowJudgmentSchema=z.object({
  caseId:z.string().min(5).max(100),
  policyVersion:z.literal(M2_POLICY.version),
  policySha256:z.literal(M2_POLICY.sha256),
  disposition:z.enum(["accept_qualified","hold_unsupported"]),
  conclusion:z.enum(["no_change","conditional","confirmed"]),
  evidenceState:z.enum(["unresolved","attributed","verified_primary"]),
  citedIds:z.array(z.string().min(2).max(16)).min(1).max(8),
  reasonTh:z.string().min(8).max(1200),
  missingEvidenceTh:z.string().min(8).max(1200),
}).strict();
export type M3ShadowJudgment=z.infer<typeof m3ShadowJudgmentSchema>;
export type M3ModelInput=ReturnType<typeof getM3ShadowModelInputs>[number];

function corpusIntegrity(){
  if(M3_SHADOW_CASES.length!==20||new Set(M3_SHADOW_CASES.map(x=>x.id)).size!==20||
    M3_SHADOW_CASES.some(x=>x.origin!=="fictional_synthetic_only"||!x.sources.length||
      x.gold.requiredCitationIds.some(id=>![...x.sources,...x.history].some(s=>s.id===id))))
    throw Error("M3_SYNTHETIC_CORPUS_IDENTITY_OR_REFERENCES_INVALID");
  const both=M3_SHADOW_CASES.reduce((a,c)=>{a[c.gold.reviewSafe?"safe":"unsafe"]++;return a;},
    {safe:0,unsafe:0});
  if(both.safe<6||both.unsafe<6)throw Error("M3_SYNTHETIC_CORPUS_UNBALANCED");
}
export interface M3BaselineRow {
  caseId:string;room:"micro"|"macro"|"pdf";goldReviewSafe:boolean;critical:boolean;
  oldGateWouldAllow:boolean;qualityIssueCodes:string[];falseVerified:boolean;falseHold:boolean;
}
export function measureM551LegacyBaseline(){
  corpusIntegrity();
  const rows:M3BaselineRow[]=M3_SHADOW_CASES.map(c=>{
    const issues=validateResearchM55(c.classification,c.proposedReview,
      c.sources.map(s=>s.text).join("\n\n"));
    const allowed=issues.length===0;
    return {caseId:c.id,room:c.room,goldReviewSafe:c.gold.reviewSafe,
      critical:c.gold.critical,oldGateWouldAllow:allowed,qualityIssueCodes:issues,
      falseVerified:!c.gold.reviewSafe&&allowed,
      falseHold:c.gold.reviewSafe&&!allowed};
  });
  return {status:"deterministic_legacy_gate_on_fictional_cases_only" as const,
    caseCount:rows.length,rows,
    metrics:{falseVerified:rows.filter(x=>x.falseVerified).length,
      criticalFalseVerified:rows.filter(x=>x.falseVerified&&x.critical).length,
      falseHold:rows.filter(x=>x.falseHold).length,
      held:rows.filter(x=>!x.oldGateWouldAllow).length,
      accepted:rows.filter(x=>x.oldGateWouldAllow).length},
    realModelInvoked:false as const,independentRealWorldAccuracyMeasured:false as const,
    writesPerformed:false as const,productionReleaseAllowed:false as const};
}

type ModelRow={caseId:string;goldReviewSafe:boolean;critical:boolean;
  disposition:M3ShadowJudgment["disposition"];falseVerified:boolean;falseHold:boolean;
  claimedUnsupportedPrimary:boolean;citationsValid:boolean;missingRequiredCitationIds:string[]};
/** Test/caller data only. An injected callback is NOT a security sandbox and
 * cannot be used as evidence that an independent provider was invoked. */
export function scoreM3ShadowJudgments(raw:readonly unknown[]){
  corpusIntegrity();
  if(!Array.isArray(raw)||raw.length!==M3_SHADOW_CASES.length)
    throw Error("M3_SHADOW_COMPLETE_FROZEN_SET_REQUIRED");
  const judgments=raw.map(v=>m3ShadowJudgmentSchema.parse(v));
  const ids=new Set(judgments.map(x=>x.caseId));
  if(ids.size!==judgments.length||
    judgments.some(x=>!M3_SHADOW_CASES.some(c=>c.id===x.caseId)))
    throw Error("M3_SHADOW_DUPLICATE_OR_UNKNOWN_CASE_ID");
  const byId=new Map(judgments.map(x=>[x.caseId,x]));
  const rows:ModelRow[]=M3_SHADOW_CASES.map(c=>{
    const j=byId.get(c.id)!;
    const available=new Set([...c.sources,...c.history].map(x=>x.id));
    const missing=c.gold.requiredCitationIds.filter(id=>!j.citedIds.includes(id));
    const citationValid=missing.length===0&&new Set(j.citedIds).size===j.citedIds.length&&
      j.citedIds.every(x=>available.has(x));
    const primaryOverclaim=j.evidenceState==="verified_primary"||j.conclusion==="confirmed";
    const accepted=j.disposition==="accept_qualified";
    return {caseId:c.id,goldReviewSafe:c.gold.reviewSafe,critical:c.gold.critical,
      disposition:j.disposition,citationsValid:citationValid,
      missingRequiredCitationIds:missing,
      falseVerified:(!c.gold.reviewSafe&&accepted)||primaryOverclaim,
      falseHold:c.gold.reviewSafe&&!accepted,
      claimedUnsupportedPrimary:primaryOverclaim};
  });
  const count=(fn:(r:ModelRow)=>boolean)=>rows.filter(fn).length;
  const metric={falseVerified:count(x=>x.falseVerified),
    criticalFalseVerified:count(x=>x.falseVerified&&x.critical),
    falseHold:count(x=>x.falseHold),
    invalidCitations:count(x=>!x.citationsValid),
    unsupportedPrimaryClaims:count(x=>x.claimedUnsupportedPrimary),
    safeAccepts:count(x=>x.goldReviewSafe&&x.disposition==="accept_qualified"&&x.citationsValid&&!x.claimedUnsupportedPrimary),
    unsafeHolds:count(x=>!x.goldReviewSafe&&x.disposition==="hold_unsupported"&&!x.claimedUnsupportedPrimary)};
  return {status:"synthetic_prediction_scored_not_provider_proof" as const,
    cases:rows.length,rows,metrics:metric,
    passesSyntheticSafetyTripwire:metric.criticalFalseVerified===0&&metric.invalidCitations===0&&
      metric.unsupportedPrimaryClaims===0,
    falseHoldsMustBeReviewed:metric.falseHold>0,
    realModelInvokedByScorer:false as const,
    independentRealWorldAccuracyMeasured:false as const,
    productionReleaseAllowed:false as const,writesPerformed:false as const,
  };
}

/** Intended for local synthetic tests and future explicit provider adapter.
 * Exactly one complete fixed corpus per trial; output is aggregated without
 * logging raw model text, proprietary Vault material or user messages.
 */
export async function runM3ShadowWithInjectedCandidate(
  candidate:(input:M3ModelInput)=>Promise<unknown>,trialCount=3,
){
  corpusIntegrity();
  if(typeof candidate!=="function"||!Number.isInteger(trialCount)||trialCount<1||trialCount>5)
    throw Error("M3_SHADOW_CALLBACK_AND_BOUNDED_TRIALS_REQUIRED");
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("M3_SHADOW_CALLBACK_FORBIDDEN_IN_RAILWAY");
  const prompts=getM3ShadowModelInputs();
  const trials=[];
  for(let trial=0;trial<trialCount;trial++){
    const judgments=[];
    for(const prompt of prompts){
      // The callback is untrusted and may do I/O; this function is not a
      // provider attestation. No gold labels are included in `prompt`.
      const value=await candidate(prompt);
      const parsed=m3ShadowJudgmentSchema.parse(value);
      if(parsed.caseId!==prompt.id)throw Error("M3_SHADOW_PREDICTION_CASE_ID_MISMATCH");
      judgments.push(parsed);
    }
    trials.push(scoreM3ShadowJudgments(judgments));
  }
  return {status:"injected_candidate_trials_not_independent_model_evaluation" as const,
    policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
    trialCount,trials:trials.map((t,i)=>({trial:i+1,metrics:t.metrics,passesSyntheticSafetyTripwire:t.passesSyntheticSafetyTripwire})),
    responseSource:"injected_candidate_not_authenticated_provider" as const,
    realModelInvokedByHarness:false as const,independentRealWorldAccuracyMeasured:false as const,
    productionReleaseAllowed:false as const,writesPerformed:false as const};
}

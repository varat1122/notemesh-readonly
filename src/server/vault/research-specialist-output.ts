/**
 * Blueprint v1.0 §07.3 specialist output contract: pure checks, no Vault side
 * effects. Passing means the output is REVIEWABLE, not that its claims are true.
 * Specialists may share one model; disagreement is reported, never voted away.
 */
export type SpecialistRole="orchestrator"|"fundamental"|"industry_technology"|"supply_chain"|
  "macro_multi_asset"|"quant_statistical"|"momentum_technical"|"pharma_scientific"|
  "philosophy_lens"|"red_team"|"synthesis";

/** Evidence grades (§06.4). Only ai_inference may stand without a source id. */
export type ClaimOrigin="verified_primary"|"attributed_commentary"|"secondary_reporting"|
  "user_or_social"|"ai_inference";

export type ThesisImpact="new"|"confirmation"|"incremental"|"contradiction"|
  "thesis_changing"|"duplicate"|"none";

export type AbstainReason="missing_original_source"|"incompatible_dates_or_units"|
  "no_observed_customer_exposure"|"stale_pricing_data"|"unverified_model_computation";

export interface SpecialistClaim { statement:string; origin:ClaimOrigin; sourceIds:string[] }

export interface SpecialistEstimate {
  metric:string; period:string; value:string|null; unit:string|null;
  basis:"reported"|"management_guidance"|"broker"|"consensus"|"model";
  sourceIds:string[]; assumptions?:string[];
}

export interface SpecialistOutput {
  role:SpecialistRole;
  question:string;
  findings:string[];
  claims:SpecialistClaim[];
  mechanism:string;
  estimates:SpecialistEstimate[];
  counterEvidence:string[];
  uncertainties:string[];
  requiredEvidence:string[];
  confidenceBasis:string;
  asOf:string;
  horizon:"days"|"weeks"|"months"|"quarters"|"years"|"event_window";
  proposedThesisImpact:ThesisImpact;
  shouldAbstain:boolean;
  abstainReasons:AbstainReason[];
}

const ROLES:ReadonlySet<string>=new Set(["orchestrator","fundamental","industry_technology","supply_chain",
  "macro_multi_asset","quant_statistical","momentum_technical","pharma_scientific","philosophy_lens","red_team","synthesis"]);
const ORIGINS:ReadonlySet<string>=new Set(["verified_primary","attributed_commentary","secondary_reporting","user_or_social","ai_inference"]);
const IMPACTS:ReadonlySet<string>=new Set(["new","confirmation","incremental","contradiction","thesis_changing","duplicate","none"]);
const HORIZONS:ReadonlySet<string>=new Set(["days","weeks","months","quarters","years","event_window"]);
const ABSTAIN:ReadonlySet<string>=new Set(["missing_original_source","incompatible_dates_or_units",
  "no_observed_customer_exposure","stale_pricing_data","unverified_model_computation"]);
const BASES:ReadonlySet<string>=new Set(["reported","management_guidance","broker","consensus","model"]);

const nonblank=(s:unknown)=>typeof s==="string"&&s.trim().length>0;
const ids=(xs:unknown)=>Array.isArray(xs)&&xs.every(nonblank);
// A date or a timezone-qualified timestamp; a naive local time is ambiguous (§05.4).
// Date.parse rolls 2026-02-30 over to March, so the calendar day is round-tripped.
const isAsOf=(s:string)=>/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(s)&&
  !Number.isNaN(Date.parse(s.length===10?`${s}T00:00:00Z`:s))&&
  new Date(`${s.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10)===s.slice(0,10);

export function validateSpecialistOutput(o:SpecialistOutput):string[]{
  const issues:string[]=[];
  if(!ROLES.has(o.role))issues.push("role_unknown");
  if(!nonblank(o.question))issues.push("question_missing");
  if(!nonblank(o.asOf)||!isAsOf(o.asOf))issues.push("as_of_invalid");
  if(!HORIZONS.has(o.horizon))issues.push("horizon_unknown");
  if(!IMPACTS.has(o.proposedThesisImpact))issues.push("thesis_impact_unknown");
  if(!nonblank(o.confidenceBasis))issues.push("confidence_basis_missing");

  for(const c of o.claims){
    if(!nonblank(c.statement))issues.push("claim_statement_missing");
    if(!ORIGINS.has(c.origin))issues.push("claim_origin_unknown");
    if(!ids(c.sourceIds))issues.push("claim_source_ids_invalid");
    else if(c.origin!=="ai_inference"&&!c.sourceIds.length)issues.push("claim_without_source");
  }

  for(const e of o.estimates){
    if(!nonblank(e.metric)||!nonblank(e.period))issues.push("estimate_metric_or_period_missing");
    if(!BASES.has(e.basis))issues.push("estimate_basis_unknown");
    if(e.value!==null&&!nonblank(e.unit))issues.push("estimate_unit_missing");
    if(!ids(e.sourceIds))issues.push("estimate_source_ids_invalid");
    // No fake precision (P-09): a number is either sourced or an explicit model with stated assumptions.
    else if(e.value!==null&&e.basis!=="model"&&!e.sourceIds.length)issues.push("estimate_value_without_source");
    if(e.value!==null&&e.basis==="model"&&!(e.assumptions?.length&&e.assumptions.every(nonblank)))
      issues.push("model_estimate_without_assumptions");
  }

  if(o.shouldAbstain){
    if(!o.abstainReasons.length)issues.push("abstain_reason_missing");
    if(o.abstainReasons.some(r=>!ABSTAIN.has(r)))issues.push("abstain_reason_unknown");
    if(o.proposedThesisImpact!=="none")issues.push("abstain_must_not_propose_thesis_impact");
    if(o.estimates.some(e=>e.value!==null))issues.push("abstain_must_not_carry_estimates");
  }else{
    if(o.abstainReasons.length)issues.push("abstain_reasons_without_abstain");
    if(!nonblank(o.mechanism))issues.push("mechanism_missing");
    if(!o.findings.length||!o.findings.every(nonblank))issues.push("findings_missing");
    if(!o.counterEvidence.length||!o.counterEvidence.every(nonblank))issues.push("counter_evidence_missing");
    // A thesis change or contradiction cannot rest on AI inference alone.
    if((o.proposedThesisImpact==="thesis_changing"||o.proposedThesisImpact==="contradiction")&&
      !o.claims.some(c=>c.origin!=="ai_inference"&&c.sourceIds.length>0))
      issues.push("thesis_change_without_sourced_claim");
  }
  if(o.uncertainties.some(x=>!nonblank(x))||o.requiredEvidence.some(x=>!nonblank(x)))
    issues.push("blank_list_item");
  return [...new Set(issues)];
}

/**
 * Synthesis input: lists disagreements and counts evidence by distinct source id,
 * so several specialists citing one article are not read as independent support.
 */
export function compareSpecialistOutputs(outputs:SpecialistOutput[]){
  const impacts=new Map<string,SpecialistRole[]>();
  for(const o of outputs){
    const key=o.shouldAbstain?"abstained":o.proposedThesisImpact;
    impacts.set(key,[...(impacts.get(key)??[]),o.role]);
  }
  const citations=outputs.flatMap(o=>o.claims.flatMap(c=>c.sourceIds));
  const distinctSources=new Set(citations);
  return {
    impactsByRole:Object.fromEntries(impacts),
    disagreement:[...impacts.keys()].filter(k=>k!=="abstained").length>1,
    citationCount:citations.length,
    distinctSourceCount:distinctSources.size,
    sharedSourceIds:[...distinctSources].filter(id=>outputs.filter(o=>o.claims.some(c=>c.sourceIds.includes(id))).length>1),
  };
}

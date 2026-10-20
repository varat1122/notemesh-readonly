/**
 * PR #96 — offline, deterministic cross-claim arithmetic candidates.
 *
 * Runs PR #95 first: every SYNTH claim is physically/citation checked,
 * scoped to one declared issuer/event/source and retained for review.
 * Then assesses ONLY explicitly selected accounting identities, never
 * deriving causal effects, publisher authenticity, verified facts,
 * an owner decision, or a write permission from matching arithmetic.
 *
 * Gross margin = gross profit / revenue (with a disclosed rounding hold).
 * FCF = operating cash flow - capex cash-outflow magnitude ONLY when the
 * caller explicitly declares a nonnegative cash-outflow convention.
 *
 * Inputs are untrusted declared financial figures, not original filings.
 */
import {runOfflineSyntheticMultiClaimReview,
  type OfflineMultiClaimInput}
  from "./offline-synthetic-multi-claim-review";

type Claim=OfflineMultiClaimInput["claims"][number];
type CheckKind="gross_margin_identity"|"free_cash_flow_bridge";
export type EconomicCheck={
  kind:CheckKind;
  /** For GM [revenue, gross_profit, gross_margin];
   * for FCF [operating_cash_flow, capex, free_cash_flow]. */
  claimIndices:[number,number,number];
  /** Tolerance in the COMMON reporting monetary unit (e.g. USD millions).
   * Caller declared, bounded to <= 0.5 unit; NOT independently certified. */
  absoluteRoundingTolerance:string;
  /** Mandatory for FCF: capex given as a positive cash-outflow magnitude. */
  capexConvention?:"nonnegative_cash_outflow_magnitude";
};
export type OfflineEconomicConsistencyInput=OfflineMultiClaimInput&{
  checks:EconomicCheck[];
};
const DECIMAL=/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const FACTOR=1_000_000n;
function decimal(x:unknown):bigint{
  if(typeof x!=="string"||!DECIMAL.test(x))
    throw Error("economic_check_invalid_unverified_numeric_literal_hold");
  const negative=x.startsWith("-");
  const [whole,fraction=""]=(negative?x.slice(1):x).split(".");
  const out=BigInt(whole)*FACTOR+
    BigInt(fraction.padEnd(6,"0")||"0");
  return negative?-out:out;
}
const abs=(n:bigint)=>n<0n?-n:n;
const norm=(x:unknown)=>typeof x==="string"?
  x.trim().normalize("NFC").toLowerCase():"";
function inputFor(claim:Claim){
  return claim.candidate.source.review.evidence.incoming;
}
function validateCheck(input:OfflineEconomicConsistencyInput,
  check:EconomicCheck){
  if(!check||!["gross_margin_identity","free_cash_flow_bridge"].includes(
    check.kind)||!Array.isArray(check.claimIndices)||
    check.claimIndices.length!==3||
    new Set(check.claimIndices).size!==3||
    check.claimIndices.some(i=>!Number.isSafeInteger(i)||i<0||
      i>=input.claims.length))
    throw Error("economic_check_invalid_mapping_or_indices_hold");
  const tolerance=decimal(check.absoluteRoundingTolerance);
  if(tolerance<0n||tolerance>500_000n)
    throw Error("economic_check_unbounded_rounding_tolerance_hold");
  const selected=check.claimIndices.map(i=>inputFor(input.claims[i]));
  const expected=check.kind==="gross_margin_identity"?
    ["revenue","gross_profit","gross_margin"]:
    ["operating_cash_flow","capex","free_cash_flow"];
  if(selected.some((c,i)=>norm(c.metric)!==expected[i])||
    selected.some(c=>norm(c.period)!==norm(selected[0].period))||
    selected.some(c=>norm(c.period)==="")||
    norm(selected[0].unit)!==norm(selected[1].unit)|| 
    norm(selected[0].unit)==="%"||
    norm(selected[0].unit)===""||
    norm(selected[2].unit)!==(check.kind==="gross_margin_identity"?
      "%":norm(selected[0].unit)))
    throw Error("economic_check_metric_period_unit_mismatch_hold");
  if(check.kind==="gross_margin_identity"&&
    check.capexConvention!==undefined)
    throw Error("economic_check_unexpected_capex_convention_hold");
  if(check.kind==="free_cash_flow_bridge"&&
    check.capexConvention!=="nonnegative_cash_outflow_magnitude")
    throw Error("economic_check_capex_cash_sign_undefined_hold");
  // Refuse multiple conflicting same-dimension declarations as basis
  // for a supposedly single equation. PR #95 keeps them all; it is not
  // evidence-safe to pick one arbitrarily for mathematical compatibility.
  for(const c of selected){
    const peers=input.claims.filter(other=>{
      const v=inputFor(other);
      return norm(v.metric)===norm(c.metric)&&
        norm(v.period)===norm(c.period)&&
        norm(v.unit)===norm(c.unit);
    });
    if(peers.length!==1)
      throw Error("economic_check_ambiguous_repeated_financial_line_hold");
  }
  return {selected,tolerance};
}
type RelationStatus="arithmetically_compatible_not_fact_verified"|
  "discrepancy_exceeds_declared_tolerance_needs_review";
const CODE={
  gross_margin_identity:"gross_margin_revenue_profit_arithmetic_check",
  free_cash_flow_bridge:"fcf_ocf_less_positive_cash_capex_check",
} as const;
export function runOfflineSyntheticEconomicConsistency(
  input:OfflineEconomicConsistencyInput,
){
  if(!input||input.fixtureKind!=="synthetic_offline_test_only"||
    !Array.isArray(input.checks)||input.checks.length<1||
    input.checks.length>4)
    throw Error("economic_check_requires_bounded_explicit_rules_hold");
  const combinations=new Set<string>();
  // Validate all explicit mappings BEFORE invoking the source readback.
  const checks=input.checks.map(check=>{
    const data=validateCheck(input,check);
    const key=check.kind+":"+check.claimIndices.join(",");
    if(combinations.has(key))
      throw Error("economic_check_duplicate_declared_relationship_hold");
    combinations.add(key);
    const [a,b,c]=data.selected.map(x=>decimal(x.value));
    if(check.kind==="gross_margin_identity"&&a<=0n)
      throw Error("economic_check_revenue_must_be_positive_hold");
    if(check.kind==="free_cash_flow_bridge"&&b<0n)
      throw Error("economic_check_capex_magnitude_must_be_nonnegative_hold");
    // Fixed 6 decimal places. Round half away from zero to avoid binary
    // floating-point drift. Equality is still only between DECLARED values.
    let predicted:bigint;
    if(check.kind==="gross_margin_identity"){
      const numerator=a*c,denominator=100n*FACTOR;
      const rounded=(abs(numerator)+denominator/2n)/denominator;
      predicted=numerator<0n?-rounded:rounded;
    }else{
      predicted=a-b;
    }
    const difference=abs(predicted-(check.kind==="gross_margin_identity"?b:c));
    const status:RelationStatus=difference<=data.tolerance?
      "arithmetically_compatible_not_fact_verified":
      "discrepancy_exceeds_declared_tolerance_needs_review";
    return {
      kind:check.kind,claimIndices:[...check.claimIndices],
      status,formulaCode:CODE[check.kind],
      toleranceIsCallerDeclaredNotVerified:true as const,
      sourceDefinitionAndRoundingNotIndependentlyChecked:true as const,
    };
  });
  // PR #95 must succeed for ALL claims before any review candidate
  // escapes this function. No partial write, summary or approval.
  const base=runOfflineSyntheticMultiClaimReview(input);
  const derivedCodes=new Map<number,Set<string>>();
  for(const item of checks){
    if(item.status!=="discrepancy_exceeds_declared_tolerance_needs_review")
      continue;
    for(const index of item.claimIndices){
      const codes=derivedCodes.get(index)??new Set<string>();
      codes.add("declared_cross_claim_arithmetic_discrepancy_review");
      codes.add(item.formulaCode);
      derivedCodes.set(index,codes);
    }
  }
  const tasks=[...base.ownerPriority,...base.analystReview].map(task=>{
    const discrepant=derivedCodes.has(task.caseIndex);
    const priority=discrepant?1 as const:task.priority;
    return {
      ...task,priority,
      queue:discrepant?"owner_priority_unverified" as const:task.queue,
      reasonCodes:[...new Set([...task.reasonCodes,
        ...(derivedCodes.get(task.caseIndex)??[])])],
      economicConsistencyVerified:false as const,
      automaticEarningsOrValuationRevisionAllowed:false as const,
    };
  });
  tasks.sort((a,b)=>a.priority-b.priority||a.caseIndex-b.caseIndex);
  const ownerPriority=tasks.filter(t=>t.queue==="owner_priority_unverified");
  const analystReview=tasks.filter(t=>t.queue!=="owner_priority_unverified");
  if(ownerPriority.length+analystReview.length!==input.claims.length)
    throw Error("economic_check_claims_not_preserved_hold");
  return {
    status:"unverified_offline_economic_consistency_candidates_only" as const,
    checkedIdentities:checks,
    ownerPriority,analystReview,
    releaseReviewPriority:ownerPriority.length?
      "potentially_material_human_review_required" as const:
      "analyst_review_still_required" as const,
    counts:{
      claims:tasks.length,
      identitiesChecked:checks.length,
      arithmeticDiscrepancyCandidates:checks.filter(c=>
        c.status==="discrepancy_exceeds_declared_tolerance_needs_review").length,
      escalatedClaims:tasks.filter(t=>derivedCodes.has(t.caseIndex)).length,
      automaticallyDiscarded:0 as const,
      automaticallyWritten:0 as const,
    },
    onlyExplicitAlgebraChecked:true as const,
    noEconomicCausalityInferred:true as const,
    figuresAndSourceDefinitionsIndependentlyVerified:false as const,
    independentlyAuthorizedProtectedDataAccess:false as const,
    semanticInvestmentThesisReviewed:false as const,
    modelInvoked:false as const,
    sourceProvenanceAuthenticated:false as const,
    realOwnerNotificationDelivered:false as const,
    protectedNotesSourceUrlsAndClaimValuesReturned:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    productionReleaseAllowed:false as const,
    vaultModified:false as const,
  };
}

/** Bounded Draft eligibility policy. Called only after server packet authentication.
 * This module is independently testable from the existing seal/receipt lifecycle.
 * Wire/binding primitives have no runtime dependency on the evaluator. */
import {DRAFT_RISK_POLICY,draftRiskAssessmentSchema,riskDimensions,judgeHash,stableJudgeJson,exactTextReference,type JudgeResult} from "./research-judge-contract";
import type {PacketBody} from "./research-judge";

/** A sealed inventory prevents omitted fields/claims from shrinking the assessed
 * text scope. Matching this inventory proves binding, never that an analyst read
 * or correctly understood it. Numeric abstention is deliberately conservative. */
export function draftRiskScope(body:PacketBody){
  const items=[{key:"received_source",sha256:body.source.sha256},
    {key:"proposed_review",sha256:body.reviewDigest},
    // Broker metadata is rendered separately from typed Review prose. Bind its
    // presence/absence and source kind, not just the prose selected by a caller.
    {key:"broker_provenance",sha256:judgeHash(stableJudgeJson({sourceKind:body.provenance.sourceKind,brokerVintage:body.provenance.brokerVintage}))},
    ...body.claims.map(c=>({key:c.key,sha256:judgeHash(stableJudgeJson(c.candidate))})),
    ...body.relationships.map(c=>({key:c.key,sha256:judgeHash(stableJudgeJson(c.candidate))})),
    ...body.history.map(h=>({key:h.key,sha256:h.sha256}))];
  return {digest:judgeHash(stableJudgeJson(items)),items};
}
/** Shared by evaluation and restrictive pre-SDK withdrawal. Never grants write
 * authority itself; semantic PASS, actor/seal, freshness, receipts and CAS remain
 * mandatory. No financial keywords, model calls, or fabricated critic identity. */
export function judgeDraftRisk(body:PacketBody,result:JudgeResult,envelopeDigest:string){
  const reasons:string[]=[],risk=draftRiskAssessmentSchema.safeParse(result.riskAssessment);
  let criticRequired=false,failed=false;
  const hold=(reason:string)=>reasons.push(reason);
  if(result.packetEnvelopeDigest!==envelopeDigest)hold("draft_risk_exact_envelope_required");
  if(body.riskPolicy!==DRAFT_RISK_POLICY||!body.riskScope||stableJudgeJson(body.riskScope)!==stableJudgeJson(draftRiskScope(body)))hold("draft_risk_policy_or_scope_hold");
  if(!risk.success)hold("draft_risk_assessment_required");
  else{
    const r=risk.data,scope=body.riskScope;
    if(!scope||r.scopeDigest!==scope.digest||r.coveredKeys.length!==scope.items.length||new Set(r.coveredKeys).size!==r.coveredKeys.length||scope.items.some(x=>!r.coveredKeys.includes(x.key)))hold("draft_risk_coverage_hold");
    if(new Set(r.findings.map(x=>x.dimension)).size!==riskDimensions.length)hold("draft_risk_dimensions_hold");
    for(const f of r.findings){
      if(f.disposition!=="absent"){criticRequired=true;hold("draft_risk_"+f.disposition);if(f.disposition==="unsupported")failed=true;}
      const source=f.references.some(ref=>ref.key==="received_source"&&exactTextReference(ref,body.source.text,body.source.sha256));
      const historical=f.references.some(ref=>body.history.some(h=>h.key===ref.key&&h.sourceReceiptKey&&
        ref.sourceSha256===h.sha256&&h.citationSpans.some(s=>ref.locator===`utf16:${s.start}:${s.end}`&&ref.quote===s.text&&!!ref.quote.trim())));
      if(!source||!historical)hold("draft_risk_source_history_basis_hold");
      for(const ref of f.references){
        if(ref.key==="received_source"){if(!exactTextReference(ref,body.source.text,body.source.sha256))hold("draft_risk_citation_hold");}
        else if(!body.history.some(h=>h.key===ref.key&&ref.sourceSha256===h.sha256&&h.citationSpans.some(s=>ref.locator===`utf16:${s.start}:${s.end}`&&ref.quote===s.text&&!!ref.quote.trim())))hold("draft_risk_citation_hold");
      }
    }
  }
  // Scan the full received text, rendered broker metadata and every proposed
  // Review/Claim/relationship value, not merely selected claims or citations. This
  // policy abstains on quantitative content; it does NOT infer financial risk.
  const strings=(x:unknown):string[]=>typeof x==="string"?[x]:Array.isArray(x)?x.flatMap(strings):x&&typeof x==="object"?Object.values(x).flatMap(strings):[];
  if([body.source.text,...strings(body.proposedThaiReview),...strings(body.provenance.brokerVintage),...body.claims.flatMap(c=>strings(c.candidate)),...body.relationships.flatMap(c=>strings(c.candidate))].some(s=>/\p{N}/u.test(s))){
    criticRequired=true;hold("draft_risk_quantitative_scope_not_supported");
  }
  // Every brokerUpdate is sealed as brokerVintage. Qualitative rating changes
  // and omitted contentTypes must never bypass the broker/critic boundary.
  if(body.provenance.brokerVintage!=null||body.provenance.sourceKind==="broker_research"){
    criticRequired=true;hold("draft_risk_broker_scope");
  }
  if(result.materialRisk||result.event.classification!=="added_detail"){
    criticRequired=true;hold("draft_risk_not_routine_added_detail");
  }
  if(Array.isArray(body.scope.contentTypes)&&body.scope.contentTypes.some(t=>["earnings","guidance","broker_rating","broker_price_target","broker_estimate","portfolio_snapshot"].includes(String(t)))||
    body.claims.some(c=>["management_guidance","analyst_estimate"].includes(String((c.candidate as {evidenceClass?:unknown})?.evidenceClass)))||
    ((body.proposedThaiReview as {claimAssessments?:{resolution?:string}[]})?.claimAssessments??[]).some(c=>c.resolution==="unresolved")||
    body.relationships.some(c=>["supplier","customer"].includes(String((c.candidate as {role?:unknown})?.role)))){
    criticRequired=true;hold("draft_risk_declared_material_scope");
  }
  if(criticRequired)hold("independent_critic_provenance_unavailable");
  return {policy:DRAFT_RISK_POLICY,decision:failed?"FAIL" as const:reasons.length?"HOLD" as const:"PASS" as const,
    reasons:[...new Set(reasons)],criticRequired,authority:"analyst_attested_only" as const};
}

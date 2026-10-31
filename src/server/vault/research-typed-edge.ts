/**
 * Blueprint v1.0 §08 / ADR-006 stage A: typed relationship contract, pure
 * checks only. A Wikilink is not an economic relationship; an edge passing
 * here is REVIEWABLE, and only `canAutoPersist` edges skip human review.
 * Edges are retracted or superseded, never deleted.
 */
import { isAsOf, type ClaimOrigin } from "./research-specialist-output";

export type NodeKind="company"|"industry"|"technology"|"product"|"macro"|"source"|"claim"|
  "thesis"|"review"|"signal"|"trade_setup"|"decision";

export type Predicate="issuer_of"|"source_supports_claim"|"source_contradicts_claim"|"claim_updates_thesis"|
  "company_operates_in_industry"|"company_offers_product"|"product_competes_with"|
  "supplier_to"|"customer_of"|"partner_of"|
  "potential_beneficiary_of"|"potential_risk_from"|
  "technology_enables"|"technology_substitutes"|"industry_exposed_to_macro"|
  "review_related_to"|"quant_signal_applies_to"|"trade_setup_for"|"decision_references_thesis";

export interface TypedEdge {
  edgeId:string;
  subject:string;               // "<kind>:<id>", e.g. company:COHR
  predicate:Predicate;
  object:string;
  assertionOrigin:ClaimOrigin;
  evidenceSourceIds:string[];
  mechanism:string;
  verification:"unverified"|"verified"|"rejected"|"contradicted";
  strength:"possible"|"probable"|"confirmed";
  eventAt:string|null;
  validFrom:string|null;
  validTo:string|null;
  reviewBy:string|null;
  linkPolicy:"proposed_only"|"auto_persist"|"owner_approval";
  lifecycle:"active"|"retracted"|"superseded";
  supersededBy?:string;
  retractionReason?:string;
}

const ANY_MARKET:NodeKind[]=["company","industry","technology","product","macro"];
/** Allowed [subject kinds, object kinds] per predicate (§08.2). */
const SHAPES:Readonly<Record<Predicate,readonly [readonly NodeKind[],readonly NodeKind[]]>>={
  issuer_of:[["company"],["source","claim"]],
  source_supports_claim:[["source"],["claim"]],
  source_contradicts_claim:[["source"],["claim"]],
  claim_updates_thesis:[["claim"],["thesis"]],
  company_operates_in_industry:[["company"],["industry"]],
  company_offers_product:[["company"],["product"]],
  product_competes_with:[["product"],["product"]],
  supplier_to:[["company"],["company"]],
  customer_of:[["company"],["company"]],
  partner_of:[["company"],["company"]],
  potential_beneficiary_of:[["company","industry"],["technology","macro","industry","product","company"]],
  potential_risk_from:[["company","industry"],["technology","macro","industry","product","company"]],
  technology_enables:[["technology"],["product","technology","industry"]],
  technology_substitutes:[["technology"],["technology","product"]],
  industry_exposed_to_macro:[["industry"],["macro"]],
  review_related_to:[["review"],ANY_MARKET],
  quant_signal_applies_to:[["signal"],["company","industry","macro"]],
  trade_setup_for:[["trade_setup"],["company","industry","macro"]],
  decision_references_thesis:[["decision"],["thesis"]],
};
/** Commercial relationships need an attributed source before they are verified (§08.2). */
const ATTRIBUTED_ONLY:ReadonlySet<Predicate>=new Set(["supplier_to","customer_of","partner_of"]);
/** Hypotheses by default; never auto-promoted (§08.4.3). */
const HYPOTHESIS:ReadonlySet<Predicate>=new Set(["potential_beneficiary_of","potential_risk_from"]);
/** Touch protected Thesis/Decision state (§08.4.5). */
const PROTECTED:ReadonlySet<Predicate>=new Set(["claim_updates_thesis","decision_references_thesis"]);
/** Citations, identity and taxonomy: the only edges that may persist without review (§08.4.1–2). */
const AUTO_PERSISTABLE:ReadonlySet<Predicate>=new Set(["issuer_of","source_supports_claim",
  "source_contradicts_claim","company_operates_in_industry","review_related_to"]);
const INDEPENDENT:ReadonlySet<ClaimOrigin>=new Set(["verified_primary","attributed_commentary","secondary_reporting"]);

const nonblank=(s:unknown)=>typeof s==="string"&&s.trim().length>0;
const KINDS:ReadonlySet<string>=new Set(["company","industry","technology","product","macro",
  "source","claim","thesis","review","signal","trade_setup","decision"]);
const node=(s:string)=>{
  const m=/^([a-z_]+):(\S(?:.*\S)?)$/.exec(s);
  return m&&KINDS.has(m[1])?{kind:m[1] as NodeKind,id:m[2]}:null;
};
const dateOk=(s:string|null)=>s===null||isAsOf(s);
const instant=(s:string)=>Date.parse(s.length===10?`${s}T00:00:00Z`:s);

export function validateTypedEdge(e:TypedEdge):string[]{
  const issues:string[]=[];
  if(!nonblank(e.edgeId))issues.push("edge_id_missing");
  const shape=SHAPES[e.predicate];
  const s=node(e.subject),o=node(e.object);
  if(!shape)issues.push("predicate_unknown");
  if(!s)issues.push("subject_invalid");
  if(!o)issues.push("object_invalid");
  if(shape&&s&&!shape[0].includes(s.kind))issues.push("subject_kind_not_allowed");
  if(shape&&o&&!shape[1].includes(o.kind))issues.push("object_kind_not_allowed");
  if(s&&o&&e.subject===e.object)issues.push("self_edge");
  if(!nonblank(e.mechanism))issues.push("mechanism_missing");
  if(!Array.isArray(e.evidenceSourceIds)||!e.evidenceSourceIds.every(nonblank))issues.push("evidence_ids_invalid");
  const evidence=Array.isArray(e.evidenceSourceIds)&&e.evidenceSourceIds.length>0;

  if(e.verification==="verified"){
    if(!evidence)issues.push("verified_without_evidence");
    if(e.assertionOrigin==="ai_inference")issues.push("ai_inference_cannot_be_verified");
    if(ATTRIBUTED_ONLY.has(e.predicate)&&!INDEPENDENT.has(e.assertionOrigin))
      issues.push("commercial_relationship_needs_attributed_source");
  }
  if(e.strength==="confirmed"&&e.verification!=="verified")issues.push("confirmed_requires_verified");
  if(HYPOTHESIS.has(e.predicate)&&e.strength==="confirmed")issues.push("hypothesis_predicate_cannot_be_confirmed");
  if(e.verification==="unverified"&&e.lifecycle==="active"&&!nonblank(e.reviewBy))issues.push("review_by_missing");

  if(e.linkPolicy==="auto_persist"&&!canAutoPersist(e))issues.push("auto_persist_not_permitted");
  if(PROTECTED.has(e.predicate)&&e.linkPolicy!=="owner_approval")issues.push("protected_edge_requires_owner_approval");

  if(!dateOk(e.eventAt)||!dateOk(e.validFrom)||!dateOk(e.validTo)||!dateOk(e.reviewBy))issues.push("date_invalid");
  else if(e.validFrom&&e.validTo&&instant(e.validFrom)>instant(e.validTo))issues.push("valid_range_inverted");

  if(e.lifecycle==="superseded"&&(!nonblank(e.supersededBy)||e.supersededBy===e.edgeId))issues.push("superseded_by_missing");
  if(e.lifecycle==="retracted"&&!nonblank(e.retractionReason))issues.push("retraction_reason_missing");
  if(e.lifecycle==="active"&&(e.supersededBy||e.retractionReason))issues.push("active_edge_has_lifecycle_fields");
  return [...new Set(issues)];
}

/** §08.4.1–2: only verified, evidenced citation/identity/taxonomy edges from a non-AI origin. */
export function canAutoPersist(e:TypedEdge):boolean{
  return AUTO_PERSISTABLE.has(e.predicate)&&e.verification==="verified"&&e.lifecycle==="active"&&
    e.assertionOrigin!=="ai_inference"&&e.assertionOrigin!=="user_or_social"&&
    Array.isArray(e.evidenceSourceIds)&&e.evidenceSourceIds.length>0;
}

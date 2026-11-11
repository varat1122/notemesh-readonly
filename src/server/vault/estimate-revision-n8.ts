/** IOS-ORCH-RI-001 / N8: bounded read-only comparison of two persisted,
 * attributed estimate claims. Integrity of bytes is not truth of estimates. */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {readPersistedClaim} from "./canonical-claims";
import {estimateSchema,accountingBasisSchema} from "./claim-dimensions";
import {indexedRead,publicationWindow} from "./investment-research-context";
import {buildInvestmentContextPack} from "./investment-context";
import {retrievalOperationallyComplete} from "./investment-retrieval-coverage";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {hubIdentityKey,validHubIdentityLabel} from "./investment-routing-v2";
import {splitFrontmatter} from "./markdown";

export const ESTIMATE_REVISION_METHOD="IOS-RI001-N8-READONLY-1";
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const reference=z.object({
  path:z.string().min(1).max(300).describe("Exact persisted generated Structured Claim path; no arbitrary note or user-declared facts"),
  noteSha256:z.string().regex(/^[a-f0-9]{64}$/).describe("SHA-256 of the exact existing claim note bytes, not of the statement or extracted PDF")
}).strict();
export const estimateRevisionInputSchema=z.object({
  earlier:reference.describe("Earlier persisted claim and exact note SHA-256"),
  later:reference.describe("Later persisted claim and exact note SHA-256"),
  asOf:z.string().datetime({offset:true}).optional().describe("Optional offset-aware cutoff for server-recorded bytes and declared publications; current-index filter, NOT historical reconstruction")
}).strict();
export type EstimateRevisionInput=z.infer<typeof estimateRevisionInputSchema>;
type Estimate=z.infer<typeof estimateSchema>;
type Basis=z.infer<typeof accountingBasisSchema>;
export interface EstimateRevisionRecord{
  path:string;noteSha256:string;claimId:string;intakeId:string;sourcePath:string;sourceNoteSha256:string;
  claimReceiptId:string;sourceReceiptId:string;claimRecordedAt:string;sourceRecordedAt:string;
  entity:string;metric:string;period:string;unit:string;value:string;
  estimate:Estimate|null;accountingBasis:Basis|null;sourcePublicationDate:string|null;
  sourceEventDate:string|null;sourceKind:string|null;sourceTextSha256:string|null;
  sourceExcerpt:string;sourceLocator:string;reviewReferences:string[];
  originalSourceUrl:string|null;originalDocumentAuthenticated:false;pdfLocatorVerified:false;
}
export interface EstimateRevisionPreview{
  methodVersion:typeof ESTIMATE_REVISION_METHOD;
  status:"revision_candidate_pending_semantic_review"|"no_change_candidate_pending_semantic_review"|"hold";
  issues:string[];earlier:EstimateRevisionRecord|null;later:EstimateRevisionRecord|null;
  comparison:{oldValue:string;newValue:string;unit:string;absoluteDelta:string;percentageDelta:string|null;
    percentageDefinition:"(new - old) / abs(old) * 100; rounded to 2 decimal places";metric:string;period:string;
    estimateRole:"broker_estimate"|"consensus";provider:string;oldVintage:string;newVintage:string}|null;
  identityNavigation:{status:string;hubPath:string|null};
  asOf:string|null;historicalView:"current_index"|"availability_bounded_current_index";
  sourceAuthenticityVerified:false;semanticFidelity:"not_assessed";publisherIdentityVerified:false;
  independentEvidenceIncrement:0;economicForecastVerified:false;priceInAssessed:false;
  canAutoWrite:false;canEditThesis:false;canEditPortfolio:false;
  limitations:string[];
}
const norm=(s:string)=>s.normalize("NFC").trim().toLowerCase().replace(/\s+/g," ");
const isoDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
function exactFts(path:string,body:string){
  const row=db().prepare("SELECT notes_fts.body AS body FROM notes JOIN notes_fts ON notes.rowid=notes_fts.rowid WHERE notes.path=? AND notes_fts.path=? LIMIT 1")
    .get(path,path) as {body:string}|undefined;
  if(!row||row.body!==body)throw Error("n8_index_body_mismatch");
}
function persistedAt(id:string,raw:string):string{
  const row=db().prepare("SELECT after_text,after_hash,receipt FROM safe_edit_operations WHERE id=? AND status='written'")
    .get(id) as {after_text:string;after_hash:string;receipt:string|null}|undefined;
  if(!row||row.after_text!==raw||row.after_hash!==sha(raw)||!row.receipt)throw Error("n8_receipt_readback_mismatch");
  const receipt:unknown=JSON.parse(row.receipt);
  const value=receipt&&typeof receipt==="object"?(receipt as Record<string,unknown>).writtenAt:null;
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||
    !Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw Error("n8_receipt_time_invalid");
  return value;
}
function load(ref:EstimateRevisionInput["earlier"]):EstimateRevisionRecord{
  const bound=readPersistedClaim(ref.path);
  if(bound.scope.domain!=="company"||sha(bound.readbackText)!==ref.noteSha256)throw Error("n8_claim_identity_or_hash_hold");
  const fm=splitFrontmatter(bound.readbackText).data;
  const source=indexedRead(bound.sourcePath);
  exactFts(ref.path,splitFrontmatter(bound.readbackText).body);
  exactFts(bound.sourcePath,source.body);
  const meta=inspectCanonicalKnowledgeMetadata(bound.sourcePath,source.fm);
  if(meta.warnings.some(w=>w==="invalid_published_at"||w==="invalid_event_date")||
    fm.published_at!==source.fm.published_at||fm.event_date!==source.fm.event_date)
    throw Error("n8_source_claim_chronology_mismatch");
  const c=bound.claim;
  const estimate=c.estimate?estimateSchema.parse(c.estimate):null;
  const basis=c.accounting_basis?accountingBasisSchema.parse(c.accounting_basis):null;
  const claimRecordedAt=persistedAt(bound.receiptKey,bound.readbackText);
  const sourceRecordedAt=persistedAt(bound.sourceReceiptKey,source.raw);
  return {path:ref.path,noteSha256:ref.noteSha256,claimId:String(c.claim_id),intakeId:bound.intakeId,
    sourcePath:bound.sourcePath,sourceNoteSha256:sha(source.raw),claimReceiptId:bound.receiptKey,sourceReceiptId:bound.sourceReceiptKey,
    claimRecordedAt,sourceRecordedAt,entity:bound.scope.entity,metric:String(c.metric),period:String(c.period),
    unit:String(c.unit),value:String(c.value),estimate,accountingBasis:basis,
    sourcePublicationDate:meta.publishedAt,sourceEventDate:meta.eventDate,
    sourceKind:typeof source.fm.source_kind==="string"?source.fm.source_kind:null,
    sourceTextSha256:typeof source.fm.source_text_sha256==="string"?source.fm.source_text_sha256:null,
    sourceExcerpt:String(c.source_excerpt),sourceLocator:String(c.source_locator),
    reviewReferences:bound.reviewReferences.slice(0,8),originalSourceUrl:typeof c.original_source==="string"?c.original_source:null,
    originalDocumentAuthenticated:false,pdfLocatorVerified:false};
}
type Decimal={integer:bigint;places:number};
function decimal(s:string):Decimal|null{
  // No currency conversion, ranges, scientific notation, percentage signs,
  // accounting parentheses or silent grouping guesses.
  if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(s)||s.length>48)return null;
  const sign=s.startsWith("-")?-1n:1n,raw=s.replace(/^[+-]/,"").replace(/,/g,"");
  const [whole,fraction=""]=raw.split(".");
  if(whole.length+fraction.length>35)return null;
  return {integer:sign*BigInt(whole+fraction),places:fraction.length};
}
function printDecimal(value:bigint,places:number):string{
  const negative=value<0n,abs=negative?-value:value,scale=10n**BigInt(places);
  const whole=(abs/scale).toString(),fraction=places?(abs%scale).toString().padStart(places,"0").replace(/0+$/,""):"";
  return (negative?"-":"")+whole+(fraction?"."+fraction:"");
}
function calculate(oldValue:string,newValue:string){
  const old=decimal(oldValue),current=decimal(newValue);
  if(!old||!current)return null;
  const places=Math.max(old.places,current.places),o=old.integer*10n**BigInt(places-old.places),
    n=current.integer*10n**BigInt(places-current.places),difference=n-o,absO=o<0n?-o:o;
  let percentageDelta:string|null=null;
  if(absO!==0n){
    const absDiff=difference<0n?-difference:difference;
    const hundredths=(absDiff*10000n+absO/2n)/absO;
    percentageDelta=(difference<0n?"-":"")+(hundredths/100n)+"."+
      (hundredths%100n).toString().padStart(2,"0")+"%";
  }
  return {absoluteDelta:printDecimal(difference,places),percentageDelta,unchanged:difference===0n};
}
const limitations=[
  "This compares two existing user/analyst-attributed structured claims; source/claim receipts establish local bytes, not issuer or broker authenticity.",
  "Issuer Hub resolution is current navigational context only; legal issuer, listing, ADR/DR and historical identity remain unadjudicated.",
  "Matching broker/consensus role, provider, metric, reporting period, unit and explicitly declared accounting basis is a deterministic comparison prerequisite, not semantic equivalence proof.",
  "Publication and estimate-vintage labels are source-declared. asOf filters current-index availability using server-recorded bytes; it does not reconstruct what markets or IOS knew historically.",
  "PDF page/table/footnote locators remain caller-attributed, not visually inspected; no archived original PDF is established by this preview.",
  "A no-change result does not certify a repeated price-target recommendation or consensus. No financial projection, thesis, valuation or protected record is written."
];
export function previewEstimateRevision(raw:unknown):EstimateRevisionPreview{
  const input=estimateRevisionInputSchema.parse(raw),issues:string[]=[];
  let earlier:EstimateRevisionRecord|null=null,later:EstimateRevisionRecord|null=null;
  try{earlier=load(input.earlier);}catch{issues.push("n8_earlier_claim_receipt_or_readback_hold");}
  try{later=load(input.later);}catch{issues.push("n8_later_claim_receipt_or_readback_hold");}
  const identityNavigation={status:"not_checked",hubPath:null as string|null};
  const base={methodVersion:ESTIMATE_REVISION_METHOD as typeof ESTIMATE_REVISION_METHOD,asOf:input.asOf??null,
    historicalView:input.asOf?"availability_bounded_current_index" as const:"current_index" as const,
    sourceAuthenticityVerified:false as const,semanticFidelity:"not_assessed" as const,publisherIdentityVerified:false as const,
    independentEvidenceIncrement:0 as const,economicForecastVerified:false as const,priceInAssessed:false as const,
    canAutoWrite:false as const,canEditThesis:false as const,canEditPortfolio:false as const,limitations};
  if(earlier&&later){
    if(earlier.path===later.path||earlier.sourcePath===later.sourcePath)issues.push("n8_distinct_reports_required");
    if(!validHubIdentityLabel(earlier.entity)||hubIdentityKey(earlier.entity)!==hubIdentityKey(later.entity))
      issues.push("n8_company_entity_mismatch");
    else try{
      const pack=buildInvestmentContextPack({question:`Compare attributed estimate revisions for ${earlier.entity} ${earlier.metric} ${earlier.period}`,
        issuers:[earlier.entity],focus:"broker",maxNotes:5,maxChars:4500});
      const resolved=pack.issuerResolution.find(x=>hubIdentityKey(x.requested)===hubIdentityKey(earlier!.entity));
      identityNavigation.status=resolved?.status??"not_found";identityNavigation.hubPath=resolved?.hubPath??null;
      if(!resolved||!["exact_existing_title","indexed_alias"].includes(resolved.status)||!resolved.hubPath||
        !retrievalOperationallyComplete(pack.retrieval))issues.push("n8_current_hub_or_retrieval_hold");
    }catch{issues.push("n8_current_hub_or_retrieval_hold");}
    if(norm(earlier.metric)!==norm(later.metric))issues.push("n8_metric_mismatch");
    if(norm(earlier.period)!==norm(later.period))issues.push("n8_reporting_period_mismatch");
    if(norm(earlier.unit)!==norm(later.unit))issues.push("n8_unit_mismatch_no_conversion");
    if(earlier.sourceKind!=="broker_research"||later.sourceKind!=="broker_research")issues.push("n8_broker_source_classification_required");
    const a=earlier.estimate,b=later.estimate;
    if(!a||!b||a.role!=="broker_estimate"||b.role!=="broker_estimate"||!a.provider||!b.provider||
      !a.forecastVintage||!b.forecastVintage)issues.push("n8_broker_identity_incomplete");
    else{
      if(norm(a.provider)!==norm(b.provider))issues.push("n8_provider_mismatch");
      if(!isoDate(a.forecastVintage)||!isoDate(b.forecastVintage)||a.forecastVintage>=b.forecastVintage)
        issues.push("n8_forecast_vintage_order_invalid");
    }
    const ab=earlier.accountingBasis,bb=later.accountingBasis;
    if(!ab||!bb||Object.values(ab).some(v=>!v)||Object.values(bb).some(v=>!v))
      issues.push("n8_accounting_basis_incomplete");
    else if(["standard","shareBasis","scope","definition"].some(k=>norm(ab[k as keyof Basis]!)!==norm(bb[k as keyof Basis]!)))
      issues.push("n8_accounting_basis_mismatch");
    if(!earlier.sourcePublicationDate||!later.sourcePublicationDate)issues.push("n8_publication_date_unknown");
    else if(publicationWindow(earlier.sourcePublicationDate)![0]>publicationWindow(later.sourcePublicationDate)![1])
      issues.push("n8_publication_order_conflict");
    // A forecast *vintage* is the as-of date of an issued estimate, not the
    // fiscal period being forecast. A future-dated estimate cannot have been
    // published in an earlier report, even if both caller labels match.
    // Date-only claims use their stated civil calendar day; never fill the gap
    // from the Source receipt or file creation time.
    for(const record of [earlier,later]){
      if(record.estimate?.forecastVintage&&isoDate(record.estimate.forecastVintage)&&
        record.sourcePublicationDate&&record.estimate.forecastVintage>record.sourcePublicationDate.slice(0,10))
        issues.push("n8_estimate_vintage_postdates_publication");
    }
    if(input.asOf){
      const cutoff=Date.parse(input.asOf);
      for(const record of [earlier,later]){
        if(Date.parse(record.claimRecordedAt)>cutoff||Date.parse(record.sourceRecordedAt)>cutoff||
          record.sourcePublicationDate&&publicationWindow(record.sourcePublicationDate)![1]>cutoff||
          record.estimate?.forecastVintage&&isoDate(record.estimate.forecastVintage)&&
            publicationWindow(record.estimate.forecastVintage)![1]>cutoff)
          issues.push("n8_evidence_not_available_by_cutoff");
      }
    }
  }
  const numbers=earlier&&later?calculate(earlier.value,later.value):null;
  if(earlier&&later&&!numbers)issues.push("n8_noncomparable_decimal_values");
  const hold=issues.length>0;
  const comparison=hold||!earlier||!later||!numbers?null:{
    oldValue:earlier.value,newValue:later.value,unit:earlier.unit,absoluteDelta:numbers.absoluteDelta,
    percentageDelta:numbers.percentageDelta,percentageDefinition:"(new - old) / abs(old) * 100; rounded to 2 decimal places" as const,
    metric:earlier.metric,period:earlier.period,estimateRole:"broker_estimate" as const,
    provider:earlier.estimate!.provider!,oldVintage:earlier.estimate!.forecastVintage!,newVintage:later.estimate!.forecastVintage!};
  return {...base,status:hold?"hold":numbers!.unchanged?"no_change_candidate_pending_semantic_review":"revision_candidate_pending_semantic_review",
    issues:[...new Set(issues)],earlier:hold?null:earlier,later:hold?null:later,comparison,identityNavigation};
}

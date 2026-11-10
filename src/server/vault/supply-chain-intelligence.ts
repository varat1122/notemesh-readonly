/** N7 read-only relationship preview. Exact references are a persistence and
 * relevance check, never a semantic, commercial or investment adjudication. */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {canonicalSourceUrl} from "../source-url";
import {buildInvestmentContextPack,type IssuerResolution} from "./investment-context";
import {retrievalOperationallyComplete} from "./investment-retrieval-coverage";
import {createReceipt,indexedRead,publicationWindow} from "./investment-research-context";
import {m2HistoricalRefSchema,m2SourceQuoteRefSchema,preservedSubmittedText} from "./research-decision-v2";
import {readPersistedClaim} from "./canonical-claims";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {hubIdentityKey,validHubIdentityLabel} from "./investment-routing-v2";
import {researchTrust,type ResearchTrust} from "./research-state";
import {splitFrontmatter} from "./markdown";

export const SUPPLY_CHAIN_METHOD_VERSION="IOS-RI001-N7-PREVIEW-1";
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const label=z.string().trim().min(1).max(120);
const calendarDate=z.string().refine(s=>{
  const d=new Date(s+"T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
},"Invalid calendar date");
const stage=z.enum(["materials","equipment","components","systems","infrastructure","applications","customer_demand","unknown"]);
export const supplyChainEvidenceRefSchema=m2SourceQuoteRefSchema.extend({
  claimRef:m2HistoricalRefSchema.optional(),reviewRef:m2HistoricalRefSchema.optional()
}).strict();
export const supplyChainCandidateSchema=z.object({
  localKey:z.string().regex(/^[a-z][a-z0-9_-]{1,50}$/),subject:label,object:label,
  predicate:z.enum(["supplier_to","customer_of","partner_of","competes_with","technology_enables","sector_co_exposure","potential_beneficiary_of"]),
  direction:z.enum(["subject_to_object","bidirectional"]),
  assertionOrigin:z.enum(["source_statement","analyst_interpretation","archived_ai","co_mention"]),
  lifecycle:z.enum(["active","contradicted","retracted","correction"]),
  sourceRefs:z.array(supplyChainEvidenceRefSchema).min(1).max(4),
  counterEvidenceRefs:z.array(supplyChainEvidenceRefSchema).max(4),
  relatedEvidenceRefs:z.array(supplyChainEvidenceRefSchema).max(4),
  mechanism:z.string().trim().min(1).max(1500),confidenceBasis:z.string().trim().min(1).max(1000),
  invalidation:z.string().trim().min(1).max(1000),ambiguity:z.string().max(1000).nullable(),
  validity:z.object({from:calendarDate.nullable(),to:calendarDate.nullable()}).strict(),
  estimateVintage:calendarDate.nullable().optional(),
  valueChain:z.object({subjectStage:stage,objectStage:stage}).strict(),
  transmission:z.array(z.object({stage:z.enum(["revenue_conversion","gross_profit","operating_profit","earnings","ocf_fcf_roic"]),
    mechanism:z.string().trim().min(1).max(1000),magnitude:z.string().max(160).nullable()}).strict()).max(5)
}).strict();
/** Keep an object schema: the existing MCP registry consumes .shape. */
export const supplyChainInputSchema=z.object({
  question:z.string().trim().min(3).max(1200),issuers:z.array(label).min(1).max(6),
  industry:z.string().trim().min(1).max(140).optional(),asOf:z.string().datetime({offset:true}).optional(),
  candidates:z.array(supplyChainCandidateSchema).max(8).optional()
}).strict();
export type SupplyChainInput=z.infer<typeof supplyChainInputSchema>;
export type SupplyChainCandidate=z.infer<typeof supplyChainCandidateSchema>;
export type SupplyChainEvidenceRef=z.infer<typeof supplyChainEvidenceRefSchema>;
type Proposal=Omit<SupplyChainCandidate,"sourceRefs"|"counterEvidenceRefs"|"relatedEvidenceRefs"|"transmission">&{
  proposalOrigin:"caller_supplied_reasoning";
  transmission:Array<{stage:SupplyChainCandidate["transmission"][number]["stage"];mechanism:string;proposedMagnitude:string|null}>;
};
interface PersistedReference {path:string;noteSha256:string;receiptId:string;recordedAt:string|null}
export interface SupplyChainEvidenceBinding {
  role:"support"|"counter"|"lifecycle";sourcePath:string;intakeId:string;sourceNoteSha256:string;
  sourceReceiptId:string;recordedAt:string;quote:string;quoteSha256:string;occurrenceCount:number;
  uniqueSpan:{start:number;end:number}|null;documentLocator:string|null;documentLocatorVerified:false;
  claim:(PersistedReference&{entity:string})|null;
  review:(PersistedReference&{researchTrust:ResearchTrust|null})|null;
}
export interface SupplyChainCatalogItem {
  sourcePath:string;intakeId:string;sourceNoteSha256:string;receivedTextSha256:string;sourceReceiptId:string;
  recordedAt:string;eventDate:string|null;publicationDate:string|null;sourceKind:string|null;publisher:string|null;
  sourceUrl:string|null;quotePreview:string;previewTruncated:boolean;contextKeys:string[];researchTrust:ResearchTrust|null;
}
export interface SupplyChainCandidateResult {
  localKey:string;status:"hold"|"pending_semantic_review"|"hypothesis_pending_review";issues:string[];
  proposal:Proposal|null;bindings:SupplyChainEvidenceBinding[];subjectHubPath:string|null;objectHubPath:string|null;
  declaredTemporalStatus:"unknown"|"prospective"|"within_declared_window"|"expired"|"boundary_uncertain";
  effectiveExposureMagnitude:"unknown";semanticEntailment:"not_assessed";independentEvidenceIncrement:0;
}
export interface SupplyChainPreview {
  methodVersion:typeof SUPPLY_CHAIN_METHOD_VERSION;generatedAt:string;queryCutoffAsOf:string|null;
  viewMode:"current_index"|"availability_bounded_current_index";identity:IssuerResolution[];
  sourceCatalog:SupplyChainCatalogItem[];candidates:SupplyChainCandidateResult[];
  coverage:{retrievalStatus:"operational_complete"|"operational_hold";sourceReadLimitReached:boolean;catalogLimitReached:boolean;
    counterEvidence:"not_exhaustive";evidenceReadHoldCount:number;evidenceReadHoldReasons:string[];
    cutoffExclusionCount:number;linkedReadLimitReached:boolean;limitations:string[]};
  writesPerformed:false;sourceAuthenticityVerified:false;semanticEntailment:"not_assessed";
  independentEvidenceIncrement:0;canWriteProtectedNotes:false;canAutoWrite:false;economicRelationshipVerified:false;comparatorEligible:false;
  identityBoundary:"current_hub_navigation_only_not_issuer_or_instrument_adjudication";
}
const MAX_SOURCES=16,MAX_CATALOG=8,MAX_LINKED=16,MAX_REFS=32;
const unique=<T>(xs:T[])=>[...new Set(xs)];
const bounded=(value:unknown,n:number)=>typeof value==="string"&&value.length<=n?value:null;
function fail(code:string):never{throw Error(code);}
const reason=(error:unknown)=>error instanceof Error&&/^n7_[a-z_]+$/.test(error.message)?error.message:"n7_evidence_readback_hold";

/** indexedRead checks metadata, not the FTS body. Compare the exact row/body. */
function exactFts(path:string,body:string):void{
  const row=db().prepare(`SELECT notes_fts.body FROM notes JOIN notes_fts ON notes.rowid=notes_fts.rowid
    WHERE notes.path=? AND notes_fts.path=? LIMIT 1`).get(path,path) as {body:string}|undefined;
  if(!row||row.body!==body)fail("n7_index_body_mismatch");
}
/** createReceipt is the existing SELECT-only validator. Its verified origin
 * receipt may precede appended Review bytes; never date those bytes by origin. */
function persisted(kind:"source_intake"|"structured_claim"|"canonical_review",path:string,raw:string):PersistedReference{
  const receiptId=createReceipt(kind,path,raw),noteSha256=sha(raw);
  const row=db().prepare("SELECT after_text,after_hash,receipt FROM safe_edit_operations WHERE id=? AND status='written'")
    .get(receiptId) as {after_text:string;after_hash:string;receipt:string}|undefined;
  if(!row)fail("n7_receipt_time_unavailable");
  const receipt:unknown=JSON.parse(row!.receipt);
  const time=receipt&&typeof receipt==="object"?(receipt as Record<string,unknown>).writtenAt:null;
  if(typeof time!=="string"||!Number.isFinite(Date.parse(time)))fail("n7_receipt_time_unavailable");
  const exact=row!.after_text===raw&&row!.after_hash===noteSha256;
  return {path,noteSha256,receiptId,recordedAt:exact?time:null};
}
function available(record:PersistedReference,cutoff:number|null):void{
  if(cutoff!==null&&(record.recordedAt===null||Date.parse(record.recordedAt)>cutoff))
    fail(record.recordedAt===null?"n7_current_bytes_recorded_time_unknown":"n7_recorded_after_cutoff");
}
function declaredAvailability(publication:string|null,cutoff:number|null):void{
  // Unknown publication stays unknown. This mode asserts IOS recording only,
  // not authenticated public historical availability. Date-only windows use
  // the shared conservative timezone bounds.
  if(cutoff!==null&&publication&&publicationWindow(publication)![1]>cutoff)
    fail("n7_publication_not_available_by_cutoff");
}
function temporal(validity:SupplyChainCandidate["validity"],at:number):SupplyChainCandidateResult["declaredTemporalStatus"]{
  const from=publicationWindow(validity.from),to=publicationWindow(validity.to);
  if(!from&&!to)return "unknown";
  if(from&&at<from[0])return "prospective";
  if(to&&at>to[1])return "expired";
  if(from&&at<=from[1]||to&&at>=to[0])return "boundary_uncertain";
  return "within_declared_window";
}
function quoteLocations(text:string,quote:string):number[]{
  const hits:number[]=[];
  for(let at=text.indexOf(quote);at>=0;at=text.indexOf(quote,at+1))hits.push(at);
  return hits;
}

export function previewSupplyChainRelationships(raw:unknown):SupplyChainPreview{
  const input=supplyChainInputSchema.parse(raw),proposed=input.candidates??[];
  const generatedAt=new Date().toISOString(),cutoff=input.asOf?Date.parse(input.asOf):null;
  const context=buildInvestmentContextPack({question:input.question,issuers:input.issuers,industry:input.industry,
    focus:"general",maxNotes:12,maxChars:12000});
  const contextOperational=retrievalOperationallyComplete(context.retrieval);
  const declarations=proposed.flatMap(c=>[...c.sourceRefs,...c.counterEvidenceRefs,...c.relatedEvidenceRefs]);
  const sourceScopes=new Map<string,Set<string>>(),allowed=new Set<string>();
  for(const scan of context.standaloneSources)for(const path of scan.paths){
    allowed.add(path);const scopes=sourceScopes.get(path)??new Set<string>();scopes.add(scan.contextKey);sourceScopes.set(path,scopes);
  }
  const bundles=context.contextBundles.filter(b=>b.status==="BOUND_SOURCE_REVIEW"&&b.sourcePath);
  for(const b of bundles)allowed.add(b.sourcePath!);
  const paths=unique([...declarations.map(r=>r.sourcePath).filter(p=>allowed.has(p)).sort(),...Array.from(allowed).sort()]);
  const selected=new Set(paths.slice(0,MAX_SOURCES));
  const sourceReadLimitReached=paths.length>MAX_SOURCES;
  const readHolds=new Map<string,string>(),cutoffExclusions=new Set<string>();let linkedReadLimitReached=false;
  const recordReadHold=(path:string,code:string)=>{
    if(["n7_recorded_after_cutoff","n7_current_bytes_recorded_time_unknown","n7_publication_not_available_by_cutoff"].includes(code))
      cutoffExclusions.add(path);
    else if(code==="n7_linked_reference_limit")linkedReadLimitReached=true;
    else readHolds.set(path,code);
  };
  type Source={catalog:SupplyChainCatalogItem;text:string;scopes:Set<string>};
  const sourceCache=new Map<string,Source|Error>();
  type Review={reference:PersistedReference;fm:Record<string,unknown>;trust:ResearchTrust|null};
  const reviewCache=new Map<string,Review|Error>();
  const claimCache=new Map<string,{reference:PersistedReference;bound:ReturnType<typeof readPersistedClaim>}|Error>();
  const loadReview=(path:string,sourcePath:string):Review=>{
    // Pair checks depend on caller arguments, not the persisted Review bytes.
    // Do not cache a mismatched pair and poison a later valid pair in a batch.
    const bundle=bundles.find(b=>b.reviewPath===path&&b.sourcePath===sourcePath);
    if(!bundle)fail("n7_review_outside_bound_scope");
    const cached=reviewCache.get(path);if(cached instanceof Error)throw cached;
    if(cached){if(cached.fm.original_source_path!==sourcePath)fail("n7_review_source_mismatch");return cached;}
    if(reviewCache.size>=MAX_LINKED){linkedReadLimitReached=true;fail("n7_linked_reference_limit");}
    try{
      const note=indexedRead(path);
      if(sha(note.raw)!==bundle!.reviewSha256||note.fm.type!=="investment_research_review"||
        note.fm.original_source_path!==sourcePath||note.fm.intake_id!==bundle!.intakeId)fail("n7_review_source_mismatch");
      exactFts(path,note.body);
      if(!db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1").get(path,sourcePath))fail("n7_review_source_link_missing");
      const reference=persisted("canonical_review",path,note.raw);available(reference,cutoff);
      const result={reference,fm:note.fm,trust:researchTrust(path,note.fm)};reviewCache.set(path,result);return result;
    }catch(error){const e=Error(reason(error));reviewCache.set(path,e);recordReadHold(path,e.message);throw e;}
  };
  const loadSource=(path:string):Source=>{
    if(!allowed.has(path))fail("n7_source_outside_retrieved_scope");
    if(!selected.has(path))fail("n7_source_read_limit");
    const cached=sourceCache.get(path);if(cached instanceof Error)throw cached;if(cached)return cached;
    try{
      const id=/^00_Inbox\/ChatGPT\/Investment Intake - (IN-[A-F0-9]{16})\.md$/.exec(path)?.[1];
      if(!id)fail("n7_source_identity_mismatch");
      const note=indexedRead(path),text=preservedSubmittedText(note.raw);
      if(note.fm.type!=="investment_source_intake"||note.fm.intake_id!==id||text===null||
        ![sha(text),sha(text+"\n")].includes(String(note.fm.source_text_sha256)))fail("n7_original_text_binding_mismatch");
      exactFts(path,note.body);
      const reference=persisted("source_intake",path,note.raw);available(reference,cutoff);
      if(reference.recordedAt===null)fail("n7_receipt_time_unavailable");
      const metadata=inspectCanonicalKnowledgeMetadata(path,note.fm);
      if(metadata.warnings.some(w=>w==="invalid_event_date"||w==="invalid_published_at"))fail("n7_source_chronology_invalid");
      declaredAvailability(metadata.publishedAt,cutoff);
      const scopes=new Set(sourceScopes.get(path)??[]);
      // Bound Review metadata can supply current relevance, not semantics. In
      // cutoff mode it must itself be available; a future Review cannot lend
      // its issuer scope to an earlier Source. Source bytes stay independent.
      for(const bundle of bundles.filter(b=>b.sourcePath===path).slice(0,4))try{
        const review=loadReview(bundle.reviewPath,path);
        const hubs=Array.isArray(review.fm.company_hubs)?review.fm.company_hubs:[];
        for(const r of context.issuerResolution)if(r.contextKey&&r.hubPath&&hubs.includes(r.hubPath))scopes.add(r.contextKey);
      }catch{/* Missing paired scope is reflected by endpoint coverage below. */}
      const catalog:SupplyChainCatalogItem={sourcePath:path,intakeId:id!,sourceNoteSha256:reference.noteSha256,
        receivedTextSha256:sha(text!),sourceReceiptId:reference.receiptId,recordedAt:reference.recordedAt!,
        eventDate:metadata.eventDate,publicationDate:metadata.publishedAt,sourceKind:bounded(note.fm.source_kind,80),
        publisher:bounded(note.fm.attributed_publisher,160),sourceUrl:canonicalSourceUrl(bounded(note.fm.source_url,2000)),
        quotePreview:text!.slice(0,1200),previewTruncated:text!.length>1200,contextKeys:Array.from(scopes).sort(),
        researchTrust:researchTrust(path,note.fm)};
      const result={catalog,text:text!,scopes};sourceCache.set(path,result);return result;
    }catch(error){const e=Error(reason(error));sourceCache.set(path,e);recordReadHold(path,e.message);throw e;}
  };
  const resolve=(label:string)=>validHubIdentityLabel(label)?context.issuerResolution.find(r=>
    hubIdentityKey(r.requested)===hubIdentityKey(label)&&["exact_existing_title","indexed_alias"].includes(r.status)):undefined;
  const bind=(ref:SupplyChainEvidenceRef,role:SupplyChainEvidenceBinding["role"],endpoints:IssuerResolution[]):{binding:SupplyChainEvidenceBinding;scopes:Set<string>}=>{
    const source=loadSource(ref.sourcePath),s=source.catalog;
    if(s.intakeId!==ref.intakeId||s.sourcePath!==`00_Inbox/ChatGPT/Investment Intake - ${ref.intakeId}.md`)fail("n7_source_identity_mismatch");
    if(s.sourceNoteSha256!==ref.sourceNoteSha256)fail("n7_source_hash_mismatch");
    const occurrences=quoteLocations(source.text,ref.quote);if(!occurrences.length)fail("n7_quote_not_in_original_text");
    if(!endpoints.some(e=>e.contextKey&&source.scopes.has(e.contextKey)))fail("n7_reference_outside_endpoint_scope");
    let claim:SupplyChainEvidenceBinding["claim"]=null,review:SupplyChainEvidenceBinding["review"]=null;
    let claimBound:ReturnType<typeof readPersistedClaim>|null=null;
    if(ref.claimRef){
      const path=ref.claimRef.path;let record=claimCache.get(path);
      if(record instanceof Error)throw record;
      if(!record){
        if(claimCache.size>=MAX_LINKED){linkedReadLimitReached=true;fail("n7_linked_reference_limit");}
        try{
          const bound=readPersistedClaim(path),note=splitFrontmatter(bound.readbackText);exactFts(path,note.body);
          const reference=persisted("structured_claim",path,bound.readbackText);available(reference,cutoff);
          record={reference,bound};claimCache.set(path,record);
        }catch(error){const e=Error(reason(error));claimCache.set(path,e);throw e;}
      }
      if(record.reference.noteSha256!==ref.claimRef.noteSha256)fail("n7_claim_hash_mismatch");
      if(record.bound.scope.domain!=="company")fail("n7_claim_domain_mismatch");
      if(record.bound.sourcePath!==s.sourcePath||record.bound.intakeId!==s.intakeId||record.bound.sourceReceiptKey!==s.sourceReceiptId)
        fail("n7_claim_source_mismatch");
      if(!validHubIdentityLabel(record.bound.scope.entity)||!endpoints.some(e=>
        [e.requested,e.contextKey].some(label=>label&&hubIdentityKey(label)===hubIdentityKey(record.bound.scope.entity))))
        fail("n7_claim_endpoint_mismatch");
      claimBound=record.bound;claim={...record.reference,entity:record.bound.scope.entity};
    }
    if(ref.reviewRef){
      const record=loadReview(ref.reviewRef.path,s.sourcePath);
      if(record.reference.noteSha256!==ref.reviewRef.noteSha256)fail("n7_review_hash_mismatch");
      if(claimBound&&!claimBound.reviewReferences.includes(ref.reviewRef.path))fail("n7_review_claim_binding_mismatch");
      review={...record.reference,researchTrust:record.trust};
    }
    return {scopes:source.scopes,binding:{role,sourcePath:s.sourcePath,intakeId:s.intakeId,sourceNoteSha256:s.sourceNoteSha256,
      sourceReceiptId:s.sourceReceiptId,recordedAt:s.recordedAt,quote:ref.quote,quoteSha256:sha(ref.quote),occurrenceCount:occurrences.length,
      uniqueSpan:occurrences.length===1?{start:occurrences[0],end:occurrences[0]+ref.quote.length}:null,
      documentLocator:ref.documentLocator??null,documentLocatorVerified:false,claim,review}};
  };
  // Finish selected-source integrity checks before deciding any candidate.
  // Do not silently turn failed N7 reads into an empty successful catalog.
  const eligible:SupplyChainCatalogItem[]=[];
  for(const path of selected)try{eligible.push(loadSource(path).catalog);}catch{/* Counts/codes above omit rejected paths/content. */}
  const operational=contextOperational&&readHolds.size===0;
  const counts=new Map<string,number>();for(const c of proposed)counts.set(c.localKey,(counts.get(c.localKey)??0)+1);
  const candidates:SupplyChainCandidateResult[]=proposed.map(c=>{
    const issues:string[]=[],semanticIssues:string[]=[],bindings:SupplyChainEvidenceBinding[]=[],supportScopes=new Set<string>();
    const subject=resolve(c.subject),object=resolve(c.object);
    if(!operational)issues.push("n7_retrieval_operational_hold");
    if(declarations.length>MAX_REFS)issues.push("n7_reference_limit");
    if(counts.get(c.localKey)!==1)issues.push("n7_duplicate_local_key");
    if(!subject||!object)issues.push("n7_endpoint_identity_hold");
    else if(subject.hubPath===object.hubPath)issues.push("n7_same_hub_endpoints");
    if(c.validity.from&&c.validity.to&&c.validity.from>c.validity.to)issues.push("n7_invalid_validity_range");
    if(c.assertionOrigin==="co_mention"&&!["sector_co_exposure","potential_beneficiary_of"].includes(c.predicate))
      semanticIssues.push("n7_co_mention_not_relationship_evidence");
    if(c.lifecycle==="contradicted"||c.lifecycle==="retracted")semanticIssues.push("n7_declared_"+c.lifecycle+"_relationship_hold");
    if(c.lifecycle!=="active"&&!c.relatedEvidenceRefs.length)issues.push("n7_lifecycle_reference_required");
    if(c.estimateVintage)try{declaredAvailability(c.estimateVintage,cutoff);}catch{issues.push("n7_estimate_vintage_after_cutoff");}
    if(subject&&object&&declarations.length<=MAX_REFS){
      const refs=[...c.sourceRefs.map(ref=>({ref,role:"support" as const})),...c.counterEvidenceRefs.map(ref=>({ref,role:"counter" as const})),
        ...c.relatedEvidenceRefs.map(ref=>({ref,role:"lifecycle" as const}))];
      for(const {ref,role} of refs)try{
        const checked=bind(ref,role,[subject,object]);bindings.push(checked.binding);
        if(role==="support")for(const key of checked.scopes)supportScopes.add(key);
      }catch(error){issues.push(reason(error));}
      if(![subject.contextKey,object.contextKey].every(key=>key&&supportScopes.has(key)))issues.push("n7_support_endpoint_scope_incomplete");
    }
    // A failed reference must not leave future counter-evidence, revision text
    // or caller reasoning in an otherwise apparently historical candidate.
    const result:SupplyChainCandidateResult={localKey:c.localKey,status:"hold",issues:unique(issues),proposal:null,bindings:[],
      subjectHubPath:null,objectHubPath:null,declaredTemporalStatus:"unknown",effectiveExposureMagnitude:"unknown",
      semanticEntailment:"not_assessed",independentEvidenceIncrement:0};
    if(issues.length)return result;
    const {sourceRefs: _s,counterEvidenceRefs: _c,relatedEvidenceRefs: _r,transmission,...declaration}=c;
    void _s;void _c;void _r;
    return {...result,issues:semanticIssues,status:semanticIssues.length?"hold":c.assertionOrigin!=="source_statement"||c.predicate==="potential_beneficiary_of"?
      "hypothesis_pending_review":"pending_semantic_review",proposal:{...declaration,estimateVintage:c.estimateVintage??null,
        proposalOrigin:"caller_supplied_reasoning",transmission:transmission.map(({magnitude,...t})=>({...t,proposedMagnitude:magnitude}))},
      bindings,subjectHubPath:subject!.hubPath,objectHubPath:object!.hubPath,declaredTemporalStatus:temporal(c.validity,cutoff??Date.parse(generatedAt))};
  });
  return {methodVersion:SUPPLY_CHAIN_METHOD_VERSION,generatedAt,queryCutoffAsOf:input.asOf??null,
    viewMode:input.asOf?"availability_bounded_current_index":"current_index",identity:context.issuerResolution,
    sourceCatalog:eligible.slice(0,MAX_CATALOG),candidates,coverage:{retrievalStatus:contextOperational&&readHolds.size===0?"operational_complete":"operational_hold",
      sourceReadLimitReached,catalogLimitReached:eligible.length>MAX_CATALOG,counterEvidence:"not_exhaustive",
      evidenceReadHoldCount:readHolds.size,evidenceReadHoldReasons:unique([...readHolds.values()]),cutoffExclusionCount:cutoffExclusions.size,
      linkedReadLimitReached,limitations:[
        "Current Hub identity is navigation, not historical issuer/listing adjudication.",
        "This bounded current-index view is not an exhaustive historical reconstruction; current selection may omit evidence available earlier.",
        "Recorded time is the server's verified persistence time for these bytes, not first receipt, publisher authenticity or strategy availability.",
        "Unknown publication remains unknown. Source/Review/Claim receipts do not verify statements, relationship entailment or independent origins.",
        "Caller proposals and value-chain stages are unverified reasoning generated for this preview, not proof of a relationship known at the cutoff.",
        "Quote spans address received text only. Document locators and original PDF bytes are not verified by this tool."
      ]},writesPerformed:false,sourceAuthenticityVerified:false,semanticEntailment:"not_assessed",independentEvidenceIncrement:0,canWriteProtectedNotes:false,
    canAutoWrite:false,economicRelationshipVerified:false,comparatorEligible:false,
    identityBoundary:"current_hub_navigation_only_not_issuer_or_instrument_adjudication"};
}

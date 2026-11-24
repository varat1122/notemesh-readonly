import {researchTrust,type ResearchTrust} from "./research-state";
import {judgeExclusionSql,type JudgeSelectionPolicy} from "./queries";
/** Read-only adapters for existing canonical Review/Source/receipt contracts.
 * No new identities, tables, writes, or economic-event equivalence inference. */
import {historyCutoffSchema,RetrievalObserver} from "./investment-retrieval-coverage";
import {createHash} from "node:crypto";
import {db} from "../db";
import {operationProvenanceTier,witnessFor,type ProvenanceTier} from "../safe-edit/admission";
import {readNote} from "./notes";
import {splitFrontmatter,extractStructure} from "./markdown";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const intake=/^IN-[A-F0-9]{16}$/;
const folder="10_Knowledge/Company Research/Investment Review - ";
type Metadata=Record<string,unknown>;
export interface ContextBundle {
  researchTrust:ResearchTrust|null;
  intakeId:string;reviewPath:string;sourcePath:string|null;
  status:"BOUND_SOURCE_REVIEW"|"HOLD";reason:string|null;
  eventDate:string|null;publishedAt:string|null;
  reviewSha256:string;sourceSha256:string|null;
  reviewReceiptId:string|null;sourceReceiptId:string|null;
  economicEventEquivalence:"not_established";primaryVerification:"not_performed";
}
export interface CanonicalReview {
  path:string;intakeId:string;publishedAt:string|null;legacy:boolean;bundle:ContextBundle;
}
export interface CanonicalResearchScope {
  historyCutoff?:string;
  pathPrefixes:string[];intakeId:string|null;excludedPaths:string[];
  metadataLimit:100;physicalReviewReadLimit:8;includesNonCanonicalResearch:false;
}
export interface CanonicalResearchScan {
  pitExcluded?:{path:string;reason:"pit_after_cutoff"|"pit_publication_after_cutoff"}[];
  scopeDefinition:CanonicalResearchScope;
  // Existing bounded metadata only. These paths have NOT been read, receipted,
  // linked, or admitted as evidence. Never use them as selected Judge history.
  deferredReviews:{path:string;intakeId:string;publishedAt:string|null;reason:"canonical_read_limit"}[];
  contextKey:string;reviews:CanonicalReview[];complete:boolean;reasons:string[];
  chronology:"LATEST_BY_DECLARED_PUBLICATION"|"ORDER_UNKNOWN"|"SCAN_INCOMPLETE"|"NOT_FOUND";
  latestReviewPaths:string[];
}
function metadata(value:string|null):Metadata|null{
  try{const x:unknown=JSON.parse(value??"null");return x&&typeof x==="object"&&!Array.isArray(x)?x as Metadata:null;}catch{return null;}
}
export function indexedRead(path:string){
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path=?").get(path) as {frontmatter:string|null}|undefined;
  if(!row)throw Error("index_missing");
  const raw=readNote(path).content;
  if(Buffer.byteLength(raw)>100000)throw Error("read_limit");
  const parsed=splitFrontmatter(raw);
  // Readback must agree with the discovery metadata; edited/unindexed bytes
  // must not silently supply a different intake, issuer or chronology.
  if(JSON.stringify(metadata(row.frontmatter))!==JSON.stringify(parsed.data))throw Error("index_readback_mismatch");
  return {raw,fm:parsed.data,body:parsed.body};
}
function declaredDate(fm:Metadata,key:"event_date"|"published_at"):string|null{
  const schema=inspectCanonicalKnowledgeMetadata("",fm);
  if(fm[key]!=null&&schema.warnings.includes("invalid_"+key))throw Error("invalid_chronology");
  return key==="event_date"?schema.eventDate:schema.publishedAt;
}
/** A timezone-less date spans all possible UTC offsets. Do not compare it as
 * midnight UTC or replace it with file mtime / another kind of date. */
export function publicationWindow(date:string|null):[number,number]|null{
  if(!date)return null;
  const time=Date.parse(date);
  if(!Number.isFinite(time))return null;
  return date.length===10?[time-14*3600000,time+38*3600000]:[time,time];
}
/** Validate a bounded, linear Safe Edit history of an add-only canonical Review.
 * This is a read-only compatibility check, not a new receipt or evidence tier.
 * Source/Claim receipt admission intentionally remains strict create-only. */
type ChainRow={id:string;actor:string;approval:string|null;payload:string;before_text:string;
  after_text:string;before_hash:string;after_hash:string;receipt:string|null;status:string};
// This is a deterministic cross-check against the existing journal + audit
// events, not an independent cryptographic seal. A privileged attacker able to
// rewrite every correlated database record remains outside this receipt gate.
const safeEditReceiptKeys=["operationId","path","beforeHash","afterHash","writtenAt","write",
  "readback","reindex","sync","remoteSync","mobileSync","backup","approval","review"].sort().join(",");
function isoMillis(value:unknown):number|null{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return null;
  const time=Date.parse(value);
  if(!Number.isFinite(time))return null;
  try{return new Date(time).toISOString()===value?time:null;}catch{return null;}
}
function verifyReceiptMetadata(row:ChainRow,path:string,payload:Metadata,receipt:Metadata):void{
  const writtenAt=isoMillis(receipt.writtenAt);
  if(Object.keys(receipt).sort().join(",")!==safeEditReceiptKeys||
    receipt.backup!=="safe-edit-backups/"+row.id+".md"||
    receipt.approval!==row.approval||
    JSON.stringify(receipt.review)!==JSON.stringify(payload.evidence??null)||
    // The current Safe Edit engine never updates receipt Sync stages. Its
    // separate sync counters must not be caller-relabelled as receipt proof.
    receipt.sync!=="unverified"||receipt.remoteSync!=="unverified"||
    receipt.mobileSync!=="unverified"||writtenAt===null)
    throw Error("create_receipt_unverified");
  const events=db().prepare("SELECT at,actor,detail FROM safe_edit_events WHERE operation_id=? AND event='written' LIMIT 2")
    .all(row.id) as Array<{at:string;actor:string;detail:string}>;
  if(events.length!==1||events[0].actor!==row.actor)throw Error("create_receipt_unverified");
  const eventAt=isoMillis(events[0].at),detail=metadata(events[0].detail);
  if(eventAt===null||eventAt<writtenAt||eventAt-writtenAt>60000||
    !detail||detail.path!==path||detail.beforeHash!==row.before_hash||
    detail.afterHash!==row.after_hash)
    throw Error("create_receipt_unverified");
  if(row.approval!==null){
    // A fresh reviewed assessment may rotate a pending token for the same
    // canonical bytes/operation. Bind the actual final approval to that Preview
    // and the sole write, not to the count of abandoned earlier approvals.
    // Read only: no journal/receipt rewrite or caller-created authorization.
    const approval=db().prepare("SELECT rowid,at,detail FROM safe_edit_events WHERE operation_id=? AND event='approved' AND actor=? ORDER BY rowid DESC LIMIT 1")
      .get(row.id,row.approval) as {rowid:number;at:string;detail:string}|undefined;
    const preview=db().prepare("SELECT rowid,at FROM safe_edit_events WHERE operation_id=? AND actor=? AND event IN ('preview','preview_token_rotated') ORDER BY rowid DESC LIMIT 1")
      .get(row.id,row.actor) as {rowid:number;at:string}|undefined;
    const write=db().prepare("SELECT rowid FROM safe_edit_events WHERE operation_id=? AND event='written'").get(row.id) as {rowid:number}|undefined;
    const approvedAt=approval?isoMillis(approval.at):null,previewAt=preview?isoMillis(preview.at):null;
    const approved=approval?metadata(approval.detail):null;
    if(approvedAt===null||previewAt===null||!approval||!preview||!write||preview.rowid>=approval.rowid||approval.rowid>=write.rowid||
      previewAt>approvedAt||approvedAt>writtenAt||approved?.afterHash!==row.after_hash)
      throw Error("create_receipt_unverified");
  }
}
function verifiedJournalRow(row:ChainRow,path:string,kind:"source_intake"|"canonical_review"|"structured_claim"="canonical_review"):"create"|"append"{
  const payload=metadata(row.payload),receipt=metadata(row.receipt);
  const change=payload?.change as {kind?:unknown;content?:unknown}|undefined;
  if(row.status!=="written"||!payload||!receipt||payload.path!==path||payload.operationId!==row.id||
    receipt.path!==path||receipt.operationId!==row.id||
    receipt.beforeHash!==row.before_hash||receipt.afterHash!==row.after_hash||
    receipt.write!=="written"||receipt.readback!=="verified"||receipt.reindex!=="verified"||
    sha(row.before_text)!==row.before_hash||sha(row.after_text)!==row.after_hash)
    throw Error("create_receipt_unverified");
  verifyReceiptMetadata(row,path,payload,receipt);
  if(change?.kind==="create"){
    const expected="ICW-"+sha([kind,path,row.after_hash].join("\n")).slice(0,32);
    if(row.id!==expected||row.before_text!==""||row.before_hash!==sha("")||change.content!==row.after_text)
      throw Error("create_receipt_unverified");
    return "create";
  }
  if(change?.kind!=="append")throw Error("create_receipt_unverified");
  const marker=`<!-- safe-edit:${row.id} -->`;
  if(row.before_text.includes(marker)||!row.after_text.includes(marker)||
    JSON.stringify(splitFrontmatter(row.before_text).data)!==
      JSON.stringify(splitFrontmatter(row.after_text).data))
    throw Error("create_receipt_unverified");
  return "append";
}
function verifiedReviewAppendChain(path:string,content:string):{origin:string;chain:string[]}{
  // A writing/interrupted record, fork or unrelated mutation must not be
  // masked by a matching older creation. Read with bounded SELECTs only.
  const rows=db().prepare(`SELECT id,actor,approval,payload,before_text,after_text,before_hash,after_hash,receipt,status
    FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? AND status IN ('written','writing')
    ORDER BY id LIMIT 17`).all(path) as ChainRow[];
  if(rows.length<2||rows.length>16)throw Error("create_receipt_unverified");
  const journal=rows.map(row=>({...row,kind:verifiedJournalRow(row,path)}));
  const origins=journal.filter(row=>row.kind==="create");
  if(origins.length!==1)throw Error("create_receipt_unverified");
  let current=origins[0];
  const seen=new Set([current.id]),chain=[current.id];
  while(current.after_text!==content){
    const next=journal.filter(row=>row.kind==="append"&&!seen.has(row.id)&&
      row.before_hash===current.after_hash&&row.before_text===current.after_text);
    if(next.length!==1)throw Error("create_receipt_unverified");
    current=next[0];seen.add(current.id);chain.push(current.id);
  }
  if(seen.size!==journal.length)throw Error("create_receipt_unverified");
  return {origin:origins[0].id,chain};
}
/** WP2 provenance of one verified chain (origin first). Legacy history stays
 * legacy; a revision on a legacy base stays composite at every later depth;
 * any unwitnessed post-epoch element, or a plain witness claiming no legacy
 * base on top of a legacy origin (uplift), is never treated as server-witnessed. */
function chainProvenance(ids:string[]):{tier:ProvenanceTier;baseSha256:string|null}{
  const tiers=ids.map(operationProvenanceTier),[origin,...appends]=tiers;
  if(tiers.includes("unwitnessed_post_epoch"))return {tier:"unwitnessed_post_epoch",baseSha256:null};
  if(origin==="server_witnessed")
    return appends.every(t=>t==="server_witnessed")?{tier:"server_witnessed",baseSha256:null}:{tier:"unwitnessed_post_epoch",baseSha256:null};
  if(origin!=="legacy_origin_unverified")return {tier:"unwitnessed_post_epoch",baseSha256:null};
  const composite=ids.slice(1).filter((_,i)=>appends[i]==="server_witnessed_revision_on_legacy_base");
  if(appends.some(t=>t==="server_witnessed"))return {tier:"unwitnessed_post_epoch",baseSha256:null};
  if(!composite.length)return {tier:"legacy_origin_unverified",baseSha256:null};
  const bases=new Set(composite.map(id=>witnessFor(id)?.base_sha256??null));
  const firstComposite=appends.indexOf("server_witnessed_revision_on_legacy_base");
  if(bases.size!==1||bases.has(null)||appends.slice(firstComposite).some(t=>t!=="server_witnessed_revision_on_legacy_base"))
    return {tier:"unwitnessed_post_epoch",baseSha256:null};
  return {tier:"server_witnessed_revision_on_legacy_base",baseSha256:[...bases][0]};
}
/** Receipt identity + provenance tier (SELECT only). Throws when the journal
 * does not verify; tier tells legacy/composite/witnessed apart. */
export function receiptProvenance(kind:"source_intake"|"canonical_review"|"structured_claim",path:string,content:string):
  {receiptId:string;tier:ProvenanceTier;baseSha256:string|null}{
  const hash=sha(content),empty=sha("");
  const id="ICW-"+sha([kind,path,hash].join("\n")).slice(0,32);
  // Never call Safe Edit status/store: it initializes tables. SELECT only.
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get())throw Error("receipt_store_missing");
  const row=db().prepare("SELECT id,actor,approval,payload,before_text,after_text,before_hash,after_hash,receipt,status FROM safe_edit_operations WHERE id=? AND status='written'")
    .get(id) as ChainRow|undefined;
  if(!row){
    if(kind!=="canonical_review")throw Error("create_receipt_unverified");
    const c=verifiedReviewAppendChain(path,content);
    return {receiptId:c.origin,...chainProvenance(c.chain)};
  }
  if(row.after_text!==content||row.after_hash!==hash||row.before_hash!==empty||
    verifiedJournalRow(row,path,kind)!=="create")throw Error("create_receipt_unverified");
  return {receiptId:id,...chainProvenance([id])};
}

/** Historical receipt identity. Legacy (pre-epoch) and witnessed records
 * keep verifying; a canonical-looking record without a server witness after
 * the authority regime started never yields a receipt (OD-04, F1/P5 forge). */
export function createReceipt(kind:"source_intake"|"canonical_review"|"structured_claim",path:string,content:string):string{
  const p=receiptProvenance(kind,path,content);
  if(p.tier==="unwitnessed_post_epoch")throw Error("create_receipt_unverified");
  return p.receiptId;
}
/** Known-at for the EXACT current bytes, not the origin of a later revision.
 * SELECT only, reusing receipt/actor/hash/audit/provenance verification. No old
 * bytes are reconstructed and no mtime or caller-declared known_at is trusted. */
export function receiptVersionAt(path:string,content:string):{receiptId:string;versionReceiptId:string;knownAt:string;sha256:string}{
  const kind=isReceiptedReviewPath(path)?"canonical_review":
    /^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/.test(path)?"source_intake":null;
  if(!kind)throw Error("pit_receipt_unverified");
  const receiptId=createReceipt(kind,path,content);
  const rows=db().prepare(`SELECT id,actor,approval,payload,before_text,after_text,before_hash,after_hash,receipt,status
    FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? AND status IN ('written','writing')
    ORDER BY id LIMIT 17`).all(path) as ChainRow[];
  const ids=rows.length===1?[receiptId]:kind==="canonical_review"?verifiedReviewAppendChain(path,content).chain:[];
  if(!ids.length||rows.length!==ids.length)throw Error("pit_receipt_unverified");
  let knownAt=0;
  for(const id of ids){
    const row=rows.find(r=>r.id===id);if(!row)throw Error("pit_receipt_unverified");
    verifiedJournalRow(row,path,kind);
    const receipt=metadata(row.receipt)!,written=isoMillis(receipt.writtenAt)!;
    const event=db().prepare("SELECT at FROM safe_edit_events WHERE operation_id=? AND event='written'").get(id) as {at:string};
    const at=isoMillis(event.at)!;
    if(written<knownAt)throw Error("pit_receipt_unverified");
    knownAt=at; // includes server acknowledgement, not just write-start time
  }
  const last=rows.find(r=>r.id===ids.at(-1))!;
  if(last.after_text!==content||last.after_hash!==sha(content))throw Error("pit_receipt_unverified");
  return {receiptId,versionReceiptId:last.id,knownAt:new Date(knownAt).toISOString(),sha256:sha(content)};
}
function assemble(path:string,id:string,note:ReturnType<typeof indexedRead>,observer:RetrievalObserver):ContextBundle{
  const result:ContextBundle={researchTrust:researchTrust(path,note.fm),intakeId:id,reviewPath:path,sourcePath:null,status:"HOLD",reason:null,
    eventDate:null,publishedAt:null,reviewSha256:sha(note.raw),sourceSha256:null,
    reviewReceiptId:null,sourceReceiptId:null,economicEventEquivalence:"not_established",primaryVerification:"not_performed"};
  try{
    if(note.fm.review_scope!=="company")throw Error("legacy_review_scope_missing");
    result.eventDate=declaredDate(note.fm,"event_date");result.publishedAt=declaredDate(note.fm,"published_at");
    const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
    // No arbitrary path following, fallback Source, or issuer-wide bundling.
    if(note.fm.original_source_path!==sourcePath)throw Error("source_path_binding_mismatch");
    const source=observer.read("bound_source",sourcePath,()=>indexedRead(sourcePath));
    if(source.fm.type!=="investment_source_intake"||source.fm.intake_id!==id)throw Error("intake_binding_mismatch");
    if(declaredDate(source.fm,"event_date")!==result.eventDate||declaredDate(source.fm,"published_at")!==result.publishedAt)
      throw Error("chronology_binding_mismatch");
    const tag="InvestmentIntake"+id.slice(3);
    for(const p of [path,sourcePath])if(!db().prepare("SELECT 1 FROM notes_fts WHERE path=? AND notes_fts MATCH ? LIMIT 1").get(p,tag))
      throw Error("fts_binding_missing");
    if(!extractStructure(note.body).links.includes(sourcePath.slice(0,-3))||
      !db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1").get(path,sourcePath))
      throw Error("review_source_link_missing");
    result.reviewReceiptId=createReceipt("canonical_review",path,note.raw);
    result.sourceReceiptId=createReceipt("source_intake",sourcePath,source.raw);
    result.sourcePath=sourcePath;result.sourceSha256=sha(source.raw);result.status="BOUND_SOURCE_REVIEW";
  }catch(e){
    const known=new Set(["index_missing","read_limit","index_readback_mismatch","invalid_chronology","receipt_store_missing",
      "create_receipt_unverified","source_path_binding_mismatch","intake_binding_mismatch","chronology_binding_mismatch",
      "fts_binding_missing","review_source_link_missing","legacy_review_scope_missing"]);
    result.reason=e instanceof Error&&known.has(e.message)?e.message:"binding_read_unavailable";
  }
  return result;
}
export function isCanonicalResearchPath(path:string):boolean{return path.startsWith(folder)&&/ - IN-[A-F0-9]{16}\.md$/.test(path);}
// RQ-2: canonical Reviews are also written to Macro and Industry folders. Their
// receipts are verified exactly like Company Reviews for PIT known-at; Company
// discovery keeps isCanonicalResearchPath. No receipt still means HOLD.
const RECEIPTED_REVIEW_FOLDERS=["10_Knowledge/Company Research/","10_Knowledge/Macro and Markets/","10_Knowledge/Industry and Concepts/"];
export function isReceiptedReviewPath(path:string):boolean{
  return RECEIPTED_REVIEW_FOLDERS.some(f=>path.startsWith(f+"Investment Review - "))&&/ - IN-[A-F0-9]{16}\.md$/.test(path);
}

/** Pre-cap journal admission, NOT physical readback. Match the indexed version
 * to bounded server after-images, then reuse the full receipt/chain verifier.
 * Unknown candidates remain incomplete and may use remaining physical slots;
 * caller dates or mtime alone can never skip them as verified future history. */
function indexedReceiptVersion(path:string,frontmatter:string|null):ReturnType<typeof receiptVersionAt>|null{
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get())return null;
  const rows=db().prepare(`SELECT CASE WHEN length(CAST(after_text AS BLOB))<=100000 AND length(CAST(before_text AS BLOB))<=100000 THEN after_text END AS content
    FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? AND status IN ('written','writing')
    ORDER BY id LIMIT 17`).all(path) as {content:string|null}[];
  if(!rows.length||rows.length>16||rows.some(row=>row.content===null))return null;
  const indexed=db().prepare("SELECT CASE WHEN length(CAST(f.body AS BLOB))<=100000 THEN f.body END AS body FROM notes n JOIN notes_fts f ON f.rowid=n.rowid AND f.path=n.path WHERE n.path=?").get(path) as {body:string|null}|undefined;
  const matches=rows.filter(row=>{
    if(row.content===null||!indexed)return false;
    const parsed=splitFrontmatter(row.content);
    return JSON.stringify(parsed.data)===JSON.stringify(metadata(frontmatter))&&parsed.body===indexed.body;
  });
  if(matches.length!==1)return null;
  try{return receiptVersionAt(path,matches[0].content!);}catch(e){
    if(e instanceof Error&&["pit_receipt_unverified","create_receipt_unverified","receipt_store_missing"].includes(e.message))return null;
    throw e;
  }
}
export function discoverCanonicalResearch(contextKey:string,intakeId?:string,resolvedSubjects?:string[],observer=new RetrievalObserver(),judgePolicy?:JudgeSelectionPolicy,historyCutoff?:string):CanonicalResearchScan{
  const cutoff=historyCutoff===undefined?undefined:historyCutoffSchema.parse(historyCutoff);
  // Only subjects already resolved to this Hub may extend filename discovery:
  // its title, requested labels and bounded explicit aliases checked by caller.
  const subjects=[...new Set([contextKey,...resolvedSubjects??[]])];
  const prefixes=subjects.map(subject=>folder+subject+" - ");
  const result:CanonicalResearchScan={contextKey,reviews:[],deferredReviews:[],complete:true,reasons:[],chronology:"NOT_FOUND",latestReviewPaths:[],
    scopeDefinition:{...(cutoff?{historyCutoff:cutoff}:{}),pathPrefixes:prefixes,intakeId:intakeId??null,excludedPaths:[...judgePolicy?.excludedPaths??[]],
      metadataLimit:100,physicalReviewReadLimit:8,includesNonCanonicalResearch:false}};
  // Bound the actual requested subject family, never a global Review universe.
  // Include malformed metadata in this scope so it cannot masquerade as absence.
  const rows=db().prepare(`SELECT path,frontmatter FROM notes WHERE (${prefixes.map(()=>"(path>=? AND path<?)").join(" OR ")})${judgeExclusionSql(judgePolicy)} ORDER BY path LIMIT 101`)
    .all(...prefixes.flatMap(prefix=>[prefix,prefix.slice(0,-1)+"!"]),...judgePolicy?.excludedPaths??[]) as {path:string;frontmatter:string|null}[];
  if(rows.length>100){result.complete=false;result.reasons.push("canonical_scope_scan_limit");}
  const candidates=rows.slice(0,100).flatMap(row=>{
    const fm=metadata(row.frontmatter),id=fm?.intake_id;
    const legacy=!!fm&&fm.review_scope==null;
    const conflictingSubject=legacy&&[fm?.company,fm?.issuer,fm?.entity,fm?.ticker].some(value=>value!==undefined&&
      (Array.isArray(value)?value:[value]).some(label=>typeof label!=="string"||!subjects.some(subject=>subject.toUpperCase()===label.trim().toUpperCase())));
    if(!fm||fm.type!=="investment_research_review"||(fm.review_scope!=="company"&&!(legacy&&resolvedSubjects))||conflictingSubject||
      typeof id!=="string"||!intake.test(id)||!prefixes.some(prefix=>row.path===prefix+id+".md")||
      fm.company_hubs!==undefined&&(!Array.isArray(fm.company_hubs)||!fm.company_hubs.includes(`01_Companies/${contextKey}.md`))){
      result.complete=false;result.reasons.push("canonical_metadata_unresolved");return [];
    }
    if(legacy&&(!intakeId||intakeId===id)){result.complete=false;result.reasons.push("legacy_review_scope_missing");}
    try{return [{...row,intakeId:id,publishedAt:declaredDate(fm,"published_at"),legacy}];}
    catch{result.complete=false;result.reasons.push("invalid_chronology");return [];}
  }).filter(x=>!intakeId||x.intakeId===intakeId)
    .sort((a,b)=>(publicationWindow(b.publishedAt)?.[0]??-Infinity)-(publicationWindow(a.publishedAt)?.[0]??-Infinity)||a.path.localeCompare(b.path));
  let readable=candidates;
  if(cutoff){
    const eligible:typeof candidates=[],unknown:typeof candidates=[];
    result.pitExcluded=[];result.complete=false;result.reasons.push("point_in_time_bounded_versions");
    for(const c of candidates){
      let version:ReturnType<typeof receiptVersionAt>|null=null;
      try{version=observer.search("canonical_review","PIT indexed receipt admission",undefined,()=>indexedReceiptVersion(c.path,c.frontmatter));}
      catch{result.reasons.push("pit_admission_unavailable");}
      if(!version){unknown.push(c);result.reasons.push("pit_admission_unverified");continue;}
      const published=publicationWindow(c.publishedAt);
      const reason=Date.parse(version.knownAt)>Date.parse(cutoff)?"pit_after_cutoff":
        published&&published[0]>Date.parse(cutoff)?"pit_publication_after_cutoff":null;
      if(reason)result.pitExcluded.push({path:c.path,reason});
      else eligible.push(c);
    }
    // Keep the original total physical-read cap. Unverifiable records cannot
    // displace verified eligible versions or become evidence without readback.
    readable=[...eligible,...unknown];
  }
  if(readable.length>8){
    result.complete=false;result.reasons.push("canonical_read_limit");
    result.deferredReviews=readable.slice(8).map(c=>({path:c.path,intakeId:c.intakeId,publishedAt:c.publishedAt,reason:"canonical_read_limit"}));
  }
  for(const c of readable.slice(0,8))try{
    const note=observer.read("canonical_review",c.path,()=>indexedRead(c.path));
    result.reviews.push({path:c.path,intakeId:c.intakeId,publishedAt:c.publishedAt,legacy:c.legacy,bundle:assemble(c.path,c.intakeId,note,observer)});
  }catch{result.complete=false;result.reasons.push("canonical_readback_unavailable");}
  result.reasons=[...new Set(result.reasons)];
  if(!result.complete)result.chronology="SCAN_INCOMPLETE";
  else if(result.reviews.length){
    const windows=result.reviews.map(r=>publicationWindow(r.publishedAt));
    // A unique latest exists only when its earliest possible publication is
    // strictly after every other's latest. Unknown / overlaps remain explicit.
    const latest=result.reviews.filter((_,i)=>windows[i]&&windows.every((w,j)=>i===j||w&&windows[i]![0]>w[1]));
    result.chronology=latest.length===1?"LATEST_BY_DECLARED_PUBLICATION":"ORDER_UNKNOWN";
    result.latestReviewPaths=latest.map(x=>x.path);
  }
  return result;
}

const subjectFolders={industry:"10_Knowledge/Industry and Concepts/Investment Review - ",macro:"10_Knowledge/Macro and Markets/Investment Review - "} as const;
export interface SubjectReviewScan {domain:"industry"|"macro";paths:string[];complete:boolean;reasons:string[];historicalNonInSkipped:number}
/** M56-P1: bounded discovery of other Industry-IN / Macro-IN Reviews for ONE typed
 * subject — an exact Industry Hub path, or a Source-stated macro geography. Only the
 * domain's own folder (at most 200 indexed rows, never a global scan). A row whose
 * metadata cannot be classified, or more than 6 matches, makes the scan incomplete
 * (fail-closed); historical non-IN notes stay read-only and are counted, not bound.
 * A match is a history candidate only, never event or subject equivalence. */
export function discoverSubjectReviews(domain:"industry"|"macro",subject:{hubPath:string}|{geography:string},exclude:string[]):SubjectReviewScan{
  const prefix=subjectFolders[domain],result:SubjectReviewScan={domain,paths:[],complete:true,reasons:[],historicalNonInSkipped:0};
  const rows=db().prepare("SELECT path,frontmatter FROM notes WHERE path>=? AND path<? ORDER BY path LIMIT 201")
    .all(prefix,prefix.slice(0,-1)+"!") as {path:string;frontmatter:string|null}[];
  if(rows.length>200){result.complete=false;result.reasons.push("subject_scope_scan_limit");}
  const fold=(s:string)=>s.normalize("NFC").replace(/\p{Cf}/gu,"").replace(/\s+/g," ").trim().toLowerCase();
  const matches:string[]=[];
  for(const row of rows.slice(0,200)){
    if(!/ - IN-[A-F0-9]{16}\.md$/.test(row.path)){result.historicalNonInSkipped++;continue;}
    const fm=metadata(row.frontmatter),id=fm?.intake_id;
    if(!fm||fm.type!=="investment_research_review"||fm.review_scope!==domain||typeof id!=="string"||!intake.test(id)||!row.path.endsWith(" - "+id+".md")){
      result.complete=false;result.reasons.push("subject_metadata_unresolved");continue;
    }
    if("hubPath" in subject){
      if(!Array.isArray(fm.industry_hubs)){result.complete=false;result.reasons.push("subject_metadata_unresolved");continue;}
      if(fm.industry_hubs.includes(subject.hubPath))matches.push(row.path);
    }else{
      const fts=db().prepare("SELECT body FROM notes_fts WHERE path=?").get(row.path) as {body:string}|undefined;
      if(!fts){result.complete=false;result.reasons.push("subject_fts_binding_missing");continue;}
      if(fold(fts.body).includes(fold(subject.geography)))matches.push(row.path);
    }
  }
  const others=matches.filter(p=>!exclude.includes(p));
  if(others.length>6){result.complete=false;result.reasons.push("subject_read_limit");}
  result.paths=others.slice(0,6);result.reasons=[...new Set(result.reasons)];
  return result;
}

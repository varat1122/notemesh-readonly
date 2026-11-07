import {researchTrust,type ResearchTrust} from "./research-state";
import {judgeExclusionSql,type JudgeSelectionPolicy} from "./queries";
/** Read-only adapters for existing canonical Review/Source/receipt contracts.
 * No new identities, tables, writes, or economic-event equivalence inference. */
import {RetrievalObserver} from "./investment-retrieval-coverage";
import {createHash} from "node:crypto";
import {db} from "../db";
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
export interface CanonicalResearchScan {
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
export function createReceipt(kind:"source_intake"|"canonical_review"|"structured_claim",path:string,content:string):string{
  const hash=sha(content),empty=sha("");
  const id="ICW-"+sha([kind,path,hash].join("\n")).slice(0,32);
  // Never call Safe Edit status/store: it initializes tables. SELECT only.
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get())throw Error("receipt_store_missing");
  const row=db().prepare("SELECT payload,after_text,after_hash,before_hash,receipt FROM safe_edit_operations WHERE id=? AND status='written'")
    .get(id) as {payload:string;after_text:string;after_hash:string;before_hash:string;receipt:string|null}|undefined;
  if(!row||row.after_text!==content||row.after_hash!==hash||row.before_hash!==empty)throw Error("create_receipt_unverified");
  const p=metadata(row.payload),r=metadata(row.receipt);
  const change=p?.change as {kind?:unknown;content?:unknown}|undefined;
  if(!p||!r||p.path!==path||p.operationId!==id||change?.kind!=="create"||change.content!==content||
    r.operationId!==id||r.path!==path||r.afterHash!==hash||r.beforeHash!==empty||
    r.write!=="written"||r.readback!=="verified"||r.reindex!=="verified")throw Error("create_receipt_unverified");
  return id;
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

export function discoverCanonicalResearch(contextKey:string,intakeId?:string,resolvedSubjects?:string[],observer=new RetrievalObserver(),judgePolicy?:JudgeSelectionPolicy):CanonicalResearchScan{
  const result:CanonicalResearchScan={contextKey,reviews:[],complete:true,reasons:[],chronology:"NOT_FOUND",latestReviewPaths:[]};
  // Only subjects already resolved to this Hub may extend filename discovery:
  // its title, requested labels and bounded explicit aliases checked by caller.
  const subjects=[...new Set([contextKey,...resolvedSubjects??[]])];
  const prefixes=subjects.map(subject=>folder+subject+" - ");
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
  if(candidates.length>8){result.complete=false;result.reasons.push("canonical_read_limit");}
  for(const c of candidates.slice(0,8))try{
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

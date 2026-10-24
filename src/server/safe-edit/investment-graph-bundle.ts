/**
 * PR #104 — ONE EXPLICITLY AUTHORIZED MCP WRITE ACTION for one event's
 * non-protected Investment Analysis + living Company Evolution link.
 *
 * Not unattended/standing-policy auto-save. The enclosing MCP tool is marked
 * mutating and must be authorized by the host as one bundled action. It
 * invokes the existing Safe Edit preview/apply for each note, with per-note
 * CAS, journal and backups, under the existing verified paused-Sync guard.
 * No separate hidden mutation API and NO protected Thesis/Portfolio writes.
 *
 * Failure between two separate note commits is NOT atomic; return a truthful
 * partial receipt requiring manual reconciliation, never auto-retry.
 */
import path from "node:path";
import {z} from "zod";
import {db} from "../db";
import {resolveNotePath,readVaultFile} from "../vault/paths";
import {extractStructure,splitFrontmatter} from "../vault/markdown";
import {preview,apply,status as editStatus,sha256} from "./engine";
import {withPausedSync} from "./sync";
import {verifyAuthorizedInvestmentGraphReadback}
  from "./knowledge-graph-readback";

const OPS=z.string().regex(/^[a-z][a-z0-9-]{8,60}$/);
const REL=/^[\p{L}\p{N} _./()-]+\.md$/u;
const EVENT=/^[\p{L}\p{N}_. -]{4,140}$/u;
const TICKER=/^[A-Za-z0-9][A-Za-z0-9._ -]{0,49}$/;
const BASE="08_Daily_Weekly/Research Indexes/";
const ANALYSIS=BASE+"Investment Review - ";
const TIMELINE=BASE+"Company Evolution - ";
const SOURCE_DIRS=["07_Sources/","10_Knowledge/","08_Daily_Weekly/"];
const allowedTarget=(p:string)=>[
  "01_Companies/","02_Industries_Themes/","05_Thesis/",
  "07_Sources/","08_Daily_Weekly/","10_Knowledge/",
].some(prefix=>p.startsWith(prefix));
const canonical=(p:string)=>REL.test(p)&&p.length<=350&&
  !p.startsWith("/")&&!p.includes("//")&&!p.includes("/./")&&
  !p.includes("\\")&&p.split("/").every(x=>x!==".."&&x!=="."&&x.trim()===x);
const inputSchema=z.object({
  operationRoot:OPS,
  issuer:z.string().regex(TICKER),
  eventKey:z.string().regex(EVENT),
  period:z.string().min(1).max(100),
  timelineDate:z.string().date(),
  timelineHeading:z.string().min(1).max(150),
  analysisPath:z.string().min(1).max(350),
  timelinePath:z.string().min(1).max(350),
  sourcePath:z.string().min(1).max(350),
  /** Complete investment analysis draft with per-claim references and notes. */
  analysisMarkdown:z.string().min(150).max(90_000),
  /** A separate, explicitly host-authorized action; NEVER an automatic replay. */
  recoverTimelineOnly:z.boolean().optional(),
  /** Immutable source binding from read-only real-context preparation. */
  expectedSourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type InvestmentGraphBundleInput=z.infer<typeof inputSchema>;

function once(text:string,needle:string){
  return text.split(needle).length===2;
}
function loadIndexed(p:string){
  const row=db().prepare("SELECT path FROM notes WHERE path=?")
    .get(p) as {path:string}|undefined;
  if(!row||row.path!==p)
    throw Error("graph_bundle_canonical_note_not_indexed_hold");
  return readVaultFile(resolveNotePath(p));
}
function note(raw:string){
  const f=splitFrontmatter(raw);
  if(f.invalid||!f.fmOffset||!f.data||
    typeof f.data!=="object")
    throw Error("graph_bundle_invalid_frontmatter_hold");
  return f;
}
function currentStatus(id:string,actor:string){
  try{return editStatus(id,actor);}
  catch(e){
    if(e instanceof Error&&e.message==="Unknown operation")return null;
    throw e;
  }
}
function fullyWritten(r:ReturnType<typeof editStatus>){
  return r.status==="written"&&r.receipt?.write==="written"&&
    r.receipt?.readback==="verified"&&r.receipt?.reindex==="verified";
}
function requireFeature(){
  if(process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED!=="1")
    throw Error("graph_bundle_disabled_admin_explicit_opt_in_required");
}
function validatePreflight(i:InvestmentGraphBundleInput,existingAnalysis=false){
  if(!canonical(i.analysisPath)||!canonical(i.timelinePath)||
    !canonical(i.sourcePath)||!SOURCE_DIRS.some(d=>i.sourcePath.startsWith(d))||
    i.analysisPath!==ANALYSIS+i.issuer+" - "+i.eventKey+".md"||
    i.timelinePath!==TIMELINE+i.issuer+".md"||
    i.sourcePath===i.timelinePath||i.sourcePath===i.analysisPath||
    !i.timelineHeading||i.timelineHeading.startsWith("#")||
    !/^\d{4}-\d{2}-\d{2}$/.test(i.timelineDate)||
    new Date(i.timelineDate+"T00:00:00Z").toISOString().slice(0,10)!==
      i.timelineDate)
    throw Error("graph_bundle_noncanonical_paths_or_date_hold");
  if(i.analysisPath.startsWith("05_Thesis/")||
    i.timelinePath.startsWith("05_Thesis/")||
    i.analysisPath.startsWith("06_Portfolio/"))
    throw Error("graph_bundle_protected_target_hold");
  const previous=db().prepare(`SELECT f.body,n.frontmatter,n.size
    FROM notes AS n JOIN notes_fts AS f ON f.rowid=n.rowid
    WHERE n.path=?`).get(i.analysisPath) as
    {body:string;frontmatter:string|null;size:number}|undefined;
  if(previous&&!existingAnalysis)
    throw Error("graph_bundle_analysis_already_exists_hold");
  if(existingAnalysis){
    const saved=loadIndexed(i.analysisPath);
    const parsed=note(saved);
    if(saved!==i.analysisMarkdown||previous?.body!==parsed.body||
      previous?.frontmatter!==JSON.stringify(parsed.data)||
      previous?.size!==Buffer.byteLength(saved,"utf8"))
      throw Error("graph_bundle_recovery_analysis_physical_or_index_mismatch_hold");
  }
  const sourceRaw=loadIndexed(i.sourcePath);
  if(sha256(sourceRaw)!==i.expectedSourceSha256)
    throw Error("graph_bundle_source_changed_since_context_review_hold");
  const src=note(sourceRaw);
  const sourceIndex=db().prepare(`SELECT n.frontmatter,n.size,f.body
    FROM notes AS n JOIN notes_fts AS f ON f.rowid=n.rowid WHERE n.path=?`)
    .get(i.sourcePath) as {frontmatter:string|null;size:number;body:string}|undefined;
  if(!sourceIndex||sourceIndex.body!==src.body||
    sourceIndex.frontmatter!==JSON.stringify(src.data)||
    sourceIndex.size!==Buffer.byteLength(sourceRaw,"utf8"))
    throw Error("graph_bundle_source_physical_index_mismatch_hold");
  const evolution=note(loadIndexed(i.timelinePath));
  const analysis=note(i.analysisMarkdown);
  const m=analysis.data,s=src.data,t=evolution.data;
  // Persist the reviewed source identity inside the exact Analysis bytes
  // protected by the Safe Edit receipt's afterHash. Readback and recovery
  // must use this durable binding, never a newly supplied replacement hash.
  if(m.source_path!==i.sourcePath||m.source_sha256!==i.expectedSourceSha256)
    throw Error("graph_bundle_reviewed_source_binding_missing_or_mismatched_hold");
  if(s.entity!==i.issuer||s.event_key!==i.eventKey||
    !["primary","attributed","user_supplied"].includes(String(s.source_type))||
    (t.entity!==undefined&&t.entity!==i.issuer)||
    (t.company!==undefined&&t.company!==i.issuer)||
    (t.entity!==i.issuer&&t.company!==i.issuer)||
    m.type!=="investment_review"||m.entity!==i.issuer||
    m.event_key!==i.eventKey||
    m.operation_id!==i.operationRoot||
    m.source_type!=="archived_ai"||
    m.independent_evidence!==false||
    !["not_reverified","unverified"].includes(String(m.verification))||
    m.status!=="draft"||typeof m.analysis_origin!=="string"||
    m.analysis_origin.length===0||m.user_endorsed===true)
    throw Error("graph_bundle_issuer_source_or_provenance_hold");
  if(typeof s.period==="string"&&s.period!==i.period)
    throw Error("graph_bundle_source_period_mismatch_hold");
  const head=extractStructure(evolution.body).headings;
  if(head.filter(x=>x.text===i.timelineHeading).length!==1)
    throw Error("graph_bundle_timeline_heading_missing_or_ambiguous_hold");
  const marker="<!-- investment-os-operation:"+i.operationRoot+" -->";
  const evMarker="<!-- investment-os-event:"+i.eventKey+" -->";
  if(!once(i.analysisMarkdown,marker)||!once(i.analysisMarkdown,evMarker)||
    evolution.body.includes(marker)||evolution.body.includes(evMarker))
    throw Error("graph_bundle_existing_event_or_marker_mismatch_hold");
  const bodyLinks=extractStructure(analysis.body).links;
  if(bodyLinks.length<3||bodyLinks.length>18||
    new Set(bodyLinks).size!==bodyLinks.length||
    !bodyLinks.includes(i.sourcePath.slice(0,-3))||
    !bodyLinks.includes(i.timelinePath.slice(0,-3))||
    !bodyLinks.includes("01_Companies/"+i.issuer))
    throw Error("graph_bundle_missing_required_canonical_graph_links_hold");
  for(const link of bodyLinks){
    const target=link+".md";
    if(!canonical(target)||!allowedTarget(target))
      throw Error("graph_bundle_out_of_scope_link_hold");
    loadIndexed(target);
  }
  if(path.basename(i.analysisPath).length>185)
    throw Error("graph_bundle_analysis_filename_too_long_hold");
  return {marker,evMarker,links:bodyLinks.length};
}

/**
 * Real implementation: writes only when the OUTER host explicitly authorizes
 * the mutable MCP action. Recovery needs a NEW separately authorized call
 * with recoverTimelineOnly=true, never an automatic retry of the first call.
 * No incoming preview/apply token, approval boolean or policy claim is trusted.
 */
export async function applyAuthorizedInvestmentGraphBundle(
  input:unknown,authenticatedActor:string,
){
  requireFeature();
  if(!authenticatedActor?.startsWith("oauth:"))
    throw Error("graph_bundle_authenticated_safe_edit_actor_required");
  const i=inputSchema.parse(input);
  const aid=i.operationRoot+"-analysis",tid=i.operationRoot+"-timeline";
  if(aid.length>80||tid.length>80)
    throw Error("graph_bundle_operation_id_out_of_bounds");
  return withPausedSync(()=>{
    const evidence={
      entity:i.issuer,event:i.eventKey,period:i.period,
      originalSource:i.sourcePath,
      classification:"unresolved" as const,
      delta:"New analysis proposal linked to original source; independent claim verification pending.",
      independent:false as const,
      verification:"not_reverified" as const,
      sourceType:"archived_ai" as const,
      event_date:null,published_at:null,received_at:null,
      imported_at:null,verified_at:null,
      relatedPaths:[i.sourcePath,"01_Companies/"+i.issuer+".md",i.timelinePath],
    };
    // Shared second-write path: both initial write and explicitly authorized
    // recovery must use the same existing CAS/journal/readback engine.
    const finishTimeline=(marker:string,evMarker:string,recovering:boolean)=>{
      try{
        const changed=loadIndexed(i.timelinePath);
        if(changed.includes(marker)||changed.includes(evMarker))
          throw Error("graph_bundle_timeline_changed_or_duplicate_event_hold");
        const timelineContent=[
          marker,evMarker,
          "- [["+i.analysisPath.slice(0,-3)+
            "]] — Historical AI analysis; not independently verified.",
        ].join("\n");
        const append=preview({
          operationId:tid,path:i.timelinePath,
          reason:recovering?
            "Separately host-authorized recovery of missing Company Evolution link":
            "Host-authorized append to existing Company Evolution Timeline",
          change:{kind:"append",heading:i.timelineHeading,
            content:timelineContent,date:i.timelineDate},
          evidence,
        },authenticatedActor);
        if(!append.previewToken)
          throw Error("graph_bundle_timeline_preview_token_absent_hold");
        const second=apply({
          operationId:tid,previewToken:append.previewToken,
          expectedHash:append.beforeHash,
        },authenticatedActor);
        if(!fullyWritten(second))
          throw Error("graph_bundle_timeline_receipt_incomplete_hold");
        const graph=verifyAuthorizedInvestmentGraphReadback({
          analysisOperationId:aid,timelineOperationId:tid,
          analysisPath:i.analysisPath,timelinePath:i.timelinePath,
          sourcePath:i.sourcePath,
        },authenticatedActor);
        return {
          status:recovering?
            "authorized_timeline_recovery_written_and_graph_readback_verified":
            "authorized_two_note_graph_written_and_readback_verified",
          analysisOperationId:aid,timelineOperationId:tid,
          graph,
          oneHostAuthorizedAction:true as const,
          recoveryOnly:recovering,
          multiNoteAtomicityGuaranteed:false as const,
          mobileSyncVerified:false as const,
        };
      }catch{
        // Do not silently redo, roll back or declare success for an
        // interrupted or partially recorded second operation.
        return {
          status:"analysis_written_timeline_or_graph_needs_manual_reconciliation" as const,
          analysisOperationId:aid,timelineOperationId:tid,
          firstNoteSaveReceiptVerified:true as const,
          entireKnowledgeGraphVerified:false as const,
          actionNotAutomaticallyRetried:true as const,
          mobileSyncVerified:false as const,
        };
      }
    };
    const priorAnalysis=currentStatus(aid,authenticatedActor);
    const priorTimeline=currentStatus(tid,authenticatedActor);
    if(priorAnalysis||priorTimeline){
      if(priorAnalysis&&priorTimeline&&
        fullyWritten(priorAnalysis)&&fullyWritten(priorTimeline)){
        if(note(loadIndexed(i.analysisPath)).data.source_sha256!==i.expectedSourceSha256)
          throw Error("graph_bundle_reviewed_source_binding_missing_or_mismatched_hold");
        const check=verifyAuthorizedInvestmentGraphReadback({
          analysisOperationId:aid,timelineOperationId:tid,
          analysisPath:i.analysisPath,timelinePath:i.timelinePath,
          sourcePath:i.sourcePath,
        },authenticatedActor);
        return {
          status:"previously_written_both_receipts_graph_reverified" as const,
          analysisOperationId:aid,timelineOperationId:tid,
          graph:check,
          replayDidNotWrite:true as const,
          mobileSyncVerified:false as const,
        };
      }
      // A first-note success with NO timeline operation is the sole recoverable
      // case. A preview/writing/failed timeline might already have modified
      // bytes; never reuse its ID or guess which stage committed.
      if(i.recoverTimelineOnly===true && priorAnalysis && !priorTimeline &&
        fullyWritten(priorAnalysis)){
        // Recheck original source and existing anchors, provenance, exact
        // paths, Markdown links and duplicate event markers, NOW.
        const {marker,evMarker}=validatePreflight(i,true);
        const saved=loadIndexed(i.analysisPath);
        if(priorAnalysis.path!==i.analysisPath||
          priorAnalysis.afterHash!==sha256(saved)||
          priorAnalysis.receipt?.afterHash!==priorAnalysis.afterHash||
          saved!==i.analysisMarkdown)
          throw Error("graph_bundle_recovery_receipt_or_analysis_changed_hold");
        return finishTimeline(marker,evMarker,true);
      }
      return {
        status:"existing_partial_or_preview_operations_manual_review" as const,
        analysisOperationId:aid,timelineOperationId:tid,
        replayDidNotWrite:true as const,
        newWriteExecuted:false as const,
        deviceSyncVerified:false as const,
      };
    }
    if(i.recoverTimelineOnly===true)
      throw Error("graph_bundle_recovery_requires_existing_written_analysis_hold");
    const {marker,evMarker}=validatePreflight(i);
    const prepared=preview({
      operationId:aid,path:i.analysisPath,
      reason:"Host-authorized non-protected historical Investment Graph Analysis writeback",
      change:{kind:"create",content:i.analysisMarkdown},evidence,
    },authenticatedActor);
    if(!prepared.previewToken)
      throw Error("graph_bundle_analysis_preview_token_absent_hold");
    const first=apply({
      operationId:aid,previewToken:prepared.previewToken,
      expectedHash:prepared.beforeHash,
    },authenticatedActor);
    if(!fullyWritten(first)){
      return {
        status:"analysis_incomplete_manual_recovery_required" as const,
        analysisOperationId:aid,timelineOperationId:tid,
        secondNoteWriteAttempted:false as const,
        mobileSyncVerified:false as const,
      };
    }
    return finishTimeline(marker,evMarker,false);
  });
}

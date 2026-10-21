/**
 * PR #103 — actual-server read-only verification of TWO independently
 * authorized Safe Edit writes and their Obsidian Knowledge Graph edges.
 *
 * This does NOT PREVIEW/APPLY or create an auto-write permission. The actor is
 * obtained from authenticated MCP access, never caller parameters. It checks
 * the REAL Safe Edit operation receipts, physical note contents, FTS and
 * resolved path-qualified Wikilinks. A test port cannot masquerade as a real
 * server readback.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {readVaultFile,resolveNotePath} from "../vault/paths";
import {extractStructure,splitFrontmatter} from "../vault/markdown";
import {status as safeEditStatus} from "./engine";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const OP=/^[A-Za-z0-9_-]{8,80}$/;
const SAFE=/^[\p{L}\p{N} _./()-]+\.md$/u;
const ANALYSIS_PREFIX="08_Daily_Weekly/Research Indexes/Investment Review - ";
const TIMELINE_PREFIX="08_Daily_Weekly/Research Indexes/Company Evolution - ";
const word=(s:unknown)=>typeof s==="string"&&s.length>0&&s.length<160;
const canonical=(p:unknown):p is string=>
  typeof p==="string"&&p.length<=350&&p.length>3&&SAFE.test(p)&&
  !p.startsWith("/")&&!p.includes("//")&&!p.includes("/./")&&
  p.split("/").every(x=>x!==".."&&x!=="."&&x.trim()===x)&&
  !p.includes("\\");
type GraphInput={
  analysisOperationId:string;
  timelineOperationId:string;
  analysisPath:string;
  timelinePath:string;
  sourcePath:string;
};
type Receipt={
  operationId:string;status:string;path:string;
  beforeHash:string;afterHash:string;
  receipt:null|{
    operationId:string;path:string;beforeHash:string;afterHash:string;
    write:string;readback:string;reindex:string;
    sync?:string;remoteSync?:string;mobileSync?:string;
  };
};
type Indexed={path:string;frontmatter:string|null;body:string;size:number;mtime:number};
type Edge={target:string;resolved_path:string|null};
type Port={
  getReceipt:(id:string)=>Receipt;
  getPhysical:(path:string)=>string;
  getIndexed:(path:string)=>Indexed|null;
  getEdges:(path:string)=>Edge[];
  noteExists:(path:string)=>boolean;
};
const noteData=(raw:string)=>{
  const parsed=splitFrontmatter(raw);
  if(parsed.invalid||parsed.fmOffset===0||
    !parsed.data||typeof parsed.data!=="object")
    throw Error("graph_readback_invalid_note_frontmatter_hold");
  return parsed;
};
function assertReceipt(r:Receipt,op:string,p:string){
  if(!r||r.operationId!==op||r.path!==p||r.status!=="written"||
    !/^[a-f0-9]{64}$/.test(r.afterHash)||
    !r.receipt||r.receipt.operationId!==op||
    r.receipt.path!==p||r.receipt.afterHash!==r.afterHash||
    r.receipt.beforeHash!==r.beforeHash||
    r.receipt.write!=="written"||r.receipt.readback!=="verified"||
    r.receipt.reindex!=="verified")
    throw Error("graph_readback_operation_not_independently_written_hold");
  return r.afterHash;
}
function assertIndexed(port:Port,p:string,raw:string){
  const row=port.getIndexed(p);
  const parsed=noteData(raw);
  if(!row||row.path!==p||row.body!==parsed.body||
    row.frontmatter!==(Object.keys(parsed.data).length?
      JSON.stringify(parsed.data):null)||
    row.size!==Buffer.byteLength(raw,"utf8"))
    throw Error("graph_readback_physical_markdown_fts_mismatch_hold");
  return parsed;
}
/** Accepts a deliberately supplied read-only data source for offline tests. */
export function checkInvestmentGraphAgainstReadbackPort(
  input:GraphInput,port:Port,
){
  if(!input||!port||
    !OP.test(input.analysisOperationId)||
    !OP.test(input.timelineOperationId)||
    !canonical(input.analysisPath)||!canonical(input.timelinePath)||
    !canonical(input.sourcePath)||
    !input.analysisPath.startsWith(ANALYSIS_PREFIX)||
    !input.timelinePath.startsWith(TIMELINE_PREFIX)||
    new Set([input.analysisPath,input.timelinePath,input.sourcePath]).size!==3||
    !input.analysisOperationId.endsWith("-analysis")||
    !input.timelineOperationId.endsWith("-timeline")||
    input.analysisOperationId.slice(0,-9)!==
      input.timelineOperationId.slice(0,-9))
    throw Error("graph_readback_unbound_or_uncanonical_request_hold");

  const a=assertReceipt(port.getReceipt(input.analysisOperationId),
    input.analysisOperationId,input.analysisPath);
  const t=assertReceipt(port.getReceipt(input.timelineOperationId),
    input.timelineOperationId,input.timelinePath);
  const content=port.getPhysical(input.analysisPath);
  const timeline=port.getPhysical(input.timelinePath);
  const original=port.getPhysical(input.sourcePath);
  if(sha(content)!==a||sha(timeline)!==t)
    throw Error("graph_readback_physical_hash_disagrees_with_receipt_hold");
  const analysis=assertIndexed(port,input.analysisPath,content);
  assertIndexed(port,input.timelinePath,timeline);
  const source=noteData(original);
  if(!port.noteExists(input.sourcePath)||!port.getIndexed(input.sourcePath))
    throw Error("graph_readback_original_source_not_indexed_hold");
  const m=analysis.data,s=source.data;
  const issuer=m.entity;
  if(!word(issuer)||!word(m.event_key)||
    input.timelinePath!==
      TIMELINE_PREFIX+issuer+".md"||
    m.type!=="investment_review"||
    m.source_type!=="archived_ai"||
    m.independent_evidence!==false||
    !["not_reverified","unverified"].includes(String(m.verification))||
    !word(m.analysis_origin)||
    !["primary","attributed","user_supplied"].includes(String(s.source_type))||
    (word(s.entity)&&s.entity!==issuer)||
    (word(s.event_key)&&s.event_key!==m.event_key))
    throw Error("graph_readback_source_analysis_provenance_not_separated_hold");
  // The Analysis afterHash above binds these fields to the original write.
  // Legacy unbound reviews must be reconciled explicitly, not rebound to the
  // current source by a caller or replay. A digest proves version, not truth.
  if(m.source_path!==input.sourcePath||typeof m.source_sha256!=="string"||
    !/^[a-f0-9]{64}$/.test(m.source_sha256))
    throw Error("graph_readback_reviewed_source_binding_missing_or_mismatched_hold");
  if(sha(original)!==m.source_sha256)
    throw Error("graph_readback_source_changed_since_review_hold");
  assertIndexed(port,input.sourcePath,original);
  // Catch duplicate-operation and duplicate-event replays on living timeline.
  const opRoot=input.analysisOperationId.slice(0,-9);
  const opMarker="<!-- investment-os-operation:"+opRoot+" -->";
  const eventMarker="<!-- investment-os-event:"+m.event_key+" -->";
  if(!content.includes(opMarker)||!timeline.includes(opMarker)||
    content.split(opMarker).length!==2||
    timeline.split(opMarker).length!==2||
    content.split(eventMarker).length!==2||
    timeline.split(eventMarker).length!==2)
    throw Error("graph_readback_missing_or_replayed_event_marker_hold");

  // Require full path-qualified Wikilinks. The normal indexer can fall back
  // to a basename match for ambiguous links: that is NOT sufficient here.
  const outgoing=extractStructure(analysis.body).links;
  const backlink=extractStructure(noteData(timeline).body).links;
  if(outgoing.length<3||outgoing.length>20||
    new Set(outgoing).size!==outgoing.length||
    !outgoing.includes(input.sourcePath.slice(0,-3))||
    !outgoing.includes(input.timelinePath.slice(0,-3))||
    !outgoing.includes("01_Companies/"+issuer))
    throw Error("graph_readback_missing_required_knowledge_anchors_hold");
  const outIndex=port.getEdges(input.analysisPath);
  for(const target of outgoing){
    if(!target.includes("/")||
      !canonical(target+".md")||
      !port.noteExists(target+".md")||
      !outIndex.some(row=>row.target===target&&
        row.resolved_path===target+".md"))
      throw Error("graph_readback_dangling_or_wrong_wikilink_target_hold");
  }
  const timelineTarget=input.analysisPath.slice(0,-3);
  const backIndex=port.getEdges(input.timelinePath);
  if(backlink.filter(x=>x===timelineTarget).length!==1||
    !backIndex.some(x=>x.target===timelineTarget&&
      x.resolved_path===input.analysisPath))
    throw Error("graph_readback_missing_company_timeline_backlink_hold");

  return {
    status:"graph_integrity_proven_against_supplied_readback_source" as const,
    originalSourceIndependentlyAuthenticated:false as const,
    originalSourcePromotedToVerified:false as const,
    archivedAIIsIndependentEvidence:false as const,
    verifiedPersistedAnalysisAndTimelineCount:2 as const,
    fullPathOutgoingWikilinksResolved:outgoing.length,
    livingTimelineBacklinkVerified:true as const,
    physicalMarkdownAndFTSAgree:true as const,
    exactOperationAfterHashesVerified:true as const,
    reviewedSourceVersionVerified:true as const,
    userOrOwnerAuthorizationDerivedFromInput:false as const,
    protectedCurrentThesisModifiedByVerifier:false as const,
    vaultWrittenByVerifier:false as const,
    mobileDeviceSyncVerified:false as const,
    portfolioModified:false as const,
    noteTextPathsAndOAuthTokensReturned:false as const,
  };
}
/** The ONLY production-facing entry. Called inside authenticated MCP scope. */
export function verifyAuthorizedInvestmentGraphReadback(
  input:GraphInput,authenticatedActor:string,
){
  if(typeof authenticatedActor!=="string"||
    authenticatedActor.length<1||authenticatedActor.length>256)
    throw Error("graph_readback_authenticated_actor_required");
  const database=db();
  const port:Port={
    getReceipt:id=>safeEditStatus(id,authenticatedActor) as Receipt,
    getPhysical:p=>readVaultFile(resolveNotePath(p)),
    noteExists:p=>{
      const row=database.prepare("SELECT path FROM notes WHERE path=?")
        .get(p) as {path:string}|undefined;
      if(!row||row.path!==p)return false;
      try{readVaultFile(resolveNotePath(p));return true;}catch{return false;}
    },
    getIndexed:p=>(database.prepare(`SELECT n.path,n.frontmatter,f.body,n.size,n.mtime
      FROM notes AS n JOIN notes_fts AS f ON f.rowid=n.rowid
      WHERE n.path=?`).get(p) as Indexed|undefined)??null,
    getEdges:p=>database.prepare(
      "SELECT target,resolved_path FROM links WHERE source_path=?"
    ).all(p) as Edge[],
  };
  const result=checkInvestmentGraphAgainstReadbackPort(input,port);
  return {
    ...result,
    status:"authorized_safe_edit_server_graph_readback_verified" as const,
    actualReceiptScope:"authenticated_oauth_client_only" as const,
    serverNotDeviceReadback:true as const,
  };
}

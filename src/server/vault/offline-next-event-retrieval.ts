/**
 * PR #101 — Prove the NEXT investment event can retrieve saved historical AI
 * analysis as ANALYSIS, not as independent issuer evidence.
 *
 * Runs only inside PR #99's temporary synthetic writeback worktree, after
 * physical two-note write/readback + SQLite/FTS/link reconciliation.
 * Exact source/analysis paths and returned note bodies stay private.
 *
 * This is a real read against a copied SQLite FTS and copied Markdown bytes,
 * NOT a live connector search or proof of model semantic performance.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {splitFrontmatter} from "./markdown";

type ContextRow={path:string;frontmatter:string|null;title:string};
type LinkRow={source_path:string;target:string;resolved_path:string|null};
const hash=(v:Buffer|string)=>createHash("sha256").update(v).digest("hex");
const canon=(p:string)=>p.slice(0,-3);
const roles=["issuer_original_unverified",
  "historical_ai_analysis_not_primary"] as const;

export function proveOfflineNextEventRetrieval(input:{
  workspace:string;
  issuer:"SYNTH";
  analysisPath:string;
  sourcePath:string;
  timelinePath:string;
  operationId:string;
  expectedAnalysisSha256:string;
}){
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID||
    process.env.RAILWAY_SERVICE_ID||input?.issuer!=="SYNTH"||
    typeof input.workspace!=="string"||
    typeof input.operationId!=="string"||
    !/^[a-z][a-z0-9-]{7,95}$/.test(input.operationId)||
    !/^[a-f0-9]{64}$/.test(input.expectedAnalysisSha256))
    throw Error("next_retrieval_offline_synth_only_hold");
  const tmp=fs.realpathSync(os.tmpdir());
  const workspace=fs.realpathSync(input.workspace);
  if(!workspace.startsWith(tmp+path.sep)||
    !path.basename(workspace).startsWith("nm-synthetic-writeback-"))
    throw Error("next_retrieval_not_an_ephemeral_writeback_workspace_hold");
  for(const p of [
    input.analysisPath,input.sourcePath,input.timelinePath,
  ]){
    if(typeof p!=="string"||!p.endsWith(".md")||
      p.startsWith("/")||p.includes("\\")||
      p.split("/").some(part=>!part||part==="."||part==="..")||
      p.length>250)
      throw Error("next_retrieval_invalid_note_path_hold");
  }
  const readExact=(p:string)=>{
    const file=path.join(workspace,"vault",...p.split("/"));
    if(fs.realpathSync(file)!==file)
      throw Error("next_retrieval_symlink_target_refused_hold");
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
      const st=fs.fstatSync(fd);
      if(!st.isFile()||st.nlink!==1||st.size<1||
        st.size>800_000)
        throw Error("next_retrieval_unsupported_file_hold");
      const bytes=fs.readFileSync(fd);
      const now=fs.fstatSync(fd);
      if(now.size!==st.size||now.mtimeMs!==st.mtimeMs||
        now.ctimeMs!==st.ctimeMs||bytes.includes(0))
        throw Error("next_retrieval_changed_during_read_hold");
      const parsed=splitFrontmatter(
        new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      if(parsed.invalid||parsed.fmOffset===0)
        throw Error("next_retrieval_malformed_frontmatter_hold");
      return {bytes,parsed};
    }finally{fs.closeSync(fd);}
  };
  const analysis=readExact(input.analysisPath);
  const source=readExact(input.sourcePath);
  if(hash(analysis.bytes)!==input.expectedAnalysisSha256||
    analysis.parsed.data.entity!=="SYNTH"||
    analysis.parsed.data.type!=="investment_review"||
    analysis.parsed.data.source_type!=="archived_ai"||
    analysis.parsed.data.verification!=="not_reverified"||
    analysis.parsed.data.analysis_origin!=="synthetic_ai_draft"||
    analysis.parsed.data.operation_id!==input.operationId||
    source.parsed.data.entity!=="SYNTH"||
    source.parsed.data.source_type!=="primary"||
    source.parsed.data.verification!=="not_reverified"||
    source.parsed.data.type!=="research_note")
    throw Error("next_retrieval_source_analysis_provenance_confused_hold");

  const d=new Database(path.join(workspace,"app.sqlite"),{
    readonly:true,fileMustExist:true,
  });
  try{
    d.pragma("query_only=ON");
    // A second event for SYNTH about revenue conversion can recall both
    // stored analysis and the original record via FTS; their PROVENANCE
    // must remain distinct. This tests indexed topical retrieval, not
    // semantic relevance or an AI-generated summary.
    const keyword='SYNTH AND revenue';
    const selected=d.prepare(`SELECT n.path,n.title,n.frontmatter
      FROM notes_fts JOIN notes AS n ON n.rowid=notes_fts.rowid
      WHERE notes_fts MATCH ? LIMIT 12`).all(keyword) as ContextRow[];
    const memo=selected.find(x=>x.path===input.analysisPath);
    const original=selected.find(x=>x.path===input.sourcePath);
    if(!memo||!original)
      throw Error("next_retrieval_previous_analysis_or_source_not_found_hold");
    const indexMeta=(r:ContextRow)=>
      r.frontmatter===null?null:JSON.parse(r.frontmatter) as
        Record<string,unknown>;
    const iMeta=indexMeta(memo),sMeta=indexMeta(original);
    if(!iMeta||!sMeta||
      iMeta.source_type!=="archived_ai"||
      iMeta.verification!=="not_reverified"||
      iMeta.analysis_origin!=="synthetic_ai_draft"||
      sMeta.source_type!=="primary"||
      sMeta.verification!=="not_reverified")
      throw Error("next_retrieval_fts_index_provenance_conflict_hold");
    const getLink=(source:string,target:string)=>
      d.prepare(`SELECT source_path,target,resolved_path FROM links
        WHERE source_path=? AND target=?`).get(source,canon(target)) as
        LinkRow|undefined;
    if(getLink(input.analysisPath,input.sourcePath)?.resolved_path!==
      input.sourcePath||
      getLink(input.analysisPath,input.timelinePath)?.resolved_path!==
        input.timelinePath||
      getLink(input.timelinePath,input.analysisPath)?.resolved_path!==
        input.analysisPath)
      throw Error("next_retrieval_link_graph_not_connected_hold");
    const all=d.prepare(`SELECT n.path,n.frontmatter FROM notes AS n
      WHERE n.path=? OR n.path=?`).all(
      input.analysisPath,input.sourcePath) as ContextRow[];
    if(all.length!==2)
      throw Error("next_retrieval_duplicate_or_lost_record_hold");

    return {
      status:"synthetic_second_event_topical_retrieval_verified" as const,
      nextEventIssuer:"synthetic_only" as const,
      queryKind:"issuer_and_revenue_conversion_topic" as const,
      analyzedHistoryRetrieved:true as const,
      originalSourceRecordRetrieved:true as const,
      sourceRole:roles[0],
      historicalAnalysisRole:roles[1],
      recordSourceIndependentlyAuthenticated:false as const,
      sourceVerificationPromotedToPrimaryFact:false as const,
      archivedAIIndependentlyVerified:false as const,
      distinctSourceAndAnalysisRecords:2 as const,
      originalSourceVersionVerifiedFromPublisher:false as const,
      indexedProvenanceMatchesPhysicalMarkdown:true as const,
      analysisToSourceLinkResolved:true as const,
      analysisToCompanyEvolutionLinkResolved:true as const,
      companyEvolutionBacklinkResolved:true as const,
      independentAIRelevanceAssessmentPerformed:false as const,
      actualModelContextSupplied:false as const,
      realVaultModified:false as const,
      resultContainsNoteTextOrPaths:false as const,
      actualDeviceSyncVerified:false as const,
      productionReady:false as const,
    };
  }finally{d.close();}
}

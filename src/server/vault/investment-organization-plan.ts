/**
 * Read-only Investment_OS organization queue.
 *
 * This is a triage plan over indexed metadata, NOT a Vault migration, a
 * semantic duplicate adjudication, proof of original archive loss, or an
 * authorization to edit protected investment decisions.
 */
import { db } from "../db";
import { indexer } from "./indexer";
import { inspectCanonicalKnowledgeMetadata } from "./investment-knowledge-schema";

type Focus = "all" | "source_archives" | "other_links" | "historical_links" | "metadata" | "inbox";
type Row = { path: string; frontmatter: string | null };
type LinkRow = { source: string; target: string };
type Item = {
  key: string;
  paths: string[];
  references?: number;
  finding: string;
  nextAction: string;
  safeEdit: "not_allowed_without_original" | "review_and_preview_only" | "read_and_classify_first";
  ownerReviewRequired: true;
  relationship?: "declared_entity_mention_not_business_relationship";
  targetPath?: string;
};
type Group = {
  priority: "P0" | "P1" | "P2";
  category: Exclude<Focus, "all">;
  total: number;
  examples: Item[];
  truncated: boolean;
};
const MAX_LINK_ROWS=5000;
const MAX_NOTE_ROWS=10000;
const maxExamplesBound=(n:number|undefined)=>Math.min(12,Math.max(1,n??5));
const isProtected=(path:string)=>
  /^05_Thesis\//.test(path) || /^06_Portfolio\//.test(path) ||
  /(?:^|\/)Evidence Register(?:\.|\b)/i.test(path);
const sourceArchive=(target:string)=>
  /^07_Sources\/ChatGPT\/Archive\/.*\.(?:json|zip|txt)$/i.test(target);
const sample=(arr:Item[],limit:number)=>arr.slice(0,limit);
const group=(category:Group["category"],priority:Group["priority"],items:Item[],limit:number):Group=>({
  priority,category,total:items.length,examples:sample(items,limit),truncated:items.length>limit,
});

export function planVaultOrganization(input:{focus?:Focus;maxExamples?:number}={}) {
  const focus=input.focus??"all",limit=maxExamplesBound(input.maxExamples);
  if(!["all","source_archives","other_links","historical_links","metadata","inbox"].includes(focus))
    throw Error("organization_invalid_focus");
  if(input.maxExamples!==undefined && (!Number.isInteger(input.maxExamples)||input.maxExamples<1||input.maxExamples>12))
    throw Error("organization_invalid_example_limit");
  const conn=db();
  const indexedCount=(conn.prepare("SELECT COUNT(*) AS n FROM notes").get() as {n:number}).n;
  const indexReady=indexer().ready;

  const links=conn.prepare(
    "SELECT source_path AS source,target FROM links WHERE resolved_path IS NULL ORDER BY target,source_path LIMIT ?"
  ).all(MAX_LINK_ROWS+1) as LinkRow[];
  const linksCapped=links.length>MAX_LINK_ROWS;
  const archiveMap=new Map<string,string[]>();
  const otherMap=new Map<string,string[]>();
  for(const row of links.slice(0,MAX_LINK_ROWS)){
    const map=sourceArchive(row.target)?archiveMap:otherMap;
    const paths=map.get(row.target)??[];
    if(!paths.includes(row.source))paths.push(row.source);
    map.set(row.target,paths);
  }
  const archive=[...archiveMap].map(([target,paths]):Item=>({
    key:target,paths:paths.slice(0,6),references:paths.length,
    finding:"unresolved_archived_original_reference_not_proven_lost",
    nextAction:"Locate original JSON/ZIP/TXT bytes on known backup/device; check exact path and cryptographic hash before repairing any link. Do not invent originals.",
    safeEdit:"not_allowed_without_original",ownerReviewRequired:true,
  })).sort((a,b)=>(b.references??0)-(a.references??0)||a.key.localeCompare(b.key));
  const other=[...otherMap].map(([target,paths]):Item=>({
    key:target,paths:paths.slice(0,6),references:paths.length,
    finding:"unresolved_wikilink_target_requires_context",
    nextAction:"Read referring note and inspect target/backlinks; verify intended title or rename before previewing an exact link edit.",
    safeEdit:"review_and_preview_only",ownerReviewRequired:true,
  })).sort((a,b)=>(b.references??0)-(a.references??0)||a.key.localeCompare(b.key));

  const rows=conn.prepare("SELECT path,frontmatter FROM notes ORDER BY path LIMIT ?")
    .all(MAX_NOTE_ROWS+1) as Row[];
  const notesCapped=rows.length>MAX_NOTE_ROWS;
  const metadata:Item[]=[];
  const inbox:Item[]=[];
  const historical:Item[]=[];
  const notePaths=new Set(rows.slice(0,MAX_NOTE_ROWS).map(r=>r.path));
  const resolvedRows=conn.prepare(
    "SELECT source_path AS source,resolved_path AS target FROM links WHERE resolved_path IS NOT NULL LIMIT ?"
  ).all(60001) as LinkRow[];
  const resolvedTruncated=resolvedRows.length>60000;
  const linked=new Set(resolvedRows.slice(0,60000).map(r=>JSON.stringify([r.source,r.target])));
  const isLinked=(a:string,b:string)=>linked.has(JSON.stringify([a,b]));
  let normalizedAliases=0;
  for(const note of rows.slice(0,MAX_NOTE_ROWS)){
    let fm:Record<string,unknown>={};
    try{
      const raw=note.frontmatter?JSON.parse(note.frontmatter):{};
      if(raw&&typeof raw==="object"&&!Array.isArray(raw))fm=raw as Record<string,unknown>;
    }catch{/* Malformed legacy fields require separate full note read. */}
    const inspection=inspectCanonicalKnowledgeMetadata(note.path,fm);
    if(inspection.sourceTypeMapping==="legacy_alias")normalizedAliases++;
    if((inspection.role==="historical_analysis"||inspection.role==="review") &&
       note.path.startsWith("10_Knowledge/Company Research/")){
      const declared=Array.isArray(fm.company)?fm.company:[];
      for(const ticker of declared.slice(0,8)){
        if(typeof ticker!=="string"||!/^[A-Za-z0-9._-]{1,18}$/.test(ticker))continue;
        const target="01_Companies/"+ticker+".md";
        if(!notePaths.has(target)||
            (isLinked(note.path,target)&&isLinked(target,note.path)))continue;
        historical.push({
          key:note.path+" => "+target,paths:[note.path,target],targetPath:target,
          finding:"declared_historical_company_link_candidate_not_verified_relationship",
          relationship:"declared_entity_mention_not_business_relationship",
          nextAction:"Read original historical note and Company Hub. Preserve source_records and chronology. Preview only missing navigation wikilinks after review; never infer supplier relation or add independent-event weight.",
          safeEdit:"read_and_classify_first",ownerReviewRequired:true,
        });
      }
    }
    if(note.path.startsWith("00_Inbox/")){
      inbox.push({
        key:note.path,paths:[note.path],
        finding:"inbox_item_requires_source_and_history_triage",
        nextAction:"Read exact original content; search existing related notes and original source identity; then propose a new review or Safe Edit preview. Do not delete or relocate source.",
        safeEdit:"read_and_classify_first",ownerReviewRequired:true,
      });
    }
    const errors=inspection.warnings.filter(w=>
      w==="source_type_misused_for_verification"||
      w==="invalid_event_date"||
      w==="unmapped_legacy_source_type");
    if(errors.length){
      metadata.push({
        key:note.path,paths:[note.path],
        finding:"metadata_needs_human_interpretation:"+errors.join(","),
        nextAction:isProtected(note.path)?
          "Protected note: read complete original/source and prepare owner-approved Change Log; do not update directly.":
          "Read note and original source, retain raw legacy metadata and unknown event dates; preview exact minimal Safe Edit correction only after review.",
        safeEdit:isProtected(note.path)?"not_allowed_without_original":"review_and_preview_only",
        ownerReviewRequired:true,
      });
    }
  }
  // Never treat archived-ai aliases as thousands of source mistakes or auto
  // rewrite old event dates inferred from import dates.
  const groups=[
    group("source_archives","P0",archive,limit),
    group("other_links","P1",other,limit),
    group("inbox","P1",inbox,limit),
    group("historical_links","P1",historical,limit),
    group("metadata","P2",metadata,limit),
  ].filter(g=>focus==="all"||g.category===focus);
  return {
    status:indexReady&&!linksCapped&&!notesCapped&&!resolvedTruncated?
      "indexed_organization_plan_not_applied":"partial_index_or_scan_do_not_execute",
    vaultMutationPerformed:false,
    sourceOriginalsVerified:false,
    mobileSyncVerified:false,
    protectedThesisAutoUpdateAllowed:false,
    readbackAfterSafeEditRequired:true,
    scope:"indexed_markdown_metadata_and_link_references_only",
    indexReady,indexedCount,
    scan:{indexedNotesScanned:Math.min(rows.length,MAX_NOTE_ROWS),
      notesTruncated:notesCapped,linkRowsScanned:Math.min(links.length,MAX_LINK_ROWS),
      linksTruncated:linksCapped,resolvedLinkScanTruncated:resolvedTruncated,
      legacySourceAliasesReadTimeOnly:normalizedAliases},
    groups,
    workflow:[
      "RETRIEVE: read canonical Company Hub, timeline, industry/theme, source records, Current Thesis and Evidence Register when present. Distinguish historical AI from verified original.",
      "DEDUP: match entity, underlying economic event, original-source family, metric, reporting period and source vintage; preserve old chronology and register contradictions.",
      "PRESERVE: archive exact original user text/document bytes separately from attributed AI analysis; never overwrite immutable historical material.",
      "ANALYZE: document what changed vs Existing Thesis with contrary evidence and economic mechanism; never auto-approve protected decisions.",
      "PLAN: identify existing canonical hubs/timelines/industry pages and create only reviewed, source-linked candidates for missing relationships.",
      "SAFE EDIT: use PR #33 preview -> actor/owner approval -> apply one exact non-protected change -> verify sha/readback/reindex/links and durable operation receipt.",
      "CLOSE LOOP: update canonical timelines and source/event links as separately reviewed edits; protect Current Thesis, Evidence Register and Portfolio; verify mobile Sync on device independently.",
      "STATUS: report written_and_readback_verified, queued, imported_server_only, pending_sync_or_approval or failed; never claim synced from server receipt.",
    ],
    writebackDependencies:{
      canonicalSourceOfTruth:"Obsidian Investment_OS Markdown Vault",
      structuredNumericalSourceOfTruth:"separate structured database",
      rawAndAnalysisSeparated:true,
      reuseSafeEditFrom:"PR #33 source-first Safe Edit",
      intakeStages:["source_capture","history_and_event_dedup","attributed_review",
        "timeline_and_bidirectional_links","owner_approved_protected_change_if_any",
        "readback_and_index_qa","remote_device_sync_check"],
      bulkMigrationAllowed:false,
      automaticProtectedThesisUpdateAllowed:false,
      codeReadyDoesNotMeanLive:true,
    },
    caveats:[
      "Unresolved archive links do not prove original files permanently missing.",
      "Repeated legacy source_type aliases are supported read-time and are not bulk edit candidates.",
      "Legacy company metadata indicates a historical mention, not proven issuer involvement, supplier status or independent verification.",
      "No action here moves, modifies, deletes, restores or uploads any Vault file.",
    ],
  };
}

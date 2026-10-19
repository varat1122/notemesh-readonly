/**
 * Exact-note read-only dossier for one human-selected P1/P2/P3 triage path.
 * The index is used for navigation, but actual current bytes are independently
 * checked via a single descriptor-anchored read before any dossier is returned.
 *
 * No edit template, no approval, no write, no implied primary verification.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {indexer} from "./indexer";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {planKnowledgeReviewPriorities,type TriageNote} from "./knowledge-review-priority";
import {splitFrontmatter} from "./markdown";
import {MAX_INDEX_BYTES,resolveNotePath,withVaultFile,isLfsPointerHead} from "./paths";

type Row={path:string;frontmatter:string|null;mtime:number;size:number};
type IndexedLink={target:string;resolved_path:string|null};
const MAX_ROWS=10_000,MAX_LINKS=8,MAX_REVIEW_TARGETS=8;
const digest=(v:Buffer)=>createHash("sha256").update(v).digest("hex");
const metadataFields=["type","verification","source_type","company","companies",
  "ticker","entity","event_date","published_at","received_at","imported_at",
  "imported_on","date","source_records"] as const;
function roleOf(row:Row):TriageNote {
  let fm:Record<string,unknown>={};
  if(row.frontmatter!==null){
    const v=JSON.parse(row.frontmatter) as unknown;
    if(!v||typeof v!=="object"||Array.isArray(v))
      throw Error("legacy_dossier_invalid_indexed_metadata");
    fm=v as Record<string,unknown>;
  }
  return {path:row.path,role:inspectCanonicalKnowledgeMetadata(row.path,fm).role,
    metadata:fm};
}
function readCurrent(row:Row){
  return withVaultFile(resolveNotePath(row.path),({stat,head,read})=>{
    if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_INDEX_BYTES||
      isLfsPointerHead(head))
      throw Error("legacy_dossier_unreadable_current_note");
    const bytes=read();
    if(bytes.length>MAX_INDEX_BYTES||bytes.includes(0))
      throw Error("legacy_dossier_unreadable_current_note");
    const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    const parsed=splitFrontmatter(raw);
    if(parsed.invalid)throw Error("legacy_dossier_invalid_current_frontmatter");
    const currentFm=Object.keys(parsed.data).length?
      JSON.stringify(parsed.data):null;
    if(stat.size!==row.size||Math.round(stat.mtimeMs)!==row.mtime||
      currentFm!==row.frontmatter)
      throw Error("legacy_dossier_stale_index_hold");
    return {sha256:digest(bytes),size:bytes.length,
      indexedMtimeMs:row.mtime,metadata:parsed.data};
  });
}
const bounded=(fm:Record<string,unknown>)=>{
  const fields:Record<string,unknown>={};
  for(const key of metadataFields){
    const v=fm[key];
    if(v===undefined||v===null)continue;
    if(typeof v==="string")fields[key]=v.slice(0,500);
    else if(Array.isArray(v))fields[key]={
      declaredCount:v.length,
      sample:v.slice(0,8).map(x=>typeof x==="string"?x.slice(0,350):"[non-string]"),
      truncated:v.length>8,
    };
    else fields[key]="[non-scalar field; inspect original note]";
  }
  return fields;
};
export function getLegacyReviewDossier(sourcePath:string){
  if(typeof sourcePath!=="string"||sourcePath.length<4||
    sourcePath.length>350||!sourcePath.endsWith(".md")||
    /^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i.test(sourcePath))
    throw Error("legacy_dossier_invalid_source_path");
  if(!indexer().ready)throw Error("legacy_dossier_index_not_ready");
  const database=db();
  const rows=database.prepare(
    "SELECT path,frontmatter,mtime,size FROM notes ORDER BY path LIMIT ?"
  ).all(MAX_ROWS+1) as Row[];
  if(rows.length>MAX_ROWS)throw Error("legacy_dossier_index_truncated");
  const sourceRow=rows.find(r=>r.path===sourcePath);
  if(!sourceRow)throw Error("legacy_dossier_source_not_indexed");
  const parsedRows=rows.map(roleOf);
  const sourceNote=parsedRows.find(n=>n.path===sourcePath)!;
  if(sourceNote.role!=="historical_analysis"&&sourceNote.role!=="review")
    throw Error("legacy_dossier_not_historical_or_review");
  const source=readCurrent(sourceRow);
  const linked=database.prepare(
    "SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1"
  );
  const plan=planKnowledgeReviewPriorities(parsedRows,true,
    (origin,destination)=>Boolean(linked.get(origin,destination)),sourcePath);
  if(plan.status!=="review_queue_index_complete_not_verified"||
    plan.eligibleSourceNotes!==1)
    throw Error("legacy_dossier_source_not_eligible");
  const linksCount=(database.prepare(
    "SELECT COUNT(*) AS n FROM links WHERE source_path=?"
  ).get(sourcePath) as {n:number}).n;
  const indexedLinks=database.prepare(
    "SELECT target,resolved_path FROM links WHERE source_path=? ORDER BY target LIMIT ?"
  ).all(sourcePath,MAX_LINKS) as IndexedLink[];
  const byPath=new Map(rows.map(r=>[r.path,r]));
  const destinations=plan.samples.filter(p=>p.targetPath!==null)
    .map(p=>p.targetPath!);
  const seen=new Set<string>();
  const targetChecks=[];
  for(const targetPath of destinations){
    if(seen.has(targetPath)||seen.size>=MAX_REVIEW_TARGETS)continue;
    seen.add(targetPath);
    const record=byPath.get(targetPath);
    if(!record){
      targetChecks.push({targetPath,status:"not_in_markdown_index" as const,
        sha256:null,independentOriginalVerified:false});
      continue;
    }
    try{
      const current=readCurrent(record);
      targetChecks.push({targetPath,status:"indexed_current_bytes_read" as const,
        sha256:current.sha256,independentOriginalVerified:false});
    }catch{
      targetChecks.push({targetPath,status:"manual_read_required_or_index_changed" as const,
        sha256:null,independentOriginalVerified:false});
    }
  }
  return {
    status:"read_only_review_dossier_not_a_verification" as const,
    sourcePath,
    indexedNotesConsidered:rows.length,
    source:{sha256:source.sha256,byteLength:source.size,
      indexedMtimeMs:source.indexedMtimeMs,declaredMetadata:bounded(source.metadata),
      verificationInterpreted:false as const},
    priorityCounts:plan.countsByPriority,
    findings:plan.samples,
    targetChecks,
    indexedOutgoingLinks:{
      count:linksCount,
      truncated:linksCount>indexedLinks.length,
      sample:indexedLinks.map(l=>({
        declaredTarget:l.target,resolvedPath:l.resolved_path,
      })),
    },
    nextAction:"Read each original note and its source in full, confirm event/publication/import dates, inspect existing Obsidian links, and propose a separate one-note Safe Edit preview ONLY after human review." as const,
    originalSourceBytesIndependentlyVerified:false as const,
    sourcePublisherAuthenticated:false as const,
    marketPriceOrConsensusChecked:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
  };
}

/**
 * Strictly read-only, one-note drilldown from the evidence-first P1/P2/P3
 * review queue. Designed for the COMPLETE indexed Vault, not a canned ticker.
 *
 * This is NOT a Safe Edit preview, source verification, or write approval.
 * SHA-256 here proves what bytes this read observed, not their provenance.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {indexer} from "./indexer";
import {splitFrontmatter} from "./markdown";
import {resolveNotePath,withVaultFile} from "./paths";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {planKnowledgeReviewPriorities,type TriageNote} from "./knowledge-review-priority";

const MAX_ROWS=10_000,MAX_FILE_BYTES=1_000_000;
type Row={path:string;frontmatter:string|null;mtime:number;size:number};
const validPath=(p:string)=>
  p.length>3&&p.length<=350&&p.endsWith(".md")&&!p.startsWith("/")&&
  !p.includes("\\")&&
  !["[","]","|","#","^"].some(k=>p.includes(k))&&
  !/[\r\n\0]/.test(p)&&
  !p.split("/").some(s=>!s||s==="."||s===".."||s.startsWith("."));
function parsedMetadata(row:Row):Record<string,unknown> {
  try{
    const result=row.frontmatter?JSON.parse(row.frontmatter):{};
    if(result&&typeof result==="object"&&!Array.isArray(result))return result;
  }catch{/* malformed data cannot establish an issuer or source relationship */}
  return {};
}
function snapshot(path:string) {
  return withVaultFile(resolveNotePath(path),({stat,read})=>{
    if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_FILE_BYTES)
      throw Error("review_dossier_file_unreadable_or_oversized");
    const bytes=read();
    if(bytes.length>MAX_FILE_BYTES||bytes.includes(0))
      throw Error("review_dossier_file_unreadable_or_oversized");
    const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    const parsed=splitFrontmatter(text);
    if(parsed.invalid)throw Error("review_dossier_invalid_frontmatter");
    return {
      metadata:parsed.data,
      size:bytes.length,mtime:Math.round(stat.mtimeMs),
      sha256:createHash("sha256").update(bytes).digest("hex"),
    };
  });
}
function metadataSame(a:Record<string,unknown>,b:Record<string,unknown>) {
  // Both representations are normalized by the SAME hardening pipeline.
  // The index JSON is generated from splitFrontmatter; JSON structural equality
  // is a conservative guard (a property order-only change will fail closed).
  return JSON.stringify(a)===JSON.stringify(b);
}
export function inspectHistoricalReviewDossier(sourcePath:string) {
  if(typeof sourcePath!=="string"||!validPath(sourcePath))
    throw Error("review_dossier_invalid_path");
  if(!indexer().ready)throw Error("review_dossier_index_not_ready");
  const database=db();
  const rows=database.prepare(
    "SELECT path,frontmatter,mtime,size FROM notes ORDER BY path LIMIT ?"
  ).all(MAX_ROWS+1) as Row[];
  if(rows.length>MAX_ROWS)throw Error("review_dossier_index_truncated");
  const byPath=new Map(rows.map(r=>[r.path,r]));
  const selected=byPath.get(sourcePath);
  if(!selected)throw Error("review_dossier_source_not_indexed");
  const notes:TriageNote[]=rows.map(row=>{
    const fm=parsedMetadata(row);
    return {path:row.path,role:inspectCanonicalKnowledgeMetadata(row.path,fm).role,
      metadata:fm};
  });
  const link=database.prepare(
    "SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1"
  );
  const review=planKnowledgeReviewPriorities(
    notes,true,(source,target)=>Boolean(link.get(source,target)),sourcePath,
  );
  if(review.eligibleSourceNotes!==1)
    throw Error("review_dossier_source_not_eligible");
  const current=snapshot(sourcePath);
  if(current.size!==selected.size||current.mtime!==selected.mtime||
    !metadataSame(current.metadata,parsedMetadata(selected)))
    throw Error("review_dossier_source_index_stale_rebuild_required");

  const seen=new Map<string,ReturnType<typeof targetStatus>>();
  const findings=review.samples.map(item=>{
    const target=item.targetPath;
    if(target&&!seen.has(target))seen.set(target,targetStatus(target,byPath.get(target)));
    return {
      ...item,
      targetObservation:target?seen.get(target)!:null,
      humanDecision:item.kind==="explicit_event_date_needs_review"?
        "Reconstruct exact event time from primary source; never promote imported/date into event_date.":
        item.kind==="declared_source_path_not_indexed"?
        "Check whether the declared original exists in any archive or external source; not indexed does not mean deleted.":
        item.kind==="invalid_source_records_metadata"?
        "Read the complete source note and inspect provenance; do not guess a replacement path.":
        item.kind==="conflicting_single_company_metadata"?
        "Reconcile original issuer/ticker scope; do not choose the first named company.":
        "Read both full notes, verify context and existing links, then request a separate authorized Safe Edit if needed.",
    };
  });
  const inspected=inspectCanonicalKnowledgeMetadata(sourcePath,current.metadata);
  const sourceInfo={
    path:sourcePath,sha256:current.sha256,byteLength:current.size,
    indexedVersionMatchesObservedFile:true as const,
    declaredVerification:inspected.declaredVerification,
    normalizedSourceType:inspected.normalizedSourceType,
    independenceAssessment:inspected.independenceAssessment,
    declaredEventDate:inspected.eventDate,
    declaredLegacyDate:inspected.legacyDate,
    dateWasInferred:false as const,
    originalSourceVerifiedThisCall:false as const,
  };
  return {
    status:"read_only_historical_review_dossier" as const,
    ...sourceInfo,
    source:sourceInfo,
    findings,
    fullIndexRows:rows.length,
    countsByKind:review.countsByKind,
    reviewNotes:[
      "One note's metadata and bounded indexed destinations were inspected; note body meaning and cited primary sources were NOT fact-checked.",
      "A missing indexed Markdown path or resolved wikilink does not mean source bytes are lost; archived non-Markdown references require separate examination.",
      "Observed SHA-256 hashes represent local file bytes only; publisher authenticity, independent evidence, investor Thesis approval and second-device Sync are not established.",
      "This tool never creates a Safe Edit preview or edits original notes. Any change needs a separately authorized one-note preview, diff, approval, apply and readback.",
    ],
    requiresHumanReview:true as const,
    vaultModified:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
  };
}
function targetStatus(target:string,indexed:Row|undefined) {
  if(!validPath(target))return {
    path:target,indexed:Boolean(indexed),status:"invalid_target_path_manual_review" as const,
    sha256:null,metadataMatchesIndex:false,
  };
  if(!indexed)return {
    path:target,indexed:false,status:"not_indexed_disk_not_assessed" as const,
    sha256:null,metadataMatchesIndex:false,
  };
  try {
    const observed=snapshot(target);
    const consistent=observed.size===indexed.size&&observed.mtime===indexed.mtime&&
      metadataSame(observed.metadata,parsedMetadata(indexed));
    return {
      path:target,indexed:true,
      status:consistent?"indexed_target_observed":"indexed_target_changed_or_stale",
      sha256:observed.sha256,metadataMatchesIndex:consistent,
    };
  }catch{
    return {
      path:target,indexed:true,status:"indexed_target_unreadable_manual_review",
      sha256:null,metadataMatchesIndex:false,
    };
  }
}

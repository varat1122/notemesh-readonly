/**
 * Read-only, whole-index queue pager for human review of historical notes.
 * Every eligible note is examined; only a bounded page of exact paths leaves
 * this tool. This reports indexed metadata, not verified issuer facts.
 *
 * Cursor pagination on a mutable live index is NOT a transactional snapshot.
 * For acceptance tests use a segregated, immutable Vault snapshot.
 */
import {db} from "../db";
import {indexer,indexerStatus} from "./indexer";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {
  planKnowledgeReviewPriorities,type TriageNote,type ReviewQueuePriority,
} from "./knowledge-review-priority";

const MAX_ROWS=10_000;
type Row={path:string;frontmatter:string|null};

export function listLegacyReviewQueue(
  priority:ReviewQueuePriority="P1_provenance_or_chronology",
  limit=20,
  afterPath?:string,
){
  if(!indexer().ready)throw Error("legacy_review_queue_index_not_ready");
  const d=db();
  const rows=d.prepare(
    "SELECT path,frontmatter FROM notes ORDER BY path LIMIT ?"
  ).all(MAX_ROWS+1) as Row[];
  if(rows.length>MAX_ROWS)throw Error("legacy_review_queue_index_truncated");
  const notes=rows.map((row):TriageNote=>{
    let metadata:Record<string,unknown>={};
    if(row.frontmatter!==null){
      try{
        const raw=JSON.parse(row.frontmatter) as unknown;
        if(!raw||typeof raw!=="object"||Array.isArray(raw))
          throw Error("bad frontmatter");
        metadata=raw as Record<string,unknown>;
      }catch{
        throw Error("legacy_review_queue_invalid_indexed_metadata_hold");
      }
    }
    return {path:row.path,
      role:inspectCanonicalKnowledgeMetadata(row.path,metadata).role,
      metadata};
  });
  const link=d.prepare(
    "SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1"
  );
  const review=planKnowledgeReviewPriorities(
    notes,true,(source,target)=>Boolean(link.get(source,target)),undefined,
    {priority,limit,afterPath},
  );
  if(review.status!=="review_queue_index_complete_not_verified"||!review.queue)
    throw Error("legacy_review_queue_incomplete_index_hold");
  // A synchronous handler does not yield during its index read. Cross-call
  // stability is NOT guaranteed when Obsidian Sync or index watchers mutate.
  return {
    status:"bounded_read_only_indexed_review_queue" as const,
    scope:"all_currently_indexed_markdown_notes_not_all_original_bytes" as const,
    indexReady:true as const,
    indexedNotesConsidered:review.indexedNotesConsidered,
    unindexedNotes:indexerStatus().unindexedNotes,
    eligibleHistoricalOrReviewNotes:review.eligibleSourceNotes,
    notesWithReviewFindings:review.notesWithAtLeastOneFinding,
    totalFindings:review.findingsTotal,
    priorityFindingCounts:review.countsByPriority,
    priorityKindCounts:review.countsByKind,
    page:review.queue,
    originalSourceVerified:false as const,
    reviewerAuthenticated:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    nextStep:"Select an exact path from this page for get_legacy_review_dossier; independently inspect full note and originals. Re-run on an immutable isolated Vault snapshot to verify census stability. No edit, source fact-check, authenticated approval, or device sync occurred." as const,
  };
}

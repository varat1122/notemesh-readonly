/**
 * Read-only, whole-index queue pager with a fingerprint fence.
 *
 * The fingerprint covers exactly the SQLite notes metadata and links used
 * for triage. It is NOT an immutable filesystem snapshot or a guarantee
 * that any original-source bytes / financial claims have been verified.
 * No writes, approvals, review records or Safe Edit operations occur here.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {indexer,indexerStatus} from "./indexer";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {
  planKnowledgeReviewPriorities,type TriageNote,type ReviewQueuePriority,
} from "./knowledge-review-priority";

const MAX_ROWS=10_000;
type Row={path:string;frontmatter:string|null;mtime:number;size:number};
type LinkRow={source_path:string;target:string;resolved_path:string|null};

export function listLegacyReviewQueue(
  priority:ReviewQueuePriority="P1_provenance_or_chronology",
  limit=20,
  afterPath?:string,
  expectedIndexFingerprint?:string,
){
  if(expectedIndexFingerprint!==undefined&&
    (typeof expectedIndexFingerprint!=="string"||
    !/^[0-9a-f]{64}$/.test(expectedIndexFingerprint)))
    throw Error("legacy_review_queue_invalid_fingerprint");
  // Otherwise a client could accidentally concatenate results from two
  // different index states without any warning.
  if(afterPath!==undefined&&expectedIndexFingerprint===undefined)
    throw Error("legacy_review_queue_fingerprint_required_for_next_page");
  if(!indexer().ready)throw Error("legacy_review_queue_index_not_ready");
  const d=db();
  // SQLite transaction keeps the note rows, indexed links and review
  // fingerprint mutually consistent within one synchronous request.
  const result=d.transaction(()=>{
    if(!indexer().ready)throw Error("legacy_review_queue_index_not_ready");
    const rows=d.prepare(
      "SELECT path,frontmatter,mtime,size FROM notes ORDER BY path LIMIT ?"
    ).all(MAX_ROWS+1) as Row[];
    if(rows.length>MAX_ROWS)throw Error("legacy_review_queue_index_truncated");
    const unindexedNotes=indexerStatus().unindexedNotes;
    const hash=createHash("sha256");
    hash.update("investment-os-index-review-queue-v1\n");
    hash.update(JSON.stringify({priority,unindexedNotes})+"\n");
    // Include exact raw indexed metadata and file version fields. No note
    // bodies or actual original files are read by this method.
    for(const row of rows){
      hash.update("N"+JSON.stringify([
        row.path,row.frontmatter,row.mtime,row.size,
      ])+"\n");
    }
    let indexedLinkCount=0;
    const links=d.prepare(
      "SELECT source_path,target,resolved_path FROM links "+
      "ORDER BY source_path,target"
    ).iterate() as Iterable<LinkRow>;
    for(const link of links){
      hash.update("L"+JSON.stringify([
        link.source_path,link.target,link.resolved_path,
      ])+"\n");
      indexedLinkCount++;
    }
    const indexFingerprint=hash.digest("hex");
    if(expectedIndexFingerprint&&
      indexFingerprint!==expectedIndexFingerprint)
      throw Error("legacy_review_queue_index_fingerprint_changed_hold");

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
    const linked=d.prepare(
      "SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1"
    );
    const review=planKnowledgeReviewPriorities(
      notes,true,(source,target)=>Boolean(linked.get(source,target)),undefined,
      {priority,limit,afterPath},
    );
    const queue=review.queue;
    if(review.status!=="review_queue_index_complete_not_verified"||!queue)
      throw Error("legacy_review_queue_incomplete_index_hold");
    return {review,queue,indexFingerprint,indexedLinkCount,unindexedNotes};
  })();

  const {review,queue,indexFingerprint,indexedLinkCount,unindexedNotes}=result;
  return {
    status:"bounded_read_only_indexed_review_queue" as const,
    scope:"all_currently_indexed_markdown_notes_not_all_original_bytes" as const,
    indexReady:true as const,
    indexedNotesConsidered:review.indexedNotesConsidered,
    indexedLinkCount,
    unindexedNotes,
    eligibleHistoricalOrReviewNotes:review.eligibleSourceNotes,
    notesWithReviewFindings:review.notesWithAtLeastOneFinding,
    totalFindings:review.findingsTotal,
    priorityFindingCounts:review.countsByPriority,
    priorityKindCounts:review.countsByKind,
    page:queue,
    // Clients must pass this SAME token as expectedIndexFingerprint on each
    // subsequent page. Filter priority is bound to the token; limit is not.
    indexFingerprint,
    indexFingerprintScope:
      "sqlite_indexed_note_path_frontmatter_mtime_size_links_and_priority_only" as const,
    expectedFingerprintMatched:expectedIndexFingerprint!==undefined,
    fileBytesSnapshotVerified:false as const,
    originalSourceVerified:false as const,
    reviewerAuthenticated:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    nextStep:"Pass this fingerprint on subsequent pages; any index mutation fails closed. This does not detect all unindexed filesystem changes or prove an immutable Vault snapshot. Verify coverage against an isolated immutable original-byte snapshot; inspect sources independently before an authorized Safe Edit." as const,
  };
}

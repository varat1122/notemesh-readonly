/**
 * Offline-only source-bound evidence bridge for PR #76 -> PR #77.
 *
 * Reconstructs input from a segregated physical Vault+SQLite+source-archive
 * snapshot; never trusts caller-provided hashes, source receipts or actor flags.
 * NO Vault modification, no source capture, no MCP/HTTP/Safe Edit integration.
 * Verified here = internally matched stored bytes, NOT issuer/claim or owner.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {splitFrontmatter} from "./markdown";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";
import {prepareOfflineEvidenceGatedHumanReview, type HumanReviewAction}
  from "./offline-evidence-human-review";
import {prepareEvidenceGatedReviewProposal, type Relationship,
  type ReviewProposalInput} from "./evidence-gated-review-proposal";

const SHA=/^[a-f0-9]{64}$/;
const MAX_ROWS=10_000,MAX_LINKS=200_000,MAX_NOTE_BYTES=100_000;
const digest=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const value=(x:unknown)=>typeof x==="string"&&x.trim().length>0?x:null;
type IndexRow={path:string;frontmatter:string|null;mtime:number;size:number};
type SourceRow={original_source:string;source_key:string;sha256:string;
  revision:number;byte_length:number};
export type OfflineBoundProposalRequest={
  snapshotRoot:string;notePath:string;expectedNoteSha256:string;
  action:HumanReviewAction;
  reviewRationale:string;
  relationship:Relationship;
  oldLine:string;newLine:string;
};
function canonical(s:string):string|null {
  try{
    const u=new URL(s);
    if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.port)
      return null;
    u.hash="";
    for(const k of [...u.searchParams.keys()])
      if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();
    return u.toString();
  }catch{return null;}
}
function strictFile(file:string,maxBytes:number) {
  if(fs.realpathSync(file)!==file)throw Error("offline_bound_symlink_file_hold");
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.size===0||
      before.size>maxBytes)throw Error("offline_bound_file_unsafe_size_hold");
    const buffer=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    if(buffer.length!==before.size||after.size!==before.size||
      before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
      !after.isFile()||after.nlink!==1)
      throw Error("offline_bound_concurrent_file_change_hold");
    return {buffer,sha256:digest(buffer),mtimeMs:Math.round(after.mtimeMs),
      byteLength:buffer.length};
  }finally{fs.closeSync(fd);}
}
function indexFingerprint(db:Database.Database):string {
  const h=createHash("sha256");
  // Distinct namespace from PR #73's live, priority-scoped review fingerprint.
  h.update("investment-os-offline-index-evidence-v1\n");
  let count=0;
  const notes=db.prepare(
    "SELECT path,frontmatter,mtime,size FROM notes ORDER BY path"
  ).iterate() as Iterable<IndexRow>;
  for(const row of notes){
    if(++count>MAX_ROWS)throw Error("offline_bound_index_note_limit_hold");
    h.update("N"+JSON.stringify([row.path,row.frontmatter,row.mtime,row.size])+"\n");
  }
  count=0;
  const links=db.prepare(
    "SELECT source_path,target,resolved_path FROM links ORDER BY source_path,target"
  ).iterate() as Iterable<{source_path:string;target:string;resolved_path:string|null}>;
  for(const link of links){
    if(++count>MAX_LINKS)throw Error("offline_bound_index_link_limit_hold");
    h.update("L"+JSON.stringify([link.source_path,link.target,link.resolved_path])+"\n");
  }
  return h.digest("hex");
}
function readonlyPacket(status:"hold"|"human_review_required",reason:string, notePath:string) {
  return {
    status,exactTargetPath:notePath,
    unresolvedGates:[reason],safeEditPreview:null,proposedPatch:null,
    reviewerAuthenticationIndependentlyVerified:false as const,
    ownerApprovalGranted:false as const,
    publisherAuthenticityVerified:false as const,
    investmentClaimFactsVerified:false as const,
    originalSourceIndependenceVerified:false as const,
    immutableSnapshotVerified:false as const,
    disasterRecoveryAccepted:false as const,
    canAutoWrite:false as const,canAutoUpdateThesis:false as const,
    vaultModified:false as const,
  };
}
/**
 * No caller may supply a source hash, receipt, fingerprint, reviewer identity
 * or owner authorization: each is derived from the same isolated snapshot or
 * kept explicitly unauthenticated. No raw note or source body is returned.
 */
export function prepareOfflineBoundEvidenceProposal(req:OfflineBoundProposalRequest) {
  if(!req||typeof req!=="object"||
    typeof req.expectedNoteSha256!=="string"||!SHA.test(req.expectedNoteSha256))
    throw Error("offline_bound_exact_note_hash_required");
  if(typeof req.reviewRationale!=="string"||req.reviewRationale.length>500||
    /[\r\n\0]/.test(req.reviewRationale))
    throw Error("offline_bound_rationale_invalid");
  if(typeof req.oldLine!=="string"||typeof req.newLine!=="string"||
    req.oldLine.length>600||req.newLine.length>600)
    throw Error("offline_bound_edit_input_too_long");
  const review=prepareOfflineEvidenceGatedHumanReview({
    snapshotRoot:req.snapshotRoot,notePath:req.notePath,
    expectedNoteSha256:req.expectedNoteSha256,
    action:req.action,rationale:req.reviewRationale,
  });
  if(review.status!=="stored_bytes_located_for_manual_verification_only"||
    !review.roleAndPathEligible||!review.noteSourceEvidence.fullHashMatchesStoredVersion)
    return {...readonlyPacket("hold",
      "offline_human_worksheet_or_exact_source_integrity_not_satisfied",
      req.notePath),underlyingReviewStatus:review.status};

  const coverage=verifyOfflineSnapshotCoverage(req.snapshotRoot);
  if(coverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    return readonlyPacket("hold","offline_markdown_coverage_changed_hold",req.notePath);
  const root=fs.realpathSync(req.snapshotRoot);
  const db=new Database(path.join(root,"app.sqlite"),{readonly:true,fileMustExist:true});
  try{
    db.pragma("query_only=ON");
    return db.transaction(()=>{
      const startFingerprint=indexFingerprint(db);
      const row=db.prepare(
        "SELECT path,frontmatter,mtime,size FROM notes WHERE path=?"
      ).get(req.notePath) as IndexRow|undefined;
      if(!row)throw Error("offline_bound_note_not_indexed_hold");
      const note=strictFile(path.join(root,"vault",...req.notePath.split("/")),
        MAX_NOTE_BYTES);
      if(note.sha256!==req.expectedNoteSha256||
        note.sha256!==review.noteSha256||
        note.mtimeMs!==row.mtime||note.byteLength!==row.size)
        throw Error("offline_bound_note_version_changed_hold");
      const raw=new TextDecoder("utf-8",{fatal:true}).decode(note.buffer);
      if(raw.includes("\0"))throw Error("offline_bound_note_invalid_bytes_hold");
      const parsed=splitFrontmatter(raw);
      if(parsed.invalid||JSON.stringify(parsed.data)!==(row.frontmatter??"{}")&&
        !(row.frontmatter===null&&Object.keys(parsed.data).length===0))
        throw Error("offline_bound_note_metadata_changed_hold");
      const inspection=inspectCanonicalKnowledgeMetadata(req.notePath,parsed.data);
      if(!["historical_analysis","review"].includes(inspection.role))
        return readonlyPacket("hold","offline_bound_target_role_not_supported",
          req.notePath);
      const locator=value(parsed.data.original_source)??value(parsed.data.source_url);
      const sourceKey=locator?canonical(locator):null;
      const declaredHash=parsed.data.original_source_sha256;
      if(!sourceKey||typeof declaredHash!=="string"||!SHA.test(declaredHash.toLowerCase()))
        return readonlyPacket("hold","offline_bound_declared_full_hash_invalid",
          req.notePath);
      const rows=db.prepare(
        "SELECT original_source,source_key,sha256,revision,byte_length "+
        "FROM source_snapshots WHERE source_key=? AND sha256=? LIMIT 2"
      ).all(sourceKey,declaredHash.toLowerCase()) as SourceRow[];
      if(rows.length!==1)throw Error("offline_bound_source_receipt_ambiguous_hold");
      const receipt=rows[0];
      if(!Number.isSafeInteger(receipt.revision)||receipt.revision<1||
        !Number.isSafeInteger(receipt.byte_length)||
        receipt.byte_length>8*1024*1024||
        canonical(receipt.original_source)!==sourceKey)
        throw Error("offline_bound_source_receipt_invalid_hold");
      const blobPath=path.join(root,"source-archive","blobs",
        receipt.sha256.slice(0,2),receipt.sha256+".bin");
      const blob=strictFile(blobPath,8*1024*1024);
      if(blob.sha256!==receipt.sha256||blob.byteLength!==receipt.byte_length)
        throw Error("offline_bound_source_blob_changed_hold");
      // Exact source event/revision relationships cannot be authenticated
      // solely from a source URL and consecutive capture metadata.
      const eventKey=value(parsed.data.event_key);
      const claimEntries=Array.isArray(parsed.data.claims)?parsed.data.claims:[];
      const candidate=claimEntries.length===1&&claimEntries[0]&&
        typeof claimEntries[0]==="object"&&!Array.isArray(claimEntries[0])?
        claimEntries[0] as Record<string,unknown>:null;
      const claim=candidate&&
        [candidate.claim_id,candidate.entity,candidate.period,candidate.metric,
          candidate.unit,candidate.value].every(x=>value(x)!==null)?
        {claimId:value(candidate.claim_id)!,entity:value(candidate.entity)!,
          period:value(candidate.period)!,metric:value(candidate.metric)!,
          unit:value(candidate.unit)!,value:value(candidate.value)!}:null;
      const input:ReviewProposalInput={
        target:{path:req.notePath,
          role:inspection.role==="review"?"review":"historical_analysis",
          expectedSha256:note.sha256,indexedMtimeMs:row.mtime,
          indexedByteLength:row.size,
          expectedIndexFingerprint:startFingerprint,
          observedIndexFingerprint:startFingerprint,
          snapshotManifestSha256:coverage.markdownContentManifestSha256,
          observedSnapshotManifestSha256:coverage.markdownContentManifestSha256,
          snapshotStatus:coverage.status},
        detachedNoteText:raw,
        observedReadback:{sha256:note.sha256,mtimeMs:note.mtimeMs,
          byteLength:note.byteLength},
        source:{originalSource:sourceKey,
          declaredFullHash:declaredHash.toLowerCase(),
          sourceType:inspection.rawSourceType??"",
          independence:inspection.independenceAssessment,
          archiveStatus:review.offlineSourceAuditState,
          receipt:{originalSource:receipt.original_source,sha256:receipt.sha256,
            revision:receipt.revision,byteStatus:"intact_stored_bytes",
            snapshotManifestSha256:coverage.markdownContentManifestSha256},
          eventKey,eventDate:inspection.eventDate,
          publishedAt:inspection.publishedAt,importedAt:inspection.importedAt,
          verifiedAt:value(parsed.data.verified_at),prior:null},
        claim,review:{disposition:req.action,rationale:req.reviewRationale,
          // No authentication provider exists in offline module.
          reviewerAuthenticated:false,ownerApprovalClaimed:false,
          relationship:req.relationship},
        edit:{oldLine:req.oldLine,newLine:req.newLine},
      };
      const proposal=prepareEvidenceGatedReviewProposal(input);
      // A second descriptor read and index scan catches changed selected
      // bytes or mutable index within this synchronous operation.
      const endNote=strictFile(path.join(root,"vault",...req.notePath.split("/")),
        MAX_NOTE_BYTES);
      if(endNote.sha256!==note.sha256||endNote.mtimeMs!==note.mtimeMs||
        endNote.byteLength!==note.byteLength||
        indexFingerprint(db)!==startFingerprint)
        throw Error("offline_bound_concurrent_snapshot_change_hold");
      const endBlob=strictFile(blobPath,8*1024*1024);
      if(endBlob.sha256!==blob.sha256||endBlob.byteLength!==blob.byteLength)
        throw Error("offline_bound_concurrent_source_change_hold");
      // Never expose a caller-forged reviewer identity or a prematurely
      // actionable diff. This bridge is explicitly an unapproved packet.
      if(proposal.status==="read_only_proposal_ready"||proposal.safeEditPreview!==null)
        throw Error("offline_bound_unexpected_approval_or_preview_hold");
      return {
        status:proposal.status,
        exactTargetPath:req.notePath,
        exactBeforeSha256:note.sha256,
        indexedMtimeMs:row.mtime,indexedByteLength:row.size,
        offlineIndexMetadataLinksFingerprint:startFingerprint,
        offlineIndexFingerprintScope:"isolated_sqlite_note_rows_and_links_not_pr73_live_queue" as const,
        physicalMarkdownManifestSha256:coverage.markdownContentManifestSha256,
        storedSource:{sourceKeySha256:digest(sourceKey),
          sourceHost:new URL(sourceKey).hostname,
          originalBlobSha256:receipt.sha256,revision:receipt.revision,
          exactStoredBlobIntegrityVerified:true as const,
          issuerAuthenticityVerified:false as const},
        claimMetadataPresent:claim!==null,
        chronology:proposal.chronology,
        declaredRelationship:req.relationship,
        unresolvedGates:proposal.unresolvedGates.slice(0,24),
        requiredEvidence:proposal.requiredEvidence.slice(0,24),
        proposedPatch:null,safeEditPreview:null,
        reviewWorksheetState:review.status,
        publisherAuthenticityVerified:false as const,
        investmentClaimFactsVerified:false as const,
        originalSourceIndependenceVerified:false as const,
        reviewerAuthenticationIndependentlyVerified:false as const,
        ownerApprovalGranted:false as const,
        immutableSnapshotVerified:false as const,
        disasterRecoveryAccepted:false as const,
        canAutoWrite:false as const,canAutoUpdateThesis:false as const,
        vaultModified:false as const,
      };
    })();
  }finally{db.close();}
}

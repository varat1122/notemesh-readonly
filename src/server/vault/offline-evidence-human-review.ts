/**
 * Offline-only, evidence-gated HUMAN REVIEW WORKSHEET.
 *
 * No actor is authenticated, no independent publisher/claim verified, no note
 * is edited, and no actionable Safe Edit payload is returned. This is not a
 * review approval API. It must never run on a live Railway/Obsidian volume.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {splitFrontmatter} from "./markdown";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {verifyOfflineSourceArchiveCoverage} from "./offline-source-provenance";

const HASH=/^[0-9a-f]{64}$/;
const MAX_NOTE=1_000_000;
type Row={path:string;frontmatter:string|null;mtime:number;size:number;rowid:number};
type OriginalRow={snapshot_id:string;sha256:string;byte_length:number;revision:number;source_key:string};
export const HUMAN_REVIEW_ACTIONS=[
  "inspect_original_claim","metadata_correction_candidate",
  "navigation_link_candidate","duplicate_or_contradiction_review",
] as const;
export type HumanReviewAction=typeof HUMAN_REVIEW_ACTIONS[number];
export type OfflineReviewRequest={
  snapshotRoot:string;notePath:string;action:HumanReviewAction;
  expectedNoteSha256?:string;
  rationale?:string;
};
const digest=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");
function canonicalUrl(s:string):string|null{
  try{
    const u=new URL(s);
    if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.port)
      return null;
    u.hash="";
    for(const key of [...u.searchParams.keys()])
      if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  }catch{return null;}
}
function safeNotePath(p:string){
  return typeof p==="string"&&p.length>=4&&p.length<=350&&
    p.endsWith(".md")&&!path.isAbsolute(p)&&!p.includes("\\")&&
    !/[\0\r\n]/.test(p)&&!p.split("/").some(x=>
      !x||x==="."||x===".."||x.startsWith("."));
}
function readExactNote(root:string,notePath:string,row:Row) {
  const file=path.join(root,"vault",...notePath.split("/"));
  if(fs.realpathSync(file)!==file)throw Error("offline_review_note_symlink_hold");
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.size>MAX_NOTE)
      throw Error("offline_review_note_unsafe_or_oversized_hold");
    const bytes=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    if(bytes.length!==before.size||after.size!==before.size||
       after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||
       Math.round(after.mtimeMs)!==row.mtime||bytes.length!==row.size)
      throw Error("offline_review_note_changed_since_index_hold");
    const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    const parsed=splitFrontmatter(raw);
    if(parsed.invalid||bytes.includes(0))
      throw Error("offline_review_note_unreadable_frontmatter_hold");
    const indexed=Object.keys(parsed.data).length?JSON.stringify(parsed.data):null;
    if(indexed!==row.frontmatter)
      throw Error("offline_review_note_metadata_changed_hold");
    return {hash:digest(bytes),body:parsed.body,frontmatter:parsed.data};
  }finally{fs.closeSync(fd);}
}

/**
 * Never returns a diff, executable edit, human approval, or a Verified Fact.
 *
 * A positively matched source hash is a STORED-BYTE statement only.
 */
export function prepareOfflineEvidenceGatedHumanReview(req:OfflineReviewRequest) {
  if(!req||typeof req!=="object"||!safeNotePath(req.notePath))
    throw Error("offline_review_invalid_note_path");
  if(!HUMAN_REVIEW_ACTIONS.includes(req.action))
    throw Error("offline_review_invalid_action");
  if(req.expectedNoteSha256!==undefined&&
    (typeof req.expectedNoteSha256!=="string"||!HASH.test(req.expectedNoteSha256)))
    throw Error("offline_review_invalid_expected_hash");
  if(req.rationale!==undefined&&
    (typeof req.rationale!=="string"||req.rationale.length>500||
      /[\0\r\n]/.test(req.rationale)))
    throw Error("offline_review_invalid_rationale");

  // First reject dirty/incomplete physical files AND source-blob registry.
  // A global provenance gap is displayed but not wrongly treated as proof
  // that this exact selected note's claim is erroneous.
  const global=verifyOfflineSourceArchiveCoverage(req.snapshotRoot);
  const integrityHold=global.status==="offline_archive_bytes_integrity_hold";
  const root=fs.realpathSync(req.snapshotRoot);
  const d=new Database(path.join(root,"app.sqlite"),{
    readonly:true,fileMustExist:true,
  });
  try{
    d.pragma("query_only=ON");
    return d.transaction(()=>{
      const row=d.prepare(
        "SELECT rowid,path,frontmatter,mtime,size FROM notes WHERE path=?"
      ).get(req.notePath) as Row|undefined;
      if(!row)throw Error("offline_review_note_not_indexed");
      const note=readExactNote(root,req.notePath,row);
      // The physical/index scope from PR #74 might change between calls.
      // The matching FTS body is rechecked on THIS request.
      const fts=d.prepare("SELECT body FROM notes_fts WHERE rowid=?")
        .get(row.rowid) as {body:string}|undefined;
      if(!fts||fts.body!==note.body)
        throw Error("offline_review_stale_fts_hold");
      if(req.expectedNoteSha256&&req.expectedNoteSha256!==note.hash)
        throw Error("offline_review_expected_note_hash_changed_hold");
      const schema=inspectCanonicalKnowledgeMetadata(req.notePath,note.frontmatter);
      const protectedNote=/^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i
        .test(req.notePath)||["thesis","evidence_register","archive"].includes(schema.role);
      const eligible=["historical_analysis","review","source","structured_claim"]
        .includes(schema.role)&&!protectedNote;
      const meta=note.frontmatter;
      const rawLocator=typeof meta.original_source==="string"&&meta.original_source.trim()?
        meta.original_source:
        typeof meta.source_url==="string"?meta.source_url:null;
      const normalized=rawLocator?canonicalUrl(rawLocator):null;
      const declaredHash=meta.original_source_sha256;
      const declaredHashText=typeof declaredHash==="string"?declaredHash:null;
      const validDeclaredHash=declaredHashText!==null&&
        HASH.test(declaredHashText.toLowerCase());
      const sourceRows=normalized?d.prepare(
        "SELECT snapshot_id,sha256,byte_length,revision,source_key "+
        "FROM source_snapshots WHERE source_key=? ORDER BY revision LIMIT 102"
      ).all(normalized) as OriginalRow[]:[];
      const sourceVersionsTruncated=sourceRows.length>100;
      const matches=validDeclaredHash?
        sourceRows.filter(x=>x.sha256===declaredHashText?.toLowerCase()):[];
      const matched=(matches.length===1&&!sourceVersionsTruncated)?matches[0]:null;
      const sourceEvidenceState=
        !normalized?"no_valid_explicit_original_url" as const:
        declaredHash!==undefined&&!validDeclaredHash?
          "invalid_declared_full_hash" as const:
        sourceVersionsTruncated?"source_versions_truncated_hold" as const:
        sourceRows.length===0?"not_registered_in_offline_archive" as const:
        validDeclaredHash&&matches.length===0?"declared_hash_not_in_registered_versions" as const:
        !validDeclaredHash?"registered_source_without_note_full_hash" as const:
        matched?"registered_original_bytes_hash_matched_only" as const:
          "ambiguous_matching_source_versions" as const;
      const evidenceByteGate=matched!==null&&!integrityHold;
      const isIndependentArchivedAi=
        schema.independenceAssessment!=="not_assessed"||
        schema.normalizedSourceType==="archived_ai";
      const blockers:string[]=[];
      if(integrityHold)blockers.push("Source archive has damaged/unregistered/missing bytes; no source-based review readiness.");
      if(!eligible)blockers.push("Selected role or path is protected or not eligible for a legacy review worksheet.");
      if(!req.expectedNoteSha256)blockers.push("Exact current note SHA-256 has not been supplied by the requester; recheck it before continuing.");
      if(isIndependentArchivedAi)blockers.push("Archived AI/derivative summaries are not independent original evidence.");
      if(!evidenceByteGate)blockers.push("Exact declared source-version SHA-256 is not matched to an intact registered original blob.");
      if(schema.declaredVerification!=="verified_against_primary")
        blockers.push("Note verification declaration is not independently authenticated.");
      // Even if the note claims verified_against_primary, authenticity is
      // NOT proven by this module and all claims remain subject to review.
      const nextChecks=[
        "Verify external publisher identity and date/version from an independent authenticated channel.",
        "Read the exact original bytes and check claim value, period, unit, issuer and counter-evidence.",
        "Compare source family, source vintage, claim ID and prior notes before dedup or changing event chronology.",
        "Have an authenticated human reviewer validate the proposed correction/navigation need; collect separate owner approval.",
        "Only after authorization, prepare a one-note exact diff in a separate Safe Edit preview, enforce current hashes and verify readback.",
      ];
      return {
        status:integrityHold?"source_archive_integrity_hold" as const:
          !eligible?"protected_or_ineligible_note_hold" as const:
          !req.expectedNoteSha256?"awaiting_note_hash_reconfirmation" as const:
          !evidenceByteGate||isIndependentArchivedAi?
            "source_or_independence_evidence_missing_hold" as const:
            "stored_bytes_located_for_manual_verification_only" as const,
        exactNotePath:req.notePath,
        noteRole:schema.role,
        noteSha256:note.hash,
        noteBytes:row.size,
        expectedNoteHashMatched:req.expectedNoteSha256!==undefined,
        actionRequested:req.action,
        callerSuppliedRationale:req.rationale??null,
        noteDeclaredVerification:schema.declaredVerification,
        noteDeclaredSourceType:schema.rawSourceType,
        independenceAssessment:schema.independenceAssessment,
        roleAndPathEligible:eligible,
        offlineSourceAuditState:global.status,
        offlineMarkdownCoverageStatus:global.markdownSnapshotCoverage,
        noteSourceEvidence:{
          status:sourceEvidenceState,
          sourceHost:normalized?new URL(normalized).hostname:null,
          registrySourceKeySha256:normalized?digest(normalized):null,
          registeredVersions:sourceRows.length,
          versionsTruncated:sourceVersionsTruncated,
          exactStoredBlobSha256:matched?.sha256??null,
          exactStoredBlobByteLength:matched?.byte_length??null,
          exactStoredBlobSnapshotId:matched?.snapshot_id??null,
          exactStoredBlobRevision:matched?.revision??null,
          fullHashMatchesStoredVersion:evidenceByteGate,
          sourceExcerptHashIsNotFullDocumentProof:true as const,
          publisherIdentityVerified:false as const,
          capturedMetadataAuthenticated:false as const,
          exactFinancialClaimVerified:false as const,
        },
        blockers,nextChecks,
        changeLogDraft:{
          notePath:req.notePath,noteBeforeSha256:note.hash,
          disposition:req.action,reason:req.rationale??null,
          status:"unsaved_unapproved_review_worksheet" as const,
          evidenceClassification:"stored_byte_integrity_not_issuer_or_claim_verification" as const,
          changeToExistingThesis:"unassessed" as const,
        },
        proposedPatch:null,
        safeEditTemplate:null,
        ownerApprovalGranted:false as const,
        reviewerAuthenticated:false as const,
        reviewCompleted:false as const,
        claimVerified:false as const,
        originalSourceIndependentlyAuthenticated:false as const,
        immutableSnapshotVerified:false as const,
        canAutoWrite:false as const,
        canAutoUpdateThesis:false as const,
      };
    })();
  }finally{d.close();}
}

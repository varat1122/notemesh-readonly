/**
 * Detached, pure evidence-gated review proposal: NEVER reads or writes Vault,
 * archive, database, network or MCP. Inputs are caller-supplied assertions,
 * NOT authenticated owner approval, publisher evidence or claim verification.
 */
import {createHash} from "node:crypto";
const HASH=/^[0-9a-f]{64}$/;
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const validHash=(s:unknown):s is string=>typeof s==="string"&&HASH.test(s);
const validText=(s:unknown,max=600):s is string=>typeof s==="string"&&
  s.trim().length>0&&s.length<=max&&!/[\r\0]/.test(s);
const RELATIONSHIPS=["new_event","duplicate","added_detail","correction",
  "contradiction","unresolved"] as const;
export type Relationship=(typeof RELATIONSHIPS)[number];
export interface ReviewProposalInput {
  target:{
    path:string;role:"historical_analysis"|"review"|"other";
    expectedSha256:string;indexedMtimeMs:number;indexedByteLength:number;
    expectedIndexFingerprint:string;observedIndexFingerprint:string;
    snapshotManifestSha256:string;observedSnapshotManifestSha256:string;
    snapshotStatus:string;
  };
  detachedNoteText:string;
  observedReadback:{sha256:string;mtimeMs:number;byteLength:number};
  source:{
    originalSource:unknown;declaredFullHash:unknown;sourceType:string;
    independence:"not_assessed"|"not_independent_archived_ai"|
      "not_independent_derivative_summary";
    archiveStatus:string;
    receipt:null|{
      originalSource:string;sha256:string;revision:number;
      byteStatus:"intact_stored_bytes"|"stored_original_bytes_unattributed"|
        "tampered_or_missing_bytes";
      snapshotManifestSha256:string;
    };
    eventKey:string|null;eventDate:string|null;publishedAt:string|null;
    importedAt:string|null;verifiedAt:string|null;
    prior:null|{eventKey:string;originalSource:string;sha256:string;revision:number};
  };
  claim:null|{claimId:string;entity:string;period:string;metric:string;
    unit:string;value:string};
  review:{disposition:string;rationale:string;
    reviewerAuthenticated:boolean;ownerApprovalClaimed:boolean;
    relationship:Relationship};
  edit:{oldLine:string;newLine:string};
}
function url(value:unknown):string|null {
  if(!validText(value,2048))return null;
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.port)return null;
    u.hash="";
    for(const k of [...u.searchParams.keys()])
      if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();return u.toString();
  }catch{return null;}
}
function dateOnly(v:unknown):number|null {
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;
  const n=Date.parse(v+"T00:00:00Z");
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v?n:null;
}
function timestamp(v:unknown):number|null {
  if(typeof v!=="string"||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v))return null;
  const n=Date.parse(v);return Number.isFinite(n)?n:null;
}
function forbidden(p:string):boolean {
  return typeof p!=="string"||p.length>350||!p.endsWith(".md")||
    p.startsWith("/")||p.includes("\\")||
    p.split("/").some(x=>!x||x==="."||x===".."||x.startsWith("."))||
    /^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates|source-archive)(?:\/|$)/i.test(p)||
    /(?:^|\/)[^/]*(?:current[\s_-]*thesis|evidence[\s_-]*register|portfolio)[^/]*\.md$/i.test(p);
}
function exactBodyLine(body:string,oldLine:string):number|null {
  const lines=body.split("\n");let yaml=lines[0]==="---",fence=false;
  let count=0,found:number|null=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(i>0&&yaml&&line==="---"){yaml=false;continue;}
    if(/^ {0,3}(?:\x60{3,}|~{3,})/.test(line)){fence=!fence;continue;}
    if(line===oldLine){
      count++;
      found=(!yaml&&!fence&&!/^\s*(?:[|<>]|[-*+] )/.test(line))?i+1:null;
    }
  }
  return count===1?found:null;
}
export function prepareEvidenceGatedReviewProposal(input:ReviewProposalInput){
  const holds:string[]=[],manual:string[]=[];
  const t=input.target,s=input.source,r=input.review;
  if(forbidden(t.path)||t.role==="other")holds.push("protected_or_out_of_scope_note");
  const raw=typeof input.detachedNoteText==="string"?input.detachedNoteText:"";
  const bytes=Buffer.byteLength(raw,"utf8"),beforeHash=hash(raw);
  if(!bytes||bytes>100_000||raw.includes("\0"))holds.push("invalid_note_bytes");
  if(!validHash(t.expectedSha256)||!validHash(input.observedReadback.sha256)||
    beforeHash!==t.expectedSha256||beforeHash!==input.observedReadback.sha256||
    !Number.isSafeInteger(t.indexedMtimeMs)||
    t.indexedMtimeMs!==input.observedReadback.mtimeMs||
    !Number.isSafeInteger(t.indexedByteLength)||
    t.indexedByteLength!==bytes||bytes!==input.observedReadback.byteLength)
    holds.push("note_readback_or_index_version_mismatch");
  if(!validHash(t.expectedIndexFingerprint)||
    t.expectedIndexFingerprint!==t.observedIndexFingerprint)
    holds.push("index_fingerprint_stale");
  if(!validHash(t.snapshotManifestSha256)||
    t.snapshotManifestSha256!==t.observedSnapshotManifestSha256||
    t.snapshotStatus!=="snapshot_markdown_index_reconciled_not_originals_verified")
    holds.push("offline_snapshot_stale_or_not_reconciled");
  const locator=url(s.originalSource),receiptUrl=url(s.receipt?.originalSource);
  const declared=validHash(s.declaredFullHash)?s.declaredFullHash:null;
  if(!locator||!declared)holds.push("missing_invalid_or_yaml_coerced_full_source_hash");
  if(!s.receipt||!validHash(s.receipt.sha256)||receiptUrl!==locator||
    declared!==s.receipt.sha256||
    s.receipt.byteStatus!=="intact_stored_bytes"||
    !Number.isSafeInteger(s.receipt.revision)||s.receipt.revision<1||
    s.receipt.snapshotManifestSha256!==t.snapshotManifestSha256||
    s.archiveStatus!=="offline_archived_bytes_intact_not_publisher_verified")
    holds.push("original_source_receipt_bytes_or_snapshot_unmatched");
  if(s.independence!=="not_assessed"||
    /^(?:archived_ai|chatgpt_history|chatgpt_export|chatgpt_analysis|user_supplied_chatgpt_summary)$/i.test(s.sourceType))
    holds.push("archived_ai_or_derivative_not_independent");
  if(!validText(s.sourceType,100))holds.push("source_type_missing");
  const rawDates=[s.eventDate,s.publishedAt,s.importedAt,s.verifiedAt];
  const times=[s.eventDate===null?null:dateOnly(s.eventDate),
    ...[s.publishedAt,s.importedAt,s.verifiedAt].map(x=>x===null?null:timestamp(x))];
  if(rawDates.some((x,i)=>x!==null&&times[i]===null))
    holds.push("invalid_event_publication_import_or_verification_date");
  if(rawDates.some(x=>x===null))manual.push("chronology_missing_fields_remain_unknown");
  if(times[1]!==null&&times[2]!==null&&times[1]>times[2])
    holds.push("publication_after_import_chronology_conflict");
  if(times[0]!==null&&times[1]!==null&&times[0]>times[1]+86400000)
    manual.push("event_after_publication_needs_context");
  if(times[2]!==null&&times[3]!==null&&times[2]>times[3])
    manual.push("verification_precedes_import_needs_context");
  if(input.claim!==null&&
    !Object.values(input.claim).every(x=>validText(x,200)))
    holds.push("structured_claim_fields_invalid");
  if(input.claim===null)manual.push("legacy_narrative_has_no_structured_claim");
  if(!validText(r.rationale,600))holds.push("bounded_review_justification_required");
  if(!validText(r.disposition,100)||r.disposition==="no_change_needed")
    holds.push("review_disposition_cannot_propose_edit");
  if(!r.reviewerAuthenticated)manual.push("reviewer_identity_unverified");
  if(r.ownerApprovalClaimed)manual.push("owner_approval_claim_not_authorization");
  if(!RELATIONSHIPS.includes(r.relationship))holds.push("invalid_relationship");
  if(!validText(s.eventKey,200))manual.push("event_identity_unresolved");
  const prior=s.prior;
  if(prior){
    if(!validHash(prior.sha256)||!validText(prior.eventKey,200)||
      !Number.isSafeInteger(prior.revision)||prior.revision<1||
      url(prior.originalSource)!==locator)
      holds.push("prior_revision_wrong_source_family");
    else if(prior.eventKey===s.eventKey){
      if(prior.sha256===declared){
        manual.push("duplicate_event_same_original_not_independent");
        if(r.relationship!=="duplicate")holds.push("same_original_misclassified_as_new");
      }else if(!s.receipt||s.receipt.revision<=prior.revision)
        holds.push("new_bytes_without_newer_source_revision");
      else if(r.relationship==="new_event"||r.relationship==="duplicate")
        holds.push("same_event_revision_requires_relation_review");
    }
  }
  if(["duplicate","correction","contradiction","unresolved"].includes(r.relationship))
    manual.push("relationship_requires_claim_level_reconciliation");
  const e=input.edit;
  if(!validText(e.oldLine,600)||!validText(e.newLine,600)||
    /[\r\n\0]/.test(e.oldLine)||/[\r\n\0]/.test(e.newLine)||
    e.oldLine===e.newLine)
    holds.push("single_bounded_nonidentical_line_required");
  const line=typeof e.oldLine==="string"?exactBodyLine(raw,e.oldLine):null;
  if(line===null)holds.push("edit_anchor_missing_duplicate_or_in_protected_structure");
  const unresolvedGates=[...new Set([...holds,...manual])].slice(0,24);
  const status=holds.length?"hold":manual.length?"human_review_required":
    "read_only_proposal_ready";
  const after=status==="read_only_proposal_ready"&&line!==null?
    raw.split("\n").map((x,i)=>i===line-1?e.newLine:x).join("\n"):null;
  return {
    status,exactTargetPath:t.path,
    protectedTarget:forbidden(t.path),
    before:{sha256:beforeHash,indexedMtimeMs:t.indexedMtimeMs,
      indexedByteLength:t.indexedByteLength},
    indexFingerprint:t.expectedIndexFingerprint,
    offlineManifestSha256:t.snapshotManifestSha256,
    source:{canonicalLocator:locator,declaredFullHash:declared,
      archiveReceiptSha256:s.receipt?.sha256??null,
      storedByteIntegrity:s.receipt?.byteStatus??"absent",
      declaredSourceType:s.sourceType,independence:s.independence,
      publisherIdentityVerified:false,sourceIndependenceVerified:false},
    chronology:{eventDate:s.eventDate,publishedAt:s.publishedAt,
      importedAt:s.importedAt,verifiedAt:s.verifiedAt},
    claim:input.claim===null?null:{...input.claim},
    relationship:{classification:r.relationship,
      previousRevision:prior?.revision??null,
      currentRevision:s.receipt?.revision??null,
      humanClaimReconciliationPerformed:false},
    callerSelectedDisposition:r.disposition,
    callerAssertedReviewerAuthenticated:r.reviewerAuthenticated,
    reviewerAuthenticationIndependentlyVerified:false,
    requiredEvidence:unresolvedGates.map(x=>"Resolve: "+x),
    unresolvedGates,
    safeEditPreview:after===null?null:{
      exactPath:t.path,expectedBeforeSha256:beforeHash,
      proposedAfterSha256:hash(after),lineNumber:line,
      exactDiff:"@@ -"+line+",1 +"+line+",1 @@\n-"+e.oldLine+"\n+"+e.newLine,
      state:"detached_unapproved_not_safe_edit_operation" as const},
    proposedChangeLog:{path:t.path,relationship:r.relationship,
      reviewJustification:validText(r.rationale,600)?r.rationale:null,
      state:"draft_not_saved_not_approved" as const},
    publisherAuthenticityVerified:false as const,
    investmentClaimFactsVerified:false as const,
    immutableSnapshotVerified:false as const,
    disasterRecoveryAccepted:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,canAutoUpdateThesis:false as const,
    vaultModified:false as const,
  };
}

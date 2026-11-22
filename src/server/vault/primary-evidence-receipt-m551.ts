import { db } from "../db";
import { archivedSourceContainsLiteral, inspectOriginalSourceSnapshot } from "../research-source-archive";
import { preparePrimaryEvidenceAttestation, verifyPrimarySignatures,
  primaryReceiptId, primaryValueAppearsInAnchor,primaryAttestationSchema,
  type PrimaryAttestation } from "./primary-evidence-attestation-m551";

/**
 * READ ONLY: validate a claim-scoped, server-controlled adjudication against a
 * complete archived document. Caller text and indexed Vault frontmatter are
 * never proof. This module deliberately exposes NO way for an MCP caller to
 * create/approve a receipt. Signed issuance lives behind the separate
 * admin-session route and requires two offline private keys; MFA/real-world
 * human independence must be established outside the single-admin server.
 *
 * Even a valid receipt means a named reviewer adjudicated this exact claim
 * against stored bytes; it is not a cryptographic issuer signature, consensus,
 * historical dedup, or authorization to edit Thesis/Portfolio.
 */
export interface PrimaryClaimScope {
  receiptId:string;
  sourceUrl:string;
  entity:string;
  metric:string;
  period:string;
  unit:string;
  verifiedValue:string;
  competingValues:string[];
}
export type PrimaryReceiptCheck =
  {valid:true; status:"server_adjudicated_primary_claim_scope"; snapshotId:string}|
  {valid:false; status:"missing_or_unverified_primary_claim_receipt"; reason:
    "missing"|"scope_mismatch"|"approval_incomplete"|"archive_invalid"|"excerpt_not_in_archived_bytes"};

type Row={receipt_id:string;snapshot_id:string;source_sha256:string;original_source:string;
  entity:string;metric:string;period:string;unit:string;verified_value:string;
  source_locator:string;raw_source_excerpt:string;reviewer_id:string;approved_at:string;reviewed_at:string|null;
  primary_origin_adjudicated:number;conflicting_values_adjudicated:number;
  status:string;reviewer_key_id:string|null;reviewer_signature:string|null;
  approver_key_id:string|null;approver_signature:string|null;counter_claims_json:string|null};
const norm=(s:string)=>s.normalize("NFC").trim().toLocaleLowerCase("en");
const validDate=(s:string)=>/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s)&&
  !Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,19)===s.slice(0,19);
function canonicalUrl(s:string):string|null {
  try{
    const u=new URL(s);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash)return null;
    for(const key of [...u.searchParams.keys()])
      if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  }catch{return null;}
}
const reject=(reason:Extract<PrimaryReceiptCheck,{valid:false}>["reason"]):PrimaryReceiptCheck=>
  ({valid:false,status:"missing_or_unverified_primary_claim_receipt",reason});

export function validatePrimaryEvidenceReceipt(scope:PrimaryClaimScope):PrimaryReceiptCheck {
  if(!/^PEV-[A-F0-9]{32}$/.test(scope.receiptId))return reject("missing");
  const row=db().prepare("SELECT * FROM primary_claim_verifications WHERE receipt_id=?")
    .get(scope.receiptId) as Row|undefined;
  if(!row)return reject("missing");
  const url=canonicalUrl(scope.sourceUrl);
  if(!url||canonicalUrl(row.original_source)!==url||
     norm(row.entity)!==norm(scope.entity)||norm(row.metric)!==norm(scope.metric)||
     norm(row.period)!==norm(scope.period)||norm(row.unit)!==norm(scope.unit)||
     row.verified_value.trim()!==scope.verifiedValue.trim()||
     !scope.competingValues.some(v=>v.trim()===row.verified_value.trim()))return reject("scope_mismatch");
  const conflicting=new Set(scope.competingValues.map(v=>v.trim())).size>1;
  if(row.status!=="approved"||row.primary_origin_adjudicated!==1||
     conflicting&&row.conflicting_values_adjudicated!==1||
     !row.reviewer_id.startsWith("admin:")||row.reviewer_id.length<9||
     !validDate(row.approved_at)||!row.source_locator.trim()||
     row.raw_source_excerpt.length<12||row.raw_source_excerpt.length>2000)
    return reject("approval_incomplete");
  // Immutable revocation rows defeat even an accidental attempt to set an
  // old approval's status back to "approved". No reactivation endpoint exists.
  if(db().prepare("SELECT 1 FROM primary_claim_receipt_revocations WHERE receipt_id=?")
    .get(row.receipt_id))return reject("approval_incomplete");
  if(!row.reviewed_at||!row.reviewer_key_id||!row.reviewer_signature||
     !row.approver_key_id||!row.approver_signature||!row.counter_claims_json)
    return reject("approval_incomplete");
  let counterClaims:PrimaryAttestation["counterClaims"];
  try{counterClaims=primaryAttestationSchema.shape.counterClaims.parse(JSON.parse(row.counter_claims_json));}
  catch{return reject("approval_incomplete");}
  const expectedValues=new Set([row.verified_value,...counterClaims.map(c=>c?.value)]);
  const receivedValues=new Set(scope.competingValues.map(v=>v.trim()));
  if(expectedValues.size!==receivedValues.size||
     [...expectedValues].some(v=>!receivedValues.has(v)))return reject("scope_mismatch");
  const attestation={version:"M551-PRIMARY-1" as const,snapshotId:row.snapshot_id,
    sourceSha256:row.source_sha256,primarySourceUrl:row.original_source,entity:row.entity,
    metric:row.metric,period:row.period,unit:row.unit,verifiedValue:row.verified_value,
    sourceLocator:row.source_locator,rawSourceExcerpt:row.raw_source_excerpt,
    reviewedAt:row.reviewed_at,primaryOriginAdjudicated:true as const,
    conflictingValuesAdjudicated:row.conflicting_values_adjudicated===1,counterClaims};
  try {
    if(primaryReceiptId(attestation)!==row.receipt_id||!verifyPrimarySignatures({attestation,
      reviewer:{keyId:row.reviewer_key_id,signatureBase64:row.reviewer_signature},
      approver:{keyId:row.approver_key_id,signatureBase64:row.approver_signature}}))
      return reject("approval_incomplete");
    preparePrimaryEvidenceAttestation(attestation);
  }catch{return reject("approval_incomplete");}
  const snapshot=inspectOriginalSourceSnapshot(row.snapshot_id);
  if(!snapshot||snapshot.archiveStatus!=="intact_stored_bytes"||
     snapshot.sha256!==row.source_sha256||
     snapshot.captureMethod!=="authorized_external_download"||
     canonicalUrl(snapshot.originalSource)!==url||canonicalUrl(snapshot.retrievedFrom)!==url)
    return reject("archive_invalid");
  if(!primaryValueAppearsInAnchor(row.raw_source_excerpt,row.verified_value)||
     !archivedSourceContainsLiteral(row.snapshot_id,row.raw_source_excerpt))
    return reject("excerpt_not_in_archived_bytes");
  return {valid:true,status:"server_adjudicated_primary_claim_scope",snapshotId:snapshot.snapshotId};
}

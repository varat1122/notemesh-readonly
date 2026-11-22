import crypto from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { trustedHttpsUrl } from "../research-source-fetch";
import { archivedSourceContainsLiteral, inspectOriginalSourceSnapshot } from "../research-source-archive";

/**
 * Two independent, out-of-band Ed25519 signatures on the exact source + claim
 * scope. The server stores only trusted PUBLIC keys; it never generates,
 * receives or holds a private signing key. The signature certifies a human
 * attestation, not a machine proof of issuer-authored economic truth.
 *
 * The existing Better Auth instance is single-admin. A second admin login
 * is NOT an independent evidence reviewer; signer identities live outside it.
 */
export const primaryAttestationSchema=z.object({
  version:z.literal("M551-PRIMARY-1"),
  snapshotId:z.string().regex(/^[a-f0-9]{64}$/),
  sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
  primarySourceUrl:z.string().url().max(2000),
  entity:z.string().min(1).max(120),
  metric:z.string().min(1).max(140),
  period:z.string().min(1).max(120),
  unit:z.string().min(1).max(80),
  verifiedValue:z.string().min(1).max(150),
  sourceLocator:z.string().min(8).max(500),
  rawSourceExcerpt:z.string().min(12).max(2000),
  reviewedAt:z.string().datetime({offset:false}),
  primaryOriginAdjudicated:z.literal(true),
  conflictingValuesAdjudicated:z.boolean(),
  counterClaims:z.array(z.object({
    value:z.string().min(1).max(150),
    sourceUrl:z.string().url().max(2000).nullable(),
    sourceLabel:z.string().min(3).max(160),
    publishedAt:z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable(),
    disposition:z.enum(["unverified","misquoted","superseded","different_scope"]),
    rationale:z.string().min(25).max(1000)
  }).strict()).max(8)
}).strict();
export type PrimaryAttestation=z.infer<typeof primaryAttestationSchema>;
export const primarySignatureSchema=z.object({
  keyId:z.string().regex(/^[a-zA-Z0-9_-]{4,60}$/),
  signatureBase64:z.string().min(86).max(90)
}).strict();
export const primarySignedImportSchema=z.object({
  attestation:primaryAttestationSchema,
  reviewer:primarySignatureSchema,
  approver:primarySignatureSchema
}).strict();
export type PrimarySignedImport=z.infer<typeof primarySignedImportSchema>;

const digest=(data:Buffer|string)=>crypto.createHash("sha256").update(data).digest("hex");
const validUtc=(s:string)=>/Z$/.test(s)&&!Number.isNaN(Date.parse(s))&&
  new Date(s).toISOString()===s;
const validDay=(s:string)=>/^\d{4}-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z"))&&
  new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
export function primaryValueAppearsInAnchor(anchor:string,value:string):boolean {
  const escaped=value.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  if(!escaped||escaped.length>300)return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}.,+%/-])${escaped}(?:$|[^\\p{L}\\p{N}.,+%/-])`,"u")
    .test(anchor);
}
export function primarySigningMessage(attestation:PrimaryAttestation):Buffer {
  const a=primaryAttestationSchema.parse(attestation);
  // Fixed-order tuple, domain separated from all other server/OAuth signing.
  return Buffer.from("InvestmentOS.PrimaryEvidence.M551.1\n"+JSON.stringify([
    a.version,a.snapshotId,a.sourceSha256,a.primarySourceUrl,a.entity,a.metric,
    a.period,a.unit,a.verifiedValue,a.sourceLocator,a.rawSourceExcerpt,
    a.reviewedAt,a.primaryOriginAdjudicated,a.conflictingValuesAdjudicated,
    a.counterClaims.map(c=>[c.value,c.sourceUrl,c.sourceLabel,c.publishedAt,c.disposition,c.rationale])
  ]),"utf8");
}
export function primaryReceiptId(attestation:PrimaryAttestation):string {
  return "PEV-"+digest(primarySigningMessage(attestation)).slice(0,32).toUpperCase();
}

type Role="reviewer"|"approver";
type ConfiguredKey={keyId:string;role:Role;publicKeyPem:string};
function verifiedKeys():Map<string,{role:Role;key:crypto.KeyObject}> {
  const raw=process.env.PRIMARY_EVIDENCE_SIGNERS_JSON;
  if(!raw||raw.length>30000)throw Error("primary_signer_keys_not_configured");
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw Error("primary_signer_config_invalid");}
  const list=z.array(z.object({
    keyId:z.string().regex(/^[a-zA-Z0-9_-]{4,60}$/),
    role:z.enum(["reviewer","approver"]),
    publicKeyPem:z.string().min(80).max(2000)
  }).strict()).min(2).max(16).parse(parsed) as ConfiguredKey[];
  const keys=new Map<string,{role:Role;key:crypto.KeyObject}>(),seen=new Set<string>();
  for(const item of list){
    if(keys.has(item.keyId))throw Error("primary_signer_duplicate_id");
    let key:crypto.KeyObject;
    try{key=crypto.createPublicKey(item.publicKeyPem);}catch{throw Error("primary_signer_key_invalid");}
    if(key.asymmetricKeyType!=="ed25519")throw Error("primary_signer_must_be_ed25519");
    const fp=digest(key.export({format:"der",type:"spki"}) as Buffer);
    if(seen.has(fp))throw Error("primary_signer_key_reused_across_roles");
    seen.add(fp);keys.set(item.keyId,{role:item.role,key});
  }
  if(![...keys.values()].some(x=>x.role==="reviewer")||
     ![...keys.values()].some(x=>x.role==="approver"))throw Error("primary_signer_roles_incomplete");
  return keys;
}
function signatureBytes(sig:string):Buffer|null {
  if(!/^[A-Za-z0-9+/]{85,88}={0,2}$/.test(sig))return null;
  const bytes=Buffer.from(sig,"base64");
  return bytes.length===64&&bytes.toString("base64")===sig?bytes:null;
}
export function verifyPrimarySignatures(input:PrimarySignedImport):boolean {
  try{
    const signed=primarySignedImportSchema.parse(input),keys=verifiedKeys();
    if(signed.reviewer.keyId===signed.approver.keyId)return false;
    const r=keys.get(signed.reviewer.keyId),a=keys.get(signed.approver.keyId);
    if(r?.role!=="reviewer"||a?.role!=="approver")return false;
    const rs=signatureBytes(signed.reviewer.signatureBase64),as=signatureBytes(signed.approver.signatureBase64);
    if(!rs||!as)return false;
    const msg=primarySigningMessage(signed.attestation);
    return crypto.verify(null,msg,r.key,rs)&&crypto.verify(null,msg,a.key,as);
  }catch{return false;}
}
export function preparePrimaryEvidenceAttestation(raw:unknown){
  const a=primaryAttestationSchema.parse(raw);
  if(!validUtc(a.reviewedAt))throw Error("primary_review_timestamp_invalid");
  for(const value of [a.entity,a.metric,a.period,a.unit,a.verifiedValue,a.sourceLocator])
    if(value!==value.trim()||value!==value.normalize("NFC")||
       [...value].some(c=>c.charCodeAt(0)<32))
      throw Error("primary_claim_identity_not_canonical");
  if(a.conflictingValuesAdjudicated!==Boolean(a.counterClaims.length)||
     new Set(a.counterClaims.map(c=>c.value)).size!==a.counterClaims.length||
     a.counterClaims.some(c=>c.value===a.verifiedValue||c.value!==c.value.trim()||
       c.rationale!==c.rationale.trim()||c.sourceLabel!==c.sourceLabel.trim()||
       (c.publishedAt!==null&&!validDay(c.publishedAt))||
       (c.sourceUrl!==null&&new URL(c.sourceUrl).protocol!=="https:")))
    throw Error("primary_counterclaim_adjudication_incomplete");
  const u=trustedHttpsUrl(a.primarySourceUrl);
  if(u.toString()!==a.primarySourceUrl)throw Error("primary_url_not_canonical");
  const snap=inspectOriginalSourceSnapshot(a.snapshotId);
  if(!snap||snap.archiveStatus!=="intact_stored_bytes"||snap.sha256!==a.sourceSha256||
     snap.captureMethod!=="authorized_external_download"||
     snap.originalSource!==a.primarySourceUrl||snap.retrievedFrom!==a.primarySourceUrl)
    throw Error("primary_source_archived_bytes_unverified");
  if(Date.parse(a.reviewedAt)<Date.parse(snap.capturedAt)-300000||
     Date.parse(a.reviewedAt)>Date.now()+300000)throw Error("primary_review_timestamp_out_of_bounds");
  if(!primaryValueAppearsInAnchor(a.rawSourceExcerpt,a.verifiedValue)||
     !archivedSourceContainsLiteral(a.snapshotId,a.rawSourceExcerpt))
    throw Error("primary_value_not_grounded_in_source_anchor");
  const message=primarySigningMessage(a);
  return {attestation:a,receiptId:primaryReceiptId(a),messageBase64:message.toString("base64"),
    messageSha256:digest(message),sourceByteIntegrityVerified:true,
    publisherAuthenticityCryptographicallyVerified:false,
    independentHumanIdentityVerifiedByServer:false,
    next:"Obtain two out-of-band Ed25519 signatures from separately assigned reviewer/approver keys; no approval has been issued."};
}

const actor=(s:string)=>{
  if(!/^admin:[a-zA-Z0-9_-]{3,128}$/.test(s))throw Error("authenticated_admin_required");
  return s;
};
/** Must only be reached behind an authenticated same-origin ADMIN route. */
export function importSignedPrimaryEvidence(raw:unknown,adminActor:string){
  actor(adminActor);
  if(process.env.PRIMARY_EVIDENCE_ISSUANCE_ENABLED!=="1")
    throw Error("primary_receipt_issuance_disabled");
  const signed=primarySignedImportSchema.parse(raw),a=signed.attestation;
  const prepared=preparePrimaryEvidenceAttestation(a);
  if(!verifyPrimarySignatures(signed))throw Error("independent_primary_signatures_invalid");
  const d=db(),now=new Date().toISOString();
  d.transaction(()=>{
    const n=(d.prepare("SELECT COUNT(*) AS n FROM primary_claim_verifications").get() as {n:number}).n;
    if(n>=1000)throw Error("primary_receipt_quota_reached");
    d.prepare(`INSERT INTO primary_claim_verifications (
      receipt_id,snapshot_id,source_sha256,original_source,entity,metric,period,unit,
      verified_value,source_locator,raw_source_excerpt,reviewer_id,approved_at,
      primary_origin_adjudicated,conflicting_values_adjudicated,status,reviewed_at,
      reviewer_key_id,reviewer_signature,approver_key_id,approver_signature,counter_claims_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      prepared.receiptId,a.snapshotId,a.sourceSha256,a.primarySourceUrl,a.entity,a.metric,a.period,
      a.unit,a.verifiedValue,a.sourceLocator,a.rawSourceExcerpt,adminActor,now,1,
      a.conflictingValuesAdjudicated?1:0,"approved",a.reviewedAt,
      signed.reviewer.keyId,signed.reviewer.signatureBase64,
      signed.approver.keyId,signed.approver.signatureBase64,JSON.stringify(a.counterClaims));
    d.prepare(`INSERT INTO primary_claim_receipt_events
      (receipt_id,event,occurred_at,actor_id,payload_sha256) VALUES (?,?,?,?,?)`)
      .run(prepared.receiptId,"issued",now,adminActor,prepared.messageSha256);
  })();
  audit("primary_evidence_receipt_issued",{receiptId:prepared.receiptId,adminActor});
  return {status:"signed_claim_receipt_issued",receiptId:prepared.receiptId,
    sourceByteIntegrityVerified:true,publisherCryptographicSignatureVerified:false,
    thesisOrPortfolioApproved:false};
}

export function revokePrimaryEvidenceReceipt(receiptId:string,reason:string,adminActor:string){
  actor(adminActor);
  if(!/^PEV-[A-F0-9]{32}$/.test(receiptId)||reason.trim().length<15||reason.length>1000)
    throw Error("primary_revocation_input_invalid");
  const d=db(),now=new Date().toISOString();
  d.transaction(()=>{
    const found=d.prepare("SELECT 1 FROM primary_claim_verifications WHERE receipt_id=?").get(receiptId);
    if(!found)throw Error("primary_receipt_not_found");
    d.prepare("INSERT INTO primary_claim_receipt_revocations VALUES (?,?,?,?)")
      .run(receiptId,now,adminActor,reason.trim());
    d.prepare(`INSERT INTO primary_claim_receipt_events
      (receipt_id,event,occurred_at,actor_id,payload_sha256) VALUES (?,?,?,?,?)`)
      .run(receiptId,"revoked",now,adminActor,digest(reason.trim()));
  })();
  audit("primary_evidence_receipt_revoked",{receiptId,adminActor});
  return {status:"irreversibly_revoked",receiptId};
}

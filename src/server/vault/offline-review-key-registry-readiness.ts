/**
 * OFFLINE TRUST REGISTRY READINESS (no enrollment, no owner authentication).
 *
 * PR #79 accepts caller-chosen policy keys. This gate instead reads a
 * separately located, strictly read-only key registry and compares its
 * physical bytes to an OUT-OF-BAND EXPECTED SHA-256 supplied by the caller.
 * IMPORTANT: the pin itself is NOT independently provisioned here and can
 * be forged together with a registry. This is a commissioning dry run only.
 *
 * No HTTP, MCP, signer, key writer, replay journal, Vault write or Safe Edit.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash,createPublicKey} from "node:crypto";
import {verifyOfflineBoundSignedReview} from "./offline-review-signature-bridge";
import {type OfflineBoundProposalRequest} from "./offline-bound-evidence-proposal";
import {type OfflineReviewTrustPolicy,type SignatureReceipt}
  from "./offline-review-signature-gate";

const HASH=/^[0-9a-f]{64}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/;
const hash=(s:Buffer)=>createHash("sha256").update(s).digest("hex");
const isHash=(s:unknown):s is string=>typeof s==="string"&&HASH.test(s);
const text=(s:unknown,max=120):s is string=>
  typeof s==="string"&&s.trim().length>0&&s.length<=max&&
  !/[\r\n\0]/.test(s);
const utc=(s:unknown):number|null=>{
  if(typeof s!=="string"||!TIME.test(s))return null;
  const ms=Date.parse(s);
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)+"Z"===s?ms:null;
};
const blocked=(reason:string,registrySha256:string|null=null)=>({
  status:"hold_for_independent_owner_enrollment" as const,
  registrySha256,reason,
  offlineRegistryBytesMatchCallerPin:false,
  reviewerSignatureMatchesRegistry:false,
  ownerSignatureMatchesRegistry:false,
  independentOwnerIdentityVerified:false as const,
  outOfBandPinAuthenticated:false as const,
  ownerKeyProvisioningCompleted:false as const,
  durableReplayJournalVerified:false as const,
  revocationLedgerCompletenessVerified:false as const,
  ownerApprovalGranted:false as const,
  canAutoWrite:false as const,
  canAutoUpdateThesis:false as const,
  safeEditPreview:null,
  vaultModified:false as const,
});
export type OfflineRegistryDocument={
  schema:"investment_os_offline_review_key_registry_v1";
  registryId:string;
  revision:number;
  activatedAt:string;
  expiresAt:string;
  disabledKeyIds:string[];
  policy:OfflineReviewTrustPolicy;
};
function readRegistryFile(file:string,snapshotRoot:string){
  if(typeof file!=="string"||!path.isAbsolute(file)||
    file.length>1000||file.includes("\0"))
    throw Error("offline_registry_requires_separate_absolute_path");
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("offline_registry_refused_inside_railway_runtime");
  const canonical=fs.realpathSync(file);
  if(path.normalize(file)!==canonical)
    throw Error("offline_registry_symlink_path_hold");
  const snapshot=fs.realpathSync(snapshotRoot);
  const live=process.env.DATA_DIR?fs.realpathSync(process.env.DATA_DIR):null;
  if([snapshot,live].some(root=>root&&(
    canonical===root||canonical.startsWith(root+path.sep))))
    throw Error("offline_registry_cannot_live_inside_vault_or_snapshot");
  const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|
    (fs.constants.O_CLOEXEC??0);
  const fd=fs.openSync(canonical,flags);
  try{
    const a=fs.fstatSync(fd);
    if(!a.isFile()||a.nlink!==1||a.size<50||a.size>16_384||
      (a.mode&0o022)!==0)
      throw Error("offline_registry_unsafe_permissions_or_file");
    const raw=fs.readFileSync(fd);
    const b=fs.fstatSync(fd);
    if(b.size!==a.size||raw.length!==a.size||a.mtimeMs!==b.mtimeMs||
      a.ctimeMs!==b.ctimeMs||b.nlink!==1||!b.isFile())
      throw Error("offline_registry_concurrent_change_hold");
    // No claim of immutable storage; re-open still cannot close all races.
    const second=fs.readFileSync(canonical);
    if(!raw.equals(second))
      throw Error("offline_registry_concurrent_change_hold");
    return raw;
  }finally{fs.closeSync(fd);}
}
function parseCandidateRegistry(raw:Buffer):OfflineRegistryDocument {
  const data=JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(raw)) as
    Partial<OfflineRegistryDocument>;
  if(!data||typeof data!=="object"||Array.isArray(data)||
    data.schema!=="investment_os_offline_review_key_registry_v1"||
    !text(data.registryId,120)||
    !Number.isSafeInteger(data.revision)||data.revision!<1||
    utc(data.activatedAt)===null||utc(data.expiresAt)===null||
    !Array.isArray(data.disabledKeyIds)||data.disabledKeyIds.length>100||
    data.disabledKeyIds.some(x=>!text(x,100))||
    new Set(data.disabledKeyIds).size!==data.disabledKeyIds.length||
    !data.policy||typeof data.policy!=="object"||Array.isArray(data.policy))
    throw Error("offline_registry_invalid_document");
  if(!text(data.policy.policyId,120)||
    !Number.isSafeInteger(data.policy.revision)||data.policy.revision<1||
    data.policy.reviewer?.keyId===data.policy.owner?.keyId)
    throw Error("offline_registry_invalid_policy");
  for(const role of ["reviewer","owner"] as const){
    const descriptor=data.policy[role];
    if(!descriptor||!text(descriptor.keyId,100)||
      typeof descriptor.publicKeySpkiPem!=="string"||
      descriptor.publicKeySpkiPem.length>3000||
      !isHash(descriptor.expectedPublicKeySha256)||
      data.disabledKeyIds.includes(descriptor.keyId))
      throw Error("offline_registry_missing_or_disabled_signer");
    const key=createPublicKey(descriptor.publicKeySpkiPem);
    if(key.asymmetricKeyType!=="ed25519"||
      hash(key.export({format:"der",type:"spki"}) as Buffer)!==
        descriptor.expectedPublicKeySha256)
      throw Error("offline_registry_signer_fingerprint_invalid");
  }
  if(data.policy.reviewer!.expectedPublicKeySha256===
    data.policy.owner!.expectedPublicKeySha256)
    throw Error("offline_registry_signer_roles_not_distinct");
  return data as OfflineRegistryDocument;
}
export type OfflineRegistryRequest={
  snapshotRoot:string;
  registryPath:string;
  /** Operator-provided PIN; MUST NOT be mistaken for trusted provisioning. */
  expectedRegistrySha256:string;
  review:OfflineBoundProposalRequest;
  reviewerReceipt:SignatureReceipt|null;
  ownerReceipt:SignatureReceipt|null;
};
/** Validates a file and bound Ed25519 receipts; never authenticates an owner. */
export function checkOfflineKeyRegistryReadiness(input:OfflineRegistryRequest){
  if(!input||!isHash(input.expectedRegistrySha256))
    return blocked("registry_pin_missing_or_invalid");
  let raw:Buffer;
  try{raw=readRegistryFile(input.registryPath,input.snapshotRoot);}
  catch(e){
    return blocked("separate_readonly_registry_not_acceptable:"+
      (e instanceof Error?e.message:"unknown"));
  }
  const sha256=hash(raw);
  if(sha256!==input.expectedRegistrySha256)
    return blocked("registry_bytes_do_not_match_supplied_pin",sha256);
  let registry:OfflineRegistryDocument;
  try{registry=parseCandidateRegistry(raw);}
  catch{return blocked("registry_structure_or_key_fingerprint_invalid",sha256);}
  const now=Date.now(),from=utc(registry.activatedAt)!,to=utc(registry.expiresAt)!;
  if(from>now||to<=now||to<=from||to-from>366*86400_000)
    return blocked("registry_not_active_or_expired",sha256);
  if(input.reviewerReceipt?.issuedAt&&
    (utc(input.reviewerReceipt.issuedAt)===null||
      utc(input.reviewerReceipt.issuedAt)!<from||
      utc(input.reviewerReceipt.issuedAt)!>to))
    return blocked("reviewer_receipt_outside_registry_validity",sha256);
  if(input.ownerReceipt?.issuedAt&&
    (utc(input.ownerReceipt.issuedAt)===null||
      utc(input.ownerReceipt.issuedAt)!<from||
      utc(input.ownerReceipt.issuedAt)!>to))
    return blocked("owner_receipt_outside_registry_validity",sha256);
  // PR #78 re-opens and validates selected note, SQLite and archived bytes.
  // This remains an unsigned and unprovisioned DRY RUN: a caller can forge
  // both this registry and the supposed expected pin, so no authorization.
  let verification:ReturnType<typeof verifyOfflineBoundSignedReview>;
  try{
    verification=verifyOfflineBoundSignedReview({
      packetRequest:input.review,policy:registry.policy,
      reviewerReceipt:input.reviewerReceipt,ownerReceipt:input.ownerReceipt,
    });
  }catch{
    return blocked("fresh_offline_note_or_source_recheck_failed",sha256);
  }
  const reviewer="reviewerSignatureMatchesSuppliedPolicy" in verification&&
    verification.reviewerSignatureMatchesSuppliedPolicy;
  const owner="ownerSignatureMatchesSuppliedPolicy" in verification&&
    verification.ownerSignatureMatchesSuppliedPolicy;
  const noProblems=verification.status===
    "cryptographic_consistency_only_no_authorization"&&reviewer&&owner;
  return {
    status:noProblems?
      "unprovisioned_registry_and_signatures_consistent_only" as const:
      "hold_for_independent_owner_enrollment" as const,
    reason:noProblems?"owner_key_enrollment_not_independently_proven":
      "reviewer_or_owner_signature_unmatched_to_candidate_registry",
    registryId:registry.registryId,registryRevision:registry.revision,
    registrySha256:sha256,
    offlineRegistryBytesMatchCallerPin:true as const,
    reviewerSignatureMatchesRegistry:Boolean(reviewer),
    ownerSignatureMatchesRegistry:Boolean(owner),
    freshPhysicalReviewPacketWasChecked: true as const,
    signedReviewSubjectSha256:
      "subjectSha256" in verification?verification.subjectSha256:null,
    independentOwnerIdentityVerified:false as const,
    outOfBandPinAuthenticated:false as const,
    ownerKeyProvisioningCompleted:false as const,
    durableReplayJournalVerified:false as const,
    revocationLedgerCompletenessVerified:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,canAutoUpdateThesis:false as const,
    safeEditPreview:null,vaultModified:false as const,
  };
}

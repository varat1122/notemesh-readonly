/**
 * Offline signature consistency for unapproved human review receipts.
 * No private keys, signing, filesystem, network, persisted audit ledger,
 * Safe Edit, owner authorization, or Production API.
 *
 * A supplied trust policy is NOT a provisioned owner identity. Even two valid
 * Ed25519 signatures grant no write rights. No mechanism for revocation or
 * durable one-time nonce consumption exists in this module.
 */
import {createHash,createPublicKey,verify as verifyCrypto} from "node:crypto";

const H=/^[0-9a-f]{64}$/;
const HEX_NONCE=/^[0-9a-f]{32,64}$/;
const MAX_HOURS=24*60*60*1000;
const hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const good=(v:unknown,max=300):v is string=>
  typeof v==="string"&&v.length>0&&v.length<=max&&
  v.trim().length>0&&!/[\r\n\0]/.test(v);
const SHA=(v:unknown):v is string=>typeof v==="string"&&H.test(v);

export type OfflineReviewSubject={
  scope:"offline_review_unapproved_v1";
  notePath:string;noteSha256:string;indexFingerprint:string;
  markdownManifestSha256:string;originalBlobSha256:string;
  sourceKeySha256:string;action:string;relationship:string;
  oldLineSha256:string;newLineSha256:string;rationaleSha256:string;
};
export type TrustedKeyDescriptor={
  keyId:string;publicKeySpkiPem:string;expectedPublicKeySha256:string;
};
export type OfflineReviewTrustPolicy={
  policyId:string;revision:number;
  reviewer:TrustedKeyDescriptor;owner:TrustedKeyDescriptor;
};
export type SignatureReceipt={
  schema:"investment_os_offline_review_receipt_v1";
  role:"reviewer"|"owner";keyId:string;
  subjectSha256:string;
  reviewReceiptSha256:string|null;
  issuedAt:string;expiresAt:string;nonce:string;
  decision:"reviewed_needs_owner"|"owner_consents_to_further_review";
  signatureBase64url:string;
};
const RFC3339=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
function stamp(value:string):number|null{
  if(!RFC3339.test(value))return null;
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))return null;
  const canon=new Date(ms).toISOString();
  if(value.includes("."))return canon===value.replace(/(\.\d{1,3})Z$/,(_,fraction:string)=>
    fraction.padEnd(4,"0").slice(0,4).replace(/0+$/,"")+"Z")?ms:
    // String comparison for 1/2/3-digit milliseconds after normalization.
    new Date(ms).toISOString().startsWith(value.slice(0,-1))?ms:null;
  return canon.slice(0,19)+"Z"===value?ms:null;
}
function pathAllowed(v:string):boolean{
  return good(v,350)&&v.endsWith(".md")&&!v.startsWith("/")&&
    !v.includes("\\")&&!v.split("/").some(x=>!x||x==="."||x===".."||x.startsWith("."))&&
    !/^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i.test(v)&&
    !/(?:^|\/)[^/]*(?:current[\s_-]*thesis|evidence[\s_-]*register|portfolio)[^/]*\.md$/i.test(v);
}
/** Deterministic exact field order, domain separated, no user-supplied JSON. */
export function digestOfflineReviewSubject(s:OfflineReviewSubject):string {
  if(s.scope!=="offline_review_unapproved_v1"||!pathAllowed(s.notePath)||
    ![s.noteSha256,s.indexFingerprint,s.markdownManifestSha256,
      s.originalBlobSha256,s.sourceKeySha256,s.oldLineSha256,
      s.newLineSha256,s.rationaleSha256].every(SHA)||
    !good(s.action,100)||!good(s.relationship,100))
    throw Error("offline_signed_review_invalid_subject");
  return hash(JSON.stringify([
    "investment-os-offline-human-subject-v1",s.scope,s.notePath,
    s.noteSha256,s.indexFingerprint,s.markdownManifestSha256,
    s.originalBlobSha256,s.sourceKeySha256,s.action,s.relationship,
    s.oldLineSha256,s.newLineSha256,s.rationaleSha256,
  ]));
}
/** Exposed for independent signing on a separate trusted workstation.
 * The application NEVER handles a private key.
 */
export function offlineReviewSigningBytes(r:Omit<SignatureReceipt,"signatureBase64url">):Buffer{
  return Buffer.from(JSON.stringify([
    "investment-os-offline-review-ed25519-v1",r.schema,r.role,r.keyId,
    r.subjectSha256,r.reviewReceiptSha256,r.issuedAt,r.expiresAt,
    r.nonce,r.decision,
  ]),"utf8");
}
export function offlineSignedReceiptDigest(r:SignatureReceipt):string{
  return hash(Buffer.concat([offlineReviewSigningBytes(r),
    Buffer.from("\n"+r.signatureBase64url,"utf8")]));
}
function policyKeys(policy:OfflineReviewTrustPolicy){
  if(!policy||!good(policy.policyId,100)||
    !Number.isSafeInteger(policy.revision)||policy.revision<1)
    throw Error("offline_review_policy_invalid");
  const keys=[policy.reviewer,policy.owner];
  if(keys.some(k=>!k||!good(k.keyId,100)||
    !(typeof k.publicKeySpkiPem==="string"&&
      k.publicKeySpkiPem.length<3000&&
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n?$/.test(k.publicKeySpkiPem))||
    !SHA(k.expectedPublicKeySha256))||
    policy.reviewer.keyId===policy.owner.keyId||
    policy.reviewer.expectedPublicKeySha256===policy.owner.expectedPublicKeySha256)
    throw Error("offline_review_policy_roles_not_distinct");
  const out=keys.map(k=>{
    const key=createPublicKey(k.publicKeySpkiPem);
    if(key.asymmetricKeyType!=="ed25519")throw Error("offline_review_key_not_ed25519");
    const actual=hash(key.export({format:"der",type:"spki"}) as Buffer);
    if(actual!==k.expectedPublicKeySha256)
      throw Error("offline_review_key_fingerprint_mismatch");
    return key;
  });
  const policySha256=hash(JSON.stringify([
    "investment-os-offline-trust-policy-v1",policy.policyId,policy.revision,
    policy.reviewer.keyId,policy.reviewer.expectedPublicKeySha256,
    policy.owner.keyId,policy.owner.expectedPublicKeySha256,
  ]));
  return {reviewer:out[0],owner:out[1],policySha256};
}
function verifyReceipt(r:SignatureReceipt|undefined,
  role:"reviewer"|"owner",keyId:string,
  subjectDigest:string,linkedReview:string|null,
  now:number,key:ReturnType<typeof createPublicKey>):string|null{
  if(!r||r.schema!=="investment_os_offline_review_receipt_v1"||
    r.role!==role||r.keyId!==keyId||r.subjectSha256!==subjectDigest||
    r.reviewReceiptSha256!==linkedReview||
    r.decision!==(role==="reviewer"?"reviewed_needs_owner":
      "owner_consents_to_further_review")||
    !good(r.keyId,100)||!SHA(r.subjectSha256)||
    !good(r.nonce,64)||!HEX_NONCE.test(r.nonce)||
    !good(r.signatureBase64url,200)||
    !/^[A-Za-z0-9_-]{86}$/.test(r.signatureBase64url))
    return "invalid_"+role+"_receipt_fields_or_binding";
  const start=stamp(r.issuedAt),end=stamp(r.expiresAt);
  if(start===null||end===null||start>now+5*60_000||
    end<=now||end<=start||end-start>MAX_HOURS)
    return "invalid_"+role+"_receipt_time_or_expiry";
  const payload=offlineReviewSigningBytes(r);
  try{
    const signature=Buffer.from(r.signatureBase64url,"base64url");
    if(signature.length!==64||!verifyCrypto(null,payload,key,signature))
      return "invalid_"+role+"_signature";
  }catch{return "invalid_"+role+"_signature";}
  return null;
}
export function verifyOfflineSignedReviewReceipts(input:{
  subject:OfflineReviewSubject;
  policy:OfflineReviewTrustPolicy;
  reviewerReceipt:SignatureReceipt|null;
  ownerReceipt:SignatureReceipt|null;
}){
  const findings:string[]=[];
  let subjectSha256:string|null=null;
  try{subjectSha256=digestOfflineReviewSubject(input.subject);}
  catch{findings.push("invalid_bound_subject");}
  let keys:ReturnType<typeof policyKeys>|null=null;
  try{keys=policyKeys(input.policy);}
  catch{findings.push("invalid_or_untrusted_configured_key_policy");}
  const currentTime=Date.now(); // no caller-supplied rollback clock
  let reviewValid=false,ownerValid=false,reviewDigest:string|null=null;
  if(subjectSha256&&keys){
    const reviewError=verifyReceipt(input.reviewerReceipt??undefined,"reviewer",
      input.policy.reviewer.keyId,subjectSha256,null,currentTime,keys.reviewer);
    if(reviewError)findings.push(reviewError);
    else{
      reviewValid=true;
      reviewDigest=offlineSignedReceiptDigest(input.reviewerReceipt!);
    }
    if(input.ownerReceipt){
      if(!reviewValid)findings.push("owner_receipt_requires_valid_reviewer_receipt");
      else{
        const ownerError=verifyReceipt(input.ownerReceipt,"owner",
          input.policy.owner.keyId,subjectSha256,reviewDigest,currentTime,keys.owner);
        if(ownerError)findings.push(ownerError);
        else if(input.ownerReceipt.nonce===input.reviewerReceipt!.nonce)
          findings.push("owner_and_reviewer_nonce_collision");
        else if(Date.parse(input.ownerReceipt.issuedAt)<
          Date.parse(input.reviewerReceipt!.issuedAt))
          findings.push("owner_receipt_predates_reviewer_receipt");
        else ownerValid=true;
      }
    }else findings.push("owner_receipt_not_supplied");
  }
  const auditEntries: Array<{step:number;kind:string;previousDigest:string;
    referenceDigest:string;digest:string}>=[];
  let prev="0".repeat(64);
  for(const [kind,receipt] of [
    ["reviewer",reviewValid?input.reviewerReceipt:null],
    ["owner",ownerValid?input.ownerReceipt:null],
  ] as const){
    if(!receipt)continue;
    const referenceDigest=offlineSignedReceiptDigest(receipt);
    const step=auditEntries.length+1;
    const entryDigest=hash(JSON.stringify([
      "investment-os-unsaved-review-audit-v1",step,kind,prev,referenceDigest,
      subjectSha256,
    ]));
    auditEntries.push({step,kind,previousDigest:prev,referenceDigest,
      digest:entryDigest});
    prev=entryDigest;
  }
  return {
    status:findings.length?"hold_for_offline_human_review" as const:
      "cryptographic_consistency_only_no_authorization" as const,
    subjectSha256,trustPolicySha256:keys?.policySha256??null,
    reviewerSignatureMatchesSuppliedPolicy:reviewValid,
    ownerSignatureMatchesSuppliedPolicy:ownerValid,
    findings,unsavedAuditChain:auditEntries,
    auditHeadDigest:auditEntries.length?prev:null,
    // The supplied policy is NOT authenticated against an independent
    // owner-provisioned trust anchor. Signatures prove only key possession.
    trustedPolicyProvisionedIndependently:false as const,
    reviewerIdentityAuthenticated:false as const,
    ownerIdentityAuthenticated:false as const,
    replayProtectionEnforced:false as const,
    keyRevocationChecked:false as const,
    trustedClockAttested:false as const,
    auditLogPersisted:false as const,
    auditLogImmutable:false as const,
    claimIndependentlyVerified:false as const,
    ownerApprovalGranted:false as const,
    safeEditPreview:null,canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    vaultModified:false as const,
  };
}

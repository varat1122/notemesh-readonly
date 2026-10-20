import {describe,it,expect} from "vitest";
import {generateKeyPairSync,createHash,sign as signBytes} from "node:crypto";
import {
  digestOfflineReviewSubject,offlineReviewSigningBytes,offlineSignedReceiptDigest,
  verifyOfflineSignedReviewReceipts,
  type SignatureReceipt,type OfflineReviewSubject,type OfflineReviewTrustPolicy,
} from "./offline-review-signature-gate";

const sha=(x:string|Buffer)=>createHash("sha256").update(x).digest("hex");
const makePair=()=>{
  const kp=generateKeyPairSync("ed25519");
  return {
    publicKeySpkiPem:kp.publicKey.export({format:"pem",type:"spki"}).toString(),
    expectedPublicKeySha256:sha(kp.publicKey.export({format:"der",type:"spki"}) as Buffer),
    privateKey:kp.privateKey,
  };
};
const reviewer=makePair(),owner=makePair(),stranger=makePair();
const policy:OfflineReviewTrustPolicy={
  policyId:"synthetic-offline-insecure-trust-anchor",revision:1,
  reviewer:{keyId:"reviewer-key",publicKeySpkiPem:reviewer.publicKeySpkiPem,
    expectedPublicKeySha256:reviewer.expectedPublicKeySha256},
  owner:{keyId:"owner-key",publicKeySpkiPem:owner.publicKeySpkiPem,
    expectedPublicKeySha256:owner.expectedPublicKeySha256},
};
const subject:OfflineReviewSubject={
  scope:"offline_review_unapproved_v1",
  notePath:"10_Knowledge/Company Research/SYNTH - Review.md",
  noteSha256:sha("note"),indexFingerprint:sha("sqlite-index"),
  markdownManifestSha256:sha("physical-markdown-manifest"),
  originalBlobSha256:sha("stored-source-blob"),
  sourceKeySha256:sha("url-source-key"),sourceRevision:1,
  action:"metadata_correction_candidate",relationship:"added_detail",
  oldLineSha256:sha("old"),newLineSha256:sha("new"),
  rationaleSha256:sha("draft rationale only"),
};
const iso=(diffMs:number)=>new Date(Date.now()+diffMs).toISOString().replace(/\.\d{3}Z$/,"Z");
function signed(role:"reviewer"|"owner",
  subjectSha256=digestOfflineReviewSubject(subject),
  linked:string|null=null):SignatureReceipt {
  const r:SignatureReceipt={
    schema:"investment_os_offline_review_receipt_v1",role,
    keyId:role==="reviewer"?"reviewer-key":"owner-key",
    subjectSha256,reviewReceiptSha256:linked,
    issuedAt:iso(role==="reviewer"?-120_000:-60_000),
    expiresAt:iso(30*60_000),
    nonce:role==="reviewer"?"1".repeat(32):"2".repeat(32),
    decision:role==="reviewer"?"reviewed_needs_owner":
      "owner_consents_to_further_review",
    signatureBase64url:"",
  };
  r.signatureBase64url=signBytes(null,offlineReviewSigningBytes(r),
    role==="reviewer"?reviewer.privateKey:owner.privateKey).toString("base64url");
  return r;
}
const bundle=()=>{
  const r=signed("reviewer");
  return {subject,policy,reviewerReceipt:r,
    ownerReceipt:signed("owner",digestOfflineReviewSubject(subject),
      offlineSignedReceiptDigest(r))};
};
describe("PR #79 detached review signatures: never a Vault authorization",()=>{
  it("cryptographically matches two distinct configured roles and builds UNSAVED chain",()=>{
    const x=bundle(),before=structuredClone(x);
    const r=verifyOfflineSignedReviewReceipts(x);
    expect(r).toMatchObject({
      status:"cryptographic_consistency_only_no_authorization",
      reviewerSignatureMatchesSuppliedPolicy:true,
      ownerSignatureMatchesSuppliedPolicy:true,
      trustedPolicyProvisionedIndependently:false,
      reviewerIdentityAuthenticated:false,ownerIdentityAuthenticated:false,
      replayProtectionEnforced:false,keyRevocationChecked:false,
      trustedClockAttested:false,auditLogPersisted:false,
      auditLogImmutable:false,ownerApprovalGranted:false,
      canAutoWrite:false,canAutoUpdateThesis:false,
      safeEditPreview:null,vaultModified:false,
      findings:[],
    });
    expect(r.unsavedAuditChain).toHaveLength(2);
    expect(r.unsavedAuditChain[0].previousDigest).toBe("0".repeat(64));
    expect(r.unsavedAuditChain[1].previousDigest)
      .toBe(r.unsavedAuditChain[0].digest);
    expect(r.auditHeadDigest).toBe(r.unsavedAuditChain[1].digest);
    expect(x).toEqual(before);
  });
  it("never treats reviewer-only signature as owner authorization",()=>{
    const x=bundle();
    const r=verifyOfflineSignedReviewReceipts({...x,ownerReceipt:null});
    expect(r.reviewerSignatureMatchesSuppliedPolicy).toBe(true);
    expect(r.ownerSignatureMatchesSuppliedPolicy).toBe(false);
    expect(r.findings).toContain("owner_receipt_not_supplied");
    expect(r.ownerApprovalGranted).toBe(false);
  });
  it("rejects forged signature, altered role and swapped keys",()=>{
    const x=bundle();
    x.reviewerReceipt.signatureBase64url=signBytes(
      null,offlineReviewSigningBytes(x.reviewerReceipt),
      stranger.privateKey).toString("base64url");
    const r=verifyOfflineSignedReviewReceipts(x);
    expect(r.status).toBe("hold_for_offline_human_review");
    expect(r.findings).toContain("invalid_reviewer_signature");
    expect(r.ownerSignatureMatchesSuppliedPolicy).toBe(false);
    const y=bundle();
    y.ownerReceipt.keyId="reviewer-key";
    expect(verifyOfflineSignedReviewReceipts(y).status).toBe("hold_for_offline_human_review");
  });
  it("rejects replay against changed note, source, index or candidate",()=>{
    const x=bundle();
    for(const field of ["noteSha256","originalBlobSha256","indexFingerprint",
      "newLineSha256","markdownManifestSha256"] as const){
      const altered={...subject,[field]:sha("unexpected "+field)};
      const r=verifyOfflineSignedReviewReceipts({...x,subject:altered});
      expect(r.status,field).toBe("hold_for_offline_human_review");
      expect(r.findings,field).toContain("invalid_reviewer_receipt_fields_or_binding");
    }
  });
  it("rejects replay after a different registered source revision",()=>{
    const x=bundle();
    const changed=verifyOfflineSignedReviewReceipts({
      ...x,subject:{...subject,sourceRevision:2},
    });
    expect(changed.status).toBe("hold_for_offline_human_review");
    expect(changed.ownerApprovalGranted).toBe(false);
  });
  it("rejects tampered owner receipt linkage, owner before reviewer and nonce reuse",()=>{
    const x=bundle();
    x.ownerReceipt.reviewReceiptSha256=sha("wrong review receipt");
    expect(verifyOfflineSignedReviewReceipts(x).ownerSignatureMatchesSuppliedPolicy).toBe(false);
    const y=bundle();y.ownerReceipt.nonce=y.reviewerReceipt.nonce;
    y.ownerReceipt.signatureBase64url=signBytes(null,
      offlineReviewSigningBytes(y.ownerReceipt),owner.privateKey).toString("base64url");
    expect(verifyOfflineSignedReviewReceipts(y).findings)
      .toContain("owner_and_reviewer_nonce_collision");
    const z=bundle();z.ownerReceipt.issuedAt=iso(-180_000);
    z.ownerReceipt.signatureBase64url=signBytes(null,
      offlineReviewSigningBytes(z.ownerReceipt),owner.privateKey).toString("base64url");
    expect(verifyOfflineSignedReviewReceipts(z).findings)
      .toContain("owner_receipt_predates_reviewer_receipt");
  });
  it("rejects expiry and future-dated signatures even when correctly signed",()=>{
    const x=bundle();x.reviewerReceipt.expiresAt=iso(-5000);
    x.reviewerReceipt.signatureBase64url=signBytes(null,
      offlineReviewSigningBytes(x.reviewerReceipt),reviewer.privateKey).toString("base64url");
    expect(verifyOfflineSignedReviewReceipts(x).findings)
      .toContain("invalid_reviewer_receipt_time_or_expiry");
    const y=bundle();y.reviewerReceipt.issuedAt=iso(600_000);
    y.reviewerReceipt.signatureBase64url=signBytes(null,
      offlineReviewSigningBytes(y.reviewerReceipt),reviewer.privateKey).toString("base64url");
    expect(verifyOfflineSignedReviewReceipts(y).findings)
      .toContain("invalid_reviewer_receipt_time_or_expiry");
  });
  it("fails closed on invalid/same role trust key policy and protected paths",()=>{
    const x=bundle();
    const same={...policy,owner:{...policy.reviewer}};
    expect(verifyOfflineSignedReviewReceipts({...x,policy:same}).findings)
      .toContain("invalid_or_untrusted_configured_key_policy");
    const wrong={...policy,owner:{...policy.owner,
      expectedPublicKeySha256:"f".repeat(64)}};
    expect(verifyOfflineSignedReviewReceipts({...x,policy:wrong}).findings)
      .toContain("invalid_or_untrusted_configured_key_policy");
    for(const notePath of ["05_Thesis/NVDA - Current Thesis.md",
      "06_Portfolio/holdings.md","../outside.md"]){
      expect(verifyOfflineSignedReviewReceipts({
        ...x,subject:{...subject,notePath},
      }).findings).toContain("invalid_bound_subject");
    }
  });
});

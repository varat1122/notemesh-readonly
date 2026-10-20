import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync,sign as signBytes} from "node:crypto";
import {
  offlineReviewSigningBytes,offlineSignedReceiptDigest,
  type SignatureReceipt,type OfflineReviewTrustPolicy,
} from "./offline-review-signature-gate";

let live:string,snapshot:string,vault:string;
const selected="10_Knowledge/Company Research/SYNTH - Review.md";
const original=Buffer.from("<html><body>Synthetic original bytes (not verified issuer data)</body></html>");
const url="https://example.org/synthetic/issuer";
const sha=(x:string|Buffer)=>createHash("sha256").update(x).digest("hex");
const content=()=>[
  "---","type: research_note","source_type: primary",
  "verification: not_reverified","original_source: "+url,
  "original_source_sha256: '"+sha(original)+"'",
  "event_key: SYNTH-2026Q2",
  "event_date: '2026-07-25'",
  "published_at: '2026-07-26T10:00:00Z'",
  "imported_at: '2026-07-27T10:00:00Z'",
  "verified_at: '2026-07-28T10:00:00Z'",
  "---","# Synthetic historical claim",
  "Old synthetic claim: 10.","",
].join("\n");
const pair=()=>{
  const p=generateKeyPairSync("ed25519");
  return {privateKey:p.privateKey,
    pem:p.publicKey.export({type:"spki",format:"pem"}).toString(),
    sha:sha(p.publicKey.export({type:"spki",format:"der"}) as Buffer)};
};
const reviewer=pair(),owner=pair();
const policy:OfflineReviewTrustPolicy={
  policyId:"test-only-untrusted-policy",revision:1,
  reviewer:{keyId:"test-reviewer",publicKeySpkiPem:reviewer.pem,
    expectedPublicKeySha256:reviewer.sha},
  owner:{keyId:"test-owner",publicKeySpkiPem:owner.pem,
    expectedPublicKeySha256:owner.sha},
};
function date(minutes:number){
  return new Date(Date.now()+minutes*60000).toISOString().replace(/\.\d{3}Z$/,"Z");
}
function sign(role:"reviewer"|"owner",subjectHash:string,ref:string|null){
  const r:SignatureReceipt={
    schema:"investment_os_offline_review_receipt_v1",role,
    keyId:role==="reviewer"?"test-reviewer":"test-owner",
    subjectSha256:subjectHash,reviewReceiptSha256:ref,
    issuedAt:date(role==="reviewer"?-2:-1),expiresAt:date(30),
    nonce:role==="reviewer"?"4".repeat(32):"5".repeat(32),
    decision:role==="reviewer"?"reviewed_needs_owner":
      "owner_consents_to_further_review",signatureBase64url:"",
  };
  r.signatureBase64url=signBytes(null,offlineReviewSigningBytes(r),
    role==="reviewer"?reviewer.privateKey:owner.privateKey).toString("base64url");
  return r;
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-sign-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-sign-detached-")));
  vault=path.join(live,"vault");fs.mkdirSync(path.dirname(path.join(vault,selected)),{recursive:true});
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(live,{recursive:true,force:true});
  fs.rmSync(snapshot,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
});
async function prep(){
  fs.writeFileSync(path.join(vault,selected),content());
  const {captureOriginalDocumentBytes}=await import("../research-source-archive");
  captureOriginalDocumentBytes({
    originalSource:url,bytes:original,contentType:"text/html",
    capturedAt:"2026-10-20T01:00:00Z",captureMethod:"authorized_external_download",
    retrievedFrom:url,reviewerOrOperator:"test-only",
  });
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");await db().backup(path.join(snapshot,"app.sqlite"));
  fs.cpSync(path.join(live,"source-archive"),path.join(snapshot,"source-archive"),
    {recursive:true,preserveTimestamps:true});
}
const request=()=>({
  snapshotRoot:snapshot,notePath:selected,
  expectedNoteSha256:sha(fs.readFileSync(path.join(snapshot,"vault",selected))),
  action:"metadata_correction_candidate" as const,
  reviewRationale:"Synthetic note requires separate human/owner evidence review",
  relationship:"new_event" as const,
  oldLine:"Old synthetic claim: 10.",newLine:"Proposed synthetic claim: 12.",
});
describe("PR #79 signatures bound to PR #78 detached physical readback",()=>{
  it("binds both signatures to one offline packet without granting actual owner authorization",async()=>{
    await prep();
    const {prepareOfflineBoundSignatureSubject,verifyOfflineBoundSignedReview}
      =await import("./offline-review-signature-bridge");
    const req=request();
    const first=prepareOfflineBoundSignatureSubject(req);
    expect(first.status).toBe("detached_subject_unapproved");
    expect(first.subjectSha256).toMatch(/^[a-f0-9]{64}$/);
    const review=sign("reviewer",first.subjectSha256!,null);
    const signedOwner=sign("owner",first.subjectSha256!,
      offlineSignedReceiptDigest(review));
    const result=verifyOfflineBoundSignedReview({
      packetRequest:req,policy,reviewerReceipt:review,ownerReceipt:signedOwner,
    });
    expect(result).toMatchObject({
      status:"cryptographic_consistency_only_no_authorization",
      reviewerSignatureMatchesSuppliedPolicy:true,
      ownerSignatureMatchesSuppliedPolicy:true,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,vaultModified:false,
    });
    expect("unsavedAuditChain" in result&&result.unsavedAuditChain).toHaveLength(2);
  });
  it("rejects stale exact note hash and changed proposal after signature",async()=>{
    await prep();
    const {prepareOfflineBoundSignatureSubject,verifyOfflineBoundSignedReview}
      =await import("./offline-review-signature-bridge");
    const req=request();
    const subj=prepareOfflineBoundSignatureSubject(req);
    const review=sign("reviewer",subj.subjectSha256!,null);
    const ownerSig=sign("owner",subj.subjectSha256!,
      offlineSignedReceiptDigest(review));
    const changed={...req,newLine:"Different unapproved change."};
    const altered=verifyOfflineBoundSignedReview({
      packetRequest:changed,policy,reviewerReceipt:review,ownerReceipt:ownerSig,
    });
    expect(altered.status).toBe("hold_for_offline_human_review");
    expect(altered.ownerApprovalGranted).toBe(false);
    expect(()=>verifyOfflineBoundSignedReview({
      packetRequest:{...req,expectedNoteSha256:"0".repeat(64)},
      policy,reviewerReceipt:review,ownerReceipt:ownerSig,
    })).toThrow("offline_review_expected_note_hash_changed_hold");
  });
  it("rejects source byte corruption, and refuses live or Railway paths",async()=>{
    await prep();
    const {prepareOfflineBoundSignatureSubject}=await import("./offline-review-signature-bridge");
    const blob=path.join(snapshot,"source-archive","blobs",
      sha(original).slice(0,2),sha(original)+".bin");
    fs.writeFileSync(blob,Buffer.alloc(original.length,0x41));
    const p=prepareOfflineBoundSignatureSubject(request());
    expect(p.status).toBe("source_bound_review_packet_hold");
    expect(p.ownerApprovalGranted).toBe(false);
    expect(()=>prepareOfflineBoundSignatureSubject({...request(),
      snapshotRoot:live})).toThrow("snapshot_acceptance_live_data_directory_refused");
    process.env.RAILWAY_PROJECT_ID="synthetic-refusal";
    expect(()=>prepareOfflineBoundSignatureSubject(request()))
      .toThrow("snapshot_acceptance_refused_inside_railway_runtime");
  });
});

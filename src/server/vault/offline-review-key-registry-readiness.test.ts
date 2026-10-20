import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync,sign as signBytes} from "node:crypto";
import {
  type OfflineRegistryDocument,checkOfflineKeyRegistryReadiness,
} from "./offline-review-key-registry-readiness";
import {
  offlineReviewSigningBytes,offlineSignedReceiptDigest,
  type OfflineReviewTrustPolicy,type SignatureReceipt,
} from "./offline-review-signature-gate";

const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
const key=()=>{const k=generateKeyPairSync("ed25519");return {
  pem:k.publicKey.export({format:"pem",type:"spki"}).toString(),
  fingerprint:sha(k.publicKey.export({format:"der",type:"spki"}) as Buffer),
  privateKey:k.privateKey,
}};
const reviewer=key(),owner=key();
const policy:OfflineReviewTrustPolicy={
  policyId:"synthetic-review-only",revision:1,
  reviewer:{keyId:"fixture-reviewer",publicKeySpkiPem:reviewer.pem,
    expectedPublicKeySha256:reviewer.fingerprint},
  owner:{keyId:"fixture-owner",publicKeySpkiPem:owner.pem,
    expectedPublicKeySha256:owner.fingerprint},
};
const stamp=(deltaMinutes:number)=>
  new Date(Date.now()+deltaMinutes*60_000).toISOString().replace(/\.\d{3}Z$/,"Z");
let live:string,snapshot:string,registryRoot:string,registryPath:string;
const note="10_Knowledge/Company Research/SYNTH - Offline Review.md";
const url="https://example.org/review/synthetic-issuer";
const bytes=Buffer.from("<html>Synthetic fixture: no issuer verification or real claim</html>");
const noteText=()=>[
  "---","type: research_note","source_type: primary",
  "verification: not_reverified",
  "original_source: "+url,
  "original_source_sha256: '"+sha(bytes)+"'",
  "event_key: SYNTH-2026H1","---",
  "# Synthetic research","Old fictional fact: 10.","",
].join("\n");
const registry=():OfflineRegistryDocument=>({
  schema:"investment_os_offline_review_key_registry_v1",
  registryId:"synthetic-registry-not-owner-provisioned",revision:1,
  activatedAt:stamp(-60),expiresAt:stamp(60*24),
  disabledKeyIds:[],policy,
});
function putRegistry(reg=registry()){
  fs.writeFileSync(registryPath,JSON.stringify(reg),{mode:0o600});
  return sha(fs.readFileSync(registryPath));
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-key-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-key-snapshot-")));
  registryRoot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-key-registry-")));
  registryPath=path.join(registryRoot,"registry.json");
  fs.mkdirSync(path.join(live,"vault",...note.split("/").slice(0,-1)),{recursive:true});
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const d of [live,snapshot,registryRoot])
    fs.rmSync(d,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function makeSnapshot(){
  fs.writeFileSync(path.join(live,"vault",note),noteText());
  const {captureOriginalDocumentBytes}=await import("../research-source-archive");
  captureOriginalDocumentBytes({
    originalSource:url,bytes,contentType:"text/html",
    capturedAt:"2026-10-20T01:00:00Z",
    captureMethod:"authorized_external_download",
    retrievedFrom:url,reviewerOrOperator:"fixture-only",
  });
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(path.join(live,"vault"),path.join(snapshot,"vault"),
    {recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");await db().backup(path.join(snapshot,"app.sqlite"));
  fs.cpSync(path.join(live,"source-archive"),path.join(snapshot,"source-archive"),
    {recursive:true,preserveTimestamps:true});
}
function reviewReq(){
  return {
    snapshotRoot:snapshot,notePath:note,
    expectedNoteSha256:sha(fs.readFileSync(path.join(snapshot,"vault",note))),
    action:"metadata_correction_candidate" as const,
    reviewRationale:"Synthetic source review, unapproved",
    relationship:"added_detail" as const,
    oldLine:"Old fictional fact: 10.",
    newLine:"Proposed fictional fact: 12.",
  };
}
function sign(role:"reviewer"|"owner",subject:string,linked:string|null){
  const r:SignatureReceipt={
    schema:"investment_os_offline_review_receipt_v1",
    role,keyId:role==="reviewer"?"fixture-reviewer":"fixture-owner",
    subjectSha256:subject,reviewReceiptSha256:linked,
    issuedAt:stamp(role==="reviewer"?-2:-1),expiresAt:stamp(45),
    nonce:role==="reviewer"?"1".repeat(32):"2".repeat(32),
    decision:role==="reviewer"?"reviewed_needs_owner":
      "owner_consents_to_further_review",signatureBase64url:"",
  };
  r.signatureBase64url=signBytes(null,offlineReviewSigningBytes(r),
    role==="reviewer"?reviewer.privateKey:owner.privateKey).toString("base64url");
  return r;
}
async function setupSigned(){
  await makeSnapshot();
  const {prepareOfflineBoundSignatureSubject}=await import("./offline-review-signature-bridge");
  const review=reviewReq(),subj=prepareOfflineBoundSignatureSubject(review);
  if(!subj.subjectSha256)throw Error("cannot build synthetic bound packet");
  const signedReviewer=sign("reviewer",subj.subjectSha256,null);
  const signedOwner=sign("owner",subj.subjectSha256,
    offlineSignedReceiptDigest(signedReviewer));
  return {review,reviewerReceipt:signedReviewer,ownerReceipt:signedOwner};
}
describe("PR #80: offline registry commissioning rehearsal - not owner authentication",()=>{
  it("matches physical registry bytes and 2 signatures, but never authorizes Vault",async()=>{
    const signed=await setupSigned(),pin=putRegistry();
    const registryBefore=fs.readFileSync(registryPath);
    const noteBefore=fs.readFileSync(path.join(snapshot,"vault",note));
    const {checkOfflineKeyRegistryReadiness}=await import("./offline-review-key-registry-readiness");
    const r=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:pin,...signed,
    });
    expect(r).toMatchObject({
      status:"unprovisioned_registry_and_signatures_consistent_only",
      offlineRegistryBytesMatchCallerPin:true,
      reviewerSignatureMatchesRegistry:true,
      ownerSignatureMatchesRegistry:true,
      independentOwnerIdentityVerified:false,outOfBandPinAuthenticated:false,
      ownerKeyProvisioningCompleted:false,durableReplayJournalVerified:false,
      revocationLedgerCompletenessVerified:false,
      ownerApprovalGranted:false,canAutoWrite:false,canAutoUpdateThesis:false,
      safeEditPreview:null,vaultModified:false,
    });
    expect(fs.readFileSync(registryPath)).toEqual(registryBefore);
    expect(fs.readFileSync(path.join(snapshot,"vault",note))).toEqual(noteBefore);
  });
  it("holds on forged caller pin, modified registry, revoked owner and expired registry",async()=>{
    const signed=await setupSigned(),pin=putRegistry();
    const fn=(p:string)=>checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:p,...signed,
    });
    expect(fn("f".repeat(64)).reason).toBe("registry_bytes_do_not_match_supplied_pin");
    const disabled={...registry(),disabledKeyIds:["fixture-owner"]};
    expect(fn(putRegistry(disabled)).reason).toBe("registry_structure_or_key_fingerprint_invalid");
    const expired={...registry(),activatedAt:stamp(-120),expiresAt:stamp(-10)};
    expect(fn(putRegistry(expired)).reason).toBe("registry_not_active_or_expired");
    expect(pin).toMatch(/^[a-f0-9]{64}$/);
  });
  it("holds when note edit changed, owner receipt missing, and policy keys replaced",async()=>{
    const signed=await setupSigned(),pin=putRegistry();
    const changed={...signed,review:{...signed.review,newLine:"Another proposed value"}};
    const r=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:pin,...changed,
    });
    expect(r.status).toBe("hold_for_independent_owner_enrollment");
    expect(r.ownerApprovalGranted).toBe(false);
    const noOwner=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:pin,
      ...signed,ownerReceipt:null,
    });
    expect(noOwner.ownerSignatureMatchesRegistry).toBe(false);
    expect(noOwner.status).toBe("hold_for_independent_owner_enrollment");
  });
  it("does not read registry under live DATA_DIR or segregated snapshot",async()=>{
    const signed=await setupSigned(),pin=putRegistry();
    const underLive=path.join(live,"fake.json");
    fs.copyFileSync(registryPath,underLive);fs.chmodSync(underLive,0o600);
    const r=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath:underLive,expectedRegistrySha256:pin,...signed,
    });
    expect(r.reason).toContain("offline_registry_cannot_live_inside_vault_or_snapshot");
    const underSnapshot=path.join(snapshot,"fake.json");
    fs.copyFileSync(registryPath,underSnapshot);fs.chmodSync(underSnapshot,0o600);
    const q=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath:underSnapshot,
      expectedRegistrySha256:pin,...signed,
    });
    expect(q.status).toBe("hold_for_independent_owner_enrollment");
  });
  it("rejects registry path symlink, world-writable registry and Railway runtime",async()=>{
    const signed=await setupSigned(),pin=putRegistry();
    const link=path.join(registryRoot,"symlink.json");
    fs.symlinkSync(registryPath,link);
    const x=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath:link,expectedRegistrySha256:pin,...signed,
    });
    expect(x.reason).toContain("offline_registry_symlink_path_hold");
    fs.chmodSync(registryPath,0o666);
    const y=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:pin,...signed,
    });
    expect(y.reason).toContain("offline_registry_unsafe_permissions_or_file");
    fs.chmodSync(registryPath,0o600);
    process.env.RAILWAY_PROJECT_ID="synthetic-railway";
    const z=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:pin,...signed,
    });
    expect(z.reason).toContain("offline_registry_refused_inside_railway_runtime");
  });
  it("refuses corrupted registered original bytes even with consistent registry",async()=>{
    const signed=await setupSigned(),pin=putRegistry();
    const blob=path.join(snapshot,"source-archive","blobs",
      sha(bytes).slice(0,2),sha(bytes)+".bin");
    fs.writeFileSync(blob,Buffer.alloc(bytes.length,0x61));
    const r=checkOfflineKeyRegistryReadiness({
      snapshotRoot:snapshot,registryPath,expectedRegistrySha256:pin,...signed,
    });
    expect(r.status).toBe("hold_for_independent_owner_enrollment");
    expect(r.ownerApprovalGranted).toBe(false);
  });
});

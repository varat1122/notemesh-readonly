import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const sourceUrl="https://www.sec.gov/Archives/edgar/data/12345/mu-fy2027-guidance.htm";
const text="<html><body>Micron FY2027 revenue growth guidance: +20% YoY (synthetic fixture only).</body></html>";
const excerpt="FY2027 revenue growth guidance: +20% YoY";
const operator="admin:synthetic-operator";
let root:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"m551-primary-")));
  fs.mkdirSync(path.join(root,"vault"),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  process.env.PRIMARY_EVIDENCE_ISSUANCE_ENABLED="1";
  vi.resetModules();
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  for(const key of ["DATA_DIR","PRIMARY_EVIDENCE_SIGNERS_JSON","PRIMARY_EVIDENCE_ISSUANCE_ENABLED"])
    delete process.env[key];
});
async function fixture(manual=false){
  const reviewer=crypto.generateKeyPairSync("ed25519"),approver=crypto.generateKeyPairSync("ed25519");
  process.env.PRIMARY_EVIDENCE_SIGNERS_JSON=JSON.stringify([
    {keyId:"evidence-reviewer",role:"reviewer",publicKeyPem:reviewer.publicKey.export({format:"pem",type:"spki"}).toString()},
    {keyId:"evidence-approver",role:"approver",publicKeyPem:approver.publicKey.export({format:"pem",type:"spki"}).toString()}
  ]);
  const {captureOriginalDocumentBytes}=await import("../research-source-archive");
  const capturedAt=new Date(Date.now()-10*60*1000).toISOString();
  const snapshot=captureOriginalDocumentBytes({
    originalSource:sourceUrl,bytes:Buffer.from(text),contentType:"text/html",
    capturedAt,captureMethod:manual?"authorized_manual_upload":"authorized_external_download",
    retrievedFrom:sourceUrl,reviewerOrOperator:"oauth:operator-ingestion"
  });
  const attestation={version:"M551-PRIMARY-1" as const,snapshotId:snapshot.snapshotId,
    sourceSha256:snapshot.sha256,primarySourceUrl:sourceUrl,entity:"MU",metric:"revenue growth guidance",
    period:"FY2027",unit:"% YoY",verifiedValue:"+20%",sourceLocator:"Issuer FY2027 guidance paragraph",
    rawSourceExcerpt:excerpt,reviewedAt:new Date().toISOString(),primaryOriginAdjudicated:true as const,
    conflictingValuesAdjudicated:true,counterClaims:[{
      value:"-20%",sourceUrl:"https://example.com/unverified-rumor",
      sourceLabel:"Synthetic secondary rumor",publishedAt:null,
      disposition:"unverified" as const,
      rationale:"The secondary number has not been corroborated against an issuer filing."
    }]};
  const {preparePrimaryEvidenceAttestation}=await import("./primary-evidence-attestation-m551");
  const sign=async(input=attestation)=>{
    const prepared=preparePrimaryEvidenceAttestation(input);
    const bytes=Buffer.from(prepared.messageBase64,"base64");
    return {prepared,signed:{attestation:input,
      reviewer:{keyId:"evidence-reviewer",signatureBase64:crypto.sign(null,bytes,reviewer.privateKey).toString("base64")},
      approver:{keyId:"evidence-approver",signatureBase64:crypto.sign(null,bytes,approver.privateKey).toString("base64")}}};
  };
  return {snapshot,attestation,sign,reviewer,approver};
}
async function issued(){
  const f=await fixture();
  const {importSignedPrimaryEvidence}=await import("./primary-evidence-attestation-m551");
  const {prepared,signed}=await f.sign();
  const result=importSignedPrimaryEvidence(signed,operator);
  expect(result).toMatchObject({status:"signed_claim_receipt_issued",receiptId:prepared.receiptId,
    thesisOrPortfolioApproved:false});
  return {...f,receiptId:prepared.receiptId,signed};
}
const scope=(receiptId:string)=>({receiptId,sourceUrl,entity:"MU",metric:"revenue growth guidance",
  period:"FY2027",unit:"% YoY",verifiedValue:"+20%",competingValues:["+20%","-20%"]});

describe("M5.5.1 signed original-source evidence and read-only claim gate",()=>{
  it("validates exactly scoped dual-signed, anchored archived bytes and unlocks only an attributed Review",async()=>{
    const f=await issued();
    const {validatePrimaryEvidenceReceipt}=await import("./primary-evidence-receipt-m551");
    expect(validatePrimaryEvidenceReceipt(scope(f.receiptId))).toEqual({valid:true,
      status:"server_adjudicated_primary_claim_scope",snapshotId:f.snapshot.snapshotId});
    const {validateResearchM55}=await import("./research-quality-m55");
    const review={headlineTh:"ข่าวตัวอย่างบริษัทเผยแนวโน้มรายได้",translationTh:"นี่เป็นข้อมูลตัวอย่าง",
      whatChangedTh:"เอกสารตัวอย่างแสดงสมมติฐานที่แยกจากข่าวลือ",mechanismTh:"รายได้ขึ้นกับอุปสงค์จริง",
      thesisImplicationTh:"เป็นข้อมูลเพื่อ Review ไม่อนุมัติการเปลี่ยน Thesis",
      counterEvidenceTh:"ข่าวลืออีกแหล่งระบุค่าขัดแย้ง",requiredEvidenceTh:"ติดตามตัวเลขที่ประกาศในรอบถัดไป",
      claimAssessments:[{entity:"MU",metric:"revenue growth guidance",period:"FY2027",unit:"% YoY",
        competingValues:["+20%","-20%"],resolution:"verified_primary" as const,
        conclusion:"confirmed" as const,primarySourceUrl:sourceUrl,
        verifiedValue:"+20%",primaryEvidenceReceipt:f.receiptId}]};
    expect(validateResearchM55({domain:"company",subject:"MU",entityScope:["MU"],
      contentTypes:["guidance"],companyHubPaths:["01_Companies/MU.md"],industryHubPaths:[],
      sourceChannel:"news_media",sourceKind:"news_media",originalDocumentAccess:"excerpt_only",
      sourceLanguage:"en"},review)).toEqual([]);
    expect(fs.readdirSync(path.join(root,"vault"))).toHaveLength(0);
  });
  it("rejects forged ID, mismatched entity, period, unit, value or original URL",async()=>{
    const f=await issued();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    expect(v(scope("PEV-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")).valid).toBe(false);
    for(const changed of [{verifiedValue:"-20%"},{period:"FY2028"},{entity:"AAPL"},
      {unit:"USD million"},{sourceUrl:"https://www.sec.gov/Archives/other"}])
      expect(v({...scope(f.receiptId),...changed})).toMatchObject({valid:false,reason:"scope_mismatch"});
    expect(v({...scope(f.receiptId),verifiedValue:"+30%",competingValues:["+30%"]}).valid).toBe(false);
    expect(v({...scope(f.receiptId),competingValues:["+20%","-20%","-30%"]}))
      .toMatchObject({valid:false,reason:"scope_mismatch"});
  });
  it("rejects forged, swapped or replayed signatures and cannot self-issue with the admin session",async()=>{
    const f=await fixture();
    const {importSignedPrimaryEvidence,verifyPrimarySignatures}=await import("./primary-evidence-attestation-m551");
    const {signed}=await f.sign();
    expect(verifyPrimarySignatures({...signed,approver:signed.reviewer})).toBe(false);
    expect(()=>importSignedPrimaryEvidence({...signed,approver:signed.reviewer},operator))
      .toThrow("independent_primary_signatures_invalid");
    expect(()=>importSignedPrimaryEvidence({...signed,attestation:{...f.attestation,verifiedValue:"-20%"}},operator))
      .toThrow();
    expect(()=>importSignedPrimaryEvidence(signed,"oauth:synthetic-model"))
      .toThrow("authenticated_admin_required");
    importSignedPrimaryEvidence(signed,operator);
    expect(()=>importSignedPrimaryEvidence(signed,operator)).toThrow();
  });
  it("refuses new issuance when the deployment-level feature switch is not explicitly enabled",async()=>{
    const f=await fixture();
    const {signed}=await f.sign();
    const {importSignedPrimaryEvidence}=await import("./primary-evidence-attestation-m551");
    delete process.env.PRIMARY_EVIDENCE_ISSUANCE_ENABLED;
    expect(()=>importSignedPrimaryEvidence(signed,operator))
      .toThrow("primary_receipt_issuance_disabled");
  });
  it("rejects same Ed25519 public key registered under two IDs/roles",async()=>{
    const f=await fixture();
    const publicKeyPem=f.reviewer.publicKey.export({format:"pem",type:"spki"}).toString();
    process.env.PRIMARY_EVIDENCE_SIGNERS_JSON=JSON.stringify([
      {keyId:"evidence-reviewer",role:"reviewer",publicKeyPem},
      {keyId:"evidence-approver",role:"approver",publicKeyPem}
    ]);
    const {signed}=await f.sign();
    const {verifyPrimarySignatures}=await import("./primary-evidence-attestation-m551");
    expect(verifyPrimarySignatures(signed)).toBe(false);
  });
  it("requires a signed explanation for each contrary value and prevents duplicate evidence from another receipt ID",async()=>{
    const f=await issued();
    const {preparePrimaryEvidenceAttestation,importSignedPrimaryEvidence}=await import("./primary-evidence-attestation-m551");
    expect(()=>preparePrimaryEvidenceAttestation({...f.attestation,counterClaims:[]}))
      .toThrow("primary_counterclaim_adjudication_incomplete");
    const revised={...f.attestation,reviewedAt:new Date(Date.now()+1000).toISOString()};
    const {signed}=await f.sign(revised);
    expect(()=>importSignedPrimaryEvidence(signed,operator)).toThrow();
  });
  it("keeps approved rows immutable and revocation durable, even if the caller repeats the receipt ID",async()=>{
    const f=await issued();
    const {db}=await import("../db");
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    const {revokePrimaryEvidenceReceipt}=await import("./primary-evidence-attestation-m551");
    expect(()=>db().prepare("UPDATE primary_claim_verifications SET verified_value='-20%'").run())
      .toThrow("primary_claim_receipt_immutable");
    expect(()=>db().prepare("DELETE FROM primary_claim_verifications").run())
      .toThrow("primary_claim_receipt_immutable");
    revokePrimaryEvidenceReceipt(f.receiptId,"Later source contradiction identified",operator);
    expect(v(scope(f.receiptId))).toMatchObject({valid:false,reason:"approval_incomplete"});
    expect(()=>revokePrimaryEvidenceReceipt(f.receiptId,"Try to revoke again",operator)).toThrow();
    expect(()=>db().prepare("DELETE FROM primary_claim_receipt_revocations").run())
      .toThrow("primary_claim_revocation_immutable");
    expect((db().prepare("SELECT COUNT(*) AS n FROM primary_claim_receipt_events").get() as {n:number}).n).toBe(2);
  });
  it("fails closed when signing public keys disappear, or archived bytes change",async()=>{
    const f=await issued();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    delete process.env.PRIMARY_EVIDENCE_SIGNERS_JSON;
    expect(v(scope(f.receiptId))).toMatchObject({valid:false,reason:"approval_incomplete"});
    const list=JSON.stringify([
      {keyId:"evidence-reviewer",role:"reviewer",publicKeyPem:f.reviewer.publicKey.export({format:"pem",type:"spki"}).toString()},
      {keyId:"evidence-approver",role:"approver",publicKeyPem:f.approver.publicKey.export({format:"pem",type:"spki"}).toString()}
    ]);
    process.env.PRIMARY_EVIDENCE_SIGNERS_JSON=list;
    const blob=path.join(root,"source-archive","blobs",f.snapshot.sha256.slice(0,2),f.snapshot.sha256+".bin");
    fs.writeFileSync(blob,Buffer.alloc(f.snapshot.byteLength,0x78));
    expect(v(scope(f.receiptId)).valid).toBe(false);
  });
  it("will not sign a value absent from the quote, fabricated excerpt, or manual-upload-only document",async()=>{
    const f=await fixture();
    const {preparePrimaryEvidenceAttestation:p}=await import("./primary-evidence-attestation-m551");
    expect(()=>p({...f.attestation,verifiedValue:"+30%"})).toThrow("primary_value_not_grounded");
    expect(()=>p({...f.attestation,rawSourceExcerpt:"Invented quote not in original bytes"}))
      .toThrow("primary_value_not_grounded");
    const {captureOriginalDocumentBytes}=await import("../research-source-archive");
    const manualUrl=sourceUrl+"?manual=1";
    const manual=captureOriginalDocumentBytes({originalSource:manualUrl,bytes:Buffer.from(text),
      contentType:"text/html",capturedAt:new Date(Date.now()-600000).toISOString(),
      captureMethod:"authorized_manual_upload",retrievedFrom:manualUrl,
      reviewerOrOperator:"oauth:synthetic-upload"});
    expect(()=>p({...f.attestation,snapshotId:manual.snapshotId,
      sourceSha256:manual.sha256,primarySourceUrl:manualUrl}))
      .toThrow("primary_source_archived_bytes_unverified");
  });
});

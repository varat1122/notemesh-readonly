import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceUrl="https://www.sec.gov/Archives/edgar/data/12345/mu-fy2027-guidance.htm";
const text="<html><body>Micron FY2027 revenue growth guidance: +20% YoY (synthetic fixture only).</body></html>";
const excerpt="FY2027 revenue growth guidance: +20% YoY";
const receiptId="PEV-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
let root:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"m551-primary-")));
  fs.mkdirSync(path.join(root,"vault"),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  vi.resetModules();
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
async function fixture(){
  const {captureOriginalDocumentBytes}=await import("../research-source-archive");
  const {db}=await import("../db");
  const snapshot=captureOriginalDocumentBytes({
    originalSource:sourceUrl,bytes:Buffer.from(text),contentType:"text/html",
    capturedAt:"2026-10-26T10:00:00Z",captureMethod:"authorized_external_download",
    retrievedFrom:sourceUrl,reviewerOrOperator:"oauth:operator-ingestion"
  });
  db().prepare(`INSERT INTO primary_claim_verifications
    (receipt_id,snapshot_id,source_sha256,original_source,entity,metric,period,unit,verified_value,
     source_locator,raw_source_excerpt,reviewer_id,approved_at,primary_origin_adjudicated,
     conflicting_values_adjudicated,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    receiptId,snapshot.snapshotId,snapshot.sha256,sourceUrl,"MU","revenue growth guidance",
    "FY2027","% YoY","+20%","Issuer FY2027 guidance paragraph",excerpt,
    "oauth:independent-reviewer","2026-10-26T11:00:00Z",1,1,"approved");
  return {db:db(),snapshot};
}
const scope={receiptId,sourceUrl,entity:"MU",metric:"revenue growth guidance",
  period:"FY2027",unit:"% YoY",verifiedValue:"+20%",competingValues:["+20%","-20%"]};

describe("M5.5.1 server-side primary evidence receipt",()=>{
  it("accepts only a scoped operator-adjudicated receipt anchored to SHA-verified original bytes",async()=>{
    const {snapshot}=await fixture();
    const {validatePrimaryEvidenceReceipt}=await import("./primary-evidence-receipt-m551");
    expect(validatePrimaryEvidenceReceipt(scope)).toEqual({valid:true,
      status:"server_adjudicated_primary_claim_scope",snapshotId:snapshot.snapshotId});
    const {validateResearchM55}=await import("./research-quality-m55");
    const review={headlineTh:"ข่าวตัวอย่างบริษัทเผยแนวโน้มรายได้",translationTh:"นี่เป็นข้อมูลตัวอย่าง",
      whatChangedTh:"เอกสารตัวอย่างแสดงสมมติฐานที่แยกจากข่าวลือ",mechanismTh:"รายได้ขึ้นกับอุปสงค์จริง",
      thesisImplicationTh:"เป็นข้อมูลเพื่อ Review ไม่อนุมัติการเปลี่ยน Thesis",
      counterEvidenceTh:"ข่าวลืออีกแหล่งระบุค่าขัดแย้ง",requiredEvidenceTh:"ติดตามตัวเลขที่ประกาศในรอบถัดไป",
      claimAssessments:[{entity:"MU",metric:scope.metric,period:scope.period,unit:scope.unit,
        competingValues:scope.competingValues,resolution:"verified_primary" as const,
        conclusion:"confirmed" as const,primarySourceUrl:sourceUrl,
        verifiedValue:"+20%",primaryEvidenceReceipt:receiptId}]};
    expect(validateResearchM55({domain:"company",subject:"MU",entityScope:["MU"],
      contentTypes:["guidance"],companyHubPaths:["01_Companies/MU.md"],industryHubPaths:[],
      sourceChannel:"news_media",sourceKind:"news_media",originalDocumentAccess:"excerpt_only",
      sourceLanguage:"en"},review)).toEqual([]);
  });
  it("rejects invented IDs and mismatched value, period, entity, unit or primary URL",async()=>{
    await fixture();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    expect(v({...scope,receiptId:"PEV-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}).valid).toBe(false);
    for(const changed of [{verifiedValue:"-20%"},{period:"FY2028"},{entity:"AAPL"},
      {unit:"USD million"},{sourceUrl:"https://example.org/fake"}]){
      expect(v({...scope,...changed})).toMatchObject({valid:false,reason:"scope_mismatch"});
    }
    expect(v({...scope,verifiedValue:"+30%",competingValues:["+30%"]}).valid).toBe(false);
  });
  it("rejects incomplete/revoked approvals and conflicting claim without adjudication",async()=>{
    const {db}=await fixture();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    db.prepare("UPDATE primary_claim_verifications SET conflicting_values_adjudicated=0").run();
    expect(v(scope)).toMatchObject({valid:false,reason:"approval_incomplete"});
    db.prepare("UPDATE primary_claim_verifications SET conflicting_values_adjudicated=1,status='revoked'").run();
    expect(v(scope).valid).toBe(false);
    db.prepare("UPDATE primary_claim_verifications SET status='approved',primary_origin_adjudicated=0").run();
    expect(v(scope).valid).toBe(false);
  });
  it("detects altered archived bytes or a quote absent from the archived original",async()=>{
    const {db,snapshot}=await fixture();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    db.prepare("UPDATE primary_claim_verifications SET raw_source_excerpt='Invented external quote not in the source'").run();
    expect(v(scope)).toMatchObject({valid:false,reason:"excerpt_not_in_archived_bytes"});
    db.prepare("UPDATE primary_claim_verifications SET raw_source_excerpt=?").run(excerpt);
    const blob=path.join(root,"source-archive","blobs",snapshot.sha256.slice(0,2),snapshot.sha256+".bin");
    fs.writeFileSync(blob,Buffer.alloc(snapshot.byteLength,0x78));
    expect(v(scope)).toMatchObject({valid:false,reason:"archive_invalid"});
  });
  it("rejects an approved metadata value that does not actually occur as a whole value in its source anchor",async()=>{
    const {db}=await fixture();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    db.prepare("UPDATE primary_claim_verifications SET verified_value='+30%'").run();
    expect(v({...scope,verifiedValue:"+30%",competingValues:["+30%","-20%"]}))
      .toMatchObject({valid:false,reason:"excerpt_not_in_archived_bytes"});
  });
  it("rejects a manual-upload-only snapshot even when somebody marks its metadata approved",async()=>{
    const {db,snapshot}=await fixture();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    db.prepare("UPDATE source_snapshots SET capture_method='authorized_manual_upload' WHERE snapshot_id=?")
      .run(snapshot.snapshotId);
    expect(v(scope)).toMatchObject({valid:false,reason:"archive_invalid"});
  });
  it("does not upgrade a byte-only source snapshot or a caller-authored receipt note",async()=>{
    const {db}=await fixture();
    db.prepare("DELETE FROM primary_claim_verifications").run();
    const {validatePrimaryEvidenceReceipt:v}=await import("./primary-evidence-receipt-m551");
    expect(v(scope)).toMatchObject({valid:false,reason:"missing"});
    expect(fs.readdirSync(path.join(root,"vault"))).toHaveLength(0);
  });
});

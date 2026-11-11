/** Disposable-only acceptance tests. Dashboard approval is simulated; no human presence claim. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {CanonicalRevisionInput} from "../safe-edit/canonical-review-revision-pilot";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const actor="oauth:revision-disposable-fixture";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const researchReview={headlineTh:"TESTA อัปเดตคู่มือที่ยังต้องตรวจต้นฉบับ",
 translationTh:"TESTA ออกคำชี้แจงเกี่ยวกับคู่มือสำหรับการใช้งานระบบสมมติ",
 whatChangedTh:"เป็นการกล่าวอ้างด้านเอกสารคู่มือ ไม่ใช่รายได้หรือกำไรที่เกิดขึ้นจริง",
 mechanismTh:"ยังไม่มีหลักฐานแสดงว่ารายละเอียดคู่มือมีผลต่อคำสั่งซื้อหรือการรับรู้รายได้",
 thesisImplicationTh:"คงมุมมองเดิม ไม่เปลี่ยน Thesis หรือ Portfolio จากรายละเอียดเอกสาร",
 counterEvidenceTh:"ข้อความส่งต่ออาจอ้างถึงรายละเอียดที่มีในเอกสารเดิม ต้องตรวจต้นฉบับ",
 requiredEvidenceTh:"ตรวจเอกสารที่ออกโดยผู้ผลิตและวันที่เผยแพร่ก่อนยกระดับข้อกล่าวอ้าง"};
const original:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic TESTA ordinary manual",inputFormat:"text",
 sourceKind:"news_media",sourceLanguage:"en",sourceChannel:"synthetic",contentTypes:["other"],
 sourceChat:"Synthetic revision fixture",sourceUrl:"https://example.org/testa/manual",eventDate:"2026-10-01",publicationDate:"2026-10-01",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC: TESTA issued an ordinary product manual on October 1.",
 researchReview};
const repost:WritebackInput={...original,sourceKind:"social_repost",sourceUrl:null,eventDate:null,publicationDate:null,
 extractedText:"SYNTHETIC forwarded detail: the manual appendix provides an additional installation note."};
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-revision-pilot-")));vault=path.join(root,"vault");
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,24).toString("base64");
 process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";process.env.IOS_C1_REVISION_PILOT="synthetic";
 for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");
 fs.writeFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"# protected fixture\n");
 (await import("../vault/indexer")).reindexPath("01_Companies/TESTA.md");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"utf8")).toBe("# protected fixture\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","IOS_C1_REVISION_PILOT","RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID"])delete process.env[k];
});
async function save(input:WritebackInput){
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);
 return c.applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);
}
async function candidate():Promise<CanonicalRevisionInput>{
 const first=await save(original),source=await save({...repost,captureOnly:true,researchReview:undefined});
 expect(first.status).toBe("saved_verified");expect(source.status).toBe("source_saved_analysis_pending");
 const reviewStep=first.steps.find(s=>s.kind==="canonical_review")!,sourceStep=source.steps[0];
 const reviewBytes=fs.readFileSync(path.join(vault,reviewStep.path),"utf8");
 const sourceBytes=fs.readFileSync(path.join(vault,sourceStep.path),"utf8");
 return {
 existingReview:{path:reviewStep.path,expectedSha256:sha(reviewBytes),receiptId:reviewStep.receiptKey,
   relationship:"added_detail",comparisonBasis:"Synthetic analyst comparison: this is a low-risk detail to the same manual, without independent issuer verification."},
 entity:"TESTA",reviewDate:"2026-11-12",methodVersion:"TEST-SYNTHETIC-1",
 additionalSources:[{path:sourceStep.path,sha256:sha(sourceBytes),receiptId:sourceStep.receiptKey}],
 analystAssessment:{disposition:"PASS",eventRelation:"added_detail",materiality:"low",
   assessment:"The forwarded appendix detail is only a historical Draft annotation and does not assert earnings or financial guidance.",
   counterEvidence:"The original publisher document was not independently read. Same-event identity is an analyst proposal, not a verified fact.",
   requiredEvidence:"Read the real original and confirm the appendix reference before using it in any investment decision.",
   criticIndependence:"not_verified",independentEvidenceIncrement:0},
 revisionText:"Preserve the original Research Review and attach this unverified appearance as additional context only."
 };
}
it("isolated routine addendum requires exact reviewer dashboard approval and persists source links",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const prepared=bridge.prepareCanonicalReviewRevision(input,actor);
 expect(prepared.status).toBe("reviewer_dashboard_session_required");
 expect(prepared.preview.requiresAdminApproval).toBe(true);
 expect(prepared.preview.diff.removed).toEqual([]);
 const args={input,operationId:prepared.operationId,authorization:{
    operationId:prepared.operationId,previewToken:prepared.preview.previewToken!,expectedHash:prepared.preview.beforeHash}};
 await expect(bridge.applyCanonicalReviewRevision(args,actor)).rejects.toThrow(/dashboard approval/);
 const reviewed=engine.adminPreview(prepared.operationId);
 expect(reviewed).toHaveProperty("fullBefore");expect(reviewed).toHaveProperty("fullAfter");
 expect(reviewed).toHaveProperty("revisionEvidence");
 expect(engine.approve(prepared.operationId,"synthetic-dashboard-reviewer",prepared.preview.afterHash)).toEqual({approved:true});
 const result=await bridge.applyCanonicalReviewRevision(args,actor);
 expect(result.status).toBe("revision_saved_verified");
 expect(result.reviewAppendChainVerified).toBe(true);
 expect(result.sourceReceiptsVerified).toBe(true);
 expect(result.sourceLinks?.every(x=>x.resolved)).toBe(true);
 expect(result.independentEvidenceIncrement).toBe(0);
 const repeated=await bridge.applyCanonicalReviewRevision(args,actor);
 expect(repeated.status).toBe("revision_saved_verified");
 expect(repeated.afterHash).toBe(result.afterHash);
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toHaveLength(1);
});
it("generic Safe Edit append cannot bypass the dedicated revision tool even if caller supplies approval URL",async()=>{
 const input=await candidate(),engine=await import("../safe-edit/engine");
 const req={operationId:"ICR-GENERIC-FAKE-001",path:input.existingReview.path,
   reason:"generic backdoor attempt",change:{kind:"append" as const,
     heading:"Research analysis (AI interpretation; not approved Thesis)",content:"unreviewed text",date:"2026-11-12"}};
 expect(()=>engine.preview(req,actor)).toThrow(/dedicated_route_required/);
});
it.each(["hash","receipt","scope","missing_source","material","contradiction","actor"])("%s violates independent revision admission",async fault=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision");
 if(fault==="hash")input.existingReview.expectedSha256="a".repeat(64);
 if(fault==="receipt")input.additionalSources[0].receiptId="ICW-"+"a".repeat(32);
 if(fault==="scope")input.entity="TESTB";
 if(fault==="missing_source")input.additionalSources[0].path="00_Inbox/ChatGPT/Investment Intake - IN-AAAAAAAAAAAAAAAA.md";
 if(fault==="material")input.analystAssessment.materiality="material";
 if(fault==="contradiction"){input.existingReview.relationship="contradiction";input.analystAssessment.eventRelation="contradiction";}
 if(fault==="actor")process.env.RAILWAY_PROJECT_ID="synthetic-disallowed";
 expect(()=>bridge.prepareCanonicalReviewRevision(input,actor)).toThrow();
});
it("review CAS drift between preview and apply cannot be approved or written",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const prepared=bridge.prepareCanonicalReviewRevision(input,actor);
 const reviewAbs=path.join(vault,input.existingReview.path);
 fs.appendFileSync(reviewAbs,"\nExternal edit before review.\n");
 expect(()=>engine.approve(prepared.operationId,"synthetic-dashboard-reviewer",prepared.preview.afterHash))
 .toThrow(/review_receipt_hold|diff_actor|review/);
});

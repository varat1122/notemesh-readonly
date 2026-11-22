/** WP2 E04/E05 at the dashboard approval route (real engine + kernel; session simulated, NOT proof
 * of human presence). RP mode; apply uses SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import type {WritebackInput} from "~/server/vault/investment-writeback-router";
const state=vi.hoisted(()=>({signedIn:true}));
vi.mock("~/server/auth",()=>({runAuthMigrations:async()=>{},auth:{api:{getSession:async()=>state.signedIn?{user:{id:"synthetic-dashboard-reviewer"}}:null}}}));
vi.mock("~/server/safe-edit/sync",()=>({withPausedSync:async<T,>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
import {assessed} from "../../../tests/source-event-fixture";
const actor="oauth:wp2-approval-route-fixture",origin="https://approval-fixture.test";
let root:string,vault:string;
const review={headlineTh:"TESTA ชี้แจงรายละเอียดคู่มือสมมติ",translationTh:"TESTA เผยแพร่คู่มือสมมติสำหรับการใช้งานและมีคำอธิบายการติดตั้ง",
 whatChangedTh:"รายละเอียดคู่มือเป็นข้อความที่ได้รับ ยังไม่ได้ยืนยันว่ามีผลต่อการลงทุน",mechanismTh:"ยังไม่มีหลักฐานแสดงผลต่อรายได้ กำไร หรือความสัมพันธ์ระหว่างบริษัท",
 thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข้อความดังกล่าว ต้องตรวจหลักฐานเพิ่มเติม",counterEvidenceTh:"ข้อมูลอาจซ้ำกับคู่มือเดิม และยังไม่มีการตรวจสอบต้นฉบับอย่างเป็นอิสระ",
 requiredEvidenceTh:"ต้องอ่านเอกสารต้นฉบับและเปรียบเทียบกับประวัติก่อนยกระดับข้อกล่าวอ้าง"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",
 sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"WP2 approval route mechanics",sourceUrl:"https://example.org/wp2/approval",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",researchReview:review};
beforeEach(async()=>{vi.resetModules();state.signedIn=true;root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-revision-pilot-")));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,BASE_URL:origin,ENCRYPTION_KEY:Buffer.alloc(32,45).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",IOS_C1_REVISION_PILOT:"synthetic"});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"05_Thesis/protected.md"),"# Protected unchanged\n");fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");
 (await import("~/server/vault/indexer")).reindexPath("01_Companies/TESTA.md");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 (await import("~/server/db")).db().close();fs.rmSync(root,{recursive:true,force:true});vi.useRealTimers();
 for(const k of ["DATA_DIR","BASE_URL","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","IOS_C1_REVISION_PILOT"])delete process.env[k];});
async function post(body:object,headers:Record<string,string>={Origin:origin}){
 const {POST}=await import("./safe-edit-approval");
 return POST({request:new Request(origin+"/api/safe-edit-approval",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(body)})} as Parameters<typeof POST>[0]);
}
const auth=(p:{operationId:string;previewToken?:string|null;beforeHash:string})=>({operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash});

it("E04/E05: route refuses untrusted session/origin and a stale (post-HOLD) witness; a fresh reassessment is approved through the same route and applied",async()=>{
 const c=await import("~/server/mcp/canonical-writeback"),gate=await import("~/server/safe-edit/source-event-admission"),engine=await import("~/server/safe-edit/engine"),admission=await import("~/server/safe-edit/admission");
 const cap={...base,captureOnly:true,researchReview:undefined},pc=c.prepareCanonicalWriteback(cap,actor);
 await c.applyCanonicalWriteback({input:cap,planId:pc.planId,authorizations:pc.previews.map(auth)},actor);
 const clean=c.canonicalInputSchema.parse(base),a={...clean,sourceEvent:await assessed(gate.canonicalEventProposal(clean),actor)};
 const pa=c.prepareCanonicalWriteback(a,actor),rev=pa.previews.find(p=>p.kind==="canonical_review")!,view=engine.adminPreview(rev.operationId);
 const body={id:rev.operationId,hash:view.afterHash,reviewedEvidenceDigest:(view as {reviewedEvidenceDigest?:string}).reviewedEvidenceDigest};
 state.signedIn=false;expect((await post(body)).status).toBe(401);state.signedIn=true;
 expect((await post(body,{Origin:"https://attacker.test"})).status).toBe(403);
 const hold=structuredClone(a.sourceEvent);hold.result.disposition="HOLD";gate.withdrawSourceEvent(hold,actor);
 expect(()=>admission.assertWitnessCurrent(admission.witnessFor(rev.operationId)!,actor)).toThrow(/authority_epoch_changed/);
 const stale=await post(body);expect(stale.status).toBe(400);
 expect((await import("~/server/db")).db().prepare("SELECT approval FROM safe_edit_operations WHERE id=?").pluck().get(rev.operationId)).toBeNull();
 vi.setSystemTime(Date.now()+10);
 const b={...a,sourceEvent:await assessed(gate.canonicalEventProposal(clean),actor)},pb=c.prepareCanonicalWriteback(b,actor);
 for(const p of pb.previews){const v=engine.adminPreview(p.operationId);
  const r=await post({id:p.operationId,hash:v.afterHash,reviewedEvidenceDigest:(v as {reviewedEvidenceDigest?:string}).reviewedEvidenceDigest});expect(r.status).toBe(200);}
 const out=await c.applyCanonicalWriteback({input:b,planId:pb.planId,authorizations:pb.previews.map(auth)},actor);
 expect(out.status).toBe("saved_verified");
 for(const p of pb.previews)expect(admission.operationProvenanceTier(p.operationId)).toBe("server_witnessed");
});

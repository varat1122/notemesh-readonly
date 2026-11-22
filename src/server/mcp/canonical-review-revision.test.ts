/** Disposable-only acceptance tests. Dashboard approval is simulated; no human presence claim. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {CanonicalRevisionInput} from "../safe-edit/canonical-review-revision-pilot";
const paused=vi.hoisted(()=>({beforeRun:null as null|(()=>Promise<void>)}));
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>{await paused.beforeRun?.();return run();}}));
vi.mock("~/server/auth",()=>({runAuthMigrations:async()=>{},auth:{api:{getSession:async()=>({user:{id:"synthetic-dashboard-reviewer"}})}}}));
import {assessed,approveFixture} from "../../../tests/source-event-fixture";
const actor="oauth:revision-disposable-fixture";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string,dbClosed:boolean;
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
beforeEach(async()=>{vi.resetModules();dbClosed=false;paused.beforeRun=null;root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-revision-pilot-")));vault=path.join(root,"vault");
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,24).toString("base64");
 process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";process.env.IOS_C1_REVISION_PILOT="synthetic";
 for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");
 fs.writeFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"# protected fixture\n");
 (await import("../vault/indexer")).reindexPath("01_Companies/TESTA.md");
 (await import("../vault/indexer")).reindexPath("05_Thesis/TESTA - Current Thesis.md");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"utf8")).toBe("# protected fixture\n");
 if(!dbClosed)(await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});vi.useRealTimers();
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","IOS_C1_REVISION_PILOT","RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID"])delete process.env[k];
});
async function save(input:WritebackInput){
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);
 return c.applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);
}
async function candidate():Promise<CanonicalRevisionInput>{
 await save({...original,captureOnly:true,researchReview:undefined});
 const admission=await import("../safe-edit/source-event-admission"),c=await import("./canonical-writeback");
 const full={...original,sourceEvent:await assessed(admission.canonicalEventProposal(original),actor)};
 expect(JSON.parse(full.sourceEvent.packet.body).context.constraints).toEqual([]);
 const prep=c.prepareCanonicalWriteback(full,actor);
 expect(prep.sourceEvent).toMatchObject({decision:"PASS",reasons:[]});
 for(const p of prep.previews)await approveFixture(p.operationId);
 const first=await c.applyCanonicalWriteback({input:full,planId:prep.planId,authorizations:prep.previews.map(p=>({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash}))},actor);
 const source=await save({...repost,captureOnly:true,researchReview:undefined});
 expect(first.status).toBe("saved_verified");expect(source.status).toBe("source_saved_analysis_pending");
 const reviewStep=first.steps.find(s=>s.kind==="canonical_review")!,sourceStep=source.steps[0];
 const reviewBytes=fs.readFileSync(path.join(vault,reviewStep.path),"utf8");
 const sourceBytes=fs.readFileSync(path.join(vault,sourceStep.path),"utf8");
 const input:CanonicalRevisionInput={
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
 input.sourceEvent=await assessed(admission.revisionEventProposal(input),actor);
 return input;
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
 expect(await approveReviewed(prepared.operationId)).toEqual({approved:true});
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
it.each(["hash","receipt","scope","missing_source","material","contradiction","actor","hold","fail","duplicate","correction","unresolved","relation_drift"])("%s violates independent revision admission",async fault=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision");
 if(fault==="hash")input.existingReview.expectedSha256="a".repeat(64);
 if(fault==="receipt")input.additionalSources[0].receiptId="ICW-"+"a".repeat(32);
 if(fault==="scope")input.entity="TESTB";
 if(fault==="missing_source")input.additionalSources[0].path="00_Inbox/ChatGPT/Investment Intake - IN-AAAAAAAAAAAAAAAA.md";
 if(fault==="material")input.analystAssessment.materiality="material";
 if(fault==="contradiction"){input.existingReview.relationship="contradiction";input.analystAssessment.eventRelation="contradiction";}
 if(fault==="actor")process.env.RAILWAY_PROJECT_ID="synthetic-disallowed";
 if(fault==="hold"||fault==="fail")input.analystAssessment.disposition=fault==="hold"?"HOLD":"FAIL";
 if(fault==="duplicate"||fault==="correction"){input.existingReview.relationship=fault;input.analystAssessment.eventRelation=fault;}
 if(fault==="unresolved")input.analystAssessment.materiality="unresolved";
 if(fault==="relation_drift")input.analystAssessment.eventRelation="duplicate";
 expect(()=>bridge.prepareCanonicalReviewRevision(input,actor)).toThrow();
});
it("review CAS drift between preview and apply cannot be approved or written",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const prepared=bridge.prepareCanonicalReviewRevision(input,actor);
 const reviewAbs=path.join(vault,input.existingReview.path);
 fs.appendFileSync(reviewAbs,"\nExternal edit before review.\n");
 expect(()=>engine.approve(prepared.operationId,"synthetic-dashboard-reviewer",prepared.preview.afterHash))
 .toThrow(/review_receipt_hold|diff_actor|review|source_event_scope_changed_or_unavailable_hold/);
});
async function approveReviewed(id:string){
 const engine=await import("../safe-edit/engine"),view=engine.adminPreview(id);
 // A session is simulated here, never evidence of genuine human review.
 return engine.approve(id,"synthetic-dashboard-reviewer",view.afterHash,
   "reviewedEvidenceDigest" in view?view.reviewedEvidenceDigest as string:undefined);
}
it("F1: exact Source and semantic scope remain fully visible; receipt never means verified issuer",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const text="SYNTHETIC TESTA: another ordinary manual annotation; publisher identity is not independently verified.";
 const saved=await save({...repost,entities:["TESTA"],extractedText:text,captureOnly:true,researchReview:undefined});
 const s=saved.steps[0],raw=fs.readFileSync(path.join(vault,s.path),"utf8");
 input.additionalSources.push({path:s.path,sha256:sha(raw),receiptId:s.receiptKey});
 input.sourceEvent=await assessed((await import("../safe-edit/source-event-admission")).revisionEventProposal(input),actor);
 const p=bridge.prepareCanonicalReviewRevision(input,actor),view=engine.adminPreview(p.operationId);
 expect(view).toMatchObject({issuerBinding:"not_verified",additionalSourceEvidence:input.additionalSources.map(x=>({
   ...x,intakeId:x.path.match(/IN-[A-F0-9]{16}/)![0],fullReceiptedText:fs.readFileSync(path.join(vault,x.path),"utf8"),
   issuerBinding:"not_verified",locator:{path:x.path,wholeNoteSha256:x.sha256}
 }))});
 expect(JSON.stringify(view)).toContain(text);
 expect(()=>engine.approve(p.operationId,"synthetic-dashboard-reviewer",p.preview.afterHash)).toThrow(/reviewed_source_evidence_hold/);
 expect(()=>engine.approve(p.operationId,"synthetic-dashboard-reviewer",p.preview.afterHash,"a".repeat(64))).toThrow(/reviewed_source_evidence_hold/);
 const route=await import("../../routes/api/safe-edit-approval"),{env}=await import("../env");
 const event=(request:Request)=>({request}) as Parameters<typeof route.GET>[0];
 const response=await route.GET(event(new Request(env.baseUrl+"/api/safe-edit-approval?id="+p.operationId)));
 expect(response.status).toBe(200);const html=await response.text();
 expect(html).toContain(text);expect(html).toContain("NOT VERIFIED");expect(html).toContain("fullReceiptedText");
 const evidenceDigest=html.match(/name="reviewedEvidenceDigest" value="([a-f0-9]{64})"/)![1];
 const post=await route.POST(event(new Request(env.baseUrl+"/api/safe-edit-approval",{method:"POST",
   headers:{Origin:env.baseUrl,"Content-Type":"application/x-www-form-urlencoded"},
   body:new URLSearchParams({id:p.operationId,hash:p.preview.afterHash,reviewedEvidenceDigest:evidenceDigest})})));
 expect(post.status).toBe(200); // synthetic visibility fix, NOT issuer correctness
 const eventRow=(await import("../db")).db().prepare("SELECT detail FROM safe_edit_events WHERE operation_id=? AND event='approved'").get(p.operationId) as {detail:string};
 expect(JSON.parse(eventRow.detail).reviewedEvidenceDigest).toBe(evidenceDigest);
});
it.each(["bytes","receipt"])("F2: original Source %s drift rejects generic and dedicated MCP apply without a Review write",async fault=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const {indexedRead,createReceipt}=await import("../vault/investment-research-context");
 const before=indexedRead(input.existingReview.path).raw,sourcePath=indexedRead(input.existingReview.path).fm.original_source_path as string;
 if(fault==="bytes"){
   fs.appendFileSync(path.join(vault,sourcePath),"\nSYNTHETIC mutation\n");(await import("../vault/indexer")).reindexPath(sourcePath);
 }else{
   // Corrupt a REAL persisted receipt in this disposable DB; never fabricate one.
   const id=createReceipt("source_intake",sourcePath,indexedRead(sourcePath).raw);
   (await import("../db")).db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.readback','unverified') WHERE id=?").run(id);
 }
 const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"synthetic-revision-mechanism",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(b);await client.connect(a);
 const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
 try{
   const generic=await client.callTool({name:"apply_edit",arguments:authorization});expect(generic.isError).toBe(true);
   expect(JSON.stringify(generic)).toContain("dedicated_route_required");
   const dedicated=await client.callTool({name:"apply_canonical_review_revision",arguments:{input,operationId:p.operationId,authorization}});
   expect(dedicated.isError).toBe(true);expect(JSON.stringify(dedicated)).toContain("create_receipt_unverified");
   expect(indexedRead(input.existingReview.path).raw).toBe(before);expect(engine.status(p.operationId,actor).status).toBe("preview");
 }finally{await client.close();await server.close();}
});
it.each(["substitution","bytes"])("F1: additional Source %s after approval cannot use the reviewed authority",async fault=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const before=fs.readFileSync(path.join(vault,input.existingReview.path),"utf8");
 if(fault==="bytes"){
   fs.appendFileSync(path.join(vault,input.additionalSources[0].path),"\nDifferent synthetic Source.\n");
   (await import("../vault/indexer")).reindexPath(input.additionalSources[0].path);
 }else{
   const saved=await save({...repost,captureOnly:true,researchReview:undefined,extractedText:"SYNTHETIC different Source for replacement"}),s=saved.steps[0];
   input.additionalSources=[{path:s.path,sha256:sha(fs.readFileSync(path.join(vault,s.path),"utf8")),receiptId:s.receiptKey}];
 }
 await expect(bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization:{operationId:p.operationId,
   previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash}},actor)).rejects.toThrow(/revision_input|revision_source/);
 expect(fs.readFileSync(path.join(vault,input.existingReview.path),"utf8")).toBe(before);
 expect(engine.status(p.operationId,actor).status).toBe("preview");
});
it("F2: generic cannot consume a valid managed token, even after the pilot flag is removed",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
 expect(()=>engine.apply(authorization,actor)).toThrow(/dedicated_route_required/);
 delete process.env.IOS_C1_REVISION_PILOT;
 expect(()=>engine.apply(authorization,actor)).toThrow(/dedicated_route_required/);
 await expect(bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},actor)).rejects.toThrow(/isolated_scope_required/);
 process.env.IOS_C1_REVISION_PILOT="synthetic";
 expect((await bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},actor)).status).toBe("revision_saved_verified");
});
it("two dedicated appends retain one Review, real Source receipts, links and cold-process readback",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const originalBytes=fs.readFileSync(path.join(vault,input.existingReview.path),"utf8");
 const sourceBefore=fs.readFileSync(path.join(vault,input.additionalSources[0].path),"utf8");
 for(let i=0;i<2;i++){
   input.sourceEvent=await assessed((await import("../safe-edit/source-event-admission")).revisionEventProposal(input),actor);
   const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
   expect(p.preview.diff.removed).toEqual([]);
   const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
   const result=await bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},actor);
   expect(result.status).toBe("revision_saved_verified");expect(result.reviewAppendChainVerified).toBe(true);
   expect(result.sourceLinks?.every(s=>s.resolved)).toBe(true);
   expect((await bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},actor)).status).toBe("revision_saved_verified");
   expect(()=>engine.apply(authorization,actor)).toThrow(/dedicated_route_required/);
   input.existingReview.expectedSha256=result.afterHash!;
   input.revisionText="Second distinct synthetic additional detail, no claim of independent evidence.";
 }
 const raw=fs.readFileSync(path.join(vault,input.existingReview.path),"utf8");
 expect(raw).toContain(originalBytes.slice(0,originalBytes.indexOf("## บทวิเคราะห์")));
 expect(raw).toContain("independent_evidence_increment=0; comparator_eligible=false");
 expect(fs.readFileSync(path.join(vault,input.additionalSources[0].path),"utf8")).toBe(sourceBefore);
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toHaveLength(1);
 (await import("../db")).db().close();dbClosed=true;
 const output=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/canonical-review-revision-cold.test.ts","--maxWorkers=1"],{
   env:{...process.env,REVISION_COLD_PATH:input.existingReview.path,REVISION_COLD_RECEIPT:input.existingReview.receiptId},encoding:"utf8",timeout:30000});
 expect(output).toContain("1 passed");
},40000);
it("F2: original Source is rechecked at the Safe Edit write boundary after sync pause",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const {indexedRead}=await import("../vault/investment-research-context"),before=indexedRead(input.existingReview.path);
 paused.beforeRun=async()=>{
   const originalPath=before.fm.original_source_path as string;
   fs.appendFileSync(path.join(vault,originalPath),"\nSynthetic drift while sync is paused.\n");
   (await import("../vault/indexer")).reindexPath(originalPath);
 };
 await expect(bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization:{
   operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash}},actor)).rejects.toThrow(/create_receipt_unverified|source_event_scope_changed_or_unavailable_hold/);
 expect(indexedRead(input.existingReview.path).raw).toBe(before.raw);
 expect(engine.status(p.operationId,actor).status).toBe("preview");
});
it.each(["actor","token","expiry"])("dedicated apply retains the %s boundary after approval",async fault=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const before=fs.readFileSync(path.join(vault,input.existingReview.path),"utf8");
 const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
 if(fault==="token")authorization.previewToken="a".repeat(64);
 if(fault==="expiry")vi.setSystemTime(Date.now()+31*60000);
 await expect(bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},fault==="actor"?"oauth:other-fixture":actor)).rejects.toThrow();
 expect(fs.readFileSync(path.join(vault,input.existingReview.path),"utf8")).toBe(before);
 expect(engine.status(p.operationId,actor).status).toBe("preview");
});
it("F2: generic apply refuses a managed revision token after original Source byte drift",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const before=fs.readFileSync(path.join(vault,input.existingReview.path),"utf8");
 const {indexedRead}=await import("../vault/investment-research-context");
 const sourcePath=indexedRead(input.existingReview.path).fm.original_source_path as string;
 fs.appendFileSync(path.join(vault,sourcePath),"\nSYNTHETIC original Source drift\n");
 (await import("../vault/indexer")).reindexPath(sourcePath);
 const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
 await expect(bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},actor)).rejects.toThrow();
 expect(()=>engine.apply(authorization,actor)).toThrow(/dedicated_route_required/);
 expect(fs.readFileSync(path.join(vault,input.existingReview.path),"utf8")).toBe(before);
 expect(engine.status(p.operationId,actor).status).toBe("preview");
});
it("F3: identical reprepare HOLD preserves the approved token and original journal",async()=>{
 const input=await candidate(),bridge=await import("./canonical-review-revision");
 const p=bridge.prepareCanonicalReviewRevision(input,actor);await approveReviewed(p.operationId);
 const d=(await import("../db")).db();
 const operation=()=>d.prepare("SELECT * FROM safe_edit_operations WHERE id=?").get(p.operationId);
 const events=()=>d.prepare("SELECT * FROM safe_edit_events WHERE operation_id=? ORDER BY rowid").all(p.operationId);
 const opBefore=operation(),eventsBefore=events();
 expect(()=>bridge.prepareCanonicalReviewRevision(input,actor)).toThrow(/revision_admission_replay_hold/);
 expect(operation()).toEqual(opBefore);expect(events()).toEqual(eventsBefore);
 const result=await bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization:{
   operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash}},actor);
 expect(result.status).toBe("revision_saved_verified");
});

/** Synthetic mechanical contract, not an economic-event/LLM acceptance test. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const actor="oauth:source-review-reuse-fixture";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const review={headlineTh:"TESTA เพิ่มรายละเอียดคู่มือที่ต้องตรวจขอบเขตต้นฉบับ",
 translationTh:"TESTA ระบุว่าคู่มือมีคำแนะนำอยู่ในภาคผนวก เป็นข้อความสมมติสำหรับทดสอบระบบเท่านั้น",
 whatChangedTh:"แหล่งข่าวระบุตำแหน่งคำแนะนำในคู่มือ โดยยังไม่ได้ตรวจสอบกับเอกสารต้นฉบับอย่างอิสระ",
 mechanismTh:"เป็นคำกล่าวอ้างจากแหล่งข่าว ยังไม่มีหลักฐานเชื่อมโยงกับผลต่อรายได้หรือต้นทุนของบริษัท",
 thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือมูลค่าจากรายละเอียดของคู่มือเพียงอย่างเดียว",
 counterEvidenceTh:"อาจเป็นรายละเอียดเดิมที่เคยได้รับแล้ว ต้องอ่านบทวิเคราะห์เดิมก่อนสรุปว่าเป็นเหตุการณ์ใหม่",
 requiredEvidenceTh:"ต้องตรวจคู่มือฉบับต้นฉบับ ขอบเขตของข้อความและแหล่งข่าวเดิมก่อนใช้ข้อมูลเพิ่มเติม"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic TESTA manual update",inputFormat:"text",
 sourceKind:"news_media",sourceLanguage:"en",sourceChannel:"news_media",contentTypes:["other"],sourceChat:"Disposable synthetic fixture",sourceUrl:"https://example.org/manual",
 eventDate:"2026-10-01",publicationDate:"2026-10-01",originalDocumentAccess:"not_obtained",
 extractedText:"SYNTHETIC: TESTA states that the manual instructions are in the appendix.",researchReview:review};
async function seed(p:string,text:string){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),text);(await import("../vault/indexer")).reindexPath(p);}
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"review-reuse-")));vault=path.join(root,"vault");
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,11).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 await seed("01_Companies/TESTA.md","# TESTA\n");await seed("05_Thesis/TESTA - Current Thesis.md","# protected fixture\n");});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"utf8")).toBe("# protected fixture\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];vi.restoreAllMocks();});
async function prepare(input:WritebackInput){return (await import("./canonical-writeback")).prepareCanonicalWriteback(input,actor);}
async function apply(input:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input,planId:p.planId,
 authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);}
async function save(input:WritebackInput){return apply(input,await prepare(input));}
const repost:WritebackInput={...base,sourceKind:"social_repost",sourceUrl:null,eventDate:null,publicationDate:null,
 extractedText:"SYNTHETIC REPOST: TESTA manual instructions are located in the appendix, according to a forwarded message."};
it("missing origin must not turn a separately receipted Source into a second event Review",async()=>{
 const initial=await prepare(base);expect(initial.qualityIssues).toEqual([]);
 const original=await apply(base,initial);expect(original.status).toBe("saved_verified");
 const feed={...repost,captureOnly:true,researchReview:undefined};const source=await save(feed);expect(source.receipts).toHaveLength(1);
 expect(source.status).toBe("source_saved_analysis_pending");
 const p=await prepare({...repost,existingIntakeId:source.planId});
 expect(p.steps[0].state).toBe("verified_existing");
 expect(p.steps.find(s=>s.kind==="canonical_review")?.state).toBe("hold_event_review");
 expect(p.previews).toHaveLength(0);
 const result=await apply({...repost,existingIntakeId:source.planId},p);
 expect(result.receipts).toHaveLength(0);expect(result.status).toBe("hold_source_event_review");
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toHaveLength(1);
});
async function selected(){
 const original=await save(base),step=original.steps.find(s=>s.kind==="canonical_review")!;
 const bytes=fs.readFileSync(path.join(vault,step.path),"utf8");
 return {path:step.path,expectedSha256:sha(bytes),receiptId:step.receiptKey,relationship:"added_detail" as const,
  comparisonBasis:"Synthetic analyst proposal: compare the original manual statement with this forwarded detail; equivalence is not independently verified."};
}
it.each(["duplicate","added_detail","correction","contradiction"] as const)("%s selects real existing receipt; never issues a second Review or an append token",async relationship=>{
 const selection={...await selected(),relationship};
 const source=await save({...repost,captureOnly:true,researchReview:undefined});
 const input={...repost,existingIntakeId:source.planId,existingReview:selection};
 const p=await prepare(input);
 expect(p.reviewReuse.status).toBe("revision_proposal_only");
 expect(p.reviewReuse.proposal).toMatchObject({previousReviewSha256:selection.expectedSha256,
  previousReviewReceiptId:selection.receiptId,additionalSourceReceiptId:source.steps[0].receiptKey,safeEditRequest:null});
 expect(p.reviewReuse).toMatchObject({duplicateAdjudicated:false,independentEvidenceIncrement:0,writeAuthority:false});
 expect(p.previews).toHaveLength(0);
 const result=await apply(input,p);expect(result.receipts).toHaveLength(0);
 expect(sha(fs.readFileSync(path.join(vault,selection.path),"utf8"))).toBe(selection.expectedSha256);
});
it.each(["hash","receipt","scope","readback"])("existing Review %s mismatch HOLDs; Source preservation remains independently eligible",async fault=>{
 const selection=await selected();
 if(fault==="hash")selection.expectedSha256="a".repeat(64);
 if(fault==="receipt")selection.receiptId="ICW-"+"a".repeat(32);
 if(fault==="scope")await seed("01_Companies/TESTB.md","# TESTB\n");
 if(fault==="readback")fs.appendFileSync(path.join(vault,selection.path),"\nChanged outside the index\n");
 const input={...repost,entities:fault==="scope"?["TESTB"]:["TESTA"],existingReview:selection};
 const p=await prepare(input);expect(p.reviewReuse.status).toBe("hold_review_binding");
 expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
 const result=await apply(input,p);expect(result.receipts).toHaveLength(1);
 expect(result.receipts[0]).toMatchObject({path:expect.stringMatching(/^00_Inbox\/ChatGPT\//)});
});
it("selection without a written Source receipt is a proposal HOLD, never an invented receipt",async()=>{
 const selection=await selected(),p=await prepare({...repost,existingReview:selection});
 expect(p.reviewReuse.source).toMatchObject({status:"pending",receiptId:null});
 expect(p.reviewReuse.proposal).toBeNull();expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
});
it("lexical historical Review hints also prevent unknown-origin novelty, without claiming receipt binding",async()=>{
 await seed("10_Knowledge/Company Research/TESTA manual research.md","# TESTA manual research\n\nPrior synthetic manual statement; legacy analysis, not verified fact.\n");
 const p=await prepare(repost);expect(p.reviewReuse.status).toBe("hold_event_adjudication");
 expect(p.reviewReuse.candidates).toEqual([]);expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
});
it("a prior preview cannot create its per-intake Review after a relevant Review appears",async()=>{
 const pending=await prepare(repost);expect(pending.previews.map(x=>x.kind)).toEqual(["source_intake","canonical_review"]);
 await save(base);
 await expect(apply(repost,pending)).rejects.toThrow(/Authorization must exactly match/);
 expect(fs.existsSync(path.join(vault,pending.steps[1].path))).toBe(false);
 const result=await save(repost);expect(result.status).toBe("hold_source_event_review");
 expect(result.receipts).toEqual([expect.objectContaining({path:pending.steps[0].path})]);
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toHaveLength(1);
});
it("first no-URL Draft and exact retry still work; genuinely distinct dated source retains existing admission",async()=>{
 const first=await save(repost);expect(first.status).toBe("saved_verified");
 expect((await save(repost)).receipts).toHaveLength(0);
 const next={...base,sourceUrl:"https://example.org/new-manual",eventDate:"2026-11-02",publicationDate:"2026-11-02",
  extractedText:"SYNTHETIC: TESTA published a separate maintenance manual for the new unit."};
 const p=await prepare(next);expect(p.previews.map(x=>x.kind)).toEqual(["source_intake","canonical_review"]);
 expect((await apply(next,p)).status).toBe("saved_verified");
});
it("missing publication date alone is not a new event, including broker-versus-issuer coverage",async()=>{
 await save(base);
 const input={...repost,sourceKind:"broker_research" as const,sourceUrl:"https://example.org/broker-note",eventDate:"2026-10-01"};
 const p=await prepare(input);expect(p.reviewReuse.status).toBe("hold_event_adjudication");
 expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
 expect(p.reviewReuse.duplicateAdjudicated).toBe(false);
});
it.each([" ","message:forwarded-post"])("non-HTTP origin %j cannot supply missing event identity",async sourceUrl=>{
 await save(base);
 const p=await prepare({...repost,sourceUrl,eventDate:"2026-10-02",publicationDate:"2026-10-02"});
 expect(p.reviewReuse.status).toBe("hold_event_adjudication");
 expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
});
it("the exact existing-Review selection is included in the sealed Judge input binding",async()=>{
 const existingReview=await selected();await save({...repost,captureOnly:true,researchReview:undefined});
 const input={...repost,existingReview};
 const {buildResearchJudgePacket,verifyResearchJudgePacket}=await import("../vault/research-judge");
 const packet=buildResearchJudgePacket(input,actor).packet;
 expect(()=>verifyResearchJudgePacket(input,{packet},actor)).not.toThrow();
 expect(()=>verifyResearchJudgePacket({...input,existingReview:{...existingReview,relationship:"correction"}},{packet},actor)).toThrow(/input_changed/);
 expect(()=>verifyResearchJudgePacket(input,{packet},"oauth:other-fixture")).toThrow(/binding_hold/);
});
it("context budget fallback exposes receipt/trust-bound research without pretending it was selected",async()=>{
 for(let i=1;i<=8;i++)await save({...base,sourceUrl:`https://example.org/manual/${i}`,eventDate:`2026-10-0${i}`,
  publicationDate:`2026-10-0${i}`,extractedText:`SYNTHETIC: TESTA manual edition ${i} describes its own appendix.`});
 for(let i=1;i<=4;i++)await save({...base,captureOnly:true,researchReview:undefined,sourceUrl:null,eventDate:null,publicationDate:null,
  extractedText:`SYNTHETIC: TESTA forwarded manual detail ${i} without a publication date.`});
 const pack=(await import("../vault/investment-context")).buildInvestmentContextPack({question:"TESTA recent manual research",issuers:["TESTA"],maxNotes:5,maxChars:4500});
 expect(pack.researchFallback.candidates).toHaveLength(12);expect(pack.researchFallback.truncated).toBe(true);
 for(const c of pack.researchFallback.candidates){expect(c.receiptId).toMatch(/^ICW-/);expect(c.bindingStatus).toBe("receipt_bound");
  expect(pack.items.some(i=>i.path===c.path)).toBe(false);
  expect(c.researchTrust).toMatchObject({independent_evidence_increment:0,comparator_eligible:false,primary_authority:false,owner_thesis_authority:false});}
 expect(pack.researchCoverage[0].canonicalReview).toMatchObject({scanComplete:false,reasons:expect.arrayContaining(["selection_budget"])});
});
it("actual read-only and writer MCP descriptors share typed existingReview and retained Judge contract",async()=>{
 const {createMcpServer}=await import("./server"),{createSafeEditMcpServer}=await import("./safe-edit-server");
 for(const writer of [false,true]){
  const access={read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]};
  const server=writer?createSafeEditMcpServer(access):createMcpServer(access);
  const client=new Client({name:"synthetic-local-schema-only",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);
  try{const list=await client.listTools();const tool=list.tools.find(t=>t.name===(writer?"prepare_canonical_writeback":"plan_investment_writeback"))!;
   expect(tool.inputSchema.properties).toHaveProperty("existingReview");expect(tool.inputSchema.properties).toHaveProperty("researchReview");
   if(writer){expect(tool.inputSchema.properties).toHaveProperty("researchJudge");
    expect(list.tools.some(t=>t.name==="prepare_research_judge_packet")).toBe(true);}
  }finally{await client.close();await server.close();}
 }
});

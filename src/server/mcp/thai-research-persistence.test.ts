import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const actor="oauth:thai-quality-fixture";
let root:string,vault:string;
const review={headlineTh:"ข่าวตัวอย่าง MU กล่าวถึงคำสั่งซื้อที่ยังต้องตรวจสอบ",
  translationTh:"MU รายงานคำสั่งซื้อที่ยังไม่ได้ตรวจสอบโดยอิสระ\n\nคำสั่งซื้ออาจถูกยกเลิกได้และบริษัทไม่ได้รับประกันการส่งมอบ",
  whatChangedTh:"ข่าวรายงานคำสั่งซื้อเพิ่ม แต่ยังไม่ได้ตรวจหลักฐานต้นฉบับ",
  mechanismTh:"Backlog จะกลายเป็น Revenue เมื่อส่งมอบจริง จึงต้องตรวจการรับรู้รายได้และต้นทุน",
  thesisImplicationTh:"ยังไม่ปรับ Thesis หรือ EPS จนกว่าจะมีหลักฐานการส่งมอบ",
  counterEvidenceTh:"คำสั่งซื้ออาจถูกยกเลิกและต้นทุนอาจเพิ่มขึ้น",
  requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและงวดที่รับรู้รายได้"};
const input:WritebackInput={domain:"company",entities:["MU"],topic:"Synthetic backlog source",
  inputFormat:"text",sourceKind:"news_media",sourceLanguage:"en",sourceChat:"RI-001 isolated language fixture",
  extractedText:"MU reported backlog that has not been independently verified.\n\nOrders can be cancelled and shipment is not guaranteed.",
  contentTypes:["reported_fact"],sourceChannel:"news_media",originalDocumentAccess:"excerpt_only",researchReview:review};
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-thai-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
  for(const p of ["01_Companies/MU.md","05_Thesis/MU - Current Thesis.md","06_Portfolio/Positions.md"]){
    fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# Protected fixture\n");
    (await import("../vault/indexer")).reindexPath(p);
  }
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","M55_REQUIRE_TYPED_REVIEW"])delete process.env[k];
});
async function plan(data:WritebackInput=input){return (await import("../vault/investment-writeback-router")).planInvestmentWriteback(data);}
async function prepare(data:WritebackInput=input){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function apply(data:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input:data,planId:p.planId,
  authorizations:p.previews.map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);}

describe("RI-001 Thai persistence quality boundary",()=>{
  it.each([undefined,"0","1"])("holds English-only freeform in planner and prepare regardless of the old flag %s",async flag=>{
    if(flag!==undefined)process.env.M55_REQUIRE_TYPED_REVIEW=flag;
    const data={...input,researchReview:undefined,completedAnalysis:"The backlog supports growth. The current thesis should remain unchanged until delivery is verified."};
    const w=(await plan(data)).safeEditWorkflow!;
    expect(w.qualityIssues).toContain("typed_research_review_required");
    expect(w.steps.map(s=>s.state)).toEqual(["needs_create","hold_quality_gate"]);
    expect(w.steps[1].safeEditRequest).toBeNull();expect(w.readyForNextNews).toBe(false);
    const p=await prepare(data);expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
    expect(p.qualityIssues).toContain("typed_research_review_required");
    expect(p.steps.some(s=>s.kind==="canonical_review"&&fs.existsSync(path.join(vault,s.path)))).toBe(false);
  });
  it.each(["ก English-only analysis with no Thai explanation.",
    "คำอธิบายภาษาไทยที่มีความยาวเพียงพอสำหรับส่วนนี้\n\nThis unrelated English paragraph is still not a Thai analysis.",
    "๑๒๓ Revenue and EPS improve. The language gate must not treat digits as Thai narration."])("rejects token/padding bypass %s",async text=>{
    const w=(await plan({...input,researchReview:{...review,whatChangedTh:text}})).safeEditWorkflow!;
    expect(w.qualityIssues).toContain("whatChangedTh_thai_required");expect(w.steps[1].safeEditRequest).toBeNull();
  });
  it("keeps technical terms, figures and quoted English while generating Thai headings and preserving original bytes",async()=>{
    const data={...input,completedAnalysis:"Legacy English analysis must not be persisted instead of the typed Thai Review.",researchReview:{...review,mechanismTh:'MU ใช้ Backlog และ FCF ประกอบการประเมิน แต่ต้องตรวจสอบการส่งมอบจริงและต้นทุน\n\n> "Orders can be cancelled and shipment is not guaranteed."'}};
    const p=await plan(data),w=p.safeEditWorkflow!;
    expect(w.qualityIssues).toEqual([]);
    const source=w.steps[0].safeEditRequest!.change.content,content=w.steps[1].safeEditRequest!.change.content;
    expect(source).toContain(input.extractedText);expect(content).toContain(review.translationTh);
    expect(content).not.toContain(data.completedAnalysis);
    expect(content).toContain('"Orders can be cancelled and shipment is not guaranteed."');
    for(const heading of content.split("\n").filter(x=>/^#{1,6} /.test(x)))expect(heading).toMatch(/[ก-ฮ]/u);
    const prepared=await prepare(data),saved=await apply(data,prepared);expect(saved.status).toBe("saved_verified");
    const {db}=await import("../db");const receipts=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    const bytes=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)));
    const repeat=await prepare(data);expect(repeat.previews).toEqual([]);expect(repeat.workflowStatus).toBe("saved_verified");
    expect(repeat.steps.map(s=>s.receiptKey)).toEqual(saved.steps.map(s=>s.receiptKey));
    expect((await apply(data,repeat)).receipts).toEqual([]);
    expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(bytes);
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(receipts);
    for(const p of ["05_Thesis/MU - Current Thesis.md","06_Portfolio/Positions.md"])expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Protected fixture\n");
  });
  it("does not require duplicate translation for Thai news; English news without Thai translation holds",async()=>{
    const noTranslation={...review,translationTh:undefined};
    const thai=await plan({...input,sourceLanguage:"th",extractedText:"ข่าวสมมติรายงานคำสั่งซื้อที่ยังต้องตรวจหลักฐาน",researchReview:noTranslation});
    expect(thai.safeEditWorkflow!.qualityIssues).toEqual([]);
    expect(thai.safeEditWorkflow!.steps[1].safeEditRequest!.change.content).not.toContain("## คำแปลจากต้นฉบับ");
    expect((await plan({...input,researchReview:noTranslation})).safeEditWorkflow!.qualityIssues).toContain("foreign_source_translation_missing");
    expect((await plan({...input,researchReview:{...review,translationTh:"ก This is not a Thai translation."}})).safeEditWorkflow!.qualityIssues).toContain("translation_not_thai");
  });
  it("captures Source only then creates the first typed Review without changing Source identity",async()=>{
    const capture={...input,researchReview:undefined,captureOnly:true};
    const p=await prepare(capture),saved=await apply(capture,p);expect(saved.status).toBe("source_saved_analysis_pending");
    const bytes=fs.readFileSync(path.join(vault,saved.steps[0].path));
    const next=await prepare();expect(next.planId).toBe(p.planId);expect(next.steps[0].state).toBe("verified_existing");
    expect(next.previews.map(x=>x.kind)).toEqual(["canonical_review"]);expect((await apply(input,next)).status).toBe("saved_verified");
    expect(fs.readFileSync(path.join(vault,saved.steps[0].path))).toEqual(bytes);
  });
  it("exposes the same typed Review shape to read-only MCP and Safe Edit and accepts it over the protocol",async()=>{
    const {createMcpServer}=await import("./server");const {createSafeEditMcpServer}=await import("./safe-edit-server");
    const read=createMcpServer({read:true,write:false,label:"ri-language-read"});
    const safe=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
    const clients:Client[]=[];
    try{
      for(const server of [read,safe]){const [a,b]=InMemoryTransport.createLinkedPair();const c=new Client({name:"ri-language-fixture",version:"1"});clients.push(c);await server.connect(b);await c.connect(a);}
      const r=(await clients[0].listTools()).tools.find(t=>t.name==="plan_investment_writeback")!;
      const s=(await clients[1].listTools()).tools.find(t=>t.name==="prepare_canonical_writeback")!;
      expect(r.inputSchema.properties!.researchReview).toEqual(s.inputSchema.properties!.researchReview);
      for(const key of ["sourceChannel","attributedOrigin","originalDocumentAccess"])expect(r.inputSchema.properties).toHaveProperty(key);
      const response=await clients[0].callTool({name:r.name,arguments:{...input}});expect(response.isError).not.toBe(true);
      const result=JSON.parse((response.content as {text:string}[])[0].text);
      expect(result.safeEditWorkflow.qualityIssues).toEqual([]);
      expect(result.safeEditWorkflow.steps[1].state).toBe("needs_create");
      const malformed=await clients[0].callTool({name:r.name,arguments:{...input,researchReview:{headlineTh:"ขาดข้อมูล"}}});expect(malformed.isError).toBe(true);
    }finally{await Promise.allSettled(clients.map(c=>c.close()));await read.close();await safe.close();}
  });
  it("preserves independently receipted historical English headings and receipt identities on an identical retry",async()=>{
    const p=await plan(),{preview,apply:write}=await import("../safe-edit/engine");
    const translations=[['# บทวิเคราะห์การลงทุน —','# Investment Review —'],['## ที่มาของต้นฉบับ','## Source provenance'],['## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)','## Research analysis (AI interpretation; not approved Thesis)'],['## การเชื่อมโยงความรู้','## Canonical knowledge links'],['## ขอบเขตความปลอดภัยในการบันทึก','## Ingestion safety'],['## สิ่งที่เปลี่ยนแปลงและข้อมูลใหม่เทียบกับข้อมูลเดิม','## What Changed / New vs Known'],['## กลไกพื้นฐานและเศรษฐกิจมหภาค','## Fundamental / Macro Mechanism'],['## ผลต่อสมมติฐานการลงทุนและมูลค่า','## Thesis & Valuation Implication'],['## หลักฐานโต้แย้งและความเสี่ยง','## Counter-evidence'],['## หลักฐานที่ต้องตรวจสอบและประเด็นติดตาม','## Required Evidence / What to Watch']];
    const ids:string[]=[],bytes:string[]=[];
    for(const step of p.safeEditWorkflow!.steps){const request=step.safeEditRequest!;let content=request.change.content;
      if(step.kind==="canonical_review")for(const [current,old] of translations)content=content.replace(current,old);
      const operationId="ICW-"+sha([step.kind,step.path,sha(content)].join("\n")).slice(0,32);
      const pre=preview({...request,operationId,change:{kind:"create",content}},actor);
      write({operationId,previewToken:pre.previewToken,expectedHash:pre.beforeHash},actor);ids.push(operationId);bytes.push(content);
    }
    const {db}=await import("../db");const receipts=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    const repeat=await prepare();expect(repeat.workflowStatus).toBe("saved_verified");expect(repeat.previews).toEqual([]);
    expect(repeat.steps.map(s=>s.receiptKey)).toEqual(ids);
    expect(repeat.steps.map(s=>fs.readFileSync(path.join(vault,s.path),"utf8"))).toEqual(bytes);
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(receipts);
    const changed=await prepare({...input,researchReview:{...review,whatChangedTh:"ข้อความเปลี่ยนแปลงที่ไม่ตรงกับประวัติเดิม"}});
    expect(changed.steps[1].state).toBe("hold_conflict");expect(changed.previews).toEqual([]);
  });
});


describe("RI-001 calibrated language gate across persistence modes",()=>{
  const english="MU reported backlog that has not been independently verified. Orders can be cancelled and shipment is not guaranteed.";
  const attacks=[
    `คำแปลภาษาไทย: "${english}"`,
    `สรุปเป็นภาษาไทย\n\n> ${english}`,
    `คำอธิบายภาษาไทย\n\n\x60\x60\x60text\n${english}\n\x60\x60\x60`,
    `คำอธิบายภาษาไทย\n\n~~~text\n${english}\n~~~`
  ];
  it.each(["text","pdf"] as const)("holds quote/code substitutions for English %s while retaining exact source-only capture",async inputFormat=>{
    for(const text of attacks){
      const data={...input,inputFormat,researchReview:{...review,translationTh:text,mechanismTh:text}};
      const p=await prepare(data);expect(p.qualityIssues).toEqual(expect.arrayContaining(["translation_not_thai","mechanismTh_thai_required"]));
      expect(p.steps[1].state).toBe("hold_quality_gate");expect(p.previews.every(x=>x.kind==="source_intake")).toBe(true);
      expect(p.readyForNextNews).toBe(false);
    }
    const data={...input,inputFormat,researchReview:{...review,translationTh:attacks[0]}};
    const p=await prepare(data),saved=await apply(data,p);expect(saved.readyForNextNews).toBe(false);
    expect(saved.steps[0].state).toBe("verified_existing");expect(saved.steps[1].state).toBe("hold_quality_gate");
    expect(fs.readFileSync(path.join(vault,saved.steps[0].path),"utf8")).toContain(input.extractedText);
    expect(fs.existsSync(path.join(vault,saved.steps[1].path))).toBe(false);
    const retry={...input,inputFormat,researchReview:{...review,mechanismTh:"Revenue เพิ่ม แต่ EBITDA Margin ลด ขณะที่ Guidance ชี้ว่า FCF และ ROIC ยังอ่อน"}};
    const fixed=await prepare(retry);expect(fixed.planId).toBe(saved.planId);expect(fixed.qualityIssues).toEqual([]);
    expect(fixed.previews.map(x=>x.kind)).toEqual(["canonical_review"]);expect((await apply(retry,fixed)).status).toBe("saved_verified");
  });
  it.each(["th","en"])("retains translation policy, technical terms and exact bytes for %s news",async sourceLanguage=>{
    const extractedText=sourceLanguage==="th"?"บริษัทอ้างคำสั่งซื้อเพิ่มแต่ยังต้องตรวจต้นฉบับ และคำสั่งซื้ออาจถูกยกเลิก":input.extractedText;
    const data={...input,sourceLanguage,extractedText,researchReview:{...review,translationTh:sourceLanguage==="th"?undefined:review.translationTh,
      mechanismTh:"Revenue, EBITDA, Margin, Guidance, FCF, ROIC ดีขึ้นแต่ยังต้องติดตาม"}};
    const p=await prepare(data);expect(p.qualityIssues).toEqual([]);const saved=await apply(data,p);expect(saved.status).toBe("saved_verified");
    expect(fs.readFileSync(path.join(vault,saved.steps[0].path),"utf8")).toContain(extractedText);
    const content=fs.readFileSync(path.join(vault,saved.steps[1].path),"utf8");expect(content.includes("## คำแปลจากต้นฉบับ")).toBe(sourceLanguage!=="th");
    const before=(await import("../db")).db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all(),bytes=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)));
    const again=await prepare(data);expect(again.previews).toEqual([]);expect(again.workflowStatus).toBe("saved_verified");
    expect((await import("../db")).db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(before);
    expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(bytes);
    for(const pathName of ["05_Thesis/MU - Current Thesis.md","06_Portfolio/Positions.md"])expect(fs.readFileSync(path.join(vault,pathName),"utf8")).toBe("# Protected fixture\n");
  });
  it("Feed Only still captures an untranslated English PDF excerpt without proposing a Review",async()=>{
    const data={...input,inputFormat:"pdf" as const,researchReview:undefined,captureOnly:true};const p=await prepare(data),saved=await apply(data,p);
    expect(p.qualityIssues).toEqual([]);expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
    expect(saved.status).toBe("source_saved_analysis_pending");expect(saved.steps).toHaveLength(1);
    expect(fs.readFileSync(path.join(vault,saved.steps[0].path),"utf8")).toContain(input.extractedText);
    expect((await plan(data)).safeEditWorkflow!.sourcePreservation).toBe("text_only_binary_not_verified");
  });
  it("revalidation holds an old quote bypass without rewriting its accepted bytes or receipts",async()=>{
    const data={...input,researchReview:{...review,translationTh:attacks[0]}};
    const w=(await plan()).safeEditWorkflow!,{preview,apply:write}=await import("../safe-edit/engine");
    const accepted:string[]=[];
    // Reconstruct a previously accepted pre-calibration create through the real
    // Safe Edit engine, never by inserting a fabricated DB receipt.
    for(const step of w.steps){
      const req=step.safeEditRequest!;let content=req.change.content;
      if(step.kind==="canonical_review")content=content.replace(review.translationTh,attacks[0]);
      const operationId="ICW-"+sha([step.kind,step.path,sha(content)].join("\n")).slice(0,32);
      const p=preview({...req,operationId,change:{kind:"create",content}},actor);
      write({operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);accepted.push(content);
    }
    const {db}=await import("../db"),before=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    const repeat=await prepare(data);expect(repeat.qualityIssues).toContain("translation_not_thai");expect(repeat.previews).toEqual([]);expect(repeat.readyForNextNews).toBe(false);
    expect(repeat.steps.map(s=>fs.readFileSync(path.join(vault,s.path),"utf8"))).toEqual(accepted);
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(before);
    for(const p of ["05_Thesis/MU - Current Thesis.md","06_Portfolio/Positions.md"])expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Protected fixture\n");
  });
});

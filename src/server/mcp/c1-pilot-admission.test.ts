/** Real disposable Safe Edit/receipts and MCP; simulated semantic findings test
 * enforcement only. No model identity, independent critic or semantic quality
 * is established by CI. Prior Source is created through the actual engine. */
import {it,expect,beforeEach,afterEach,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {JudgeResult} from "../vault/research-judge";
// Only the authenticated dashboard session is simulated. The real Safe Edit,
// synchronization admission, Judge, HMAC, receipt and filesystem paths run.
const sessionState=vi.hoisted(()=>({signedIn:true}));
vi.mock("../auth",()=>({runAuthMigrations:async()=>{},auth:{api:{getSession:async()=>sessionState.signedIn?{user:{id:"SIMULATED-REVIEWER"}}:null}}}));
const actor="oauth:risk-draft-fixture";
const text="TESTA แจ้งกำหนดการเยี่ยมชมโรงงาน โดยเพิ่มช่องทางติดต่อฝ่ายประชาสัมพันธ์ ไม่มีรายละเอียดเพิ่มเติมในข้อความที่ได้รับ";
const prior="TESTA แจ้งกำหนดการเยี่ยมชมโรงงาน โดยยังไม่ได้ระบุช่องทางติดต่อฝ่ายประชาสัมพันธ์";
const review={headlineTh:"TESTA เพิ่มช่องทางติดต่อเกี่ยวกับกำหนดการเยี่ยมชมโรงงาน",
 whatChangedTh:"ข้อความที่ได้รับเพิ่มช่องทางติดต่อฝ่ายประชาสัมพันธ์จากข้อมูลกำหนดการเดิม ยังไม่ได้ตรวจสอบประกาศต้นฉบับโดยอิสระ",
 mechanismTh:"รายละเอียดนี้ช่วยติดตามกิจกรรมและเอกสารของบริษัทเท่านั้น ยังไม่มีหลักฐานแสดงผลต่อการดำเนินธุรกิจ",
 thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือมูลค่าบริษัทจากข้อความเกี่ยวกับช่องทางติดต่อนี้",
 counterEvidenceTh:"กำหนดการอาจเปลี่ยนแปลงได้และยังไม่ทราบว่าเป็นประกาศฉบับสุดท้ายหรือไม่ ต้องติดตามเอกสารเพิ่มเติม",
 requiredEvidenceTh:"ตรวจประกาศกำหนดการต้นฉบับและช่องทางติดต่อกับบริษัทก่อนใช้ ข้อความนี้เป็นข้อมูลทดสอบ ไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"TESTA กำหนดการเยี่ยมชมโรงงาน",sourceKind:"news_media",sourceLanguage:"th",
 sourceUrl:"https://example.org/routine/new",sourceChat:"disposable risk fixture",sourceChannel:"chat",inputFormat:"text",originalDocumentAccess:"not_obtained",
 extractedText:text,contentTypes:["other"],researchReview:review};
let root:string,vault:string,historyPath:string,fixtureConnection:{close:()=>void};
const protectedPaths=["05_Thesis/TESTA - Current Thesis.md","06_Portfolio/Positions.md","08_Daily_Weekly/Research Indexes/Company Evolution - TESTA.md"];
beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-c1-pilot-")));vault=path.join(root,"vault");
 process.env.C1_RESEARCH_PILOT="disposable";sessionState.signedIn=true;process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,8).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 for(const p of ["01_Companies/TESTA.md",...protectedPaths]){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# TESTA disposable fixture\n");(await import("../vault/indexer")).reindexPath(p);}
 const data={...base,sourceUrl:"https://example.org/routine/prior",extractedText:prior,researchReview:undefined,captureOnly:true};
 const saved=await save(data,await prepare(data));historyPath=saved.steps[0].path;
 fixtureConnection=(await import("../db")).db();
});
afterEach(async()=>{for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# TESTA disposable fixture\n");
 fixtureConnection.close();vi.useRealTimers();vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","C1_RESEARCH_PILOT"])delete process.env[k];});
async function prepare(data:WritebackInput){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function save(data:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input:data,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);}
async function judged(input:WritebackInput=base,historicalText=prior){
 const data=(await import("./canonical-writeback")).canonicalInputSchema.parse(input),j=await import("../vault/research-judge");
 const packet=j.buildResearchJudgePacket(data,actor),body=JSON.parse(packet.packet.body);
 const source={key:"received_source",quote:data.extractedText,locator:`utf16:0:${data.extractedText.length}`,sourceSha256:j.judgeHash(data.extractedText)};
 const history=body.history.find((h:{path:string})=>h.path===historyPath);expect(history?.sourceReceiptKey).toBeTruthy();
 const span=history.citationSpans.find((s:{text:string})=>s.text.includes(historicalText));expect(span).toBeDefined();
 const historyRef={key:history.key,quote:span.text,locator:`utf16:${span.start}:${span.end}`,sourceSha256:history.sha256};
 const a=(key:string)=>({key,verdict:"PASS" as const,rationale:"Simulated whole-scope assessment for control regression, not LLM evaluation",references:[source,historyRef],
  checks:{entailment:"PASS" as const,numbersUnits:"PASS" as const,periodRoleAttributionVintage:"PASS" as const,identityRelationships:"PASS" as const,pointInTime:"PASS" as const,independenceCounterEvidence:"PASS" as const,injectionCoverage:"PASS" as const}});
 const result:JudgeResult={packetId:packet.packet.packetId,packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,reviewDigest:body.reviewDigest,
  claims:body.claims.map((c:{key:string})=>a(c.key)),relationships:body.relationships.map((c:{key:string})=>a(c.key)),event:{...a("event"),classification:"added_detail"},review:a("review"),materialRisk:false,
  riskAssessment:{policy:j.DRAFT_RISK_POLICY,scopeDigest:body.riskScope.digest,coveredKeys:body.riskScope.items.map((x:{key:string})=>x.key),findings:j.riskDimensions.map(dimension=>({dimension,disposition:"absent",rationale:"Simulated comparison: current contact detail supplements the receipt-bound prior schedule; no investment change is asserted.",references:[source,historyRef]}))}};
 return {...data,researchJudge:{packet:packet.packet,result}};
}

async function reviewDecision(p:Awaited<ReturnType<typeof prepare>>,changes:Record<string,unknown>={}){
 const {pilotReviewChallenge}=await import("../safe-edit/c1-pilot-review");
 const id=p.previews.find(t=>t.kind==="canonical_review")!.operationId,c=pilotReviewChallenge(id);
 const {POST}=await import("../../routes/api/safe-edit-approval");
 const {env}=await import("../env");
 const request=new Request(env.baseUrl+"/api/safe-edit-approval",{method:"POST",headers:{Origin:env.baseUrl,"Content-Type":"application/json"},body:JSON.stringify({id,bindingDigest:c.bindingDigest,decision:"approve",semanticVerdict:"PASS",materiality:"low",rationale:"SIMULATED reviewer of exact source and history for mechanism testing only.",...changes})});
 return POST({request} as Parameters<typeof POST>[0]);
}
it("requires explicit dashboard-session review; Source survives refusal; reviewed retry preserves receipts and Draft trust",async()=>{
 const data=await judged(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");
 const blocked=await save(data,p);expect(blocked.receipts).toHaveLength(1);expect(blocked.interrupted).toContain("c1_pilot_explicit_current_review_required");
 expect(fs.existsSync(path.join(vault,p.steps.find(t=>t.kind==="canonical_review")!.path))).toBe(false);
 // Fresh preview after partial Source persistence, then explicit review of ALL targets.
 const retry=await prepare(data),decision=await reviewDecision(retry);expect(decision.status).toBe(200);expect(await decision.text()).toContain('"effective":"PASS"');
 const saved=await save(data,retry);expect(saved.status,JSON.stringify((await prepare(data)).researchJudge)).toBe("saved_verified");expect(saved.receipts).toHaveLength(1);
 const reviewPath=saved.steps.find(s=>s.kind==="canonical_review")!.path;
 const {readNoteRange}=await import("../vault/notes");
 expect(readNoteRange(reviewPath).researchTrust).toMatchObject({research_status:"draft",usage_tier:"historical_analysis_only",comparator_eligible:false,independent_evidence_increment:0,critic_independence:"not_verified"});
 const admission=(await import("../db")).db().prepare("SELECT detail FROM safe_edit_events WHERE event='c1_pilot_write_admitted'").get() as {detail:string};
 expect(JSON.parse(admission.detail)).toMatchObject({humanPresence:"not_verified",criticIndependence:"not_verified"});
 expect((await prepare(data)).previews).toEqual([]);
});
it.each([{semanticVerdict:"HOLD"},{semanticVerdict:"FAIL"},{materiality:"unresolved"},{materiality:"material"},{decision:"reject"}])("approve cannot override reviewer restriction %j",async changes=>{
 const data=await judged(),p=await prepare(data);expect((await reviewDecision(p,changes)).status).toBe(200);
 await expect(save(data,p)).rejects.toThrow();
 const held=await prepare(data);expect(held.previews.every(t=>t.kind==="source_intake")).toBe(true);
 expect((await save(data,held)).receipts).toHaveLength(1);
 await expect(reviewDecision(p)).rejects.toThrow(); // cannot erase a terminal decision on the same packet
});
it("fresh unreviewed intake permits only canonical Source; generic source/type spoof and legacy approval cannot enroll",async()=>{
 const p=await prepare(base);expect(p.previews.map(t=>t.kind)).toEqual(["source_intake"]);
 expect((await save(base,p)).receipts).toHaveLength(1);
 const e=await import("../safe-edit/engine");
 expect(()=>e.preview({path:"10_Knowledge/Company Research/Unreviewed.md",change:{kind:"create",content:"---\nintake_id: IN-0000000000000000\ntype: investment_source_intake\n---\nUnreviewed"}},actor)).toThrow();
 const data=await judged(),j=await prepare(data),t=j.previews.find(s=>s.kind==="canonical_review")!;
 expect(()=>e.approve(t.operationId,"SIMULATED",t.afterHash)).toThrow(/explicit_bundle_review/);
 expect(()=>e.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow();
});
it.each(["wrong actor","history drift","expired review","changed diff","forged approval"])("%s cannot use a reviewed token",async fault=>{
 const data=await judged(),p=await prepare(data),t=p.previews.find(t=>t.kind==="canonical_review")!;
 expect((await reviewDecision(p)).status).toBe(200);
 if(fault==="history drift"){fs.appendFileSync(path.join(vault,historyPath),"\nChanged history\n");(await import("../vault/indexer")).reindexPath(historyPath);}
 if(fault==="expired review"){vi.useFakeTimers();vi.setSystemTime(Date.now()+16*60_000);}
 if(fault==="changed diff")await prepare(data); // even exact-byte new preview rotates the reviewed token
 const e=await import("../safe-edit/engine");
 if(fault==="forged approval"){
  // Raw writer caller cannot replace an authenticated checkpoint with payload fields.
  const result=await reviewDecision(p,{bindingDigest:"0".repeat(64)});expect(result.status).toBe(400);
  const other=await judged({...base,sourceUrl:"https://example.org/routine/other"}),newPlan=await prepare(other),newToken=newPlan.previews.find(t=>t.kind==="canonical_review")!;
  expect(()=>e.apply({operationId:newToken.operationId,previewToken:newToken.previewToken,expectedHash:newToken.beforeHash,approval:true},actor)).toThrow();
  expect(fs.existsSync(path.join(vault,newToken.path))).toBe(false);return;
 }
 expect(()=>e.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},fault==="wrong actor"?"oauth:intruder":actor)).toThrow();
 expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
});
it.each(["HOLD","FAIL"] as const)("backend %s overrides existing review approval, with Source still eligible",async verdict=>{
 const data=await judged(),p=await prepare(data);expect((await reviewDecision(p)).status).toBe(200);
 data.researchJudge.result.review.verdict=verdict;const restricted=await prepare(data);expect(restricted.researchJudge?.decision).toBe(verdict);
 expect(restricted.previews.every(t=>t.kind==="source_intake")).toBe(true);expect((await save(data,restricted)).receipts).toHaveLength(1);
 const t=p.previews.find(t=>t.kind==="canonical_review")!,e=await import("../safe-edit/engine");
 expect(()=>e.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow();
 expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
});
it.each([
 {brokerUpdate:{bank:"Fixture broker",rating:"Buy"}},
 {extractedText:text+" The tour is on 2026-11-12."},
])("material broker or numeric/date scope retains backend HOLD: %j",async delta=>{
 const data=await judged({...base,...delta}),p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");
 expect(p.previews.every(t=>t.kind==="source_intake")).toBe(true);expect((await save(data,p)).receipts).toHaveLength(1);
});
it("raw writes, legacy importer, sync and fresh generic targets cannot bypass the whole-instance restriction",async()=>{
 const notes=await import("../vault/notes"),disk=await import("../vault/disk"),folders=await import("../vault/folders");
 const raw="10_Knowledge/Company Research/Raw.md",abs=path.join(vault,raw);
 for(const run of [()=>notes.createNote(raw,"Raw"),()=>disk.writeVaultFile(abs,"Raw"),()=>notes.moveNote(historyPath,raw),()=>notes.deleteNote(historyPath),()=>folders.moveFolder("00_Inbox","Moved"),()=>folders.deleteFolder("00_Inbox"),()=>importEnginePreview()])expect(run).toThrow(/c1_pilot/);
 expect(()=> (requireImporter())({},vault)).toThrow(/c1_pilot/);
 expect(()=> (enqueueFn())({})).toThrow(/c1_pilot/);
 await expect((await import("../ob/cli")).runOb(["sync"])).rejects.toThrow(/c1_pilot/);
 await expect((await import("../sync/git-exec")).runGit(["reset","--hard"])).rejects.toThrow(/c1_pilot/);
 await expect((await import("../sync/git-exec")).runGitBuffer(["reset","--hard"])).rejects.toThrow(/c1_pilot/);
 (await import("../ob/supervisor")).supervisor().start();(await import("../sync/git")).gitBackend().start();
 (await import("../cloud-intake")).processCloudIntake();(await import("../cloud-intake")).ensureCloudIntakeStarted();
 expect((await import("../ob/supervisor")).supervisor().isQuiescent()).toBe(true);expect((await import("../sync/git")).gitBackend().isQuiescent()).toBe(true);
 expect(fs.existsSync(abs)).toBe(false);
});
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const requireImporter=()=>require("../../../scripts/intake-importer.cjs").importItem;
let engine:typeof import("../safe-edit/engine"),intakeModule:typeof import("../intake");
beforeEach(async()=>{engine=await import("../safe-edit/engine");intakeModule=await import("../intake");});
const enqueueFn=()=>intakeModule.enqueue;
const importEnginePreview=()=>engine.preview({operationId:"PILOT-RAW-01",reason:"Synthetic bypass attempt",path:"10_Knowledge/Company Research/Raw.md",change:{kind:"create",content:"Raw"}},actor);

it("F1 rejects a generic alias operation ID even for the exact reviewed path and bytes",async()=>{
 const data=await judged(),p=await prepare(data);expect((await reviewDecision(p)).status).toBe(200);
 const t=p.previews.find(t=>t.kind==="canonical_review")!;
 const {db}=await import("../db");
 const original=db().prepare("SELECT payload FROM safe_edit_operations WHERE id=?").get(t.operationId) as {payload:string};
 const alias={...JSON.parse(original.payload),operationId:"C1-UNREVIEWED-ALIAS"};
 expect(()=>engine.preview(alias,actor)).toThrow(/c1_pilot/);
 expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
});

it("F2 removing the pilot flag cannot reopen a raw writer on initialized pilot data",async()=>{
 const notes=await import("../vault/notes");
 delete process.env.C1_RESEARCH_PILOT;
 try{
  expect(()=>notes.createNote("10_Knowledge/Company Research/Flag removed.md","Unreviewed")).toThrow(/c1_pilot/);
  expect(fs.existsSync(path.join(vault,"10_Knowledge/Company Research/Flag removed.md"))).toBe(false);
 }finally{process.env.C1_RESEARCH_PILOT="disposable";}
});

it("dashboard rejects OAuth-only/absent session, cross-origin, forged digest and injected markup",async()=>{
 const data=await judged(),p=await prepare(data),id=p.previews.find(t=>t.kind==="canonical_review")!.operationId;
 const {GET,POST}=await import("../../routes/api/safe-edit-approval"),{env}=await import("../env");
 const get=new Request(env.baseUrl+"/api/safe-edit-approval?id="+id);
 sessionState.signedIn=false;expect((await GET({request:get} as Parameters<typeof GET>[0])).status).toBe(401);expect((await reviewDecision(p)).status).toBe(401);
 sessionState.signedIn=true;
 const rendered=await GET({request:get} as Parameters<typeof GET>[0]);expect(rendered.status).toBe(200);expect(await rendered.text()).toContain("dashboard-session attestation only");
 const req=new Request(env.baseUrl+"/api/safe-edit-approval",{method:"POST",headers:{Origin:"https://attacker.test"},body:"id="+id});
 expect((await POST({request:req} as Parameters<typeof POST>[0])).status).toBe(403);
 expect((await reviewDecision(p,{bindingDigest:"0".repeat(64)})).status).toBe(400);
 expect((await save(data,p)).receipts).toHaveLength(1);
});

it("actual MCP exposes packet/result contract, not reviewer authority; generic apply and fresh-intake attempts are refused",async()=>{
 const data=await judged(),{createSafeEditMcpServer}=await import("./safe-edit-server"),server=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"C1-PILOT-MECHANISM-NOT-CHATGPT",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 const call=async(name:string,args:object)=>client.callTool({name,arguments:args as Record<string,unknown>});
 try{
  const tools=await client.listTools();expect(JSON.stringify(tools)).toContain("researchJudge");expect(tools.tools.some(t=>t.name==="prepare_research_judge_packet")).toBe(true);expect(tools.tools.some(t=>/approv|review_decision/.test(t.name))).toBe(false);
  const response=await call("prepare_canonical_writeback",data);expect(response.isError).not.toBe(true);
  const outer=JSON.parse((response.content as {text:string}[])[0].text),p=JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));
  const t=p.previews.find((t:{kind:string})=>t.kind==="canonical_review");
  expect((await call("apply_edit",{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash})).isError).toBe(true);
  expect((await call("preview_edit",{operationId:"PILOT-MCP-RAW",reason:"Synthetic raw bypass probe",path:"10_Knowledge/Company Research/Raw.md",change:{kind:"create",content:"Raw"}})).isError).toBe(true);
  expect((await reviewDecision(p,{semanticVerdict:"HOLD"})).status).toBe(200);
  expect((await call("apply_canonical_writeback",{input:data,planId:p.planId,authorizations:p.previews.map((t:{operationId:string;previewToken:string;beforeHash:string})=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))})).isError).toBe(true);
  expect((await call("apply_edit",{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash})).isError).toBe(true);
  expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
 }finally{await client.close();await server.close();}
});

// NEW synthetic cases from the ORCH scenario contract. These are not the lost
// WORK fixtures and do not reproduce its historical 27/27 controller result.
const scenarios=[
 {name:"Quay",history:"TESTA เปิดเผยว่ามีลูกค้ายกเลิกสัญญาแล้ว แต่ยังไม่มีรายละเอียดเกี่ยวกับขนาดลูกค้า",
  source:"TESTA เปิดเผยเพิ่มเติมว่าลูกค้าที่ยกเลิกสัญญาเป็นลูกค้ารายใหญ่ที่สุด ใช้กำลังการผลิตส่วนสำคัญ และยังไม่มีงานทดแทน",
  prose:"การสูญเสียลูกค้ารายใหญ่โดยยังไม่มีงานทดแทนอาจกดดันการใช้กำลังการผลิต การกระจายต้นทุนคงที่ กำไรและกระแสเงินสด ต้องตรวจสัดส่วนธุรกิจก่อนสรุปขนาดผลกระทบ",
  semantic:"HOLD" as const,materiality:"material" as const,rationale:"NEW synthetic Quay preflight: Source and prior cancellation history establish a potentially material utilization and fixed-cost mechanism; absent findings omit that risk. No quantified earnings conclusion is established."},
 {name:"Vela",history:"TESTA ใช้เครดิตจากผู้จัดส่งวัตถุดิบช่วยรองรับระยะเวลารอเก็บเงินจากลูกค้า",
  source:"TESTA แจ้งว่าผู้จัดส่งวัตถุดิบเปลี่ยนเงื่อนไขเป็นชำระก่อนเริ่มผลิต ขณะที่ราคาขายและปริมาณคำสั่งซื้อไม่เปลี่ยน",
  prose:"เมื่อราคาขายและปริมาณคำสั่งซื้อไม่เปลี่ยน จึงสรุปว่าเงินทุนหมุนเวียน สภาพคล่อง และกระแสเงินสดอิสระไม่มีผลกระทบจากการเปลี่ยนเงื่อนไขชำระเงิน",
  semantic:"HOLD" as const,materiality:"material" as const,rationale:"NEW synthetic Vela preflight: Comparing Source to History exposes loss of supplier credit and earlier cash payment. Unchanged price/volume does not establish unchanged liquidity or FCF; Draft's causal conclusion is unsupported."},
 {name:"Arbor",history:"TESTA มีคู่มือการใช้งานที่เผยแพร่ไว้แล้ว พร้อมคำแนะนำเกี่ยวกับการค้นหาเอกสาร",
  source:"TESTA เพิ่มคำอธิบายตำแหน่งคำแนะนำในคู่มือเดิม โดยข้อความที่ได้รับไม่ได้ระบุการเปลี่ยนแปลงการดำเนินธุรกิจ",
  prose:"เป็นรายละเอียดตำแหน่งคำแนะนำในคู่มือเดิมตามข้อความที่ได้รับ ยังไม่มีหลักฐานแสดงผลต่อรายได้ ต้นทุน ราคา หรือเงื่อนไขสัญญา จึงใช้เป็นข้อมูลประกอบการค้นหาเท่านั้น",
  semantic:"PASS" as const,materiality:"low" as const,rationale:"NEW synthetic Arbor preflight: Source adds where to find instructions in the existing manual; History confirms prior manual. Attributed Draft explicitly refrains from asserting economic changes."},
 {name:"Birch",history:"TESTA มีแผนปรับปรุงเอกสารคู่มือและยังไม่ได้ประกาศว่าเผยแพร่แล้ว",
  source:"TESTA วางแผนเผยแพร่รายละเอียดคู่มือในวันที่ 2026-11-12 โดยยังไม่ได้ยืนยันว่าการเผยแพร่เสร็จแล้ว",
  prose:"ข้อความนี้กล่าวถึงวันที่มีแผนเผยแพร่เอกสารเท่านั้น ไม่ใช่หลักฐานว่าเอกสารได้เผยแพร่จริงแล้ว ต้องตรวจสถานะเมื่อถึงกำหนด",
  semantic:"PASS" as const,materiality:"low" as const,rationale:"NEW synthetic Birch preflight: Planned publication is correctly attributed and not treated as completed. This semantic assessment cannot waive RISK-1.1 quantitative/date abstention."},
];
it.each(scenarios)("NEW synthetic $name: server enforces preflight and backend result independently",async s=>{
 const priorInput={...base,topic:"TESTA "+s.name,sourceUrl:"https://example.org/c1-new-synthetic/"+s.name+"/history",extractedText:s.history,captureOnly:true,researchReview:undefined};
 const previous=await save(priorInput,await prepare(priorInput));historyPath=previous.steps[0].path;
 const data=await judged({...base,topic:priorInput.topic,sourceUrl:"https://example.org/c1-new-synthetic/"+s.name+"/new",extractedText:s.source,
  researchReview:{...review,headlineTh:"TESTA ข้อมูลเพิ่มเติมจากข้อความทดสอบ "+s.name,whatChangedTh:s.prose,mechanismTh:s.prose,thesisImplicationTh:"เป็นบทวิเคราะห์จากข้อความที่ได้รับเท่านั้น ยังไม่เปลี่ยนสมมติฐานการลงทุนและไม่ได้รับรองข้อเท็จจริงจากแหล่งหลัก"}},s.history);
 const p=await prepare(data);
 if(s.name==="Birch"){
  expect(p.researchJudge?.decision).toBe("HOLD");expect(p.previews.map(t=>t.kind)).toEqual(["source_intake"]);
  const {recordPilotReview}=await import("../safe-edit/c1-pilot-review");
  expect(()=>recordPilotReview({id:p.previews[0].operationId,bindingDigest:"0".repeat(64),decision:"approve",semanticVerdict:"PASS",materiality:"low",rationale:s.rationale},"SIMULATED")).toThrow();
  expect((await save(data,p)).receipts).toHaveLength(1);return;
 }
 expect(p.researchJudge?.decision).toBe("PASS"); // forged absent findings can bind; binding is not reasoning truth
 expect((await reviewDecision(p,{decision:"approve",semanticVerdict:s.semantic,materiality:s.materiality,rationale:s.rationale})).status).toBe(200);
 if(s.semantic==="HOLD"){
  await expect(save(data,p)).rejects.toThrow();
  const t=p.previews.find(t=>t.kind==="canonical_review")!;
  expect(()=>engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow();
  const payload=(await import("../db")).db().prepare("SELECT payload FROM safe_edit_operations WHERE id=?").get(t.operationId) as {payload:string};
  expect(()=>engine.preview(JSON.parse(payload.payload),actor)).toThrow();
  const held=await prepare(data);expect(held.previews.map(t=>t.kind)).toEqual(["source_intake"]);expect((await save(data,held)).receipts).toHaveLength(1);
  expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
 }else{
  const saved=await save(data,p);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(2);
  const {execFileSync}=await import("node:child_process");
  const output=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/c1-pilot-cold.test.ts","--maxWorkers=1"],{env:{...process.env,C1_PILOT_COLD_PATHS:JSON.stringify(saved.steps.map(t=>t.path)),C1_PILOT_COLD_ACTOR:actor},encoding:"utf8",timeout:60000});
  expect(output).toContain("1 passed");
 }
});
it("a fresh sealed assessment and explicit new review may recover a pilot HOLD; same envelope cannot",async()=>{
 const data=await judged(),p=await prepare(data);expect((await reviewDecision(p,{semanticVerdict:"HOLD"})).status).toBe(200);
 expect((await prepare(data)).previews.every(t=>t.kind==="source_intake")).toBe(true);
 vi.useFakeTimers();vi.setSystemTime(Date.now()+1000);
 const fresh=await judged(),next=await prepare(fresh);expect(next.researchJudge?.decision).toBe("PASS");
 expect((await reviewDecision(next)).status).toBe(200);expect((await save(fresh,next)).status).toBe("saved_verified");
});
it.each(["source drift","draft drift","expired assessment","seal mismatch"])("%s cannot publish an approved non-Source bundle",async fault=>{
 const data=await judged(),p=await prepare(data);expect((await reviewDecision(p)).status).toBe(200);
 const source=p.previews[0],r=p.previews.find(t=>t.kind==="canonical_review")!;
 engine.apply({operationId:source.operationId,previewToken:source.previewToken,expectedHash:source.beforeHash},actor);
 if(fault==="source drift"){fs.appendFileSync(path.join(vault,source.path),"\nTampered disposable Source\n");(await import("../vault/indexer")).reindexPath(source.path);}
 if(fault==="draft drift")fs.writeFileSync(path.join(vault,r.path),"External disposable CAS conflict");
 if(fault==="expired assessment"){vi.useFakeTimers();vi.setSystemTime(data.researchJudge.packet.expiresAt+1);}
 if(fault==="seal mismatch"){
  data.researchJudge.packet.seal="0".repeat(64);expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");
  // Unauthenticated packets cannot revoke unrelated authority. The attempted
  // canonical apply is refused; no attacker packet grants new authority.
  await expect(save(data,p)).rejects.toThrow();return;
 }
 expect(()=>engine.apply({operationId:r.operationId,previewToken:r.previewToken,expectedHash:r.beforeHash},actor)).toThrow();
 const writes=(await import("../db")).db().prepare("SELECT count(*) n FROM safe_edit_events WHERE event='written' AND operation_id=?").get(r.operationId) as {n:number};expect(writes.n).toBe(0);
});
it("one review binds Source, both Claims and Draft; same-intake writes preserve current scope and retry",async()=>{
 const source="TESTA plant tour status is scheduled. TESTA press contact is available.";
 const data=await judged({...base,sourceLanguage:"en",extractedText:source,researchReview:{...review,translationTh:"TESTA แจ้งสถานะกิจกรรมเยี่ยมชมโรงงานว่าได้กำหนดแล้ว และมีช่องทางติดต่อฝ่ายประชาสัมพันธ์พร้อมให้ติดต่อ"},
 claims:[{entity:"TESTA",metric:"tour status",value:"scheduled",unit:"status",period:"unspecified",evidenceClass:"unverified_claim",statement:"Attributed announcement of tour scheduling only",sourceLocator:"received announcement",sourceExcerpt:source,verification:"unverified"},
 {entity:"TESTA",metric:"press contact",value:"available",unit:"status",period:"unspecified",evidenceClass:"unverified_claim",statement:"Attributed availability of press contact only",sourceLocator:"received announcement",sourceExcerpt:source,verification:"unverified"}]});
 const p=await prepare(data);expect(p.previews).toHaveLength(4);expect((await reviewDecision(p)).status).toBe(200);
 const saved=await save(data,p);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(4);
 for(const c of saved.steps.filter(s=>s.kind==="structured_claim")){
  const read=(await import("../vault/canonical-claims")).readPersistedClaim(c.path);expect(read.claim.verification).toBe("unverified");expect(read.originIndependenceIncrement).toBe(0);
 }
 expect((await prepare(data)).previews).toEqual([]);
});
it("invalid pilot configuration and symlinked root fail closed; existing single writer lock blocks approval",async()=>{
 const data=await judged(),p=await prepare(data),{pilotReviewChallenge,recordPilotReview}=await import("../safe-edit/c1-pilot-review"),{c1Pilot}=await import("../c1-pilot");
 const id=p.previews.find(t=>t.kind==="canonical_review")!.operationId,c=pilotReviewChallenge(id);
 fs.mkdirSync(path.join(root,"safe-edit.lock"));
 try{expect(()=>recordPilotReview({id,bindingDigest:c.bindingDigest,decision:"approve",semanticVerdict:"PASS",materiality:"low",rationale:"Simulated concurrent admission refusal"},"SIMULATED")).toThrow();}finally{fs.rmdirSync(path.join(root,"safe-edit.lock"));}
 process.env.C1_RESEARCH_PILOT="true";expect(c1Pilot).toThrow(/invalid_mode/);process.env.C1_RESEARCH_PILOT="disposable";
 // A process that observed invalid mode stays held even after restoring it.
 const link=root+"-link";fs.symlinkSync(root,link);process.env.DATA_DIR=link;try{expect(c1Pilot).toThrow(/invalid_mode/);}finally{process.env.DATA_DIR=root;fs.unlinkSync(link);}
 expect(c1Pilot).toThrow(/invalid_mode/);
});

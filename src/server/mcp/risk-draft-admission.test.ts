/** Real disposable Safe Edit/receipts and MCP; simulated semantic findings test
 * enforcement only. No model identity, independent critic or semantic quality
 * is established by CI. Prior Source is created through the actual engine. */
import {it,expect,beforeEach,afterEach,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {JudgeResult} from "../vault/research-judge";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
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
let root:string,vault:string,historyPath:string;
const protectedPaths=["05_Thesis/TESTA - Current Thesis.md","06_Portfolio/Positions.md","08_Daily_Weekly/Research Indexes/Company Evolution - TESTA.md"];
beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"risk-draft-")));vault=path.join(root,"vault");
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,8).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 for(const p of ["01_Companies/TESTA.md",...protectedPaths]){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# TESTA disposable fixture\n");(await import("../vault/indexer")).reindexPath(p);}
 const data={...base,sourceUrl:"https://example.org/routine/prior",extractedText:prior,researchReview:undefined,captureOnly:true};
 const saved=await save(data,await prepare(data));historyPath=saved.steps[0].path;
});
afterEach(async()=>{for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# TESTA disposable fixture\n");
 (await import("../db")).db().close();vi.useRealTimers();vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function prepare(data:WritebackInput){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function save(data:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input:data,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);}
async function judged(input:WritebackInput=base){
 const data=(await import("./canonical-writeback")).canonicalInputSchema.parse(input),j=await import("../vault/research-judge");
 const packet=j.buildResearchJudgePacket(data,actor),body=JSON.parse(packet.packet.body);
 const source={key:"received_source",quote:data.extractedText,locator:`utf16:0:${data.extractedText.length}`,sourceSha256:j.judgeHash(data.extractedText)};
 const history=body.history.find((h:{path:string})=>h.path===historyPath);expect(history?.sourceReceiptKey).toBeTruthy();
 const span=history.citationSpans.find((s:{text:string})=>s.text.includes("TESTA")&&s.text.includes("กำหนดการ"));expect(span).toBeDefined();
 const historyRef={key:history.key,quote:span.text,locator:`utf16:${span.start}:${span.end}`,sourceSha256:history.sha256};
 const a=(key:string)=>({key,verdict:"PASS" as const,rationale:"Simulated whole-scope assessment for control regression, not LLM evaluation",references:[source,historyRef],
  checks:{entailment:"PASS" as const,numbersUnits:"PASS" as const,periodRoleAttributionVintage:"PASS" as const,identityRelationships:"PASS" as const,pointInTime:"PASS" as const,independenceCounterEvidence:"PASS" as const,injectionCoverage:"PASS" as const}});
 const result:JudgeResult={packetId:packet.packet.packetId,packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,reviewDigest:body.reviewDigest,
  claims:body.claims.map((c:{key:string})=>a(c.key)),relationships:body.relationships.map((c:{key:string})=>a(c.key)),event:{...a("event"),classification:"added_detail"},review:a("review"),materialRisk:false,
  riskAssessment:{policy:j.DRAFT_RISK_POLICY,scopeDigest:body.riskScope.digest,coveredKeys:body.riskScope.items.map((x:{key:string})=>x.key),findings:j.riskDimensions.map(dimension=>({dimension,disposition:"absent",rationale:"Simulated comparison: current contact detail supplements the receipt-bound prior schedule; no investment change is asserted.",references:[source,historyRef]}))}};
 return {...data,researchJudge:{packet:packet.packet,result}};
}
it("routine added detail -> Draft with actual Source/Review receipts; retry retains trust and bytes",async()=>{
 const data=await judged(),p=await prepare(data);expect(p.qualityIssues).toEqual([]);expect(p.researchJudge).toMatchObject({decision:"PASS",criticRequired:false,semanticTruthVerified:false});expect(p.previews.map(t=>t.kind)).toEqual(["source_intake","canonical_review"]);
 const saved=await save(data,p);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(2);
 const r=saved.steps.find(s=>s.kind==="canonical_review")!,bytes=fs.readFileSync(path.join(vault,r.path));
 const read=(await import("../vault/notes")).readNoteRange(r.path,{limit:200});expect(read.researchTrust).toMatchObject({research_status:"draft",usage_tier:"historical_analysis_only",comparator_eligible:false,independent_evidence_increment:0,critic_independence:"not_verified"});
 expect((await prepare(data)).previews).toEqual([]);expect(fs.readFileSync(path.join(vault,r.path))).toEqual(bytes);
});
it.each(["missing assessment","wrong digest","omitted source","omitted history","duplicate dimension","source-only rationale","forged locator","wrong hash"])("false low-risk %s is HOLD",async fault=>{
 const data=await judged(),r=data.researchJudge.result.riskAssessment!;
 if(fault==="missing assessment")delete data.researchJudge.result.riskAssessment;
 if(fault==="wrong digest")r.scopeDigest="0".repeat(64);
 if(fault==="omitted source")r.coveredKeys=r.coveredKeys.filter(k=>k!=="received_source");
 if(fault==="omitted history")r.coveredKeys=r.coveredKeys.filter(k=>!k.startsWith("history_"));
 if(fault==="duplicate dimension")r.findings[1]=r.findings[0];
 if(fault==="source-only rationale")for(const f of r.findings)f.references=f.references.slice(0,1);
 if(fault==="forged locator")r.findings[0].references[0].locator="utf16:100:200";
 if(fault==="wrong hash")r.findings[0].references[0].sourceSha256="0".repeat(64);
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");expect(p.previews.map(t=>t.kind)).toEqual(["source_intake"]);
});
it.each(["Revenue increased from 100 to 150 million.","Guidance changed to ๑๕๐ million.","FCF is １３ million."])("omitted quantitative assertion cannot hide behind absent claims: %s",async addition=>{
 const data=await judged({...base,extractedText:text+" "+addition});expect(data.claims).toBeUndefined();
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");expect(p.researchJudge?.reasons).toContain("draft_risk_quantitative_scope_not_supported");expect(p.previews.every(x=>x.kind==="source_intake")).toBe(true);
});
it.each(["earnings","guidance","broker_price_target"] as const)("declared %s never qualifies via low-risk attestation",async type=>{
 const data=await judged({...base,contentTypes:[type]});const p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");expect(p.researchJudge?.reasons).toContain("draft_risk_declared_material_scope");
});
it.each(["material","uncertain","unsupported"] as const)("materiality finding %s retains restrictive decision",async disposition=>{
 const data=await judged();data.researchJudge.result.riskAssessment!.findings[0].disposition=disposition;
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe(disposition==="unsupported"?"FAIL":"HOLD");expect(p.previews.every(x=>x.kind==="source_intake")).toBe(true);
});
it("contradictory FCF 10 minus 3 asserted as 13: semantic FAIL stays FAIL, Source may persist",async()=>{
 // Arithmetic explanation is an analyst finding, not backend financial inference.
 const data=await judged({...base,extractedText:text+" OCF is 10. Capital expenditure is 3.",researchReview:{...review,whatChangedTh:review.whatChangedTh+" กระแสเงินสดอิสระเท่ากับ 13 จากการหักรายจ่ายลงทุน 3 ออกจากกระแสเงินสดดำเนินงาน 10"}});
 data.researchJudge.result.review.verdict="FAIL";data.researchJudge.result.review.checks.numbersUnits="FAIL";
 data.researchJudge.result.review.rationale="Analyst: 10 - 3 = 7, not 13; supplied FCF conclusion contradicts the stated subtraction.";
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("FAIL");const saved=await save(data,p);expect(saved.receipts).toHaveLength(1);expect(saved.steps.filter(x=>x.kind!=="source_intake").every(x=>!fs.existsSync(path.join(vault,x.path)))).toBe(true);
});
it.each(["history changed","history missing","expired","input changed"])("%s cannot use an old risk assessment or generic token",async fault=>{
 const data=await judged(),p=await prepare(data),token=p.previews.find(t=>t.kind==="canonical_review")!;
 if(fault==="history changed"){fs.appendFileSync(path.join(vault,historyPath),"\nChanged history\n");(await import("../vault/indexer")).reindexPath(historyPath);}
 if(fault==="history missing")fs.unlinkSync(path.join(vault,historyPath));
 if(fault==="expired"){vi.useFakeTimers();vi.setSystemTime(data.researchJudge.packet.expiresAt+1);}
 if(fault==="input changed")data.researchReview!.mechanismTh+=" ข้อสรุปใหม่ที่ยังไม่ได้ประเมิน";
 expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");
 expect(()=>(importEngine!.apply({operationId:token.operationId,previewToken:token.previewToken,expectedHash:token.beforeHash},actor))).toThrow();
 expect(fs.existsSync(path.join(vault,token.path))).toBe(false);
});
let importEngine:typeof import("../safe-edit/engine");
beforeEach(async()=>{importEngine=await import("../safe-edit/engine");});
it.each(["HOLD","FAIL"] as const)("prior %s cannot downgrade into a low-risk retry or unjudged Draft",async verdict=>{
 const data=await judged(),pass=structuredClone(data),p=await prepare(data);data.researchJudge.result.review.verdict=verdict;const held=await prepare(data);expect(held.researchJudge?.decision).toBe(verdict);
 expect(()=>prepareSync(pass,actor)).toThrow(/revoked_envelope/);expect((await prepare(base)).previews.every(t=>t.kind==="source_intake")).toBe(true);
 for(const t of p.previews.filter(t=>t.kind!=="source_intake"))expect(()=>importEngine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(/research_judge/);
});
let prepareSync:typeof import("./canonical-writeback").prepareCanonicalWriteback;
beforeEach(async()=>{const m=await import("./canonical-writeback");prepareSync=(raw)=>m.prepareCanonicalWriteback(raw,actor);});
it("fresh same-input packet after withdrawal can recover only with newly bound complete assessment",async()=>{
 const data=await judged();await prepare(data);data.researchJudge.result.review.verdict="HOLD";await prepare(data);
 vi.useFakeTimers();vi.setSystemTime(Date.now()+1000);const fresh=await judged();expect(fresh.researchJudge.packet.digest).toBe(data.researchJudge.packet.digest);
 const p=await prepare(fresh);expect(p.researchJudge?.decision).toBe("PASS");expect((await save(fresh,p)).status).toBe("saved_verified");
});
it("MCP descriptor, canonical prepare/apply and malformed-risk withdrawal share the same policy",async()=>{
 const data=await judged(),{createSafeEditMcpServer}=await import("./safe-edit-server"),server=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"risk-regression",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 const call=async(name:string,args:object)=>client.callTool({name,arguments:args as Record<string,unknown>});
 try{const tools=await client.listTools();expect(JSON.stringify(tools)).toContain("riskAssessment");
  const response=await call("prepare_canonical_writeback",data);expect(response.isError).not.toBe(true);
  const outer=JSON.parse((response.content as {text:string}[])[0].text),p=JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));expect(p.researchJudge.decision).toBe("PASS");
  const invalid={...data,researchJudge:{...data.researchJudge,result:{...data.researchJudge.result,riskAssessment:{lowRisk:true}}}};
  expect((await call("apply_canonical_writeback",{input:invalid,planId:p.planId,authorizations:[]})).isError).toBe(true);
  expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)?.decision).toBe("HOLD");
  for(const t of p.previews.filter((x:{kind:string})=>x.kind!=="source_intake"))expect((await call("apply_edit",{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash})).isError).toBe(true);
 }finally{await client.close();await server.close();}
});

it.each(["search","read"])("required historical %s failure remains HOLD despite complete low-risk assertions",async fault=>{
 const data=await judged();
 if(fault==="read")fs.unlinkSync(path.join(vault,historyPath));
 else vi.spyOn(await import("../vault/queries"),"searchVault").mockImplementation(()=>{throw Error("disposable search fault");});
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");expect(p.previews.every(x=>x.kind==="source_intake")).toBe(true);
});
it.each(["missing envelope","wrong actor","forged seal"])("risk admission %s cannot grant authority",async fault=>{
 const data=await judged();if(fault==="missing envelope")delete data.researchJudge.result.packetEnvelopeDigest;
 if(fault==="forged seal")data.researchJudge.packet.seal="0".repeat(64);
 const p=(await import("./canonical-writeback")).prepareCanonicalWriteback(data,fault==="wrong actor"?"oauth:other":actor);
 expect(p.researchJudge?.decision).toBe("HOLD");expect(p.previews.every(t=>t.kind==="source_intake")).toBe(true);
});
it("a proposed Review cannot omit a material number from the Source assessment scope",async()=>{
 const data=await judged({...base,researchReview:{...review,whatChangedTh:review.whatChangedTh+" รายได้คาดว่าจะเพิ่มเป็น 150 ล้านบาท"}});
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");expect(p.researchJudge?.reasons).toContain("draft_risk_quantitative_scope_not_supported");
});
it("a same-chat critic cannot rescue material uncertainty or confer independence",async()=>{
 const data=await judged();data.researchJudge.result.riskAssessment!.findings[1].disposition="material";
 data.researchJudge.result.critic={verdict:"PASS",rationale:"Same chat asserts another reasoning pass",independence:"not_verified"};
 const p=await prepare(data);expect(p.researchJudge).toMatchObject({decision:"HOLD",criticRequired:true});
});
async function qualitativeClaims(){
 const source="TESTA plant tour status is scheduled. TESTA press contact is available.";
 return judged({...base,sourceLanguage:"en",extractedText:source,researchReview:{...review,translationTh:"TESTA แจ้งสถานะกิจกรรมเยี่ยมชมโรงงานว่าได้กำหนดแล้ว และมีช่องทางติดต่อฝ่ายประชาสัมพันธ์พร้อมให้ติดต่อ"},
 claims:[{entity:"TESTA",metric:"tour status",value:"scheduled",unit:"status",period:"unspecified",evidenceClass:"unverified_claim",statement:"Attributed announcement of tour scheduling only",sourceLocator:"received announcement",sourceExcerpt:source,verification:"unverified"},
 {entity:"TESTA",metric:"press contact",value:"available",unit:"status",period:"unspecified",evidenceClass:"unverified_claim",statement:"Attributed availability of press contact only",sourceLocator:"received announcement",sourceExcerpt:source,verification:"unverified"}]});
}
it("eligible qualitative Claims and Draft preserve same-intake freshness, receipt links and unverified authority",async()=>{
 const data=await qualitativeClaims(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");expect(p.previews).toHaveLength(4);
 const saved=await save(data,p);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(4);
 for(const c of saved.steps.filter(s=>s.kind==="structured_claim")){
  const read=(await import("../vault/canonical-claims")).readPersistedClaim(c.path);expect(read.claim.verification).toBe("unverified");expect(read.originIndependenceIncrement).toBe(0);expect(read.reviewReferences).toHaveLength(1);
 }
 expect((await prepare(data)).previews).toEqual([]);
});
it.each(["HOLD","FAIL"] as const)("one required qualitative Claim %s blocks the full assessed bundle and existing generic tokens",async verdict=>{
 const data=await qualitativeClaims(),p=await prepare(data);expect(p.previews).toHaveLength(4);data.researchJudge.result.claims[1].verdict=verdict;
 const held=await prepare(data);expect(held.researchJudge?.decision).toBe(verdict);expect(held.previews.every(t=>t.kind==="source_intake")).toBe(true);
 for(const t of p.previews.filter(t=>t.kind!=="source_intake")){
  expect(()=>importEngine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(/research_judge/);
  expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
 }
 const saved=await save(data,held);expect(saved.receipts).toHaveLength(1);
});
it("removing a required Claim cannot retain a risk assessment or generic authority",async()=>{
 const data=await qualitativeClaims(),p=await prepare(data);data.claims!.pop();
 expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");
 for(const t of p.previews.filter(t=>t.kind!=="source_intake"))expect(()=>importEngine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(/research_judge/);
});
it("a receipt-bound Source already paired with a Review also supplies the historical basis",async()=>{
 const priorReview={...base,sourceUrl:"https://example.org/routine/prior",extractedText:prior};
 const saved=await save(priorReview,await prepare(priorReview));expect(saved.status).toBe("saved_verified");
 const data=await judged(),body=JSON.parse(data.researchJudge.packet.body),historical=body.history.find((h:{path:string})=>h.path===historyPath);
 expect(historical.sourceReceiptKey).toBeTruthy();expect(historical.sourceBinding).toBeUndefined();
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");expect((await save(data,p)).status).toBe("saved_verified");
});

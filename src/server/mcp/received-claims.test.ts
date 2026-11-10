import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {execFileSync} from "node:child_process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {IntakeClaim} from "../vault/canonical-claims";

// Preserve the accepted mechanical authority fixtures; current RISK-1 policy
// is exercised WITHOUT this oracle in risk-draft-admission.test.ts.
vi.mock("../vault/research-draft-risk",async importOriginal=>({...await importOriginal<typeof import("../vault/research-draft-risk")>(),
  judgeDraftRisk:(await import("./fixtures/legacy-risk-oracle")).legacyRiskOracle}));
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const actor="oauth:ri001-claims-fixture";
// CORE-LEAD chat oracle, not independently fetched/verified issuer evidence.
const fixtureId="FX-RI001-NVDA-Q2FY27-EN-PRIMARY-01";
const url="https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/";
const excerpt="Revenue of $96.2 billion, up 106% from a year ago\nRevenue is expected to be $108.0 billion, plus or minus 2%.\n";
const claims:IntakeClaim[]=[
  {entity:"NVDA",metric:"revenue",value:"96.2",unit:"USD billion",period:"Q2 FY2027",evidenceClass:"reported_actual",
    statement:"Issuer-reported Q2 FY2027 revenue, not independently verified",sourceLocator:"earnings release: supplied excerpt line 1; reporting period ended 2026-07-26",
    sourceExcerpt:excerpt.split("\n")[0],qualification:"up 106% from a year ago",verification:"unverified"},
  {entity:"NVDA",metric:"revenue",value:"108.0",unit:"USD billion",period:"Q3 FY2027",evidenceClass:"management_guidance",
    statement:"Management revenue guidance, forward-looking, not realized revenue or consensus",sourceLocator:"earnings release: supplied excerpt line 2; outlook",
    sourceExcerpt:excerpt.split("\n")[1],qualification:"plus or minus 2%",verification:"unverified"}
];
const review={headlineTh:"NVIDIA รายงานรายได้งวดปัจจุบันและแนวโน้มงวดถัดไปที่ยังต้องตรวจหลักฐาน",
  translationTh:"รายได้ 96.2 พันล้านดอลลาร์ เพิ่มขึ้น 106% จากปีก่อน\nคาดว่ารายได้จะอยู่ที่ 108.0 พันล้านดอลลาร์ บวกลบ 2%",
  whatChangedTh:"ตามข้อความที่ได้รับ บริษัทแยกรายได้ที่รายงานของงวดปัจจุบันจากประมาณการรายได้งวดถัดไป ยังไม่ได้ตรวจสอบแหล่งต้นฉบับโดยอิสระ",
  mechanismTh:"Actual และ Guidance ต้องแยกกัน เพราะประมาณการของฝ่ายบริหารยังไม่ใช่รายได้ที่เกิดขึ้นแล้วหรือประมาณการของตลาด",
  thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือมูลค่าจนกว่าจะตรวจหลักฐานและข้อจำกัดครบถ้วน",
  counterEvidenceTh:"ความต้องการซื้อและข้อจำกัดด้านการส่งมอบอาจทำให้รายได้จริงต่างจากแนวโน้มที่บริษัทกล่าวถึง",
  requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและเอกสารกำกับดูแลเพิ่มเติม ข้ออ้างทั้งสองมาจากแหล่งเดียวและไม่ใช่สองแหล่งอิสระ",
  claimAssessments:[{entity:"NVDA",metric:"revenue",period:"Q3 FY2027",unit:"USD billion",competingValues:["108.0"],resolution:"unresolved" as const,conclusion:"conditional" as const}]
};
const input:WritebackInput={domain:"company",entities:["NVDA"],topic:"NVIDIA Q2 FY2027 earnings and Q3 guidance",inputFormat:"text",
  sourceKind:"issuer_release",sourceLanguage:"en",sourceChat:fixtureId,sourceUrl:url,publisher:"NVIDIA Investor Relations",
  extractedText:excerpt,eventDate:"2026-08-26",publicationDate:"2026-08-26",sourceChannel:"issuer_release",
  originalDocumentAccess:"excerpt_only",contentTypes:["earnings","guidance"],researchReview:review,claims,
  researchLineage:{knowledgeCutoffAsOf:"2026-08-26T20:36:00Z"}};
let root:string,vault:string;
const protectedPaths=["05_Thesis/NVDA - Current Thesis.md","05_Thesis/NVDA - Evidence Register.md","01_Companies/NVDA - Company Evolution Timeline.md","06_Portfolio/Positions.md","06_Portfolio/Trades.md"];
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-claims-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
  for(const p of ["01_Companies/NVDA.md",...protectedPaths]){
    fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# Isolated protected fixture\n");
    (await import("../vault/indexer")).reindexPath(p);
  }
});
afterEach(()=>{assertProtected();vi.useRealTimers();vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function prepare(data:WritebackInput=input){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function apply(data:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input:data,planId:p.planId,
  authorizations:p.previews.map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);}
async function journal(){return (await import("../db")).db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all() as {id:string;status:string;after_text:string}[];}
function assertProtected(){for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Isolated protected fixture\n");}


const received:WritebackInput={...input,sourceUrl:null,sourceKind:"social_repost",sourceChannel:"line",publisher:null,sourceChat:"N2 disposable received-text fixture"};
it("N2 no-URL Source → Claims → Thai Draft has durable source binding",async()=>{
 const p=await prepare(received);expect(p.previews.map(s=>s.kind)).toEqual(["source_intake","structured_claim","structured_claim","canonical_review"]);
 const r=await apply(received,p);expect(r.status).toBe("saved_verified");expect(r.receipts).toHaveLength(4);
 assertProtected();
});
const auth=(x:{operationId:string;previewToken:string|null;beforeHash:string})=>({operationId:x.operationId,previewToken:x.previewToken!,expectedHash:x.beforeHash});
async function readClaim(p:string){return (await import("../vault/canonical-claims")).readPersistedClaim(p);}
it("preview receipt reference is pending; generic Claim apply cannot precede durable Source",async()=>{
 const p=await prepare(received),engine=await import("../safe-edit/engine"),cs=p.previews.filter(s=>s.kind==="structured_claim");
 const rows=await journal();expect(rows.every(r=>r.status==="preview")).toBe(true);expect(engine.status(p.previews[0].operationId,actor).receipt).toBeNull();
 const fm=(await import("../vault/markdown")).splitFrontmatter(rows.find(r=>r.id===cs[0].operationId)!.after_text).data;
 expect((fm.claims as {source_binding:unknown}[])[0].source_binding).toMatchObject({receiptRequirement:"durable_source_receipt_before_claim_write",originalPublisherUrl:null});
 expect(()=>engine.apply(auth(cs[0]),actor)).toThrow();expect(fs.existsSync(path.join(vault,cs[0].path))).toBe(false);
 engine.apply(auth(p.previews[0]),actor);for(const c of cs)engine.apply(auth(c),actor);
 engine.apply(auth(p.previews.at(-1)!),actor);expect((await apply(received,await prepare(received))).status).toBe("saved_verified");
});
it("Feed Only → later Claims/Draft preserves Source bytes/receipt; repost creates appearance only",async()=>{
 const appearance={key:"line-1",channel:"line",locator:"fixture:message/1",receivedAt:"2026-11-08T00:00:00Z"};
 const feed={...received,appearance,captureOnly:true,researchReview:undefined,claims:undefined};
 const first=await apply(feed,await prepare(feed));expect(first.receipts).toHaveLength(1);const bytes=fs.readFileSync(path.join(vault,first.steps[0].path));
 const full={...received,appearance};const p=await prepare(full);expect(p.previews.map(x=>x.kind)).toEqual(["structured_claim","structured_claim","canonical_review"]);
 const saved=await apply(full,p);expect(saved.status).toBe("saved_verified");
 const repost={...full,sourceChannel:"telegram",appearance:{...appearance,key:"telegram-2",channel:"telegram",locator:"fixture:message/2",receivedAt:"2026-11-08T00:01:00Z"}};
 const retry=await apply(repost,await prepare(repost));expect(retry.receipts).toHaveLength(0);expect(retry.planId).toBe(first.planId);
 expect(fs.readFileSync(path.join(vault,first.steps[0].path))).toEqual(bytes);expect(retry.steps[0].receiptKey).toBe(first.steps[0].receiptKey);
 const appearances=(await import("../vault/intake-appearances")).inspectIntakeAppearances(first.planId);expect(appearances.items).toHaveLength(2);expect(appearances.integrityHolds).toBe(0);
 expect((await journal()).filter(r=>r.status==="written")).toHaveLength(4);
});
it("cold process retrieves both claims, links, unverified role and Draft trust without inventing URL",async()=>{
 const r=await apply(received,await prepare(received)),cs=r.steps.filter(x=>x.kind==="structured_claim");
 for(const c of cs){const x=await readClaim(c.path);expect(x.claim.original_source).toBeNull();expect(x.claim.origin).toBe("received_user_source");expect(x.sourceReceiptKey).toBe(r.steps[0].receiptKey);expect(x.reviewReferences).toEqual([r.steps.at(-1)!.path]);expect(x.originIndependenceIncrement).toBe(0);}
 const out=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/received-claims-cold.test.ts","--maxWorkers=1"],{env:{...process.env,N2_COLD_ROOT:root,N2_COLD_PATHS:JSON.stringify(r.steps.map(x=>x.path))},encoding:"utf8",timeout:60000});
 expect(out).toContain("1 passed");
});
it.each(["wrong_path","forged_receipt","wrong_hash","wrong_span","wrong_quote","promoted","downgrade"])("generic admission rejects %s binding",async kind=>{
 const p=await prepare(received),r=(await journal()).find(x=>x.id===p.previews[1].operationId)!,md=await import("../vault/markdown");
 const {data:fm,body}=md.splitFrontmatter(r.after_text),c=(fm.claims as Record<string,any>[])[0],b=c.source_binding;
 if(kind==="wrong_path")b.sourcePath="00_Inbox/ChatGPT/Investment Intake - IN-0000000000000000.md";
 if(kind==="forged_receipt")b.sourceReceiptOperationId="ICW-"+"0".repeat(32);
 if(kind==="wrong_hash")b.preservedTextSha256="0".repeat(64);
 if(kind==="wrong_span")b.quote.start++;
 if(kind==="wrong_quote")b.quote.text="fabricated 96.2";
 if(kind==="promoted")c.verification="verified_against_primary";
 if(kind==="downgrade")fm.claim_persistence_version="RI001-1";
 const content="---\n"+Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+"\n---\n"+body;
 const engine=await import("../safe-edit/engine");expect(()=>engine.preview({operationId:"bad-"+kind,path:p.previews[1].path,reason:"negative fixture",change:{kind:"create",content}},actor)).toThrow();
 expect(fs.existsSync(path.join(vault,p.previews[1].path))).toBe(false);
});
it.each(["altered","missing","receipt","index"])("apply/cold read fail closed for %s Source",async mode=>{
 const p=await prepare(received),engine=await import("../safe-edit/engine"),source=p.previews[0];engine.apply(auth(source),actor);
 const d=(await import("../db")).db();
 if(mode==="altered")fs.appendFileSync(path.join(vault,source.path),"\nchanged");
 if(mode==="missing")fs.unlinkSync(path.join(vault,source.path));
 if(mode==="receipt")d.prepare("UPDATE safe_edit_operations SET receipt='{}' WHERE id=?").run(source.operationId);
 if(mode==="index")d.prepare("DELETE FROM notes_fts WHERE path=?").run(source.path);
 for(const c of p.previews.filter(x=>x.kind==="structured_claim")){expect(()=>engine.apply(auth(c),actor)).toThrow();expect(fs.existsSync(path.join(vault,c.path))).toBe(false);}
});
it("quote mismatch holds Claims/Review while Source-only preservation remains eligible",async()=>{
 const bad={...received,claims:[{...claims[0],sourceExcerpt:"Fabricated value 96.2"}]};const p=await prepare(bad);
 expect(p.claimIssues).toContain("claim_literal_source_anchor_missing");expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
 expect((await apply(bad,p)).receipts).toHaveLength(1);
});
it("wrong actor and rotated stale token cannot apply; partial failure retains Source and recovers pending writes",async()=>{
 const p=await prepare(received),engine=await import("../safe-edit/engine");
 expect(()=>engine.apply(auth(p.previews[0]),"oauth:other")).toThrow(/another OAuth/);
 expect(()=>engine.apply(auth(p.previews[1]),"oauth:other")).toThrow(/another OAuth/);
 const newer=await prepare(received);expect(()=>engine.apply(auth(p.previews[0]),actor)).toThrow(/Invalid preview/);
 const api=await import("./canonical-writeback");const r=await api.applyCanonicalWriteback({input:received,planId:newer.planId,authorizations:newer.previews.map((x,i)=>({...auth(x),...(i===1?{previewToken:"0".repeat(64)}:{})}))},actor);
 expect(r.completedWriteReceipts).toBe(1);expect(r.steps[0].state).toBe("verified_existing");
 expect((await apply(received,await prepare(received))).status).toBe("saved_verified");
});
it("later company URL cannot replace received origin; legacy URL RI001-1/2 stay byte/readback compatible",async()=>{
 const saved=await apply(received,await prepare(received));const before=await journal();
 await expect(prepare({...received,existingIntakeId:saved.planId,sourceUrl:"https://example.org/company"})).rejects.toThrow();expect(await journal()).toEqual(before);
 for(const data of [input,{...input,claims:claims.map(c=>({...c,accountingBasis:{standard:"GAAP" as const,shareBasis:null,scope:null,definition:null}}))}]){
  const capture={...data,captureOnly:true,researchReview:undefined};const r=await apply(capture,await prepare(capture));expect(r.status).toBe("source_saved_analysis_pending");
  for(const c of r.steps.filter(x=>x.kind==="structured_claim")){const raw=fs.readFileSync(path.join(vault,c.path),"utf8");expect(raw).toMatch(/claim_persistence_version: "RI001-[12]"/);expect((await readClaim(c.path)).sourceReceiptKey).toBe(r.steps[0].receiptKey);}
 }
});
it("real MCP descriptors accept null URL and prevent primary promotion",async()=>{
 const {createSafeEditMcpServer}=await import("./safe-edit-server"),server=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"n2",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{const response=await client.callTool({name:"prepare_canonical_writeback",arguments:{...received}});expect(response.isError).not.toBe(true);
 const outer=JSON.parse((response.content as {text:string}[])[0].text),p=JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));expect(p.previews).toHaveLength(4);
 const r=await client.callTool({name:"apply_canonical_writeback",arguments:{input:received,planId:p.planId,authorizations:p.previews.map(auth)}});expect(r.isError).not.toBe(true);
 expect(JSON.parse(JSON.parse((r.content as {text:string}[])[0].text).result.split("\n").slice(1,-1).join("\n")).status).toBe("saved_verified");
 const bad=await client.callTool({name:"prepare_canonical_writeback",arguments:{...received,claims:[{...claims[0],verification:"verified_primary"}]}});expect(bad.isError).toBe(true);
 }finally{await client.close();await server.close();}
});

async function judged(data:WritebackInput=received){
  const normalized=(await import("./canonical-writeback")).canonicalInputSchema.parse(data);
  const {buildResearchJudgePacket}=await import("../vault/research-judge");
  const {packet}=buildResearchJudgePacket(normalized,actor),body=JSON.parse(packet.body);
  const assessment=(key:string)=>({key,verdict:"PASS" as const,rationale:"Simulated analyst result, not real LLM evaluation",
    references:[{key:"received_source",quote:data.extractedText.slice(0,60),locator:`utf16:0:${Math.min(data.extractedText.length,60)}`,sourceSha256:sha(data.extractedText)}],
    checks:{entailment:"PASS" as const,numbersUnits:"PASS" as const,periodRoleAttributionVintage:"PASS" as const,
      identityRelationships:"PASS" as const,pointInTime:"PASS" as const,independenceCounterEvidence:"PASS" as const,injectionCoverage:"PASS" as const}});
  const result:import("../vault/research-judge").JudgeResult={packetEnvelopeDigest:(await import("../vault/research-judge")).judgeEnvelopeDigest(packet),packetId:packet.packetId,packetDigest:packet.digest,reviewDigest:body.reviewDigest,
    claims:body.claims.map((c:{key:string})=>assessment(c.key)),relationships:body.relationships.map((c:{key:string})=>assessment(c.key)),
    event:{...assessment("event"),classification:"new_event"},review:assessment("review"),materialRisk:false};
  return {...normalized,researchJudge:{packet,result}};
}

it.each(["HOLD","FAIL"] as const)("assessed %s cannot fall back to unjudged Draft or reuse generic tokens",async verdict=>{
 const data=await judged(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");
 data.researchJudge.result.claims[0].verdict=verdict;
 const held=await prepare(data);expect(held.researchJudge?.decision).toBe(verdict);expect(held.previews.every(x=>x.kind==="source_intake")).toBe(true);
 const engine=await import("../safe-edit/engine");for(const c of p.previews.filter(x=>x.kind!=="source_intake"))expect(()=>engine.apply(auth(c),actor)).toThrow();
 const fallback=await prepare(received);expect(fallback.previews.every(x=>x.kind==="source_intake")).toBe(true);expect(fallback.workflowStatus).toBe("hold_research_judge");
 const source=await apply(received,fallback);expect(source.receipts).toHaveLength(1);expect((await journal()).filter(x=>x.status==="written")).toHaveLength(1);
});
it("eligible simulated Judge PASS and exact self-writes remain compatible; no semantic claim",async()=>{
 const data=await judged(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");
 expect((await apply(data,p)).status).toBe("saved_verified");expect((await apply(data,await prepare(data))).receipts).toHaveLength(0);
});
it("written RI001-3 claims are immutable, and invalid current Source makes cold read HOLD",async()=>{
 const r=await apply(received,await prepare(received)),c=r.steps.find(x=>x.kind==="structured_claim")!;
 const engine=await import("../safe-edit/engine"),raw=fs.readFileSync(path.join(vault,c.path),"utf8");
 expect(()=>engine.preview({operationId:"claim-mutation-001",path:c.path,reason:"negative mutation fixture",change:{kind:"replace",oldText:"96.2",newText:"196.2"}},actor)).toThrow();
 expect(fs.readFileSync(path.join(vault,c.path),"utf8")).toBe(raw);
 fs.appendFileSync(path.join(vault,r.steps[0].path),"\nchanged");await expect(readClaim(c.path)).rejects.toThrow();
});
it("MCP cold retrieval fences received quote/declared locator while leaving URL null",async()=>{
 const r=await apply(received,await prepare(received)),{createMcpServer}=await import("./server");
 const server=createMcpServer({read:true,write:false,label:"n2-cold-reader"}),client=new Client({name:"n2-read",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{const response=await client.callTool({name:"review_investment_claim",arguments:{domain:"company",...claims[0],originalSource:r.steps[0].path,sourceLocator:undefined,sourceExcerpt:undefined,verification:undefined,qualification:undefined,evidenceClass:claims[0].evidenceClass}});
 expect(response.isError).not.toBe(true);const data=JSON.parse((response.content as {text:string}[])[0].text);
 expect(data.classification).toBe("duplicate_candidate");expect(data.matchingClaims[0].originalSource).toBeNull();expect(data.matchingClaims[0].sourceBinding.quote.text).toMatch(/^%[a-f0-9]{8}%\n/);
 expect(data.matchingClaims[0].sourceBinding.quote.declaredLocator).toMatch(/^%[a-f0-9]{8}%\n/);
 }finally{await client.close();await server.close();}
});
it.each([null,undefined,""])("No-URL %s spelling retains received binding; invalid nonempty URLs stay HOLD",async sourceUrl=>{
 const data={...received,sourceUrl};expect((await apply(data,await prepare(data))).status).toBe("saved_verified");
 const retry={...received,sourceUrl:null};expect((await apply(retry,await prepare(retry))).receipts).toHaveLength(0);
 await expect(prepare({...received,sourceUrl:"not a publisher URL"})).rejects.toThrow("claim_source_url_invalid");
});

it("Thai LINE text retains literal quote, no invented URL/translation or primary authority",async()=>{
 const text="มีข้อความส่งต่อว่า NVDA ได้รับคำสั่งซื้อเพิ่ม 120 หน่วย แต่ยังไม่มีเอกสารบริษัทมายืนยัน";
 const data={...received,sourceLanguage:"th",extractedText:text,eventDate:null,publicationDate:null,contentTypes:["other" as const],originalDocumentAccess:"not_obtained" as const,
  claims:[{entity:"NVDA",metric:"orders",period:"not supplied",value:"120",unit:"หน่วย",evidenceClass:"unverified_claim" as const,statement:"ข้อความส่งต่ออ้างคำสั่งซื้อ ยังไม่ยืนยัน",sourceLocator:"received LINE text",sourceExcerpt:text,verification:"unverified" as const}],
  researchReview:{headlineTh:"ข้อความส่งต่ออ้างคำสั่งซื้อที่ยังไม่มีหลักฐานต้นทาง",whatChangedTh:"ข้อความที่ได้รับอ้างว่ามีคำสั่งซื้อเพิ่ม แต่ยังไม่มีเอกสารบริษัทให้ตรวจยืนยัน",mechanismTh:"คำสั่งซื้ออาจไม่ใช่การส่งมอบหรือรายได้ ต้องตรวจเงื่อนไขก่อนประเมินผลทางการเงิน",thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุน เพราะไม่ทราบงวดบัญชีและไม่มีหลักฐานต้นทาง",counterEvidenceTh:"ยังไม่มีหลักฐานแย้งโดยตรง การขาดแหล่งอ้างอิงและวันที่เป็นข้อจำกัดของข้อมูลนี้",requiredEvidenceTh:"ต้องตรวจเอกสารบริษัท วันที่ของเหตุการณ์และหน่วยที่แท้จริงก่อนใช้ประกอบการตัดสินใจ",claimAssessments:[]}};
 const preview=await prepare(data);expect(preview.qualityIssues).toEqual([]);const r=await apply(data,preview);expect(r.status).toBe("saved_verified");const c=await readClaim(r.steps[1].path);
 expect(c.claim.source_excerpt).toBe(text);expect(c.claim.original_source).toBeNull();expect(c.claim.verification).toBe("unverified");expect(c.originIndependenceIncrement).toBe(0);
});

it("no-URL claims retain full-Source numeric boundary rejection",async()=>{
 const data={...received,claims:[{...claims[0],value:"6.2",sourceExcerpt:"6.2 billion, up 10",qualification:undefined}]};
 const p=await prepare(data);expect(p.claimIssues).toContain("claim_excerpt_numeric_boundary_invalid");expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
 const r=await apply(data,p);expect(r.receipts).toHaveLength(1);expect(r.steps.filter(x=>x.kind==="structured_claim").every(x=>!x.readbackVerified)).toBe(true);
});

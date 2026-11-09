import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {IntakeClaim} from "../vault/canonical-claims";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
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
function assertProtected(){for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Isolated protected fixture\n");}


const received:WritebackInput={...input,sourceUrl:null,sourceKind:"social_repost",sourceChannel:"line",publisher:null,sourceChat:"N2 disposable received-text fixture"};

const unpack=(response:any)=>JSON.parse(JSON.parse(response.content[0].text).result.split("\n").slice(1,-1).join("\n"));
async function wire(){const {createSafeEditMcpServer}=await import("./safe-edit-server"),server=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"n2-p1-p2",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 return {client,close:async()=>{await client.close();await server.close();}};
}
async function proposal(){const plan=(await import("../vault/investment-writeback-router")).planInvestmentWriteback({...received,claims:[claims[0]]}),s=plan.safeEditWorkflow!.steps.find(s=>s.kind==="structured_claim")!;
 const request=s.safeEditRequest as {path:string;operationId:string;reason:string;change:{kind:"create";content:string}};return {plan,request};}
async function changeClaim(content:string,edit:(fm:Record<string,any>)=>void){const {splitFrontmatter}=await import("../vault/markdown"),{data:fm,body}=splitFrontmatter(content);edit(fm);
 return "---\n"+Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+"\n---\n"+body;
}
async function query(source:string,metric=claims[0].metric,extra={}){return (await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",...claims[0],originalSource:source,metric,...extra});}
it("P1 public preview/apply refuses missing version, with no Source and no usable fallback",async()=>{
 const {plan,request}=await proposal(),content=await changeClaim(request.change.content,fm=>{delete fm.claim_persistence_version;});
 const w=await wire();let written=false;
 try{const p=await w.client.callTool({name:"preview_edit",arguments:{...request,operationId:"p1-missing-version-001",change:{kind:"create",content}}});
  if(!p.isError){const preview=unpack(p),r=await w.client.callTool({name:"apply_edit",arguments:{operationId:preview.operationId,previewToken:preview.previewToken,expectedHash:preview.beforeHash}});written=!r.isError;}
  const found=await query(plan.safeEditWorkflow!.steps[0].path);
  console.log(JSON.stringify({probe:"P1",publicWriteAccepted:written,claimExists:fs.existsSync(path.join(vault,request.path)),sourceExists:fs.existsSync(path.join(vault,plan.safeEditWorkflow!.steps[0].path)),matchingClaims:found.matchingClaims.length,bindingHolds:found.claimBindingHolds.length}));
  expect(written).toBe(false);expect(fs.existsSync(path.join(vault,request.path))).toBe(false);expect(found.matchingClaims).toHaveLength(0);
 }finally{await w.close();}
});
it.each(["url","received"] as const)("P2 related metric discovery uses verified %s source",async kind=>{
 const data={...(kind==="url"?input:received),claims:[claims[0]],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data));
 const source=kind==="url"?url:saved.steps[0].path,found=await query(source,"cash_flow");
 console.log(JSON.stringify({probe:"P2",kind,relatedMetrics:found.relatedEventClaims.length,classification:found.classification}));
 expect(found.relatedEventClaims).toHaveLength(1);expect(found.relatedEventClaims[0].metric).toBe("revenue");expect(found.classification).toBe("added_detail_candidate");
 expect(found.relatedEventClaims[0].originalSource).toBe(kind==="url"?url:null);expect(found.relatedEventClaims[0].originIndependenceIncrement).toBe(0);
});

const corruptions=["missing_version","missing_type","both_removed","null_version","downgrade_1","downgrade_2","disguised_1","disguised_2","spoofed_type","all_markers_removed","forged_binding"] as const;
type Corruption=typeof corruptions[number];
function corrupt(kind:Corruption,fm:Record<string,any>){
 const c=fm.claims[0];
 if(["missing_version","both_removed","spoofed_type"].includes(kind))delete fm.claim_persistence_version;
 if(["missing_type","both_removed"].includes(kind))delete fm.type;
 if(kind==="null_version")fm.claim_persistence_version=null;
 if(kind.startsWith("downgrade")||kind.startsWith("disguised"))fm.claim_persistence_version=kind.endsWith("1")?"RI001-1":"RI001-2";
 if(kind.startsWith("disguised")){
  fm.original_source=url;c.original_source=url;delete fm.origin;delete fm.original_publisher_url;
  for(const k of ["origin","original_publisher_url","source_binding"])delete c[k];
  if(kind.endsWith("1")){delete c.estimate;delete c.accounting_basis;}
  else c.accounting_basis={standard:"GAAP",shareBasis:null,scope:null,definition:null};
 }
 if(kind==="spoofed_type")fm.type="primary_source_verification_receipt";
 if(kind==="all_markers_removed")for(const k of Object.keys(fm))delete fm[k];
 if(kind==="forged_binding")c.source_binding.sourceReceiptOperationId="ICW-"+"0".repeat(32);
}
it.each(corruptions)("P1 generated path rejects %s at public preview and shared apply admission",async kind=>{
 const {request}=await proposal(),content=await changeClaim(request.change.content,fm=>corrupt(kind,fm)),w=await wire();
 try{
  const result=await w.client.callTool({name:"preview_edit",arguments:{...request,operationId:"p1-variant-"+kind,change:{kind:"create",content}}});
  expect(result.isError).toBe(true);
  const {assertReceivedClaimWrite}=await import("../vault/canonical-claims");
  expect(()=>assertReceivedClaimWrite(request.path,"",content,actor,"apply")).toThrow();
  expect(fs.existsSync(path.join(vault,request.path))).toBe(false);
 }finally{await w.close();}
});
it.each(corruptions)("P1 indexed %s is an explicit binding HOLD, not legacy evidence",async kind=>{
 const data={...received,claims:[claims[0]],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data)),c=saved.steps.find(s=>s.kind==="structured_claim")!;
 const engine=await import("../safe-edit/engine"),receipt=engine.status(c.receiptKey!,actor).receipt;
 const before=fs.readFileSync(path.join(vault,c.path),"utf8"),damaged=await changeClaim(before,fm=>corrupt(kind,fm));
 fs.writeFileSync(path.join(vault,c.path),damaged);(await import("../vault/indexer")).reindexPath(c.path);
 const found=await query(saved.steps[0].path);
 expect(found.matchingClaims).toHaveLength(0);expect(found.relatedEventClaims).toHaveLength(0);expect(found.classification).toBe("unresolved");
 expect(found.claimBindingHolds).toEqual([{path:c.path,reason:"claim_receipt_readback_index_link_unverified"}]);
 expect(found.sourceLinkedUnstructuredPaths).not.toContain(c.path);
 expect(engine.status(c.receiptKey!,actor).receipt).toEqual(receipt);expect(fs.readFileSync(path.join(vault,c.path),"utf8")).toBe(damaged);
 if(kind==="missing_version"){
  const out=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/received-claims-remediation-cold.test.ts","--maxWorkers=1"],{
   env:{...process.env,N2_HOLD_ROOT:root,N2_HOLD_PATH:c.path,N2_HOLD_QUERY:JSON.stringify({domain:"company",...claims[0],originalSource:saved.steps[0].path})},encoding:"utf8",timeout:60000});
  expect(out).toContain("1 passed");
 }
});
it("P1 received markers outside reserved path cannot opt into unversioned fallback",async()=>{
 const {request,plan}=await proposal(),p="10_Knowledge/Company Research/Received Claim copy.md",content=await changeClaim(request.change.content,fm=>{delete fm.type;delete fm.claim_persistence_version;});
 const w=await wire();try{expect((await w.client.callTool({name:"preview_edit",arguments:{...request,path:p,change:{kind:"create",content}}})).isError).toBe(true);}finally{await w.close();}
 fs.writeFileSync(path.join(vault,p),content);(await import("../vault/indexer")).reindexPath(p);
 const found=await query(plan.safeEditWorkflow!.steps[0].path);expect(found.matchingClaims).toHaveLength(0);expect(found.claimBindingHolds.map(h=>h.path)).toEqual([p]);
});
it("P1 public apply rejects pending-only Source; succeeds after genuine Source receipt",async()=>{
 const data={...received,claims:[claims[0]],captureOnly:true,researchReview:undefined},p=await prepare(data),c=p.previews.find(s=>s.kind==="structured_claim")!,source=p.previews[0],w=await wire();
 const args=(t:typeof c)=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash});
 try{
  const refused=await w.client.callTool({name:"apply_edit",arguments:args(c)});expect(refused.isError).toBe(true);expect(JSON.stringify(refused)).toContain("index_missing");
  expect(fs.existsSync(path.join(vault,c.path))).toBe(false);
  expect((await w.client.callTool({name:"apply_edit",arguments:args(source)})).isError).not.toBe(true);
  expect((await w.client.callTool({name:"apply_edit",arguments:args(c)})).isError).not.toBe(true);
  const found=await query(source.path);expect(found.classification).toBe("duplicate_candidate");expect(found.matchingClaims[0].persistence).toBe("receipt_readback_index_link_verified");
 }finally{await w.close();}
});
it("P1 ordinary historical unversioned notes remain readable and are not migrated",async()=>{
 const p="10_Knowledge/Company Research/NVDA historical observation.md",content='---\n'+Object.entries({type:"investment_structured_claim_register",...claims[0],original_source:url}).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n# Historical observation\n';
 const w=await wire();try{
  const r=unpack(await w.client.callTool({name:"preview_edit",arguments:{path:p,operationId:"p1-legitimate-legacy",reason:"Isolated historical compatibility control",change:{kind:"create",content}}}));
  expect((await w.client.callTool({name:"apply_edit",arguments:{operationId:r.operationId,previewToken:r.previewToken,expectedHash:r.beforeHash}})).isError).not.toBe(true);
  const found=await query(url,claims[0].metric,{evidenceClass:undefined});expect(found.matchingClaims.map(x=>x.path)).toContain(p);expect(found.claimBindingHolds).toHaveLength(0);expect(found.matchingClaims[0].persistence).toBeUndefined();
  expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe(content);
 }finally{await w.close();}
});
it("P2 path matching does not weaken units, dimensions, period, role or independence",async()=>{
 const data={...received,claims:[claims[0]],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data)),source=saved.steps[0].path;
 expect((await query(source)).classification).toBe("duplicate_candidate");
 expect((await query(source,claims[0].metric,{value:"97"})).classification).toBe("possible_correction_or_contradiction");
 for(const extra of [{unit:"test credits"},{period:"Q1 FY2027"},{evidenceClass:"management_guidance"},{accountingBasis:{standard:"non-GAAP",shareBasis:null,scope:null,definition:null}}])expect((await query(source,claims[0].metric,extra)).classification).toBe("unresolved");
 for(const [metric,extra] of [["cash_flow",{period:"Q1 FY2027"}],["cash_flow",{evidenceClass:"management_guidance"}],["cash_flow",{entity:"AMD"}]] as const)expect((await query(source,metric,extra)).relatedEventClaims).toHaveLength(0);
 expect((await query("00_Inbox/ChatGPT/Investment Intake - IN-0000000000000000.md","cash_flow")).relatedEventClaims).toHaveLength(0);
 const related=(await query(source,"cash_flow")).relatedEventClaims[0];expect(related.verification).toBe("unverified");expect(related.originIndependenceIncrement).toBe(0);expect(related.interpretationBoundary?.factUsability).toBe("not_verified_fact");
});

it("P1 previously received-marked content cannot shed the guard on replace",async()=>{
 const {request}=await proposal(),old=await changeClaim(request.change.content,fm=>{delete fm.type;delete fm.claim_persistence_version;});
 const {assertReceivedClaimWrite}=await import("../vault/canonical-claims");
 for(const stage of ["preview","apply"] as const)expect(()=>assertReceivedClaimWrite("10_Knowledge/Company Research/Received copy.md",old,"# ordinary text now",actor,stage)).toThrow("claim_path_invalid");
});
it("P2 related metric cannot use received metadata when Source readback fails",async()=>{
 const data={...received,claims:[claims[0]],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data));
 fs.appendFileSync(path.join(vault,saved.steps[0].path),"\nchanged after receipt\n");
 const found=await query(saved.steps[0].path,"cash_flow");expect(found.relatedEventClaims).toHaveLength(0);expect(found.claimBindingHolds).toHaveLength(1);expect(found.classification).toBe("unresolved");
});

import {beforeEach,afterEach,it,expect,vi} from "vitest";
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

async function changeClaim(content:string,edit:(fm:Record<string,any>)=>void){const {splitFrontmatter}=await import("../vault/markdown"),{data:fm,body}=splitFrontmatter(content);edit(fm);
 return "---\n"+Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+"\n---\n"+body;
}
async function query(source:string,metric=claims[0].metric,extra={}){return (await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",...claims[0],originalSource:source,metric,...extra});}

const scopeCorruptions=["unknown_entity","unknown_domain","null_domain","forged_macro"] as const;
it.each(scopeCorruptions)("N2 residual rejects %s before scope filtering",async kind=>{
 const data={...received,claims:[claims[0]],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data));
 const c=saved.steps.find(s=>s.kind==="structured_claim")!,engine=await import("../safe-edit/engine"),{db}=await import("../db");
 const receipt=engine.status(c.receiptKey!,actor).receipt,journal=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all(),sourceBytes=fs.readFileSync(path.join(vault,saved.steps[0].path));
 const content=await changeClaim(fs.readFileSync(path.join(vault,c.path),"utf8"),fm=>{
  if(kind==="unknown_entity")fm.entity=fm.claims[0].entity="UNKNOWN_ISSUER";
  else fm.domain=kind==="null_domain"?null:kind==="forged_macro"?"macro":"unknown_domain";
 });
 // Deliberate disposable on-disk corruption. No journal/receipt alteration.
 fs.writeFileSync(path.join(vault,c.path),content);(await import("../vault/indexer")).reindexPath(c.path);
 const {readPersistedClaim}=await import("../vault/canonical-claims");expect(()=>readPersistedClaim(c.path)).toThrow();
 const found=await query(saved.steps[0].path);
 console.log(JSON.stringify({probe:kind,matching:found.matchingClaims.length,related:found.relatedEventClaims.length,holds:found.claimBindingHolds.length,scan:found.metadataScan}));
 expect(found.matchingClaims).toHaveLength(0);expect(found.relatedEventClaims).toHaveLength(0);
 expect(found.claimBindingHolds).toEqual([{path:c.path,reason:"claim_receipt_readback_index_link_unverified",scope:"unknown"}]);
 expect(found.metadataScan).toMatchObject({coverage:"incomplete",integrityHoldCount:1,integrityHoldsTruncated:false});
 expect(found.sourceLinkedUnstructuredPaths).not.toContain(c.path);expect(found.possibleHistoricalPaths.map(h=>h.path)).not.toContain(c.path);
 expect(engine.status(c.receiptKey!,actor).receipt).toEqual(receipt);expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(journal);
 const cold=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/received-claims-remediation-cold.test.ts","--maxWorkers=1"],{
  env:{...process.env,N2_SCOPE_ROOT:root,N2_SCOPE_PATH:c.path,N2_SCOPE_QUERY:JSON.stringify({domain:"company",...claims[0],originalSource:saved.steps[0].path})},encoding:"utf8",timeout:60000});
 expect(cold).toContain("1 passed");expect(fs.readFileSync(path.join(vault,saved.steps[0].path))).toEqual(sourceBytes);
 expect(fs.readFileSync(path.join(vault,c.path),"utf8")).toBe(content);
 expect(engine.status(c.receiptKey!,actor).receipt).toEqual(receipt);expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(journal);
});


it.each(["RI001-1","RI001-2","RI001-3"] as const)("validated %s scope remains readable; other issuer/domain does not false HOLD",async version=>{
 const c={...claims[0],...(version==="RI001-2"?{accountingBasis:{standard:"GAAP",shareBasis:null,scope:null,definition:null}}:{})};
 const data={...(version==="RI001-3"?received:input),claims:[c],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data));
 const step=saved.steps.find(s=>s.kind==="structured_claim")!,{readPersistedClaim}=await import("../vault/canonical-claims"),{splitFrontmatter}=await import("../vault/markdown");
 const bytes=fs.readFileSync(path.join(vault,step.path)),receipt=(await import("../safe-edit/engine")).status(step.receiptKey!,actor).receipt;
 expect(splitFrontmatter(bytes.toString()).data.claim_persistence_version).toBe(version);expect(readPersistedClaim(step.path).scope).toEqual({entity:"NVDA",domain:"company"});
 const source=version==="RI001-3"?saved.steps[0].path:url;
 const found=await query(source,c.metric,{accountingBasis:c.accountingBasis});expect(found.classification).toBe("duplicate_candidate");expect(found.matchingClaims.map(x=>x.path)).toEqual([step.path]);
 expect(found.claimBindingHolds).toHaveLength(0);expect(found.metadataScan).toMatchObject({coverage:"bounded_scan_no_integrity_hold",integrityHoldCount:0,verifiedUnrelatedClaims:0});
 for(const other of [{entity:"TESTB"},{domain:"macro"}]){
  const r=await query(source,c.metric,{accountingBasis:c.accountingBasis,...other});
  expect(r.matchingClaims).toHaveLength(0);expect(r.relatedEventClaims).toHaveLength(0);expect(r.claimBindingHolds).toHaveLength(0);
  expect(r.sourceLinkedUnstructuredPaths).not.toContain(step.path);expect(r.possibleHistoricalPaths.map(x=>x.path)).not.toContain(step.path);
  expect(r.metadataScan).toMatchObject({coverage:"bounded_scan_no_integrity_hold",integrityHoldCount:0,verifiedUnrelatedClaims:1});
 }
 expect(fs.readFileSync(path.join(vault,step.path))).toEqual(bytes);expect((await import("../safe-edit/engine")).status(step.receiptKey!,actor).receipt).toEqual(receipt);
});
it("genuine macro RI001-2 is valid in its own scope, unrelated to a company query",async()=>{
 fs.mkdirSync(path.join(vault,"10_Knowledge/Macro and Markets"),{recursive:true});
 const c={...claims[0]},data={...input,domain:"macro" as const,claims:[c],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data));
 const step=saved.steps.find(s=>s.kind==="structured_claim")!;
 expect((await import("../vault/canonical-claims")).readPersistedClaim(step.path).scope).toEqual({entity:"NVDA",domain:"macro"});
 expect((await query(url,c.metric,{domain:"macro"})).matchingClaims.map(x=>x.path)).toEqual([step.path]);
 const company=await query(url);expect(company.matchingClaims).toHaveLength(0);expect(company.claimBindingHolds).toHaveLength(0);expect(company.metadataScan).toMatchObject({verifiedUnrelatedClaims:1,integrityHoldCount:0});
});
it("HOLD detail overflow reports all observed failures and deterministic truncation",async()=>{
 const {reindexPath}=await import("../vault/indexer"),paths:string[]=[];
 // Deliberately invalid files, NOT issued claims or manufactured receipts.
 for(let i=0;i<13;i++){
  const p=`10_Knowledge/Company Research/Investment Claim - ICL-${i.toString(16).toUpperCase().padStart(32,"0")}.md`;paths.push(p);
  fs.writeFileSync(path.join(vault,p),'---\nentity: OTHER\ndomain: unknown_domain\n---\n# Damaged fixture\n');reindexPath(p);
 }
 const r=await query("00_Inbox/ChatGPT/Investment Intake - IN-0000000000000000.md"),again=await query("00_Inbox/ChatGPT/Investment Intake - IN-0000000000000000.md");
 expect(r.claimBindingHolds.map(h=>h.path)).toEqual(paths.slice(0,12));expect(again.claimBindingHolds).toEqual(r.claimBindingHolds);
 expect(r.claimBindingHolds.every(h=>h.scope==="unknown")).toBe(true);expect(r.metadataScan).toMatchObject({truncated:false,integrityHoldCount:13,integrityHoldsTruncated:true,coverage:"incomplete"});
 expect(r.evidenceNeeded.join(" ")).toContain("HOLD details are truncated");expect(r.matchingClaims).toHaveLength(0);expect(r.relatedEventClaims).toHaveLength(0);
 expect(r.possibleHistoricalPaths.some(x=>paths.includes(x.path))).toBe(false);
});
it.each([25000,25001])("metadata scan remains bounded with %i rows and excludes its sentinel",async total=>{
 const sql=(await import("../db")).db(),realPrepare=sql.prepare.bind(sql),binding=await import("../vault/canonical-claims"),reads=vi.spyOn(binding,"readPersistedClaim");
 const sentinel="10_Knowledge/Company Research/Investment Claim - ICL-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF.md";
 // Unit-level query sentinel injection; no forged DB rows, files or receipts.
 const page=Array.from({length:total},(_,i)=>({path:i===25000?sentinel:`07_Sources/unrelated-${i}.md`,frontmatter:JSON.stringify({entity:"UNRELATED"})}));
 const all=vi.fn((limit:number)=>{expect(limit).toBe(25001);return page;});
 vi.spyOn(sql,"prepare").mockImplementation((source:string)=>{
  if(source.startsWith("SELECT path, frontmatter FROM notes WHERE frontmatter IS NOT NULL OR path GLOB"))return {all} as unknown as ReturnType<typeof sql.prepare>;
  if(source.startsWith("SELECT COUNT(*) AS n FROM notes WHERE frontmatter IS NOT NULL OR path GLOB"))return {get:()=>({n:total})} as unknown as ReturnType<typeof sql.prepare>;
  return realPrepare(source);
 });
 const r=await query(url);expect(all).toHaveBeenCalledOnce();expect(reads).not.toHaveBeenCalled();expect(r.metadataScan).toMatchObject({notesScanned:25000,truncated:total>25000,integrityHoldCount:0,coverage:total>25000?"incomplete":"bounded_scan_no_integrity_hold"});
 expect(r.matchingClaims).toHaveLength(0);expect(r.claimBindingHolds).toHaveLength(0);expect(r.possibleHistoricalPaths.map(x=>x.path)).not.toContain(sentinel);
 if(total>25000)expect(r.evidenceNeeded.join(" ")).toContain("Metadata scan capped");
});

import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
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


const incoming={domain:"company" as const,...claims[0],originalSource:url};
const routerInput={...input,claims:undefined,researchReview:undefined,researchLineage:undefined,claim:{metric:claims[0].metric,period:claims[0].period,statement:claims[0].statement,value:claims[0].value,unit:claims[0].unit}};
const proposal={...incoming,proposedDecision:"undetermined" as const,historicalContextPath:protectedPaths[0],historicalContextReadByAnalyst:false,existingThesisStatus:"draft_or_unverified" as const,
 evidence:[],counterEvidence:[],transmission:[],thesisDelta:"No decision pending complete evidence",alternatives:"Unresolved alternatives",invalidation:"Read exact source",confidence:"unassessed" as const,confidenceRationale:"Incomplete history",marketExpectations:{status:"not_assessed" as const},portfolio:{status:"not_assessed" as const}};
async function ab(kind="unknown_entity"){
 const raw={...input,claims:[claims[0]],captureOnly:true,researchReview:undefined},a=await apply(raw,await prepare(raw));
 const bText=excerpt.replace("96.2","97.0"),bClaim={...claims[0],value:"97.0",sourceExcerpt:claims[0].sourceExcerpt.replace("96.2","97.0")};
 const other={...raw,sourceUrl:"https://example.org/n2-fb-conflicting-source",extractedText:bText,claims:[bClaim]},b=await apply(other,await prepare(other));
 const bad=b.steps.find(s=>s.kind==="structured_claim")!.path,content=await changeClaim(fs.readFileSync(path.join(vault,bad),"utf8"),fm=>{
  if(kind==="unknown_entity")fm.entity=fm.claims[0].entity="UNKNOWN_ISSUER";
  else fm.domain=kind==="null_domain"?null:kind==="forged_macro"?"macro":"unknown_domain";
 });
 fs.writeFileSync(path.join(vault,bad),content);(await import("../vault/indexer")).reindexPath(bad);
 return {a,b,bad};
}
it("F-B AB integrity must precede duplicate/unit/detail across every consumer",async()=>{
 const {a,bad}=await ab(),direct=await query(url);expect(direct.classification).toBe("duplicate_candidate");expect(direct.metadataScan.coverage).toBe("incomplete");
 const hybrid=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...incoming,maxFtsHits:10});
 const router=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(routerInput);
 const packet=(await import("../vault/investment-decision-packet")).buildInvestmentDecisionPacket(incoming,direct);
 const thesis=(await import("../vault/thesis-proposal-gate")).assessThesisProposal(proposal);
 console.log(JSON.stringify({probe:"AB",direct:direct.metadataScan,hybrid:hybrid.classification,ftsIncludesCorrupt:hybrid.historical.candidates.some(c=>c.path===bad),router:router.exactClaimReview,packet:packet.claimGate,thesisWarnings:thesis.warnings}));
 expect.soft(hybrid.classification).toBe("HOLD_METADATA_COVERAGE");expect.soft(hybrid.historical.candidates.map(c=>c.path)).not.toContain(bad);
 expect.soft(hybrid.indexed.candidatePaths).toContain(a.steps.find(s=>s.kind==="structured_claim")!.path);
 expect.soft(router.exactClaimReview).toMatchObject({coverage:"incomplete",integrityHoldCount:1,integrityHold:true});
 expect.soft(packet.claimGate).toMatchObject({classification:"unresolved",coverage:"incomplete",integrityHoldCount:1,integrityHold:true});
 expect.soft(thesis.warnings.join(" ")).toContain("Unknown-scope integrity HOLD");
});

async function wire(){
 const server=(await import("./server")).createMcpServer({read:true,write:false,label:"oauth:n2-fb-reader",scopes:["vault:read"]});
 const client=new Client({name:"n2-fb-public",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 return {client,close:async()=>{await client.close();await server.close();}};
}
async function call(client:Client,name:string,args:object){const r=await client.callTool({name,arguments:args as Record<string,unknown>});expect(r.isError).not.toBe(true);return JSON.parse((r.content as {text:string}[])[0].text);}
it.each(["unknown_entity","unknown_domain","null_domain","forged_macro"])("F-B public MCP propagates %s integrity across all read tools",async kind=>{
 const {bad}=await ab(kind),{db}=await import("../db"),journal=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all(),bytes=fs.readFileSync(path.join(vault,bad)),w=await wire();
 try{
  const direct=await call(w.client,"review_investment_claim",incoming);
  expect(direct.metadataScan.coverage).toBe("incomplete");expect(direct.matchingClaims).toHaveLength(1);expect(direct.matchingClaims[0].path).not.toBe(bad);
  expect(direct.decisionPacket.claimGate).toMatchObject({classification:"unresolved",coverage:"incomplete",integrityHoldCount:1,integrityHold:true});
  expect(direct.decisionPacket.historicalContext.sourcePointers.map((x:{path:string})=>x.path)).not.toContain(bad);
  expect(direct.decisionPacket.evidenceVerificationLedger.historicalIntegrity.integrityHold).toBe(true);
  const hybrid=await call(w.client,"preview_hybrid_claim_reconciliation",{...incoming,maxFtsHits:10});
  expect(hybrid.classification).toBe("HOLD_METADATA_COVERAGE");expect(hybrid.coverageHold).toBe(true);expect(hybrid.metadataIntegrity.coverage).toBe("incomplete");
  expect(hybrid.historical.candidates.map((x:{path:string})=>x.path)).not.toContain(bad);expect(hybrid.historical.ftsIntegrityHolds.map((x:{path:string})=>x.path)).toContain(bad);
  expect(hybrid.historical.candidates.length+hybrid.historical.ftsIntegrityHolds.length+hybrid.historical.ftsVerifiedUnrelatedPaths.length).toBeLessThanOrEqual(10);
  const route=await call(w.client,"plan_investment_writeback",routerInput);
  expect(route.exactClaimReview).toMatchObject({coverage:"incomplete",integrityHoldCount:1,integrityHoldsTruncated:false,integrityHold:true,classification:"unresolved"});
  expect(route.routes.filter((r:{kind:string})=>r.kind!=="raw_input").every((r:{action:string})=>r.action==="link_existing_or_hold")).toBe(true);
  const thesis=await call(w.client,"assess_thesis_change_proposal",proposal);
  expect(thesis.historicalIntegrity.integrityHold).toBe(true);expect(thesis.historicalClaimClassification).toBe("unresolved");
  expect(thesis.warnings.join(" ")).toContain("Unknown-scope integrity HOLD");expect(thesis.blockers.join(" ")).toContain("Unknown-scope integrity HOLD");expect(thesis.thesisUpdateGate.canAutoUpdateThesis).toBe(false);
  expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(journal);expect(fs.readFileSync(path.join(vault,bad))).toEqual(bytes);
 }finally{await w.close();}
});
it.each(["USD billion","USD millions","cash_flow"])("coverage HOLD precedes duplicate/unit/detail %s",async mode=>{
 await ab();const h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...incoming,...(mode==="cash_flow"?{metric:mode}:{unit:mode,value:mode==="USD millions"?"96200":"96.2"})});
 expect(h.classification).toBe("HOLD_METADATA_COVERAGE");expect(h.metadataIntegrity.integrityHoldCount).toBe(1);
});
it("FTS independently quarantines a damaged generated hit absent from metadata failure details",async()=>{
 const {bad}=await ab(),module=await import("../vault/investment-claim-review"),real=module.reviewInvestmentClaim(incoming);
 // Isolate the FTS guard from the metadata guard. No fake receipt or file trust.
 vi.spyOn(module,"reviewInvestmentClaim").mockReturnValue({...real,claimBindingHolds:[],metadataScan:{...real.metadataScan,integrityHoldCount:0,integrityHoldsTruncated:false,truncated:false,coverage:"bounded_scan_no_integrity_hold"}});
 const queries=await import("../vault/queries"),search=vi.spyOn(queries,"searchVault");
 const h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...incoming,maxFtsHits:10,searchQueries:["NVDA revenue","NVDA guidance","NVDA Source"]});
 expect(h.metadataIntegrity.integrityHold).toBe(false);expect(h.classification).toBe("HOLD_METADATA_COVERAGE");expect(h.coverageHoldReasons).toContain("fts_generated_claim_binding_unverified");
 expect(h.historical.ftsIntegrityHolds.map(x=>x.path)).toContain(bad);expect(h.historical.candidates.map(x=>x.path)).not.toContain(bad);
 expect(search.mock.calls.length).toBeLessThanOrEqual(5);expect(search.mock.calls.every(([,opts])=>opts!.limit!<=10)).toBe(true);
});
it.each(["RI001-1","RI001-2","RI001-3"] as const)("valid %s keeps candidates, provenance and no authority promotion",async version=>{
 const c={...claims[0],...(version==="RI001-2"?{accountingBasis:{standard:"GAAP",shareBasis:null,scope:null,definition:null}}:{})},data={...(version==="RI001-3"?received:input),claims:[c],captureOnly:true,researchReview:undefined},saved=await apply(data,await prepare(data));
 const source=version==="RI001-3"?saved.steps[0].path:url,query={...incoming,...c,originalSource:source},claimPath=saved.steps.find(x=>x.kind==="structured_claim")!.path;
 const direct=(await import("../vault/investment-claim-review")).reviewInvestmentClaim(query);expect(direct.classification).toBe("duplicate_candidate");
 const h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...query,maxFtsHits:10});expect(h.metadataIntegrity.integrityHold).toBe(false);expect(h.coverageHold).toBe(false);
 // RI-011's existing URL-only comparison remains unchanged for received text.
 expect(h.classification).toBe(version==="RI001-3"?"HOLD_ORIGINAL_SOURCE_IDENTITY":"DUPLICATE_CANDIDATE");
 const selected=h.historical.candidates.find(x=>x.path===claimPath)!;expect(selected).toBeDefined();expect(selected.provenance.sourceUrl).toBe(version==="RI001-3"?null:url);
 expect(h.gates.independentEvidenceEstablished).toBe(false);expect(h.gates.claimVerifiedAgainstOriginal).toBe(false);
 for(const other of [{entity:"TESTB"},{domain:"macro" as const}]){
  const r=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...query,...other,searchQueries:["NVDA revenue"],maxFtsHits:10});
  expect(r.coverageHold).toBe(false);expect(r.historical.candidates.map(x=>x.path)).not.toContain(claimPath);expect(r.historical.ftsVerifiedUnrelatedPaths).toContain(claimPath);
 }
 const packet=(await import("../vault/investment-decision-packet")).buildInvestmentDecisionPacket(query,direct);expect(packet.claimGate.integrityHold).toBe(false);expect(packet.claimGate.classification).toBe("duplicate_candidate");
});
it("not-checked is explicit; checked HOLD leaves Source preservation independently eligible",async()=>{
 await ab();const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
 const unchecked=planInvestmentWriteback({...routerInput,claim:undefined});expect(unchecked.exactClaimReview).toMatchObject({status:"not_checked_missing_exact_fields",coverage:"not_checked",integrityHoldCount:null,integrityHoldsTruncated:null,integrityHold:null});
 const next={...routerInput,extractedText:excerpt+"\nUnverified follow-up fixture text.\n",eventDate:null,publicationDate:null,researchReview:review};
 const p=await prepare(next);expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);expect(p.claimIssues).toContain("historical_claim_integrity_hold");
 const feed={...next,researchReview:undefined,captureOnly:true},saved=await apply(feed,await prepare(feed));expect(saved.receipts).toHaveLength(1);expect(saved.steps.filter(s=>s.state==="verified_existing").map(s=>s.kind)).toEqual(["source_intake"]);
});
it("13 unknown-scope failures preserve detail truncation across consumers without rescue scan",async()=>{
 const {reindexPath}=await import("../vault/indexer");
 for(let i=0;i<13;i++){
  const p=`10_Knowledge/Company Research/Investment Claim - ICL-${i.toString(16).toUpperCase().padStart(32,"0")}.md`;
  fs.writeFileSync(path.join(vault,p),'---\nentity: OTHER\ndomain: unknown_domain\n---\n# NVDA revenue Q2 FY2027\n');reindexPath(p);
 }
 const module=await import("../vault/investment-claim-review"),direct=module.reviewInvestmentClaim(incoming),h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...incoming,maxFtsHits:10});
 expect(h.classification).toBe("HOLD_METADATA_COVERAGE");expect(h.metadataIntegrity).toMatchObject({integrityHoldCount:13,integrityHoldsTruncated:true,coverage:"incomplete"});expect(h.historical.candidates).toHaveLength(0);expect(h.historical.ftsIntegrityHolds.length).toBeLessThanOrEqual(10);
 const route=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(routerInput),packet=(await import("../vault/investment-decision-packet")).buildInvestmentDecisionPacket(incoming,direct),t=(await import("../vault/thesis-proposal-gate")).assessThesisProposal(proposal);
 for(const c of [route.exactClaimReview,packet.claimGate,t.historicalIntegrity])expect(c).toMatchObject({coverage:"incomplete",integrityHoldCount:13,integrityHoldsTruncated:true,integrityHold:true});
});
it("25,000 + sentinel incompleteness propagates without validating or rescuing the sentinel",async()=>{
 const sql=(await import("../db")).db(),original=sql.prepare.bind(sql),claimReader=await import("../vault/canonical-claims"),read=vi.spyOn(claimReader,"readPersistedClaim");
 const page=Array.from({length:25001},(_,i)=>({path:i===25000?"10_Knowledge/Company Research/Investment Claim - ICL-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF.md":`07_Sources/${i}.md`,frontmatter:JSON.stringify({entity:"OTHER"})}));
 vi.spyOn(sql,"prepare").mockImplementation((source:string)=>{
  if(source.startsWith("SELECT path, frontmatter FROM notes WHERE frontmatter IS NOT NULL OR path GLOB"))return {all:(n:number)=>{expect(n).toBe(25001);return page;}} as unknown as ReturnType<typeof sql.prepare>;
  if(source.startsWith("SELECT COUNT(*) AS n FROM notes WHERE frontmatter IS NOT NULL OR path GLOB"))return {get:()=>({n:25001})} as unknown as ReturnType<typeof sql.prepare>;
  return original(source);
 });
 const direct=await query(url),h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview(incoming),route=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(routerInput),packet=(await import("../vault/investment-decision-packet")).buildInvestmentDecisionPacket(incoming,direct),t=(await import("../vault/thesis-proposal-gate")).assessThesisProposal(proposal);
 expect(direct.metadataScan.notesScanned).toBe(25000);expect(read).not.toHaveBeenCalled();expect(h.classification).toBe("HOLD_METADATA_COVERAGE");
 for(const c of [h.metadataIntegrity,route.exactClaimReview,packet.claimGate,t.historicalIntegrity])expect(c).toMatchObject({coverage:"incomplete",integrityHoldCount:0,integrityHold:true,integrityReason:"historical_claim_coverage_incomplete"});
});

it("FTS cannot restore a received-marked claim relocated outside its reserved path",async()=>{
 const {bad}=await ab(),relocated="10_Knowledge/Company Research/Relocated Claim.md";
 const content=await changeClaim(fs.readFileSync(path.join(vault,bad),"utf8"),fm=>{delete fm.claim_persistence_version;fm.origin="received_user_source";fm.claims[0].source_binding={version:"forged"};});
 fs.writeFileSync(path.join(vault,relocated),content);(await import("../vault/indexer")).reindexPath(relocated);
 const h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...incoming,maxFtsHits:10});
 expect(h.classification).toBe("HOLD_METADATA_COVERAGE");expect(h.historical.ftsIntegrityHolds.map(x=>x.path)).toContain(relocated);expect(h.historical.candidates.map(x=>x.path)).not.toContain(relocated);
});
it("generated FTS excerpts come from receipt-validated bytes rather than stale indexed snippets",async()=>{
 const raw={...input,claims:[claims[0]],captureOnly:true,researchReview:undefined},saved=await apply(raw,await prepare(raw)),claimPath=saved.steps.find(x=>x.kind==="structured_claim")!.path;
 const q=await import("../vault/queries"),real=q.searchVault;
 vi.spyOn(q,"searchVault").mockImplementation((query,opts)=>{const page=real(query,opts);return {...page,hits:page.hits.map(h=>h.path===claimPath?{...h,snippet:"FABRICATED_INDEX_TEXT_999",matches:["FABRICATED_INDEX_TEXT_999"]}:h)};});
 const h=(await import("../vault/investment-hybrid-readonly")).hybridClaimPreview({...incoming,maxFtsHits:10}),selected=h.historical.candidates.find(x=>x.path===claimPath)!;
 expect(selected).toBeDefined();expect(selected.snippet).not.toContain("FABRICATED_INDEX_TEXT_999");expect(selected.readExcerpt).not.toContain("FABRICATED_INDEX_TEXT_999");expect(h.coverageHold).toBe(false);
});

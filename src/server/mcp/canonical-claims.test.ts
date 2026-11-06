import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createHash} from "node:crypto";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {IntakeClaim} from "../vault/canonical-claims";

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
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function plan(data:WritebackInput=input){return (await import("../vault/investment-writeback-router")).planInvestmentWriteback(data);}
async function prepare(data:WritebackInput=input){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function apply(data:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input:data,planId:p.planId,
  authorizations:p.previews.map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);}
async function retrieve(c:IntakeClaim){return (await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",entity:c.entity,metric:c.metric,period:c.period,unit:c.unit,value:c.value,evidenceClass:c.evidenceClass,statement:c.statement,originalSource:url});}
async function journal(){return (await import("../db")).db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();}
function assertProtected(){for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Isolated protected fixture\n");}

describe("RI-001 source-scoped multi-claim persistence",()=>{
  it("verifies the supplied oracle bytes and persists Source → two claims → Thai Review through real Safe Edit",async()=>{
    expect(Buffer.byteLength(excerpt)).toBe(110);expect(sha(excerpt)).toBe("fcb27d2199b77c5f9461a27db3daa8319f441fdb0d9a3ebc1213a80c794a5de9");
    const started=Date.now(),p=await prepare();expect(p.qualityIssues).toEqual([]);expect(p.claimIssues).toEqual([]);
    expect(p.previews.map(x=>x.kind)).toEqual(["source_intake","structured_claim","structured_claim","canonical_review"]);
    const r=await apply(input,p);expect(r.interrupted).toBeNull();expect(r.status).toBe("saved_verified");expect(r.readyForNextNews).toBe(true);
    expect(r.steps.every(x=>x.state==="verified_existing"&&x.readbackVerified&&x.indexed&&x.searchable)).toBe(true);
    const source=r.steps[0],rev=r.steps.at(-1)!,{splitFrontmatter}=await import("../vault/markdown");
    expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toContain(excerpt);
    const parsed=splitFrontmatter(fs.readFileSync(path.join(vault,rev.path),"utf8"));
    expect(parsed.data.knowledge_cutoff_as_of).toBe(input.researchLineage!.knowledgeCutoffAsOf);
    expect(Date.parse(String(parsed.data.analysis_created_at))).toBeGreaterThanOrEqual(started);
    expect(Date.parse(String(parsed.data.analysis_created_at))).toBeLessThanOrEqual(Date.now());
    expect(parsed.data.model_version).toBeNull();expect(parsed.data.model_version_status).toBe("not_exposed");
    expect(parsed.data.claim_ids).toHaveLength(2);expect(parsed.body).toContain(review.translationTh);
    // Cold module state uses on-disk bytes/index/journal, not preparation memory.
    vi.resetModules();
    const results=await Promise.all(claims.map(retrieve));
    expect(results.map(x=>x.classification)).toEqual(["duplicate_candidate","duplicate_candidate"]);
    expect(results.map(x=>x.matchingClaims.length)).toEqual([1,1]);
    expect(new Set(results.map(x=>x.matchingClaims[0].claimId)).size).toBe(2);
    for(let i=0;i<2;i++){
      const c=results[i].matchingClaims[0];expect(c.evidenceClass).toBe(claims[i].evidenceClass);
      expect(c.value).toBe(claims[i].value);expect(c.verification).toBe("unverified");expect(c.sourcePath).toBe(source.path);
      expect(c.sourceLocator).toBe(claims[i].sourceLocator);expect(c.reviewReferences).toEqual([rev.path]);expect(c.reviewScanComplete).toBe(true);
      expect(c.receiptKey).toMatch(/^ICW-/);expect(c.sourceReceiptKey).toBe(source.receiptKey);
      expect(c.persistence).toBe("receipt_readback_index_link_verified");expect(c.originIndependenceIncrement).toBe(0);
    }
    const {db}=await import("../db");
    expect(db().prepare("SELECT count(*) n FROM safe_edit_operations WHERE status='written'").get()).toEqual({n:4});
    expect(db().prepare("SELECT count(*) n FROM notes WHERE json_extract(frontmatter,'$.type')='investment_source_intake'").get()).toEqual({n:1});
    for(const receipt of r.receipts)expect(receipt).toMatchObject({receipt:{write:"written",readback:"verified",reindex:"verified"}});
    assertProtected();
  });
  it("source-only observations can later receive one Thai Review; exact/reordered/duplicated retry preserves all bytes and receipts",async()=>{
    const capture={...input,researchReview:undefined,captureOnly:true};const p=await prepare(capture),r=await apply(capture,p);
    expect(r.status).toBe("source_saved_analysis_pending");expect(r.readyForNextNews).toBe(false);
    const original=r.steps.map(s=>fs.readFileSync(path.join(vault,s.path)));const firstJournal=await journal();
    for(const c of claims)expect((await retrieve(c)).matchingClaims[0].reviewReferences).toEqual([]);
    const full=await prepare();expect(full.planId).toBe(p.planId);expect(full.previews.map(x=>x.kind)).toEqual(["canonical_review"]);
    const saved=await apply(input,full);expect(saved.status).toBe("saved_verified");
    expect(r.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(original);
    expect((await journal()).filter((r:unknown)=>firstJournal.some((s:unknown)=>JSON.stringify(r)===JSON.stringify(s)))).toHaveLength(3);
    const all=await journal(),bytes=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)));
    const reordered={...input,claims:[claims[1],claims[0],claims[0]]};
    const again=await prepare(reordered);expect(again.previews).toEqual([]);expect(again.workflowStatus).toBe("saved_verified");
    expect((await apply(reordered,again)).receipts).toEqual([]);expect(await journal()).toEqual(all);
    expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(bytes);assertProtected();
  });
  it("does not backdate runtime creation or accept caller model/version/verification/relationship authority",async()=>{
    const {canonicalInputSchema}=await import("./canonical-writeback");
    for(const researchLineage of [{...input.researchLineage,analysisCreatedAt:"2026-08-26T20:36:00Z"},{...input.researchLineage,modelVersion:"pretend-model"}])expect(()=>canonicalInputSchema.parse({...input,researchLineage})).toThrow();
    for(const change of [{verification:"verified_primary"},{relationship:"supplier"},{reviewPath:"05_Thesis/NVDA - Current Thesis.md"}])expect(()=>canonicalInputSchema.parse({...input,claims:[{...claims[0],...change}]})).toThrow();
    expect(()=>canonicalInputSchema.parse({...input,claims:Array(9).fill(claims[0])})).toThrow();
    await expect(prepare({...input,researchLineage:{knowledgeCutoffAsOf:"2099-08-26T20:36:00Z"}})).rejects.toThrow("knowledge_cutoff_after_analysis");
    await expect(prepare({...input,claims:[{...claims[0],entity:"AMD"}]})).rejects.toThrow("claim_entity_outside_source_scope");assertProtected();
  });
  it("unanchored values hold the affected claim and Review while preserving independent Source capture",async()=>{
    const data={...input,claims:[{...claims[0],value:"999.9"},claims[1]]};const p=await prepare(data);
    expect(p.claimIssues).toContain("claim_literal_source_anchor_missing");expect(p.steps.find(x=>x.kind==="canonical_review")!.state).toBe("hold_claim_gate");
    expect(p.previews.map(x=>x.kind)).not.toContain("canonical_review");
    const r=await apply(data,p);expect(r.readyForNextNews).toBe(false);expect(r.steps[0].state).toBe("verified_existing");assertProtected();
  });
  it("a changed value in the same Source/metric/period/class conflicts without rewriting any historical note or receipt",async()=>{
    const p=await prepare(),saved=await apply(input,p),before=await journal();const bytes=saved.steps.map(x=>fs.readFileSync(path.join(vault,x.path)));
    const changed={...input,claims:[{...claims[0],value:"106"},claims[1]]};const next=await prepare(changed);
    expect(next.steps.some(x=>x.kind==="structured_claim"&&x.state==="hold_conflict")).toBe(true);
    expect(next.previews).toEqual([]);expect(next.readyForNextNews).toBe(false);
    expect(await journal()).toEqual(before);expect(saved.steps.map(x=>fs.readFileSync(path.join(vault,x.path)))).toEqual(bytes);
    expect((await retrieve({...claims[0],value:"106"})).classification).toBe("possible_correction_or_contradiction");assertProtected();
  });
  it("Actual and Guidance identities remain separate even for identical periods/values",async()=>{
    const data={...input,claims:[claims[0],{...claims[0],evidenceClass:"management_guidance" as const}],researchReview:undefined,captureOnly:true};
    const p=await prepare(data),r=await apply(data,p);expect(r.interrupted).toBeNull();
    expect(new Set(r.steps.filter(x=>x.kind==="structured_claim").map(x=>x.path)).size).toBe(2);
    for(const c of data.claims){const found=await retrieve(c);expect(found.matchingClaims).toHaveLength(1);expect(found.matchingClaims[0].evidenceClass).toBe(c.evidenceClass);}
  });
  it("English bypass and forged primary receipt still hold Review, never promote persisted observations",async()=>{
    const data={...input,researchReview:undefined,completedAnalysis:"The outlook is confirmed and the stock is attractive."};const p=await prepare(data);
    expect(p.qualityIssues).toContain("typed_research_review_required");expect(p.previews.some(x=>x.kind==="canonical_review")).toBe(false);
    const forged={...input,researchReview:{...review,claimAssessments:[{...review.claimAssessments[0],resolution:"verified_primary" as const,conclusion:"confirmed" as const,primarySourceUrl:url,primaryEvidenceReceipt:"forged",verifiedValue:"108.0"}]}};
    const w=(await plan(forged)).safeEditWorkflow!;expect(w.qualityIssues.length).toBeGreaterThan(0);
    expect(w.steps.at(-1)!.safeEditRequest).toBeNull();
  });
  it("missing/stale claim readback does not become a verified cold match or overwrite historical receipts",async()=>{
    const p=await prepare(),saved=await apply(input,p),before=await journal();const c=saved.steps.find(x=>x.kind==="structured_claim")!;
    fs.appendFileSync(path.join(vault,c.path),"\nChanged isolated fixture bytes\n");
    const observations=await Promise.all(claims.map(retrieve));expect(observations.some(r=>r.claimBindingHolds.some(x=>x.path===c.path))).toBe(true);
    expect(observations.flatMap(r=>r.matchingClaims).some(x=>x.path===c.path)).toBe(false);
    expect((await prepare()).readyForNextNews).toBe(false);expect(await journal()).toEqual(before);assertProtected();
  });

  it("separate Source-only claim submissions converge to one Source and one Review without increasing origin count",async()=>{
    const capture={...input,researchReview:undefined,captureOnly:true};
    for(const c of claims){const one={...capture,claims:[c]};expect((await apply(one,await prepare(one))).status).toBe("source_saved_analysis_pending");}
    const p=await prepare();expect(p.previews.map(x=>x.kind)).toEqual(["canonical_review"]);expect((await apply(input,p)).status).toBe("saved_verified");
    const {db}=await import("../db");
    expect(db().prepare("SELECT count(DISTINCT json_extract(frontmatter,'$.origin_family')) n FROM notes WHERE json_extract(frontmatter,'$.claim_persistence_version')='RI001-1'").get()).toEqual({n:1});
    expect(db().prepare("SELECT sum(json_extract(frontmatter,'$.origin_independence_increment')) n FROM notes WHERE json_extract(frontmatter,'$.claim_persistence_version')='RI001-1'").get()).toEqual({n:0});assertProtected();
  });
  it("tracking/fragment aliases retain Source/Claim identity and all receipts",async()=>{
    const p=await prepare(),saved=await apply(input,p),before=await journal();
    const alias={...input,sourceUrl:url+"?utm_source=retry#section"};const next=await prepare(alias);
    expect(next.planId).toBe(saved.planId);expect(next.workflowStatus).toBe("saved_verified");expect(next.previews).toEqual([]);expect(await journal()).toEqual(before);
    const found=(await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",entity:"NVDA",metric:"revenue",period:claims[0].period,unit:claims[0].unit,value:claims[0].value,evidenceClass:claims[0].evidenceClass,statement:claims[0].statement,originalSource:alias.sourceUrl});
    expect(found.classification).toBe("duplicate_candidate");
  });
  it("renders untrusted claim metadata inert; links derive only from canonical paths",async()=>{
    const malicious="```\n# Injected #bad-tag [[06_Portfolio/Positions]] <!-- hidden --> ==hi== $math$\n---\n";
    const data={...input,claims:[{...claims[0],sourceLocator:malicious,statement:malicious}],researchReview:undefined,captureOnly:true};
    const r=await apply(data,await prepare(data));expect(r.interrupted).toBeNull();
    const c=r.steps.find(x=>x.kind==="structured_claim")!,{db}=await import("../db");
    expect(db().prepare("SELECT resolved_path FROM links WHERE source_path=?").all(c.path)).toEqual([{resolved_path:r.steps[0].path}]);
    const {splitFrontmatter,extractStructure}=await import("../vault/markdown");
    const structure=extractStructure(splitFrontmatter(fs.readFileSync(path.join(vault,c.path),"utf8")).body);
    expect(structure.tags).toEqual([]);expect(structure.headings.some(h=>h.text.includes("Injected"))).toBe(false);assertProtected();
  });
  it("exposes typed claims through both MCP surfaces, fences cold claim text, and rejects forged wire verification",async()=>{
    const {createMcpServer}=await import("./server"),{createSafeEditMcpServer}=await import("./safe-edit-server");
    const read=createMcpServer({read:true,write:false,label:"claims-read"}),safe=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
    const clients:Client[]=[];
    try{
      for(const server of [read,safe]){const [a,b]=InMemoryTransport.createLinkedPair(),c=new Client({name:"ri-claims",version:"1"});clients.push(c);await server.connect(b);await c.connect(a);}
      const r=(await clients[0].listTools()).tools.find(t=>t.name==="plan_investment_writeback")!,s=(await clients[1].listTools()).tools.find(t=>t.name==="prepare_canonical_writeback")!;
      expect(r.inputSchema.properties!.claims).toEqual(s.inputSchema.properties!.claims);expect(r.inputSchema.properties!.researchLineage).toEqual(s.inputSchema.properties!.researchLineage);
      const response=await clients[0].callTool({name:r.name,arguments:{...input}});expect(response.isError).not.toBe(true);
      const planned=JSON.parse((response.content as {text:string}[])[0].text);
      expect(planned.safeEditWorkflow.steps.filter((x:{kind:string})=>x.kind==="structured_claim")).toHaveLength(2);
      const forged=await clients[0].callTool({name:r.name,arguments:{...input,claims:[{...claims[0],verification:"verified_primary"}]}});expect(forged.isError).toBe(true);
      await apply(input,await prepare());
      const query={domain:"company",entity:"NVDA",metric:claims[0].metric,period:claims[0].period,unit:claims[0].unit,value:claims[0].value,evidenceClass:claims[0].evidenceClass,statement:claims[0].statement,originalSource:url};
      const cold=await clients[0].callTool({name:"review_investment_claim",arguments:query});expect(cold.isError).not.toBe(true);
      const found=JSON.parse((cold.content as {text:string}[])[0].text);expect(found.matchingClaims[0].sourceExcerpt).toMatch(/^%[a-f0-9]{8}%\n/);expect(found.matchingClaims[0].verification).toBe("unverified");
    }finally{await Promise.allSettled(clients.map(c=>c.close()));await read.close();await safe.close();}
  });
  it("rejects stale/partial authorizations and preserves a Source if a later step fails, then recovers only pending steps",async()=>{
    const p=await prepare();const args={input,planId:p.planId,authorizations:p.previews.slice(0,1).map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))};
    await expect((await import("./canonical-writeback")).applyCanonicalWriteback(args,actor)).rejects.toThrow("Authorization must exactly match");
    const interrupted=await (await import("./canonical-writeback")).applyCanonicalWriteback({...args,authorizations:p.previews.map((x,i)=>({operationId:x.operationId,previewToken:i===1?"0".repeat(64):x.previewToken,expectedHash:x.beforeHash}))},actor);
    expect(interrupted.interrupted).toMatch(/Invalid preview token/);expect(interrupted.steps[0].state).toBe("verified_existing");expect(interrupted.readyForNextNews).toBe(false);
    const sourceBytes=fs.readFileSync(path.join(vault,interrupted.steps[0].path));
    const next=await prepare();expect(next.previews.map(x=>x.kind)).toEqual(["structured_claim","structured_claim","canonical_review"]);
    expect((await apply(input,next)).status).toBe("saved_verified");expect(fs.readFileSync(path.join(vault,interrupted.steps[0].path))).toEqual(sourceBytes);assertProtected();
  });
  it("missing link/FTS fails current retrieval without changing historical receipts",async()=>{
    const saved=await apply(input,await prepare()),before=await journal(),c=saved.steps.find(s=>s.kind==="structured_claim")!;
    // Fault injection into the isolated index only; receipts are never fabricated or edited.
    const {db}=await import("../db");db().prepare("DELETE FROM links WHERE source_path=?").run(c.path);
    for(const item of await Promise.all(claims.map(retrieve)))expect(item.claimBindingHolds.some(x=>x.path===c.path)).toBe(true);
    expect((await prepare()).readyForNextNews).toBe(false);expect(await journal()).toEqual(before);
    (await import("../vault/indexer")).reindexPath(c.path);
    db().prepare("DELETE FROM notes_fts WHERE path=?").run(c.path);
    expect((await retrieve(claims[0])).claimBindingHolds.some(x=>x.path===c.path)).toBe(true);expect(await journal()).toEqual(before);assertProtected();
  });

  it("bounds the advertised eight claims without losing first Review admission to its own observations",async()=>{
    const data={...input,claims:Array.from({length:8},(_,n)=>({...claims[0],metric:`revenue definition ${n}`}))};
    const p=await prepare(data);expect(p.previews).toHaveLength(10);
    const saved=await apply(data,p);expect(saved.interrupted).toBeNull();expect(saved.status).toBe("saved_verified");assertProtected();
  });
  it("missing Review backlink is incomplete current lineage, not silently absent history",async()=>{
    const saved=await apply(input,await prepare()),before=await journal(),rev=saved.steps.at(-1)!;
    const {db}=await import("../db");db().prepare("DELETE FROM links WHERE source_path=?").run(rev.path);
    for(const c of claims){const found=(await retrieve(c)).matchingClaims[0];expect(found.reviewReferences).toEqual([]);expect(found.reviewScanComplete).toBe(false);}
    expect((await prepare()).readyForNextNews).toBe(false);expect(await journal()).toEqual(before);assertProtected();
  });

  it("matching bytes/index without an engine create receipt remain a binding HOLD",async()=>{
    const sourceOnly={...input,claims:undefined,researchReview:undefined,captureOnly:true};
    await apply(sourceOnly,await prepare(sourceOnly));
    const w=(await plan()).safeEditWorkflow!,claim=w.steps.find(x=>x.kind==="structured_claim")!;
    fs.writeFileSync(path.join(vault,claim.path),claim.safeEditRequest!.change.content);
    (await import("../vault/indexer")).reindexPath(claim.path);
    const before=await journal(),p=(await plan()).safeEditWorkflow!;
    expect(p.steps.find(x=>x.path===claim.path)!.state).toBe("hold_index_repair");expect(p.claimIssues).toContain("claim_receipt_readback_index_link_unverified");
    expect((await retrieve(claims[0])).claimBindingHolds.some(x=>x.path===claim.path)).toBe(true);
    expect(await journal()).toEqual(before);assertProtected();
  });
  it("adding claims never rewrites an already accepted historical Review",async()=>{
    const prior={...input,claims:undefined,researchLineage:undefined};const r=await apply(prior,await prepare(prior)),before=await journal();
    const oldBytes=r.steps.map(x=>fs.readFileSync(path.join(vault,x.path))),next=await prepare();
    expect(next.steps.find(x=>x.kind==="canonical_review")!.state).toBe("hold_conflict");expect(next.previews.every(x=>x.kind==="structured_claim")).toBe(true);
    const result=await apply(input,next);expect(result.readyForNextNews).toBe(false);
    expect(r.steps.map(x=>fs.readFileSync(path.join(vault,x.path)))).toEqual(oldBytes);
    const rows=await journal();for(const old of before)expect(rows).toContainEqual(old);assertProtected();
  });

  it("keeps event HOLD precedence with simultaneous quality and claim HOLDs",async()=>{
    const other="10_Knowledge/Company Research/Older event.md";
    fs.writeFileSync(path.join(vault,other),`---\nentity: NVDA\nevent_date: 2026-08-26\noriginal_source: ${url}\n---\nHistorical event fixture\n`);
    (await import("../vault/indexer")).reindexPath(other);
    const data={...input,claims:[{...claims[0],value:"999.9"}],researchReview:undefined,completedAnalysis:"English-only analysis without a typed Thai Review."};
    const p=await prepare(data);expect(p.workflowStatus).toBe("hold_source_event_review");
    expect(p.steps.at(-1)!.state).toBe("hold_event_review");expect(p.qualityIssues).toContain("typed_research_review_required");
    expect(p.claimIssues).toContain("claim_literal_source_anchor_missing");expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);expect(p.readyForNextNews).toBe(false);assertProtected();
  });

  it("does not infer an Actual/Guidance class for legacy unclassified records",async()=>{
    const p="10_Knowledge/Company Research/Legacy claim.md";
    fs.writeFileSync(path.join(vault,p),`---\ntype: investment_structured_claim_register\nentity: NVDA\noriginal_source: ${url}\nmetric: revenue\nperiod: Q3 FY2027\nvalue: '108.0'\nunit: USD billion\nverification: unverified\n---\nLegacy fixture\n`);
    (await import("../vault/indexer")).reindexPath(p);
    const found=await retrieve(claims[1]);expect(found.matchingClaims).toHaveLength(1);expect(found.classification).toBe("unresolved");
    expect(found.matchingClaims[0].evidenceClass).toBeUndefined();assertProtected();
  });
});

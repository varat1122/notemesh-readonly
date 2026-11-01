import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {McpAccess} from "./server";

// Same real-file/index/SDK fixtures as m54-canonical-integration; only Sync is
// replaced. Every write is inside a disposable synthetic Vault.
let afterSyntheticWrites:(()=>void)|undefined;
vi.mock("../safe-edit/sync",()=>({withPausedSync:async(run:()=>unknown)=>{const value=run();afterSyntheticWrites?.();return value;}}));
let root:string,vault:string;
const clients:Array<{client:Client;server:{close:()=>Promise<void>}}> = [];
const access:McpAccess={read:true,write:false,label:"oauth:core-eng-002",scopes:["vault:read","vault:edit"]};
const review={headlineTh:"เหตุการณ์จำลองเกี่ยวกับ NVDA",whatChangedTh:"ข้อมูลใหม่ที่ยังไม่ยืนยัน",
  mechanismTh:"อุปสงค์อาจส่งผลต่อกำไร",thesisImplicationTh:"ยังไม่เปลี่ยน Thesis",
  counterEvidenceTh:"ข้อโต้แย้งจำลองต้องตรวจต้นฉบับ",requiredEvidenceTh:"ต้องตรวจหลักฐานเพิ่มเติม"};
const news={domain:"company",entities:["NVDA"],topic:"NVDA synthetic event A",inputFormat:"text",
  sourceKind:"archived_chat",sourceChat:"CORE-ENG-002 synthetic",sourceLanguage:"th",
  extractedText:"ข้อความต้นทางจำลอง NVDA event A ไม่มีข้ออ้างการลงทุนจริง",
  eventDate:"2026-10-28",publicationDate:"2026-10-29",publisher:"Synthetic origin",
  contentTypes:["analyst_opinion"],sourceChannel:"archived_chat",originalDocumentAccess:"not_obtained",
  researchReview:review};
beforeEach(async()=>{
  afterSyntheticWrites=undefined;
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"core-eng-002-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.BASE_URL="https://core-eng-002.invalid";
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";process.env.M55_REQUIRE_TYPED_REVIEW="1";
  vi.resetModules();
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("External network forbidden in local audit");}));
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","10_Knowledge/Industry and Concepts","10_Knowledge/Macro and Markets"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  await seed("01_Companies/NVDA.md","# NVDA synthetic hub\n");
  await seed("05_Thesis/NVDA - Current Thesis.md","# Protected synthetic thesis\n");
  await seed("05_Thesis/NVDA - Evidence Register.md","# Protected synthetic register\n");
});
afterEach(async()=>{
  for(const {client,server} of clients.splice(0)){await client.close();await server.close();}
  expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","M55_REQUIRE_TYPED_REVIEW"])delete process.env[k];
});
async function seed(rel:string,content:string){
  fs.mkdirSync(path.dirname(path.join(vault,rel)),{recursive:true});fs.writeFileSync(path.join(vault,rel),content);
  (await import("../vault/indexer")).reindexPath(rel);
}
async function connect(resource:"research"|"safe-edit"){
  const server=resource==="research"?(await import("./server")).createMcpServer(access):
    (await import("./safe-edit-server")).createSafeEditMcpServer(access);
  const client=new Client({name:"core-eng-002-test",version:"1"});
  const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(b),client.connect(a)]);
  clients.push({client,server});return client;
}
function unpack(result:any,safe=false){
  expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
  const value=JSON.parse(result.content[0].text);
  return safe?JSON.parse(value.result.split("\n").slice(1,-1).join("\n")):value;
}
async function save(input:Record<string,unknown>){
  const client=await connect("safe-edit");
  const p=unpack(await client.callTool({name:"prepare_canonical_writeback",arguments:input}),true);
  const authorizations=p.previews.map((x:any)=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}));
  const result=unpack(await client.callTool({name:"apply_canonical_writeback",arguments:{input,planId:p.planId,authorizations}}),true);
  return {client,p,result};
}

it.each([
  ["investment_context_pack","research",{question:"NVDA context",unsupportedCutoff:"2026-10-29"}],
  ["plan_investment_writeback","research",{...news,completedAnalysis:"บทวิเคราะห์",policyVersion:"synthetic-policy-1"}],
  ["prepare_canonical_writeback","safe-edit",{...news,policyVersion:"synthetic-policy-1"}],
  ["prepare_canonical_writeback","safe-edit",{...news,brokerUpdate:{bank:"Synthetic",estimateVintage:"2026-10-29"}}],
] as const)("CORE-ENG-002 rejects unsupported fields instead of silently stripping them on %s (%s)",async(name,resource,input)=>{
  const client=await connect(resource);
  const result=await client.callTool({name,arguments:input});
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toMatch(/unrecognized|unknown/i);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
});

it("CORE-ENG-002 rejects unknown apply metadata before any canonical write",async()=>{
  const client=await connect("safe-edit");
  const p=unpack(await client.callTool({name:"prepare_canonical_writeback",arguments:news}),true);
  const authorizations=p.previews.map((x:any)=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}));
  const result=await client.callTool({name:"apply_canonical_writeback",arguments:{input:news,planId:p.planId,authorizations,policyVersion:"unsupported"}});
  expect(result.isError).toBe(true);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
});

it("CORE-ENG-002 does not silently remove an unsupported issuer identifier from retrieval scope",async()=>{
  const client=await connect("research");
  const result=await client.callTool({name:"investment_context_pack",arguments:{question:"SK hynix context",issuers:["SK hynix"]}});
  expect(result.isError).toBe(true);
});

it("CORE-ENG-002 preserves accepted completedAnalysis alongside the typed review through physical readback",async()=>{
  const supplemental="## Provenance\nPolicy reference: synthetic-policy-1\nProtocol/schema: synthetic-protocol-1\nProducer/model/method: unknown\nAs-of: 2026-10-29\nContext ref: [[01_Companies/NVDA]]\nCoverage/limitations: เอกสารจำลองเท่านั้น";
  const {result}=await save({...news,completedAnalysis:supplemental});
  expect(result.status).toBe("saved_verified");
  const saved=result.steps.find((s:any)=>s.kind==="canonical_review");
  const bytes=fs.readFileSync(path.join(vault,saved.path),"utf8");
  expect(bytes).toContain(supplemental);expect(bytes).toContain(review.counterEvidenceTh);
  expect(bytes).toContain('event_date: "2026-10-28"');expect(bytes).toContain('published_at: "2026-10-29"');
});

it("CORE-ENG-002 preserves broker estimate vintage and PT horizons accepted by the canonical planner",async()=>{
  const brokerUpdate={bank:"Synthetic Bank",priorBank:"Synthetic Bank",reportDate:"2026-10-29",priorReportDate:"2026-09-29",
    targetPrice:"120",priorTargetPrice:"100",currency:"USD",priorCurrency:"USD",targetHorizon:"next 12 months",priorTargetHorizon:"next 12 months",
    estimateChanges:[{metric:"EPS",period:"FY2027",oldValue:"1",newValue:"2",unit:"USD/share"}]};
  const {result}=await save({...news,brokerUpdate});
  const saved=result.steps.find((s:any)=>s.kind==="canonical_review");
  const bytes=fs.readFileSync(path.join(vault,saved.path),"utf8");
  for(const token of ["2026-10-29","2026-09-29","EPS FY2027","next 12 months"])expect(bytes).toContain(token);
});

it.each(["capture","freeform","typed"])("CORE-ENG-002 retains declared Source provenance in %s mode",async(mode)=>{
  if(mode==="freeform")process.env.M55_REQUIRE_TYPED_REVIEW="0";
  const input={...news,sourceChannel:"chat_attachment",attributedOrigin:"Synthetic attributed publisher",originalDocumentAccess:"excerpt_only",
    researchReview:mode==="typed"?review:undefined,
    completedAnalysis:mode==="freeform"?"บทวิเคราะห์จำลองพร้อมข้อจำกัด":undefined,
    captureOnly:mode==="capture"?true:undefined};
  const {result}=await save(input);
  expect(result.status).toBe(mode==="capture"?"source_saved_analysis_pending":"saved_verified");
  for(const step of result.steps){
    const content=fs.readFileSync(path.join(vault,step.path),"utf8");
    expect(content).toContain('source_channel: "chat_attachment"');
    expect(content).toContain('attributed_origin: "Synthetic attributed publisher"');
    expect(content).toContain('original_document_access: "excerpt_only"');
    expect(content).toContain("verification: not_reverified");
  }
});

it("CORE-ENG-002 refuses saved_verified after required link index loss and recovers after existing reindex",async()=>{
  const {client,result}=await save(news);expect(result.status).toBe("saved_verified");
  const saved=result.steps.find((s:any)=>s.kind==="canonical_review");
  const d=(await import("../db")).db();
  d.prepare("DELETE FROM links WHERE source_path=?").run(saved.path);
  const broken=unpack(await client.callTool({name:"prepare_canonical_writeback",arguments:news}),true);
  expect(broken.workflowStatus).toBe("hold_conflict_or_index");
  expect(broken.steps.find((s:any)=>s.kind==="canonical_review").state).toBe("hold_index_repair");
  (await import("../vault/indexer")).reindexPath(saved.path);
  const repaired=unpack(await client.callTool({name:"prepare_canonical_writeback",arguments:news}),true);
  expect(repaired.workflowStatus).toBe("saved_verified");expect(repaired.previews).toEqual([]);
});

it("CORE-ENG-002 only reports counter-evidence included when its text survives the excerpt budget",async()=>{
  await seed("05_Thesis/NVDA - Evidence Register.md",[
    "# NVDA context",...Array.from({length:8},()=>"x".repeat(300)),"## Counter-evidence","COUNTER_ONLY_MARKER",...Array(8).fill("tail")
  ].join("\n"));
  const client=await connect("research");
  const pack=unpack(await client.callTool({name:"investment_context_pack",arguments:{question:"NVDA context",issuers:["NVDA"]}}));
  const item=pack.items.find((x:any)=>x.role==="evidence_register");
  expect(item.excerpt).not.toContain("COUNTER_ONLY_MARKER");
  expect(item.counterEvidenceExcerptIncluded).toBe(false);
});

it.each(["typed","legacy"])("CORE-ENG-002 keeps an existing content conflict visible when %s quality also fails",async(mode)=>{
  const {client,result}=await save(news);expect(result.status).toBe("saved_verified");
  const changed=mode==="typed"?{...news,researchReview:{...review,headlineTh:"untranslated changed analysis"}}:
    {...news,researchReview:undefined,completedAnalysis:"บทวิเคราะห์เดิมที่ยังไม่เป็น typed review"};
  const p=unpack(await client.callTool({name:"prepare_canonical_writeback",arguments:changed}),true);
  expect(p.qualityIssues).toContain(mode==="typed"?"headlineTh_thai_required":"typed_research_review_required");
  expect(p.steps.find((s:any)=>s.kind==="canonical_review").state).toBe("hold_conflict");
  expect(p.workflowStatus).toBe("hold_conflict_or_index");
  expect(p.previews).toEqual([]);
});

it("CORE-ENG-002 Event A save then Event B retrieves the dated AI review with Source and Hub links",async()=>{
  const {client:safe,result}=await save(news);expect(result.status).toBe("saved_verified");
  const saved=result.steps.find((s:any)=>s.kind==="canonical_review");
  const source=result.steps.find((s:any)=>s.kind==="source_intake");
  const client=await connect("research");
  const pack=unpack(await client.callTool({name:"investment_context_pack",arguments:{question:"NVDA event B versus event A",issuers:["NVDA"],maxNotes:16}}));
  expect(pack.warnings.join(" ")).toContain("No as-of/knowledge-cutoff filter");
  const found=pack.items.find((x:any)=>x.path===saved.path);expect(found).toBeDefined();
  expect(found.schemaCompatibility.role).toBe("review");
  expect(found.schemaCompatibility.independenceAssessment).toBe("not_independent_archived_ai");
  expect(found.declaredEventDate).toBe("2026-10-28");expect(found.declaredPublishedAt).toBe("2026-10-29");
  const {inspectCanonicalKnowledgeMetadata}=await import("../vault/investment-knowledge-schema");
  const {splitFrontmatter}=await import("../vault/markdown");
  const sourceMetadata=splitFrontmatter(fs.readFileSync(path.join(vault,source.path),"utf8")).data;
  expect(inspectCanonicalKnowledgeMetadata(source.path,sourceMetadata).role).toBe("source");
  expect(inspectCanonicalKnowledgeMetadata("07_Sources/ChatGPT/archive.md",sourceMetadata).role).toBe("archive");
  const links=(await import("../db")).db().prepare("SELECT resolved_path FROM links WHERE source_path=?").all(saved.path);
  expect(links).toEqual(expect.arrayContaining([{resolved_path:source.path},{resolved_path:"01_Companies/NVDA.md"}]));
  const read=unpack(await client.callTool({name:"read_note",arguments:{path:saved.path}}));
  expect(read.content).toContain(review.counterEvidenceTh);
  const eventB=unpack(await client.callTool({name:"plan_investment_writeback",arguments:{
    domain:news.domain,entities:news.entities,topic:"NVDA synthetic event B",
    inputFormat:news.inputFormat,sourceKind:news.sourceKind,sourceChat:news.sourceChat,
    sourceLanguage:news.sourceLanguage,publisher:news.publisher,
    extractedText:"ข้อความต้นทางจำลอง NVDA event B สำหรับเทียบกับ event A",
    eventDate:"2026-10-30",publicationDate:"2026-10-31",
    completedAnalysis:"บทวิเคราะห์จำลอง Event B ต้องอ่าน Event A ก่อนตัดสินความแตกต่าง"
  }}));
  expect(eventB.status).toBe("read_only_plan_not_written");
  expect(eventB.historical.paths).toContain(saved.path);
  expect(eventB.historicalEventReview.duplicateAdjudicated).toBe(false);
  expect(eventB.safeEditWorkflow.writesPerformedByPlanner).toBe(false);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toHaveLength(1);
  const retry=unpack(await safe.callTool({name:"prepare_canonical_writeback",arguments:news}),true);
  expect(retry.previews).toEqual([]);
  expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected synthetic thesis\n");
});

it("CORE-ENG-003 carries structured provenance and the actual MCP context manifest through canonical readback",async()=>{
  const reader=await connect("research");
  const pack=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA earnings",issuers:["NVDA"]}}));
  const provenance={policy:{reference:"synthetic-policy",version:"1"},protocol:{reference:"synthetic-protocol",version:"1"},
    schema:{reference:"synthetic-research-schema",version:"1"},producer:{kind:"llm",id:"unknown",model:"unknown",method:"synthetic-fixture",version:"unknown"},
    context:pack.manifest,coverage:"Synthetic notes only",limitations:["No live verification"]};
  const {client,result}=await save({...news,researchProvenance:provenance});
  expect(result.status).toBe("saved_verified");expect(result.provenanceStatus).toBe("context_bound_current_bytes");
  const {splitFrontmatter}=await import("../vault/markdown");
  for(const step of result.steps){
    const bytes=fs.readFileSync(path.join(vault,step.path),"utf8");
    expect(splitFrontmatter(bytes).data.research_provenance).toEqual(provenance);
    const read=unpack(await reader.callTool({name:"read_note",arguments:{path:step.path}}));
    expect(read.content).toContain(pack.manifest.id);
  }
  const retry=unpack(await client.callTool({name:"prepare_canonical_writeback",arguments:{...news,researchProvenance:provenance}}),true);
  expect(retry.workflowStatus).toBe("saved_verified");expect(retry.previews).toEqual([]);
});

it("CORE-ENG-003 rejects stale context after preview before the first Source write",async()=>{
  const reader=await connect("research"),writer=await connect("safe-edit");
  const pack=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA context",issuers:["NVDA"]}}));
  const input={...news,researchProvenance:{context:pack.manifest}};
  const p=unpack(await writer.callTool({name:"prepare_canonical_writeback",arguments:input}),true);
  await seed("01_Companies/NVDA.md","# NVDA changed after retrieval\n");
  const result=await writer.callTool({name:"apply_canonical_writeback",arguments:{input,planId:p.planId,
    authorizations:p.previews.map((x:any)=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))}});
  expect(result.isError).toBe(true);expect(JSON.stringify(result.content)).toContain("CONTEXT_VERSION_CHANGED");
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
});

it("CORE-ENG-003 accepts cutoff at the MCP boundary and propagates structured declarations through the read planner",async()=>{
  const reader=await connect("research");
  const asOf=new Date().toISOString();
  const pack=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA context",issuers:["NVDA"],asOf}}));
  expect(pack.manifest.asOf).toBe(asOf);
  const provenance={asOf,policy:{reference:"synthetic",version:"unverified"},coverage:"local fixture",limitations:["bounded"]};
  const p=unpack(await reader.callTool({name:"plan_investment_writeback",arguments:{domain:"company",entities:["NVDA"],
    topic:"NVDA synthetic",inputFormat:"text",sourceKind:"archived_chat",extractedText:"Synthetic input",
    sourceChat:"CORE-ENG-003",completedAnalysis:"บทวิเคราะห์จำลอง",researchProvenance:provenance}}));
  expect(p.researchProvenance).toEqual(provenance);expect(p.historical.manifest.asOf).toBe(asOf);
});

it("CORE-ENG-003 returns durable receipts if context changes after writes but before final verification",async()=>{
  const reader=await connect("research");
  const pack=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA context",issuers:["NVDA"]}}));
  afterSyntheticWrites=()=>fs.appendFileSync(path.join(vault,"01_Companies/NVDA.md"),"\nChanged after the write receipts\n");
  const {result}=await save({...news,researchProvenance:{context:pack.manifest}});
  expect(result.status).toBe("hold_post_write_verification");expect(result.readyForNextNews).toBe(false);
  expect(result.receipts).toHaveLength(2);expect(result.postWriteVerificationError).toContain("CONTEXT_VERSION_CHANGED");
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toHaveLength(1);
});

it("CORE-ENG-003 isolated A save B retrieve/save retains the exact used context and excludes future notes",async()=>{
  const reader=await connect("research");
  await new Promise(r=>setTimeout(r,15));const cutoffA=new Date().toISOString();
  const a=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA event A",issuers:["NVDA"],asOf:cutoffA}}));
  expect(a.manifest.entries.length).toBeGreaterThan(0);
  const pa={asOf:cutoffA,context:a.manifest,policy:{reference:"synthetic-policy",version:"1"},
    protocol:{reference:"synthetic-protocol",version:"1"},schema:{reference:"synthetic-schema",version:"1"},
    producer:{kind:"llm",id:"unknown",model:"unknown",method:"declared synthetic analysis",version:"unknown"},limitations:["Local synthetic acceptance only"]};
  const savedA=await save({...news,researchProvenance:pa});expect(savedA.result.status).toBe("saved_verified");
  const reviewA=savedA.result.steps.find((x:any)=>x.kind==="canonical_review");
  await new Promise(r=>setTimeout(r,15));const cutoffB=new Date().toISOString();
  await new Promise(r=>setTimeout(r,15));
  await seed("10_Knowledge/Company Research/Investment Review - NVDA - FUTURE_B_SECRET.md","# NVDA event B\nFUTURE_B_SECRET");
  const replayA=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA event A",issuers:["NVDA"],asOf:cutoffA}}));
  expect(JSON.stringify(replayA)).not.toContain("FUTURE_B_SECRET");
  expect(replayA.manifest.entries.map((x:any)=>[x.path,x.contentSha256])).toEqual(a.manifest.entries.map((x:any)=>[x.path,x.contentSha256]));
  const b=unpack(await reader.callTool({name:"investment_context_pack",arguments:{question:"NVDA event B versus event A",issuers:["NVDA"],asOf:cutoffB,maxNotes:16}}));
  expect(b.items.some((x:any)=>x.path===reviewA.path)).toBe(true);expect(JSON.stringify(b)).not.toContain("FUTURE_B_SECRET");
  expect(b.items.find((x:any)=>x.path===reviewA.path).provenanceSummary).toMatchObject({asOf:cutoffA,contextId:a.manifest.id,policy:pa.policy,status:"note_declared_not_reverified"});
  const inputB={...news,topic:"NVDA synthetic event B",extractedText:"ข้อความต้นทางจำลอง NVDA event B ที่ต้องเปรียบเทียบกับ A",eventDate:"2026-10-30",publicationDate:"2026-10-31",
    researchReview:{...review,whatChangedTh:"เปรียบเทียบข้อมูลใหม่กับ Event A โดยยังไม่ตัดสิน Thesis"},researchProvenance:{...pa,asOf:cutoffB,context:b.manifest}};
  const savedB=await save(inputB);expect(savedB.result.status).toBe("saved_verified");
  const reviewB=savedB.result.steps.find((x:any)=>x.kind==="canonical_review");
  const {splitFrontmatter}=await import("../vault/markdown");
  const persisted=splitFrontmatter(fs.readFileSync(path.join(vault,reviewB.path),"utf8")).data.research_provenance as any;
  expect(persisted.context).toEqual(b.manifest);
  expect(persisted.context.entries.some((x:any)=>x.path===reviewA.path)).toBe(true);
  console.info("CORE_ENG_003_CLOSED_LOOP "+JSON.stringify({cutoffA,cutoffB,manifestA:a.manifest.id,manifestB:b.manifest.id,
    reviewA:reviewA.path,reviewB:reviewB.path,receiptsA:savedA.result.receipts,receiptsB:savedB.result.receipts,
    replayAMatched:true,futureExcluded:true,provenanceReadbackMatched:true,protectedUnchanged:fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")==="# Protected synthetic thesis\n"}));
});

it("CORE-ENG-003 preserves Feed Only provenance and refuses to silently replace it on an immutable prior Source",async()=>{
  const input={...news,researchReview:undefined,captureOnly:true,researchProvenance:{policy:{reference:"synthetic",version:"1"},asOf:null}};
  const {client,result}=await save(input);expect(result.status).toBe("source_saved_analysis_pending");
  const source=result.steps[0];const before=fs.readFileSync(path.join(vault,source.path),"utf8");
  expect((await import("../vault/markdown")).splitFrontmatter(before).data.research_provenance).toEqual(input.researchProvenance);
  const changed=await client.callTool({name:"prepare_canonical_writeback",arguments:{...input,researchProvenance:{policy:{reference:"synthetic",version:"2"}}}});
  expect(changed.isError).toBe(true);expect(JSON.stringify(changed.content)).toContain("SOURCE_CAPTURE_PROVENANCE_IMMUTABLE_USE_REVIEW");
  expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toBe(before);
});

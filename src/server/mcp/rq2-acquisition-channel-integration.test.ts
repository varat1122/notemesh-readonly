import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {McpAccess} from "./server";

// RQ-2 acquisitionChannel end to end through the real MCP surfaces, modelled on
// m53-canonical-integration.test.ts (unchanged). Mock/stub boundary, disclosed:
//  - ONLY the cloud Sync daemon pause (../safe-edit/sync withPausedSync) is
//    stubbed to run inline, exactly as in the M5.3 harness;
//  - MCP clients use InMemoryTransport with synthetic McpAccess objects (no
//    OAuth server, no network);
//  - everything else is real: research MCP (plan/search/links/read/context),
//    Safe Edit MCP (prepare/apply/status), SQLite journal and receipts,
//    filesystem, SHA readback, FTS index and the link index.
// Isolated synthetic Vault in a temp DATA_DIR; no real Vault or real data.
vi.mock("../safe-edit/sync",()=>({withPausedSync:async(run:()=>unknown)=>run()}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"rq2-acq-mcp-"));
const vault=path.join(root,"vault");
process.env.DATA_DIR=root;
process.env.BASE_URL="https://rq2-acquisition-fixture.test";
process.env.SAFE_EDIT_ENABLED="1";
process.env.SAFE_EDIT_SINGLE_WRITER="1";
process.env.ENCRYPTION_KEY??=Buffer.alloc(32,5).toString("base64");
const readAccess:McpAccess={read:true,write:false,label:"oauth:rq2-read",scopes:["vault:read"]};
const editAccess:McpAccess={read:true,write:false,label:"oauth:rq2-edit",scopes:["vault:read","vault:edit"]};
const T={timeout:60_000};
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const THESIS="05_Thesis/AMAT - Current Thesis.md",PORTFOLIO="06_Portfolio/Holdings.md";
const review={headlineTh:"ข้อความทดสอบ AMAT รายงานรายได้ไตรมาส",translationTh:"ข้อความสมมติจากหน้านักลงทุนสัมพันธ์ของบริษัท",
  whatChangedTh:"ยังไม่ได้ตรวจเอกสารต้นฉบับฉบับเต็มของบริษัท",mechanismTh:"ผลต่อรายได้และกำไรยังต้องตรวจสอบ",
  thesisImplicationTh:"ยังไม่ปรับ Thesis",counterEvidenceTh:"ข้อมูลเป็นเพียงบางส่วนของเอกสาร",
  requiredEvidenceTh:"ตรวจเอกสารต้นฉบับและวันที่ประกาศ"};
const base={domain:"company",entities:["AMAT"],topic:"AMAT 4QFY26 issuer release excerpt",inputFormat:"text",
  sourceKind:"issuer_release",sourceLanguage:"en",sourceUrl:"https://ir.appliedmaterials.com/news-releases/synthetic-4q-fy2026",
  publisher:"Applied Materials (issuer IR page)",eventDate:"2026-11-13",publicationDate:"2026-11-13",
  contentTypes:["reported_fact"],entityRoles:[{entity:"AMAT",role:"primary_subject"}],
  sourceChannel:"issuer_ir_website",originalDocumentAccess:"excerpt_only",researchReview:review};
const text=(tag:string)=>`Synthetic only (${tag}): AMAT reported fourth-quarter fiscal 2026 results; excerpt, not the full release.`;
// Each case is its own synthetic source event (URL + dates); a shared URL/date
// would correctly trigger the planner's existing same-source-event HOLD.
let n=0;const own=(tag:string)=>{n++;const day=String(n).padStart(2,"0");
  return {extractedText:text(tag),sourceUrl:`https://ir.appliedmaterials.com/news-releases/synthetic-${tag.replace(/\W+/g,"-")}`,
    eventDate:`2026-10-${day}`,publicationDate:`2026-10-${day}`};};
const assistant={...base,sourceChat:"Micro 241126 assistant-read IR page (NOT user submitted)",...own("assistant"),acquisitionChannel:"assistant_retrieved"};
const userSubmitted={...base,sourceChat:"Micro 241126 user pasted excerpt",...own("user"),acquisitionChannel:"user_submitted"};
const {acquisitionChannel:_omitted,...legacyUser}=userSubmitted;void _omitted;
const legacy={...legacyUser,...own("legacy client")};

function parseResearch(result:any){
  expect(result.isError,JSON.stringify(result).slice(0,600)).not.toBe(true);
  return JSON.parse(result.content.find((x:any)=>x.type==="text")!.text);
}
function parseSafe(result:any){
  expect(result.isError,JSON.stringify(result).slice(0,600)).not.toBe(true);
  const framed=JSON.parse(result.content.find((x:any)=>x.type==="text")!.text);
  return JSON.parse(framed.result.split("\n").slice(1,-1).join("\n"));
}
async function connect(server:any){
  const client=new Client({name:"rq2-acquisition-integration",version:"1"});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);
  return {client,close:async()=>{await client.close();await server.close();}};
}
let research:Awaited<ReturnType<typeof connect>>,safe:Awaited<ReturnType<typeof connect>>,protectedBefore:string[];
const disk=(p:string)=>fs.readFileSync(path.join(vault,p));
const plan=async(input:object)=>parseResearch(await research.client.callTool({name:"plan_investment_writeback",arguments:input as Record<string,unknown>}));
const prepare=async(input:object)=>parseSafe(await safe.client.callTool({name:"prepare_canonical_writeback",arguments:input as Record<string,unknown>}));
const apply=async(input:object,prepared:any)=>parseSafe(await safe.client.callTool({name:"apply_canonical_writeback",arguments:{input,planId:prepared.planId,
  authorizations:prepared.previews.map((x:any)=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))}}));
const status=async(operationId:string)=>parseSafe(await safe.client.callTool({name:"get_edit_status",arguments:{operationId}}));
const links=async(p:string,direction:"outgoing"|"backlinks")=>parseResearch(await research.client.callTool({name:"get_links",arguments:{path:p,direction,limit:50}}));
const srcStep=(p:any)=>p.safeEditWorkflow.steps.find((s:any)=>s.kind==="source_intake");
const revStep=(p:any)=>p.safeEditWorkflow.steps.find((s:any)=>s.kind==="canonical_review");
// Full closed loop for one input; returns the paths and receipt operation IDs.
async function saveClosedLoop(input:object){
  const first=await plan(input);
  expect(first.status).toBe("read_only_plan_not_written");
  const prepared=await prepare(input);
  const saved=await apply(input,prepared);
  expect(saved.status).toBe("saved_verified");
  expect(saved.completedWriteReceipts).toBe(prepared.previews.length);
  for(const prev of prepared.previews){
    expect(await status(prev.operationId)).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified",
      mobileSync:"unverified",remoteSync:"unverified"}});
    expect(sha(disk(prev.path))).toBe(prev.expectedSha256);
  }
  const again=await plan(input);
  expect(again.safeEditWorkflow).toMatchObject({status:"saved_verified",readyForNextNews:true,analysisComplete:true});
  expect(again.safeEditWorkflow.steps.every((s:any)=>s.readbackVerified&&s.indexed&&s.searchable)).toBe(true);
  const sourcePath=srcStep(first).path,reviewPath=revStep(first).path;
  const searched=parseResearch(await research.client.callTool({name:"search_vault",arguments:{query:"InvestmentIntake"+first.planId.slice(3),limit:20}}));
  expect(searched.items.map((x:any)=>x.path)).toEqual(expect.arrayContaining([sourcePath,reviewPath]));
  const out=await links(reviewPath,"outgoing");
  expect(out.items).toEqual(expect.arrayContaining([{target:sourcePath.slice(0,-3),resolved:sourcePath},{target:"01_Companies/AMAT",resolved:"01_Companies/AMAT.md"}]));
  expect((await links(sourcePath,"backlinks")).items.map((x:any)=>x.path)).toContain(reviewPath);
  return {planId:first.planId,sourcePath,reviewPath,prepared,first};
}

beforeAll(async()=>{
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","02_Industries_Themes","10_Knowledge/Company Research","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  const {reindexPath}=await import("../vault/indexer");
  fs.writeFileSync(path.join(vault,"01_Companies/AMAT.md"),"# AMAT (synthetic hub)\n");reindexPath("01_Companies/AMAT.md");
  fs.writeFileSync(path.join(vault,THESIS),"# Protected AMAT thesis fixture\n");
  fs.writeFileSync(path.join(vault,PORTFOLIO),"# Private portfolio fixture\n");
  protectedBefore=[THESIS,PORTFOLIO].map(p=>sha(disk(p)));
  const {createMcpServer}=await import("./server");
  const {createSafeEditMcpServer}=await import("./safe-edit-server");
  research=await connect(createMcpServer(readAccess));
  safe=await connect(createSafeEditMcpServer(editAccess));
});
afterAll(async()=>{
  await research?.close();await safe?.close();
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});

describe("RQ-2 acquisitionChannel through MCP plan → prepare → apply → receipt → readback → index → wikilinks",()=>{
  it("assistant_retrieved: attributed provenance end to end, never user-supplied and never verified primary",T,async()=>{
    const saved=await saveClosedLoop(assistant);
    const source=disk(saved.sourcePath).toString("utf8"),reviewBytes=disk(saved.reviewPath).toString("utf8");
    for(const note of [source,reviewBytes]){
      expect(note).not.toMatch(/user[_ -]supplied|user_input_not_publisher_verified|Attributed User Source/i);
      expect(note).toMatch(/acquisition_channel: "assistant_retrieved"/);
      expect(note).toMatch(/document_coverage: "excerpt_only"/);
    }
    expect(source).toMatch(/^source_type: attributed$/m);
    expect(source).toMatch(/^verification: not_reverified$/m);
    expect(source).toContain('not_verified: ["acquisition_channel","publisher_authenticity","original_document_bytes","claim_truth","source_url_authority"]');
    expect(source).toContain("## Preserved source text");
    expect(saved.first.sourceCapture.originalSourceVerified).toBe(false);
    // Readback through MCP and retrieval: the saved Source/Review are retrievable
    // context, not verified primary evidence.
    expect(JSON.stringify(await research.client.callTool({name:"read_note",arguments:{path:saved.sourcePath}}))).toContain("assistant_retrieved");
    const pack=parseResearch(await research.client.callTool({name:"investment_context_pack",arguments:{question:"AMAT fourth-quarter fiscal 2026 results",issuers:["AMAT"]}}));
    expect(pack.status).toBe("retrieval_only_not_verified");
    const items=pack.items.filter((i:any)=>[saved.sourcePath,saved.reviewPath].includes(i.path));
    expect(items.length).toBeGreaterThan(0);
    for(const item of items)expect(item.declaredVerification).not.toBe("verified");
  });
  it("user_submitted keeps the legacy template; a legacy client omitting the field gets identical bytes and still saves",T,async()=>{
    const explicit=await plan(userSubmitted),omitted=await plan(legacyUser);
    expect(explicit.planId).toBe(omitted.planId);
    expect(explicit.safeEditWorkflow.steps.map((s:any)=>[s.receiptKey,s.expectedSha256])).toEqual(omitted.safeEditWorkflow.steps.map((s:any)=>[s.receiptKey,s.expectedSha256]));
    const user=await saveClosedLoop(userSubmitted),old=await saveClosedLoop(legacy);
    for(const saved of [user,old]){
      const source=disk(saved.sourcePath).toString("utf8");
      expect(source).toMatch(/^source_type: user_supplied$/m);
      expect(source).toContain("## User-supplied original language text");
      expect(source).not.toMatch(/acquisition_channel|document_coverage/);
      expect(disk(saved.reviewPath).toString("utf8")).toContain("Exact user-supplied source:");
    }
  });
  it("an existing Source and its receipt are never overwritten by a retry or by a contradicting channel",T,async()=>{
    // Same assistant input again: nothing to preview, nothing written.
    const first=await plan(assistant),sourcePath=srcStep(first).path,reviewPath=revStep(first).path;
    const before=[sourcePath,reviewPath].map(p=>sha(disk(p))),receiptsBefore=await Promise.all(first.safeEditWorkflow.steps.map((s:any)=>status(s.receiptKey)));
    const retry=await prepare(assistant);
    expect(retry.previews).toEqual([]);
    expect((await apply(assistant,retry)).completedWriteReceipts).toBe(0);
    // A legacy captureOnly Source, then the same Source declared assistant_retrieved.
    const capture={...legacy,...own("captured legacy"),captureOnly:true,researchReview:undefined};
    const captured=await prepare(capture);
    expect(captured.previews.map((p:any)=>p.kind)).toEqual(["source_intake"]);
    expect((await apply(capture,captured)).completedWriteReceipts).toBe(1);
    const capturedPath=captured.previews[0].path,capturedBytes=sha(disk(capturedPath)),capturedReceipt=await status(captured.previews[0].operationId);
    const contradicting={...capture,captureOnly:undefined,researchReview:review,acquisitionChannel:"assistant_retrieved"};
    const held=await plan(contradicting);
    expect(srcStep(held)).toMatchObject({state:"verified_existing"});
    expect(revStep(held)).toMatchObject({state:"hold_quality_gate"});
    expect(held.safeEditWorkflow.qualityIssues).toContain("existing_source_acquisition_conflict_correction_required");
    const heldPrepare=await prepare(contradicting);
    expect(heldPrepare.previews).toEqual([]);
    expect(heldPrepare.qualityIssues).toContain("existing_source_acquisition_conflict_correction_required");
    expect((await apply(contradicting,heldPrepare)).completedWriteReceipts).toBe(0);
    expect(fs.existsSync(path.join(vault,revStep(held).path))).toBe(false);
    expect(sha(disk(capturedPath))).toBe(capturedBytes);
    expect(await status(captured.previews[0].operationId)).toEqual(capturedReceipt);
    expect([sourcePath,reviewPath].map(p=>sha(disk(p)))).toEqual(before);
    expect(await Promise.all(first.safeEditWorkflow.steps.map((s:any)=>status(s.receiptKey)))).toEqual(receiptsBefore);
  });
  it("unknown holds the Review but keeps a clearly unverified Source; an unlisted channel is rejected by the MCP schema",T,async()=>{
    const unknown={...base,sourceChat:"Micro 241126 origin not known",...own("unknown origin"),acquisitionChannel:"unknown"};
    const p=await plan(unknown);
    expect(revStep(p)).toMatchObject({state:"hold_quality_gate"});
    expect(p.safeEditWorkflow.qualityIssues).toContain("source_acquisition_unknown");
    const prepared=await prepare(unknown);
    expect(prepared.previews.map((x:any)=>x.kind)).toEqual(["source_intake"]);
    const saved=await apply(unknown,prepared);
    expect(saved.completedWriteReceipts).toBe(1);
    expect(saved.readyForNextNews).toBe(false);
    const source=disk(prepared.previews[0].path).toString("utf8");
    expect(source).toMatch(/^acquisition_channel: "unknown"$/m);
    expect(source).not.toMatch(/user_supplied/);
    expect(fs.existsSync(path.join(vault,revStep(p).path))).toBe(false);
    // A caller cannot invent a stronger channel such as "verified_primary".
    for(const [server,name] of [[research,"plan_investment_writeback"],[safe,"prepare_canonical_writeback"]] as const){
      const refused=await server.client.callTool({name,arguments:{...unknown,acquisitionChannel:"verified_primary"}});
      expect(refused.isError).toBe(true);
    }
  });
  it("protected Thesis and Portfolio are byte-identical and no step ever targeted them",T,async()=>{
    expect([THESIS,PORTFOLIO].map(p=>sha(disk(p)))).toEqual(protectedBefore);
    for(const input of [assistant,userSubmitted,legacy]){
      const p=await plan(input);
      expect(p.safeEditWorkflow.protectedNotesTouched).toBe(false);
      expect(p.safeEditWorkflow.steps.every((s:any)=>!s.path.startsWith("05_Thesis/")&&!s.path.startsWith("06_Portfolio/"))).toBe(true);
    }
  });
});

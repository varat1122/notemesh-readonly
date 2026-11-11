import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "./investment-writeback-router";
import type {IntakeClaim} from "./canonical-claims";
import type {EstimateRevisionInput} from "./estimate-revision-n8";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const actor="oauth:ios-ri001-n8-disposable";
const basis={standard:"GAAP",shareBasis:"not applicable to total revenue",scope:"consolidated",definition:"reported revenue estimate"};
let root:string,vault:string;
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n8-")));vault=path.join(root,"vault");
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  vi.stubEnv("DATA_DIR",root);vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,18).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  for(const [rel,text] of [["01_Companies/SYNZ.md","# SYNZ isolated company Hub\n"],
    ["05_Thesis/SYNZ - Current Thesis.md","# Protected original\n"],
    ["06_Portfolio/Positions.md","# Protected positions\n"]]){
    fs.writeFileSync(path.join(vault,rel),text);(await import("./indexer")).reindexPath(rel);
  }
});
afterEach(async()=>{
  expect(fs.readFileSync(path.join(vault,"05_Thesis/SYNZ - Current Thesis.md"),"utf8")).toBe("# Protected original\n");
  expect(fs.readFileSync(path.join(vault,"06_Portfolio/Positions.md"),"utf8")).toBe("# Protected positions\n");
  (await import("../db")).db().close();
  vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});
});
type Changed=Partial<IntakeClaim>;
async function save(value:string,day:string,changes:Changed={},options:Partial<WritebackInput>={}){
  const text=`Synthetic Broker X estimates FY2027 revenue at ${value} USD million on ${day}; not an original PDF.\n`;
  const claim:IntakeClaim={
    entity:"SYNZ",metric:"revenue",value,unit:"USD million",period:"FY2027",evidenceClass:"analyst_estimate",
    statement:"Synthetic attributed broker revenue estimate, not company guidance or consensus",
    sourceLocator:"caller supplied PDF transcription page 3 table 2, not visually verified",
    sourceExcerpt:text.trim(),verification:"unverified",estimate:{role:"broker_estimate",provider:"Broker X",forecastVintage:day},
    accountingBasis:{...basis},...changes
  };
  const data:WritebackInput={domain:"company",entities:["SYNZ"],topic:"Synthetic broker estimate",
    inputFormat:"text",sourceKind:"broker_research",sourceChat:"N8 disposable fixture",sourceChannel:"synthetic_pdf_transcription",
    sourceLanguage:"en",publisher:"Broker X attributed",sourceUrl:`https://example.org/n8/${day}/${sha(text).slice(0,12)}`,
    extractedText:text,publicationDate:day,eventDate:day,originalDocumentAccess:"excerpt_only",
    claims:[claim],captureOnly:true,...options};
  const {prepareCanonicalWriteback,applyCanonicalWriteback}=await import("../mcp/canonical-writeback");
  const prepared=prepareCanonicalWriteback(data,actor);
  expect(prepared.claimIssues).toEqual([]);
  expect(prepared.previews.map(x=>x.kind)).toContain("structured_claim");
  const saved=applyCanonicalWriteback({input:data,planId:prepared.planId,
    authorizations:prepared.previews.map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);
  expect(saved.steps.every(s=>s.state==="verified_existing")).toBe(true);
  const claimPath=saved.steps.find(s=>s.kind==="structured_claim")!.path;
  return {path:claimPath,noteSha256:sha(fs.readFileSync(path.join(vault,claimPath),"utf8"))};
}
const request=(earlier:EstimateRevisionInput["earlier"],later:EstimateRevisionInput["later"],asOf?:string):EstimateRevisionInput=>({
  earlier,later,...(asOf?{asOf}:{})});
async function preview(data:EstimateRevisionInput){
  return (await import("./estimate-revision-n8")).previewEstimateRevision(data);
}
async function snapshot(){
  const d=(await import("../db")).db(),files:string[]=[];
  const visit=(dir:string)=>{for(const f of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,f.name);if(f.isDirectory())visit(full);else files.push(full);
  }};
  visit(vault);
  return {files:sha(files.sort().map(x=>path.relative(vault,x)+fs.readFileSync(x,"utf8")).join("\n")),
    changes:d.prepare("SELECT total_changes() AS n").get(),
    events:d.prepare("SELECT * FROM safe_edit_events ORDER BY rowid").all(),
    receipts:d.prepare("SELECT id,after_hash,status FROM safe_edit_operations ORDER BY id").all()};
}
describe("N8 receipt-bound broker estimate revision (read-only)",()=>{
  it("compares two distinct broker vintages with exact decimal math and no side effects",async()=>{
    const older=await save("100.00","2026-09-01"),newer=await save("112.5","2026-10-01");
    const before=await snapshot(),r=await preview(request(older,newer,"2026-11-12T00:00:00Z"));
    expect(r).toMatchObject({status:"revision_candidate_pending_semantic_review",issues:[],sourceAuthenticityVerified:false,
      independentEvidenceIncrement:0,semanticFidelity:"not_assessed",canAutoWrite:false,canEditThesis:false,
      identityNavigation:{status:"exact_existing_title",hubPath:"01_Companies/SYNZ.md"}});
    expect(r.comparison).toMatchObject({oldValue:"100.00",newValue:"112.5",absoluteDelta:"12.5",
      percentageDelta:"12.50%",estimateRole:"broker_estimate",provider:"Broker X",oldVintage:"2026-09-01",newVintage:"2026-10-01"});
    expect(r.earlier).toMatchObject({pdfLocatorVerified:false,originalDocumentAuthenticated:false});
    expect(await snapshot()).toEqual(before);
  });
  it("treats re-stated equal estimate values as a no-change candidate, not a target-price upgrade",async()=>{
    const a=await save("100.00","2026-09-01"),b=await save("100.0","2026-10-01");
    const r=await preview(request(a,b));
    expect(r.status).toBe("no_change_candidate_pending_semantic_review");
    expect(r.comparison).toMatchObject({absoluteDelta:"0",percentageDelta:"0.00%"});
  });
  it("does not divide by zero or invent a percent revision",async()=>{
    const a=await save("0","2026-09-01"),b=await save("5","2026-10-01");
    const r=await preview(request(a,b));
    expect(r.comparison).toMatchObject({absoluteDelta:"5",percentageDelta:null});
  });
  it.each([
    ["provider",{estimate:{role:"broker_estimate",provider:"Broker Y",forecastVintage:"2026-10-01"}},"n8_provider_mismatch"],
    ["role",{estimate:{role:"consensus",provider:"Broker X",forecastVintage:"2026-10-01"}},"n8_broker_identity_incomplete"],
    ["unit",{unit:"USD billion"},"n8_unit_mismatch_no_conversion"],
    ["metric",{metric:"operating profit"},"n8_metric_mismatch"],
    ["period",{period:"FY2028"},"n8_reporting_period_mismatch"],
    ["basis",{accountingBasis:{...basis,standard:"Non-GAAP"}},"n8_accounting_basis_mismatch"],
    ["unknown basis",{accountingBasis:undefined},"n8_accounting_basis_incomplete"],
    ["wrong issuer",{entity:"OTHER"},"n8_later_claim_receipt_or_readback_hold"],
    ["same vintage",{estimate:{role:"broker_estimate",provider:"Broker X",forecastVintage:"2026-09-01"}},"n8_forecast_vintage_order_invalid"]
  ] as Array<[string,Changed,string]>)("holds incompatible %s instead of computing a misleading revision",async(_case,change,issue)=>{
    const a=await save("100","2026-09-01"),b=await save("112","2026-10-01",change);
    const r=await preview(request(a,b));
    expect(r.status).toBe("hold");expect(r.issues).toContain(issue);
    expect(r.comparison).toBeNull();expect(r.earlier).toBeNull();expect(r.later).toBeNull();
  });
  it("holds old/new order inversion and source receipts recorded after historical cutoff",async()=>{
    const a=await save("100","2026-09-01"),b=await save("112","2026-10-01");
    const wrong=await preview(request(b,a));
    expect(wrong.issues).toContain("n8_forecast_vintage_order_invalid");
    const cutoff=await preview(request(a,b,"2026-11-09T00:00:00Z"));
    expect(cutoff.status).toBe("hold");expect(cutoff.issues).toContain("n8_evidence_not_available_by_cutoff");
  });
  it("does not trust supplied file hashes, old identical paths, or tampered source bytes",async()=>{
    const a=await save("100","2026-09-01"),b=await save("112","2026-10-01");
    expect((await preview(request({...a,noteSha256:"0".repeat(64)},b))).issues).toContain("n8_earlier_claim_receipt_or_readback_hold");
    expect((await preview(request(a,a))).issues).toContain("n8_distinct_reports_required");
    const raw=fs.readFileSync(path.join(vault,b.path),"utf8");
    fs.writeFileSync(path.join(vault,b.path),raw+"\nmalicious post-receipt edit\n");
    expect((await preview(request(a,b))).issues).toContain("n8_later_claim_receipt_or_readback_hold");
  });
  it("advertises a closed-world read-only MCP tool and fences attributed text",async()=>{
    const a=await save("100","2026-09-01"),b=await save("112","2026-10-01");
    const before=await snapshot();
    const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
    const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
    const {createMcpServer}=await import("../mcp/server");
    const server=createMcpServer({read:true,write:false,label:"n8-synthetic"});
    const client=new Client({name:"n8-wire-fixture",version:"1.0"});
    const [ct,st]=InMemoryTransport.createLinkedPair();
    try{
      await Promise.all([server.connect(st),client.connect(ct)]);
      const tool=(await client.listTools()).tools.find(t=>t.name==="preview_estimate_revision");
      expect(tool?.annotations).toMatchObject({readOnlyHint:true,openWorldHint:false});
      const response=await client.callTool({name:"preview_estimate_revision",arguments:request(a,b)});
      expect(response.isError).not.toBe(true);
      const payload=JSON.parse((response.content as {type:string;text?:string}[]).find(x=>x.type==="text")!.text!);
      expect(payload.status).toBe("revision_candidate_pending_semantic_review");
      expect(payload.earlier.sourceExcerpt).toContain(payload.boundary);
      expect(payload.comparison.absoluteDelta).toBe("12");
      expect((await snapshot())).toEqual(before);
    }finally{await client.close();await server.close();}
  });
});

import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {SupplyChainInput,SupplyChainPreview} from "../vault/supply-chain-intelligence";

// IOS-ORCH-RI-001 / N7: real in-memory MCP protocol and disposable local
// receipts. No network, shared Vault, deployment or external model calls.
let root:string,vault:string;
const quote="MODULECO supplies components to SYSTEMCO under a proposed future qualification program.";
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
type Candidate=NonNullable<SupplyChainInput["candidates"]>[number];
type SourceRef=Candidate["sourceRefs"][number];

beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n7-wire-")));
  vault=path.join(root,"vault");
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  vi.stubEnv("DATA_DIR",root);
  vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");
  vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  vi.resetModules();
  await add("01_Companies/MODULECO.md","# Synthetic MODULECO\n");
  await add("01_Companies/SYSTEMCO.md","# Synthetic SYSTEMCO\n");
  await add("05_Thesis/MODULECO - Current Thesis.md","# Isolated protected fixture\n");
  await add("06_Portfolio/Positions.md","# Isolated protected fixture\n");
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();});

async function add(rel:string,text:string){
  const dest=path.join(vault,rel);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);
  (await import("../vault/indexer")).reindexPath(rel);
}
async function source():Promise<SourceRef>{
  const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
  const plan=planInvestmentWriteback({domain:"company",entities:["MODULECO","SYSTEMCO"],
    topic:"Synthetic supply chain qualification",inputFormat:"text",sourceKind:"issuer_release",
    sourceChat:"N7 synthetic protocol fixture",captureOnly:true,
    publisher:"Synthetic publisher; treat every assertion as unverified",
    sourceUrl:"https://example.com/n7-synthetic-qualification",
    publicationDate:"2026-01-01",eventDate:"2026-01-01",extractedText:quote});
  const step=plan.safeEditWorkflow!.steps.find(s=>s.kind==="source_intake")!;
  expect(step.safeEditRequest).not.toBeNull();
  const engine=await import("../safe-edit/engine"),actor="oauth:n7-wire-fixture";
  const p=engine.preview(step.safeEditRequest,actor);
  expect(engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor).status).toBe("written");
  return {intakeId:plan.planId,sourcePath:step.path,
    sourceNoteSha256:sha(fs.readFileSync(path.join(vault,step.path),"utf8")),
    quote,documentLocator:"caller-supplied paragraph 1; not an authenticated PDF page"};
}
function candidate(ref:SourceRef):Candidate{
  return {localKey:"synthetic_relation",subject:"MODULECO",object:"SYSTEMCO",predicate:"supplier_to",
    direction:"subject_to_object",assertionOrigin:"source_statement",lifecycle:"active",
    sourceRefs:[ref],counterEvidenceRefs:[],relatedEvidenceRefs:[],
    mechanism:"The supplied qualification statement requires semantic review before any revenue inference.",
    confidenceBasis:"Exact submitted wording only; issuer authenticity and economic meaning are unverified.",
    invalidation:"A source correction or failed qualification would require reassessment.",ambiguity:null,
    validity:{from:null,to:null},valueChain:{subjectStage:"components",objectStage:"systems"},
    transmission:[{stage:"revenue_conversion",mechanism:"Qualification does not establish shipment or recognized revenue.",magnitude:null}]};
}
const request=(candidates:Candidate[]=[]):SupplyChainInput=>({question:"Trace the proposed MODULECO and SYSTEMCO relationship.",
  issuers:["MODULECO","SYSTEMCO"],candidates});
async function connect(read=true,write=false){
  const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
  const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
  const {createMcpServer}=await import("./server");
  const [ct,st]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:"n7-synthetic-wire",version:"1.0"});
  const server=createMcpServer({read,write,label:"n7-isolated"});
  await Promise.all([client.connect(ct),server.connect(st)]);
  return {client,server};
}
function parse(response:unknown):SupplyChainPreview&{boundary:string;boundaryNote:string}{
  const r=response as {isError?:boolean;content?:Array<{type:string;text?:string}>};
  expect(r.isError).not.toBe(true);
  return JSON.parse(r.content!.find(x=>x.type==="text")!.text!);
}
async function snapshot(){
  const files:string[]=[];
  const visit=(dir:string)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,e.name);if(e.isDirectory())visit(full);else if(e.isFile())files.push(full);
  }};
  visit(vault);
  const database=(await import("../db")).db();
  return {vault:sha(files.sort().map(f=>path.relative(vault,f)+"\0"+fs.readFileSync(f).toString("base64")).join("\n")),
    changes:database.prepare("SELECT total_changes() AS n").get(),
    receipts:database.prepare("SELECT id,status,receipt FROM safe_edit_operations ORDER BY id").all()};
}

describe("N7 read-only supply chain preview over actual MCP",()=>{
  it("advertises the tool only as a closed-world read operation",async()=>{
    const {client,server}=await connect();
    try{
      const tools=(await client.listTools()).tools;
      expect(tools.find(t=>t.name==="preview_supply_chain_relationships")?.annotations)
        .toMatchObject({readOnlyHint:true,openWorldHint:false});
      expect(tools.map(t=>t.name)).not.toContain("create_note");
    }finally{await client.close();await server.close();}
  });
  it("discovers attributed Source text without inferring a relationship",async()=>{
    const ref=await source(),{client,server}=await connect();
    try{
      const out=parse(await client.callTool({name:"preview_supply_chain_relationships",arguments:request()}));
      expect(out.sourceCatalog.some(s=>s.sourcePath===ref.sourcePath)).toBe(true);
      expect(out.candidates).toEqual([]);
      expect(out.sourceAuthenticityVerified).toBe(false);
      expect(out.sourceCatalog.find(s=>s.sourcePath===ref.sourcePath)?.quotePreview).toMatch(/^%[0-9a-f]{8}%\n/);
      expect(out.sourceCatalog.find(s=>s.sourcePath===ref.sourcePath)?.publisher).toMatch(/^%[0-9a-f]{8}%\n/);
    }finally{await client.close();await server.close();}
  });
  it("returns a useful pending candidate, fences narrative, and changes no Vault or database state",async()=>{
    const ref=await source(),{client,server}=await connect();
    const before=await snapshot();
    try{
      const out=parse(await client.callTool({name:"preview_supply_chain_relationships",arguments:request([candidate(ref)])}));
      expect(out.candidates[0].status).toBe("pending_semantic_review");
      expect(out.candidates[0].bindings[0]).toMatchObject({sourcePath:ref.sourcePath,sourceNoteSha256:ref.sourceNoteSha256,documentLocatorVerified:false});
      expect(out.candidates[0].bindings[0].quote).toMatch(/^%[0-9a-f]{8}%\n/);
      expect(out.candidates[0].proposal?.mechanism).toMatch(/^%[0-9a-f]{8}%\n/);
      expect(out.candidates[0].proposal?.transmission[0].mechanism).toMatch(/^%[0-9a-f]{8}%\n/);
      expect(out.candidates[0].effectiveExposureMagnitude).toBe("unknown");
      expect(out).toMatchObject({methodVersion:"IOS-RI001-N7-PREVIEW-1",writesPerformed:false,
        canAutoWrite:false,canWriteProtectedNotes:false,economicRelationshipVerified:false,
        semanticEntailment:"not_assessed",independentEvidenceIncrement:0,comparatorEligible:false});
      expect(out.boundaryNote).toContain("not instructions");
    }finally{await client.close();await server.close();}
    expect(await snapshot()).toEqual(before);
  });
  it("does not turn an explicit co-mention declaration into a commercial edge",async()=>{
    const ref=await source(),c={...candidate(ref),assertionOrigin:"co_mention" as const};
    const {client,server}=await connect();
    try{
      const out=parse(await client.callTool({name:"preview_supply_chain_relationships",arguments:request([c])}));
      expect(out.candidates[0].status).toBe("hold");
      expect(out.economicRelationshipVerified).toBe(false);
    }finally{await client.close();await server.close();}
  });
  it("holds a stale whole-note hash through tools/call",async()=>{
    const ref=await source(),{client,server}=await connect();
    try{
      const out=parse(await client.callTool({name:"preview_supply_chain_relationships",arguments:request([candidate({...ref,sourceNoteSha256:"0".repeat(64)})])}));
      expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
      expect(out.candidates[0].issues.length).toBeGreaterThan(0);
    }finally{await client.close();await server.close();}
  });
  it("withholds post-cutoff evidence and the candidate derived from it",async()=>{
    const ref=await source(),{client,server}=await connect();
    try{
      const out=parse(await client.callTool({name:"preview_supply_chain_relationships",arguments:{...request([candidate(ref)]),asOf:"2000-01-01T00:00:00Z"}}));
      expect(out.viewMode).toBe("availability_bounded_current_index");
      expect(out.sourceCatalog).toEqual([]);
      expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
      expect(JSON.stringify(out)).not.toContain(quote);
      expect(JSON.stringify(out)).not.toContain(ref.sourcePath);
    }finally{await client.close();await server.close();}
  });
  it("enforces bounded inputs at the MCP schema",async()=>{
    const {client,server}=await connect();
    try{
      const out=await client.callTool({name:"preview_supply_chain_relationships",arguments:{...request(),issuers:Array.from({length:7},(_,i)=>"TEST"+i)}});
      expect(out.isError).toBe(true);
    }finally{await client.close();await server.close();}
  });
  it.each([false,true])("denies the tool without read scope, including legacy write=%s",async write=>{
    const {client,server}=await connect(false,write);
    try{
      await expect(client.listTools()).rejects.toThrow("Method not found");
      await expect(client.callTool({name:"preview_supply_chain_relationships",arguments:request()})).rejects.toThrow();
    }finally{await client.close();await server.close();}
  });
});

import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {PreviewInput} from "./schema";

const aliases=[
  {name:"Company Evolution Timeline.md",type:"company_evolution_timeline"},
  {name:"Company Evolution Timeline - SYNZ.md",type:"company_evolution_timeline"},
  {name:"Investment Decision Ledger.md",type:"decision_ledger"},
  {name:"Investment Decision Ledger - SYNZ.md",type:"decision_ledger"},
];
const cases=aliases.flatMap(alias=>[false,true].map(typed=>({...alias,typed})));
const actor="oauth:f03-alias-fixture";
const registry=Symbol.for("notemesh.maintenance.registry.v1");
let root:string,vault:string;
const folder="08_Daily_Weekly/Research Indexes";
const record=(type?:string)=>`---\n${type?`type: ${type}\n`:""}verification: not_reverified\n---\n# Curated SYNZ fixture\n\n## Chronology\nOriginal record.\n`;
const request=(file:string,change:PreviewInput["change"],id="protected-alias-001"):PreviewInput=>({
  operationId:id,path:file,reason:"Disposable protected alias regression",change,
});

beforeEach(()=>{
  vi.stubEnv("DATA_DIR",fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"f03-alias-"))));
  root=process.env.DATA_DIR!;vault=path.join(root,"vault");fs.mkdirSync(path.join(vault,folder),{recursive:true});
  vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  for(const key of ["NOTEMESH_MAINTENANCE","NOTEMESH_MAINTENANCE_RESUME","NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"])vi.stubEnv(key,undefined);
  delete (globalThis as Record<symbol,unknown>)[registry];vi.resetModules();
});
afterEach(()=>{
  vi.restoreAllMocks();delete (globalThis as Record<symbol,unknown>)[registry];
  fs.rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();
});

describe("F-03 residual accepted basename aliases (real disposable Safe Edit)",()=>{
  it.each(aliases)("matcher refuses untyped $name, independent of folder/case",async({name})=>{
    const {assertProtectedRecord}=await import("./protected-records");
    for(const prefix of ["",folder+"/","10_Knowledge/"]){
      expect(()=>assertProtectedRecord(prefix+name)).toThrow("protected_record_separate_authorization_required");
      expect(()=>assertProtectedRecord(prefix+name.toLowerCase())).toThrow("protected_record_separate_authorization_required");
    }
  });
  for(const kind of ["create","append","replace","frontmatter"] as const){
    it.each(cases)(`${kind} refuses $name (typed=$typed) without changed bytes`,async({name,type,typed})=>{
      const file=folder+"/"+name,content=record(typed?type:undefined);
      if(kind!=="create")fs.writeFileSync(path.join(vault,file),content);
      const engine=await import("./engine");
      const change:PreviewInput["change"]=kind==="create"?{kind,content}:kind==="append"?{kind,heading:"Chronology",date:"2026-11-07",content:"Unauthorized append."}:
        kind==="replace"?{kind,oldText:"Original record.",newText:"Unauthorized replacement."}:{kind,properties:{updated:"2026-11-07"}};
      let refusal:string|null=null;
      try{
        const p=engine.preview(request(file,change),actor);
        engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);
      }catch(error){refusal=(error as Error).message;}
      const current=fs.existsSync(path.join(vault,file))?fs.readFileSync(path.join(vault,file),"utf8"):null;
      expect({refusal,unchanged:current===(kind==="create"?null:content)})
        .toEqual({refusal:"protected_record_separate_authorization_required",unchanged:true});
    });
  }

  it.each(cases)("old preview/token and unrelated admin approval cannot authorize $name (typed=$typed)",async({name,type,typed})=>{
    const file=folder+"/"+name,content=record(typed?type:undefined).replace("verification:","user_endorsed: true\nverification:");
    fs.writeFileSync(path.join(vault,file),content);
    const guard=await import("./protected-records"),engine=await import("./engine");
    // Only emulate old admission, using genuine preview/token and exact-diff
    // approval. No forged journal, receipt or direct DB changes.
    const old=vi.spyOn(guard,"assertProtectedRecord").mockImplementation(()=>{});
    const input=request(file,{kind:"replace",oldText:"Original record.",newText:"Unauthorized change."});
    const token=engine.preview(input,actor);expect(token.requiresAdminApproval).toBe(true);
    engine.approve(token.operationId,"fixture-admin",token.afterHash);old.mockRestore();
    expect(()=>engine.preview(input,actor)).toThrow("protected_record_separate_authorization_required");
    expect(()=>engine.approve(token.operationId,"fixture-admin",token.afterHash)).toThrow("protected_record_separate_authorization_required");
    expect(()=>engine.apply({operationId:token.operationId,previewToken:token.previewToken,expectedHash:token.beforeHash},actor)).toThrow("protected_record_separate_authorization_required");
    expect(fs.readFileSync(path.join(vault,file),"utf8")).toBe(content);
    expect(engine.status(token.operationId,actor)).toMatchObject({status:"preview",receipt:null});
  });

  it.each(cases)("rollback cannot reuse historical authority for $name (typed=$typed); written retry is immutable",async({name,type,typed})=>{
    const file=folder+"/"+name;fs.writeFileSync(path.join(vault,file),record(typed?type:undefined));
    const guard=await import("./protected-records"),engine=await import("./engine");
    // Produce historical evidence with the actual engine in a disposable
    // fixture; restore the current boundary before rollback/retry assertions.
    const old=vi.spyOn(guard,"assertProtectedRecord").mockImplementation(()=>{});
    const p=engine.preview(request(file,{kind:"replace",oldText:"Original record.",newText:"Legacy recorded change."}),actor);
    const args={operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash};
    const receipt=engine.apply(args,actor),rollback=request(file,{kind:"rollback",operationId:p.operationId},"alias-rollback-001");
    const pending=engine.preview(rollback,actor);old.mockRestore();
    const before=fs.readFileSync(path.join(vault,file));
    expect(()=>engine.preview(rollback,actor)).toThrow("protected_record_separate_authorization_required");
    expect(()=>engine.apply({operationId:pending.operationId,previewToken:pending.previewToken,expectedHash:pending.beforeHash},actor)).toThrow("protected_record_separate_authorization_required");
    expect(engine.apply(args,actor)).toEqual(receipt);
    expect(engine.status(p.operationId,actor).receipt).toEqual(receipt.receipt);
    expect(fs.readFileSync(path.join(vault,file))).toEqual(before);
  });

  it.each(["Company Evolution - SYNZ.md","SYNZ - Company Evolution Timeline.md",
    "00_Investment_Evolution_Master.md","Decision Ledger.md","Decision Ledger - SYNZ.md","SYNZ - Decision Ledger.md"])("preserves existing protected basename %s",async name=>{
    const {assertProtectedRecord}=await import("./protected-records");
    expect(()=>assertProtectedRecord(name)).toThrow("protected_record_separate_authorization_required");
  });

  it.each(["Company Evolution Timeline methodology.md","Investment Decision Ledger research.md",
    "Research Review - Company Evolution Timeline methods.md","Research Review - Investment Decision Ledger methods.md",
    "Company Evolution Timeline View.md","Investment Decision Ledger View.md"])("ordinary Research basename %s is not blocked by substring",async name=>{
    const {assertProtectedRecord}=await import("./protected-records");
    expect(()=>assertProtectedRecord("10_Knowledge/"+name,{type:"investment_research_review"})).not.toThrow();
  });

  it("Source and Draft Review save, receipts and historical retrieval remain available beside protected aliases",async()=>{
    const engine=await import("./engine"),{draftMetadata}=await import("../vault/research-state");
    const source="00_Inbox/ChatGPT/Investment Intake - SYNZ.md",review="10_Knowledge/Company Research/Company Evolution Timeline methodology.md";
    const texts=["---\ntype: investment_source_intake\n---\n# SYNZ isolated source\nPreserved source excerpt.\n",
      "---\ntype: investment_research_review\n"+Object.entries(draftMetadata).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+
      "\n---\n# SYNZ timeline methodology review\nHistorical analysis only.\n[["+source.replace(/\.md$/,"")+"]]\n"];
    for(const [i,file] of [source,review].entries()){
      fs.mkdirSync(path.dirname(path.join(vault,file)),{recursive:true});
      const p=engine.preview(request(file,{kind:"create",content:texts[i]},"normal-alias-path-"+i),actor);
      const args={operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},saved=engine.apply(args,actor);
      expect(saved.receipt).toMatchObject({write:"written",readback:"verified",reindex:"verified"});
      expect(engine.apply(args,actor)).toEqual(saved);expect(fs.readFileSync(path.join(vault,file),"utf8")).toBe(texts[i]);
    }
    const {searchVault}=await import("../vault/queries"),{readNoteRange}=await import("../vault/notes");
    const expected={research_status:"draft",usage_tier:"historical_analysis_only",comparator_eligible:false,independent_evidence_increment:0};
    expect(searchVault("SYNZ timeline methodology").hits.find(hit=>hit.path===review)?.researchTrust).toMatchObject(expected);
    expect(readNoteRange(review).researchTrust).toMatchObject(expected);
    // Existing curated notes remain readable; the name boundary controls writes.
    for(const {name} of aliases){const file=folder+"/"+name;fs.writeFileSync(path.join(vault,file),record());expect(readNoteRange(file).content).toBe(record());}
  });
});

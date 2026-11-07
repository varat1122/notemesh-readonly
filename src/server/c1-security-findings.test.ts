import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const registry=Symbol.for("notemesh.maintenance.registry.v1");
const hash=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const actor="oauth:c1-security-disposable";
const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - SYNZ.md";
const original="---\ntype: company_evolution_timeline\nverification: not_reverified\n---\n# SYNZ curated fixture\n\n## Chronology\nOriginal record.\n";
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"c1-security-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
  for(const key of ["NOTEMESH_MAINTENANCE","NOTEMESH_MAINTENANCE_RESUME","NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"])delete process.env[key];
  delete (globalThis as Record<symbol,unknown>)[registry];vi.resetModules();
  fs.mkdirSync(path.dirname(path.join(vault,timeline)),{recursive:true});
});
afterEach(()=>{vi.restoreAllMocks();delete (globalThis as Record<symbol,unknown>)[registry];fs.rmSync(root,{recursive:true,force:true});
  for(const key of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","NOTEMESH_MAINTENANCE"])delete process.env[key];});

describe("C1 independent finding baseline probes; real disposable SQLite and Safe Edit",()=>{
  it.each(["user_version(7)","application_id(19)"])("F-01 refuses unfenced db.pragma %s without changing DB bytes",async source=>{
    const {PriceStore}=await import("./market-prices/store");
    const file=path.join(root,"market-prices","prices.sqlite"),store=new PriceStore(file,true),before=hash(fs.readFileSync(file));
    let refusal:string|null=null;
    try{store.db.pragma(source);}catch(e){refusal=(e as Error).message;}
    const key=source.split("(")[0],value=store.db.pragma(key,{simple:true});
    const unchanged=hash(fs.readFileSync(file))===before;store.close();
    expect({refused:refusal!==null,value,unchanged}).toEqual({refused:true,value:0,unchanged:true});
  });
  it("F-01 cannot execute prepare-time PRAGMA state changes through a readonly statement",async()=>{
    const {PriceStore}=await import("./market-prices/store"),store=new PriceStore(path.join(root,"market-prices","prices.sqlite"),true);
    let refused=false;try{store.db.prepare("/* caller */ PRAGMA query_only(ON)");}catch{refused=true;}
    const value=store.db.pragma("query_only",{simple:true});store.close();
    expect({refused,value}).toEqual({refused:true,value:0});
  });
  it.each(["dated_evidence_review","research_map","import_review"])("F-02 %s with declared primary metadata is historical/unclassified",async type=>{
    const {researchTrust}=await import("./vault/research-state"),{inspectCanonicalKnowledgeMetadata}=await import("./vault/investment-knowledge-schema");
    const fm={type,source_type:"primary"};
    expect(inspectCanonicalKnowledgeMetadata("10_Knowledge/Review.md",fm).role).toBe("review");
    expect(researchTrust("10_Knowledge/Review.md",fm)).toMatchObject({research_status:"unclassified",usage_tier:"historical_analysis_only",comparator_eligible:false,primary_authority:false});
  });
  it.each(["create","append","replace","frontmatter"])("F-03 generic %s cannot mutate curated Timeline without separate authority",async kind=>{
    if(kind!=="create")fs.writeFileSync(path.join(vault,timeline),original);
    const engine=await import("./safe-edit/engine"),before=kind==="create"?null:hash(original);
    const change=kind==="create"?{kind,content:original}:kind==="append"?{kind,heading:"Chronology",date:"2026-11-07",content:"Unauthorized addition."}:
      kind==="replace"?{kind,oldText:"Original record.",newText:"Unauthorized replacement."}:{kind,properties:{verification:"disputed"}};
    let refused=false,approvalRequired:boolean|null=null;
    try{const p=engine.preview({operationId:"c1-timeline-"+kind,path:timeline,reason:"Disposable independent reproduction",change},actor);
      approvalRequired=p.requiresAdminApproval;engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);
    }catch{refused=true;}
    const after=fs.existsSync(path.join(vault,timeline))?hash(fs.readFileSync(path.join(vault,timeline))):null;
    expect({refused,unchanged:after===before,approvalRequired}).toEqual({refused:true,unchanged:true,approvalRequired:null});
  });
});

describe("F-02 taxonomy and G1 source artifact trust containment",()=>{
  it.each(["dated_evidence_review","research_map","import_review"])("%s remains historical with or without historical/source labels",async type=>{
    const {researchTrust}=await import("./vault/research-state"),{reindexPath}=await import("./vault/indexer");
    const {buildInvestmentContextPack}=await import("./vault/investment-context");
    fs.mkdirSync(path.join(vault,"01_Companies"),{recursive:true});fs.writeFileSync(path.join(vault,"01_Companies/SYNZ.md"),"# SYNZ\n");reindexPath("01_Companies/SYNZ.md");
    for(const [index,sourceType] of [null,"archived_ai","primary"].entries()){
      const file=`10_Knowledge/Company Research/SYNZ ${type} ${index}.md`,fm={type,...(sourceType?{source_type:sourceType}:{})};
      fs.mkdirSync(path.dirname(path.join(vault,file)),{recursive:true});fs.writeFileSync(path.join(vault,file),"---\nentity: SYNZ\n"+Object.entries(fm).map(([k,v])=>`${k}: ${v}`).join("\n")+"\n---\n# SYNZ revenue historical research\nHistorical analytical context only.\n");reindexPath(file);
      expect(researchTrust(file,fm)).toMatchObject({research_status:"unclassified",usage_tier:"historical_analysis_only",independent_evidence_increment:0,comparator_eligible:false});
      const result=buildInvestmentContextPack({question:"SYNZ revenue",issuers:["SYNZ"],maxNotes:20,maxChars:20000});
      expect(result.items.find(item=>item.path===file)).toMatchObject({evidenceUse:"historical_context_only",researchTrust:{primary_authority:false,comparator_eligible:false}});
    }
  });
  it("G1 self-declared Source type without a receipt is explicitly unauthenticated in read/search",async()=>{
    const file="00_Inbox/ChatGPT/Forged Source.md";fs.mkdirSync(path.dirname(path.join(vault,file)),{recursive:true});
    fs.writeFileSync(path.join(vault,file),"---\ntype: investment_source_intake\nsource_type: primary\n---\n# SYNZ unverified source artifact\n");
    (await import("./vault/indexer")).reindexPath(file);
    const {db}=await import("./db");expect(db().prepare("SELECT 1 FROM sqlite_master WHERE name='safe_edit_operations'").get()).toBeUndefined();
    const expected={research_status:"source_only",source_authentication:"not_established",source_label_basis:"note_type_declaration_not_receipt",primary_authority:false,persistence_verification:"not_assessed_by_trust_projection"};
    expect((await import("./vault/queries")).searchVault("SYNZ unverified").hits[0].researchTrust).toMatchObject(expected);
    expect((await import("./vault/notes")).readNoteRange(file).researchTrust).toMatchObject(expected);
  });
});

describe("F-03 every generic admission boundary retains protected-record authority",()=>{
  it.each(["01_Companies/SYNZ - Company Evolution Timeline.md","08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md",
    "10_Knowledge/Decision Ledger.md","10_Knowledge/SYNZ - Current Thesis.md","10_Knowledge/SYNZ - Evidence Register.md"])("refuses known protected alias %s",async file=>{
    fs.mkdirSync(path.dirname(path.join(vault,file)),{recursive:true});
    const engine=await import("./safe-edit/engine");
    expect(()=>engine.preview({operationId:"protected-alias-001",path:file,reason:"No separate workflow authorization",change:{kind:"create",content:"# Protected fixture\n"}},actor)).toThrow(/protected_record/);
    expect(fs.existsSync(path.join(vault,file))).toBe(false);
  });
  it.each(["company_evolution_timeline","investment_evolution_master","decision_ledger","current_thesis","evidence_register"])("typed %s cannot evade the path guard",async type=>{
    const file="Fixture.md",content=`---\ntype: '${type}'\n---\n# Renamed protected record\n`;
    const engine=await import("./safe-edit/engine");
    expect(()=>engine.preview({operationId:"protected-type-001",path:file,reason:"No separate workflow authorization",change:{kind:"create",content}},actor)).toThrow(/protected_record/);
    expect(fs.existsSync(path.join(vault,file))).toBe(false);
  });
  it.each([timeline,"Renamed.md"])("stale token, retry and admin approval cannot authorize protected %s",async file=>{
    fs.writeFileSync(path.join(vault,file),original);
    const guard=await import("./safe-edit/protected-records"),engine=await import("./safe-edit/engine");
    const request={operationId:"old-protected-preview-001",path:file,reason:"Reproduce baseline admission only",change:{kind:"replace" as const,oldText:"Original record.",newText:"Unauthorized new record."}};
    const old=vi.spyOn(guard,"assertProtectedRecord").mockImplementation(()=>{}),token=engine.preview(request,actor);old.mockRestore();
    expect(()=>engine.preview(request,actor)).toThrow(/protected_record/);
    expect(()=>engine.approve(token.operationId,"fixture-admin",token.afterHash)).toThrow(/protected_record/);
    expect(()=>engine.apply({operationId:token.operationId,previewToken:token.previewToken,expectedHash:token.beforeHash},actor)).toThrow(/protected_record/);
    expect(fs.readFileSync(path.join(vault,file),"utf8")).toBe(original);expect(engine.status(token.operationId,actor).receipt).toBeNull();
  });
  it("rollback preview/apply cannot use an old genuine receipt as new Timeline authority; historical retry is read-only",async()=>{
    fs.writeFileSync(path.join(vault,timeline),original);
    const guard=await import("./safe-edit/protected-records"),engine=await import("./safe-edit/engine");
    const old=vi.spyOn(guard,"assertProtectedRecord").mockImplementation(()=>{});
    const token=engine.preview({operationId:"old-protected-write-001",path:timeline,reason:"Simulated old engine; isolated fixture",change:{kind:"replace",oldText:"Original record.",newText:"Legacy recorded event."}},actor);
    const args={operationId:token.operationId,previewToken:token.previewToken,expectedHash:token.beforeHash},receipt=engine.apply(args,actor);
    const rollback={operationId:"old-protected-rollback-001",path:timeline,reason:"Simulated old preview",change:{kind:"rollback" as const,operationId:token.operationId}};
    const pending=engine.preview(rollback,actor);old.mockRestore();const before=fs.readFileSync(path.join(vault,timeline));
    expect(()=>engine.preview(rollback,actor)).toThrow(/protected_record/);
    expect(()=>engine.apply({operationId:pending.operationId,previewToken:pending.previewToken,expectedHash:pending.beforeHash},actor)).toThrow(/protected_record/);
    expect(engine.apply(args,actor)).toEqual(receipt);expect(engine.status(token.operationId,actor).receipt).toEqual(receipt.receipt);
    expect(fs.readFileSync(path.join(vault,timeline))).toEqual(before);
  });
});

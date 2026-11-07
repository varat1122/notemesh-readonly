import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const MRVL="IN-5B42E415CA57E41E",TSMC="IN-828DC9F6F955DA8B",OLD="IN-1111111111111111";
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-context-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Company Research","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  for(const issuer of ["MRVL","TSMC","NVDA"])await seed(`01_Companies/${issuer}.md`,`# ${issuer} company context`);
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];vi.restoreAllMocks();
});
async function seed(p:string,raw:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),raw);
  (await import("./indexer")).reindexPath(p);
}
// Real Safe Edit receipts in an isolated Vault; the IDs mirror the dispatch,
// but all prose and claimed facts are synthetic, not a copy of live research.
async function saved(issuer:string,id:string,published:string|null,event:string|null=null,legacy=false){
  const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
  const reviewPath=`10_Knowledge/Company Research/Investment Review - ${issuer} - ${id}.md`;
  const chronology=`event_date: ${JSON.stringify(event)}\npublished_at: ${JSON.stringify(published)}`;
  const tag=`Source token: InvestmentIntake${id.slice(3)}`;
  const source=`---\ntype: investment_source_intake\nintake_id: ${id}\nsource_type: user_supplied\nsource_url: https://example.org/unchanged-url\nsource_text_sha256: ${sha(id)}\n${chronology}\n---\n${tag}\nSynthetic submitted text ${id}.`;
  const review=`---\ntype: investment_research_review\n${legacy?"":"review_scope: company\n"}intake_id: ${id}\ncompany_hubs: ["01_Companies/${issuer}.md"]\noriginal_source_path: "${sourcePath}"\nsource_type: chatgpt_analysis\nverification: not_reverified\n${chronology}\n---\n# Investment Review — ${issuer}\n${tag}\n[[${sourcePath.slice(0,-3)}]]\n## Research analysis\nSynthetic unverified cash conversion discussion.\n## Counter-evidence\nSynthetic capacity and margin risks require original evidence.`;
  const {preview,apply}=await import("../safe-edit/engine");
  for(const [kind,p,content] of [["source_intake",sourcePath,source],["canonical_review",reviewPath,review]]){
    const operationId="ICW-"+sha([kind,p,sha(content)].join("\n")).slice(0,32);
    const pre=preview({operationId,path:p,reason:"Synthetic RI-001 fixture",change:{kind:"create",content}},"oauth:ri-fixture");
    apply({operationId,previewToken:pre.previewToken,expectedHash:pre.beforeHash},"oauth:ri-fixture");
  }
  return {sourcePath,reviewPath,source,review};
}
async function pack(issuer:string,extra:Record<string,unknown>={}){
  return (await import("./investment-context")).buildInvestmentContextPack({question:`${issuer} latest research and cash conversion`,issuers:[issuer],maxNotes:12,maxChars:16000,...extra});
}
describe("RI-001 canonical Review discovery and intake-bound assembly",()=>{
  it("finds the latest MRVL canonical Review under research intent without inventing protected roles",async()=>{
    const target=await saved("MRVL",MRVL,"2026-11-02");
    for(let i=0;i<40;i++)await seed(`10_Knowledge/Company Research/MRVL research cash conversion ${i}.md`,"---\ncompany: MRVL\nsource_type: chatgpt_history\npublished_at: 2025-01-01\n---\n# MRVL research cash conversion\nRepeated historical analyst text.");
    const p=await pack("MRVL",{maxNotes:5,maxChars:4500});
    expect(p.items.map(x=>x.path)).toContain(target.reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("FOUND");
    expect(p.issuerCoverage[0].missingRoles).toEqual(expect.arrayContaining(["thesis","evidence_register"]));
    expect(fs.existsSync(path.join(vault,"05_Thesis/MRVL - Current Thesis.md"))).toBe(false);
    expect(p.items.find(x=>x.path===target.reviewPath)?.evidenceUse).toBe("historical_context_only");
  });
  it("assembles TSMC Source/Review only by matching intake, readback receipt and link, retaining unknown event date",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    const p=await pack("TSMC");
    expect(p.items.map(x=>x.path)).toEqual(expect.arrayContaining([target.sourcePath,target.reviewPath]));
    expect(p.contextBundles).toEqual([expect.objectContaining({intakeId:TSMC,reviewPath:target.reviewPath,sourcePath:target.sourcePath,
      status:"BOUND_SOURCE_REVIEW",eventDate:null,publishedAt:"2026-11-02",economicEventEquivalence:"not_established",primaryVerification:"not_performed"})]);
  });
  async function appendSyntheticReview(path:string,id:string){
    const {preview,apply}=await import("../safe-edit/engine");
    const p=preview({operationId:id,path,reason:"Synthetic receipted Review appendix",change:{
      kind:"append",heading:"## Research analysis",date:"2026-11-07",
      content:"Synthetic duplicate context only. No verified primary claims or independent evidence increment."
    }},"oauth:ri-fixture");
    apply({operationId:id,previewToken:p.previewToken,expectedHash:p.beforeHash},"oauth:ri-fixture");
  }
  it("binds a Source to a Review through create + two receipted appends without upgrading trust",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    await appendSyntheticReview(target.reviewPath,"ILK-SYNTH-RI001-APPEND-A");
    await appendSyntheticReview(target.reviewPath,"ILK-SYNTH-RI001-APPEND-B");
    const {db}=await import("../db");
    const before=db().prepare("SELECT total_changes() AS n").get() as {n:number};
    const rawBefore=fs.readFileSync(path.join(vault,target.reviewPath),"utf8");
    const p=await pack("TSMC",{intakeId:TSMC});
    const bundle=p.contextBundles.find(b=>b.intakeId===TSMC);
    const creationId="ICW-"+sha(["canonical_review",target.reviewPath,sha(target.review)].join("\n")).slice(0,32);
    expect(bundle).toMatchObject({status:"BOUND_SOURCE_REVIEW",reviewReceiptId:creationId,
      sourcePath:target.sourcePath,primaryVerification:"not_performed",economicEventEquivalence:"not_established"});
    expect(p.items.find(item=>item.path===target.reviewPath)?.researchTrust?.comparator_eligible).toBe(false);
    expect(fs.readFileSync(path.join(vault,target.reviewPath),"utf8")).toBe(rawBefore);
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
  });
  it.each(["append_receipt_removed","append_status_interrupted","append_receipt_tampered",
    "external_edit_after_append","replace_after_append"] as const)
    ("holds an invalid or unsupported Review revision chain: %s",async fault=>{
      const target=await saved("TSMC",TSMC,"2026-11-02");
      const id="ILK-SYNTH-RI001-APPEND-ONE";
      await appendSyntheticReview(target.reviewPath,id);
      const {db}=await import("../db");
      if(fault==="append_receipt_removed")
        db().prepare("DELETE FROM safe_edit_operations WHERE id=?").run(id);
      if(fault==="append_status_interrupted")
        db().prepare("UPDATE safe_edit_operations SET status='writing' WHERE id=?").run(id);
      if(fault==="append_receipt_tampered")
        db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.readback','pending') WHERE id=?").run(id);
      if(fault==="external_edit_after_append"){
        const now=fs.readFileSync(path.join(vault,target.reviewPath),"utf8");
        await seed(target.reviewPath,now+"\nUnreceipted synthetic change.");
      }
      if(fault==="replace_after_append"){
        const {preview,apply}=await import("../safe-edit/engine");
        const op="RI001-SYNTH-REPLACE";
        const p=preview({operationId:op,path:target.reviewPath,reason:"Synthetic allowed-body-replace test",change:{
          kind:"replace",oldText:"Synthetic unverified cash conversion discussion.",
          newText:"Synthetic altered cash conversion interpretation."
        }},"oauth:ri-fixture");
        apply({operationId:op,previewToken:p.previewToken,expectedHash:p.beforeHash},"oauth:ri-fixture");
      }
      const p=await pack("TSMC",{intakeId:TSMC});
      expect(p.contextBundles).toEqual([expect.objectContaining({
        status:"HOLD",reason:"create_receipt_unverified",reviewReceiptId:null,sourceReceiptId:null
      })]);
      expect(p.items.map(x=>x.path)).not.toContain(target.sourcePath);
    });
  it("keeps different TSMC events on the same URL separate and supports explicit intake scope",async()=>{
    const first=await saved("TSMC",OLD,"2026-09-01","2026-08-31");
    const second=await saved("TSMC",TSMC,"2026-11-02","2026-11-01");
    const p=await pack("TSMC");
    expect(p.contextBundles.filter(x=>x.status==="BOUND_SOURCE_REVIEW").map(x=>x.intakeId)).toEqual([TSMC,OLD]);
    const scoped=await pack("TSMC",{intakeId:OLD});
    expect(scoped.contextBundles.map(x=>x.reviewPath)).toEqual([first.reviewPath]);
    expect(scoped.items.map(x=>x.path)).not.toContain(second.reviewPath);
    expect(scoped.items.map(x=>x.path)).not.toContain(second.sourcePath);
  });
  it.each(["source_missing","receipt_missing","receipt_pending","source_drift","link_missing","fts_missing","wrong_source","date_mismatch","stale_metadata"])("HOLDs %s without borrowing another event Source",async fault=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");await saved("TSMC",OLD,"2026-09-01");
    const {db}=await import("../db");
    if(fault==="source_missing")fs.unlinkSync(path.join(vault,target.sourcePath));
    if(fault==="receipt_missing")db().prepare("DELETE FROM safe_edit_operations WHERE json_extract(payload,'$.path')=?").run(target.sourcePath);
    if(fault==="receipt_pending")db().prepare("UPDATE safe_edit_operations SET status='writing' WHERE json_extract(payload,'$.path')=?").run(target.sourcePath);
    if(fault==="source_drift")fs.appendFileSync(path.join(vault,target.sourcePath),"\nUnreceipted edit");
    if(fault==="link_missing")db().prepare("DELETE FROM links WHERE source_path=?").run(target.reviewPath);
    if(fault==="fts_missing")db().prepare("DELETE FROM notes_fts WHERE path=?").run(target.sourcePath);
    if(fault==="wrong_source")await seed(target.reviewPath,target.review.replace(target.sourcePath,`00_Inbox/ChatGPT/Investment Intake - ${OLD}.md`));
    if(fault==="date_mismatch")await seed(target.sourcePath,target.source.replace('event_date: null','event_date: "2026-10-10"'));
    if(fault==="stale_metadata")fs.writeFileSync(path.join(vault,target.reviewPath),target.review.replace("2026-11-02","2025-01-01"));
    const p=await pack("TSMC",{intakeId:TSMC});
    expect(p.contextBundles.some(x=>x.status==="BOUND_SOURCE_REVIEW")).toBe(false);
    expect(p.items.map(x=>x.path)).not.toContain(target.sourcePath);
    expect(p.items.some(x=>x.path.includes(OLD))).toBe(false);
    expect(p.researchCoverage[0].canonicalReview.scanComplete).toBe(fault!=="stale_metadata");
  });
  it("does not treat TSMC alias fixtures as a trusted/live instrument mapping",async()=>{
    await saved("TSMC",TSMC,"2026-11-02");
    const p=await pack("TSM");
    expect(p.issuerResolution[0].status).toBe("unresolved");
    expect(p.contextBundles).toEqual([]);
    expect(p.items.some(x=>x.path.includes("TSMC"))).toBe(false);
  });
  it("uses declared publication chronology rather than mtime or event date for latest Review",async()=>{
    const old=await saved("MRVL",OLD,"2026-01-01","2027-01-01");
    const current=await saved("MRVL",MRVL,"2026-11-02",null);
    fs.utimesSync(path.join(vault,old.reviewPath),new Date("2030-01-01"),new Date("2030-01-01"));
    const p=await pack("MRVL");
    expect(p.researchCoverage[0].latestReviewPaths).toEqual([current.reviewPath]);
    expect(p.researchCoverage[0].historicalComparator.status).toBe("FOUND");
    expect(p.researchCoverage[0].historicalComparator.paths).toContain(old.reviewPath);
    expect(p.researchCoverage[0].counterEvidence.status).toBe("FOUND");
  });
  it.each([null,"2026-11-02T01:00:00Z"])("does not assert latest across unknown/overlapping publication chronology %s",async published=>{
    await saved("MRVL",OLD,published);await saved("MRVL",MRVL,"2026-11-02");
    const p=await pack("MRVL");
    expect(p.researchCoverage[0].chronology).toBe("ORDER_UNKNOWN");
    expect(p.researchCoverage[0].historicalComparator.status).toBe("SCAN_INCOMPLETE");
  });
  it("distinguishes NOT_FOUND in completed canonical scope from a scope overflow",async()=>{
    let p=await pack("MRVL");expect(p.researchCoverage[0].canonicalReview.status).toBe("NOT_FOUND");
    const {db}=await import("../db");
    const add=db().prepare("INSERT INTO notes(path,title,mtime,size,frontmatter) VALUES(?,?,0,0,?)");
    db().transaction(()=>{for(let i=0;i<101;i++){
      const id="IN-"+i.toString(16).toUpperCase().padStart(16,"0");
      add.run(`10_Knowledge/Company Research/Investment Review - MRVL - ${id}.md`,"Review",JSON.stringify({type:"investment_research_review",intake_id:id,review_scope:"company",published_at:"2026-01-01"}));
    }})();
    p=await pack("MRVL");expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
  });
  it("does not misclassify present-but-omitted counter-evidence as NOT_FOUND",async()=>{
    await saved("NVDA",OLD,"2026-09-01");await saved("NVDA",TSMC,"2026-10-01");await saved("NVDA",MRVL,"2026-11-02");
    const p=await pack("NVDA",{maxNotes:5,maxChars:4500});
    expect(p.researchCoverage[0].canonicalReview.status).toBe("FOUND");
    expect(p.researchCoverage[0].counterEvidence.status).not.toBe("NOT_FOUND");
  });
  it("does not initialize a missing receipt store during read-only discovery",async()=>{
    const p="10_Knowledge/Company Research/Investment Review - MRVL - "+MRVL+".md";
    await seed(p,`---\ntype: investment_research_review\nintake_id: ${MRVL}\nreview_scope: company\npublished_at: 2026-11-02\n---\n# Synthetic unreceipted Review`);
    const {db}=await import("../db");const before=db().prepare("SELECT total_changes() AS n").get();
    const result=await pack("MRVL");
    expect(result.contextBundles[0].status).toBe("HOLD");
    expect(db().prepare("SELECT 1 FROM sqlite_master WHERE name='safe_edit_operations'").get()).toBeUndefined();
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
  });
  it("keeps note bytes, receipts, index and protected state unchanged across context and decision reads",async()=>{
    const target=await saved("NVDA",MRVL,"2026-11-02");
    for(const p of ["05_Thesis/NVDA - Current Thesis.md","05_Thesis/NVDA - Evidence Register.md","06_Portfolio/Positions.md"])
      await seed(p,"# Protected fixture\nNever alter this text.");
    const {db}=await import("../db");
    const paths=(db().prepare("SELECT path FROM notes ORDER BY path").all() as {path:string}[]).map(x=>x.path);
    const bytes=paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"));
    const receipts=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    const changes=db().prepare("SELECT total_changes() AS n").get();
    const p=await pack("NVDA");
    expect(p.contextBundles[0].status).toBe("BOUND_SOURCE_REVIEW");
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
    const input={domain:"company" as const,entity:"NVDA",metric:"revenue",period:"Q3",originalSource:"https://example.org/fixture",statement:"NVDA synthetic claim requires primary verification"};
    const packet=buildInvestmentDecisionPacket(input,reviewInvestmentClaim(input));
    expect(packet.historicalContext.contextBundles[0].reviewPath).toBe(target.reviewPath);
    expect(packet.historicalContext.researchCoverage[0].canonicalReview.status).toBe("FOUND");
    expect(packet.historicalContext.noteDeclaredPrimaryCandidates).not.toContain(target.sourcePath);
    expect(packet.claimGate.externalPrimaryVerification).toBe("not_performed");
    expect(packet.claimGate.sourceIndependence).toBe("not_assessed");
    expect(paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"))).toEqual(bytes);
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(receipts);
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(changes);
  });
  it("keeps invalid and unscoped intake selectors fail-closed",async()=>{
    const {buildInvestmentContextPack}=await import("./investment-context");
    expect(()=>buildInvestmentContextPack({question:"Latest research",intakeId:MRVL})).toThrow(/issuer scope/);
    expect(()=>buildInvestmentContextPack({question:"MRVL research",issuers:["MRVL"],intakeId:"../other"})).toThrow(/valid intake/);
  });
  it("reports the readback limit without asserting latest or bypassing it through FTS",async()=>{
    for(let i=0;i<9;i++)await saved("MRVL","IN-"+i.toString(16).toUpperCase().padStart(16,"0"),`2026-0${i+1}-01`);
    const p=await pack("MRVL");
    expect(p.contextBundles).toHaveLength(8);
    expect(p.researchCoverage[0]).toMatchObject({chronology:"SCAN_INCOMPLETE",latestReviewPaths:[],canonicalReview:{scanComplete:false}});
    expect(p.researchCoverage[0].canonicalReview.reasons).toContain("canonical_read_limit");
    expect(p.items.some(x=>x.path.includes("IN-0000000000000000"))).toBe(false);
  });
  it("exposes exact intake selection and coverage through the read-only MCP contract",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");await saved("TSMC",OLD,"2026-09-01");
    const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
    const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
    const {createMcpServer}=await import("../mcp/server");
    const [ct,st]=InMemoryTransport.createLinkedPair();
    const server=createMcpServer({read:true,write:false,label:"ri-read-fixture"});
    const client=new Client({name:"ri-read-fixture",version:"1.0"});
    try{
      await Promise.all([server.connect(st),client.connect(ct)]);
      const response=await client.callTool({name:"investment_context_pack",arguments:{question:"TSMC latest research",issuers:["TSMC"],intakeId:TSMC}});
      expect(response.isError).not.toBe(true);
      const blocks=response.content as {type:string;text?:string}[];
      const result=JSON.parse(blocks.find(x=>x.type==="text")!.text!);
      expect(result.contextBundles).toHaveLength(1);
      expect(result.contextBundles[0]).toMatchObject({reviewPath:target.reviewPath,sourcePath:target.sourcePath,status:"BOUND_SOURCE_REVIEW"});
      expect(result.researchCoverage[0].canonicalReview.status).toBe("FOUND");
      expect(result.items.some((x:{path:string})=>x.path.includes(OLD))).toBe(false);
      expect((await client.callTool({name:"investment_context_pack",arguments:{question:"TSMC research",issuers:["TSMC"],intakeId:"../unsafe"}})).isError).toBe(true);
    }finally{await client.close();await server.close();}
  });
});

describe("RI-001 minimal legacy Review compatibility",()=>{
  const id="IN-539504749F0D4BEA";
  const reviewPath=`10_Knowledge/Company Research/Investment Review - SMTC - ${id}.md`;
  const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
  async function legacy(hub="SMTC",fields:Record<string,unknown>={}){
    await seed(`01_Companies/${hub}.md`,hub==="SMTC"?"# SMTC":"---\naliases: [SMTC]\n---\n# Synthetic explicit alias");
    await seed(sourcePath,`---\ntype: investment_source_intake\nintake_id: ${id}\n---\nSource token: InvestmentIntake${id.slice(3)}\nSynthetic submitted source.`);
    const fm={type:"investment_research_review",intake_id:id,company_hubs:[`01_Companies/${hub}.md`],original_source_path:sourcePath,...fields};
    await seed(reviewPath,"---\n"+Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+"\n---\n# SMTC synthetic legacy research\nNo primary verification claimed.");
  }
  it("returns the reported SMTC legacy shape as historical context, with incomplete coverage and no receipt/primary promotion",async()=>{
    await legacy("SMTC",{source_type:"primary",verification:"verified_against_primary"});
    const protectedPath="05_Thesis/SMTC - Current Thesis.md";
    await seed(protectedPath,"# Protected fixture\nKeep these historical bytes unchanged.");
    const {db}=await import("../db");
    const before=db().prepare("SELECT total_changes() AS n").get();
    const paths=[reviewPath,sourcePath,protectedPath];
    const bytes=paths.map(p=>fs.readFileSync(path.join(vault,p)));
    const p=await pack("SMTC");
    expect(p.items.find(x=>x.path===reviewPath)).toMatchObject({role:"research",evidenceUse:"historical_context_only"});
    expect(p.items.map(x=>x.path)).not.toContain(sourcePath);
    expect(p.contextBundles).toEqual([expect.objectContaining({reviewPath,status:"HOLD",reason:"legacy_review_scope_missing",sourcePath:null,primaryVerification:"not_performed"})]);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({status:"SCAN_INCOMPLETE",scanComplete:false,reasons:expect.arrayContaining(["legacy_review_scope_missing"])});
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
    const claim={domain:"company" as const,entity:"SMTC",metric:"revenue",period:"2026",statement:"SMTC synthetic research statement",originalSource:"https://example.org/fixture"};
    const decision=buildInvestmentDecisionPacket(claim,reviewInvestmentClaim(claim));
    expect(decision.historicalContext.sourcePointers.map(x=>x.path)).toContain(reviewPath);
    expect(decision.historicalContext.noteDeclaredPrimaryCandidates).not.toContain(reviewPath);
    expect(db().prepare("SELECT 1 FROM sqlite_master WHERE name='safe_edit_operations'").get()).toBeUndefined();
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(paths.map(p=>fs.readFileSync(path.join(vault,p)))).toEqual(bytes);
  });
  it("does not bind missing review_scope even when create receipts, FTS and readback exist",async()=>{
    await seed("01_Companies/SMTC.md","# SMTC");
    await saved("SMTC",id,"2026-11-02",null,true);
    const {db}=await import("../db");const receipts=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    expect((await pack("SMTC")).contextBundles[0]).toMatchObject({status:"HOLD",reason:"legacy_review_scope_missing",reviewReceiptId:null,sourceReceiptId:null});
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(receipts);
  });
  it.each(["SMTC","Semtech"])("accepts an alias-subject filename through existing unambiguous Hub readback for %s",async query=>{
    await legacy("Semtech");
    const p=await pack(query);
    expect(p.issuerResolution[0].contextKey).toBe("Semtech");
    expect(p.items.find(x=>x.path===reviewPath)?.evidenceUse).toBe("historical_context_only");
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
    expect((await pack("NVDA")).items.map(x=>x.path)).not.toContain(reviewPath);
  });
  it("does not admit a filename alias that collides with a second Hub even when the requested Hub title is unique",async()=>{
    await legacy("Semtech");await seed("01_Companies/OTHER.md","---\naliases: [SMTC]\n---\n# OTHER");
    const p=await pack("Semtech");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
  });
  it("reports bounded alias discovery as incomplete instead of implying a missing legacy Review",async()=>{
    await legacy("Semtech");
    await seed("01_Companies/Semtech.md","---\naliases: "+JSON.stringify([...Array.from({length:12},(_,i)=>`A${i}`),"SMTC"])+"\n---\n# Semtech");
    const p=await pack("Semtech");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({status:"SCAN_INCOMPLETE",scanComplete:false,reasons:expect.arrayContaining(["legacy_subject_alias_limit"])});
  });
  it.each(["missing_hub","ambiguous","stale_hub","stale_review"])("does not use compatibility to bypass %s",async fault=>{
    await legacy();
    if(fault==="missing_hub"){
      fs.unlinkSync(path.join(vault,"01_Companies/SMTC.md"));
      (await import("../db")).db().prepare("DELETE FROM notes WHERE path=?").run("01_Companies/SMTC.md");
    }
    if(fault==="ambiguous")await seed("01_Companies/OTHER.md","---\naliases: [SMTC]\n---\n# Other");
    if(fault==="stale_hub")fs.writeFileSync(path.join(vault,"01_Companies/SMTC.md"),"---\naliases: [OTHER]\n---\n# Changed without reindex");
    if(fault==="stale_review")fs.writeFileSync(path.join(vault,reviewPath),"---\ntype: investment_research_review\nintake_id: IN-0000000000000000\n---\n# Changed without reindex");
    const p=await pack("SMTC");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
    expect(p.contextBundles.some(x=>x.status==="BOUND_SOURCE_REVIEW")).toBe(false);
  });
  it.each([
    {review_scope:"industry"},{review_scope:["company"]},{type:["investment_research_review"]},
    {intake_id:OLD},{company_hubs:["01_Companies/NVDA.md"]},{company_hubs:"../../outside"},{company:"NVDA"}
  ])("rejects conflicting or malformed legacy metadata %j without a false NOT_FOUND",async fields=>{
    await legacy("SMTC",fields);
    const p=await pack("SMTC");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
  });
  it("preserves intakeId selection and valid canonical receipt binding alongside the legacy Review",async()=>{
    await legacy();const valid=await saved("SMTC",OLD,"2026-11-01");
    const a=await pack("SMTC",{intakeId:id});
    expect(a.items.map(x=>x.path)).toContain(reviewPath);
    expect(a.items.map(x=>x.path)).not.toContain(valid.reviewPath);
    const b=await pack("SMTC",{intakeId:OLD});
    expect(b.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(b.contextBundles).toEqual([expect.objectContaining({reviewPath:valid.reviewPath,status:"BOUND_SOURCE_REVIEW"})]);
  });
});

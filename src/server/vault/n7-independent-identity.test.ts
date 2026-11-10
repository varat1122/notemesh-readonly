import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {SupplyChainCandidate,SupplyChainEvidenceRef} from "./supply-chain-intelligence";

let root:string,vault:string,sequence:number;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const quote="NVDA contracted TSMC for synthetic wafer services.";
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"n7-independent-")));vault=path.join(root,"vault");sequence=1;
  fs.mkdirSync(vault);process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const issuer of ["NVDA","TSMC","OTHER"])await seed(`01_Companies/${issuer}.md`,`# Synthetic ${issuer} Hub`);
});
afterEach(async()=>{
  (await import("../db")).db().close();
  fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];vi.restoreAllMocks();
});
async function seed(p:string,content:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),content);
  (await import("./indexer")).reindexPath(p);return p;
}
async function save(kind:string,p:string,content:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});
  const {preview,apply}=await import("../safe-edit/engine");
  const operationId="ICW-"+sha([kind,p,sha(content)].join("\n")).slice(0,32);
  const pre=preview({operationId,path:p,reason:"Synthetic N7 independent fixture",change:{kind:"create",content}},"oauth:n7-independent-fixture");
  apply({operationId,previewToken:pre.previewToken,expectedHash:pre.beforeHash},"oauth:n7-independent-fixture");
  return operationId;
}
async function source(text=quote){
  const intakeId="IN-"+String(sequence++).padStart(16,"0"),sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${intakeId}.md`;
  const sourceUrl=`https://example.org/n7-fixture-${intakeId}`;
  const raw=["---","type: investment_source_intake","source_type: user_supplied",`intake_id: ${intakeId}`,
    "source_kind: issuer_release","attributed_publisher: Synthetic attribution only",`source_url: ${sourceUrl}`,
    `source_text_sha256: ${sha(text)}`,"event_date: null","published_at: null","---","",
    `Source token: InvestmentIntake${intakeId.slice(3)}`,"","## User-supplied original language text","",
    "```text",text,"```","","## Evidence boundary","Synthetic received text. Not verified financial evidence.",""].join("\n");
  const operationId=await save("source_intake",sourcePath,raw);
  return {intakeId,sourcePath,sourceUrl,raw,text,operationId,ref:{intakeId,sourcePath,sourceNoteSha256:sha(raw),quote:text} satisfies SupplyChainEvidenceRef};
}
async function review(s:Awaited<ReturnType<typeof source>>){
  const reviewPath=`10_Knowledge/Company Research/Investment Review - NVDA - ${s.intakeId}.md`;
  const raw=["---","type: investment_research_review","review_scope: company",`intake_id: ${s.intakeId}`,
    'company_hubs: ["01_Companies/NVDA.md", "01_Companies/TSMC.md"]',`original_source_path: "${s.sourcePath}"`,
    "source_type: chatgpt_analysis","verification: not_reverified","research_status: draft","usage_tier: historical_analysis_only",
    "research_state_version: RI001-DRAFT-1","critic_independence: not_verified",
    "comparator_eligible: false","independent_evidence_increment: 0","event_date: null","published_at: null","---","",
    "# Synthetic archived analyst interpretation",`Source token: InvestmentIntake${s.intakeId.slice(3)}`,
    `[[${s.sourcePath.slice(0,-3)}]]`,"## Research analysis","Synthetic unverified discussion; no adjudicated relationship.",""].join("\n");
  await save("canonical_review",reviewPath,raw);
  return {path:reviewPath,noteSha256:sha(raw)};
}
const candidate=(ref:SupplyChainEvidenceRef,overrides:Partial<SupplyChainCandidate>={}):SupplyChainCandidate=>({
  localKey:"candidate_one",subject:"NVDA",object:"TSMC",predicate:"customer_of",direction:"subject_to_object",
  assertionOrigin:"source_statement",lifecycle:"active",sourceRefs:[ref],counterEvidenceRefs:[],relatedEvidenceRefs:[],
  mechanism:"Synthetic source states a services contract; conversion and margins require further research.",
  confidenceBasis:"Attributable source text only; no commercial or legal authentication.",invalidation:"A dated source denies or retracts the reported contract.",
  ambiguity:null,validity:{from:null,to:null},valueChain:{subjectStage:"systems",objectStage:"components"},transmission:[],...overrides
});
async function run(candidates?:SupplyChainCandidate[]){
  return (await import("./supply-chain-intelligence")).previewSupplyChainRelationships({question:"NVDA and TSMC synthetic supply chain",issuers:["NVDA","TSMC"],...(candidates?{candidates}:{})});
}
function files(){
  return fs.readdirSync(vault,{recursive:true,withFileTypes:true}).filter(d=>d.isFile()).map(d=>path.join(d.parentPath,d.name)).sort()
    .map(p=>({path:p,sha256:sha(fs.readFileSync(p,"utf8"))}));
}

describe("N7 independent identity and evidence boundaries",()=>{
  it("returns a useful source-bound candidate while leaving Vault, receipts and indexes untouched",async()=>{
    const s=await source();await seed("05_Thesis/NVDA - Current Thesis.md","# Protected synthetic thesis");
    const {db}=await import("../db");const before=db().prepare("SELECT total_changes() AS n").get(),bytes=files();
    const out=await run([candidate(s.ref)]);
    expect(out.candidates[0].status).toBe("pending_semantic_review");
    expect(out.candidates[0].bindings[0]).toMatchObject({sourcePath:s.sourcePath,sourceNoteSha256:sha(s.raw),quote,documentLocatorVerified:false});
    expect(out).toMatchObject({writesPerformed:false,sourceAuthenticityVerified:false,semanticEntailment:"not_assessed",independentEvidenceIncrement:0,economicRelationshipVerified:false,comparatorEligible:false,canAutoWrite:false,canWriteProtectedNotes:false});
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);expect(files()).toEqual(bytes);
  });
  it("holds an endpoint outside the declared issuer query even when its Hub exists",async()=>{
    const s=await source("NVDA and TSMC discussed OTHER in synthetic context.");
    const out=await run([candidate(s.ref,{object:"OTHER"})]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(out.candidates[0].issues).toContain("n7_endpoint_identity_hold");
  });
  it.each(["ambiguous","stale"])("holds %s identity independently of existing source receipts",async fault=>{
    const s=await source();
    if(fault==="ambiguous")await seed("01_Companies/OTHER.md","---\naliases: [NVDA]\n---\n# Synthetic collision");
    else fs.writeFileSync(path.join(vault,"01_Companies/NVDA.md"),"---\naliases: [Changed]\n---\n# Stale outside index");
    const out=await run([candidate(s.ref)]);
    expect(out.candidates[0].status).toBe("hold");expect(out.candidates[0].proposal).toBeNull();
    expect(out.identity.find(i=>i.requested==="NVDA")?.status).toBe(fault==="ambiguous"?"ambiguous_hold":"readback_hold");
  });
  it("refuses an unrelated receipted Source outside the retrieved endpoint scope",async()=>{
    const s=await source("OTHER has unrelated revenue of 10 USD in synthetic notes.");
    const out=await run([candidate(s.ref)]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(out.candidates[0].issues).toContain("n7_source_outside_retrieved_scope");
  });
  it("refuses stale caller source hashes without upgrading surviving catalog evidence",async()=>{
    const s=await source(),out=await run([candidate({...s.ref,sourceNoteSha256:"0".repeat(64)})]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(out.candidates[0].issues).toContain("n7_source_hash_mismatch");
    expect(out.sourceCatalog[0]?.sourceNoteSha256).toBe(sha(s.raw));expect(out.sourceAuthenticityVerified).toBe(false);
  });
  it("refuses Source-body drift even when frontmatter and indexed discovery remain unchanged",async()=>{
    const s=await source();fs.appendFileSync(path.join(vault,s.sourcePath),"\nUnreceipted synthetic change.");
    const out=await run([candidate(s.ref)]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(out.sourceCatalog).toEqual([]);
  });
  it("rejects a forged receipt status and preserves source files during inspection",async()=>{
    const s=await source();const {db}=await import("../db");
    db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.readback','pending') WHERE id=?").run(s.operationId);
    const before=db().prepare("SELECT total_changes() AS n").get(),bytes=files();const out=await run([candidate(s.ref)]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});expect(out.sourceCatalog).toEqual([]);
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);expect(files()).toEqual(bytes);
  });
  it("does not let an unrelated generated Claim borrow a correctly bound Source",async()=>{
    const text=quote+" OTHER revenue was 10 USD in a synthetic example.",s=await source(text);
    const {planClaimNotes}=await import("./canonical-claims");
    const claims=planClaimNotes({domain:"company",entities:["OTHER"],topic:"Synthetic OTHER revenue",sourceKind:"user_commentary",inputFormat:"text",extractedText:text,sourceUrl:s.sourceUrl,
      claims:[{entity:"OTHER",metric:"revenue",value:"10",unit:"USD",period:"FY2026",evidenceClass:"unverified_claim",statement:"OTHER revenue was 10 USD.",sourceLocator:"Synthetic supplied excerpt",sourceExcerpt:"OTHER revenue was 10 USD",verification:"unverified"}]},s.intakeId,s.sourcePath,s.raw);
    await save("structured_claim",claims[0].path,claims[0].content);
    const out=await run([candidate({...s.ref,claimRef:{path:claims[0].path,noteSha256:sha(claims[0].content)}})]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(out.candidates[0].issues).toContain("n7_claim_endpoint_mismatch");
  });
  it("keeps a valid later candidate usable after an earlier wrong Source/Review pair",async()=>{
    const a=await source(),r=await review(a),b=await source(quote+" A second synthetic received source.");
    const out=await run([candidate({...b.ref,reviewRef:r},{localKey:"wrong_pair"}),candidate({...a.ref,reviewRef:r},{localKey:"valid_pair"})]);
    expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(out.candidates[1].status).toBe("pending_semantic_review");
    expect(out.candidates[1].bindings[0]?.review?.path).toBe(r.path);
  });
  it.each(["company","industry"] as const)("respects a genuine %s Claim domain even when its entity equals a requested issuer",async domain=>{
    const text=quote+" NVDA revenue was 10 USD in a synthetic example.",s=await source(text);
    const {planClaimNotes}=await import("./canonical-claims");
    const claims=planClaimNotes({domain,entities:["NVDA"],topic:"Synthetic attributed revenue",sourceKind:"user_commentary",inputFormat:"text",extractedText:text,sourceUrl:s.sourceUrl,
      claims:[{entity:"NVDA",metric:"revenue",value:"10",unit:"USD",period:"FY2026",evidenceClass:"unverified_claim",statement:"NVDA revenue was 10 USD.",sourceLocator:"Synthetic supplied excerpt",sourceExcerpt:"NVDA revenue was 10 USD",verification:"unverified"}]},s.intakeId,s.sourcePath,s.raw);
    await save("structured_claim",claims[0].path,claims[0].content);
    const out=await run([candidate({...s.ref,claimRef:{path:claims[0].path,noteSha256:sha(claims[0].content)}})]);
    if(domain==="company"){
      expect(out.candidates[0].status).toBe("pending_semantic_review");
      expect(out.candidates[0].bindings[0]?.claim).toMatchObject({entity:"NVDA",path:claims[0].path,noteSha256:sha(claims[0].content)});
    }else{
      expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
      expect(out.candidates[0].issues).toContain("n7_claim_domain_mismatch");
    }
  });
  it("discloses N7-only catalog index failures during discovery-only preview",async()=>{
    const s=await source();await review(s);const {db}=await import("../db");
    db().prepare("UPDATE notes_fts SET body=body || ' Corrupted synthetic FTS body.' WHERE path=?").run(s.sourcePath);
    const out=await run();expect(out.sourceCatalog).toEqual([]);
    expect(JSON.stringify(out.coverage)).toContain("n7_index_body_mismatch");
  });
});

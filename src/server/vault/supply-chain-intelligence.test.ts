import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "./investment-writeback-router";
import type {SupplyChainCandidate,SupplyChainEvidenceRef} from "./supply-chain-intelligence";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const actor="oauth:ios-ri001-n7-disposable";
const text="TESTA reported revenue of 15 million dollars from component shipments to TESTB in FY2026.";
let root:string,vault:string;
async function seed(notePath:string,content:string){
  const target=path.join(vault,notePath);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
  (await import("./indexer")).reindexPath(notePath);
}
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n7-")));vault=path.join(root,"vault");
  for(const dir of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","10_Knowledge/Industry and Concepts"])fs.mkdirSync(path.join(vault,dir),{recursive:true});
  vi.stubEnv("DATA_DIR",root);vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,17).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  for(const ticker of ["TESTA","TESTB","TESTC"])await seed(`01_Companies/${ticker}.md`,`# ${ticker} synthetic Hub\n`);
  await seed("05_Thesis/TESTA - Current Thesis.md","# Protected synthetic thesis\n");
});
afterEach(async()=>{
  expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"utf8")).toBe("# Protected synthetic thesis\n");
  (await import("../db")).db().close();vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();
  fs.rmSync(root,{recursive:true,force:true});
});
const review={headlineTh:"ข้อความสมมติกล่าวถึงรายได้บริษัทที่ยังต้องตรวจสอบต้นฉบับ",
  translationTh:"บริษัทกล่าวถึงรายได้จากการส่งมอบส่วนประกอบให้ลูกค้า ยังไม่ได้ตรวจสอบต้นฉบับ",
  whatChangedTh:"เป็นข้อความที่ผู้ใช้ส่งมาและยังไม่ได้ตรวจสอบกับหลักฐานต้นฉบับ",
  mechanismTh:"ความต้องการสินค้าอาจส่งผลต่อรายได้และกำไร แต่ยังต้องตรวจสอบข้อมูลจริง",
  thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือประมาณการกำไร",
  counterEvidenceTh:"ต้นทุนและอัตราผลผลิตจริงอาจแตกต่างจากคาด",
  requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและวันที่ประกาศก่อนใช้ข้อมูล"};
function intake(sourceText=text,extras:Partial<WritebackInput>={}):WritebackInput{return {
  domain:"company",entities:["TESTA","TESTB"],topic:"Synthetic supply chain component shipments",
  inputFormat:"text",sourceKind:"news_media",extractedText:sourceText,sourceLanguage:"en",
  sourceChat:"IOS-ORCH-RI-001 N7 disposable fixture",sourceChannel:"synthetic_received_text",
  publisher:"Synthetic attributed publisher",sourceUrl:`https://example.org/n7/${sha(sourceText).slice(0,12)}`,
  publicationDate:"2026-11-01",eventDate:"2026-11-01",captureOnly:true,
  entityRoles:[{entity:"TESTA",role:"primary_subject"},{entity:"TESTB",role:"mentioned"}],
  contentTypes:["reported_fact"],originalDocumentAccess:"excerpt_only",...extras
};}
async function write(sourceText=text,extras:Partial<WritebackInput>={}){
  const input=intake(sourceText,extras),plan=(await import("./investment-writeback-router")).planInvestmentWriteback(input);
  const engine=await import("../safe-edit/engine");
  const prepared=input.captureOnly===false?(await import("../mcp/canonical-writeback")).prepareCanonicalWriteback(input,actor):null;
  for(const step of plan.safeEditWorkflow!.steps){
    if(step.state==="verified_existing")continue;
    expect(step.state).toBe("needs_create");expect(step.safeEditRequest).not.toBeNull();
    const p=prepared?.previews.find(p=>p.path===step.path)??engine.preview(step.safeEditRequest,actor);
    expect(engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor).status).toBe("written");
  }
  const source=plan.safeEditWorkflow!.steps.find(s=>s.kind==="source_intake")!;
  const ref:SupplyChainEvidenceRef={intakeId:plan.planId,sourcePath:source.path,
    sourceNoteSha256:sha(fs.readFileSync(path.join(vault,source.path),"utf8")),quote:sourceText};
  return {plan,ref};
}
const candidate=(sourceRef:SupplyChainEvidenceRef,extra:Partial<SupplyChainCandidate>={}):SupplyChainCandidate=>({
  localKey:"testa_testb",subject:"TESTA",object:"TESTB",predicate:"supplier_to",direction:"subject_to_object",
  assertionOrigin:"source_statement",lifecycle:"active",sourceRefs:[sourceRef],counterEvidenceRefs:[],relatedEvidenceRefs:[],
  mechanism:"Caller proposes component sales; commercial terms are unverified.",confidenceBasis:"Attributed received text only.",
  invalidation:"A corrected source or failed qualification may invalidate the proposed mechanism.",ambiguity:null,
  validity:{from:null,to:null},valueChain:{subjectStage:"components",objectStage:"systems"},
  transmission:[{stage:"gross_profit",mechanism:"Yield and pricing may affect gross profit; this has not been assessed.",magnitude:null}],...extra
});
async function preview(candidates:SupplyChainCandidate[]=[],extra:Record<string,unknown>={}){
  return (await import("./supply-chain-intelligence")).previewSupplyChainRelationships({
    question:"TESTA TESTB component shipments and counter evidence",issuers:["TESTA","TESTB"],candidates,...extra});
}
async function snapshot(){
  const d=(await import("../db")).db();
  return {schema:d.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
    operations:d.prepare("SELECT * FROM safe_edit_operations ORDER BY id").all(),
    events:d.prepare("SELECT * FROM safe_edit_events ORDER BY rowid").all(),
    notes:d.prepare("SELECT * FROM notes ORDER BY path").all(),links:d.prepare("SELECT * FROM links ORDER BY source_path,target").all()};
}

describe("N7 bounded read-only relationship preview",()=>{
  it("returns usable pending candidates from real receipts without changing notes, receipts or tables",async()=>{
    const saved=await write(),before=await snapshot();
    const result=await preview([candidate(saved.ref,{transmission:[{stage:"gross_profit",mechanism:"Caller scenario only",magnitude:"5 percentage points"}]})]);
    expect(result.candidates[0]).toMatchObject({status:"pending_semantic_review",semanticEntailment:"not_assessed",effectiveExposureMagnitude:"unknown",
      subjectHubPath:"01_Companies/TESTA.md",objectHubPath:"01_Companies/TESTB.md",independentEvidenceIncrement:0});
    expect(result.candidates[0].proposal?.transmission[0].proposedMagnitude).toBe("5 percentage points");
    expect(result.candidates[0].bindings[0]).toMatchObject({sourceReceiptId:saved.plan.safeEditWorkflow!.steps[0].receiptKey,
      recordedAt:"2026-11-10T12:00:00.000Z",documentLocatorVerified:false,occurrenceCount:1});
    expect(result).toMatchObject({writesPerformed:false,canAutoWrite:false,economicRelationshipVerified:false,comparatorEligible:false});
    expect(await snapshot()).toEqual(before);
  });
  it("catalogues a shared source once but creates no relationship from co-mentions or repeated retrieval",async()=>{
    const saved=await write();const first=await preview(),second=await preview();
    expect(first.sourceCatalog).toHaveLength(1);expect(first.candidates).toEqual([]);
    expect(first.sourceCatalog[0]).toMatchObject({sourcePath:saved.ref.sourcePath,contextKeys:["TESTA","TESTB"],quotePreview:text});
    expect(second.sourceCatalog).toEqual(first.sourceCatalog);
  });
  it("keeps inferred beneficiaries hypothetical, co-mention edges held, and declared conflicts linked",async()=>{
    const source=await write(),contrary=await write("TESTB denied a commercial component purchase from TESTA.");
    const result=await preview([
      candidate(source.ref,{localKey:"potential",predicate:"potential_beneficiary_of",assertionOrigin:"analyst_interpretation"}),
      candidate(source.ref,{localKey:"mention",assertionOrigin:"co_mention"}),
      candidate(source.ref,{localKey:"conflict",lifecycle:"contradicted",counterEvidenceRefs:[contrary.ref],relatedEvidenceRefs:[source.ref]}),
      candidate(source.ref,{localKey:"correction",lifecycle:"correction",relatedEvidenceRefs:[contrary.ref]})]);
    expect(result.candidates.map(c=>c.status)).toEqual(["hypothesis_pending_review","hold","hold","pending_semantic_review"]);
    expect(result.candidates[1].bindings).toHaveLength(1);expect(result.candidates[1].proposal).not.toBeNull();
    expect(result.candidates[2].bindings.map(r=>r.role)).toEqual(["support","counter","lifecycle"]);
    expect(result.candidates[2].proposal?.lifecycle).toBe("contradicted");
    expect(result.candidates[3].bindings[1].sourcePath).toBe(contrary.ref.sourcePath);
  });
  it.each(["control","collision","stale"])("holds a %s issuer identity without inventing a path mapping",async fault=>{
    const source=await write();
    if(fault==="collision")await seed("01_Companies/TESTC.md","---\naliases: [TESTA]\n---\n# Synthetic collision\n");
    if(fault==="stale")fs.unlinkSync(path.join(vault,"01_Companies/TESTA.md"));
    const label=fault==="control"?"TE\nSTA":"TESTA";
    const result=await preview([candidate(source.ref,{subject:label})],{issuers:[label,"TESTB"]});
    expect(result.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[]});
    expect(result.candidates[0].issues).toContain("n7_endpoint_identity_hold");
  });
  it("rejects wrong hashes, missing original quotes and an unrelated endpoint scope",async()=>{
    const source=await write();const result=await preview([
      candidate({...source.ref,sourceNoteSha256:"0".repeat(64)},{localKey:"hash"}),
      candidate({...source.ref,quote:"An invented commercial agreement."},{localKey:"quote"}),
      candidate(source.ref,{localKey:"scope",subject:"TESTB",object:"TESTC"})],{issuers:["TESTA","TESTB","TESTC"]});
    expect(result.candidates.every(c=>c.status==="hold"&&c.proposal===null&&c.bindings.length===0)).toBe(true);
    expect(result.candidates[0].issues).toContain("n7_source_hash_mismatch");
    expect(result.candidates[1].issues).toContain("n7_quote_not_in_original_text");
    expect(result.candidates[2].issues).toContain("n7_support_endpoint_scope_incomplete");
  });
  it("detects FTS body corruption even when frontmatter and the write receipt still match",async()=>{
    const source=await write(),d=(await import("../db")).db();
    d.prepare("UPDATE notes_fts SET body=? WHERE path=?").run(`TESTA TESTB corrupt body InvestmentIntake${source.plan.planId.slice(3)}`,source.ref.sourcePath);
    const result=await preview([candidate(source.ref)]);
    expect(result.coverage.retrievalStatus).toBe("operational_hold");expect(result.sourceCatalog).toEqual([]);
    expect(result.candidates[0]).toMatchObject({status:"hold",proposal:null});
  });
  it("keeps repeated quotes nonunique and document page locators caller-declared",async()=>{
    const source=await write(text+"\n"+text);
    const result=await preview([candidate({...source.ref,quote:text,documentLocator:"PDF p. 42, Table 7"})]);
    expect(result.candidates[0].bindings[0]).toMatchObject({occurrenceCount:2,uniqueSpan:null,documentLocatorVerified:false});
  });
  it("uses support union for a relationship source plus customer guidance without multiplying evidence authority",async()=>{
    const source=await write(),guide=await write("TESTB expects spending on systems to rise next year.");
    const result=await preview([candidate(source.ref,{assertionOrigin:"analyst_interpretation",sourceRefs:[source.ref,guide.ref],estimateVintage:"2026-11-01"})]);
    expect(result.candidates[0].status).toBe("hypothesis_pending_review");expect(result.candidates[0].bindings).toHaveLength(2);
    expect(result.candidates[0].independentEvidenceIncrement).toBe(0);
  });
  it("redacts future support and counter evidence including caller narrative, paths and metadata",async()=>{
    const old=await write();vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
    const future=await write("TESTA and TESTB ended the secret future component agreement.");
    const result=await preview([
      candidate(future.ref,{localKey:"future_support",mechanism:"secret future component agreement"}),
      candidate(old.ref,{localKey:"future_counter",counterEvidenceRefs:[future.ref],mechanism:"secret future component agreement"})
    ],{asOf:"2026-11-11T12:00:00.000Z"});
    expect(result.sourceCatalog.map(s=>s.sourcePath)).toEqual([old.ref.sourcePath]);
    expect(result.candidates.every(c=>c.status==="hold"&&c.proposal===null&&c.bindings.length===0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret future");expect(JSON.stringify(result)).not.toContain(future.ref.sourcePath);
    expect(result.candidates[0].issues).toContain("n7_recorded_after_cutoff");
  });
  it("allows eligible known bytes with explicit prospective validity and keeps cutoff separate from generated analysis",async()=>{
    const saved=await write();const result=await preview([candidate(saved.ref,{validity:{from:"2027-01-01",to:null}})],{asOf:"2026-11-11T12:00:00.000Z"});
    expect(result.candidates[0]).toMatchObject({status:"pending_semantic_review",declaredTemporalStatus:"prospective"});
    expect(result.queryCutoffAsOf).toBe("2026-11-11T12:00:00.000Z");expect(result.generatedAt).toBe("2026-11-10T12:00:00.000Z");
    expect(result.candidates[0].proposal?.proposalOrigin).toBe("caller_supplied_reasoning");
  });
  it("binds optional exact Source/Claim/Review references without upgrading draft authority",async()=>{
    const saved=await write(text,{captureOnly:false,researchReview:review,claims:[{entity:"TESTA",metric:"revenue",period:"FY2026",
      statement:"TESTA reported revenue of 15 million dollars.",value:"15",unit:"USD million",evidenceClass:"unverified_claim",verification:"unverified",
      sourceLocator:"synthetic received paragraph",sourceExcerpt:"TESTA reported revenue of 15 million dollars"}]});
    const claim=saved.plan.safeEditWorkflow!.steps.find(s=>s.kind==="structured_claim")!;
    const reviewStep=saved.plan.safeEditWorkflow!.steps.find(s=>s.kind==="canonical_review")!;
    const ref={...saved.ref,claimRef:{path:claim.path,noteSha256:sha(fs.readFileSync(path.join(vault,claim.path),"utf8"))},
      reviewRef:{path:reviewStep.path,noteSha256:sha(fs.readFileSync(path.join(vault,reviewStep.path),"utf8"))}};
    const result=await preview([candidate(ref)],{asOf:"2026-11-11T12:00:00.000Z"});
    expect(result.candidates[0].status).toBe("pending_semantic_review");
    expect(result.candidates[0].bindings[0].claim).toMatchObject({entity:"TESTA",receiptId:claim.receiptKey});
    expect(result.candidates[0].bindings[0].review?.researchTrust).toMatchObject({research_status:"draft",primary_authority:false,comparator_eligible:false});
    expect(JSON.stringify(result)).not.toContain("reviewReferences");expect(JSON.stringify(result)).not.toContain("readbackText");
  });
  it("does not poison a valid Review pair after an unrelated caller-supplied pair",async()=>{
    const first=await write(text,{captureOnly:false,researchReview:review});
    const second=await write("TESTA shipments to TESTB remain an attributed statement, not authenticated commercial terms.",{captureOnly:false,researchReview:review});
    const r=first.plan.safeEditWorkflow!.steps.find(s=>s.kind==="canonical_review")!;
    const reviewRef={path:r.path,noteSha256:sha(fs.readFileSync(path.join(vault,r.path),"utf8"))};
    const result=await preview([candidate({...second.ref,reviewRef},{localKey:"wrong_pair"}),candidate({...first.ref,reviewRef},{localKey:"right_pair"})]);
    expect(result.candidates[0].status).toBe("hold");
    expect(result.candidates[1].status).toBe("pending_semantic_review");
    expect(result.candidates[1].bindings[0].review?.path).toBe(r.path);
  });
  it("reports N7 read integrity failures for a bound Source even when legacy context token checks pass",async()=>{
    const saved=await write(text,{captureOnly:false,researchReview:review}),d=(await import("../db")).db();
    d.prepare("UPDATE notes_fts SET body=? WHERE path=?").run(`TESTA TESTB wrong body InvestmentIntake${saved.plan.planId.slice(3)}`,saved.ref.sourcePath);
    const result=await preview();
    expect(result.sourceCatalog).toEqual([]);expect(result.coverage.retrievalStatus).toBe("operational_hold");
    expect(result.coverage.evidenceReadHoldCount).toBeGreaterThan(0);
    expect(result.coverage.evidenceReadHoldReasons).toContain("n7_index_body_mismatch");
    expect(JSON.stringify(result)).not.toContain(saved.ref.sourcePath);
  });
  it("rejects a valid non-company claim sharing an endpoint label and the same Source",async()=>{
    const saved=await write(text,{domain:"industry",entities:["TESTA"],entityRoles:[],claims:[{entity:"TESTA",metric:"revenue",period:"FY2026",
      statement:"TESTA reported revenue of 15 million dollars.",value:"15",unit:"USD million",evidenceClass:"unverified_claim",verification:"unverified",
      sourceLocator:"synthetic industry claim",sourceExcerpt:"TESTA reported revenue of 15 million dollars"}]});
    const c=saved.plan.safeEditWorkflow!.steps.find(s=>s.kind==="structured_claim")!;
    const result=await preview([candidate({...saved.ref,claimRef:{path:c.path,noteSha256:sha(fs.readFileSync(path.join(vault,c.path),"utf8"))}})]);
    expect(result.candidates[0]).toMatchObject({status:"hold",proposal:null});
    expect(result.candidates[0].issues).toContain("n7_claim_domain_mismatch");
  });
});

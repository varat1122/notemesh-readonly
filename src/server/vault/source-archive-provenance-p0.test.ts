import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput,WritebackPlan} from "./investment-writeback-router";
import type {DocumentArchiveInput,DocumentSnapshot} from "../research-source-archive";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));

let root:string,vault:string;
const protectedPaths=["05_Thesis/MU - Current Thesis.md","05_Thesis/MU - Evidence Register.md",
  "01_Companies/MU - Evolution Timeline.md","06_Portfolio/Team.md","06_Portfolio/Trades.md"];
const protectedBytes="# Owner-controlled fixture; never automatically updated.\n";
const sourceUrl="https://www.sec.gov/Archives/edgar/data/723125/mu-test.htm";
const review={headlineTh:"ข่าวตัวอย่าง MU ยังต้องตรวจเอกสารต้นฉบับ",translationTh:"ข้อมูลตัวอย่างที่ยังไม่ได้ยืนยัน",
  whatChangedTh:"ข้อมูลใหม่ยังไม่ยืนยันข้อเท็จจริง",mechanismTh:"ผลกระทบขึ้นอยู่กับข้อมูลที่ต้องตรวจสอบ",
  thesisImplicationTh:"ไม่เปลี่ยนข้อสรุปการลงทุน",counterEvidenceTh:"ยังมีข้อมูลขัดแย้งที่ต้องตรวจสอบ",
  requiredEvidenceTh:"ต้องตรวจต้นฉบับและช่วงเวลาของข้อมูล"};
const input:WritebackInput={domain:"company",entities:["MU"],topic:"MU provenance fixture",
  inputFormat:"text",sourceKind:"regulatory_filing",sourceLanguage:"en",sourceChat:"P0 provenance fixture",
  extractedText:"Synthetic supplied transcription; publisher identity and claim truth are unverified.",
  sourceUrl,publisher:"attributed filing",eventDate:"2026-10-22",publicationDate:"2026-10-23",
  entityRoles:[{entity:"MU",role:"primary_subject"}],contentTypes:["reported_fact"],
  sourceChannel:"news_media",originalDocumentAccess:"excerpt_only",researchReview:review};
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"p0-archive-link-")));
  vault=path.join(root,"vault");
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Company Research","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,9).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
  vi.resetModules();
  await seed("01_Companies/MU.md","# MU\n");
  for(const file of protectedPaths)await seed(file,protectedBytes);
});
afterEach(()=>{
  try{for(const file of protectedPaths)expect(fs.readFileSync(path.join(vault,file),"utf8")).toBe(protectedBytes);}
  finally{
    vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});
    for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
  }
});
async function seed(rel:string,body:string){
  const abs=path.join(vault,rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(rel);
}
const bytes=Buffer.from("<html><body>Synthetic issuer document, unchanged original archived bytes.</body></html>");
async function capture(delta:Partial<DocumentArchiveInput>={}){
  const {captureOriginalDocumentBytes}=await import("../research-source-archive");
  return captureOriginalDocumentBytes({originalSource:sourceUrl,bytes,contentType:"text/html",
    capturedAt:"2026-10-24T01:00:00Z",captureMethod:"authorized_external_download",retrievedFrom:sourceUrl,
    reviewerOrOperator:"synthetic-provenance-operator",responseEtag:'"v1"',
    responseLastModified:"Fri, 23 Oct 2026 12:00:00 GMT",...delta});
}
const blob=(s:DocumentSnapshot)=>path.join(root,"source-archive","blobs",s.sha256.slice(0,2),s.sha256+".bin");
async function route(data:WritebackInput=input){return (await import("./investment-writeback-router")).planInvestmentWriteback(data);}
async function applyRecipe(plan:WritebackPlan){
  const {preview,apply}=await import("../safe-edit/engine");
  const receipts=[];
  for(const step of plan.safeEditWorkflow!.steps){
    if(!step.safeEditRequest)continue;
    const p=preview(step.safeEditRequest,"oauth:p0-provenance-fixture");
    const r=apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},"oauth:p0-provenance-fixture");
    expect(r).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified"}});
    receipts.push(r);
  }
  return receipts;
}
const content=(p:WritebackPlan,kind:"source_intake"|"canonical_review")=>
  p.safeEditWorkflow!.steps.find(x=>x.kind===kind)!.safeEditRequest?.change.content??"";
async function historicalState(){
  const {db}=await import("../db");
  const rows=db().prepare("SELECT id,status,receipt,after_hash FROM safe_edit_operations ORDER BY id").all();
  const files=db().prepare("SELECT path FROM notes WHERE path LIKE '00_Inbox/%' OR path LIKE '10_Knowledge/%' ORDER BY path").all() as {path:string}[];
  return {rows,files:files.map(x=>({path:x.path,bytes:fs.readFileSync(path.join(vault,x.path),"utf8")}))};
}

describe("P0 canonical Review original-source archive provenance",()=>{
  it("binds a persisted text Source to intact archived bytes, then writes/reads/indexes its first typed Review and repeats idempotently",async()=>{
    const source=await route({...input,researchReview:undefined,captureOnly:true});
    expect(await applyRecipe(source)).toHaveLength(1);
    const sourcePath=source.safeEditWorkflow!.steps[0].path;
    const sourceBytes=fs.readFileSync(path.join(vault,sourcePath),"utf8");
    const snap=await capture();const p=await route();
    expect(p.safeEditWorkflow!.steps.map(s=>s.state)).toEqual(["verified_existing","needs_create"]);
    expect(p.sourceCapture.originalSourceArchive).toMatchObject({snapshotId:snap.snapshotId,sourceUrlSha256:createHash("sha256").update(sourceUrl).digest("hex"),
      sha256:createHash("sha256").update(bytes).digest("hex"),revision:1,capturedAt:snap.capturedAt,
      archiveStatus:"ARCHIVED_BYTES_INTACT",publisherAuthenticityVerified:false,
      originalDocumentSignatureVerified:false,independentEvidenceIncrement:0});
    expect(p.sourceCapture.textDigest).not.toBe(snap.sha256);
    const reviewText=content(p,"canonical_review");
    expect(reviewText).toContain(sourcePath);expect(reviewText).toContain(snap.snapshotId);
    expect(reviewText).toContain(snap.sha256);expect(reviewText).toContain("verification: not_reverified");
    expect(reviewText).toContain("publisher authenticity/signature and claim truth are NOT verified");
    expect(sourceBytes).toContain("source_type: user_supplied");expect(sourceBytes).toContain("verification: not_reverified");
    expect(await applyRecipe(p)).toHaveLength(1);
    const saved=await historicalState();
    const again=await route();expect(again.safeEditWorkflow!.status).toBe("saved_verified");
    expect(again.safeEditWorkflow!.readyForNextNews).toBe(true);
    expect(await applyRecipe(again)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
    expect(fs.readFileSync(path.join(vault,sourcePath),"utf8")).toBe(sourceBytes);
    const {db}=await import("../db");const reviewPath=again.safeEditWorkflow!.steps[1].path;
    expect(db().prepare("SELECT count(*) n FROM links WHERE source_path=? AND resolved_path=?").get(reviewPath,sourcePath)).toMatchObject({n:1});
    expect(db().prepare("SELECT count(*) n FROM notes_fts WHERE path=?").get(reviewPath)).toMatchObject({n:1});
  });
  it("keeps no-archive plans compatible and repeatable without adding a placeholder to historical Review bytes",async()=>{
    const p=await route();expect(p.sourceCapture.archiveProvenanceStatus).toBe("ABSENT");
    expect(p.sourceCapture.originalSourceArchive).toBeNull();
    expect(content(p,"canonical_review")).not.toContain("Original-byte archive:");
    await applyRecipe(p);const saved=await historicalState();
    expect((await route()).safeEditWorkflow!.status).toBe("saved_verified");
    expect(await historicalState()).toEqual(saved);
  });
  it.each(["corrupt","missing"] as const)("holds %s archive provenance without deleting Source, historical Review or write receipts",async(fault)=>{
    const snap=await capture();await applyRecipe(await route());const saved=await historicalState();
    if(fault==="corrupt")fs.writeFileSync(blob(snap),Buffer.alloc(bytes.length,0x78));
    else fs.unlinkSync(blob(snap));
    const p=await route();expect(p.sourceCapture.archiveProvenanceStatus).toBe("HOLD");
    expect(p.sourceCapture.archiveProvenanceReason).toBe("selected_snapshot_missing_or_corrupt");
    expect(p.sourceCapture.originalSourceArchive).toBeNull();
    expect(p.safeEditWorkflow!.steps.map(s=>s.state)).toEqual(["verified_existing","hold_archive_drift"]);
    expect(await applyRecipe(p)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
  it("same URL and same bytes retry retains the original capture/receipt binding",async()=>{
    const first=await capture();const p=await route();await applyRecipe(p);const saved=await historicalState();
    const repeated=await capture({capturedAt:"2026-10-28T12:00:00Z",responseEtag:'"new-header-same-bytes"'});
    expect(repeated).toEqual(first);
    const retry=await route();expect(retry.sourceCapture.originalSourceArchive).toEqual(p.sourceCapture.originalSourceArchive);
    expect(retry.safeEditWorkflow!.status).toBe("saved_verified");expect(await historicalState()).toEqual(saved);
  });
  it("tracking-only URL aliases retain canonical archive binding and Review retry idempotence",async()=>{
    await capture();const p=await route();await applyRecipe(p);const saved=await historicalState();
    const retry=await route({...input,sourceUrl:sourceUrl+"?utm_source=retry#section"});
    expect(retry.planId).toBe(p.planId);
    expect(retry.sourceCapture.originalSourceArchive).toEqual(p.sourceCapture.originalSourceArchive);
    expect(retry.safeEditWorkflow!.status).toBe("saved_verified");expect(await historicalState()).toEqual(saved);
  });
  it("same URL with changed bytes/new capture exposes revision chronology and HOLDs rather than rewriting the old Review",async()=>{
    const first=await capture();const initial=await route();await applyRecipe(initial);const saved=await historicalState();
    const second=await capture({bytes:Buffer.from("<html>Publisher revised the document after the original event.</html>"),
      capturedAt:"2026-10-29T12:00:00Z",responseEtag:'"publisher-v2"',responseLastModified:"Wed, 28 Oct 2026 12:00:00 GMT"});
    const p=await route();expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(p.planId).toBe(initial.planId);
    expect(p.sourceCapture.originalSourceArchive).toMatchObject({snapshotId:second.snapshotId,revision:2,
      changesObserved:true,publisherRevisionHintsPresent:true,
      selection:"HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION",association:"URL_ONLY_NOT_TRANSCRIPTION_OR_EVENT_PROOF",
      chronology:{eventDate:input.eventDate,publicationDate:input.publicationDate,captureRelation:"ORDER_UNKNOWN_TIMEZONE",originalEventVersionVerified:false}});
    expect(p.safeEditWorkflow!.status).toBe("hold_archive_drift");
    expect(await applyRecipe(p)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
  it("archive sequence does not claim capture order or silently fall back to an older intact snapshot",async()=>{
    await capture();const second=await capture({bytes:Buffer.from("<html>Backfilled snapshot with an earlier capture timestamp.</html>"),capturedAt:"2026-10-22T10:00:00Z"});
    const p=await route();expect(p.sourceCapture.originalSourceArchive).toMatchObject({revision:2,
      capturedAt:second.capturedAt,chronology:{captureRelation:"ORDER_UNKNOWN_TIMEZONE",originalEventVersionVerified:false}});
    fs.unlinkSync(blob(second));expect((await route()).sourceCapture.archiveProvenanceStatus).toBe("HOLD");
  });
  it("an archive cannot satisfy the claim-level primary receipt gate or promote Review verification",async()=>{
    await capture();
    const p=await route({...input,contentTypes:["guidance"],researchReview:{...review,claimAssessments:[{
      entity:"MU",metric:"revenue guidance",period:"FY2027",unit:"% YoY",competingValues:["+20%","-20%"],
      resolution:"verified_primary",conclusion:"confirmed",primarySourceUrl:sourceUrl,verifiedValue:"+20%",
      primaryEvidenceReceipt:"PEV-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"}]}});
    expect(p.sourceCapture.archiveProvenanceStatus).toBe("ARCHIVED_BYTES_INTACT");
    expect(p.sourceCapture.originalSourceVerified).toBe(false);
    expect(p.safeEditWorkflow!.qualityIssues).toContain("primary_evidence_receipt_validation_pending");
    expect(p.safeEditWorkflow!.steps[1].state).toBe("hold_quality_gate");
    expect(p.safeEditWorkflow!.steps[1].safeEditRequest).toBeNull();
    expect(p.safeEditWorkflow!.readyForNextNews).toBe(false);
  });
  it("multiple Reviews and byte revisions from one origin remain candidates, never independent evidence",async()=>{
    const body=`---\nentity: MU\nmetric: revenue\nperiod: FY2027\noriginal_source: ${sourceUrl}\nvalue: "12"\nunit: USD billions\nverification: not_reverified\n---\n# MU FY2027 same-origin commentary\n`;
    for(const name of ["One","Two"])await seed(`10_Knowledge/Company Research/${name}.md`,body);
    const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
    const q={domain:"company" as const,entity:"MU",metric:"revenue",period:"FY2027",originalSource:sourceUrl,
      value:"12",unit:"USD billions",statement:"Synthetic same-origin revenue claim."};
    const before=hybridClaimPreview(q);await capture();await capture({bytes:Buffer.from("<html>Same publisher, modified wording, no new independent origin.</html>")});
    const after=hybridClaimPreview(q);
    expect(after.indexed).toEqual(before.indexed);expect(after.indexed.totalSameDocument).toBe(2);
    expect(after.classification).toBe("DUPLICATE_CANDIDATE");
    expect(after.gates).toEqual(before.gates);expect(after.gates.independentEvidenceEstablished).toBe(false);
    const p=await route();expect(p.sourceCapture.originalSourceArchive!.independentEvidenceIncrement).toBe(0);
    expect(p.gates.sourceIndependenceVerified).toBe(false);
  });
  it("another Source for the same event still HOLDs with intact archive provenance",async()=>{
    await capture();await applyRecipe(await route({...input,researchReview:undefined,captureOnly:true}));
    await seed("00_Inbox/ChatGPT/Investment Intake - IN-1111111111111111.md",
      `---\ntype: investment_source_intake\nintake_id: IN-1111111111111111\ncompany: MU\nsource_url: ${sourceUrl}\nevent_date: ${input.eventDate}\n---\n# Differently worded same event\n`);
    const p=await route();expect(p.sourceCapture.archiveProvenanceStatus).toBe("ARCHIVED_BYTES_INTACT");
    expect(p.safeEditWorkflow!.status).toBe("hold_source_event_review");
    expect(p.safeEditWorkflow!.steps[1].safeEditRequest).toBeNull();
  });
  it("hashes only the selected snapshot and escapes publisher metadata instead of injecting Markdown",async()=>{
    await capture();await capture({bytes:Buffer.from("<html>A revised document with malicious response metadata.</html>"),
      responseEtag:'"x"\n# promote claim [[06_Portfolio/Trades]] <script>`'});
    const archive=await import("../research-source-archive");const read=vi.spyOn(archive,"inspectOriginalSourceSnapshot");
    const p=await route();expect(read).toHaveBeenCalledTimes(1);
    expect(content(p,"canonical_review")).not.toContain("\n# promote claim");
    expect(content(p,"canonical_review")).not.toContain("[[06_Portfolio/Trades]]");
    expect(content(p,"canonical_review")).not.toContain("<script>");
  });
  it("truncated history fails closed before byte reads, without selecting an arbitrary partial version",async()=>{
    for(let i=0;i<101;i++)await capture({bytes:Buffer.from(`<html>Bounded revision fixture ${i}.</html>`)});
    const archive=await import("../research-source-archive");const read=vi.spyOn(archive,"inspectOriginalSourceSnapshot");
    const p=await route();expect(p.sourceCapture.archiveProvenanceStatus).toBe("HOLD");
    expect(p.sourceCapture.archiveProvenanceReason).toBe("history_limit");expect(read).not.toHaveBeenCalled();
    expect(p.safeEditWorkflow!.steps.map(x=>x.state)).toEqual(["needs_create","hold_archive_provenance"]);
    expect(p.safeEditWorkflow!.steps[1].safeEditRequest).toBeNull();
    expect(p.safeEditWorkflow!.readyForNextNews).toBe(false);
  });
  it("changed archive binding invalidates preview authorizations before any canonical write",async()=>{
    await capture();
    const {prepareCanonicalWriteback,applyCanonicalWriteback}=await import("../mcp/canonical-writeback");
    const actor="oauth:p0-provenance-fixture";
    const p=prepareCanonicalWriteback(input,actor);
    await capture({bytes:Buffer.from("<html>Publisher revised bytes between preview and apply.</html>")});
    await expect(applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(x=>({
      operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor))
      .rejects.toThrow("Authorization must exactly match the pending canonical steps");
    for(const step of p.steps)expect(fs.existsSync(path.join(vault,step.path))).toBe(false);
    const {db}=await import("../db");
    expect(db().prepare("SELECT count(*) n FROM safe_edit_operations WHERE status='written'").get()).toMatchObject({n:0});
  });
  it("rejects URL/digest receipt misbinding and metadata changes between selection and byte readback",async()=>{
    await capture();const {db}=await import("../db");
    db().prepare("UPDATE source_snapshots SET original_source=?").run("https://example.org/unrelated");
    expect((await route()).sourceCapture.archiveProvenanceReason).toBe("metadata_invalid");
    db().prepare("UPDATE source_snapshots SET original_source=?").run(sourceUrl);
    const archive=await import("../research-source-archive");const original=archive.inspectOriginalSourceSnapshot;
    vi.spyOn(archive,"inspectOriginalSourceSnapshot").mockImplementation(id=>{
      const snap=original(id);return snap?{...snap,capturedAt:"2026-10-30T00:00:00Z"}:null;
    });
    expect((await route()).sourceCapture.archiveProvenanceReason).toBe("selected_snapshot_missing_or_corrupt");
  });
  it("rejects oversized metadata before reading bytes and keeps unknown archive failures explicit",async()=>{
    await capture();const {db}=await import("../db");db().prepare("UPDATE source_snapshots SET byte_length=?").run(8*1024*1024+1);
    const archive=await import("../research-source-archive");const read=vi.spyOn(archive,"inspectOriginalSourceSnapshot");
    expect((await route()).sourceCapture.archiveProvenanceReason).toBe("metadata_invalid");expect(read).not.toHaveBeenCalled();
    vi.spyOn(archive,"inspectOriginalSourceHistory").mockImplementation(()=>{throw Error("synthetic-unavailable");});
    expect((await route()).sourceCapture.archiveProvenanceReason).toBe("archive_unavailable");
  });
  it.each(["corrupt","missing"] as const)("fresh %s snapshot gates Review preview/apply while Source remains independently writable",async(fault)=>{
    const snap=await capture();
    if(fault==="corrupt")fs.writeFileSync(blob(snap),Buffer.alloc(bytes.length,0x78));else fs.unlinkSync(blob(snap));
    const {prepareCanonicalWriteback,applyCanonicalWriteback}=await import("../mcp/canonical-writeback");
    const actor="oauth:p0-provenance-fixture",p=prepareCanonicalWriteback(input,actor);
    expect(p).toMatchObject({workflowStatus:"hold_archive_provenance",archiveProvenanceStatus:"HOLD",
      archiveProvenanceReason:"selected_snapshot_missing_or_corrupt",readyForNextNews:false});
    expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
    const applied=await applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(x=>({
      operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);
    expect(applied).toMatchObject({status:"hold_archive_provenance",archiveProvenanceStatus:"HOLD",
      archiveProvenanceReason:"selected_snapshot_missing_or_corrupt",readyForNextNews:false});
    expect(applied.receipts).toHaveLength(1);
    expect(applied.steps.map(x=>x.state)).toEqual(["verified_existing","hold_archive_provenance"]);
    expect(fs.existsSync(path.join(vault,applied.steps[1].path))).toBe(false);
    const repeat=prepareCanonicalWriteback(input,actor);expect(repeat.previews).toHaveLength(0);
  });
  it("preserves a Review saved before archive capture and reports subsequent capture as archive drift",async()=>{
    await applyRecipe(await route());const saved=await historicalState();await capture();
    const {prepareCanonicalWriteback,applyCanonicalWriteback}=await import("../mcp/canonical-writeback");
    const actor="oauth:p0-provenance-fixture",p=prepareCanonicalWriteback(input,actor);
    expect(p).toMatchObject({workflowStatus:"hold_archive_drift",archiveProvenanceStatus:"ARCHIVED_BYTES_INTACT",readyForNextNews:false});
    expect(p.previews).toHaveLength(0);
    expect(p.steps.map(x=>x.state)).toEqual(["verified_existing","hold_archive_drift"]);
    const result=await applyCanonicalWriteback({input,planId:p.planId,authorizations:[]},actor);
    expect(result.status).toBe("hold_archive_drift");expect(result.receipts).toHaveLength(0);
    expect(await historicalState()).toEqual(saved);
  });
  it("revalidates after async sync pause and retains only the safe Source when archive turns corrupt",async()=>{
    const snap=await capture();const {prepareCanonicalWriteback,applyCanonicalWriteback}=await import("../mcp/canonical-writeback");
    const actor="oauth:p0-provenance-fixture",p=prepareCanonicalWriteback(input,actor);
    const sync=await import("../safe-edit/sync");
    vi.spyOn(sync,"withPausedSync").mockImplementationOnce(async run=>{
      fs.writeFileSync(blob(snap),Buffer.alloc(bytes.length,0x78));return run();
    });
    const result=await applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(x=>({
      operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);
    expect(result.status).toBe("hold_archive_provenance");expect(result.receipts).toHaveLength(1);
    expect(result.interrupted).toBe("Canonical state or archive provenance changed; prepare again");
    expect(result.steps.map(x=>x.state)).toEqual(["verified_existing","hold_archive_provenance"]);
    expect(fs.existsSync(path.join(vault,result.steps[1].path))).toBe(false);
  });
  it("keeps archive HOLD visible under strict typed-review enforcement and Source-only capture",async()=>{
    const snap=await capture();fs.unlinkSync(blob(snap));
    const {prepareCanonicalWriteback}=await import("../mcp/canonical-writeback");
    process.env.M55_REQUIRE_TYPED_REVIEW="1";
    try{
      const p=prepareCanonicalWriteback({...input,researchReview:undefined,completedAnalysis:"Synthetic legacy analysis."},"oauth:p0-provenance-fixture");
      expect(p.workflowStatus).toBe("hold_archive_provenance");
      expect(p.qualityIssues).toContain("typed_research_review_required");
      expect(p.previews.map(x=>x.kind)).toEqual(["source_intake"]);
    }finally{delete process.env.M55_REQUIRE_TYPED_REVIEW;}
    const sourceOnly={...input,researchReview:undefined,captureOnly:true};
    expect(await applyRecipe(await route(sourceOnly))).toHaveLength(1);
    const after=await route(sourceOnly);
    expect(after.safeEditWorkflow!.status).toBe("source_saved_analysis_pending");
    expect(after.safeEditWorkflow!.archiveProvenanceStatus).toBe("HOLD");
    expect(after.safeEditWorkflow!.readyForNextNews).toBe(false);
  });
  it.each(["response_etag","response_last_modified","captured_at","retrieved_from","original_source"] as const)(
    "%s-only metadata/binding drift preserves historical bytes and receipts",async(column)=>{
    await capture();const p=await route();await applyRecipe(p);const saved=await historicalState();
    const values={response_etag:'"revised-header"',response_last_modified:"Later untrusted hint",
      captured_at:"2026-10-30T00:30:00Z",retrieved_from:"https://example.org/revised",original_source:"https://example.org/other"};
    const {db}=await import("../db");db().prepare(`UPDATE source_snapshots SET ${column}=?`).run(values[column]);
    const after=await route();expect(after.safeEditWorkflow!.status).toBe("hold_archive_drift");
    expect(after.safeEditWorkflow!.readyForNextNews).toBe(false);
    expect(await applyRecipe(after)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
  it.each(["changed_note","changed_analysis","missing_receipt","incomplete_receipt"] as const)(
    "does not disguise %s as archive drift",async(fault)=>{
    await capture();const p=await route();await applyRecipe(p);const reviewStep=p.safeEditWorkflow!.steps[1];
    const {db}=await import("../db");
    if(fault==="changed_note")await seed(reviewStep.path,fs.readFileSync(path.join(vault,reviewStep.path),"utf8")+"\nExternal edit.\n");
    if(fault==="missing_receipt")db().prepare("UPDATE safe_edit_operations SET receipt=NULL WHERE id=?").run(reviewStep.receiptKey);
    if(fault==="incomplete_receipt")db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.reindex','unverified') WHERE id=?").run(reviewStep.receiptKey);
    await capture({bytes:Buffer.from("<html>Changed archive should not hide a different blocker.</html>")});
    const saved=await historicalState();
    const after=await route(fault==="changed_analysis"?{...input,researchReview:{...review,whatChangedTh:"ข้อมูลการวิเคราะห์ใหม่ที่ยังไม่ได้อนุมัติ"}}:input);
    expect(after.safeEditWorkflow!.steps[1].state).toBe("hold_conflict");
    expect(await applyRecipe(after)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
  it("index/link repair still takes precedence over archive drift",async()=>{
    await capture();const p=await route();await applyRecipe(p);
    const {db}=await import("../db");db().prepare("DELETE FROM links WHERE source_path=? AND resolved_path=?")
      .run(p.safeEditWorkflow!.steps[1].path,p.safeEditWorkflow!.steps[0].path);
    await capture({bytes:Buffer.from("<html>A new revision, with existing link repair still required.</html>")});
    const after=await route();expect(after.safeEditWorkflow!.steps[1].state).toBe("hold_index_repair");
    expect(after.safeEditWorkflow!.status).toBe("hold_conflict_or_index");
  });
  it("does not mistake an unchanged analysis quotation for a second provenance section",async()=>{
    const quoted={...input,researchReview:{...review,whatChangedTh:review.whatChangedTh+
      "\n- Original publication/source authentication: not verified by this workflow\n"}};
    await capture();await applyRecipe(await route(quoted));const saved=await historicalState();
    await capture({bytes:Buffer.from("<html>New archive revision with unchanged quoted analysis.</html>")});
    const after=await route(quoted);expect(after.safeEditWorkflow!.status).toBe("hold_archive_drift");
    expect(await historicalState()).toEqual(saved);
  });
  it("metadata is absent from vault:read model text and creates no indexed tags/links/frontmatter or Markdown constructs",async()=>{
    const ordinary=content(await route(),"canonical_review");
    const poison='#pwn #a/b [[Injected]] ![[Injected]]\n# PwnHeading\n<!--pwn--> %%pwn%% ==pwn== $pwn$\n> [!warning]\n---\ntags: [pwn]\n---\n<script>pwn</script>\n- [ ] pwn ^pwn';
    await capture({responseEtag:poison,responseLastModified:poison,captureMethod:"authorized_manual_upload",
      retrievedFrom:"https://example.org/pwn?hint=%23pwn"});
    const {db}=await import("../db");db().prepare("UPDATE source_snapshots SET content_type=?").run(poison);
    const p=await route(),text=content(p,"canonical_review");
    const {parseNote}=await import("./indexer");const before=parseNote("Review.md",ordinary),after=parseNote("Review.md",text);
    expect(after.tags).toEqual(before.tags);expect(after.headings).toEqual(before.headings);
    expect(after.links).toEqual(before.links);
    expect(after.frontmatter).toEqual(before.frontmatter);expect(after.tasks).toEqual(before.tasks);
    expect(JSON.stringify(p)).not.toContain("pwn");
    for(const field of ["responseEtag","responseLastModified","retrievedFrom","contentType","originalSource","sourceUrl"])
      expect(p.sourceCapture.originalSourceArchive).not.toHaveProperty(field);
    for(const marker of ["responseEtag","responseLastModified","retrievedFrom","%%","==","$pwn$","<!--"])
      expect(JSON.stringify(p)).not.toContain(marker);
    await applyRecipe(p);const reviewPath=p.safeEditWorkflow!.steps[1].path;
    expect(db().prepare("SELECT tag FROM tags WHERE path=?").all(reviewPath)).toEqual([]);
    const indexed=db().prepare("SELECT target FROM links WHERE source_path=? ORDER BY target").all(reviewPath) as {target:string}[];
    expect(indexed.map(x=>x.target).sort()).toEqual(before.links.slice().sort());
    expect(JSON.parse((db().prepare("SELECT frontmatter FROM notes WHERE path=?").get(reviewPath) as {frontmatter:string}).frontmatter)).toEqual(before.frontmatter);
    const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
    const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
    const {createMcpServer}=await import("../mcp/server");
    const server=createMcpServer({label:"p0-vault-read",read:true,write:false}),client=new Client({name:"p0-read-test",version:"1"});
    const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(a),server.connect(b)]);
    try{
      const result=await client.callTool({name:"plan_investment_writeback",arguments:{...input}});
      expect(result.isError).not.toBe(true);expect(JSON.stringify(result)).not.toContain("pwn");
      expect(JSON.stringify(result)).not.toContain("responseEtag");
    }finally{await Promise.all([client.close(),server.close()]);}
  });
  it.each(["2026-10-22T23:30:00Z","2026-10-23T00:30:00Z","2026-10-24T00:30:00Z"])(
    "does not infer a publication timezone or definite ordering from capture %s",async(capturedAt)=>{
    await capture({capturedAt});const p=await route();
    expect(p.sourceCapture.originalSourceArchive!.chronology.captureRelation).toBe("ORDER_UNKNOWN_TIMEZONE");
    expect(content(p,"canonical_review")).not.toMatch(/BEFORE_PUBLICATION|AFTER_PUBLICATION/);
  });
  it.each(["http://example.org/doc","free text reference","ftp://example.org/doc","https://example.org:8443/doc","https://user:pass@example.org/doc"])(
    "treats ineligible locator %s as not_archivable, not damaged archive",async(sourceUrl)=>{
    const p=await route({...input,sourceUrl});
    expect(p.sourceCapture).toMatchObject({archiveProvenanceStatus:"ABSENT",archiveProvenanceReason:"not_archivable",originalSourceArchive:null});
    expect(p.safeEditWorkflow!.steps[1].state).toBe("needs_create");
  });
  it("shares trim/punctuation/fragment/tracking/query/host/space normalization for identity and archive correlation",async()=>{
    const canonical=sourceUrl+"?a=hello+world&z=2";
    await capture({originalSource:canonical,retrievedFrom:canonical});
    const p=await route({...input,sourceUrl:canonical});await applyRecipe(p);const saved=await historicalState();
    for(const alias of [canonical+"). ","  "+canonical+"  ",sourceUrl.replace("www.sec.gov","WWW.SEC.GOV")+"?z=2&a=hello%20world&utm_source=x#fragment"]){
      const retry=await route({...input,sourceUrl:alias});expect(retry.planId).toBe(p.planId);
      expect(retry.sourceCapture.originalSourceArchive).toEqual(p.sourceCapture.originalSourceArchive);
      expect(retry.safeEditWorkflow!.status).toBe("saved_verified");
    }
    const {canonicalSourceUrl}=await import("../source-url");
    expect(canonicalSourceUrl("https://example.org/a%20b")).not.toBe(canonicalSourceUrl("https://example.org/a+b"));
    expect(canonicalSourceUrl("https://example.org/?q=a%2Bb")).not.toBe(canonicalSourceUrl("https://example.org/?q=a+b"));
    expect(await historicalState()).toEqual(saved);
  });
  it("holds a legacy noncanonical archive key for review instead of silently reporting no archive",async()=>{
    const snap=await capture();const {db}=await import("../db");
    db().prepare("UPDATE source_snapshots SET source_key=? WHERE snapshot_id=?").run(sourceUrl+").",snap.snapshotId);
    const p=await route();expect(p.sourceCapture.archiveProvenanceReason).toBe("legacy_url_binding");
    expect(p.safeEditWorkflow!.steps[1].state).toBe("hold_archive_provenance");
  });
  it("checks selected bytes only: older non-selected blob corruption is outside this witness",async()=>{
    const old=await capture();const selected=await capture({bytes:Buffer.from("<html>The selected current archive revision is independently intact.</html>")});
    await applyRecipe(await route());const saved=await historicalState();fs.writeFileSync(blob(old),Buffer.alloc(bytes.length,0x78));
    const p=await route();expect(p.sourceCapture.originalSourceArchive).toMatchObject({snapshotId:selected.snapshotId,
      integrityScope:"SELECTED_SNAPSHOT_ONLY",olderSnapshotsByteChecked:false});
    expect(p.safeEditWorkflow!.status).toBe("saved_verified");expect(await historicalState()).toEqual(saved);
  });
  it("recognizes an unchanged receipted v1 Review without replaying it or returning its raw metadata",async()=>{
    const snap=await capture();const p=await route();
    // Recorded format of candidate 83396f4; deliberately retains the old
    // chronology text as historical bytes, not as a current ordering claim.
    const legacy=[
      `- Original-byte archive: ARCHIVED_BYTES_INTACT; snapshot ${snap.snapshotId}; SHA-256 ${snap.sha256}; ${snap.byteLength} bytes`,
      `- Archive URL: "${sourceUrl}"; retrieved from "${sourceUrl}"; intake URL "${sourceUrl}"`,
      '- Archive sequence revision: 1; captured "2026-10-24T01:00:00Z"; content type "text/html"; changed bytes observed: no',
      '- Publisher revision hints (unverified): ETag "\\"v1\\""; Last-Modified "Fri, 23 Oct 2026 12:00:00 GMT"',
      '- Archive chronology: event "2026-10-22"; publication "2026-10-23"; capture relation AFTER_PUBLICATION_DAY',
      '- Archive association: URL correlation only, not proof that the transcription matches these bytes. Archive sequence/capture time does not establish the original event version or publisher revision.',
      '- Archive limitation: publisher authenticity/signature and claim truth are NOT verified by the byte archive; claim-level primary receipts remain required. No Review verification or evidence independence is added.'
    ].join("\n");
    const {sourceArchiveReviewLines}=await import("./source-archive-provenance-p0");
    const step=p.safeEditWorkflow!.steps[1],request=step.safeEditRequest!;
    request.change.content=request.change.content.replace(sourceArchiveReviewLines(p.sourceCapture.originalSourceArchive).join("\n"),legacy);
    const digest=createHash("sha256").update(request.change.content).digest("hex");
    request.operationId="ICW-"+createHash("sha256").update(["canonical_review",step.path,digest].join("\n")).digest("hex").slice(0,32);
    await applyRecipe(p);const saved=await historicalState();const again=await route();
    expect(again.safeEditWorkflow!.status).toBe("saved_verified");
    expect(again.safeEditWorkflow!.steps[1].receiptKey).toBe(request.operationId);
    expect(again.sourceCapture.originalSourceArchive!.chronology.captureRelation).toBe("ORDER_UNKNOWN_TIMEZONE");
    expect(JSON.stringify(again)).not.toContain("AFTER_PUBLICATION_DAY");
    expect(await applyRecipe(again)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
});

import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput,WritebackPlan} from "./investment-writeback-router";
import type {DocumentArchiveInput,DocumentSnapshot} from "../research-source-archive";

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
    expect(p.sourceCapture.originalSourceArchive).toMatchObject({snapshotId:snap.snapshotId,sourceUrl,
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
    expect(p.safeEditWorkflow!.steps.map(s=>s.state)).toEqual(["verified_existing","hold_conflict"]);
    expect(await applyRecipe(p)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
  it("same URL and same bytes retry retains the original capture/receipt binding",async()=>{
    const first=await capture();const p=await route();await applyRecipe(p);const saved=await historicalState();
    const repeated=await capture({capturedAt:"2026-10-28T12:00:00Z",responseEtag:'"new-header-same-bytes"'});
    expect(repeated).toEqual(first);
    const retry=await route();expect(retry.sourceCapture.originalSourceArchive).toEqual(p.sourceCapture.originalSourceArchive);
    expect(retry.safeEditWorkflow!.status).toBe("saved_verified");expect(await historicalState()).toEqual(saved);
  });
  it("same URL with changed bytes/new capture exposes revision chronology and HOLDs rather than rewriting the old Review",async()=>{
    const first=await capture();const initial=await route();await applyRecipe(initial);const saved=await historicalState();
    const second=await capture({bytes:Buffer.from("<html>Publisher revised the document after the original event.</html>"),
      capturedAt:"2026-10-29T12:00:00Z",responseEtag:'"publisher-v2"',responseLastModified:"Wed, 28 Oct 2026 12:00:00 GMT"});
    const p=await route();expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(p.planId).toBe(initial.planId);
    expect(p.sourceCapture.originalSourceArchive).toMatchObject({snapshotId:second.snapshotId,revision:2,
      responseEtag:'"publisher-v2"',responseLastModified:"Wed, 28 Oct 2026 12:00:00 GMT",changesObserved:true,
      selection:"HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION",association:"URL_ONLY_NOT_TRANSCRIPTION_OR_EVENT_PROOF",
      chronology:{eventDate:input.eventDate,publicationDate:input.publicationDate,captureRelation:"AFTER_PUBLICATION_DAY",originalEventVersionVerified:false}});
    expect(p.safeEditWorkflow!.status).toBe("hold_conflict_or_index");
    expect(await applyRecipe(p)).toHaveLength(0);expect(await historicalState()).toEqual(saved);
  });
  it("archive sequence does not claim capture order or silently fall back to an older intact snapshot",async()=>{
    await capture();const second=await capture({bytes:Buffer.from("<html>Backfilled snapshot with an earlier capture timestamp.</html>"),capturedAt:"2026-10-22T10:00:00Z"});
    const p=await route();expect(p.sourceCapture.originalSourceArchive).toMatchObject({revision:2,
      capturedAt:second.capturedAt,chronology:{captureRelation:"BEFORE_PUBLICATION_DAY",originalEventVersionVerified:false}});
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
});

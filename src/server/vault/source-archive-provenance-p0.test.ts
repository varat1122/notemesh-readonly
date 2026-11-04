import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"p0-archive-link-")));
  vault=path.join(root,"vault");
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Company Research"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,9).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";
  process.env.SAFE_EDIT_SINGLE_WRITER="1";
  vi.resetModules();
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});
async function seed(rel:string,body:string){
  const abs=path.join(vault,rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(rel);
}
describe("P0 canonical Review original-source archive provenance",()=>{
  it("links intact archive evidence into Review without promoting Source verification",async()=>{
    await seed("01_Companies/MU.md","# MU\n");
    const sourceUrl="https://www.sec.gov/Archives/edgar/data/723125/000072312526000099/mu-q3-test.htm";
    const {captureOriginalDocumentBytes}=await import("../research-source-archive");
    const snap=captureOriginalDocumentBytes({
      originalSource:sourceUrl,
      bytes:Buffer.from("<html><body>Synthetic original document bytes for provenance test.</body></html>"),
      contentType:"text/html",
      capturedAt:"2026-11-05T00:00:00Z",
      captureMethod:"authorized_external_download",
      retrievedFrom:sourceUrl,
      reviewerOrOperator:"p0-provenance-test"
    });
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const p=planInvestmentWriteback({
      domain:"company",entities:["MU"],topic:"MU source archive provenance",
      inputFormat:"text",sourceKind:"regulatory_filing",
      extractedText:"Synthetic transcription used only for canonical provenance testing.",
      sourceChat:"P0 provenance fixture",completedAnalysis:"No investment conclusion; provenance test only.",
      sourceUrl,publisher:"issuer filing",eventDate:"2026-11-05",publicationDate:"2026-11-05",
      entityRoles:[{entity:"MU",role:"primary_subject"}],contentTypes:["reported_fact"]
    });
    expect(p.sourceCapture.originalSourceArchive).toMatchObject({
      snapshotId:snap.snapshotId,sha256:snap.sha256,revision:1,
      archiveStatus:"intact_stored_bytes",publisherAuthenticityVerified:false,
      originalDocumentSignatureVerified:false
    });
    const source=p.safeEditWorkflow?.steps[0].safeEditRequest?.change.content??"";
    const review=p.safeEditWorkflow?.steps[1].safeEditRequest?.change.content??"";
    expect(source).toContain("source_type: user_supplied");
    expect(source).toContain("verification: not_reverified");
    expect(review).toContain(snap.snapshotId);
    expect(review).toContain(snap.sha256);
    expect(review).toContain("publisher authenticity/signature and claim truth are NOT verified");
  });
});

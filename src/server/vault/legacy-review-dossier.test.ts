import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const old="10_Knowledge/Company Research/ASML - Historic Earnings.md";
const rawSource="07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0007.md";
const hub="01_Companies/ASML.md";
const fm=[
  "---","type: knowledge_note","company: ['ASML']","date: '2026-07-16'",
  "source_type: chatgpt_history","verification: not_reverified",
  "event_date: Unknown","source_records:","  - "+rawSource,"---",
].join("\n");
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-review-dossier-")));
  vault=path.join(root,"vault");
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,5).toString("base64");
  vi.resetModules();
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
function put(p:string,head:string,body:string){
  const abs=path.join(vault,p);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,head+"\n"+body);
}
const bytes=(p:string)=>fs.readFileSync(path.join(vault,p));
async function rebuild(){
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
}
describe("read-only exact-source historical P1/P2/P3 dossier",()=>{
  it("returns real source hash, declared provenance, source-link and chronology warnings without changing bytes",async()=>{
    put(old,fm,"# ASML historical note\nOriginal financial claim is not reverified.");
    put(rawSource,"---\ntype: chatgpt_archive\n---","# Original chat excerpt");
    put(hub,"---\ntype: company_hub\n---","# ASML hub");
    await rebuild();
    const originals=[old,rawSource,hub].map(bytes);
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    const dossier=getLegacyReviewDossier(old);
    expect(dossier).toMatchObject({
      status:"read_only_review_dossier_not_a_verification",
      sourcePath:old,indexedNotesConsidered:3,
      source:{
        sha256:createHash("sha256").update(originals[0]).digest("hex"),
        byteLength:originals[0].length,
        verificationInterpreted:false,
      },
      priorityCounts:{
        P1_provenance_or_chronology:1,P2_attribution_or_scope:1,
        P3_navigation_only:1,
      },
      canAutoWrite:false,canAutoUpdateThesis:false,
      sourcePublisherAuthenticated:false,originalSourceBytesIndependentlyVerified:false,
    });
    expect(dossier.source.declaredMetadata.verification).toBe("not_reverified");
    expect(dossier.findings.map(x=>x.kind)).toEqual([
      "explicit_event_date_needs_review",
      "declared_source_path_without_resolved_link",
      "legacy_company_hub_navigation_candidate",
    ]);
    expect(dossier.targetChecks).toContainEqual({
      targetPath:rawSource,status:"indexed_current_bytes_read",
      sha256:createHash("sha256").update(originals[1]).digest("hex"),
      independentOriginalVerified:false,
    });
    expect([old,rawSource,hub].map(bytes)).toEqual(originals);
  });
  it("refuses a stale source even if old indexed frontmatter still matches",async()=>{
    put(old,fm,"# Original note\n");
    await rebuild();
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    fs.appendFileSync(path.join(vault,old),"Added without re-indexing.");
    expect(()=>getLegacyReviewDossier(old)).toThrow("legacy_dossier_stale_index_hold");
  });
  it("requires completed indexing and an exact indexed existing path",async()=>{
    put(old,fm,"# An old note");
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    expect(()=>getLegacyReviewDossier(old)).toThrow("legacy_dossier_index_not_ready");
    await rebuild();
    expect(()=>getLegacyReviewDossier("10_Knowledge/Company Research/Other.md"))
      .toThrow("legacy_dossier_source_not_indexed");
  });
  it("rejects protected or unsafe paths regardless of frontmatter role",async()=>{
    put(old,fm,"# Old");
    await rebuild();
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    for(const path of ["05_Thesis/ASML - Current Thesis.md",
      "06_Portfolio/ASML.md","07_Sources/ChatGPT/ASML.md",
      "09_Templates/Note.md"]){
      expect(()=>getLegacyReviewDossier(path)).toThrow("legacy_dossier_invalid_source_path");
    }
    expect(()=>getLegacyReviewDossier("../secret.md")).toThrow();
  });
  it("requires eligible source role and never returns source/archive as an edit target",async()=>{
    put(hub,"---\ntype: company_hub\n---","# ASML");
    await rebuild();
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    expect(()=>getLegacyReviewDossier(hub)).toThrow("legacy_dossier_not_historical_or_review");
  });
  it("returns empty findings for already fully connected historical notes",async()=>{
    put(old,fm.replace("event_date: Unknown","event_date: '2026-07-16'"),
      "# Old\n[[01_Companies/ASML]]\n[[07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0007]]");
    put(rawSource,"---\ntype: chatgpt_archive\n---","# Original");
    put(hub,"---\ntype: company_hub\n---","# Hub");
    await rebuild();
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    const res=getLegacyReviewDossier(old);
    expect(res.findings).toEqual([]);
    expect(res.priorityCounts).toEqual({
      P1_provenance_or_chronology:0,P2_attribution_or_scope:0,P3_navigation_only:0,
    });
    expect(res.indexedOutgoingLinks.count).toBe(2);
    expect(res.indexedOutgoingLinks.truncated).toBe(false);
  });
  it("flags absent source locator in markdown index without claiming real source deleted",async()=>{
    put(old,fm,"# Dated historical note");
    put(hub,"---\ntype: company_hub\n---","# Hub");
    await rebuild();
    const {getLegacyReviewDossier}=await import("./legacy-review-dossier");
    const res=getLegacyReviewDossier(old);
    expect(res.findings.map(x=>x.kind)).toContain("declared_source_path_not_indexed");
    expect(res.targetChecks).toContainEqual({
      targetPath:rawSource,status:"not_in_markdown_index",
      sha256:null,independentOriginalVerified:false,
    });
    expect(res.originalSourceBytesIndependentlyVerified).toBe(false);
  });
});

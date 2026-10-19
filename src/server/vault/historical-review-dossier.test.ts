import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const history="10_Knowledge/Company Research/ASML - Historical Memo.md";
const original="07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0007.md";
const hub="01_Companies/ASML.md";
const metadata=(extra:string[]=[])=>[
  "---","type: knowledge_note","source_type: chatgpt_history",
  "verification: not_reverified","company: ['ASML']","date: '2026-07-16'",
  ...extra,"---",
].join("\n");
function add(rel:string,front:string,body="# Note") {
  const abs=path.join(vault,rel);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,front+"\n"+body,"utf8");
}
async function rebuild(){
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
}
const read=(p:string)=>fs.readFileSync(path.join(vault,p));
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"historical-dossier-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
describe("full-index one-note read-only historical review dossier",()=>{
  it("reports provenance/chronology before navigation with current source and target hashes",async()=>{
    add(history,metadata(["event_date: Unknown","source_records:","  - "+original]),
      "# Research\nHistorical analyst view, unverified.");
    add(original,["---","type: chatgpt_archive","---"].join("\n"),
      "# Source\nUnverified historical user input.");
    add(hub,["---","type: company_hub","---"].join("\n"),"# Hub");
    await rebuild();
    const orig=[history,original,hub].map(read).map(b=>b.toString("hex"));
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    const result=inspectHistoricalReviewDossier(history);
    expect(result).toMatchObject({
      status:"read_only_historical_review_dossier",fullIndexRows:3,
      declaredVerification:"not_reverified",
      normalizedSourceType:"archived_ai",
      independenceAssessment:"not_independent_archived_ai",
      declaredEventDate:null,declaredLegacyDate:"2026-07-16",
      originalSourceVerifiedThisCall:false,canAutoWrite:false,canAutoUpdateThesis:false,
      vaultModified:false,
    });
    expect(result.source.sha256).toBe(createHash("sha256").update(read(history)).digest("hex"));
    expect(result.findings.map(f=>f.kind)).toEqual([
      "explicit_event_date_needs_review",
      "declared_source_path_without_resolved_link",
      "legacy_company_hub_navigation_candidate",
    ]);
    expect(result.findings[1].targetObservation).toMatchObject({
      path:original,indexed:true,status:"indexed_target_observed",
      sha256:createHash("sha256").update(read(original)).digest("hex"),
    });
    expect(result.findings[2].targetObservation).toMatchObject({
      path:hub,indexed:true,status:"indexed_target_observed",
    });
    expect([history,original,hub].map(read).map(b=>b.toString("hex"))).toEqual(orig);
  });
  it("distinguishes non-indexed declared archive pointer from proven source deletion",async()=>{
    add(history,metadata(["source_records:","  - "+original]),"# History");
    add(hub,["---","type: company_hub","---"].join("\n"),"# Hub");
    await rebuild();
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    const report=inspectHistoricalReviewDossier(history);
    expect(report.findings[0]).toMatchObject({
      kind:"declared_source_path_not_indexed",
      targetObservation:{path:original,indexed:false,status:"not_indexed_disk_not_assessed"},
    });
    expect(report.reviewNotes.join(" ")).toContain("does not mean source bytes are lost");
  });
  it("produces no false needs-review when both links already resolve",async()=>{
    add(original,["---","type: chatgpt_archive","---"].join("\n"),"# Source");
    add(hub,["---","type: company_hub","---"].join("\n"),"# Hub");
    add(history,metadata(["source_records:","  - "+original]),
      "# History\n[[01_Companies/ASML]]\n[[07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0007]]");
    await rebuild();
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    const result=inspectHistoricalReviewDossier(history);
    expect(result.findings).toEqual([]);
    expect(result.source.indexedVersionMatchesObservedFile).toBe(true);
    expect(result.vaultModified).toBe(false);
  });
  it("fails closed when indexed source content or metadata changed since rebuilding",async()=>{
    add(history,metadata(),"# Content");
    add(hub,["---","type: company_hub","---"].join("\n"),"# Hub");
    await rebuild();
    fs.appendFileSync(path.join(vault,history),"\nNew unsynced text");
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    expect(()=>inspectHistoricalReviewDossier(history))
      .toThrow("review_dossier_source_index_stale_rebuild_required");
  });
  it("refuses read before index readiness and refuses an archive or thesis as edit-source review",async()=>{
    add(history,metadata(),"# History");
    add(original,["---","type: chatgpt_archive","---"].join("\n"),"# Source");
    add("05_Thesis/ASML - Current Thesis.md",[
      "---","type: current_thesis","entity: ASML","---",
    ].join("\n"),"# Unendorsed thesis");
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    expect(()=>inspectHistoricalReviewDossier(history))
      .toThrow("review_dossier_index_not_ready");
    await rebuild();
    expect(()=>inspectHistoricalReviewDossier(original))
      .toThrow("review_dossier_source_not_eligible");
    expect(()=>inspectHistoricalReviewDossier("05_Thesis/ASML - Current Thesis.md"))
      .toThrow("review_dossier_source_not_eligible");
    expect(()=>inspectHistoricalReviewDossier("../outside.md"))
      .toThrow("review_dossier_invalid_path");
  });
  it("reports changed/unreadable target without declaring its source truth or writing a replacement",async()=>{
    add(history,metadata(["source_records:","  - "+original]),"# History");
    add(original,["---","type: chatgpt_archive","---"].join("\n"),"# Source");
    await rebuild();
    fs.appendFileSync(path.join(vault,original),"\nPost-index update");
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    const result=inspectHistoricalReviewDossier(history);
    expect(result.findings[0].targetObservation).toMatchObject({
      status:"indexed_target_changed_or_stale",indexed:true,metadataMatchesIndex:false,
    });
    expect(result.canAutoWrite).toBe(false);
    fs.unlinkSync(path.join(vault,original));
    const second=inspectHistoricalReviewDossier(history);
    expect(second.findings[0].targetObservation).toMatchObject({
      status:"indexed_target_unreadable_manual_review",indexed:true,sha256:null,
    });
  });
  it("accepts exact selected source outside first global summary samples",async()=>{
    add(hub,["---","type: company_hub","---"].join("\n"),"# Hub");
    const sourcePaths=Array.from({length:12},(_,i)=>
      `10_Knowledge/Company Research/ASML - Old ${String(i).padStart(2,"0")}.md`);
    for(const src of sourcePaths)add(src,metadata(),"# Research");
    await rebuild();
    const {inspectHistoricalReviewDossier}=await import("./historical-review-dossier");
    const result=inspectHistoricalReviewDossier(sourcePaths[11]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind:"legacy_company_hub_navigation_candidate",targetPath:hub,
    });
  });
});

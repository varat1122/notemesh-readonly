import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const note="10_Knowledge/Company Research/ASML - Historical Review.md";
const source="07_Sources/ChatGPT/Archive/ASML chat.md";
const hub="01_Companies/ASML.md";
const fm=[
  "---","type: knowledge_note","company: ['ASML']",
  "verification: not_reverified","event_date: Unknown",
  "source_records:","  - "+source,"---",
].join("\n");
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-human-review-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,9).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
const put=(p:string,contents:string)=>{
  const f=path.join(vault,p);fs.mkdirSync(path.dirname(f),{recursive:true});
  fs.writeFileSync(f,contents);
};
async function ready(){
  const {indexer}=await import("./indexer");await indexer().rebuild();
}
describe("human-facing review decision worksheet: read-only and unapproved",()=>{
  it("keeps open findings unresolved even when caller chooses no_change_needed",async()=>{
    put(note,fm+"\n# ASML historical claim\nUnverified content");
    put(source,"---\ntype: chatgpt_archive\n---\nUnverified original chat");
    put(hub,"---\ntype: company_hub\n---\n# ASML");
    await ready();
    const before=[note,source,hub].map(p=>fs.readFileSync(path.join(vault,p)));
    const {prepareLegacyReviewDecision}=await import("./legacy-review-decision");
    const plan=prepareLegacyReviewDecision(note,"no_change_needed","Needs follow-up");
    expect(plan).toMatchObject({
      status:"draft_review_decision_no_write",exactNotePath:note,
      callerSuppliedDisposition:"no_change_needed",
      reviewerAuthenticated:false,ownerApprovalGranted:false,
      evidenceVerificationPerformed:false,
      readiness:"requires_manual_evidence_review",
      canAutoWrite:false,canAutoUpdateThesis:false,
      safeEditPreview:null,
      proposedChangeLog:{
        state:"draft_unapproved_not_saved",
        primarySourceVerification:"not_performed",
        effectOnCurrentThesis:"unassessed",
      },
    });
    expect(plan.holdReason).toContain("Open P1/P2/P3");
    expect(plan.currentNoteSha256)
      .toBe(createHash("sha256").update(before[0]).digest("hex"));
    expect(plan.reviewFindings.map(f=>f.kind)).toContain("explicit_event_date_needs_review");
    expect(plan.sourcePointers.some(f=>f.status==="indexed_current_bytes_read")).toBe(true);
    expect([note,source,hub].map(p=>fs.readFileSync(path.join(vault,p)))).toEqual(before);
  });
  it("does not offer Safe Edit even for a plausible navigation candidate",async()=>{
    put(note,fm.replace("event_date: Unknown","event_date: '2026-07-16'")+"\n# ASML");
    put(source,"---\ntype: chatgpt_archive\n---\n# Archive");
    put(hub,"---\ntype: company_hub\n---\n# ASML");
    await ready();
    const {prepareLegacyReviewDecision}=await import("./legacy-review-decision");
    const plan=prepareLegacyReviewDecision(note,"navigation_link_candidate");
    expect(plan.proposedTargetPaths).toContain(hub);
    expect(plan.proposedTargetPaths).toContain(source);
    expect(plan.readiness).toBe("candidate_for_independent_human_review");
    expect(plan.safeEditPreview).toBeNull();
    expect(plan.ownerApprovalGranted).toBe(false);
    expect(plan.existingLinks.count).toBe(0);
  });
  it("holds unsupported metadata/navigation proposals instead of inventing changes",async()=>{
    put(note,["---","type: knowledge_note","company: ['ASML']",
      "event_date: '2026-07-16'","---","# Historical",
      "[[01_Companies/ASML]]"].join("\n"));
    put(hub,"---\ntype: company_hub\n---\n# ASML");
    await ready();
    const {prepareLegacyReviewDecision}=await import("./legacy-review-decision");
    for(const decision of ["metadata_correction_candidate","navigation_link_candidate"] as const){
      const result=prepareLegacyReviewDecision(note,decision);
      expect(result.readiness).toBe("requires_manual_evidence_review");
      expect(result.proposedTargetPaths).toEqual([]);
      expect(result.safeEditPreview).toBeNull();
    }
  });
  it("does not accept absent original as proven missing or historical AI as primary proof",async()=>{
    put(note,fm+"\n# Historical");await ready();
    const {prepareLegacyReviewDecision}=await import("./legacy-review-decision");
    const plan=prepareLegacyReviewDecision(note,"missing_evidence");
    expect(plan.holdReason).toContain("Markdown index");
    expect(plan.sourcePointers).toContainEqual({
      targetPath:source,status:"not_in_markdown_index",sha256:null,
      independentOriginalVerified:false,
    });
    expect(plan.evidenceVerificationPerformed).toBe(false);
  });
  it("treats suspected duplicate claims as unverified regardless of caller rationale",async()=>{
    put(note,fm+"\n# Financial claim");await ready();
    const {prepareLegacyReviewDecision}=await import("./legacy-review-decision");
    const plan=prepareLegacyReviewDecision(note,"duplicate_or_conflicting_evidence",
      "Same earnings claim seen in another note");
    expect(plan.readiness).toBe("requires_manual_evidence_review");
    expect(plan.holdReason).toContain("No claim-level pair");
    expect(plan.requiredEvidence).toContain("Both underlying claim/source versions");
    expect(plan.proposedChangeLog.state).toBe("draft_unapproved_not_saved");
  });
  it("inherits fail-closed dossier path/index/staleness safeguards",async()=>{
    put(note,fm+"\n# Historical");
    const {prepareLegacyReviewDecision}=await import("./legacy-review-decision");
    expect(()=>prepareLegacyReviewDecision(note,"unresolved"))
      .toThrow("legacy_dossier_index_not_ready");
    await ready();
    expect(()=>prepareLegacyReviewDecision("05_Thesis/ASML.md","unresolved"))
      .toThrow("legacy_dossier_invalid_source_path");
    expect(()=>prepareLegacyReviewDecision(note,"unresolved","x".repeat(601)))
      .toThrow("legacy_review_invalid_rationale");
    fs.appendFileSync(path.join(vault,note),"Stale since index");
    expect(()=>prepareLegacyReviewDecision(note,"unresolved"))
      .toThrow("legacy_dossier_stale_index_hold");
  });
});

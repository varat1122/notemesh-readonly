import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {prepareOfflineInvestmentIntelligenceBrief}
  from "./offline-investment-intelligence-brief";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";

const sha=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");
const ticker="SYNTH";
const oldPath="10_Knowledge/SYNTH - Historical Earnings.md";
const narrativePath="10_Knowledge/SYNTH - Delivery Note.md";
const thesisPath="05_Thesis/SYNTH - Current Thesis.md";
const secret="PRIVATE THESIS ONLY: Fictional base-case owner draft; do not export.";
const oldValue="100";
let live:string,snapshot:string,vault:string;
const historical=(v=oldValue)=>[
  "---",
  "type: research_note",
  "entity: SYNTH",
  "source_type: primary",
  "verification: not_reverified",
  "original_source: https://example.org/synth-quarterly",
  "original_source_sha256: '"+("a".repeat(64))+"'",
  "event_key: SYNTH-2026Q3",
  "event_date: '2026-09-25'",
  "published_at: '2026-09-26T10:00:00Z'",
  "imported_at: '2026-09-27T10:00:00Z'",
  "claims:",
  "  - claim_id: synth-rev-q3",
  "    entity: SYNTH",
  "    metric: revenue",
  "    period: 2026Q3",
  "    unit: USD millions",
  "    value: '"+v+"'",
  "---",
  "# Historical Research",
  "SYNTH revenue and delivery were discussed in this fictional example.",
  "",
].join("\n");
const prose=()=>[
  "---",
  "type: research_note",
  "entity: SYNTH",
  "source_type: archived_ai",
  "verification: not_reverified",
  "original_source: https://example.org/synth-quarterly",
  "original_source_sha256: '"+("a".repeat(64))+"'",
  "event_key: SYNTH-2026Q3",
  "event_date: '2026-09-25'",
  "imported_at: '2026-10-01T10:00:00Z'",
  "---",
  "# Old ChatGPT Summary",
  "Prior AI said SYNTH capacity delivery might matter, not verified.",
  "",
].join("\n");
const thesis=()=>[
  "---","type: current_thesis","entity: SYNTH","status: draft",
  "updated: '2026-09-28'","---",
  "# SYNTH - Current Thesis",secret,"",
].join("\n");
const put=(rel:string,bytes:string)=>{
  const file=path.join(vault,rel);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,bytes);
};
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-brief-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-brief-offline-")));
  vault=path.join(live,"vault");fs.mkdirSync(vault);
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const d of [live,snapshot])fs.rmSync(d,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function buildFixture(){
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{
    recursive:true,preserveTimestamps:true,
  });
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  const coverage=verifyOfflineSnapshotCoverage(snapshot);
  if(coverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("brief_fixture_coverage_failed");
  return coverage.markdownContentManifestSha256;
}
function request(manifest:string,other:Record<string,unknown>={}){
  return {
    snapshotRoot:snapshot,
    expectedMarkdownManifestSha256:manifest,
    incoming:{
      entity:ticker,metric:"revenue",period:"2026Q3",unit:"USD millions",
      value:"120",eventKey:"SYNTH-2026Q3",
      originalSourceSha256:"a".repeat(64),
      sourceUrl:"https://example.org/synth-quarterly",
      sourceType:"user_supplied",eventDate:"2026-09-25",
      publishedAt:"2026-09-26T10:00:00Z",
    },
    keywords:["revenue","delivery"],
    thesis:{path:thesisPath,expectedSha256:sha(thesis())},
    ...other,
  };
}
describe("PR #86: offline evidence pack for later human/AI thesis analysis",()=>{
  it("joins conflict + real note-line citations + exact Thesis version without exposing content",async()=>{
    put(oldPath,historical());put(narrativePath,prose());
    put(thesisPath,thesis());
    const manifest=await buildFixture();
    const result=prepareOfflineInvestmentIntelligenceBrief(request(manifest));
    expect(result).toMatchObject({
      status:"offline_analyst_intelligence_packet_not_semantic_verdict",
      structuredClassification:"possible_correction_or_contradiction",
      reviewPriority:"priority_conflicting_claim_needs_source_review",
      semanticComparisonPerformed:false,
      currentThesisSemanticallyCompared:false,
      originalIssuerClaimVerified:false,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,safeEditPreview:null,
      vaultModified:false,
    });
    expect(result.oldStructuredEvidenceRefs.some(r=>r.path===oldPath)).toBe(true);
    expect(result.oldNarrativeEvidenceRefs.some(r=>r.path===narrativePath)).toBe(true);
    expect(result.selectedThesis).toMatchObject({
      status:"exact_thesis_version_present_requires_analyst_read",
      notePath:thesisPath,noteSha256:sha(thesis()),
      declaredStatus:"draft",thesisContentReadForSemanticAnalysis:false,
      thesisVersionAuthenticatedByOwner:false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.analyticalQuestions.some(q=>q.includes("Cash Flow"))).toBe(true);
  });
  it("fails closed for changed or wrong Thesis hash, scope or company path",async()=>{
    put(oldPath,historical());put(thesisPath,thesis());
    const manifest=await buildFixture();
    const wrong=request(manifest,{thesis:{
      path:thesisPath,expectedSha256:"f".repeat(64),
    }});
    expect(()=>prepareOfflineInvestmentIntelligenceBrief(wrong))
      .toThrow("thesis_brief_exact_thesis_bytes_changed_hold");
    const bad=request(manifest,{thesis:{
      path:"05_Thesis/OTHER - Current Thesis.md",expectedSha256:sha(thesis()),
    }});
    expect(()=>prepareOfflineInvestmentIntelligenceBrief(bad))
      .toThrow("thesis_brief_requires_exact_authorized_selection_and_hash");
    expect(()=>prepareOfflineInvestmentIntelligenceBrief(request("0".repeat(64))))
      .toThrow();
  });
  it("does not claim to have read Thesis when none explicitly selected",async()=>{
    put(oldPath,historical());put(thesisPath,thesis());
    const manifest=await buildFixture();
    const p=request(manifest,{thesis:undefined});
    const report=prepareOfflineInvestmentIntelligenceBrief(p);
    expect(report.selectedThesis.status).toBe("not_checked_no_exact_thesis_selected");
    expect(report.currentThesisSemanticallyCompared).toBe(false);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
  it("cannot run on live Vault or Railway",async()=>{
    put(oldPath,historical());put(thesisPath,thesis());
    const manifest=await buildFixture();
    expect(()=>prepareOfflineInvestmentIntelligenceBrief(
      request(manifest,{snapshotRoot:live}))).toThrow();
    process.env.RAILWAY_PROJECT_ID="synthetic-test-hold";
    expect(()=>prepareOfflineInvestmentIntelligenceBrief(request(manifest))).toThrow();
  });
  it("flags metadata duplicate as a candidate only, not approval to skip investment review",async()=>{
    put(oldPath,historical());put(thesisPath,thesis());
    const manifest=await buildFixture();
    const p=request(manifest,{
      incoming:{...request(manifest).incoming,value:"100"},
    });
    const r=prepareOfflineInvestmentIntelligenceBrief(p);
    expect(r.structuredClassification).toBe("duplicate_exact_metadata_same_source");
    expect(r.reviewPriority).toBe("candidate_duplicate_review_before_skipping");
    expect(r.possibleDuplicateDoesNotProveNoNews).toBe(true);
    expect(r.semanticComparisonPerformed).toBe(false);
  });
});

import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {reviewHistoricalChangeOffline} from "./offline-historical-change-review";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";

let live:string,snapshot:string,vault:string;
const oldPath="10_Knowledge/SYNTH - Revenue Q3.md";
const aiPath="07_Sources/ChatGPT/SYNTH - Archived AI.md";
const prosePath="10_Knowledge/SYNTH - Legacy News.md";
const sourceHash="a".repeat(64);
function note(o:{type?:string;sourceType?:string;eventKey?:string;metric?:string;
  value?:string;structured?:boolean}={}){
  return [
    "---","type: "+(o.type??"research_note"),
    "entity: SYNTH",
    "source_type: "+(o.sourceType??"primary"),
    "verification: not_reverified",
    "original_source: https://example.org/synthetic-release",
    "original_source_sha256: '"+sourceHash+"'",
    "event_key: "+(o.eventKey??"SYNTH-2026Q3"),
    "event_date: '2026-09-25'",
    "published_at: '2026-09-26T10:00:00Z'",
    "imported_at: '2026-09-27T10:00:00Z'",
    ...(o.structured===false?[]:[
      "claims:","  - claim_id: synth-2026q3",
      "    entity: SYNTH",
      "    metric: "+(o.metric??"revenue"),
      "    period: 2026Q3",
      "    unit: USD millions",
      "    value: '"+(o.value??"100")+"'",
    ]),
    "---","# SYNTH historical note","SYNTH hypothetical numbers; no real issuer data.","",
  ].join("\n");
}
function put(p:string,text:string){
  const target=path.join(vault,p);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,text);
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-history-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-history-copy-")));
  vault=path.join(live,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const root of [live,snapshot])fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function indexedSnapshot(){
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{
    recursive:true,preserveTimestamps:true,
  });
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  const coverage=verifyOfflineSnapshotCoverage(snapshot);
  if(coverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("synthetic_fixture_coverage_failed");
  return coverage.markdownContentManifestSha256;
}
const incoming=(x:Record<string,unknown>={})=>({
  entity:"SYNTH",metric:"revenue",period:"2026Q3",unit:"USD millions",
  value:"100",eventKey:"SYNTH-2026Q3",
  claimId:"synth-2026q3",sourceUrl:"https://example.org/synthetic-release",
  originalSourceSha256:sourceHash,sourceType:"primary",
  eventDate:"2026-09-25",publishedAt:"2026-09-26T10:00:00Z",
  importedAt:"2026-10-20T10:00:00Z",...x,
});
describe("PR #84 offline historical comparison of physically reconciled snapshot",()=>{
  it("finds identical metadata across index, does not require owner to remember notes",async()=>{
    put(oldPath,note());
    put(prosePath,note({structured:false}));
    const manifest=await indexedSnapshot();
    const result=reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    });
    expect(result).toMatchObject({
      status:"offline_structured_historical_comparison_needs_review",
      classification:"duplicate_exact_metadata_same_source",
      reviewQueue:"no_change_suggested",
      sourceKind:"user_supplied_unverified_incoming_claim",
      independentPrimaryEvidenceVerified:false,
      existingThesisCompared:false,ownerApprovalGranted:false,
      canAutoWrite:false,canAutoUpdateThesis:false,vaultModified:false,
    });
    expect(result.comparison.matches[0].path).toBe(oldPath);
    expect(result.scope.scannedIndexedNotes).toBe(2);
    expect(result.scope.notesWithoutStructuredClaims).toBe(1);
    expect(result.lexicalHistoryHints).toContain(prosePath);
    expect(result.scope.completeVaultHistoryAcrossDevicesVerified).toBe(false);
  });
  it("flags same event & metric with different literal for priority review",async()=>{
    put(oldPath,note());
    const manifest=await indexedSnapshot();
    const result=reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming({value:"120"}),
    });
    expect(result.classification).toBe("possible_correction_or_contradiction");
    expect(result.reviewQueue).toBe("priority_conflict_review");
    expect(result.comparison.thesisChangeEstablished).toBe(false);
  });
  it("does not misclassify archived AI as independent corroboration",async()=>{
    put(aiPath,note({sourceType:"archived_ai"}));
    const manifest=await indexedSnapshot();
    const result=reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    });
    expect(result.classification).toBe("historical_archived_ai_mention_only");
    expect(result.comparison.matches[0].independence)
      .toBe("not_independent_archived_ai");
  });
  it("no match means not found IN INDEXED SCOPE, never globally new",async()=>{
    put(prosePath,note({structured:false}));
    const manifest=await indexedSnapshot();
    const result=reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    });
    expect(result.classification).toBe("not_found_in_scanned_snapshot");
    expect(result.comparison.noveltyProven).toBe(false);
    expect(result.scope.notesWithoutStructuredClaims).toBe(1);
    expect(result.lexicalHistoryHints).toContain(prosePath);
  });
  it("refuses a stale manifest and changed file after snapshot",async()=>{
    put(oldPath,note());
    const manifest=await indexedSnapshot();
    expect(()=>reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:"0".repeat(64),
      incoming:incoming(),
    })).toThrow("offline_historical_snapshot_coverage_or_manifest_hold");
    const target=path.join(snapshot,"vault",oldPath);
    fs.writeFileSync(target,note({value:"999"}));
    expect(()=>reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    })).toThrow("offline_historical_snapshot_coverage_or_manifest_hold");
  });
  it("refuses use of Production/Railway and live DATA_DIR",async()=>{
    put(oldPath,note());
    const manifest=await indexedSnapshot();
    expect(()=>reviewHistoricalChangeOffline({
      snapshotRoot:live,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    })).toThrow();
    process.env.RAILWAY_PROJECT_ID="synthetic-block";
    expect(()=>reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    })).toThrow();
  });
  it("fails closed on incomplete structured history while still finding valid matches",async()=>{
    put(oldPath,note());
    put("10_Knowledge/SYNTH - Coerced Claim.md",note({value:"200"})
      .replace("value: '200'","value: 200"));
    const manifest=await indexedSnapshot();
    const r=reviewHistoricalChangeOffline({
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:incoming(),
    });
    expect(r.scope.incompleteStructuredClaims).toBe(1);
    expect(r.classification).toBe("duplicate_exact_metadata_same_source");
    expect(r.comparison.claimFactsVerified).toBe(false);
  });
});

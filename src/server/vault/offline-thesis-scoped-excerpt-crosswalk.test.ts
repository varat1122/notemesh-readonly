import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {splitFrontmatter} from "./markdown";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";
import {prepareOfflineInvestmentIntelligenceBrief} from "./offline-investment-intelligence-brief";
import {prepareOfflineScopedThesisComparison}
  from "./offline-thesis-scoped-excerpt-crosswalk";

const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
let live:string,snapshot:string,vault:string;
const oldPath="10_Knowledge/SYNTH - Old Claim.md";
const narrativePath="10_Knowledge/SYNTH - Old Narrative.md";
const thesisPath="05_Thesis/SYNTH - Current Thesis.md";
const publicLine="- Delivery conversion remains the main unresolved risk.";
const hiddenLine="Private fictional assumption: do not disclose full Thesis.";
const note=(withCode=false)=>[
  "---","type: current_thesis","entity: SYNTH","status: draft",
  "verification: not_reverified","---",
  "# SYNTH - Current Thesis",
  publicLine,
  hiddenLine,
  ...(withCode?["\u0060\u0060\u0060secret","Untrusted execution note","\u0060\u0060\u0060"]:[]),
  "",
].join("\n");
const old=()=>[
  "---","type: research_note","entity: SYNTH","source_type: primary",
  "verification: not_reverified","original_source: https://example.org/synth",
  "original_source_sha256: '"+("a".repeat(64))+"'",
  "event_key: SYNTH-2026Q3",
  "event_date: '2026-09-25'","published_at: '2026-09-26T09:00:00Z'",
  "imported_at: '2026-09-27T09:00:00Z'",
  "claims:","  - claim_id: synth-rev-q3","    entity: SYNTH",
  "    metric: revenue","    period: 2026Q3",
  "    unit: USD millions","    value: '100'",
  "---","# History",
  "SYNTH delivery and revenue in Q3 fictional note.","",
].join("\n");
const prose=()=>[
  "---","type: research_note","entity: SYNTH","source_type: primary",
  "verification: not_reverified","event_key: SYNTH-2026Q3",
  "event_date: '2026-09-25'",
  "---","# Narrative",
  "SYNTH delivery faces execution bottleneck.","",
].join("\n");
function put(name:string,body:string){
  const file=path.join(vault,name);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,body);
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-scoped-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-scoped-copy-")));
  vault=path.join(live,"vault");fs.mkdirSync(vault);
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,5).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const dir of [live,snapshot])fs.rmSync(dir,{force:true,recursive:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function fixture(withCode=false){
  put(oldPath,old());put(narrativePath,prose());
  put(thesisPath,note(withCode));
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),
    {recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  const coverage=verifyOfflineSnapshotCoverage(snapshot);
  if(coverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("synthetic_scope_fixture_bad_coverage");
  return coverage.markdownContentManifestSha256;
}
function review(manifest:string,more:Record<string,unknown>={}){
  return {
    evidence:{
      snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
      incoming:{
        entity:"SYNTH",metric:"revenue",period:"2026Q3",unit:"USD millions",
        value:"120",eventKey:"SYNTH-2026Q3",
        sourceUrl:"https://example.org/synth",
        originalSourceSha256:"a".repeat(64),
        sourceType:"user_supplied",
      },
      keywords:["delivery","revenue"],
      thesis:{path:thesisPath,expectedSha256:sha(note())},
    },
    ...more,
  };
}
function selection(content=note(),target=publicLine){
  const parsed=splitFrontmatter(content);
  const pos=parsed.body.split("\n").indexOf(target);
  if(pos<0)throw Error("missing_test_line");
  return {
    absoluteLine:parsed.fmOffset+pos+1,
    exactLineSha256:sha(target),interpretationIndex:0,
    proposedPosition:"potentially_challenges_assumption" as const,
  };
}
function buildProposal(input:ReturnType<typeof review>){
  const base=prepareOfflineInvestmentIntelligenceBrief(input.evidence);
  const st=base.oldStructuredEvidenceRefs.find(x=>x.path===oldPath)!;
  return {
    evidence:input.evidence,
    proposals:[{
      claimLabel:"SYNTH fictional Q3",
      hypothesis:"Delivery timing may affect conversion.",
      relation:"contradiction_candidate" as const,
      mechanism:["revenue_conversion"] as Array<"revenue_conversion">,
      citedHistoricalRefs:[{
        kind:"structured_metadata" as const,notePath:st.path,
        sourceSha256:st.sourceSha256,
      }],
      counterEvidenceRefs:[],
      missingPrimaryEvidence:["Real issuer original / period reconciliation"],
      uncertaintyExplanation:"Revisions to old data not independently reviewed.",
    }],
  };
}
describe("PR #88: selected, physically verified Thesis snippet crosswalk",()=>{
  it("returns only the selected bound line plus historical context, never full Thesis",async()=>{
    const manifest=await fixture(),p=buildProposal(review(manifest));
    const result=prepareOfflineScopedThesisComparison({
      review:p,scopeSelections:[selection()],
    });
    expect(result).toMatchObject({
      status:"offline_explicit_thesis_excerpt_crosswalk_not_authorized",
      thesisPath,thesisSha256:sha(note()),
      exactThesisVersionPhysicallyChecked:true,
      selectedLinesMatchedExactHashes:true,
      allThesisSemanticallyReviewed:false,
      independentOwnerConsentAuthenticated:false,
      externalIssuerFactsVerified:false,
      semanticLLMRunPerformed:false,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,safeEditPreview:null,vaultModified:false,
    });
    expect(result.selectedQuotes).toHaveLength(1);
    expect(result.selectedQuotes[0].excerpt).toBe(publicLine);
    expect(result.historicalInterpretations).toHaveLength(1);
    expect(result.historicalInterpretations[0].hypothesis)
      .toContain("Delivery timing");
    expect(JSON.stringify(result)).not.toContain(hiddenLine);
    expect(fs.readFileSync(path.join(snapshot,"vault",thesisPath),"utf8"))
      .toBe(note());
  });
  it("holds wrong/full-line hash, out of range, duplicate and YAML line",async()=>{
    const manifest=await fixture(),p=buildProposal(review(manifest));
    const good=selection();
    const cases=[
      [{...good,exactLineSha256:"b".repeat(64)}],
      [{...good,absoluteLine:2}],
      [good,good],
      [{...good,interpretationIndex:4}],
    ];
    for(const selections of cases){
      expect(()=>prepareOfflineScopedThesisComparison({
        review:p,scopeSelections:selections,
      })).toThrow();
    }
  });
  it("refuses unselected Thesis or wrong selected hash",async()=>{
    const manifest=await fixture();
    const noThesis=buildProposal(review(manifest));
    const no={...noThesis,evidence:{...noThesis.evidence,thesis:undefined}};
    expect(()=>prepareOfflineScopedThesisComparison({
      review:no,scopeSelections:[selection()],
    })).toThrow("scoped_thesis_requires_prechecked_explicit_thesis_version");
    const wrong={...noThesis,evidence:{
      ...noThesis.evidence,
      thesis:{path:thesisPath,expectedSha256:"f".repeat(64)},
    }};
    expect(()=>prepareOfflineScopedThesisComparison({
      review:wrong,scopeSelections:[selection()],
    })).toThrow();
  });
  it("blocks stale/modified physical thesis and Railway live runtime",async()=>{
    const manifest=await fixture(),p=buildProposal(review(manifest));
    fs.writeFileSync(path.join(snapshot,"vault",thesisPath),
      note().replace(publicLine,"Changed without snapshot update"));
    expect(()=>prepareOfflineScopedThesisComparison({
      review:p,scopeSelections:[selection()],
    })).toThrow();
    process.env.RAILWAY_PROJECT_ID="synthetic";
    expect(()=>prepareOfflineScopedThesisComparison({
      review:p,scopeSelections:[selection()],
    })).toThrow();
  });
  it("does not quote fenced code blocks even with exact hashes",async()=>{
    const manifest=await fixture(true);
    const p=buildProposal(review(manifest));
    // The Thesis hash must match the exact selected fixture.
    const exact={...p,evidence:{...p.evidence,thesis:{
      path:thesisPath,expectedSha256:sha(note(true)),
    }}};
    const target="Untrusted execution note";
    const picked=selection(note(true),target);
    expect(()=>prepareOfflineScopedThesisComparison({
      review:exact,scopeSelections:[picked],
    })).toThrow("scoped_thesis_line_not_plain_body_prose_hold");
  });
});

import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {splitFrontmatter} from "./markdown";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";
import {prepareOfflineInvestmentIntelligenceBrief}
  from "./offline-investment-intelligence-brief";
import {judgeOfflineThesisSemanticDraft}
  from "./offline-semantic-thesis-judge";

const sha=(v:Buffer|string)=>createHash("sha256").update(v).digest("hex");
let live:string,snapshot:string,vault:string;
const historyPath="10_Knowledge/SYNTH - Prior Revenue.md";
const otherPath="10_Knowledge/SYNTH - Prior Delivery.md";
const thesisPath="05_Thesis/SYNTH - Current Thesis.md";
const quote="- Revenue conversion depends on deliveries.";
const secret="Never export whole private Thesis body.";
const thesis=()=>[
  "---","type: current_thesis","entity: SYNTH",
  "verification: not_reverified","status: draft",
  "---","# Current Thesis",quote,secret,"",
].join("\n");
const old=()=>[
  "---","type: research_note","entity: SYNTH",
  "source_type: primary","verification: not_reverified",
  "original_source: https://example.org/synth",
  "original_source_sha256: '"+("a".repeat(64))+"'",
  "event_key: SYNTH-2026Q3","event_date: '2026-09-25'",
  "claims:","  - claim_id: syn-q3","    entity: SYNTH",
  "    metric: revenue","    period: 2026Q3",
  "    unit: USD millions","    value: '100'",
  "---","# Historical", "SYNTH delivery and revenue discussed.", "",
].join("\n");
const extra=()=>[
  "---","type: research_note","entity: SYNTH",
  "source_type: archived_ai","event_key: SYNTH-2026Q3",
  "---","# Historical","SYNTH delivery uncertainty from archived chat.","",
].join("\n");
function put(p:string,s:string){
  const dest=path.join(vault,p);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,s);
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-judge-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-judge-copy-")));
  vault=path.join(live,"vault");fs.mkdirSync(vault);
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const x of [live,snapshot])fs.rmSync(x,{force:true,recursive:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function indexedFixture(){
  put(historyPath,old());put(otherPath,extra());put(thesisPath,thesis());
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{
    recursive:true,preserveTimestamps:true,
  });
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  const c=verifyOfflineSnapshotCoverage(snapshot);
  if(c.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("synthetic_semantic_fixture_not_reconciled");
  return c.markdownContentManifestSha256;
}
function historicalEvidence(manifest:string){
  const evidence={
    snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
    incoming:{
      entity:"SYNTH",metric:"revenue",period:"2026Q3",
      unit:"USD millions",value:"120",eventKey:"SYNTH-2026Q3",
      sourceUrl:"https://example.org/synth",
      originalSourceSha256:"a".repeat(64),sourceType:"user_supplied",
    },
    keywords:["revenue","delivery"],
    thesis:{path:thesisPath,expectedSha256:sha(thesis())},
  };
  const oldNote=prepareOfflineInvestmentIntelligenceBrief(evidence)
    .oldStructuredEvidenceRefs.find(x=>x.path===historyPath)!;
  const parsed=splitFrontmatter(thesis());
  const absoluteLine=parsed.fmOffset+parsed.body.split("\n").indexOf(quote)+1;
  return {
    review:{
      evidence,
      proposals:[{
        claimLabel:"SYNTH fictional revenue Q3",
        hypothesis:"The old conversion assumption may have changed.",
        relation:"contradiction_candidate" as const,
        mechanism:["revenue_conversion"] as Array<"revenue_conversion">,
        citedHistoricalRefs:[{
          kind:"structured_metadata" as const,
          notePath:oldNote.path,sourceSha256:oldNote.sourceSha256,
        }],
        counterEvidenceRefs:[],
        missingPrimaryEvidence:["Original issuer filing and correction history"],
        uncertaintyExplanation:"Issuer authenticity and time period not verified.",
      }],
    },
    scopeSelections:[{
      absoluteLine,exactLineSha256:sha(quote),interpretationIndex:0,
      proposedPosition:"potentially_challenges_assumption" as const,
    }],
  };
}
const finding=()=>({
  interpretationIndex:0,
  relation:"contradiction_candidate" as const,
  selectedThesisRefIds:["T0"],
  historicalSupportRefIds:["I0S0"],
  historicalCounterRefIds:[] as string[],
  direction:"challenges" as const,
  economicMechanisms:[{
    channel:"revenue_conversion" as const,
    causalExplanation:"Fictional delivery bottleneck could change recognized revenue.",
    epistemicStatus:"hypothesis" as const,
  }],
  evidenceGaps:["Issuer original source and full counter-evidence review"],
  whyThisIsNotProven:"Archived notes and model interpretation do not verify facts.",
  counterEvidenceAssessment:"not_yet_found_or_read" as const,
  candidateSummary:"An unverified conversion-risk hypothesis needs human review.",
});
describe("PR #89 offline semantic candidate with bound refs, not true model fact",()=>{
  it("prepares human-priority candidate linking full exact Thesis line to cited history",async()=>{
    const manifest=await indexedFixture();
    const result=judgeOfflineThesisSemanticDraft({
      source:historicalEvidence(manifest),findings:[finding()],
    });
    expect(result).toMatchObject({
      status:"unverified_offline_semantic_review_candidates_only",
      freshPhysicalCitationsChecked:true,
      modelInvokedByThisCode:false,independentSemanticVerificationPerformed:false,
      allThesisRead:false,originalIssuerSourceChecked:false,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,safeEditPreview:null,vaultModified:false,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].reviewQueue)
      .toBe("must_review_potential_thesis_change_or_conflict");
    expect(result.findings[0].citedThesisLines[0].excerpt).toBe(quote);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.findings[0].semanticClaimVerified).toBe(false);
  });
  it("rejects fabricated or wrong-kind citations even if model prose sounds plausible",async()=>{
    const manifest=await indexedFixture(),source=historicalEvidence(manifest);
    for(const mutated of [
      {...finding(),selectedThesisRefIds:["T999"]},
      {...finding(),historicalSupportRefIds:["I0C0"]},
      {...finding(),historicalSupportRefIds:["I1S0"]},
      {...finding(),historicalCounterRefIds:["I0S0"]},
      {...finding(),selectedThesisRefIds:["I0S0"]},
      {...finding(),historicalSupportRefIds:["I0S0","I0S0"]},
    ]){
      expect(()=>judgeOfflineThesisSemanticDraft({source,findings:[mutated]}))
        .toThrow();
    }
  });
  it("blocks unsupported mechanism, missing counterevidence gap and authority override",async()=>{
    const source=historicalEvidence(await indexedFixture());
    expect(()=>judgeOfflineThesisSemanticDraft({
      source,findings:[{...finding(),economicMechanisms:[{
        channel:"valuation" as const,causalExplanation:"Unsupported valuation.",
        epistemicStatus:"hypothesis" as const,
      }]}],
    })).toThrow("semantic_review_mechanism_outside_historical_hypothesis_hold");
    expect(()=>judgeOfflineThesisSemanticDraft({
      source,findings:[{...finding(),evidenceGaps:[]}],
    })).toThrow();
    expect(()=>judgeOfflineThesisSemanticDraft({
      source,findings:[{...finding(),ownerApprovalGranted:true} as ReturnType<typeof finding>],
    })).toThrow();
  });
  it("refuses duplicate label over structured numeric conflict",async()=>{
    const source=historicalEvidence(await indexedFixture());
    expect(()=>judgeOfflineThesisSemanticDraft({
      source,findings:[{...finding(),relation:"duplicate_candidate" as const}],
    })).toThrow("semantic_review_duplicate_cannot_override_conflict_hold");
  });
  it("never compares stale Thesis snapshot or runs inside Railway",async()=>{
    const manifest=await indexedFixture(),source=historicalEvidence(manifest);
    fs.writeFileSync(path.join(snapshot,"vault",thesisPath),
      thesis().replace(quote,"Changed assumption line"));
    expect(()=>judgeOfflineThesisSemanticDraft({
      source,findings:[finding()],
    })).toThrow();
    process.env.RAILWAY_PROJECT_ID="synthetic-railway-hold";
    expect(()=>judgeOfflineThesisSemanticDraft({
      source,findings:[finding()],
    })).toThrow();
  });
});

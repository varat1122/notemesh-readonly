import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {prepareOfflineInvestmentIntelligenceBrief}
  from "./offline-investment-intelligence-brief";
import {prepareOfflineEvidenceBoundThesisReview}
  from "./offline-evidence-bound-thesis-review";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";

const sha=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");
let live:string,snapshot:string,vault:string;
const prev="10_Knowledge/SYNTH - Q3 claim.md";
const history="10_Knowledge/SYNTH - Delivery history.md";
const aiPath="07_Sources/ChatGPT/SYNTH - Archived thought.md";
const thesisPath="05_Thesis/SYNTH - Current Thesis.md";
const secret="SECRET THESIS PARAGRAPH: Fictional proprietary model not for export.";
const original="https://example.org/fictional";
const originalSha="a".repeat(64);
const claimNote=(v="100")=>[
  "---","type: research_note","entity: SYNTH","source_type: primary",
  "verification: not_reverified","original_source: "+original,
  "original_source_sha256: '"+originalSha+"'",
  "event_key: SYNTH-Q3-2026","event_date: '2026-09-25'",
  "published_at: '2026-09-26T10:00:00Z'",
  "imported_at: '2026-09-27T10:00:00Z'",
  "claims:","  - claim_id: synth-q3","    entity: SYNTH",
  "    metric: revenue","    period: 2026Q3",
  "    unit: USD millions","    value: '"+v+"'",
  "---","# Historic claim",
  "SYNTH revenue delivery in fictional Q3.", "",
].join("\n");
const prose=(sourceType="primary")=>[
  "---","type: research_note","entity: SYNTH",
  "source_type: "+sourceType,
  "verification: not_reverified","original_source: "+original,
  "original_source_sha256: '"+originalSha+"'",
  "event_key: SYNTH-Q3-2026",
  "event_date: '2026-09-25'",
  "published_at: '2026-09-26T10:00:00Z'",
  "imported_at: '2026-10-01T10:00:00Z'",
  "---","# Story","SYNTH capacity and delivery were discussed in old notes.", "",
].join("\n");
const thesis=()=>[
  "---","type: current_thesis","entity: SYNTH","status: draft",
  "---","# Current Thesis",secret,"",
].join("\n");
function put(p:string,body:string){
  const f=path.join(vault,p);
  fs.mkdirSync(path.dirname(f),{recursive:true});
  fs.writeFileSync(f,body);
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-semantic-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-semantic-copy-")));
  vault=path.join(live,"vault");fs.mkdirSync(vault);
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,6).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  for(const d of [live,snapshot])fs.rmSync(d,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function fixture(){
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),
    {recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  const checked=verifyOfflineSnapshotCoverage(snapshot);
  if(checked.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("interpretation_fixture_coverage_hold");
  return checked.markdownContentManifestSha256;
}
function evidence(manifest:string,opts:Record<string,unknown>={}){
  return {
    snapshotRoot:snapshot,
    expectedMarkdownManifestSha256:manifest,
    incoming:{
      entity:"SYNTH",metric:"revenue",period:"2026Q3",
      unit:"USD millions",value:"120",eventKey:"SYNTH-Q3-2026",
      sourceUrl:original,originalSourceSha256:originalSha,
      sourceType:"user_supplied",eventDate:"2026-09-25",
    },
    keywords:["revenue","delivery"],
    thesis:{path:thesisPath,expectedSha256:sha(thesis())},
    ...opts,
  };
}
function proposed(refs:Array<{
  kind:"structured_metadata"|"historical_prose";notePath:string;
  sourceSha256?:string|null;noteSha256?:string;line?:number;
  excerptSha256?:string;
}>,relation:"contradiction_candidate"|"thesis_changing_hypothesis"|
  "duplicate_candidate"="contradiction_candidate"){
  return {
    claimLabel:"Fictional Q3 Revenue",hypothesis:"The new input might revise the delivery assumption.",
    relation,mechanism:["revenue_conversion","earnings"] as Array<"revenue_conversion"|"earnings">,
    citedHistoricalRefs:refs,
    counterEvidenceRefs:[],
    missingPrimaryEvidence:["Independent issuer earnings release and revision timeline"],
    uncertaintyExplanation:"The input and archived note could reflect different scopes.",
  };
}
describe("PR #87: evidence-linked analyst interpretation is never an approved thesis change",()=>{
  it("binds structured claim and exact prose citation; flags conflict for human review",async()=>{
    put(prev,claimNote());put(history,prose());put(thesisPath,thesis());
    const request=evidence(await fixture());
    const base=prepareOfflineInvestmentIntelligenceBrief(request);
    const st=base.oldStructuredEvidenceRefs.find(r=>r.path===prev)!;
    const n=base.oldNarrativeEvidenceRefs.find(r=>r.path===history)!;
    const quote=n.exactLineCitations[0];
    const items=[{
      kind:"structured_metadata" as const,
      notePath:st.path,sourceSha256:st.sourceSha256,
    },{
      kind:"historical_prose" as const,
      notePath:n.path,noteSha256:n.noteSha256,
      line:quote.line,excerptSha256:sha(quote.excerpt),
    }];
    const report=prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[proposed(items)],
    });
    expect(report).toMatchObject({
      status:"unverified_evidence_linked_interpretation_draft_only",
      structuredClassification:"possible_correction_or_contradiction",
      semanticLLMRunPerformed:false,thesisTextSemanticallyCompared:false,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,safeEditPreview:null,vaultModified:false,
    });
    expect(report.interpretations[0].reviewQueue)
      .toBe("mandatory_human_thesis_or_conflict_review");
    expect(report.interpretations[0].historicalSupportingRefs).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
  it("rejects invented note citations, wrong physical hashes and mismatched lines",async()=>{
    put(prev,claimNote());put(history,prose());put(thesisPath,thesis());
    const request=evidence(await fixture());
    const base=prepareOfflineInvestmentIntelligenceBrief(request);
    const n=base.oldNarrativeEvidenceRefs.find(r=>r.path===history)!;
    const quote=n.exactLineCitations[0];
    const correct={
      kind:"historical_prose" as const,notePath:n.path,
      noteSha256:n.noteSha256,line:quote.line,
      excerptSha256:sha(quote.excerpt),
    };
    for(const forged of [
      {...correct,notePath:"10_Knowledge/Nonexistent.md"},
      {...correct,noteSha256:"f".repeat(64)},
      {...correct,line:quote.line+100},
      {...correct,excerptSha256:"0".repeat(64)},
      {...correct,notePath:thesisPath},
    ]){
      expect(()=>prepareOfflineEvidenceBoundThesisReview({
        evidence:request,proposals:[proposed([forged])],
      })).toThrow();
    }
  });
  it("treats archived AI as context only, never corroboration",async()=>{
    put(aiPath,prose("archived_ai"));put(thesisPath,thesis());
    const request=evidence(await fixture());
    const base=prepareOfflineInvestmentIntelligenceBrief(request);
    const n=base.oldNarrativeEvidenceRefs.find(r=>r.path===aiPath)!;
    const quote=n.exactLineCitations[0];
    const report=prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[proposed([{
        kind:"historical_prose",notePath:n.path,noteSha256:n.noteSha256,
        line:quote.line,excerptSha256:sha(quote.excerpt),
      }])],
    });
    expect(report.interpretations[0].warnings.join(" ")).toContain("Archived AI");
    expect(report.interpretations[0].independentSourceCorroborated).toBe(false);
  });
  it("downgrades 'thesis changing' and blocks duplicate if metadata conflict",async()=>{
    put(prev,claimNote());put(thesisPath,thesis());
    const request=evidence(await fixture(),{thesis:undefined});
    const base=prepareOfflineInvestmentIntelligenceBrief(request);
    const first=base.oldStructuredEvidenceRefs[0];
    const cite={kind:"structured_metadata" as const,
      notePath:first.path,sourceSha256:first.sourceSha256};
    const impact=prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[proposed([cite],"thesis_changing_hypothesis")],
    });
    expect(impact.interpretations[0].warnings.join(" ")).toContain(
      "No exact Current Thesis version selected");
    expect(impact.interpretations[0].thesisChangeValidated).toBe(false);
    const duplicate=prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[proposed([cite],"duplicate_candidate")],
    });
    expect(duplicate.interpretations[0].warnings.join(" ")).toContain(
      "proposed duplicate conflicts");
    expect(duplicate.interpretations[0].reviewQueue)
      .toBe("mandatory_human_thesis_or_conflict_review");
  });
  it("refuses unsupported inference without mechanisms or explicit required evidence",async()=>{
    put(prev,claimNote());put(thesisPath,thesis());
    const request=evidence(await fixture());
    const st=prepareOfflineInvestmentIntelligenceBrief(request)
      .oldStructuredEvidenceRefs[0];
    const cite={kind:"structured_metadata" as const,
      notePath:st.path,sourceSha256:st.sourceSha256};
    const bad=proposed([cite]);
    expect(()=>prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[{...bad,missingPrimaryEvidence:[]}],
    })).toThrow("interpretation_missing_mechanism_evidence_or_uncertainty");
    expect(()=>prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[{...bad,mechanism:[]}],
    })).toThrow("interpretation_missing_mechanism_evidence_or_uncertainty");
    fs.writeFileSync(path.join(snapshot,"vault",prev),claimNote("999"));
    expect(()=>prepareOfflineEvidenceBoundThesisReview({
      evidence:request,proposals:[bad],
    })).toThrow();
  });
});

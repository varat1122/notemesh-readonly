import {describe,it,expect} from "vitest";
import {buildOfflineEvidenceSafeTriage}
  from "./offline-evidence-safe-triage";
import type {ClaimEvidence} from "./historical-change-classifier";

const HASH="a".repeat(64);
const OTHER="b".repeat(64);
type Input=Parameters<typeof buildOfflineEvidenceSafeTriage>[0];
type Relation="confirmation_candidate"|"incremental_candidate"|
  "duplicate_candidate"|"contradiction_candidate"|
  "thesis_changing_hypothesis"|"unresolved";
const finding=(index:number,relation:Relation="duplicate_candidate",
  direction:"supports"|"challenges"|"unclear"="supports")=>({
  interpretationIndex:index,
  modelProposedRelation:relation,modelProposedDirection:direction,
  semanticClaimVerified:false,thesisImpactEstablished:false,
  citedThesisLines:[{id:"T0",excerpt:"SENSITIVE THESIS MUST NOT LEAK"}],
  citedHistoricalSupport:[{id:"I0S0",independence:"not_assessed",
    excerpt:"PRIVATE HISTORICAL NOTE MUST NOT LEAK"}],
  citedHistoricalCounterEvidence:[],
  evidenceGaps:["Original source not authenticated"],
});
const claim=(x:Partial<ClaimEvidence>={}):ClaimEvidence=>({
  notePath:"SYNTH/old.md",entity:"SYNTH",metric:"revenue",
  period:"FY26Q3",unit:"USD millions",value:"100",
  eventKey:"SYNTH-FY26Q3-REV",claimId:"SYNTH-CLAIM",
  originalSourceSha256:OTHER,
  sourceType:"issuer",sourceUrl:"https://example.org/issuer",
  eventDate:"2026-09-25",publishedAt:"2026-09-26",
  importedAt:"2026-09-27",verification:"not_reverified",
  independence:"not_assessed",...x,
});
function packet(items:ReturnType<typeof finding>[]):Input["packet"]{
  return {
    status:"unverified_offline_semantic_review_candidates_only",
    company:"SYNTH",sourceSnapshotSha256:HASH,thesisSha256:HASH,
    ownerApprovalGranted:false,canAutoWrite:false,
    canAutoUpdateThesis:false,vaultModified:false,
    independentSemanticVerificationPerformed:false,
    originalIssuerSourceChecked:false,findings:items,
  } as unknown as Input["packet"];
}
function check(index:number,x:{
  incoming?:ClaimEvidence;old?:ClaimEvidence[];
  current?:boolean;complete?:boolean;snapshot?:string;
}={}):Input["checks"][number]{
  return {
    interpretationIndex:index,incoming:x.incoming??claim(),
    priorClaims:x.old??[claim()],
    scope:{scannedNotes:10,completeIndexScan:x.complete??true,
      snapshotSha256:x.snapshot??HASH,snapshotCurrent:x.current??true},
  };
}
const make=(x:Partial<Input["checks"][number]>={})=>
  buildOfflineEvidenceSafeTriage({
    packet:packet([finding(0)]),
    checks:[{...check(0),...x}],
  });

describe("PR #93 — declared historical evidence must not hide risk",()=>{
  it("keeps even exact same source/event/period metadata duplicates in analyst review",()=>{
    const r=make();
    expect(r.ownerPriority).toHaveLength(0);
    expect(r.analystReview).toHaveLength(1);
    expect(r.analystReview[0].historicalClassification)
      .toBe("duplicate_exact_metadata_same_source");
    expect(r.analystReview[0].reasonCodes)
      .toContain("metadata_duplicate_not_verified_fact");
    expect(r.count.automaticallyDiscarded).toBe(0);
    expect(r.count.duplicateCandidatesRetained).toBe(1);
    expect(r.duplicateSuppressionEnabled).toBe(false);
  });
  it("escalates duplicate proposal when same period/metric has different number",()=>{
    const r=make({incoming:claim({value:"120"})});
    expect(r.ownerPriority).toHaveLength(1);
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("possible_correction_or_contradiction");
    expect(r.ownerPriority[0].reasonCodes)
      .toContain("structured_numerical_conflict_priority_review");
    expect(r.count.escalatedFromAnalystToOwner).toBe(1);
  });
  it("does not confuse equal numbers in different accounting periods",()=>{
    const r=make({incoming:claim({
      period:"FY26Q4",eventKey:"SYNTH-FY26Q4-REV",
    })});
    expect(r.ownerPriority).toHaveLength(1);
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("related_claim_different_or_missing_event_key");
    expect(r.ownerPriority[0].reasonCodes)
      .toContain("same_numeric_value_different_period_not_duplicate");
  });
  it("flags same URL changed content SHA as source revision, not safe duplicate",()=>{
    const r=make({incoming:claim({originalSourceSha256:HASH})});
    expect(r.ownerPriority).toHaveLength(1);
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("same_value_new_source_not_corroborated");
    expect(r.ownerPriority[0].reasonCodes)
      .toContain("same_url_different_declared_source_sha_revision_check");
  });
  it("a matching old source does not silence a second revision",()=>{
    const r=make({incoming:claim(),priorClaims:[
      claim(),claim({originalSourceSha256:HASH,notePath:"SYNTH/new-revision.md"}),
    ]});
    expect(r.ownerPriority).toHaveLength(1);
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("duplicate_exact_metadata_same_source");
    expect(r.ownerPriority[0].reasonCodes)
      .toContain("same_url_different_declared_source_sha_revision_check");
  });
  it("archived AI is only a derivative mention, not verified corroboration",()=>{
    const r=make({priorClaims:[claim({
      independence:"not_independent_archived_ai",sourceType:"archived_ai",
    })]});
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("historical_archived_ai_mention_only");
    expect(r.ownerPriority[0].reasonCodes)
      .toContain("model_duplicate_disagrees_with_structured_history");
  });
  it("same event with different financial metric cannot be suppressed",()=>{
    const r=make({incoming:claim({metric:"gross_profit",value:"22",
      unit:"USD millions"})});
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("added_detail_same_event");
    expect(r.count.automaticallyDiscarded).toBe(0);
  });
  it("unknown/stale fingerprint and incomplete scans hold even when content looks exact",()=>{
    const stale=make({scope:{...check(0).scope,snapshotCurrent:false}});
    const wrong=make({scope:{...check(0).scope,snapshotSha256:OTHER}});
    const incomplete=make({scope:{...check(0).scope,
      completeIndexScan:false}});
    for(const r of [stale,wrong,incomplete]){
      expect(r.ownerPriority).toHaveLength(1);
      expect(r.ownerPriority[0].historicalClassification)
        .toBe("unresolved_scope_hold");
      expect(r.count.automaticallyDiscarded).toBe(0);
    }
    expect(stale.ownerPriority[0].reasonCodes)
      .toContain("stale_or_unverified_snapshot_hold");
    expect(incomplete.ownerPriority[0].reasonCodes)
      .toContain("incomplete_bounded_index_hold");
  });
  it("retains every candidate and orders higher priority without granting authority",()=>{
    const r=buildOfflineEvidenceSafeTriage({
      packet:packet([
        finding(0,"incremental_candidate","supports"),
        finding(1,"duplicate_candidate","supports"),
        finding(2,"contradiction_candidate","challenges"),
      ]),
      checks:[check(2),check(0),check(1,{incoming:claim({value:"120"})})],
    });
    expect(r.count.total).toBe(3);
    expect(r.ownerPriority.map(t=>t.interpretationIndex)).toEqual([1,2]);
    expect(r.analystReview.map(t=>t.interpretationIndex)).toEqual([0]);
    expect(r.count.escalatedFromAnalystToOwner).toBe(1);
    expect(r.canAutoWrite).toBe(false);
    expect(r.ownerApprovalGranted).toBe(false);
    expect(r.productionReleaseAllowed).toBe(false);
    expect(r.factOrSemanticTruthEstablished).toBe(false);
  });
  it("never emits protected Thesis, historical paths, sources or supplied arbitrary prose",()=>{
    const r=make({incoming:claim({value:"SECRET PORTFOLIO CONTENT",
      notePath:"PRIVATE/DO_NOT_EXPOSE.md",
      sourceUrl:"https://private.example/secret"}),
    });
    const s=JSON.stringify(r);
    for(const secret of ["SENSITIVE THESIS","PRIVATE HISTORICAL NOTE",
      "SECRET PORTFOLIO CONTENT","DO_NOT_EXPOSE","private.example"]){
      expect(s).not.toContain(secret);
    }
  });
  it("rejects missing, duplicate, cross-case or unbounded checks without dropping silently",()=>{
    const p=packet([finding(0),finding(1)]);
    for(const checks of [
      [check(0)],[check(0),check(0)],[check(0),check(2)],
      [check(0),{...check(1),priorClaims:Array(201).fill(claim())}],
    ]){
      expect(()=>buildOfflineEvidenceSafeTriage({
        packet:p,checks,
      })).toThrow();
    }
  });
  it("rejects forged semantic relation rather than silently treating it as benign",()=>{
    const forged=packet([finding(0)]);
    (forged.findings[0] as unknown as {modelProposedRelation:string})
      .modelProposedRelation="verified_safely_discard";
    expect(()=>buildOfflineEvidenceSafeTriage({
      packet:forged,checks:[check(0)],
    })).toThrow("evidence_triage_forged_semantic_label_hold");
  });
  it("never claims novelty if no historical claim is in the bounded scan",()=>{
    const r=make({priorClaims:[]});
    expect(r.ownerPriority[0].historicalClassification)
      .toBe("not_found_in_scanned_snapshot");
    expect(r.ownerPriority[0].reasonCodes)
      .toContain("absence_from_snapshot_is_not_proof_of_new_event");
  });
});

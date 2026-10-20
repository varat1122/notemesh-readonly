import {describe,it,expect} from "vitest";
import {classifyHistoricalClaim,type ClaimEvidence}
  from "./historical-change-classifier";
const hash=(character:string)=>character.repeat(64);
const claim=(x:Partial<ClaimEvidence>={}):ClaimEvidence=>({
  notePath:"10_Knowledge/SYNTH - old.md",
  entity:"SYNTH",metric:"revenue",period:"2026Q3",unit:"USD millions",
  value:"100",eventKey:"SYNTH-Q3-2026-revenue",
  claimId:"synth-revenue-q3",originalSourceSha256:hash("a"),
  sourceUrl:"https://example.org/synth-issuer",sourceType:"primary",
  eventDate:"2026-09-25",publishedAt:"2026-09-26T10:00:00Z",
  importedAt:"2026-09-27T10:00:00Z",verification:"not_reverified",
  independence:"not_assessed",...x,
});
const run=(newClaim:ClaimEvidence,old:ClaimEvidence[])=>classifyHistoricalClaim(
  newClaim,old,{scannedNotes:15,completeIndexScan:true});
describe("PR #84 Historical Intelligence: no overclaim",()=>{
  it("marks exact event, literal and original source version as duplicate ONLY metadata",()=>{
    const a=run(claim({notePath:"new.md"}),[claim()]);
    expect(a.classification).toBe("duplicate_exact_metadata_same_source");
    expect(a.reviewQueue).toBe("no_change_suggested");
    expect(a).toMatchObject({
      noveltyProven:false,claimFactsVerified:false,
      thesisChangeEstablished:false,canAutoWrite:false,
      canAutoUpdateThesis:false,matchingEvidenceCount:1,
    });
    expect(a.matches[0].path).toBe("10_Knowledge/SYNTH - old.md");
  });
  it("treats same event and metric with different numbers as unresolved correction/conflict",()=>{
    const a=run(claim({value:"120",notePath:"new.md"}),[claim()]);
    expect(a.classification).toBe("possible_correction_or_contradiction");
    expect(a.reviewQueue).toBe("priority_conflict_review");
    expect(a.reasonCodes).toContain("cannot_choose_correction_vs_conflict_without_originals");
  });
  it("treats same claim value from another URL/version as not-yet corroborated",()=>{
    for(const x of [{originalSourceSha256:hash("b")},
      {sourceUrl:"https://other.example/synth"}]){
      const a=run(claim({notePath:"new.md",...x}),[claim()]);
      expect(a.classification).toBe("same_value_new_source_not_corroborated");
      expect(a.claimFactsVerified).toBe(false);
    }
  });
  it("identifies same event other metric as added-detail candidate, not automatic EPS revision",()=>{
    const a=run(claim({metric:"gross_margin",value:"45",unit:"%",notePath:"new.md"}),[
      claim({metric:"revenue"}),
    ]);
    expect(a.classification).toBe("added_detail_same_event");
    expect(a.thesisChangeEstablished).toBe(false);
  });
  it("never elevates archived AI or derivative notes into independent primary evidence",()=>{
    const archived=claim({sourceType:"archived_ai",
      independence:"not_independent_archived_ai"});
    const a=run(claim({notePath:"new.md"}),[archived]);
    expect(a.classification).toBe("historical_archived_ai_mention_only");
    expect(a.matches[0].relationship).toBe("archived_ai_context_not_evidence");
    expect(run(claim({sourceType:"archived_ai",
      independence:"not_independent_archived_ai"}),[claim()]).classification)
      .toBe("unresolved_missing_structured_fields");
  });
  it("never infers globally new from no result in scanned index or invents chronology",()=>{
    const r=run(claim({notePath:"new.md",eventDate:null,publishedAt:null,importedAt:null}),[]);
    expect(r.classification).toBe("not_found_in_scanned_snapshot");
    expect(r.noveltyProven).toBe(false);
    expect(r.reasonCodes).toContain("absence_from_snapshot_is_not_proof_of_new_event");
    expect(r.reasonCodes).toContain("event_date_unknown");
    expect(r.matches).toEqual([]);
  });
  it("does not call different event duplicate merely because values/issuer match",()=>{
    const a=run(claim({eventKey:"SYNTH-Q4",notePath:"new.md"}),[claim()]);
    expect(a.classification).toBe("related_claim_different_or_missing_event_key");
  });
  it("requires structured entity, event, metric, period and text literal",()=>{
    for(const bad of [{entity:null},{metric:null},{value:null},
      {eventKey:null},{unit:null}]){
      const r=run(claim({...bad}),[claim()]);
      expect(r.classification).toBe("unresolved_missing_structured_fields");
      expect(r.reviewQueue).toBe("manual_evidence_review");
    }
  });
  it("treats multiple copies as references, not additional independent proof",()=>{
    const priors=Array.from({length:20},(_,i)=>claim({
      notePath:"10_Knowledge/Copy "+i+".md",
    }));
    const result=run(claim({notePath:"new.md"}),priors);
    expect(result.matches).toHaveLength(12);
    expect(result.reasonCodes).toContain("candidate_sample_truncated");
    expect(result.matchingEvidenceCount).toBe(20);
    expect(result.claimFactsVerified).toBe(false);
  });
  it("fails closed on incomplete/truncated index enumeration",()=>{
    expect(()=>classifyHistoricalClaim(claim(),[],{
      scannedNotes:10000,completeIndexScan:false,
    })).toThrow("historical_comparison_incomplete_index_scope_hold");
  });
});

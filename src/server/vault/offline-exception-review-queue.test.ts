import {describe,it,expect} from "vitest";
import {buildOfflineExceptionReviewQueue}
  from "./offline-exception-review-queue";

const HASH="a".repeat(64);
type ReviewInput=Parameters<typeof buildOfflineExceptionReviewQueue>[0];
function finding(index:number,relation:
  "duplicate_candidate"|"contradiction_candidate"|
  "thesis_changing_hypothesis"|"incremental_candidate",
  direction:"supports"|"challenges"|"unclear"="unclear",
){
  return {
    interpretationIndex:index,
    modelProposedRelation:relation,modelProposedDirection:direction,
    semanticClaimVerified:false,thesisImpactEstablished:false,
    citedThesisLines:[{id:"T0",excerpt:"SECRET NEVER RETURN THIS"}],
    citedHistoricalSupport:[{
      id:"I0S0",independence:"not_assessed",
      excerpt:"PRIVATE OLD NOTE NEVER RETURN THIS",
    }],
    citedHistoricalCounterEvidence:[],
    evidenceGaps:["Original issuer source still missing"],
  };
}
function packet(items:ReturnType<typeof finding>[]){
  return {
    status:"unverified_offline_semantic_review_candidates_only",
    company:"SYNTH",sourceSnapshotSha256:HASH,thesisSha256:HASH,
    ownerApprovalGranted:false,canAutoWrite:false,
    canAutoUpdateThesis:false,vaultModified:false,
    independentSemanticVerificationPerformed:false,
    originalIssuerSourceChecked:false,
    findings:items,
  } as unknown as ReviewInput;
}
describe("PR #92 offline review-by-exception is never an approval",()=>{
  it("sends challenges and contradictions to owner priority but not as a verified decision",()=>{
    const report=buildOfflineExceptionReviewQueue(packet([
      finding(1,"incremental_candidate","supports"),
      finding(0,"contradiction_candidate","unclear"),
      finding(2,"thesis_changing_hypothesis","challenges"),
    ]));
    expect(report.status).toBe("offline_unverified_review_tasks_not_owner_approval");
    expect(report.ownerPriority.map(t=>t.interpretationIndex)).toEqual([0,2]);
    expect(report.analystReview.map(t=>t.interpretationIndex)).toEqual([1]);
    expect(report.ownerPriority[0].actionableOwnerInvestmentDecision).toBe(false);
    expect(report.ownerApprovalGranted).toBe(false);
    expect(report.canAutoWrite).toBe(false);
    expect(report.productionReleaseAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toContain("SECRET NEVER RETURN THIS");
    expect(JSON.stringify(report)).not.toContain("PRIVATE OLD NOTE NEVER RETURN THIS");
  });
  it("keeps every duplicate only in analyst queue, never silently discards",()=>{
    const report=buildOfflineExceptionReviewQueue(packet([
      finding(0,"duplicate_candidate","supports"),
    ]));
    expect(report.analystReview).toHaveLength(1);
    expect(report.analystReview[0].queue).toBe("analyst_duplicate_check");
    expect(report.analystReview[0].canDismissWithoutReview).toBe(false);
    expect(report.count.automaticallyDiscarded).toBe(0);
    expect(report.count.duplicateCandidatesRequiringHumanAnalystCheck).toBe(1);
    expect(report.duplicateSuppressionEnabled).toBe(false);
  });
  it("escalates duplicate proposals which challenge old assumptions",()=>{
    const report=buildOfflineExceptionReviewQueue(packet([
      finding(0,"duplicate_candidate","challenges"),
    ]));
    expect(report.ownerPriority[0].queue).toBe("owner_priority_unverified");
    expect(report.ownerPriority[0].reasonCodes)
      .toContain("duplicate_is_only_a_candidate_never_silence_or_drop");
  });
  it("flags derivative AI copies, missing counterevidence and incomplete source check",()=>{
    const f=finding(0,"incremental_candidate");
    f.citedHistoricalSupport[0].independence="not_independent_archived_ai";
    const report=buildOfflineExceptionReviewQueue(packet([f]));
    expect(report.analystReview[0].reasonCodes).toContain(
      "derivative_or_archived_ai_evidence_is_not_independent");
    expect(report.analystReview[0].reasonCodes).toContain(
      "counterevidence_not_yet_cited");
    expect(report.semanticTruthEstablished).toBe(false);
  });
  it("rejects forged owner approval, verified fact flags and missing citation fields",()=>{
    const good=finding(0,"contradiction_candidate");
    for(const bad of [
      {...packet([good]),ownerApprovalGranted:true},
      {...packet([good]),canAutoWrite:true},
      {...packet([good]),independentSemanticVerificationPerformed:true},
      packet([{...good,semanticClaimVerified:true}]),
      packet([{...good,citedThesisLines:[]}]),
      packet([{...good,evidenceGaps:[]}]),
      packet([good,{...good}]),
    ]){
      expect(()=>buildOfflineExceptionReviewQueue(bad as ReviewInput))
        .toThrow();
    }
  });
  it("does not accept an empty report or fake snapshot hashes",()=>{
    expect(()=>buildOfflineExceptionReviewQueue(packet([]))).toThrow();
    expect(()=>buildOfflineExceptionReviewQueue({
      ...packet([finding(0,"incremental_candidate")]),
      sourceSnapshotSha256:"not-a-hash",
    } as ReviewInput)).toThrow();
  });
});

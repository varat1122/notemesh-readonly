import {afterEach,describe,it,expect} from "vitest";
import {SYNTHETIC_SEMANTIC_CASES}
  from "./offline-semantic-benchmark-corpus";
import {runSyntheticOnlyModelEvaluation}
  from "./offline-synthetic-model-evaluator";
import {type SyntheticModelPrediction}
  from "./offline-semantic-benchmark-score";

const gold=new Map(SYNTHETIC_SEMANTIC_CASES.map(c=>[c.id,c]));
const mock=(id:string):SyntheticModelPrediction=>{
  const c=gold.get(id);
  if(!c)throw Error("unknown synthetic test case");
  return {
    caseId:id,proposedRelation:c.goldRelation,
    citedIds:["T0","I0S0"],
    abstainsForMissingEvidence:c.goldAbstain,
    proposedEconomicChannel:c.goldChannel,
    economicReasoning:"hypothesis",
    primarySourceStillRequired:"Issuer original source, source revision, and counter-evidence",
    counterEvidenceCoverage:"not_exhaustively_checked",
    limitations:"No actual issuer or independently checked private Thesis here.",
  };
};
afterEach(()=>{
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
describe("PR #90 strictly synthetic callback runner, no built-in model invocation",()=>{
  it("only delivers 8 fixed SYNTH cases to injected mock, never private data",async()=>{
    const seen:string[]=[];
    const score=await runSyntheticOnlyModelEvaluation(async p=>{
      seen.push(p.id);
      expect(p.origin).toBe("synthetic_fixture_only");
      expect(p.entity).toBe("SYNTH");
      expect(JSON.stringify(p)).not.toContain("05_Thesis/NVDA");
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.historicalExcerpts)).toBe(true);
      return mock(p.id);
    });
    expect(seen).toEqual(SYNTHETIC_SEMANTIC_CASES.map(c=>c.id));
    expect(score.metrics.allFixtureExpectationsMatched).toBe(true);
    expect(score.realModelInvokedByThisCode).toBe(false);
    expect(score.productionReleaseAllowed).toBe(false);
    expect(score.ownerApprovalGranted).toBe(false);
  });
  it("detects unsafe model callback guesses without granting authority",async()=>{
    const report=await runSyntheticOnlyModelEvaluation(async p=>{
      const answer=mock(p.id);
      if(p.id==="same_event_numeric_conflict")
        return {...answer,proposedRelation:"duplicate_candidate",
          abstainsForMissingEvidence:false};
      return answer;
    });
    expect(report.metrics.unsafeFalseDuplicates).toBe(1);
    expect(report.metrics.missedCriticalReviews).toBe(1);
    expect(report.productionReleaseAllowed).toBe(false);
  });
  it("fails closed for missing callback or a callback inventing approvals",async()=>{
    await expect(runSyntheticOnlyModelEvaluation(
      null as unknown as Parameters<typeof runSyntheticOnlyModelEvaluation>[0]
    )).rejects.toThrow("synthetic_model_callback_required");
    await expect(runSyntheticOnlyModelEvaluation(async p=>({
      ...mock(p.id),ownerApprovalGranted:true,
    }))).rejects.toThrow("synthetic_semantic_prediction_schema_or_overclaim_hold");
  });
  it("will not run on Railway",async()=>{
    process.env.RAILWAY_ENVIRONMENT_ID="synthetic";
    await expect(runSyntheticOnlyModelEvaluation(async p=>mock(p.id)))
      .rejects.toThrow("synthetic_model_evaluation_forbidden_in_railway");
  });
});

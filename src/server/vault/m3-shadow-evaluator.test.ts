import {describe,expect,it} from "vitest";
import {M2_POLICY} from "./research-decision-v2";
import {M3_SHADOW_CASES,getM3ShadowModelInputs} from "./m3-shadow-corpus";
import {measureM551LegacyBaseline,runM3ShadowWithInjectedCandidate,
  scoreM3ShadowJudgments,type M3ShadowJudgment} from "./m3-shadow-evaluator";

const expected=(id:string):M3ShadowJudgment=>{
  const c=M3_SHADOW_CASES.find(x=>x.id===id);
  if(!c)throw Error("missing synthetic fixture");
  return {caseId:id,policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
    disposition:c.gold.reviewSafe?"accept_qualified":"hold_unsupported",
    conclusion:c.gold.reviewSafe?"conditional":"no_change",
    evidenceState:"unresolved",citedIds:c.gold.requiredCitationIds,
    reasonTh:"เนื้อหาจำลอง ต้องแยกข้ออ้างที่ยังไม่ยืนยันจากข้อเท็จจริง",
    missingEvidenceTh:"ต้องตรวจต้นฉบับและความเกี่ยวข้องของตัวเลขก่อนเชื่อมต่อ Earnings"};
};

describe("M3a fixed fictional shadow semantic benchmark",()=>{
  it("contains balanced cross-room cases without any gold answers in the model input",()=>{
    const data=getM3ShadowModelInputs();
    expect(data).toHaveLength(20);
    expect(new Set(data.map(x=>x.id)).size).toBe(20);
    expect(new Set(data.map(x=>x.room))).toEqual(new Set(["micro","macro","pdf"]));
    expect(M3_SHADOW_CASES.filter(x=>x.gold.reviewSafe).length).toBeGreaterThan(6);
    expect(M3_SHADOW_CASES.filter(x=>!x.gold.reviewSafe).length).toBeGreaterThan(6);
    for(const view of data){
      expect(view.origin).toBe("fictional_synthetic_only");
      expect(view).not.toHaveProperty("gold");
      expect(JSON.stringify(view)).not.toContain("reasonCode");
      expect(JSON.stringify(view)).not.toContain("requiredCitationIds");
      expect(JSON.stringify(view)).not.toContain("reviewSafe");
    }
  });

  it("measures the unchanged legacy regex gate on both unsupported claims and legitimate qualified Reviews",()=>{
    const old=measureM551LegacyBaseline();
    expect(old.caseCount).toBe(20);
    expect(old.realModelInvoked).toBe(false);
    expect(old.productionReleaseAllowed).toBe(false);
    expect(old.rows.some(x=>x.caseId==="absolute_amount_unsupported"&&x.falseVerified)).toBe(true);
    expect(old.rows.some(x=>x.caseId==="broker_pt_called_company_guidance"&&x.falseVerified)).toBe(true);
    expect(old.rows.some(x=>x.caseId==="qualified_conflicting_guidance"&&x.oldGateWouldAllow)).toBe(true);
    expect(old.metrics.falseVerified).toBeGreaterThan(0);
  });

  it("scores injected fictional oracle predictions over 3 trials, clearly without claiming real provider inference",async()=>{
    const result=await runM3ShadowWithInjectedCandidate(async p=>expected(p.id),3);
    expect(result.trialCount).toBe(3);
    expect(result.trials.every(t=>t.passesSyntheticSafetyTripwire)).toBe(true);
    expect(result.trials.every(t=>t.metrics.falseVerified===0&&t.metrics.falseHold===0)).toBe(true);
    expect(result.realModelInvokedByHarness).toBe(false);
    expect(result.responseSource).toBe("injected_candidate_not_authenticated_provider");
    expect(result.productionReleaseAllowed).toBe(false);
    expect(result.writesPerformed).toBe(false);
  });

  it("detects critical false verified, false hold and invented/missing citations independently",()=>{
    const answers=M3_SHADOW_CASES.map(c=>expected(c.id));
    answers.find(x=>x.caseId==="p0_opposed_guidance_values")!.disposition="accept_qualified";
    answers.find(x=>x.caseId==="pdf_limited_excerpt_disclosed")!.disposition="hold_unsupported";
    answers.find(x=>x.caseId==="repost_misread_as_independence")!.citedIds=["S0","FAKE-ID"];
    const scored=scoreM3ShadowJudgments(answers);
    expect(scored.metrics.criticalFalseVerified).toBeGreaterThanOrEqual(1);
    expect(scored.metrics.falseHold).toBe(1);
    expect(scored.metrics.invalidCitations).toBeGreaterThanOrEqual(1);
    expect(scored.passesSyntheticSafetyTripwire).toBe(false);
    expect(scored.realModelInvokedByScorer).toBe(false);
  });

  it("flags an AI-issued primary-verified claim as unsupported even when the Review is held",()=>{
    const answers=M3_SHADOW_CASES.map(c=>expected(c.id));
    const a=answers.find(x=>x.caseId==="p0_unverified_guidance_as_fact")!;
    a.evidenceState="verified_primary";a.conclusion="confirmed";
    const scored=scoreM3ShadowJudgments(answers);
    expect(scored.metrics.unsupportedPrimaryClaims).toBe(1);
    expect(scored.metrics.criticalFalseVerified).toBe(1);
    expect(scored.passesSyntheticSafetyTripwire).toBe(false);
  });

  it("holds duplicate, extra-key, malformed-hash and missing-case predictions",()=>{
    const all=M3_SHADOW_CASES.map(c=>expected(c.id));
    expect(()=>scoreM3ShadowJudgments(all.slice(0,-1))).toThrow("M3_SHADOW_COMPLETE_FROZEN_SET_REQUIRED");
    expect(()=>scoreM3ShadowJudgments([...all.slice(0,-1),all[0]]))
      .toThrow("M3_SHADOW_DUPLICATE_OR_UNKNOWN_CASE_ID");
    expect(()=>scoreM3ShadowJudgments([...all.slice(0,-1),{...all.at(-1)!,policySha256:"0".repeat(64)}]))
      .toThrow();
    expect(()=>scoreM3ShadowJudgments([...all.slice(0,-1),{...all.at(-1)!,approveThesis:true}]))
      .toThrow();
  });

  it("refuses unbounded trials, mismatched result identity and Railway execution",async()=>{
    await expect(runM3ShadowWithInjectedCandidate(async p=>expected(p.id),10)).rejects.toThrow();
    await expect(runM3ShadowWithInjectedCandidate(async p=>({...expected(p.id),caseId:"wrong"}),1))
      .rejects.toThrow("M3_SHADOW_PREDICTION_CASE_ID_MISMATCH");
    const previous=process.env.RAILWAY_PROJECT_ID;
    try{
      process.env.RAILWAY_PROJECT_ID="synthetic-no-provider";
      await expect(runM3ShadowWithInjectedCandidate(async p=>expected(p.id),1))
        .rejects.toThrow("M3_SHADOW_CALLBACK_FORBIDDEN_IN_RAILWAY");
    }finally{
      if(previous===undefined)delete process.env.RAILWAY_PROJECT_ID;
      else process.env.RAILWAY_PROJECT_ID=previous;
    }
  });
});

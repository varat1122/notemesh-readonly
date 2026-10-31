import {describe,it,expect} from "vitest";
import {validateSpecialistOutput,compareSpecialistOutputs,type SpecialistOutput} from "./research-specialist-output";

const fundamental:SpecialistOutput={
  role:"fundamental",
  question:"ผลประกอบการไตรมาสนี้เปลี่ยนสมมติฐานกระแสเงินสดหรือไม่",
  findings:["รายได้ data center โตต่อเนื่องตามที่บริษัทรายงาน"],
  claims:[{statement:"Data center revenue USD 30 billion in FY2027Q2",origin:"verified_primary",sourceIds:["src:issuer-10q-fy27q2"]},
    {statement:"Margin อาจลดลงจาก product mix",origin:"ai_inference",sourceIds:[]}],
  mechanism:"Demand → Revenue → Gross margin → FCF",
  estimates:[{metric:"revenue_data_center",period:"FY2027Q2",value:"30",unit:"USD billion",basis:"reported",sourceIds:["src:issuer-10q-fy27q2"]}],
  counterEvidence:["Inventory เพิ่มเร็วกว่ารายได้"],
  uncertainties:["ยังไม่มี consensus ที่มีเวลาตรวจได้"],
  requiredEvidence:["Consensus snapshot พร้อม as-of"],
  confidenceBasis:"ตัวเลขจาก 10-Q ต้นฉบับ; margin เป็นการอนุมาน",
  asOf:"2026-10-31",
  horizon:"quarters",
  proposedThesisImpact:"incremental",
  shouldAbstain:false,
  abstainReasons:[],
};

describe("Blueprint §07.3 specialist output contract",()=>{
  it("accepts a sourced fundamental review with an explicit AI inference",()=>{
    expect(validateSpecialistOutput(fundamental)).toEqual([]);
  });

  it("rejects sourced-looking claims and numbers that have no source",()=>{
    expect(validateSpecialistOutput({...fundamental,
      claims:[{statement:"Broker says target up",origin:"attributed_commentary",sourceIds:[]}],
      estimates:[{metric:"eps",period:"FY2027",value:"5.10",unit:"USD",basis:"broker",sourceIds:[]}],
    })).toEqual(expect.arrayContaining(["claim_without_source","estimate_value_without_source"]));
  });

  it("allows a model number only with stated assumptions",()=>{
    const model={metric:"fcf",period:"FY2028",value:"40",unit:"USD billion",basis:"model" as const,sourceIds:[]};
    expect(validateSpecialistOutput({...fundamental,estimates:[model]})).toContain("model_estimate_without_assumptions");
    expect(validateSpecialistOutput({...fundamental,estimates:[{...model,assumptions:["capex คงที่ 10% ของรายได้"]}]})).toEqual([]);
  });

  it("does not let AI inference alone change a thesis",()=>{
    expect(validateSpecialistOutput({...fundamental,proposedThesisImpact:"thesis_changing",
      claims:[{statement:"Demand อาจชะลอ",origin:"ai_inference",sourceIds:[]}]})).toContain("thesis_change_without_sourced_claim");
  });

  it("requires counter-evidence and a mechanism unless the specialist abstains",()=>{
    expect(validateSpecialistOutput({...fundamental,counterEvidence:[],mechanism:" "})).toEqual(
      expect.arrayContaining(["counter_evidence_missing","mechanism_missing"]));
  });

  it("makes abstention explicit and empty of conclusions",()=>{
    const abstain:SpecialistOutput={...fundamental,role:"supply_chain",shouldAbstain:true,findings:[],mechanism:"",counterEvidence:[],
      estimates:[],abstainReasons:["no_observed_customer_exposure"],proposedThesisImpact:"none"};
    expect(validateSpecialistOutput(abstain)).toEqual([]);
    expect(validateSpecialistOutput({...abstain,abstainReasons:[],proposedThesisImpact:"new",estimates:fundamental.estimates}))
      .toEqual(expect.arrayContaining(["abstain_reason_missing","abstain_must_not_propose_thesis_impact","abstain_must_not_carry_estimates"]));
    expect(validateSpecialistOutput({...fundamental,abstainReasons:["stale_pricing_data"]})).toContain("abstain_reasons_without_abstain");
  });

  it("rejects ambiguous as-of times and unknown enums",()=>{
    expect(validateSpecialistOutput({...fundamental,asOf:"2026-10-31T09:00:00"})).toContain("as_of_invalid");
    expect(validateSpecialistOutput({...fundamental,asOf:"2026-10-31T09:00:00+07:00"})).toEqual([]);
    expect(validateSpecialistOutput({...fundamental,asOf:"2026-13-40"})).toContain("as_of_invalid");
    expect(validateSpecialistOutput({...fundamental,asOf:"2026-02-30"})).toContain("as_of_invalid");
    expect(validateSpecialistOutput({...fundamental,role:"oracle" as never,horizon:"forever" as never}))
      .toEqual(expect.arrayContaining(["role_unknown","horizon_unknown"]));
  });
});

describe("specialist comparison",()=>{
  it("reports disagreement and shared sources instead of voting",()=>{
    const trading:SpecialistOutput={...fundamental,role:"momentum_technical",horizon:"days",proposedThesisImpact:"contradiction",
      claims:[{statement:"Price fell after release",origin:"secondary_reporting",sourceIds:["src:issuer-10q-fy27q2"]}]};
    const result=compareSpecialistOutputs([fundamental,trading]);
    expect(result.disagreement).toBe(true);
    expect(result.impactsByRole).toEqual({incremental:["fundamental"],contradiction:["momentum_technical"]});
    expect(result.citationCount).toBe(2);
    expect(result.distinctSourceCount).toBe(1);
    expect(result.sharedSourceIds).toEqual(["src:issuer-10q-fy27q2"]);
  });

  it("does not count an abstention as a disagreement",()=>{
    const abstain:SpecialistOutput={...fundamental,role:"red_team",shouldAbstain:true,abstainReasons:["missing_original_source"],proposedThesisImpact:"none"};
    expect(compareSpecialistOutputs([fundamental,abstain]).disagreement).toBe(false);
  });
});

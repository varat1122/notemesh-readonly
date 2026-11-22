import {describe,expect,it} from "vitest";
import {validateResearchM55,type ResearchClassification,type ThaiResearchReview} from "./research-quality-m55";

const classification:ResearchClassification={domain:"company",subject:"MU",
  companyHubPaths:["01_Companies/MU.md"],industryHubPaths:[],entityScope:["MU"],
  sourceChannel:"user_submitted",sourceKind:"issuer_release",contentTypes:["reported_fact"],
  originalDocumentAccess:"not_obtained",sourceLanguage:"en"};
const base:ThaiResearchReview={
  headlineTh:"ข่าวเกี่ยวกับ MU ที่ยังต้องตรวจสอบ",
  translationTh:"มีรายงานตัวเลขที่ผู้ส่งอ้างถึง แต่ยังไม่ได้ตรวจต้นฉบับ",
  whatChangedTh:"ยังไม่ยืนยันว่าข่าวนี้เป็นเหตุการณ์ใหม่",
  mechanismTh:"อุปสงค์อาจส่งผลต่อรายได้และกำไร",
  thesisImplicationTh:"ไม่มีหลักฐานพอสำหรับการเปลี่ยน Thesis",
  counterEvidenceTh:"ยังไม่มีรายงานบริษัทที่ตรวจสอบได้",
  requiredEvidenceTh:"ต้องตรวจเอกสารต้นฉบับและงวดบัญชี"};
const unresolved={entity:"MU",metric:"revenue growth guidance",period:"FY2027",unit:"% YoY",
  competingValues:["+20%","-20%"],resolution:"unresolved" as const,conclusion:"conditional" as const};

describe("M5.5.1 adversarial evidence-prose coherence",()=>{
  it.each([
    ["implicit verified revenue",{whatChangedTh:"รายได้ MU FY2027 โต 20% แน่นอน"}],
    ["softened confirmation",{whatChangedTh:"ยอดขาย MU FY2027 เพิ่มขึ้น 20% ตามที่ตลาดทราบกัน"}],
    ["English claim embedded in Thai",{whatChangedTh:"MU FY2027 revenue growth +20% เป็นข้อมูลล่าสุด"}],
    ["headline-as-confirmation",{headlineTh:"MU FY2027 Revenue +20% แล้ว"}],
    ["forecast-as-fact",{thesisImplicationTh:"EPS MU FY2027 จะเพิ่มขึ้น 30% และควรปรับประมาณการ"}]
  ])("holds unsupported quantified certainty: %s",(_label,fields)=>{
    const issues=validateResearchM55(classification,{...base,...fields});
    expect(issues).toContain("material_numeric_claim_assessment_missing");
  });

  it("holds unsupported numeric certainty even when an unrelated unresolved assessment is supplied",()=>{
    const issues=validateResearchM55(classification,{...base,claimAssessments:[unresolved],
      whatChangedTh:"MU FY2027 revenue เพิ่ม 40%"});
    expect(issues).toContain("material_numeric_value_unassessed");
  });

  it("rejects an assessment with the same number but a different financial metric",()=>{
    const grossMargin={...unresolved,metric:"gross margin",competingValues:["+20%","-20%"]};
    const issues=validateResearchM55(classification,{...base,claimAssessments:[grossMargin],
      whatChangedTh:"มีรายงานอ้างว่า MU FY2027 revenue เพิ่ม +20%"});
    expect(issues).toContain("material_numeric_metric_unassessed");
  });

  it("rejects a different fiscal-year vintage even with matching metric and percentage",()=>{
    const stale={...unresolved,period:"FY2026"};
    const issues=validateResearchM55(classification,{...base,claimAssessments:[stale],
      whatChangedTh:"มีรายงานอ้างว่า MU FY2027 revenue เพิ่ม +20%"});
    expect(issues).toContain("material_numeric_period_unassessed");
  });

  it("holds a declarative +20% headline despite a formally unresolved contradictory assessment",()=>{
    const issues=validateResearchM55(classification,{...base,claimAssessments:[unresolved],
      headlineTh:"MU FY2027 revenue guidance +20%"});
    expect(issues).toContain("unresolved_numeric_claim_lacks_attribution");
  });

  it("accepts explicit uncertainty and attribution with both competing values",()=>{
    const issues=validateResearchM55(classification,{...base,claimAssessments:[unresolved],
      headlineTh:"ข่าวอ้าง MU FY2027 revenue guidance +20% แต่ยังตรวจสอบไม่ได้",
      whatChangedTh:"แหล่ง A อ้าง +20% แต่ข่าว B อ้าง -20%; สองแหล่งยังไม่ได้รับการยืนยัน"},
      "A says +20% revenue guidance, B says -20% revenue guidance; originals unavailable.");
    expect(issues).toEqual([]);
  });

  it("does not treat translated secondary-source numbers as the AI's own factual assertion",()=>{
    const issues=validateResearchM55(classification,{...base,
      translationTh:"ข้อความต้นทางอ้างรายได้ +20% และ -20% แต่ยังไม่ทราบหลักฐาน"});
    expect(issues).toEqual([]);
  });

  it("holds source-text guidance not labeled as such and containing forecast percentage",()=>{
    const issues=validateResearchM55(classification,base,
      "Source A: MU FY2027 revenue forecast +20%. Source B: MU FY2027 revenue forecast -20%.");
    expect(issues).toContain("source_text_guidance_assessment_missing");
  });
});

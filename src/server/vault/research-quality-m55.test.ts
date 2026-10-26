import {describe,it,expect} from "vitest";
import {validateResearchM55,renderThaiResearchM55,type ResearchClassification,type ThaiResearchReview} from "./research-quality-m55";

const review:ThaiResearchReview={
  headlineTh:"บทวิเคราะห์ที่อ้าง JPMorgan กล่าวถึงวัฏจักรหุ้นหน่วยความจำ",
  translationTh:"ข้อความที่ผู้ใช้ส่งอ้างถึงรายงานธนาคาร แต่ยังไม่ได้ตรวจต้นฉบับ",
  whatChangedTh:"ยังไม่ยืนยันว่าเป็นเหตุการณ์ใหม่หรือการแชร์ข้อมูลเก่า",
  mechanismTh:"การปรับตัวของราคา Memory อาจกระทบกำไร แต่ยังไม่มีข้อมูลประมาณการที่ตรวจสอบแล้ว",
  thesisImplicationTh:"ยังไม่เปลี่ยน Thesis และยังสรุปจุดต่ำสุดของราคาไม่ได้",
  counterEvidenceTh:"ไม่มีชุดข้อมูลต้นฉบับของผลตอบแทนในแต่ละวัฏจักร",
  requiredEvidenceTh:"ต้องตรวจรายงาน JPMorgan ต้นฉบับและช่วงเวลาตัวเลข"
};
const memory:ResearchClassification={domain:"industry",subject:"Memory",resolvedSubjectPath:"02_Industries_Themes/Memory.md",
  contentTypes:["analyst_opinion","market_commentary"],companyHubPaths:["01_Companies/MU.md","01_Companies/SK hynix.md","01_Companies/Samsung.md"],
  industryHubPaths:["02_Industries_Themes/Memory.md"],sourceChannel:"social_repost",attributedOrigin:"J.P. Morgan",
  originalDocumentAccess:"excerpt_only",sourceLanguage:"en"};

describe("M5.5 pre-write research contract",()=>{
  it("validates an attributed Memory repost without upgrading it to a broker original",()=>{
    expect(validateResearchM55(memory,review)).toEqual([]);
    expect(renderThaiResearchM55(review)).toContain("## Counter-evidence");
  });
  it("fails closed when the real-world caller omits classification metadata",()=>{
    expect(validateResearchM55({...memory,subject:"Cross Theme",resolvedSubjectPath:undefined,
      contentTypes:[],companyHubPaths:[],industryHubPaths:[]},review)).toEqual(expect.arrayContaining([
        "classification_primary_subject_unresolved","content_types_missing","industry_hub_unresolved","primary_theme_not_resolved"]));
  });
  it("does not confuse an X repost with the full JPMorgan report",()=>{
    expect(validateResearchM55({...memory,originalDocumentAccess:"full_original"},review)).toContain("repost_cannot_claim_full_original_without_separate_receipt");
    expect(validateResearchM55({...memory,originalDocumentAccess:undefined,attributedOrigin:undefined},review)).toEqual(expect.arrayContaining([
      "original_document_access_unresolved","repost_attributed_origin_missing"]));
  });
  it("requires Thai research content and a translation for non-Thai input",()=>{
    expect(validateResearchM55(memory,{...review,translationTh:undefined,headlineTh:"Memory market update"})).toEqual(expect.arrayContaining([
      "headlineTh_thai_required","foreign_source_translation_missing"]));
  });
  it("accepts an explicitly unresolved secondary-source guidance contradiction",()=>{
    const input={...memory,domain:"company" as const,subject:"MU",sourceKind:"user_commentary",
      contentTypes:["guidance","market_commentary"],originalDocumentAccess:"not_obtained" as const};
    const assessment={metric:"revenue growth guidance",period:"FY2027",unit:"% YoY",
      competingValues:["+20%","-20%"],resolution:"unresolved" as const,conclusion:"no_change" as const};
    expect(validateResearchM55(input,{...review,claimAssessments:[assessment]})).toEqual([]);
    expect(validateResearchM55(input,review)).toContain("guidance_claim_assessment_missing");
    expect(renderThaiResearchM55({...review,claimAssessments:[assessment]})).toContain("FY2027");
    expect(validateResearchM55({...input,sourceKind:"issuer_release"},review))
      .toContain("guidance_claim_assessment_missing");
  });
  it("holds an explicit verified-fact assertion without proof even when classified as ordinary reported facts",()=>{
    const asserted={...review,whatChangedTh:"ยืนยันแล้วว่ารายได้ MU FY2027 โต 20%",
      thesisImplicationTh:"ต้องปรับเพิ่ม EPS ทันที"};
    expect(validateResearchM55({...memory,sourceKind:"issuer_release",contentTypes:["reported_fact"]},asserted))
      .toContain("explicit_verified_claim_requires_assessment");
    expect(validateResearchM55(memory,review)).toEqual([]);
  });
  it("holds fabricated confirmation of contradictory unverified FY2027 guidance",()=>{
    const input={...memory,domain:"company" as const,subject:"MU",sourceKind:"user_commentary",
      contentTypes:["guidance"],originalDocumentAccess:"not_obtained" as const};
    const claim={metric:"revenue guidance",period:"FY2027",unit:"% YoY",competingValues:["+20%","-20%"],
      resolution:"verified_primary" as const,conclusion:"confirmed" as const};
    expect(validateResearchM55(input,{...review,claimAssessments:[claim]})).toEqual(expect.arrayContaining([
      "conflicting_claims_unresolved","verified_claim_without_primary_evidence",
      "primary_evidence_receipt_validation_pending"]));
    expect(validateResearchM55({...input,originalDocumentAccess:"full_original"},
      {...review,claimAssessments:[{...claim,primaryEvidenceReceipt:"caller-invented-receipt"}]}))
      .toContain("primary_evidence_receipt_validation_pending");
    const unresolved={...claim,resolution:"unresolved" as const};
    expect(validateResearchM55(input,{...review,claimAssessments:[unresolved]})).toContain("thesis_conclusion_exceeds_evidence");
    expect(validateResearchM55(input,{...review,claimAssessments:[{...unresolved,conclusion:"no_change"}],
      thesisImplicationTh:"ยืนยันแล้วว่าต้องปรับเพิ่ม EPS ทันที"})).toContain("unresolved_claim_asserted_as_verified");
  });
});

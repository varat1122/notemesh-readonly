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
  });
  it("requires Thai research content and a translation for non-Thai input",()=>{
    expect(validateResearchM55(memory,{...review,translationTh:undefined,headlineTh:"Memory market update"})).toEqual(expect.arrayContaining([
      "headlineTh_thai_required","foreign_source_translation_missing"]));
  });
});

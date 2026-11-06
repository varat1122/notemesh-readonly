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
    expect(renderThaiResearchM55(review)).toContain("## หลักฐานโต้แย้งและความเสี่ยง");
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
  it("requires an AI claim decision when submitted guidance is mislabeled as reported_fact",()=>{
    const renamed={...memory,sourceKind:"issuer_release",contentTypes:["reported_fact"]};
    const original="MU FY2027 revenue guidance +20% according to source A; source B reports -20%.";
    expect(validateResearchM55(renamed,review,original))
      .toContain("source_text_guidance_assessment_missing");
    const claim={entity:"MU",metric:"revenue guidance",period:"FY2027",unit:"% YoY",
      competingValues:["+20%","-20%"],resolution:"unresolved" as const,
      conclusion:"conditional" as const};
    expect(validateResearchM55(renamed,{...review,claimAssessments:[claim]},original)).toEqual([]);
    expect(validateResearchM55(renamed,{...review,claimAssessments:[{...claim,
      conclusion:"confirmed"}]},original)).toContain("thesis_conclusion_exceeds_evidence");
    expect(validateResearchM55(renamed,{...review,claimAssessments:[claim],
      whatChangedTh:"พิสูจน์แล้วว่าบริษัท MU เพิ่ม Guidance 20%"},original))
      .toContain("unresolved_claim_asserted_as_verified");
    expect(validateResearchM55(renamed,{...review,claimAssessments:[claim],
      headlineTh:"ยืนยันแล้วว่า MU Guidance +20%"},original))
      .toContain("unresolved_claim_asserted_as_verified");
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

const languageFields=["headlineTh","translationTh","whatChangedTh","mechanismTh","thesisImplicationTh","counterEvidenceTh","requiredEvidenceTh"] as const;
const untranslated="The company's revenue improves as demand recovers. Margins remain uncertain and the cash flow forecast requires independent verification.";
const wrappers=[
  ["straight quotes",(s:string)=>`"${s}"`],
  ["curly quotes",(s:string)=>`“${s}”`],
  ["single quotes",(s:string)=>`'${s}'`],
  ["blockquote",(s:string)=>`> ${s}`],
  ["backtick fence",(s:string)=>`\x60\x60\x60text\n${s}\n\x60\x60\x60`],
  ["tilde fence",(s:string)=>`~~~text\n${s}\n~~~`],
  ["inline code",(s:string)=>`\x60${s}\x60`]
] as const;
const languageIssue=(field:typeof languageFields[number])=>field==="translationTh"?"translation_not_thai":`${field}_thai_required`;

describe("RI-001 final mechanical Thai language calibration",()=>{
  it.each(wrappers)("rejects short Thai prefix + English-only %s in every prose field",(_name,wrap)=>{
    for(const field of languageFields){
      const issues=validateResearchM55(memory,{...review,[field]:`สรุปเป็นภาษาไทย\n\n${wrap(untranslated)}`});
      expect(issues,field).toContain(languageIssue(field));
    }
  });
  it.each([
    "Revenue, EBITDA, Margin, Guidance, FCF, ROIC ดีขึ้นแต่ยังต้องติดตาม",
    "Revenue เพิ่ม แต่ EBITDA Margin ลด ขณะที่ Guidance ชี้ว่า FCF และ ROIC ยังอ่อน",
    "MU Backlog และ FCF เพิ่ม แต่ ROIC ยังต่ำกว่า WACC",
    "NVIDIA Corporation และ Advanced Micro Devices ยังต้องตรวจผลต่อ operating leverage และ free cash flow ก่อนสรุป"
  ])("accepts mixed Thai finance narration without a term/name allowlist: %s",text=>{
    for(const field of languageFields)expect(validateResearchM55(memory,{...review,[field]:text}),field).not.toContain(languageIssue(field));
  });
  it.each(wrappers)("allows genuine supporting %s with substantive Thai narration",(_name,wrap)=>{
    const explanation="ข้อความนี้เป็นเพียงข้ออ้างของบริษัทที่ยังต้องตรวจสอบกับเอกสารต้นฉบับและงวดบัญชี โดยความต้องการซื้ออาจเปลี่ยนแปลงได้และไม่ควรใช้ข้อความที่อ้างมาแทนคำอธิบายผลกระทบด้านรายได้ ต้นทุน และความเสี่ยงทั้งหมด";
    expect(validateResearchM55(memory,{...review,mechanismTh:explanation+"\n\n"+wrap("Orders can be cancelled and shipment is not guaranteed.")})).toEqual([]);
  });
  it("allows formulas, numbers, inline terms, company names and actual code with Thai explanation",()=>{
    const text='NVIDIA ใช้ "FCF" ประกอบการประเมิน แต่ต้องแยกผลจากการลงทุนและเงินทุนหมุนเวียนออกจากการเติบโตของรายได้ก่อนสรุป\n\n```js\nconst fcf = operatingCashFlow - capex;\n```\n\nสูตร `ROIC = NOPAT / investedCapital` ช่วยเปรียบเทียบผลตอบแทน แต่ยังต้องตรวจสอบนิยามและช่วงเวลาของตัวเลข';
    expect(validateResearchM55(memory,{...review,mechanismTh:text})).toEqual([]);
  });
  it("rejects untranslated dominance, a standalone English paragraph and unclosed fences",()=>{
    const padded="คำอธิบายภาษาไทยมีความยาวพอสมควร แต่ไม่ใช่คำแปลหรือการวิเคราะห์เนื้อหาทั้งหมด";
    for(const text of [padded+'\n\n"'+untranslated.repeat(12)+'"',padded+"\n\n"+untranslated,
      "สรุปเป็นภาษาไทย\n```text\n"+untranslated]){
      expect(validateResearchM55(memory,{...review,translationTh:text})).toContain("translation_not_thai");
    }
  });
  it("treats Thai marks as parts of words, not extra votes; isolated Thai letters/digits cannot establish narration",()=>{
    for(const text of ["ก English analysis with only one Thai letter.","๑๒๓ Revenue and EBITDA improve.","่่่่่่ Revenue and EBITDA improve.","กกกกกกกก \""+untranslated+'"'])
      expect(validateResearchM55(memory,{...review,mechanismTh:text})).toContain("mechanismTh_thai_required");
  });
  it("does not claim semantic translation fidelity from a mechanical language PASS",()=>{
    // Deliberately unrelated Thai: semantic adequacy belongs to LLM/reviewer.
    expect(validateResearchM55(memory,{...review,translationTh:"ต้นไม้ในสวนเติบโตและต้องได้รับน้ำอย่างเพียงพอทุกวัน"},"Revenue was reported by the company.")).not.toContain("translation_not_thai");
  });
});


describe("Thai supporting-text boundary edge cases",()=>{
  it("cannot split foreign prose into short quoted/code pieces or put it in a fence info string",()=>{
    const prefix="คำแปลภาษาไทยมีดังนี้";
    for(const payload of [
      '"Revenue" "is" "expected" "to" "increase" "next" "year"',
      "```text\nRevenue is\nexpected to\nincrease next\nyear\n```",
      "```"+untranslated+"\n```"
    ])expect(validateResearchM55(memory,{...review,translationTh:prefix+"\n\n"+payload})).toContain("translation_not_thai");
  });
  it("keeps contractions, nested code delimiters and display formulas as supporting text",()=>{
    const explanation="ข้อความที่อ้างจากบริษัทนี้ยังต้องตรวจสอบกับเอกสารต้นฉบับก่อนสรุปผลต่อรายได้และต้นทุน โดยสูตรเป็นเพียงวิธีคำนวณและไม่ได้ยืนยันว่าตัวเลขตั้งต้นถูกต้อง";
    for(const supporting of ["'The company's orders remain uncertain.'","‘The company’s orders remain uncertain.’",
      "````js\nconst label = `company`;\n`````","$$ROIC = NOPAT / investedCapital$$"])
      expect(validateResearchM55(memory,{...review,mechanismTh:explanation+"\n\n"+supporting})).toEqual([]);
  });
});


it.each(wrappers)("rejects a Thai label even when its %s English payload is short",(_name,wrap)=>{
  for(const field of languageFields)for(const english of ["Revenue","Revenue grew.","Growth remains uncertain."])
    expect(validateResearchM55(memory,{...review,[field]:"คำแปลภาษาไทยมีดังนี้\n\n"+wrap(english)}),field).toContain(languageIssue(field));
});

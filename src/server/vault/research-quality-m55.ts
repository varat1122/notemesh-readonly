/** M5.5 research contract: read-only pre-write checks, no Vault mutations. */
import { validatePrimaryEvidenceReceipt } from "./primary-evidence-receipt-m551";
export interface ThaiResearchReview {
  headlineTh:string;
  translationTh?:string;
  whatChangedTh:string;
  mechanismTh:string;
  thesisImplicationTh:string;
  counterEvidenceTh:string;
  requiredEvidenceTh:string;
  /** Caller-declared, never an independent verification receipt. */
  claimAssessments?:ResearchClaimAssessment[];
}

export interface ResearchClaimAssessment {
  /** Explicit identity; never infer verification from the intake's main ticker. */
  entity?:string;
  metric:string;
  period:string;
  unit:string;
  /** Different values for the same metric/period/definition, not separate vintages. */
  competingValues:string[];
  resolution:"unresolved"|"verified_primary";
  conclusion:"no_change"|"conditional"|"confirmed";
  /** A claim of primary verification must be backed by a separate verifiable receipt. */
  primaryEvidenceReceipt?:string;
  primarySourceUrl?:string;
  verifiedValue?:string;
}

export interface ResearchClassification {
  domain:"company"|"industry"|"macro"|"asset";
  subject:string;
  resolvedSubjectPath?:string;
  contentTypes:string[];
  companyHubPaths:string[];
  industryHubPaths:string[];
  sourceChannel:string;
  attributedOrigin?:string;
  originalDocumentAccess?:"full_original"|"excerpt_only"|"not_obtained";
  sourceLanguage?:string|null;
  sourceKind?:string;
  entityScope?:string[];
}

const thai=(s:string)=>/[\u0e00-\u0e7f]/u.test(s);
const nonblank=(s:string|undefined)=>Boolean(s?.trim());
const validHub=(path:string,prefix:string)=>path.startsWith(prefix)&&path.endsWith(".md")&&!path.includes("..")&&!path.includes("\\");

// These bounded checks are a *secondary* semantic tripwire, not a proof that
// all prose claims have been discovered. Assertions without percentages,
// paraphrases, wrong scope and fabricated attributions still need adversarial
// evaluation. Do not apply to translations, which must preserve the source.
const materialMetric=/(?:รายได้|ยอดขาย|กำไร|กำไรต่อหุ้น|ราคาเป้าหมาย|อัตรากำไร|คำสั่งซื้อ|แนวโน้ม|revenue|sales|earnings|profit|\bEPS\b|margin|guidance|outlook|forecast|target price|shipments?|inflation|\bGDP\b|\bCPI\b)/iu;
const numericPercent=/[+\-\u2212]?\s*\d+(?:[,.]\d+)?\s*[%％]/gu;
const explicitlyQualified=/(?:ข่าวลือ|ข่าวอ้าง|แหล่ง.{0,30}อ้าง|อ้าง(?:ว่า)?|รายงาน(?:ว่า)?|ตาม(?:ข่าว|รายงาน|แหล่ง)|ยังไม่|ไม่ยืนยัน|ไม่ชัด|ไม่แน่|อาจ|หาก|สมมติ|กรณี|เป็นไปได้|ขัดแย้ง|สวนทาง|รอตรวจ|ต้องตรวจ|คาดว่า|\breported\b|according to|unverified|rumou?r|disputed|alleged|\bif\b|scenario|conditional|uncertain)/iu;
const metricCategories={
  eps:/(?:กำไรต่อหุ้น|\bEPS\b)/iu,
  margin:/(?:อัตรากำไร|\bmargin\b)/iu,
  revenue:/(?:รายได้|ยอดขาย|\brevenue\b|\bsales\b)/iu,
  profit:/(?:กำไร|\bprofit\b|\bearnings\b)/iu,
  orders:/(?:คำสั่งซื้อ|\borders?\b|\bshipments?\b)/iu,
  target:/(?:ราคาเป้าหมาย|target price)/iu,
  inflation:/(?:เงินเฟ้อ|\binflation\b|\bCPI\b)/iu,
  gdp:/(?:\bGDP\b|เศรษฐกิจเติบโต)/iu,
  guidance:/(?:แนวโน้ม|\bguidance\b|\bforecast\b|\boutlook\b)/iu
};
function metricCategory(s:string):string|null {
  const hits=Object.entries(metricCategories).filter(([,p])=>p.test(s)).map(([key])=>key);
  if(hits.includes("profit")&&(hits.includes("eps")||hits.includes("margin")))
    hits.splice(hits.indexOf("profit"),1);
  if(hits.includes("guidance")&&hits.some(x=>x!=="guidance"))
    hits.splice(hits.indexOf("guidance"),1);
  return hits.length===1?hits[0]:null;
}
const normalizedPercent=(s:string):string|null=>{
  const ascii=s.normalize("NFKC").replace(/\u2212/g,"-").replace(/\s/g,"").replace(/,/g,"");
  const m=/^([+-]?)(\d+(?:\.\d+)?)%$/.exec(ascii);
  return m?(m[1]==="-"?"-":"+")+String(Number(m[2]))+"%":null;
};
const canonicalPeriod=(s:string)=>s.toUpperCase().replace(/[\s-]/g,"");
function numericMaterialClauses(review:ThaiResearchReview):Array<{
  text:string;values:string[];metric:string|null;periods:string[]}>{
  return [review.headlineTh,review.whatChangedTh,review.mechanismTh,review.thesisImplicationTh]
    .flatMap(section=>section.split(/(?:[.!?](?=\s|$)|[;\n])/u))
    .filter(text=>materialMetric.test(text))
    .map(text=>({text,metric:metricCategory(text),
      periods:[...text.matchAll(/\b(?:FY|CY)[\s-]?(?:20\d{2}|\d{2})\b/giu)]
        .map(m=>canonicalPeriod(m[0])),
      values:[...text.matchAll(numericPercent)]
      .map(m=>normalizedPercent(m[0])).filter((v):v is string=>Boolean(v))}))
    .filter(clause=>clause.values.length>0);
}

/**
 * Automated adjudication boundary: the AI may choose a conservative
 * no_change/conditional decision without a human approver. Its own words and
 * the submitted source text are NEVER authority to mint verified_primary.
 * sourceText is a sensitivity check only; it is not an authenticated original.
 */
export function validateResearchM55(classification:ResearchClassification,review:ThaiResearchReview,
  sourceText?:string):string[]{
  const issues:string[]=[];
  if(!nonblank(classification.subject)||classification.subject.trim().toLowerCase()==="cross theme")
    issues.push("classification_primary_subject_unresolved");
  if(!classification.contentTypes.length||classification.contentTypes.some(x=>!x.trim()))
    issues.push("content_types_missing");
  if(classification.domain==="company"&&!classification.companyHubPaths.length)
    issues.push("company_hub_unresolved");
  if(classification.domain==="industry"&&!classification.industryHubPaths.length)
    issues.push("industry_hub_unresolved");
  if(classification.companyHubPaths.some(x=>!validHub(x,"01_Companies/"))||
    classification.industryHubPaths.some(x=>!validHub(x,"02_Industries_Themes/")))
    issues.push("invalid_hub_path");
  if(classification.domain==="industry"&&(!classification.resolvedSubjectPath||classification.resolvedSubjectPath!==classification.industryHubPaths[0]))
    issues.push("primary_theme_not_resolved");
  if(!nonblank(classification.sourceChannel)||classification.sourceChannel==="unknown")
    issues.push("source_channel_unresolved");
  if(!classification.originalDocumentAccess)issues.push("original_document_access_unresolved");
  if(classification.sourceChannel==="social_repost"&&!nonblank(classification.attributedOrigin))
    issues.push("repost_attributed_origin_missing");
  if(classification.sourceChannel==="social_repost"&&classification.originalDocumentAccess==="full_original")
    issues.push("repost_cannot_claim_full_original_without_separate_receipt");
  for(const [field,value] of Object.entries(review)){
    if(field==="translationTh"||field==="claimAssessments")continue;
    if(!nonblank(value)||!thai(value))issues.push(`${field}_thai_required`);
  }
  if(classification.sourceLanguage&& !/^th(?:-|$)/i.test(classification.sourceLanguage)&&!nonblank(review.translationTh))
    issues.push("foreign_source_translation_missing");
  if(review.translationTh&& !thai(review.translationTh))issues.push("translation_not_thai");
  // Both sourceKind and contentTypes are caller assertions. Require structured
  // assessment for ALL typed Guidance; a forged "issuer_release" is no bypass.
  if(classification.contentTypes.includes("guidance")&&!review.claimAssessments?.length)
    issues.push("guidance_claim_assessment_missing");
  // Content types/sourceKind are caller-selected and may be mislabeled. A
  // high-signal guidance passage in the received text independently triggers
  // a structured assessment, even if classified as generic reported_fact.
  // This detects omission, NOT whether the passage or attribution is true.
  const guidanceInSubmittedText=Boolean(sourceText&&
    /(?:\bguidance\b|\bforward[- ]looking\b|\boutlook\b|\bforecasts?\b|แนวโน้ม(?:รายได้|กำไร|ธุรกิจ)|บริษัท(?:ให้|ปรับ)คาดการณ์)/iu.test(sourceText)&&
    /(?:[+-]?\d+(?:[.,]\d+)?\s*%|\b(?:FY|CY|Q)[ -]?\d{1,4}\b)/iu.test(sourceText));
  if(guidanceInSubmittedText&&!review.claimAssessments?.length)
    issues.push("source_text_guidance_assessment_missing");
  const assertedFactText=[review.headlineTh,review.whatChangedTh,review.mechanismTh,
    review.thesisImplicationTh].join(" ");
  const quantified=numericMaterialClauses(review);
  if(quantified.length&&!review.claimAssessments?.length)
    issues.push("material_numeric_claim_assessment_missing");
  if(quantified.length&&review.claimAssessments?.length){
    const declared=new Set(review.claimAssessments.flatMap(c=>c.competingValues)
      .map(normalizedPercent).filter((v):v is string=>Boolean(v)));
    if(quantified.some(c=>c.values.some(value=>!declared.has(value))))
      issues.push("material_numeric_value_unassessed");
    const declaredScopes=review.claimAssessments.map(c=>({metric:metricCategory(c.metric),
      period:canonicalPeriod(c.period),
      values:new Set(c.competingValues.map(normalizedPercent))}));
    if(quantified.some(c=>c.metric!==null&&c.values.some(v=>
      !declaredScopes.some(a=>a.metric===c.metric&&a.values.has(v)))))
      issues.push("material_numeric_metric_unassessed");
    if(quantified.some(c=>c.metric!==null&&c.periods.length>0&&c.values.some(v=>
      !declaredScopes.some(a=>a.metric===c.metric&&a.values.has(v)&&
        c.periods.includes(a.period)))))
      issues.push("material_numeric_period_unassessed");
    const unresolvedValues=new Set(review.claimAssessments.filter(c=>c.resolution==="unresolved")
      .flatMap(c=>c.competingValues).map(normalizedPercent)
      .filter((v):v is string=>Boolean(v)));
    if(quantified.some(c=>c.values.some(v=>unresolvedValues.has(v))&&
      !explicitlyQualified.test(c.text)))
      issues.push("unresolved_numeric_claim_lacks_attribution");
  }
  const explicitConfirmation=/(?:ยืนยัน(?:แล้ว|ได้)ว่า|พิสูจน์แล้วว่า|ตรวจสอบกับเอกสารต้นฉบับแล้ว|เป็นข้อเท็จจริงว่า|verified fact|(?:officially )?confirmed by (?:issuer|company)|ต้องปรับ(?:เพิ่ม|ลด)(?:ทันที)?\s*(?:EPS|กำไร))/iu.test(assertedFactText);
  if(explicitConfirmation&&!review.claimAssessments?.length)
    issues.push("explicit_verified_claim_requires_assessment");
  for(const claim of review.claimAssessments??[]){
    if(!nonblank(claim.metric)||!nonblank(claim.period)||!nonblank(claim.unit)||!claim.competingValues.length||
       claim.competingValues.some(v=>!nonblank(v)))issues.push("claim_identity_incomplete");
    const values=[...new Set(claim.competingValues.map(v=>v.trim().toLocaleLowerCase("en")))];
    const conflict=values.length>1;
    let primaryVerified=false;
    if(claim.resolution==="verified_primary"){
      const scoped=Boolean(nonblank(claim.entity)&&nonblank(claim.primarySourceUrl)&&
        nonblank(claim.verifiedValue)&&nonblank(claim.primaryEvidenceReceipt)&&
        classification.entityScope?.some(e=>e.trim().toLowerCase()===claim.entity?.trim().toLowerCase()));
      if(!scoped)issues.push("verified_claim_without_primary_evidence");
      else {
        try {
          const verification=validatePrimaryEvidenceReceipt({
            receiptId:claim.primaryEvidenceReceipt!,sourceUrl:claim.primarySourceUrl!,
            entity:claim.entity!,metric:claim.metric,period:claim.period,unit:claim.unit,
            verifiedValue:claim.verifiedValue!,competingValues:claim.competingValues
          });
          primaryVerified=verification.valid;
        }catch{/* Registry unavailable or corrupt: hold Review, preserve Source preview. */}
      }
      if(!primaryVerified)issues.push("primary_evidence_receipt_validation_pending");
    }
    if(conflict&&claim.resolution!=="unresolved"&&!primaryVerified)
      issues.push("conflicting_claims_unresolved");
    if(claim.conclusion==="confirmed"&&!primaryVerified)
      issues.push("thesis_conclusion_exceeds_evidence");
  }
  if(review.claimAssessments?.some(c=>c.resolution==="unresolved")&&
     /(?:ยืนยัน(?:แล้ว|ได้)ว่า|พิสูจน์แล้วว่า|เป็นข้อเท็จจริงว่า|verified fact|(?:officially )?confirmed by (?:issuer|company)|ต้องปรับ(?:เพิ่ม|ลด)(?:ทันที)?)/iu.test(assertedFactText))
    issues.push("unresolved_claim_asserted_as_verified");
  return [...new Set(issues)];
}

export function renderThaiResearchM55(review:ThaiResearchReview):string{
  return [
    `# ${review.headlineTh.trim()}`,
    ...(review.translationTh?["","## คำแปลจากต้นฉบับ","",review.translationTh.trim()]:[]),
    "","## What Changed / New vs Known","",review.whatChangedTh.trim(),
    "","## Fundamental / Macro Mechanism","",review.mechanismTh.trim(),
    "","## Thesis & Valuation Implication","",review.thesisImplicationTh.trim(),
    "","## Counter-evidence","",review.counterEvidenceTh.trim(),
    "","## Required Evidence / What to Watch","",review.requiredEvidenceTh.trim(),"",
    ...(review.claimAssessments?.length?["## Structured claim assessments (caller-declared; not primary verification)","",
      ...review.claimAssessments.map(c=>`- ${c.entity??"entity not declared"} | ${c.metric} | ${c.period} | ${c.unit}: ${c.competingValues.join(" vs ")} — ${c.resolution}; conclusion: ${c.conclusion}; selected primary value: ${c.verifiedValue??"none"}; source: ${c.primarySourceUrl??"none"}; server-checkable receipt: ${c.primaryEvidenceReceipt??"none"}`),""]:[])
  ].join("\n");
}

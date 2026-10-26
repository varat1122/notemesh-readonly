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

export function validateResearchM55(classification:ResearchClassification,review:ThaiResearchReview):string[]{
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
  const assertedFactText=[review.whatChangedTh,review.mechanismTh,review.thesisImplicationTh].join(" ");
  const explicitConfirmation=/(?:ยืนยันแล้วว่า|ตรวจสอบกับเอกสารต้นฉบับแล้ว|verified fact|confirmed by (?:issuer|company)|ต้องปรับ(?:เพิ่ม|ลด)(?:ทันที)?\s*(?:EPS|กำไร))/iu.test(assertedFactText);
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
     /(?:ยืนยัน(?:แล้วว่า|ได้ว่า)|verified fact|ต้องปรับ(?:เพิ่ม|ลด)(?:ทันที)?)/iu.test(
       [review.whatChangedTh,review.mechanismTh,review.thesisImplicationTh].join(" ")))
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

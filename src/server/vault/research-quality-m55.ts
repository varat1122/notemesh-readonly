/** M5.5 research contract: pure pre-write checks, with no Vault side effects. */
export interface ThaiResearchReview {
  headlineTh:string;
  translationTh?:string;
  whatChangedTh:string;
  mechanismTh:string;
  thesisImplicationTh:string;
  counterEvidenceTh:string;
  requiredEvidenceTh:string;
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
  originalDocumentAccess:"full_original"|"excerpt_only"|"not_obtained";
  sourceLanguage?:string|null;
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
  if(classification.sourceChannel==="social_repost"&&classification.originalDocumentAccess==="full_original")
    issues.push("repost_cannot_claim_full_original_without_separate_receipt");
  for(const [field,value] of Object.entries(review)){
    if(field==="translationTh")continue;
    if(!nonblank(value)||!thai(value))issues.push(`${field}_thai_required`);
  }
  if(classification.sourceLanguage&& !/^th(?:-|$)/i.test(classification.sourceLanguage)&&!nonblank(review.translationTh))
    issues.push("foreign_source_translation_missing");
  if(review.translationTh&& !thai(review.translationTh))issues.push("translation_not_thai");
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
    "","## Required Evidence / What to Watch","",review.requiredEvidenceTh.trim(),""
  ].join("\n");
}

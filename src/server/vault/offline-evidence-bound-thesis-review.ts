/**
 * PR #87 - Grounded but UNVERIFIED AI / analyst interpretation proposal.
 *
 * This validates that every historical citation points to a selected exact
 * note version (or exact PR #84 structured metadata). It cannot independently
 * check issuer facts, analyze protected Current Thesis prose, authenticate
 * an analyst/owner, or authorize a Vault edit.
 *
 * "Semantic" suggestions are explicitly CALLER PROPOSALS, not conclusions
 * from an LLM or source/Thesis verification performed by this module.
 */
import {createHash} from "node:crypto";
import {prepareOfflineInvestmentIntelligenceBrief,
  type OfflineIntelligenceBriefRequest} from "./offline-investment-intelligence-brief";

const SHA=/^[a-f0-9]{64}$/;
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const RELATIONS=[
  "new_candidate","confirmation_candidate","incremental_candidate",
  "contradiction_candidate","duplicate_candidate",
  "thesis_changing_hypothesis","unresolved",
] as const;
const CHANNELS=[
  "demand","revenue_conversion","gross_profit","operating_profit",
  "earnings","cash_flow","return_on_capital","valuation","risk",
] as const;
type Relation=typeof RELATIONS[number];
type Channel=typeof CHANNELS[number];
type EvidenceRef={
  kind:"structured_metadata"|"historical_prose";
  notePath:string;
  sourceSha256?:string|null;
  noteSha256?:string;
  line?:number;excerptSha256?:string;
};
export type ProposedInvestmentInterpretation={
  claimLabel:string;hypothesis:string;relation:Relation;
  mechanism:Channel[];
  citedHistoricalRefs:EvidenceRef[];
  counterEvidenceRefs:EvidenceRef[];
  missingPrimaryEvidence:string[];
  uncertaintyExplanation:string;
};
export type OfflineThesisInterpretationRequest={
  evidence:OfflineIntelligenceBriefRequest;
  proposals:ProposedInvestmentInterpretation[];
};
const clean=(s:unknown,max=600):s is string=>
  typeof s==="string"&&s.trim().length>0&&s.length<=max&&
  !/[\0\r]/.test(s);
function validRef(ref:EvidenceRef):boolean{
  return !!ref&&typeof ref==="object"&&
    (ref.kind==="structured_metadata"||ref.kind==="historical_prose")&&
    clean(ref.notePath,350)&&ref.notePath.endsWith(".md")&&
    (ref.sourceSha256===undefined||ref.sourceSha256===null||
      SHA.test(ref.sourceSha256))&&
    (ref.noteSha256===undefined||SHA.test(ref.noteSha256))&&
    (ref.line===undefined||(Number.isSafeInteger(ref.line)&&ref.line>0))&&
    (ref.excerptSha256===undefined||SHA.test(ref.excerptSha256));
}
function safeProposals(items:ProposedInvestmentInterpretation[]){
  if(!Array.isArray(items)||items.length<1||items.length>6)
    throw Error("interpretation_requires_bounded_proposals");
  for(const p of items){
    if(!p||!clean(p.claimLabel,100)||!clean(p.hypothesis,850)||
      !RELATIONS.includes(p.relation)||!clean(p.uncertaintyExplanation,500)||
      !Array.isArray(p.mechanism)||p.mechanism.length<1||
      p.mechanism.length>5||p.mechanism.some(x=>!CHANNELS.includes(x))||
      !Array.isArray(p.missingPrimaryEvidence)||
      p.missingPrimaryEvidence.length<1||p.missingPrimaryEvidence.length>5||
      p.missingPrimaryEvidence.some(x=>!clean(x,260))||
      !Array.isArray(p.citedHistoricalRefs)||p.citedHistoricalRefs.length<1||
      p.citedHistoricalRefs.length>6||
      p.citedHistoricalRefs.some(x=>!validRef(x))||
      !Array.isArray(p.counterEvidenceRefs)||p.counterEvidenceRefs.length>4||
      p.counterEvidenceRefs.some(x=>!validRef(x)))
      throw Error("interpretation_missing_mechanism_evidence_or_uncertainty");
  }
}
export function prepareOfflineEvidenceBoundThesisReview(
  input:OfflineThesisInterpretationRequest,
){
  if(!input||typeof input!=="object")
    throw Error("interpretation_input_invalid");
  safeProposals(input.proposals);
  // Fresh exact physical markdown + indexed SQLite checks, followed by
  // a separately selected exact version of protected Current Thesis.
  const brief=prepareOfflineInvestmentIntelligenceBrief(input.evidence);
  const structured=new Map(brief.oldStructuredEvidenceRefs.map(x=>[x.path,x]));
  const narrative=new Map(brief.oldNarrativeEvidenceRefs.map(x=>[x.path,x]));
  function resolve(ref:EvidenceRef){
    if(ref.kind==="structured_metadata"){
      const item=structured.get(ref.notePath);
      if(!item||ref.noteSha256!==undefined||
        ref.line!==undefined||ref.excerptSha256!==undefined||
        (ref.sourceSha256??null)!==(item.sourceSha256??null))
        throw Error("interpretation_structured_reference_not_in_fresh_brief");
      return {
        kind:ref.kind,path:item.path,sourceSha256:item.sourceSha256,
        meaning:"indexed_structured_claim_declaration_only" as const,
        independence:item.independence,
      };
    }
    const item=narrative.get(ref.notePath);
    if(!item||ref.sourceSha256!==undefined||ref.noteSha256!==item.noteSha256||
      !Number.isSafeInteger(ref.line)||!SHA.test(ref.excerptSha256??""))
      throw Error("interpretation_narrative_reference_version_invalid");
    const line=item.exactLineCitations.find(x=>x.line===ref.line&&
      sha(x.excerpt)===ref.excerptSha256);
    if(!line)throw Error("interpretation_narrative_excerpt_not_in_fresh_brief");
    return {
      kind:ref.kind,path:item.path,noteSha256:item.noteSha256,
      line:line.line,excerptSha256:sha(line.excerpt),
      excerpt:line.excerpt,
      meaning:"verbatim_historical_excerpt_not_verified_fact" as const,
      independence:item.independence,
      declaredSourceFamily:item.sourceFamilyDeclarationKey,
    };
  }
  const resolved=input.proposals.map(p=>{
    const evidence=p.citedHistoricalRefs.map(resolve);
    const counter=p.counterEvidenceRefs.map(resolve);
    const hasArchived=evidence.some(e=>
      e.independence!=="not_assessed");
    const needsThesis=p.relation==="thesis_changing_hypothesis"&&
      brief.selectedThesis.status!==
        "exact_thesis_version_present_requires_analyst_read";
    const conflictsMetadata=p.relation==="duplicate_candidate"&&
      brief.structuredClassification==="possible_correction_or_contradiction";
    const potentialThesisReassessment=p.relation==="thesis_changing_hypothesis";
    const needsPriority=p.relation==="contradiction_candidate"||
      potentialThesisReassessment||conflictsMetadata;
    return {
      proposedBy:"untrusted_external_analyst_or_model" as const,
      claimLabel:p.claimLabel,hypothesis:p.hypothesis,
      proposedRelation:p.relation,
      economicChannels:p.mechanism,
      historicalSupportingRefs:evidence,
      historicalCounterEvidenceRefs:counter,
      missingPrimaryEvidence:p.missingPrimaryEvidence,
      uncertaintyExplanation:p.uncertaintyExplanation,
      warnings:[
        ...(hasArchived?[
          "Archived AI or derivative notes are only historical context, never independent corroboration.",
        ]:[]),
        ...(needsThesis?[
          "No exact Current Thesis version selected: thesis-changing hypothesis has not been compared with any Thesis.",
        ]:[]),
        ...(conflictsMetadata?[
          "A proposed duplicate conflicts with structured historical numeric discrepancy; source review is mandatory.",
        ]:[]),
        "Citation match validates stored historical text/metadata only, NOT correctness, event sameness, or economic interpretation.",
        "Current Thesis body and external original source have not been semantically reviewed by this function.",
      ],
      reviewQueue:needsPriority?
        "mandatory_human_thesis_or_conflict_review" as const:
        hasArchived||needsThesis?
          "manual_provenance_and_thesis_review" as const:
          "analyst_evidence_review_required" as const,
      materialityEstablished:false as const,
      verifiedInvestmentFact:false as const,
      independentSourceCorroborated:false as const,
      counterEvidenceFullySearched:false as const,
      thesisChangeValidated:false as const,
    };
  });
  return {
    status:"unverified_evidence_linked_interpretation_draft_only" as const,
    company:input.evidence.incoming.entity,
    snapshotManifestSha256:brief.sourceVersionManifestSha256,
    selectedThesis:brief.selectedThesis,
    structuredClassification:brief.structuredClassification,
    historicalClassificationReasonCodes:brief.historicalClassificationReasonCodes,
    narrativeScope:brief.narrativeRecallScope,
    structuredScope:brief.structuredHistoryScope,
    interpretations:resolved,
    nextStep:"An authorized analyst must read issuer originals, counterevidence and the exact Current Thesis, then independently assess earnings/cash-flow/valuation implications before owner review.",
    sourceFactsIndependentlyVerified:false as const,
    semanticLLMRunPerformed:false as const,
    thesisTextSemanticallyCompared:false as const,
    thesisChangingDecisionMade:false as const,
    ownerApprovalGranted:false as const,canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,safeEditPreview:null,
    vaultModified:false as const,
  };
}

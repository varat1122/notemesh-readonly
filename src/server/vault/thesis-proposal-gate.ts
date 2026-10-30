import { db } from "../db";
import { reviewInvestmentClaim, type Domain, type ReviewClass } from "./investment-claim-review";
import { findSourceObservationReceipts, type SourceReceiptGateResult } from "./source-observation-receipt";
import { inspectOriginalSourceHistory } from "../research-source-archive";

/**
 * READ-ONLY proposal completeness gate. This never verifies claims against the
 * internet, certifies analyst attestations, approves changes or writes files.
 * A "ready" result means syntactically REVIEWABLE by an owner, not TRUE.
 */
export type ThesisDecision = "maintain"|"strengthen"|"weaken"|"revise"|"undetermined";
export type Direction = "positive"|"negative"|"mixed"|"unchanged"|"unknown";
export interface ProposalEvidence {
  claimId:string;entity:string;metric:string;period:string;
  sourceUrl:string;sourceSection:string;finding:string;
  sourceType:"primary"|"regulatory"|"transcript"|"secondary"|"analyst"|"archived_ai";
  checkedAgainstOriginalByAnalyst:boolean;checkedAt?:string|null;
  value?:string|null;unit?:string|null;
}
export interface ProposalCounterEvidence {
  finding:string;sourceUrl:string;sourceSection:string;
  reviewedByAnalyst:boolean;
}
export interface ProposalTransmission {
  stage:string;direction:Direction;explanation:string;supportingClaimIds:string[];
}
export interface ThesisProposalInput {
  domain:Domain;entity:string;metric:string;period:string;
  originalSource:string;statement:string;value?:string;unit?:string;
  eventDate?:string|null;publishedAt?:string|null;
  proposedDecision:ThesisDecision;
  historicalContextPath:string;historicalContextReadByAnalyst:boolean;
  existingThesisStatus:"owner_approved"|"draft_or_unverified"|"not_applicable"|"unknown";
  evidence:ProposalEvidence[];counterEvidence:ProposalCounterEvidence[];
  transmission:ProposalTransmission[];
  thesisDelta:string;alternatives:string;invalidation:string;
  confidence:"low"|"medium"|"high"|"unassessed";
  confidenceRationale:string;
  catalyst?:string|null;
  marketExpectations:{
    status:"not_assessed"|"assessed";
    asOf?:string|null;sourceUrl?:string|null;
    comparatorDescription?:string|null;
  };
  portfolio:{
    status:"not_assessed"|"assessed";
    asOf?:string|null;authorizedHoldingsReference?:string|null;
  };
}
export interface ThesisProposalQualityResult {
  status:"proposal_quality_review_only";
  entity:string;domain:Domain;
  candidateDecision:ThesisDecision;
  readiness:"blocked_missing_evidence"|"ready_for_owner_review_not_approved";
  blockers:string[];
  warnings:string[];
  sourceAttestation:"analyst_assertion_not_independently_verified";
  historicalClaimClassification:ReviewClass;
  evidenceClaimsCheckedForScope:number;
  sourceReceiptGate:{status:"receipt_metadata_and_excerpt_integrity_only";validReceipts:number;rejectedReceipts:number;receiptPaths:string[];externalSourceFetchedThisCall:false;sourceDocumentBytesArchivedAndVerified:false;receiptReviewerIdentityCryptographicallyVerified:false};
  sourceByteArchive:{status:"not_archived"|"stored_byte_history_unverified";
    snapshotCount:number;distinctByteVersions:number;
    allStoredBytesIntegrityChecked:boolean;
    sha256Values:string[];
    sourcePublisherAuthenticated:false;
    sourceWasRetrievedThisCall:false;
    fullSourceRevisionCompleteness:"not_established";
  };
  historicalContextNoteExists:boolean;
  analyzedTransmissionStages:string[];
  valuationAndPricing:{
    status:"not_checked_by_tool";
    proposalDataStatus:"not_assessed"|"analyst_supplied_not_verified";
    canClaimPricedIn:false;
  };
  portfolioGate:{
    status:"blocked_until_separate_authorization_and_verification";
    proposalDataStatus:"not_assessed"|"analyst_supplied_not_verified";
    canRecommendTrade:false;
  };
  thesisUpdateGate:{
    ownerApproval:"not_requested_or_granted";
    protectedWrite:"not_performed";
    canAutoUpdateThesis:false;
  };
  nextAction:"complete_required_evidence"|"submit_separate_read_only_proposal_for_owner_review";
}
const truth=(s:string|undefined|null)=>typeof s==="string"&&s.trim().length>0;
const norm=(s:string)=>s.trim().normalize("NFC").toLowerCase();
function isoDate(s:string|null|undefined){
  if(!truth(s))return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s!))return false;
  const dt=new Date(s!+"T00:00:00Z");
  return !Number.isNaN(dt.getTime())&&dt.toISOString().slice(0,10)===s;
}
function webSource(s:string){ try{const u=new URL(s);return u.protocol==="https:"&&!!u.hostname}catch{return false} }
const STAGES:Record<Domain,readonly string[]>={
  company:["demand","revenue_conversion","gross_profit","operating_profit","earnings","cash_flow","return_on_capital","valuation","portfolio"],
  macro:["macro_demand_policy","asset_classes","industry_supply_chain","revenue_conversion","earnings_cash_flow","valuation","portfolio"],
  industry:["industry_demand","capacity_supply","company_revenue","profits","return_on_capital","valuation","portfolio"],
  asset:["fundamentals","pricing","economic_return","risk_reward","valuation","portfolio"]
};
export function assessThesisProposal(input:ThesisProposalInput):ThesisProposalQualityResult {
  const blockers:string[]=[], warnings:string[]=[];
  const issue=(why:string)=>{if(!blockers.includes(why))blockers.push(why)};
  if(!truth(input.entity)||!truth(input.metric)||!truth(input.period)||!truth(input.statement))
    issue("Entity, claim metric, reporting period and original statement are required.");
  if(!webSource(input.originalSource))issue("An original-source HTTPS URL is required; the URL is not verified by this tool.");
  if(input.eventDate!=null&&!isoDate(input.eventDate))issue("Invalid actual event date; never substitute import/review date.");
  if(input.publishedAt!=null&&!isoDate(input.publishedAt))issue("Invalid source publication date.");
  if(!input.eventDate||!input.publishedAt)warnings.push("Original event/publication chronology incomplete; verify date vintage before interpreting novelty.");
  const historical=db().prepare("SELECT path FROM notes WHERE path = ?").get(input.historicalContextPath) as {path:string}|undefined;
  if(!historical)issue("Historical thesis/context path not present in current Vault index; read relevant original history.");
  if(!input.historicalContextReadByAnalyst)issue("Historical thesis/context must be read in full by analyst.");
  if(input.domain==="company"&&input.proposedDecision!=="undetermined"&&input.existingThesisStatus!=="owner_approved"){
    warnings.push("Existing company thesis is not confirmed owner-approved; proposed decision cannot be represented as an approved change.");
  }
  if(input.existingThesisStatus==="unknown")
    issue("Existing thesis authorization status must be assessed, or explicitly not applicable.");
  if(input.proposedDecision==="undetermined")issue("Undetermined is a safe research status, not a directional Thesis Change Proposal.");
  const claimIds=new Set<string>();
  let scoped=0,primaryAttested=0;
  for(const e of input.evidence||[]){
    if(!truth(e.claimId)||claimIds.has(e.claimId))issue("Evidence entries require distinct, nonempty Claim IDs.");
    if(truth(e.claimId))claimIds.add(e.claimId);
    if(norm(e.entity)!==norm(input.entity)||norm(e.metric)!==norm(input.metric)||norm(e.period)!==norm(input.period))
      issue("Evidence metric, entity and fiscal period must match the proposed claim; do not merge unlike measurements.");
    else scoped++;
    if(!webSource(e.sourceUrl)||!truth(e.sourceSection)||!truth(e.finding))
      issue("Evidence needs a source URL, a specific document section and a traceable factual finding.");
    if(e.checkedAgainstOriginalByAnalyst && isoDate(e.checkedAt) &&
       ["primary","regulatory","transcript"].includes(e.sourceType) && e.sourceUrl===input.originalSource)primaryAttested++;
    if(e.checkedAgainstOriginalByAnalyst&&!isoDate(e.checkedAt))
      issue("Primary-source analyst checks require an actual checkedAt ISO date.");
    if((e.sourceType==="archived_ai"||e.sourceType==="secondary"||e.sourceType==="analyst") &&
       e.checkedAgainstOriginalByAnalyst)warnings.push("Secondary or archived-AI content is not independent original-source verification.");
    if(input.value!==undefined&&e.value!==undefined&&e.value!==null&&
       e.metric===input.metric&&e.period===input.period&&
       (!truth(input.unit)||!truth(e.unit)||norm(e.unit!)!==norm(input.unit!)))
      issue("Numeric comparisons need explicit compatible units; conversions require separate audit.");
  }
  if(!input.evidence?.length)issue("At least one structured Claim ID and source-specific Evidence Row is required.");
  if(primaryAttested===0)
    issue("No primary/regulatory/transcript claim has an analyst-dated original-source check on the supplied original URL.");
  const receiptChecks:SourceReceiptGateResult[]=[];
  for(const e of input.evidence||[]){
    if(!e.checkedAgainstOriginalByAnalyst||!["primary","regulatory","transcript"].includes(e.sourceType)||
      !isoDate(e.checkedAt)||e.sourceUrl!==input.originalSource)continue;
    receiptChecks.push(findSourceObservationReceipts({
      claimId:e.claimId,domain:input.domain,entity:e.entity,metric:e.metric,period:e.period,
      originalSource:e.sourceUrl,value:e.value??input.value??null,unit:e.unit??input.unit??null
    }));
  }
  const receiptRows=receiptChecks.flatMap(x=>x.matchingReceipts);
  const receiptRejects=receiptChecks.flatMap(x=>x.rejectedReceipts);
  if(receiptRows.length===0)
    issue("No claim-scoped source observation receipt with consistent SHA-256 excerpt and source/metric/period/value/unit is indexed; independent original verification remains a separate step.");
  if(receiptChecks.some(x=>x.truncated))
    warnings.push("Source receipt lookup truncated; do not treat verification receipts as complete.");
  if(receiptRejects.length>0)
    warnings.push("One or more source observation receipts were rejected on scope or excerpt integrity; adjudicate the raw note.");

  if(!input.counterEvidence?.length)issue("Counter-evidence must be evaluated, including contrary sources and alternatives.");
  for(const c of input.counterEvidence||[]){
    if(!truth(c.finding)||!webSource(c.sourceUrl)||!truth(c.sourceSection)||!c.reviewedByAnalyst)
      issue("Counter-evidence requires a cited source, original section, factual finding and analyst review.");
  }
  const represented:string[]=[];
  for(const t of input.transmission||[]){
    if(!STAGES[input.domain]?.includes(t.stage))issue("Causal stage not valid for this domain.");
    if(represented.includes(t.stage))issue("Do not double-count a causal stage in one proposal.");
    represented.push(t.stage);
    if(!truth(t.explanation))issue("Every claimed causal stage needs an explanatory mechanism.");
    if(t.direction!=="unknown" && (!t.supportingClaimIds.length||
       t.supportingClaimIds.some(id=>!claimIds.has(id))))
      issue("A non-unknown causal direction must trace to supplied Claim IDs.");
  }
  if(!represented.length)issue("At least one domain-appropriate causal transmission stage is required.");
  if(!input.transmission?.some(t=>t.direction!=="unknown"))
    issue("No supported causal direction has been proposed; do not force a bullish/bearish conclusion.");
  if(!truth(input.thesisDelta)||!truth(input.alternatives)||!truth(input.invalidation))
    issue("Thesis delta, alternative explanation and falsifiable invalidation are mandatory.");
  if(input.confidence==="unassessed"||!truth(input.confidenceRationale))
    issue("Confidence must include rationale, not an invented probability.");
  if(input.marketExpectations.status==="assessed" &&
     (!isoDate(input.marketExpectations.asOf)||!webSource(input.marketExpectations.sourceUrl||"")||
       !truth(input.marketExpectations.comparatorDescription)))
    issue("Market-expectation assessment needs dated source and comparator/expectation basis.");
  if(input.portfolio.status==="assessed" &&
     (!isoDate(input.portfolio.asOf)||!truth(input.portfolio.authorizedHoldingsReference)))
    issue("Portfolio assessment requires dated, authorized holdings reference.");
  if(input.marketExpectations.status==="not_assessed")
    warnings.push("Price In, valuation re-rating and expectations gap cannot be claimed without dated market/consensus evidence.");
  if(input.portfolio.status==="not_assessed")
    warnings.push("No portfolio sizing, trades or exposure implications can be approved without authorized holdings.");
  const classify=reviewInvestmentClaim({
    domain:input.domain,entity:input.entity,metric:input.metric,period:input.period,
    statement:input.statement,originalSource:input.originalSource,
    value:input.value,unit:input.unit,eventDate:input.eventDate,publishedAt:input.publishedAt
  });
  if(classify.classification==="possible_correction_or_contradiction")
    issue("Indexed source/metric conflict is unresolved; reconcile original document and correction vintage.");
  if(classify.metadataScan.truncated)
    warnings.push("Bounded historical metadata scan was truncated; not a global dedup assurance.");
  const sourceHistory=inspectOriginalSourceHistory(input.originalSource);
  if(sourceHistory.revisionCount===0)
    warnings.push("No exact original-document bytes archived yet; excerpt-only receipts do not preserve the entire filing.");
  if(sourceHistory.snapshots.some(x=>x.archiveStatus!=="intact_stored_bytes"))
    issue("A source archive snapshot failed integrity checks; investigate bytes before using it as historical evidence.");
  warnings.push("The receipt SHA-256 checks stored excerpt consistency, NOT authenticity of the SEC/issuer full document or reviewer identity.");
  warnings.push("This read-only gate validates proposal structure and analyst attestations, NOT external source truth or owner approval.");
  const ready=blockers.length===0;
  return {
    status:"proposal_quality_review_only",entity:input.entity,domain:input.domain,
    candidateDecision:input.proposedDecision,
    readiness:ready?"ready_for_owner_review_not_approved":"blocked_missing_evidence",
    blockers,warnings,
    sourceAttestation:"analyst_assertion_not_independently_verified",
    historicalClaimClassification:classify.classification,
    evidenceClaimsCheckedForScope:scoped,
    sourceReceiptGate:{status:"receipt_metadata_and_excerpt_integrity_only",
      validReceipts:receiptRows.length,rejectedReceipts:receiptRejects.length,
      receiptPaths:[...new Set(receiptRows.map(r=>r.path))].slice(0,12),
      externalSourceFetchedThisCall:false,sourceDocumentBytesArchivedAndVerified:false,
      receiptReviewerIdentityCryptographicallyVerified:false},
    sourceByteArchive:{
      status:sourceHistory.revisionCount?"stored_byte_history_unverified":"not_archived",
      snapshotCount:sourceHistory.revisionCount,
      distinctByteVersions:new Set(sourceHistory.snapshots.map(x=>x.sha256)).size,
      allStoredBytesIntegrityChecked:sourceHistory.revisionCount>0&&
        sourceHistory.snapshots.every(x=>x.archiveStatus==="intact_stored_bytes"),
      sha256Values:sourceHistory.snapshots.map(x=>x.sha256).slice(0,8),
      sourcePublisherAuthenticated:false,sourceWasRetrievedThisCall:false,
      fullSourceRevisionCompleteness:"not_established"
    },
    historicalContextNoteExists:!!historical,
    analyzedTransmissionStages:represented,
    valuationAndPricing:{status:"not_checked_by_tool",
      proposalDataStatus:input.marketExpectations.status==="assessed"?"analyst_supplied_not_verified":"not_assessed",
      canClaimPricedIn:false},
    portfolioGate:{status:"blocked_until_separate_authorization_and_verification",
      proposalDataStatus:input.portfolio.status==="assessed"?"analyst_supplied_not_verified":"not_assessed",
      canRecommendTrade:false},
    thesisUpdateGate:{ownerApproval:"not_requested_or_granted",protectedWrite:"not_performed",canAutoUpdateThesis:false},
    nextAction:ready?"submit_separate_read_only_proposal_for_owner_review":"complete_required_evidence"
  };
}

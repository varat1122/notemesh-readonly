import { db } from "../db";
import type { IncomingClaim, ClaimReview } from "./investment-claim-review";

/**
 * Bounded, READ-ONLY provenance ledger. "verified_against_primary" is
 * historically declared note metadata, never verification in this call.
 * Data (especially Vault frontmatter) is untrusted research material.
 */
export type EvidenceLedgerRole="same_metric_candidate"|"other_same_event_metric"|"source_linked_unstructured";
export interface EvidenceLedgerRow {
  path:string;
  role:EvidenceLedgerRole;
  claimId:string|null;
  metric:string|null;
  period:string|null;
  value:string|null;
  unit:string|null;
  originalSource:string|null;
  noteDeclaredSourceType:string|null;
  noteDeclaredVerification:string|null;
  noteDeclaredSourceHash:string|null;
  noteDeclaredEventDate:string|null;
  noteDeclaredPublishedAt:string|null;
  noteDeclaredImportedAt:string|null;
  noteDeclaredVerifiedAt:string|null;
  sameOriginalUrlAsIncoming:boolean|null;
  originalSourceIndependent:"unknown";
  originalVerifiedThisRun:false;
}
export interface EvidenceVerificationLedger {
  status:"metadata_lineage_only_no_external_verification";
  entity:string;
  metric:string;
  period:string;
  incoming:{
    originalSource:string;
    value:string|null;
    unit:string|null;
    eventDate:string|null;
    publishedAt:string|null;
    dateSource:"caller_input_unverified";
  };
  scanned:{
    indexedNotesWithMetadata:number;
    notesScanned:number;
    truncated:boolean;
    eligibleEntityNotes:number;
    returnedEvidenceRows:number;
    matchedMetricRows:number;
    relatedMetricRows:number;
    unstructuredSameSourceNotes:number;
  };
  entries:EvidenceLedgerRow[];
  internalDiscrepancies:{
    sameSourceMetricPeriodUnitDifferentValues:boolean;
    comparedRows:number;
    interpretation:"potential_metadata_conflict_requires_original_source";
  };
  lineage:{
    countDistinctOriginalUrls:number;
    differentUrlsNotIndependentByDefault:true;
    sourceFamiliesVerified:false;
    historicalDuplicateCompleteness:"not_established";
    sourceRevisionsChecked:false;
  };
  gates:{
    originalPrimarySourceRead:"not_performed";
    exactMetricPeriodAndUnitVerified:"not_performed";
    originalSourceBytesHashed:"not_confirmed";
    eventPublicationImportChronologyVerified:"not_performed";
    sourceLineageAndIndependenceVerified:"not_performed";
    fullHistoricalDedupVerified:"not_performed";
    counterEvidenceVerified:"not_performed";
    causalEarningsCashRoicImpactReviewed:"not_performed";
    datedConsensusPricingReviewed:"not_performed";
    portfolioExposureAuthorizedAndChecked:"not_performed";
    ownerApprovedThesisChange:false;
  };
  missingEvidence:string[];
  permittedNextStep:"manual_primary_verification_and_analysis";
  canAutoUpdateThesis:false;
}
type FM = Record<string,unknown>;
const nonempty=(x:unknown):string|null=>typeof x==="string"&&x.trim()?x.trim():null;
const first=(f:FM,keys:readonly string[]):string|null=>{
  for(const k of keys) { const v=nonempty(f[k]);if(v!==null)return v; }
  return null;
};
function getFrontmatter(path:string):FM {
  const note=db().prepare("SELECT frontmatter FROM notes WHERE path = ?").get(path) as {frontmatter:string|null}|undefined;
  if(!note?.frontmatter)return {};
  try{
    const fm:unknown=JSON.parse(note.frontmatter);
    return fm!==null&&typeof fm==="object"&&!Array.isArray(fm)?fm as FM:{};
  }catch{return {};}
}
function normalizedSource(source:string):string{
  try {
    const u=new URL(source.trim());
    if(u.protocol!=="https:"&&u.protocol!=="http:")return source.trim();
    u.hash="";
    for(const key of [...u.searchParams.keys()])
      if(/^utm_|^(?:fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString(); // case-sensitive path and query values preserved
  }catch{return source.trim();}
}
export function buildEvidenceVerificationLedger(input:IncomingClaim,review:ClaimReview):EvidenceVerificationLedger {
  const items=[
    ...review.matchingClaims.map(x=>({record:x,role:"same_metric_candidate" as const})),
    ...review.relatedEventClaims.map(x=>({record:x,role:"other_same_event_metric" as const})),
  ];
  const ledgerRows:EvidenceLedgerRow[]=items.map(({record:r,role})=>{
    const meta=getFrontmatter(r.path);
    const source=r.originalSource;
    return {
      path:r.path,role,claimId:r.claimId,metric:r.metric,period:r.period,value:r.value,unit:r.unit,
      originalSource:source,
      noteDeclaredSourceType:first(meta,["source_type","source_tier"]),
      noteDeclaredVerification:r.verification??first(meta,["verification"]),
      noteDeclaredSourceHash:first(meta,["original_source_sha256","source_sha256"]),
      noteDeclaredEventDate:first(meta,["event_date","eventDate"]),
      noteDeclaredPublishedAt:first(meta,["published_at","publishedAt"]),
      noteDeclaredImportedAt:first(meta,["imported_at","imported_on","importedAt"]),
      noteDeclaredVerifiedAt:first(meta,["verified_at","verifiedAt"]),
      sameOriginalUrlAsIncoming:source?normalizedSource(source)===normalizedSource(input.originalSource):null,
      originalSourceIndependent:"unknown" as const,
      originalVerifiedThisRun:false as const
    };
  });
  for(const path of review.sourceLinkedUnstructuredPaths) {
    const fm=getFrontmatter(path);
    const src=first(fm,["original_source","source_url","primary_url"]);
    ledgerRows.push({
      path,role:"source_linked_unstructured",claimId:null,metric:null,period:null,value:null,unit:null,
      originalSource:src,
      noteDeclaredSourceType:first(fm,["source_type","source_tier"]),
      noteDeclaredVerification:first(fm,["verification"]),
      noteDeclaredSourceHash:first(fm,["original_source_sha256","source_sha256"]),
      noteDeclaredEventDate:first(fm,["event_date","eventDate"]),
      noteDeclaredPublishedAt:first(fm,["published_at","publishedAt"]),
      noteDeclaredImportedAt:first(fm,["imported_at","imported_on","importedAt"]),
      noteDeclaredVerifiedAt:first(fm,["verified_at","verifiedAt"]),
      sameOriginalUrlAsIncoming:src?normalizedSource(src)===normalizedSource(input.originalSource):null,
      originalSourceIndependent:"unknown",originalVerifiedThisRun:false
    });
  }
  const matched=ledgerRows.filter(x=>x.role==="same_metric_candidate");
  let comparisons=0,conflict=false;
  // Compare like-for-like metadata only (same metric, fiscal period, original
  // source and explicitly named unit). Divergence is not proof of a real-world
  // issuer correction, just a *note-index discrepancy*.
  for(let i=0;i<matched.length;i++)for(let j=i+1;j<matched.length;j++){
    const a=matched[i],b=matched[j];
    if(!a.originalSource||!b.originalSource||!a.unit||!b.unit||!a.value||!b.value)continue;
    if(normalizedSource(a.originalSource)!==normalizedSource(b.originalSource))continue;
    if(a.metric?.trim().toLowerCase()!==b.metric?.trim().toLowerCase()||
       a.period?.trim().toLowerCase()!==b.period?.trim().toLowerCase()||
       a.unit.trim().toLowerCase()!==b.unit.trim().toLowerCase())continue;
    comparisons++;
    if(a.value.trim()!==b.value.trim())conflict=true;
  }
  const different=[...new Set(ledgerRows.flatMap(r=>r.originalSource?[normalizedSource(r.originalSource)]:[]))];
  const needs=[
    "Read the complete original source and identify the filed statistical/financial line, source date, period, unit and any correction.",
    "Determine whether distinct URLs quote the same underlying source/filing; independent confirmation is not established by this ledger.",
    "Reconcile historical claims outside selected metadata rows, including nonindexed text, archived AI reposts and counter-evidence.",
    "Examine management assertions, incentives, possible later restatements and source vintage before assigning investment materiality.",
    "Obtain dated consensus/expectations, price basis and authorized portfolio exposure separately before Price In or sizing claims.",
    "Prepare a separate analyst-reviewed Thesis Proposal with Change Log and explicit owner-approved Protected Vault edit."
  ];
  if(review.metadataScan.truncated)needs.unshift("Metadata scan truncated; do not treat results as comprehensive.");
  if(!matched.length)needs.unshift("No indexed same-metric candidate selected; this is NOT evidence that the event is new.");
  if(conflict)needs.unshift("Conflicting values appear in like-for-like note metadata; adjudicate against original source before classification.");
  return {
    status:"metadata_lineage_only_no_external_verification",
    entity:input.entity,metric:input.metric,period:input.period,
    incoming:{originalSource:input.originalSource,value:input.value??null,unit:input.unit??null,
      eventDate:input.eventDate??null,publishedAt:input.publishedAt??null,dateSource:"caller_input_unverified"},
    scanned:{...review.metadataScan,returnedEvidenceRows:ledgerRows.length,
      matchedMetricRows:matched.length,relatedMetricRows:review.relatedEventClaims.length,
      unstructuredSameSourceNotes:review.sourceLinkedUnstructuredPaths.length},
    entries:ledgerRows,
    internalDiscrepancies:{sameSourceMetricPeriodUnitDifferentValues:conflict,comparedRows:comparisons,
      interpretation:"potential_metadata_conflict_requires_original_source"},
    lineage:{countDistinctOriginalUrls:different.length,differentUrlsNotIndependentByDefault:true,
      sourceFamiliesVerified:false,historicalDuplicateCompleteness:"not_established",sourceRevisionsChecked:false},
    gates:{
      originalPrimarySourceRead:"not_performed",
      exactMetricPeriodAndUnitVerified:"not_performed",
      originalSourceBytesHashed:"not_confirmed",
      eventPublicationImportChronologyVerified:"not_performed",
      sourceLineageAndIndependenceVerified:"not_performed",
      fullHistoricalDedupVerified:"not_performed",
      counterEvidenceVerified:"not_performed",
      causalEarningsCashRoicImpactReviewed:"not_performed",
      datedConsensusPricingReviewed:"not_performed",
      portfolioExposureAuthorizedAndChecked:"not_performed",
      ownerApprovedThesisChange:false
    },
    missingEvidence:needs,permittedNextStep:"manual_primary_verification_and_analysis",
    canAutoUpdateThesis:false
  };
}

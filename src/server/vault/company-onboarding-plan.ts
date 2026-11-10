/**
 * N6: read-only onboarding evidence checklist, never an issuer/DR verification
 * service, new Hub writer, or a bypass around canonical Source preservation.
 * Indexed collision paths are candidates, not proven aliases or legal entities.
 */
import type {IssuerResolution} from "./investment-context";
import type {RoutingV2} from "./investment-routing-v2";
import {hubIdentityKey,indexedHubAliases,indexedTopLevelHubs} from "./investment-routing-v2";

export type OnboardingStatus=
  "existing_hub_context_candidate"|"unresolved_requires_onboarding"|
  "ambiguous_hold"|"readback_hold"|"index_limit_hold"|
  "invalid_hold"|"cross_consumer_identity_hold";
export interface CompanyOnboardingEntry {
  requested:string;
  status:OnboardingStatus;
  currentHubCandidate:string|null;
  routingBasis:"exact_existing_title"|"indexed_alias"|"curated_alias"|null;
  historicalStatus:IssuerResolution["status"]|null;
  indexedConflictCandidatePaths:string[];
  candidateScanComplete:boolean;
  requiresOwnerIdentityReview:true;
  requiredEvidence:string[];
  issuerVsSecurityVsListing:"not_adjudicated";
  drUnderlyingEquivalence:"not_inferred";
}
export interface CompanyOnboardingPlan {
  status:"read_only_evidence_checklist_not_written";
  entries:CompanyOnboardingEntry[];
  missingOrHeld:number;
  sourcePreservationIsIndependent:true;
  noAutoHubCreation:true;
  noProtectedMutation:true;
}

const evidenceChecklist=[
  "Authoritative issuer name, country/jurisdiction, and dated source reference",
  "Source/filing/registry identity with original locator, provenance and receipt if available",
  "Security class, listing exchange, instrument identifier, trading currency and effective dates if applicable",
  "Review current Company Hub title/aliases, including conflicting indexed candidate paths",
  "For any DR/ADR: dated depositary instrument, underlying security, ratio, venue and issuer mapping from authorized evidence",
  "Explicit owner review before creating a Company Hub or issuer-specific investment claim"
] as const;

const unresolvedStatus=(s:IssuerResolution["status"]|null):OnboardingStatus=>{
  if(s==="ambiguous_hold")return "ambiguous_hold";
  if(s==="readback_hold")return "readback_hold";
  if(s==="index_limit_hold")return "index_limit_hold";
  if(s==="invalid_hold")return "invalid_hold";
  return "unresolved_requires_onboarding";
};

/** Input labels remain assertions supplied by the caller. Nothing here
 * authenticates a company, maps a security/DR or creates a Vault note. */
export function proposeCompanyOnboarding(
  requested:string[],routing:RoutingV2,historical:IssuerResolution[]
):CompanyOnboardingPlan {
  const indexed=indexedTopLevelHubs("01_Companies/");
  const indexComplete=indexed.length<=3000;
  const entries=requested.map(raw=>{
    const label=raw.trim().normalize("NFC"),wanted=hubIdentityKey(label);
    // The raw request must resolve in history itself. Do not borrow another
    // label's successful resolution: qualified/invalid aliases can share a
    // navigation target without sharing a valid identity interpretation.
    const history=historical.find(h=>h.requested.trim().normalize("NFC").toUpperCase()===label.toUpperCase());
    const historyResolved=history&&["exact_existing_title","indexed_alias"].includes(history.status);
    // Routing deduplicates by Hub path. A title and its explicit alias may
    // therefore have one routing entry while both raw histories resolve.
    const hub=routing.companyHubs.find(h=>hubIdentityKey(h.label)===wanted) ??
      (historyResolved?routing.companyHubs.find(h=>h.path===history.hubPath):undefined);
    const bad=history&&["ambiguous_hold","readback_hold","index_limit_hold","invalid_hold"].includes(history.status);
    const candidates=indexComplete?indexed.filter(h=>hubIdentityKey(h.title)===wanted||
      indexedHubAliases(h.frontmatter).some(alias=>hubIdentityKey(alias)===wanted)):[];
    const scanComplete=indexComplete&&candidates.length<=12;
    const paths=candidates.slice(0,12).map(h=>h.path);
    let status:OnboardingStatus;
    if(!indexComplete)status="index_limit_hold";
    else if(bad)status=unresolvedStatus(history!.status);
    else if(candidates.length>1)status="ambiguous_hold";
    else if(hub&&
      history?.hubPath===hub.path&&
      ["exact_existing_title","indexed_alias"].includes(history.status))
      status="existing_hub_context_candidate";
    else if(hub||history?.hubPath)status="cross_consumer_identity_hold";
    else status=unresolvedStatus(history?.status??null);
    return {
      requested:label,status,
      currentHubCandidate:status==="existing_hub_context_candidate"?hub!.path:null,
      // The path-deduplicated navigation row can belong to a curated label
      // encountered earlier. Only this label's own successful readback may
      // supply its resolution basis; the curated label itself stays held.
      routingBasis:status==="existing_hub_context_candidate"?
        history!.status as "exact_existing_title"|"indexed_alias":hub?.resolution??null,
      historicalStatus:history?.status??null,
      indexedConflictCandidatePaths:paths,
      candidateScanComplete:scanComplete,
      requiresOwnerIdentityReview:true as const,
      requiredEvidence:[...evidenceChecklist],
      issuerVsSecurityVsListing:"not_adjudicated" as const,
      drUnderlyingEquivalence:"not_inferred" as const
    };
  });
  return {
    status:"read_only_evidence_checklist_not_written",
    entries,missingOrHeld:entries.filter(e=>e.status!=="existing_hub_context_candidate").length,
    sourcePreservationIsIndependent:true,noAutoHubCreation:true,noProtectedMutation:true
  };
}

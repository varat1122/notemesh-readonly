/**
 * N5: read-only issuer onboarding advice. An indexed Company Hub is a
 * navigational artifact, not proof of legal issuer/security/listing identity.
 * No caller-provided ticker, DR label or curated alias becomes verified here.
 */
import type {IssuerResolution} from "./investment-context";
import type {RoutingV2} from "./investment-routing-v2";
import {hubIdentityKey} from "./investment-routing-v2";

export const ONBOARDING_PREVIEW_VERSION="RI001-N5-ONBOARDING-PREVIEW-1";
export type OnboardingStatus =
  |"existing_hub_navigation_only"
  |"curated_alias_hint_hold"
  |"qualified_listing_mapping_hold"
  |"ambiguous_identity_hold"
  |"stale_hub_readback_hold"
  |"index_incomplete_hold"
  |"invalid_identity_hold"
  |"no_indexed_hub_candidate";
export interface OnboardingCandidate {
  requested:string;
  status:OnboardingStatus;
  action:"reuse_existing_hub_for_navigation"|"owner_identity_review_required"|"owner_onboarding_proposal";
  existingHubPath:string|null;
  historicalIdentityStatus:IssuerResolution["status"]|"not_selected";
  evidenceNeeded:string[];
  sourceTreatment:"preserve_attributed_source_if_authorized";
  issuerSecurityListingVerified:false;
  mayCreateHub:false;
  mayConvertDrOrAdr:false;
  mayWriteIssuerSpecificClaims:false;
  mayMutateProtectedNotes:false;
}
export interface CompanyOnboardingPreview {
  version:typeof ONBOARDING_PREVIEW_VERSION;
  authority:"read_only_not_an_issuer_listing_verification";
  sourcePreservation:"separate_rights_identity_and_receipt_gate";
  candidates:OnboardingCandidate[];
  automaticHubCreation:false;
  automaticDRConversion:false;
}
const EVIDENCE=[
  "Authoritative legal issuer name, jurisdiction and effective date",
  "Primary listing/security identifier, exchange, currency and effective dates",
  "Explicit documented aliases and conflicting Company Hub candidates",
  "For DR/ADR/cross-listing: dated issuer-to-security-to-underlying mapping, conversion ratio and corporate actions",
  "Original publication/source provenance and independent verification status"
];
/** Pure projection of existing bounded, read-only routing/context results.
 * Missing context is uncertainty, not proof of a genuinely new company.
 * No automated alias, DR/ADR, claim or protected record authority is issued. */
export function proposeCompanyOnboarding(input:{
  entities:string[];
  routing:RoutingV2;
  issuerResolution:IssuerResolution[];
}):CompanyOnboardingPreview {
 const candidates=input.entities.map(requested=>{
  const label=hubIdentityKey(requested);
  const hub=input.routing.companyHubs.find(x=>hubIdentityKey(x.label)===label);
  const history=input.issuerResolution.find(x=>hubIdentityKey(x.requested)===label);
  const historicalIdentityStatus=history?.status??"not_selected" as const;
  // The listing namespace must not be collapsed into its issuer. A declared
  // qualified ticker/DR label still needs a dated underlying mapping, even if
  // a Company Hub explicitly mentions it in indexed aliases.
  const qualified=/[:/]/.test(requested)||/\.[A-Z]{1,5}$/i.test(requested);
  let status:OnboardingStatus;
  if(history?.status==="ambiguous_hold")status="ambiguous_identity_hold";
  else if(history?.status==="readback_hold")status="stale_hub_readback_hold";
  else if(history?.status==="index_limit_hold")status="index_incomplete_hold";
  else if(history?.status==="invalid_hold")status="invalid_identity_hold";
  else if(qualified)status="qualified_listing_mapping_hold";
  else if(hub?.resolution==="curated_alias")status="curated_alias_hint_hold";
  else if(hub)status="existing_hub_navigation_only";
  else status="no_indexed_hub_candidate";
  const action:OnboardingCandidate["action"]=status==="existing_hub_navigation_only"?
    "reuse_existing_hub_for_navigation":status==="no_indexed_hub_candidate"?
    "owner_onboarding_proposal":"owner_identity_review_required";
  return {requested,status,action,
    // A curated mapping is a hint, not an approved issuer identity. Preserve
    // its path only as a review candidate, never authorization to link a DR.
    existingHubPath:hub?.path??null,historicalIdentityStatus,
    evidenceNeeded:EVIDENCE.slice(),sourceTreatment:"preserve_attributed_source_if_authorized" as const,
    issuerSecurityListingVerified:false as const,mayCreateHub:false as const,
    mayConvertDrOrAdr:false as const,mayWriteIssuerSpecificClaims:false as const,
    mayMutateProtectedNotes:false as const};
 });
 return {version:ONBOARDING_PREVIEW_VERSION,authority:"read_only_not_an_issuer_listing_verification",
   sourcePreservation:"separate_rights_identity_and_receipt_gate",
   candidates,automaticHubCreation:false,automaticDRConversion:false};
}

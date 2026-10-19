/**
 * Human-facing classification handoff for a selected PR #70 dossier.
 *
 * The disposition and rationale are caller-provided assertions, NOT a verified
 * human approval. This only prepares a bounded decision worksheet. No edit
 * template, mutation, claim validation or persistent decision journal.
 */
import {getLegacyReviewDossier} from "./legacy-review-dossier";

export const REVIEW_DISPOSITIONS=[
  "no_change_needed",
  "missing_evidence",
  "needs_source_verification",
  "metadata_correction_candidate",
  "navigation_link_candidate",
  "duplicate_or_conflicting_evidence",
  "unresolved",
] as const;
export type ReviewDisposition=(typeof REVIEW_DISPOSITIONS)[number];

const FOLLOW_UP:Record<ReviewDisposition,{
  action:string;requiredEvidence:string[];
}>={
  no_change_needed:{
    action:"Leave note unchanged; record the reason only after a human checks the full note.",
    requiredEvidence:["Full original note and original-source context supporting no correction"],
  },
  missing_evidence:{
    action:"Investigate original source availability; do not reconstruct missing bytes from AI prose.",
    requiredEvidence:["Original file inventory outside the Markdown index","Original-byte readback and source identity when available"],
  },
  needs_source_verification:{
    action:"Check source publisher, exact claim, metric, period, unit and version.",
    requiredEvidence:["Publisher-authenticated original source","Exact source locator and version","Counter-evidence check"],
  },
  metadata_correction_candidate:{
    action:"Review the disputed field against the original note and source; prepare a separate exact one-note proposal if supported.",
    requiredEvidence:["Full note context and original metadata","Correct value with supporting original source","Before/after diff and new hash check before any edit"],
  },
  navigation_link_candidate:{
    action:"Inspect both exact notes and existing backlinks; use the separate Safe Edit preview only after review.",
    requiredEvidence:["Full source and destination note context","Evidence of a meaningful relationship (not shared entity alone)","Unique edit anchor, current hashes and human approval"],
  },
  duplicate_or_conflicting_evidence:{
    action:"Reconcile source-family, event, claim, period, unit, versions and contradictions before any merge.",
    requiredEvidence:["Both underlying claim/source versions","Event and claim identifiers or defensible matching basis","Source independence and counter-evidence"],
  },
  unresolved:{
    action:"Hold the item for further review; no edit or source-status change.",
    requiredEvidence:["Reviewer-selected follow-up question","Relevant original source and historical context"],
  },
};

/**
 * A caller can request a worksheet with a disposition, but cannot turn
 * untrusted metadata or an AI suggestion into human authorization.
 */
export function prepareLegacyReviewDecision(
  sourcePath:string,
  disposition:ReviewDisposition,
  reviewRationale?:string,
){
  if(!REVIEW_DISPOSITIONS.includes(disposition))
    throw Error("legacy_review_invalid_disposition");
  if(reviewRationale!==undefined&&
    (typeof reviewRationale!=="string"||reviewRationale.length>600||
      /[\0\r]/.test(reviewRationale)))
    throw Error("legacy_review_invalid_rationale");
  const dossier=getLegacyReviewDossier(sourcePath);
  const kinds=new Set(dossier.findings.map(f=>f.kind));
  const needsMetadata=[...kinds].some(k=>
    k==="explicit_event_date_needs_review"||
    k==="invalid_source_records_metadata"||
    k==="conflicting_single_company_metadata");
  const navigation=dossier.findings.filter(f=>
    (f.kind==="legacy_company_hub_navigation_candidate"||
     f.kind==="declared_source_path_without_resolved_link")&&f.targetPath);
  const hasFinding=dossier.findings.length>0;
  // A proposal can be recorded even when no matching finding exists, but it
  // may not be interpreted as an actionable candidate until manually reviewed.
  const holdReason=
    disposition==="no_change_needed"&&hasFinding?
      "Open P1/P2/P3 findings require explicit human reconciliation before closure.":
    disposition==="metadata_correction_candidate"&&!needsMetadata?
      "No metadata-specific finding in this bounded exact-note dossier.":
    disposition==="navigation_link_candidate"&&navigation.length===0?
      "No eligible exact navigation-link candidate in this dossier.":
    disposition==="duplicate_or_conflicting_evidence"?
      "No claim-level pair, primary originals or independence evaluation was verified by this tool.":
    disposition==="missing_evidence"?
      "Absence from the Markdown index does not establish loss of an original source.":
    disposition==="needs_source_verification"?
      "Source identity and individual financial claims have not been authenticated.":
    disposition==="unresolved"?
      "Review remains open pending external evidence.":
      null;
  const base=FOLLOW_UP[disposition];
  return {
    status:"draft_review_decision_no_write" as const,
    exactNotePath:dossier.sourcePath,
    currentNoteSha256:dossier.source.sha256,
    currentNoteByteLength:dossier.source.byteLength,
    indexedNotesConsidered:dossier.indexedNotesConsidered,
    // Caller identity and evidence review have NOT been authenticated.
    callerSuppliedDisposition:disposition,
    callerSuppliedRationale:reviewRationale?.slice(0,600)??null,
    reviewerAuthenticated:false as const,
    evidenceVerificationPerformed:false as const,
    ownerApprovalGranted:false as const,
    reviewFindingCount:dossier.findings.length,
    reviewFindings:dossier.findings.map(f=>({
      kind:f.kind,priority:f.priority,targetPath:f.targetPath,
      sourcePath:f.sourcePath,
      sourceFactChecked:false as const,
    })),
    existingLinks:{
      count:dossier.indexedOutgoingLinks.count,
      truncated:dossier.indexedOutgoingLinks.truncated,
      sample:dossier.indexedOutgoingLinks.sample,
    },
    sourcePointers:dossier.targetChecks,
    actionProposed:base.action,
    proposedTargetPaths:disposition==="navigation_link_candidate"?
      navigation.map(n=>n.targetPath!):[],
    readiness:holdReason?"requires_manual_evidence_review" as const:
      "candidate_for_independent_human_review" as const,
    holdReason,
    requiredEvidence:base.requiredEvidence,
    proposedChangeLog:{
      sourcePath:dossier.sourcePath,
      sourceSha256:dossier.source.sha256,
      classification:disposition,
      rationale:reviewRationale?.slice(0,600)??null,
      state:"draft_unapproved_not_saved" as const,
      primarySourceVerification:"not_performed" as const,
      effectOnCurrentThesis:"unassessed" as const,
    },
    safeEditPreview:null,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
    nextStep:"Independently read full note and originals; verify context and any relationship; request explicit owner approval then use a separate one-note Safe Edit preview and recheck current hash. No operation has been saved or submitted." as const,
  };
}

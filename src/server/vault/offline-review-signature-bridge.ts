/**
 * Binds two detached Ed25519 signatures to a *fresh* PR #78 offline packet.
 * Caller cannot select a source hash, index fingerprint, markdown manifest,
 * or override physical readback. An untrusted policy is NOT an owner registry.
 * There is no signing or write capability.
 */
import {createHash} from "node:crypto";
import {prepareOfflineBoundEvidenceProposal,
  type OfflineBoundProposalRequest} from "./offline-bound-evidence-proposal";
import {digestOfflineReviewSubject,verifyOfflineSignedReviewReceipts,
  type OfflineReviewSubject,type OfflineReviewTrustPolicy,
  type SignatureReceipt} from "./offline-review-signature-gate";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
export function prepareOfflineBoundSignatureSubject(req:OfflineBoundProposalRequest){
  const packet=prepareOfflineBoundEvidenceProposal(req);
  if(!("storedSource" in packet)||!packet.storedSource||
    !("physicalMarkdownManifestSha256" in packet)||
    !("offlineIndexMetadataLinksFingerprint" in packet)||
    packet.status!=="human_review_required"||
    packet.safeEditPreview!==null||packet.canAutoWrite!==false||
    !packet.storedSource.exactStoredBlobIntegrityVerified)
    return {
      status:"source_bound_review_packet_hold" as const,
      subject:null,subjectSha256:null,
      reasons:packet.unresolvedGates,
      canAutoWrite:false as const,ownerApprovalGranted:false as const,
    };
  const subject:OfflineReviewSubject={
    scope:"offline_review_unapproved_v1",
    notePath:packet.exactTargetPath,
    noteSha256:packet.exactBeforeSha256,
    indexFingerprint:packet.offlineIndexMetadataLinksFingerprint,
    markdownManifestSha256:packet.physicalMarkdownManifestSha256,
    originalBlobSha256:packet.storedSource.originalBlobSha256,
    sourceKeySha256:packet.storedSource.sourceKeySha256,
    sourceRevision:packet.storedSource.revision,
    action:req.action,relationship:req.relationship,
    oldLineSha256:sha(req.oldLine),newLineSha256:sha(req.newLine),
    rationaleSha256:sha(req.reviewRationale),
  };
  return {
    status:"detached_subject_unapproved" as const,
    subject,subjectSha256:digestOfflineReviewSubject(subject),
    reasons:packet.unresolvedGates,
    canAutoWrite:false as const,ownerApprovalGranted:false as const,
  };
}
export function verifyOfflineBoundSignedReview(req:{
  packetRequest:OfflineBoundProposalRequest;
  policy:OfflineReviewTrustPolicy;
  reviewerReceipt:SignatureReceipt|null;
  ownerReceipt:SignatureReceipt|null;
}){
  const computed=prepareOfflineBoundSignatureSubject(req.packetRequest);
  if(computed.status!=="detached_subject_unapproved"||!computed.subject)
    return {
      status:"source_bound_review_packet_hold" as const,
      subjectSha256:null,
      findings:computed.reasons,
      reviewerSignatureMatchesSuppliedPolicy:false,
      ownerSignatureMatchesSuppliedPolicy:false,
      ownerApprovalGranted:false as const,canAutoWrite:false as const,
      canAutoUpdateThesis:false as const,vaultModified:false as const,
    };
  const signatures=verifyOfflineSignedReviewReceipts({
    subject:computed.subject,policy:req.policy,
    reviewerReceipt:req.reviewerReceipt,ownerReceipt:req.ownerReceipt,
  });
  return {
    ...signatures,
    status:signatures.status,
    sourcePacketStatus:computed.status,
    // No external trust anchor, persistent nonce journal, independent issuer
    // confirmation or writer permission is supplied by this bridge.
    ownerApprovalGranted:false as const,canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,vaultModified:false as const,
  };
}

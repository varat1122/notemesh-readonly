import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {prepareEvidenceGatedReviewProposal,type ReviewProposalInput} from "./evidence-gated-review-proposal";

const h=(v:string)=>createHash("sha256").update(v).digest("hex");
const note="---\ntype: knowledge_note\nsource_type: primary\n---\n# Synthetic historical review\nOriginal synthetic claim: 10.\n";
const sourceSha=h("synthetic original bytes only; no publisher verified");
function valid():ReviewProposalInput {
  return {
    target:{
      path:"10_Knowledge/Company Research/EXAMPLE - Historical Review.md",
      role:"historical_analysis",expectedSha256:h(note),
      indexedMtimeMs:1720000000000,indexedByteLength:Buffer.byteLength(note),
      expectedIndexFingerprint:h("index"),observedIndexFingerprint:h("index"),
      snapshotManifestSha256:h("manifest"),
      observedSnapshotManifestSha256:h("manifest"),
      snapshotStatus:"snapshot_markdown_index_reconciled_not_originals_verified",
    },
    detachedNoteText:note,
    observedReadback:{sha256:h(note),mtimeMs:1720000000000,
      byteLength:Buffer.byteLength(note)},
    source:{
      originalSource:"https://example.org/issuer/release",
      declaredFullHash:sourceSha,sourceType:"primary",
      independence:"not_assessed",
      archiveStatus:"offline_archived_bytes_intact_not_publisher_verified",
      receipt:{
        originalSource:"https://example.org/issuer/release",
        sha256:sourceSha,revision:1,byteStatus:"intact_stored_bytes",
        snapshotManifestSha256:h("manifest"),
      },
      eventKey:"EXAMPLE-2026Q2",eventDate:"2026-07-25",
      publishedAt:"2026-07-26T10:00:00Z",
      importedAt:"2026-07-27T10:00:00Z",
      verifiedAt:"2026-07-28T10:00:00Z",
      prior:null,
    },
    claim:{claimId:"claim-1",entity:"EXAMPLE",period:"2026Q2",
      metric:"revenue",unit:"USD millions",value:"10"},
    review:{disposition:"metadata_correction_candidate",rationale:"Synthetic correction proposal; requires independent owner approval",
      reviewerAuthenticated:true,ownerApprovalClaimed:false,
      relationship:"new_event"},
    edit:{oldLine:"Original synthetic claim: 10.",
      newLine:"Proposed synthetic claim: 12."},
  };
}
describe("PR #76 detached, evidence-gated read-only proposal",()=>{
  it("produces exact bounded diff and after hash, never owner-approved",()=>{
    const input=valid(),prior=structuredClone(input);
    const r=prepareEvidenceGatedReviewProposal(input);
    expect(r).toMatchObject({
      status:"read_only_proposal_ready",exactTargetPath:input.target.path,
      protectedTarget:false,unresolvedGates:[],
      publisherAuthenticityVerified:false,
      investmentClaimFactsVerified:false,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,vaultModified:false,
      reviewerAuthenticationIndependentlyVerified:false,
      safeEditPreview:{state:"detached_unapproved_not_safe_edit_operation",
        expectedBeforeSha256:h(note)},
      proposedChangeLog:{state:"draft_not_saved_not_approved"},
    });
    expect(r.safeEditPreview?.proposedAfterSha256)
      .toBe(h(note.replace(input.edit.oldLine,input.edit.newLine)));
    expect(r.safeEditPreview?.exactDiff).toContain("-Original synthetic claim: 10.");
    expect(input).toEqual(prior);
    expect(r.source.publisherIdentityVerified).toBe(false);
  });
  it("requires per-source intact matching full byte hash, not a registry URL alone",()=>{
    for(const mode of ["missing","tampered","wrongHash","wrongUrl","wrongSnapshot",
      "provenanceGaps"]){
      const x=valid();
      if(mode==="missing")x.source.receipt=null;
      if(mode==="tampered")x.source.receipt!.byteStatus="tampered_or_missing_bytes";
      if(mode==="wrongHash")x.source.receipt!.sha256=h("another revision");
      if(mode==="wrongUrl")x.source.receipt!.originalSource="https://example.org/other";
      if(mode==="wrongSnapshot")x.source.receipt!.snapshotManifestSha256=h("other");
      if(mode==="provenanceGaps")x.source.archiveStatus="offline_archive_bytes_intact_provenance_review_pending";
      const r=prepareEvidenceGatedReviewProposal(x);
      expect(r.status,mode).toBe("hold");
      expect(r.safeEditPreview,mode).toBeNull();
      expect(r.unresolvedGates).toContain("original_source_receipt_bytes_or_snapshot_unmatched");
    }
  });
  it("rejects stale note readback, concurrent note changes and index mismatch",()=>{
    for(const mode of ["noteChanged","sha","mtime","size","fingerprint","manifest","snapshot"]){
      const x=valid();
      if(mode==="noteChanged")x.detachedNoteText+="Concurrent change";
      if(mode==="sha")x.observedReadback.sha256=h("stale");
      if(mode==="mtime")x.observedReadback.mtimeMs++;
      if(mode==="size")x.target.indexedByteLength--;
      if(mode==="fingerprint")x.target.observedIndexFingerprint=h("new state");
      if(mode==="manifest")x.target.observedSnapshotManifestSha256=h("new manifest");
      if(mode==="snapshot")x.target.snapshotStatus="snapshot_coverage_hold";
      const r=prepareEvidenceGatedReviewProposal(x);
      expect(r.status,mode).toBe("hold");
      expect(r.safeEditPreview,mode).toBeNull();
    }
  });
  it("rejects invalid YAML-coerced numeric SHA and excerpt-only context",()=>{
    const x=valid();x.source.declaredFullHash=Number("1".repeat(20));
    const r=prepareEvidenceGatedReviewProposal(x);
    expect(r.status).toBe("hold");
    expect(r.unresolvedGates)
      .toContain("missing_invalid_or_yaml_coerced_full_source_hash");
  });
  it("never promotes archived AI or derivative summaries to independent originals",()=>{
    for(const kind of ["archived_ai","chatgpt_history","user_supplied_chatgpt_summary"]){
      const x=valid();x.source.sourceType=kind;
      x.source.independence="not_independent_archived_ai";
      const r=prepareEvidenceGatedReviewProposal(x);
      expect(r.status).toBe("hold");
      expect(r.safeEditPreview).toBeNull();
      expect(r.source.sourceIndependenceVerified).toBe(false);
    }
  });
  it("detects duplicate same event and hash without treating repeats as new evidence",()=>{
    const x=valid();
    x.source.prior={eventKey:x.source.eventKey!,originalSource:x.source.originalSource as string,
      sha256:sourceSha,revision:1};
    const result=prepareEvidenceGatedReviewProposal(x);
    expect(result.status).toBe("hold");
    expect(result.unresolvedGates).toContain("same_original_misclassified_as_new");
    x.review.relationship="duplicate";
    const duplicate=prepareEvidenceGatedReviewProposal(x);
    expect(duplicate.status).toBe("human_review_required");
    expect(duplicate.unresolvedGates).toContain("duplicate_event_same_original_not_independent");
  });
  it("recognizes newer same-event revision but does not assert verified claim correction",()=>{
    const x=valid();
    x.source.prior={eventKey:x.source.eventKey!,originalSource:x.source.originalSource as string,
      sha256:h("earlier different original"),revision:1};
    x.source.receipt!.revision=2;
    x.review.relationship="added_detail";
    const r=prepareEvidenceGatedReviewProposal(x);
    expect(r.status).toBe("read_only_proposal_ready");
    expect(r.relationship).toMatchObject({
      classification:"added_detail",previousRevision:1,currentRevision:2,
      humanClaimReconciliationPerformed:false,
    });
    x.source.receipt!.revision=1;
    expect(prepareEvidenceGatedReviewProposal(x).status).toBe("hold");
  });
  it("preserves unknown dates, and fails closed on reversed or malformed dates",()=>{
    const x=valid();x.source.eventDate=null;x.source.verifiedAt=null;
    const unknown=prepareEvidenceGatedReviewProposal(x);
    expect(unknown.status).toBe("human_review_required");
    expect(unknown.chronology.eventDate).toBeNull();
    expect(unknown.unresolvedGates).toContain("chronology_missing_fields_remain_unknown");
    x.source.eventDate="2026-02-30";
    expect(prepareEvidenceGatedReviewProposal(x).status).toBe("hold");
    x.source.eventDate="2026-07-25";
    x.source.importedAt="2026-07-24T00:00:00Z";
    expect(prepareEvidenceGatedReviewProposal(x).unresolvedGates)
      .toContain("publication_after_import_chronology_conflict");
  });
  it("distinguishes unauthenticated reviewer from an unverified owner-approval assertion",()=>{
    const x=valid();x.review.reviewerAuthenticated=false;
    expect(prepareEvidenceGatedReviewProposal(x)).toMatchObject({
      status:"human_review_required",ownerApprovalGranted:false,safeEditPreview:null,
    });
    x.review.reviewerAuthenticated=true;x.review.ownerApprovalClaimed=true;
    const r=prepareEvidenceGatedReviewProposal(x);
    expect(r.status).toBe("human_review_required");
    expect(r.ownerApprovalGranted).toBe(false);
    expect(r.unresolvedGates).toContain("owner_approval_claim_not_authorization");
  });
  it("rejects protected Thesis, Evidence Register and Portfolio even with all other gates green",()=>{
    for(const p of ["05_Thesis/EXAMPLE - Current Thesis.md",
      "06_Portfolio/2026.md","10_Knowledge/Evidence Register.md",
      "07_Sources/Original.md","../outside.md"]){
      const x=valid();x.target.path=p;
      const r=prepareEvidenceGatedReviewProposal(x);
      expect(r.status,p).toBe("hold");
      expect(r.protectedTarget,p).toBe(true);
      expect(r.safeEditPreview,p).toBeNull();
    }
  });
  it("does not generate previews for ambiguous, YAML or code fence anchors",()=>{
    for(const editNote of [
      note+"Original synthetic claim: 10.\n",
      "---\nOriginal synthetic claim: 10.\n---\n# Body\n",
      "---\ntype: review\n---\n~~~\nOriginal synthetic claim: 10.\n~~~\n",
    ]){
      const x=valid();x.detachedNoteText=editNote;
      x.target.expectedSha256=h(editNote);x.observedReadback.sha256=h(editNote);
      x.target.indexedByteLength=Buffer.byteLength(editNote);
      x.observedReadback.byteLength=Buffer.byteLength(editNote);
      const r=prepareEvidenceGatedReviewProposal(x);
      expect(r.status).toBe("hold");
      expect(r.safeEditPreview).toBeNull();
    }
  });
  it("does not invent claim fields for legacy narrative",()=>{
    const x=valid();x.claim=null;
    const r=prepareEvidenceGatedReviewProposal(x);
    expect(r.status).toBe("human_review_required");
    expect(r.claim).toBeNull();
    expect(r.unresolvedGates).toContain("legacy_narrative_has_no_structured_claim");
  });
});

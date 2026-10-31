import {describe,it,expect} from "vitest";
import {validateTypedEdge,canAutoPersist,type TypedEdge} from "./research-typed-edge";

// Blueprint §08.3 example, entirely hypothetical.
const hypothesis:TypedEdge={
  edgeId:"EDGE-EXAMPLE-001",subject:"company:COHR",predicate:"potential_beneficiary_of",object:"technology:optical-networking",
  assertionOrigin:"ai_inference",evidenceSourceIds:[],mechanism:"Possible second-order demand for optical components",
  verification:"unverified",strength:"possible",eventAt:null,validFrom:null,validTo:null,reviewBy:"2027-01-01",
  linkPolicy:"proposed_only",lifecycle:"active",
};
const supplier:TypedEdge={...hypothesis,edgeId:"EDGE-EXAMPLE-002",subject:"company:SUPPLIERCO",predicate:"supplier_to",
  object:"company:BUYERCO",assertionOrigin:"verified_primary",evidenceSourceIds:["src:buyer-10k-2026"],
  mechanism:"Buyer 10-K names supplier as sole source of a component",verification:"verified",strength:"confirmed",
  validFrom:"2026-01-01",reviewBy:null};
const citation:TypedEdge={...supplier,edgeId:"EDGE-EXAMPLE-003",subject:"source:buyer-10k-2026",predicate:"source_supports_claim",
  object:"claim:buyer-sole-source",mechanism:"Exact excerpt in Item 1A",linkPolicy:"auto_persist"};

describe("Blueprint §08 typed edge contract",()=>{
  it("accepts the §08.3 hypothesis as proposed-only",()=>{
    expect(validateTypedEdge(hypothesis)).toEqual([]);
    expect(canAutoPersist(hypothesis)).toBe(false);
  });

  it("never promotes a potential beneficiary to confirmed or auto-persisted",()=>{
    expect(validateTypedEdge({...hypothesis,strength:"confirmed",linkPolicy:"auto_persist"})).toEqual(
      expect.arrayContaining(["confirmed_requires_verified","hypothesis_predicate_cannot_be_confirmed","auto_persist_not_permitted"]));
  });

  it("verifies a supplier edge only with attributed evidence",()=>{
    expect(validateTypedEdge(supplier)).toEqual([]);
    expect(validateTypedEdge({...supplier,evidenceSourceIds:[]})).toContain("verified_without_evidence");
    expect(validateTypedEdge({...supplier,assertionOrigin:"user_or_social"})).toContain("commercial_relationship_needs_attributed_source");
    expect(validateTypedEdge({...supplier,assertionOrigin:"ai_inference"})).toContain("ai_inference_cannot_be_verified");
    // A verified supplier is still economic exposure, so it needs review before persisting.
    expect(canAutoPersist(supplier)).toBe(false);
  });

  it("auto-persists only verified citation edges",()=>{
    expect(validateTypedEdge(citation)).toEqual([]);
    expect(canAutoPersist(citation)).toBe(true);
    expect(canAutoPersist({...citation,assertionOrigin:"user_or_social"})).toBe(false);
    expect(validateTypedEdge({...citation,verification:"unverified",strength:"possible",reviewBy:"2027-01-01"}))
      .toContain("auto_persist_not_permitted");
  });

  it("rejects wrong node kinds, malformed ids and self edges",()=>{
    expect(validateTypedEdge({...supplier,object:"technology:optics"})).toContain("object_kind_not_allowed");
    expect(validateTypedEdge({...supplier,subject:"COHR"})).toContain("subject_invalid");
    expect(validateTypedEdge({...supplier,subject:"ticker:COHR"})).toContain("subject_invalid");
    expect(validateTypedEdge({...supplier,object:supplier.subject})).toContain("self_edge");
    expect(validateTypedEdge({...supplier,predicate:"mentions" as never})).toContain("predicate_unknown");
  });

  it("requires owner approval for edges touching Thesis or Decision",()=>{
    const thesis:TypedEdge={...citation,subject:"claim:buyer-sole-source",predicate:"claim_updates_thesis",object:"thesis:BUYERCO-core",linkPolicy:"proposed_only"};
    expect(validateTypedEdge(thesis)).toContain("protected_edge_requires_owner_approval");
    expect(validateTypedEdge({...thesis,linkPolicy:"owner_approval"})).toEqual([]);
  });

  it("requires a review date for open hypotheses and a valid time range",()=>{
    expect(validateTypedEdge({...hypothesis,reviewBy:null})).toContain("review_by_missing");
    expect(validateTypedEdge({...supplier,validFrom:"2026-06-01",validTo:"2026-01-01"})).toContain("valid_range_inverted");
    expect(validateTypedEdge({...supplier,eventAt:"2026-06-01T10:00:00"})).toContain("date_invalid");
  });

  it("retracts or supersedes instead of deleting",()=>{
    expect(validateTypedEdge({...hypothesis,lifecycle:"superseded"})).toContain("superseded_by_missing");
    expect(validateTypedEdge({...hypothesis,lifecycle:"superseded",supersededBy:hypothesis.edgeId})).toContain("superseded_by_missing");
    expect(validateTypedEdge({...hypothesis,lifecycle:"superseded",supersededBy:"EDGE-EXAMPLE-009"})).toEqual([]);
    expect(validateTypedEdge({...hypothesis,lifecycle:"retracted"})).toContain("retraction_reason_missing");
    expect(validateTypedEdge({...hypothesis,retractionReason:"wrong issuer"})).toContain("active_edge_has_lifecycle_fields");
    expect(canAutoPersist({...citation,lifecycle:"retracted",retractionReason:"source withdrawn"})).toBe(false);
  });
});

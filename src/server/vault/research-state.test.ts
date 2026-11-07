import {describe,it,expect} from "vitest";
import {draftMetadata,researchTrust,assertResearchStateAuthority} from "./research-state";

const draft={type:"investment_research_review",...draftMetadata};
describe("C1 typed research trust is separate from persistence and primary authority",()=>{
  it("projects Draft conservatively without inferring time, critic identity or truth",()=>{
    expect(researchTrust("review.md",{...draft,source_type:"primary",verification:"verified_against_primary",
      event_date:"2026-01-01",analysis_date:"2026-02-01"})).toMatchObject({research_status:"draft",
      usage_tier:"historical_analysis_only",independent_evidence_increment:0,comparator_eligible:false,
      primary_authority:false,owner_thesis_authority:false,critic_independence:"not_verified",
      analysis_as_of:null,analysis_created_at:null,persistence_verification:"not_assessed_by_trust_projection"});
  });
  it("retains distinct declared cutoff and creation instants without upgrading their provenance",()=>{
    expect(researchTrust("review.md",{...draft,knowledge_cutoff_as_of:"2026-08-26T20:36:00Z",
      analysis_created_at:"2026-11-07T09:00:00Z"})).toMatchObject({analysis_as_of:"2026-08-26T20:36:00Z",
      analysis_created_at:"2026-11-07T09:00:00Z",dates_provenance:"note_declared_not_reverified"});
    expect(researchTrust("review.md",{...draft,knowledge_cutoff_as_of:"2026-02-30T20:00:00Z"})?.analysis_as_of).toBeNull();
  });
  it("malformed indexed metadata cannot imply an authority-bearing state",()=>{
    for(const value of [null,[],"draft",{research_status:["draft"]}])expect(researchTrust("review.md",value)).toMatchObject({research_status:"unclassified",metadata_status:"unsupported_declaration_hold",primary_authority:false,comparator_eligible:false});
  });
  it("Source-only and legacy analytical memory do not masquerade as Reviewed",()=>{
    expect(researchTrust("source.md",{type:"investment_source_intake"})).toMatchObject({research_status:"source_only",usage_tier:"attributed_source_only"});
    expect(researchTrust("review.md",{type:"investment_research_review"})).toMatchObject({research_status:"unclassified",metadata_status:"legacy_unclassified",comparator_eligible:false});
    expect(researchTrust("archive.md",{source_type:"chatgpt_analysis"})?.usage_tier).toBe("historical_analysis_only");
    expect(researchTrust("receipt.md",{type:"primary_source_verification_receipt"})).toBeNull();
  });
  it.each([{research_status:"reviewed"},{research_status:"superseded"},{research_status:"disputed"},
    {comparator_eligible:true},{independent_evidence_increment:1},{critic_independence:"verified"},
    {usage_tier:"primary_fact"},{research_state_version:"future"},{research_status:["draft"]}])("unsupported promotion stays historical and cannot be minted: %j",delta=>{
    const proposed={...draft,...delta};
    expect(researchTrust("review.md",proposed)).toMatchObject({research_status:"unclassified",
      metadata_status:"unsupported_declaration_hold",comparator_eligible:false,independent_evidence_increment:0,critic_independence:"not_verified"});
    expect(()=>assertResearchStateAuthority({},proposed)).toThrow(/research_state/);
    expect(()=>assertResearchStateAuthority(draft,proposed)).toThrow(/research_state/);
    // Existing declarations are historical data, not a promotion API.
    expect(()=>assertResearchStateAuthority(proposed,{...proposed,title:"body-independent historical edit"})).not.toThrow();
  });
  it.each(Object.keys(draftMetadata))("a managed Draft cannot remove %s",key=>{
    const next:Record<string,unknown>={...draft};delete next[key];
    expect(()=>assertResearchStateAuthority(draft,next)).toThrow(/research_state/);
  });
  it("cannot change a Draft into a source-only exemption; accepted legacy creates remain unclassified",()=>{
    expect(()=>assertResearchStateAuthority(draft,{...draft,type:"investment_source_intake",research_status:"source_only",usage_tier:"attributed_source_only"})).toThrow(/artifact_transition/);
    expect(()=>assertResearchStateAuthority({},{type:"investment_research_review"})).not.toThrow();
    expect(()=>assertResearchStateAuthority({},draft)).not.toThrow();
  });
});

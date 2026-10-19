import {describe,it,expect} from "vitest";
import {reviewLegacyCompanyNavigation,type LegacyNavigationNote} from "./legacy-company-navigation";

const hub:LegacyNavigationNote={path:"01_Companies/ASML.md",role:"company",metadata:{
  type:"company_hub",status:"historical_research",
}};
const historical:LegacyNavigationNote={
  path:"10_Knowledge/Company Research/2026-07-16 - ASML Historical Broker Note.md",
  role:"historical_analysis",metadata:{
    type:"knowledge_note",source_type:"chatgpt_history",
    company:["ASML"],theme:["AI Infrastructure","Semiconductor Equipment"],
    source_records:["07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0007.md"],
  },
};
const falseFn=()=>false;
describe("legacy company metadata navigation is read-only",()=>{
  it("proposes one review-only link using exactly the company array and existing canonical hub",()=>{
    const r=reviewLegacyCompanyNavigation([historical,hub],true,falseFn,falseFn);
    expect(r).toMatchObject({
      status:"read_only_proposals",indexedNotesConsidered:2,
      eligibleHistoricalAndReviewNotes:1,singleLegacyCompanyCandidates:1,
      withAnyExistingOutgoingLinks:0,withoutExistingOutgoingLinks:1,
      declaredFieldCounts:{company:1,companies:0,ticker:0,theme:1,
        related_notes:0,source_records:1,related_paths:0,related_claim_ids:0},
      canAutoWrite:false,canAutoUpdateThesis:false,
    });
    expect(r.samples).toEqual([{
      sourcePath:historical.path,targetPath:hub.path,
      declaredCompany:"ASML",declaredField:"company",
      proposedWikilink:"[[01_Companies/ASML]]",
      reason:"single_explicit_legacy_company_matches_existing_unique_hub",
      provenance:"legacy_frontmatter_not_primary_verified",
      requiresHumanReview:true,canAutoWrite:false,
    }]);
  });
  it("does not propose a duplicate link even if other outgoing Obsidian links already exist",()=>{
    const r=reviewLegacyCompanyNavigation([historical,hub],true,
      (s,t)=>s===historical.path&&t===hub.path,()=>true);
    expect(r).toMatchObject({singleLegacyCompanyCandidates:0,
      alreadyLinkedToHub:1,withAnyExistingOutgoingLinks:1,
      withoutExistingOutgoingLinks:0,samples:[]});
  });
  it("holds multi-company notes and conflicting company/ticker declarations",()=>{
    const multi:LegacyNavigationNote={...historical,metadata:{company:["AMD","NVDA"]}};
    const conflicting:LegacyNavigationNote={...historical,
      path:"10_Knowledge/Company Research/Conflict.md",
      metadata:{company:["ASML"],ticker:"AMD"}};
    const r=reviewLegacyCompanyNavigation([multi,conflicting,hub],true,falseFn,falseFn);
    expect(r).toMatchObject({singleLegacyCompanyCandidates:0,
      ambiguousOrConflictingLegacyCompany:2,samples:[]});
  });
  it("does not invent canonical issuer mappings when an explicit company has no matching hub",()=>{
    const name:LegacyNavigationNote={...historical,metadata:{company:["ASML Holding"]}};
    const noHub:LegacyNavigationNote={...historical,
      path:"10_Knowledge/Company Research/Other.md",
      metadata:{company:["AMD"]}};
    const r=reviewLegacyCompanyNavigation([name,noHub,hub],true,falseFn,falseFn);
    expect(r).toMatchObject({invalidLegacyCompany:1,
      unresolvedCanonicalHub:1,singleLegacyCompanyCandidates:0});
  });
  it("does not suggest editing protected source, thesis or portfolio notes",()=>{
    const protectedRows:LegacyNavigationNote[]=[
      {path:"05_Thesis/ASML - Historical.md",role:"review",metadata:{company:["ASML"]}},
      {path:"07_Sources/ChatGPT/Entries/ASML.md",role:"historical_analysis",metadata:{company:["ASML"]}},
      {path:"06_Portfolio/ASML.md",role:"review",metadata:{company:["ASML"]}},
      {path:"09_Templates/ASML.md",role:"historical_analysis",metadata:{company:["ASML"]}},
    ];
    const r=reviewLegacyCompanyNavigation([...protectedRows,hub],true,falseFn,falseFn);
    expect(r).toMatchObject({eligibleHistoricalAndReviewNotes:0,
      singleLegacyCompanyCandidates:0});
  });
  it("defers to existing explicit entity planner and never assumes company is independent evidence",()=>{
    const e:LegacyNavigationNote={...historical,metadata:{entity:"ASML",company:["ASML"]}};
    const r=reviewLegacyCompanyNavigation([e,hub],true,falseFn,falseFn);
    expect(r).toMatchObject({eligibleHistoricalAndReviewNotes:1,
      singleLegacyCompanyCandidates:0});
    expect(r.canAutoUpdateThesis).toBe(false);
  });
  it("fails closed during incomplete or oversized index reads",()=>{
    const rows=[historical,hub];
    expect(reviewLegacyCompanyNavigation(rows,false,falseFn,falseFn))
      .toMatchObject({status:"incomplete_index_hold",
        singleLegacyCompanyCandidates:0,samples:[],canAutoWrite:false});
    const tooMany=Array.from({length:10_001},(_,i):LegacyNavigationNote=>({
      path:`10_Knowledge/Company Research/R${i}.md`,
      role:"historical_analysis",metadata:{company:["ASML"]},
    }));
    const r=reviewLegacyCompanyNavigation(tooMany,true,falseFn,falseFn);
    expect(r).toMatchObject({status:"incomplete_index_hold",singleLegacyCompanyCandidates:0});
  });
  it("allows only one explicitly named matching legacy company even when both declared fields agree",()=>{
    const note:LegacyNavigationNote={...historical,metadata:{
      companies:["ASML"],ticker:"ASML",related_notes:["[[01_Companies/ASML]]"],
    }};
    const r=reviewLegacyCompanyNavigation([note,hub],true,falseFn,falseFn);
    expect(r).toMatchObject({singleLegacyCompanyCandidates:1});
    expect(r.samples[0].declaredField).toBe("companies");
    expect(r.declaredFieldCounts.related_notes).toBe(1);
  });
});

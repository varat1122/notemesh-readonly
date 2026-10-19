import {describe,expect,it} from "vitest";
import {planCrossDomainLinkReview,type KnowledgeLinkNote} from "./cross-domain-link-review";

const company:KnowledgeLinkNote={path:"01_Companies/AMD.md",role:"company",metadata:{entity:"AMD"}};
const industry:KnowledgeLinkNote={path:"02_Industries_Themes/AI Infrastructure.md",role:"industry",
  metadata:{topic:"AI Infrastructure",related_paths:[company.path]}};
const macro:KnowledgeLinkNote={path:"10_Knowledge/Macro and Markets/US Policy.md",role:"review",
  metadata:{domain:"macro",related_claim_ids:["AMD-OCF-FY26"]}};
const register:KnowledgeLinkNote={
  path:"08_Daily_Weekly/Research Indexes/AMD OCF Claims.md",role:"structured_claim",
  metadata:{entity:"AMD",domain:"company",claims:[{claim_id:"AMD-OCF-FY26",metric:"operating_cash_flow",period:"FY26"}]},
};
const none=()=>false;
describe("cross-domain metadata-only review",()=>{
  it("supports both industry to company and macro to exact claim ID without inferential relationships",()=>{
    const plan=planCrossDomainLinkReview([macro,industry,register,company],true,none);
    expect(plan).toMatchObject({status:"read_only_proposals",candidateCount:2,
      ambiguousClaimReferences:0,unresolvedReferences:0,canAutoWrite:false,canAutoUpdateThesis:false});
    expect(plan.samples).toContainEqual({
      sourcePath:industry.path,targetPath:company.path,relation:"explicit_related_path",
      declaredReference:company.path,proposedWikilink:"[[01_Companies/AMD]]",
      provenance:"note_declared_unverified",requiresHumanReview:true,canAutoWrite:false,
    });
    expect(plan.samples).toContainEqual({
      sourcePath:macro.path,targetPath:register.path,relation:"unique_exact_claim_id",
      declaredReference:"AMD-OCF-FY26",
      proposedWikilink:"[[08_Daily_Weekly/Research Indexes/AMD OCF Claims]]",
      provenance:"note_declared_unverified",requiresHumanReview:true,canAutoWrite:false,
    });
  });
  it("halts all link proposals if the index is not complete",()=>{
    const plan=planCrossDomainLinkReview([macro,industry,register,company],false,none);
    expect(plan).toMatchObject({status:"incomplete_index_hold",candidateCount:0,samples:[],
      canAutoWrite:false,canAutoUpdateThesis:false});
  });
  it("does not choose one destination for duplicated Claim IDs",()=>{
    const second:KnowledgeLinkNote={...register,path:"08_Daily_Weekly/Research Indexes/AMD OCF Copy.md"};
    const plan=planCrossDomainLinkReview([macro,register,second],true,none);
    expect(plan).toMatchObject({candidateCount:0,ambiguousClaimReferences:1,samples:[]});
  });
  it("never constructs links for missing target paths, unknown Claim IDs or unsafe path text",()=>{
    const attempt:KnowledgeLinkNote={...industry,metadata:{
      related_paths:["01_Companies/Missing.md","../outside.md","01_Companies/AMD#Bad.md",company.path],
      related_claim_ids:["MISSING-ID","bad id"],
    }};
    const plan=planCrossDomainLinkReview([attempt,company],true,none);
    expect(plan).toMatchObject({candidateCount:1,unresolvedReferences:2,invalidReferences:3});
  });
  it("rejects mutation sources in protected folders, even if metadata is explicit",()=>{
    const protectedNotes:KnowledgeLinkNote[]=[
      {path:"05_Thesis/AMD - Current Thesis.md",role:"thesis",metadata:{related_paths:[company.path]}},
      {path:"06_Portfolio/AMD.md",role:"review",metadata:{related_paths:[company.path]}},
      {path:"07_Sources/ChatGPT/AMD.md",role:"archive",metadata:{related_paths:[company.path]}},
      {path:"09_Templates/Company.md",role:"method",metadata:{related_paths:[company.path]}},
    ];
    const plan=planCrossDomainLinkReview([...protectedNotes,company],true,none);
    expect(plan).toMatchObject({candidateCount:0,samples:[]});
  });
  it("deduplicates the same target from path and ID, and ignores already resolved wikilinks",()=>{
    const both:KnowledgeLinkNote={...macro,metadata:{
      related_paths:[register.path,register.path],related_claim_ids:["AMD-OCF-FY26"],
    }};
    const plan=planCrossDomainLinkReview([both,register],true,none);
    expect(plan.candidateCount).toBe(1);
    expect(plan.samples[0].relation).toBe("explicit_related_path");
    const linked=planCrossDomainLinkReview([both,register],true,(s,t)=>s===both.path&&t===register.path);
    expect(linked).toMatchObject({candidateCount:0,alreadyLinkedReferences:1});
  });
  it("rejects free text and oversized uncontrolled reference arrays without guessing",()=>{
    const hacked:KnowledgeLinkNote={...industry,metadata:{
      related_paths:Array.from({length:41},()=>company.path),related_claim_ids:"AMD-OCF-FY26",
    }};
    const plan=planCrossDomainLinkReview([hacked,company,register],true,none);
    expect(plan).toMatchObject({candidateCount:0,invalidReferences:2,samples:[]});
  });
  it("keeps bounded deterministic samples for large mixed-domain Vault batches",()=>{
    const sources=Array.from({length:12},(_,i):KnowledgeLinkNote=>({
      path:`10_Knowledge/Industry and Concepts/Compute ${String(i).padStart(2,"0")}.md`,
      role:"review",metadata:{related_paths:[company.path]},
    }));
    const plan=planCrossDomainLinkReview([...sources,company],true,none);
    expect(plan).toMatchObject({candidateCount:12,sampleTruncated:true});
    expect(plan.samples).toHaveLength(8);
    expect(plan.samples[0].sourcePath).toContain("Compute 00.md");
  });
});

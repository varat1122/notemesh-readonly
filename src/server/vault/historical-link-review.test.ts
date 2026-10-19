import {describe,expect,it} from "vitest";
import {planHistoricalLinkReview,type LinkReviewNote} from "./historical-link-review";

const source:LinkReviewNote={
  path:"10_Knowledge/Company Research/NVDA - Historical Research.md",
  role:"historical_analysis",entity:"NVDA",
};
const thesis:LinkReviewNote={
  path:"05_Thesis/NVDA - Current Thesis.md",role:"thesis",entity:"nvda",
};
const absent=()=>false;

describe("historical link reviewer (no Vault writes)",()=>{
  it("holds all recommendations if full-index coverage is unverified",()=>{
    const result=planHistoricalLinkReview([source,thesis],false,absent);
    expect(result).toMatchObject({
      status:"incomplete_index_hold",candidatesFound:0,samples:[],
      canAutoWrite:false,canAutoUpdateThesis:false,
    });
  });
  it("proposes only reviewable navigation for an exact note-declared issuer",()=>{
    const result=planHistoricalLinkReview([source,thesis],true,absent);
    expect(result.status).toBe("read_only_proposals");
    expect(result.samples).toEqual([{
      sourcePath:source.path,targetPath:thesis.path,
      declaredEntity:"NVDA",reason:"same_declared_entity_candidate_only",
      proposedWikilink:"[[05_Thesis/NVDA - Current Thesis]]",
      change:"preview_existing_note_via_safe_edit",
      requiresHumanReview:true,canAutoWrite:false,
    }]);
    expect(result.canAutoUpdateThesis).toBe(false);
  });
  it("never duplicates already-resolved links or infers an issuer from prose",()=>{
    expect(planHistoricalLinkReview([source,thesis],true,
      (s,t)=>s===source.path&&t===thesis.path).samples).toEqual([]);
    const unrelated={...source,entity:null};
    expect(planHistoricalLinkReview([unrelated,thesis],true,absent).samples).toEqual([]);
    const vague={...source,entity:"NVDA, AMD"};
    expect(planHistoricalLinkReview([vague,thesis],true,absent).samples).toEqual([]);
    const other={...source,entity:"AMD"};
    expect(planHistoricalLinkReview([other,thesis],true,absent).samples).toEqual([]);
  });
  it("does not choose between two top-priority thesis targets",()=>{
    const rival:LinkReviewNote={
      path:"05_Thesis/NVDA - Current Thesis - Copy.md",role:"thesis",entity:"NVDA",
    };
    const plan=planHistoricalLinkReview([source,thesis,rival],true,absent);
    expect(plan).toMatchObject({
      candidatesFound:0,ambiguousTopRankGroups:1,samples:[],canAutoWrite:false,
    });
  });
  it("never proposes editing protected archive/portfolio/thesis sources",()=>{
    const protectedRows:LinkReviewNote[]=[
      {path:"07_Sources/ChatGPT/History.md",role:"historical_analysis",entity:"NVDA"},
      {path:"06_Portfolio/Analysis.md",role:"review",entity:"NVDA"},
      {path:"05_Thesis/Old Review.md",role:"review",entity:"NVDA"},
      {path:"09_Templates/Old.md",role:"review",entity:"NVDA"},
    ];
    const result=planHistoricalLinkReview([...protectedRows,thesis],true,absent);
    expect(result.samples).toEqual([]);
  });
  it("picks a company hub only when no thesis hub exists, never guesses a path",()=>{
    const hub:LinkReviewNote={path:"01_Companies/NVDA.md",role:"company",entity:"NVDA"};
    const plan=planHistoricalLinkReview([source,hub],true,absent);
    expect(plan.samples[0].targetPath).toBe(hub.path);
    expect(plan.samples[0].proposedWikilink).toBe("[[01_Companies/NVDA]]");
  });
  it("refuses wikilink destinations with structural link syntax in their filename",()=>{
    for(const suffix of ["#Heading","^block","\\\\unsafe","[alias]","|other"]) {
      const unsafe:LinkReviewNote={...thesis,path:"05_Thesis/NVDA "+suffix+".md"};
      expect(planHistoricalLinkReview([source,unsafe],true,absent).samples).toEqual([]);
    }
  });
  it("selects exactly one source for a targeted review rather than the bounded first-eight sample",()=>{
    const sources=Array.from({length:12},(_,i):LinkReviewNote=>({
      path:`10_Knowledge/Company Research/NVDA - History ${String(i).padStart(2,"0")}.md`,
      role:"historical_analysis",entity:"NVDA",
    }));
    const path=sources[11].path;
    const report=planHistoricalLinkReview([...sources,thesis],true,absent,path);
    expect(report).toMatchObject({candidatesFound:1,sampleTruncated:false});
    expect(report.samples[0].sourcePath).toBe(path);
  });
  it("bounds deterministic output to eight proposed links",()=>{
    const sources=Array.from({length:12},(_,i):LinkReviewNote=>({
      path:`10_Knowledge/Company Research/NVDA - History ${String(i).padStart(2,"0")}.md`,
      role:"historical_analysis",entity:"NVDA",
    }));
    const plan=planHistoricalLinkReview([...sources,thesis],true,absent);
    expect(plan).toMatchObject({candidatesFound:12,sampleTruncated:true});
    expect(plan.samples).toHaveLength(8);
    expect(plan.samples[0].sourcePath).toContain("History 00.md");
    expect(plan.samples[7].sourcePath).toContain("History 07.md");
  });
});

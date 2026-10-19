import {describe,expect,it} from "vitest";
import {planKnowledgeReviewPriorities,type TriageNote} from "./knowledge-review-priority";
const note=(path:string,role:TriageNote["role"],metadata:Record<string,unknown>={}):TriageNote=>({
  path,role,metadata,
});
const historical="10_Knowledge/Company Research/ASML — Old Research.md";
const source="07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0007.md";
const hub="01_Companies/ASML.md";
const linked=()=>true;
const missing=()=>false;
describe("evidence-first human legacy note review priorities",()=>{
  it("puts source availability and explicit invalid chronology ahead of link cosmetics",()=>{
    const records=[
      note(historical,"historical_analysis",{
        company:["ASML"],date:"2026-07-16",event_date:"Unknown",
        source_records:[source],
        verification:"not_reverified",
      }),
      note(hub,"company",{type:"company_hub"}),
    ];
    const r=planKnowledgeReviewPriorities(records,true,missing);
    expect(r).toMatchObject({
      status:"review_queue_index_complete_not_verified",eligibleSourceNotes:1,
      notesWithAtLeastOneFinding:1,findingsTotal:3,
      countsByKind:{
        declared_source_path_not_indexed:1,explicit_event_date_needs_review:1,
        declared_source_path_without_resolved_link:0,
        invalid_source_records_metadata:0,conflicting_single_company_metadata:0,
        legacy_company_hub_navigation_candidate:1,
      },
      canAutoWrite:false,canAutoUpdateThesis:false,
    });
    expect(r.samples.map(s=>s.kind)).toEqual([
      "declared_source_path_not_indexed",
      "explicit_event_date_needs_review",
      "legacy_company_hub_navigation_candidate",
    ]);
    expect(r.samples[0]).toMatchObject({
      sourcePath:historical,targetPath:source,
      priority:"P1_provenance_or_chronology",
      reason:"indexed_metadata_review_only_not_a_verified_error",
      requiresFullNoteAndSourceReview:true,canAutoWrite:false,
    });
  });
  it("does not flag existing resolved primary-history links or infer an event date from legacy date",()=>{
    const r=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{
        company:["ASML"],source_records:[source],date:"2026-07-16",
        theme:["AI Infrastructure"],
      }),note(source,"archive"),note(hub,"company"),
    ],true,(s,t)=>s===historical&&(t===source||t===hub));
    expect(r).toMatchObject({findingsTotal:0,notesWithAtLeastOneFinding:0,samples:[]});
    expect(r.eligibleSourceNotes).toBe(1);
  });
  it("suggests missing resolved source link separately from index unavailability",()=>{
    const r=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{source_records:[source]}),
      note(source,"archive"),
    ],true,missing);
    expect(r).toMatchObject({findingsTotal:1});
    expect(r.samples[0]).toMatchObject({
      kind:"declared_source_path_without_resolved_link",
      priority:"P2_attribution_or_scope",targetPath:source,
    });
  });
  it("reports malformed legacy references without constructing unsafe link targets",()=>{
    const x=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{
        source_records:["../../private.md","07_Sources/ChatGPT/Entries/a.md"],
      }),
    ],true,missing);
    expect(x).toMatchObject({findingsTotal:1});
    expect(x.samples[0]).toMatchObject({kind:"invalid_source_records_metadata",targetPath:null});
    const y=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{source_records:"07_Sources/ChatGPT/Entries/a.md"}),
    ],true,missing);
    expect(y.countsByKind.invalid_source_records_metadata).toBe(1);
  });
  it("does not treat legitimate multi-company research as an error or choose one winner",()=>{
    const multi=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{company:["ASML","AMD"]}),
      note(hub,"company"),note("01_Companies/AMD.md","company"),
    ],true,missing);
    expect(multi).toMatchObject({findingsTotal:0,samples:[]});
    const conflict=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{company:["ASML"],ticker:"AMD"}),
      note(hub,"company"),note("01_Companies/AMD.md","company"),
    ],true,missing);
    expect(conflict.samples).toEqual([expect.objectContaining({
      kind:"conflicting_single_company_metadata",priority:"P2_attribution_or_scope",
      targetPath:null,
    })]);
  });
  it("never marks protected source, portfolio or draft thesis for review editing",()=>{
    const fields={source_records:[source],event_date:"Unknown",company:["ASML"]};
    const r=planKnowledgeReviewPriorities([
      note("07_Sources/ChatGPT/Old.md","historical_analysis",fields),
      note("05_Thesis/ASML - Current Thesis.md","review",fields),
      note("06_Portfolio/ASML.md","review",fields),
      note("09_Templates/ASML.md","review",fields),
      note(hub,"company"),
    ],true,missing);
    expect(r).toMatchObject({eligibleSourceNotes:0,findingsTotal:0,samples:[]});
  });
  it("requires one exact existing canonical ticker hub, with no alias or title inference",()=>{
    const row=note(historical,"historical_analysis",{company:["ASML"]});
    const r=planKnowledgeReviewPriorities([
      row,note("01_Companies/ASML Holding.md","company"),
    ],true,missing);
    expect(r.findingsTotal).toBe(0);
    const p=planKnowledgeReviewPriorities([row,note(hub,"company")],true,missing);
    expect(p.samples[0]).toMatchObject({
      kind:"legacy_company_hub_navigation_candidate",
      priority:"P3_navigation_only",targetPath:hub,
    });
  });
  it("does not claim a full census before index completes or after exceeding the cap",()=>{
    const notes=[note(historical,"historical_analysis",{event_date:"Unknown"})];
    expect(planKnowledgeReviewPriorities(notes,false,missing)).toMatchObject({
      status:"incomplete_index_hold",findingsTotal:0,samples:[],canAutoWrite:false,
    });
    const tenK=Array.from({length:10_001},(_,i)=>
      note(`10_Knowledge/Research/R${i}.md`,"review",{event_date:"Unknown"}));
    expect(planKnowledgeReviewPriorities(tenK,true,missing)).toMatchObject({
      status:"incomplete_index_hold",findingsTotal:0,samples:[],
    });
  });
  it("returns bounded deterministic samples across priorities rather than only the first four paths",()=>{
    const notes=Array.from({length:13},(_,i)=>
      note(`10_Knowledge/Company Research/Old ${String(i).padStart(2,"0")}.md`,
        "historical_analysis",{event_date:"Unknown",source_records:["07_Sources/ChatGPT/Entries/missing.md"]}));
    const r=planKnowledgeReviewPriorities(notes,true,missing);
    expect(r).toMatchObject({
      findingsTotal:26,notesWithAtLeastOneFinding:13,sampledFindings:8,
      sampleTruncated:true,countsByPriority:{
        P1_provenance_or_chronology:26,P2_attribution_or_scope:0,P3_navigation_only:0,
      },
    });
    expect(r.samples[0].sourcePath).toContain("Old 00.md");
    expect(r.samples[4].kind).toBe("explicit_event_date_needs_review");
  });
  it("accepts real valid zoned timestamps but rejects garbage after a valid date prefix",()=>{
    const good=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{event_date:"2026-10-19T18:00:00+07:00"}),
    ],true,missing);
    expect(good.findingsTotal).toBe(0);
    const bad=planKnowledgeReviewPriorities([
      note(historical,"historical_analysis",{event_date:"2026-10-19Tnot-a-time"}),
    ],true,missing);
    expect(bad.countsByKind.explicit_event_date_needs_review).toBe(1);
  });
});

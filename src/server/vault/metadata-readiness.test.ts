import {describe,it,expect} from "vitest";
import {inventoryVaultMetadataReadiness,type ReadinessNote} from "./metadata-readiness";

const note=(path:string,role:ReadinessNote["role"],metadata:Record<string,unknown>={}):ReadinessNote=>({
  path,role,metadata,
});
describe("whole-index legacy metadata readiness — read-only",()=>{
  it("profiles all indexed roles, but excludes protected originals from navigation-edit coverage",()=>{
    const report=inventoryVaultMetadataReadiness([
      note("10_Knowledge/Company Research/AMD History.md","historical_analysis",{
        source_type:"chatgpt_history",date:"2026-08-01",
      }),
      note("10_Knowledge/Company Research/AMD Review.md","review",{
        entity:"AMD",event_date:"2026-08-01",published_at:"2026-08-02",
        related_paths:["01_Companies/AMD.md"],
      }),
      note("01_Companies/AMD.md","company",{entity:"AMD",imported_at:"2026-09-01"}),
      note("02_Industries_Themes/Compute.md","industry",{
        related_claim_ids:["AMD-OCF-FY26"],
      }),
      note("05_Thesis/AMD - Current Thesis.md","thesis",{
        entity:"AMD",related_paths:["01_Companies/AMD.md"],
      }),
      note("07_Sources/ChatGPT/AMD History.md","archive",{related_paths:["01_Companies/AMD.md"]}),
      note("06_Portfolio/AMD.md","review",{related_paths:["01_Companies/AMD.md"]}),
    ],true);
    expect(report).toMatchObject({
      status:"indexed_metadata_readiness_not_verified",scanned:7,
      eligibleNavigationSources:4,notesWithAnyReference:2,
      notesWithoutReference:2,historicalNotesWithoutEntity:1,
      malformedReferenceFields:0,canAutoWrite:false,canAutoUpdateThesis:false,
    });
    expect(report.byRole.historical_analysis).toMatchObject({
      notes:1,editableNavigationSources:1,
      historicalWithoutEntity:1,legacyDateWithoutEventDate:1,
    });
    expect(report.byRole.thesis).toMatchObject({notes:1,editableNavigationSources:0});
    expect(report.byFolder["10_Knowledge"]).toMatchObject({
      notes:2,editableNavigationSources:2,anyReferenceDeclared:1,
    });
    expect(report.examples.historicalWithoutEntity).toEqual([
      "10_Knowledge/Company Research/AMD History.md",
    ]);
    expect(report.examples.withoutNavigationReferences).toEqual([
      "01_Companies/AMD.md","10_Knowledge/Company Research/AMD History.md",
    ]);
  });
  it("keeps separate malformed metadata diagnostics without inferring relations",()=>{
    const result=inventoryVaultMetadataReadiness([
      note("10_Knowledge/Macro and Markets/Thailand.md","review",{
        related_paths:"01_Companies/AMD.md",related_claim_ids:[""],
      }),
      note("02_Industries_Themes/Sector.md","industry",{
        related_paths:[],related_claim_ids:["P-1"],
      }),
    ],true);
    expect(result).toMatchObject({
      eligibleNavigationSources:2,notesWithAnyReference:1,
      notesWithoutReference:1,malformedReferenceFields:1,
    });
    expect(result.examples.malformedReferenceFields).toEqual([
      "10_Knowledge/Macro and Markets/Thailand.md",
    ]);
    expect(result.byRole.review.malformedReferenceFields).toBe(1);
  });
  it("holds recommendations and numerical inventory when incomplete or over cap",()=>{
    const notes=[note("10_Knowledge/Research.md","review",{entity:"AMD"})];
    const hold=inventoryVaultMetadataReadiness(notes,false);
    expect(hold).toMatchObject({
      status:"incomplete_index_hold",scanned:1,eligibleNavigationSources:0,
      notesWithAnyReference:0,examples:{
        historicalWithoutEntity:[],withoutNavigationReferences:[],malformedReferenceFields:[],
      },
    });
    const over=inventoryVaultMetadataReadiness(Array.from({length:10_001},(_,i)=>
      note("10_Knowledge/History "+i+".md","historical_analysis",{})),true);
    expect(over).toMatchObject({status:"incomplete_index_hold",scanned:10_001,
      eligibleNavigationSources:0,canAutoWrite:false});
  });
  it("bounds samples but reports all eligible metadata opportunities across many notes",()=>{
    const notes=Array.from({length:13},(_,i)=>
      note(`10_Knowledge/Company Research/Review ${String(i).padStart(2,"0")}.md`,
        "historical_analysis",{}));
    const report=inventoryVaultMetadataReadiness(notes,true);
    expect(report).toMatchObject({
      scanned:13,eligibleNavigationSources:13,notesWithoutReference:13,
      historicalNotesWithoutEntity:13,sampleTruncated:true,
    });
    expect(report.examples.withoutNavigationReferences).toHaveLength(8);
    expect(report.examples.historicalWithoutEntity).toHaveLength(8);
    expect(report.examples.withoutNavigationReferences[0]).toContain("Review 00.md");
  });
  it("does not label an unlinked note as incorrect or imply a missing relation is mandatory",()=>{
    const r=inventoryVaultMetadataReadiness([
      note("10_Knowledge/Macro and Markets/Fed.md","review",{entity:"Federal Reserve"}),
    ],true);
    expect(r.notesWithoutReference).toBe(1);
    expect(r.warnings.join(" ")).toContain("not proof");
    expect(r.canAutoWrite).toBe(false);
  });
});

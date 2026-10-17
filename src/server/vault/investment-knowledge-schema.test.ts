import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./markdown";
import { inspectCanonicalKnowledgeMetadata as inspect } from "./investment-knowledge-schema";

const fixture=(path:string,props:string[])=>inspect(path,splitFrontmatter(["---",...props,"---","# Fixture"].join("\n")).data);
const sec="https://www.sec.gov/Archives/amd-20260627.htm";

describe("canonical read-time knowledge schema adapter",()=>{
  it("AMD SEC quarterly revenue and gross margin have exact claim identities",()=>{
    const p=fixture("08_Daily_Weekly/Research Indexes/Primary Evidence - AMD Q2.md",[
      "type: investment_structured_claim_register","domain: company","entity: AMD",
      "event_key: AMD|2026Q2|SEC10Q","event_date: 2026-08-04",
      "published_at: 2026-08-05","imported_at: 2026-10-17",
      "original_source: "+sec,"source_type: primary",
      "verification: verified_against_primary",
      "claims:","  - claim_id: AMD-Q2-REVENUE","    metric: net_revenue",
      "    period: 2026Q2_ended_2026-06-27","    value: \"11536\"",
      "    unit: USD millions","  - claim_id: AMD-Q2-GM",
      "    metric: gross_margin_gaap_rounded",
      "    period: 2026Q2_ended_2026-06-27","    value: \"54\"","    unit: percent"
    ]);
    expect(p.role).toBe("structured_claim");
    expect(p.claimCount).toBe(2);
    expect(p.claimIssues).toEqual([]);
    expect(p.eventDate).toBe("2026-08-04");
    expect(p.publishedAt).toBe("2026-08-05");
    expect(p.importedAt).toBe("2026-10-17");
    expect(p.sourceHashScope).toBe("none");
    expect(p.canAutoUpdateThesis).toBe(false);
  });
  it("NVDA H1 OCF is distinct from a child claim explicitly belonging to AMD",()=>{
    const p=fixture("08_Daily_Weekly/Research Indexes/NVDA SEC claim.md",[
      "type: investment_structured_claim_register","domain: company","entity: NVDA",
      "event_key: NVDA|SEC10Q|FY27Q2","original_source: "+sec,
      "claims:","  - claim_id: NVDA-OCF","    metric: operating_cash_flow",
      "    period: FY27_H1_ended_2026-07-26","    value: \"74421\"","    unit: USD millions",
      "  - claim_id: AMD-REVENUE","    entity: AMD","    metric: net_revenue",
      "    period: 2026Q2","    value: \"11536\"","    unit: USD millions"
    ]);
    expect(p.claimIssues).toEqual([]);
    expect(p.claimCount).toBe(2);
    expect(p.warnings).toContain("claim_1_explicit_different_issuer_do_not_inherit");
  });
  it("Vietnam Q3 and 9M GDP report are separate periods without fabricated event date",()=>{
    const p=fixture("10_Knowledge/Macro and Markets/Vietnam GDP.md",[
      "type: investment_structured_claim_register","domain: macro","entity: Vietnam",
      "event_key: Vietnam|2026Q3_9M|NSO","original_source: https://www.nso.gov.vn/report",
      "claims:","  - claim_id: VNM-Q3","    metric: gdp_real_growth_yoy",
      "    period: 2026Q3","    value: \"9.95\"","    unit: percent",
      "  - claim_id: VNM-9M","    metric: gdp_real_growth_yoy",
      "    period: 2026_9M","    value: \"9.01\"","    unit: percent"
    ]);
    expect(p.claimCount).toBe(2);
    expect(p.claimIssues).toEqual([]);
    expect(p.eventDate).toBeNull();
  });
  it("ChatGPT archive date and imported_on are not asserted as original news chronology",()=>{
    const p=fixture("07_Sources/ChatGPT/Entries/Feed 160726.md",[
      "type: investment_review","source_type: archived_ai",
      "date: 2026-07-16","imported_on: 2026-10-17",
      "verification: not_reverified","source_url: https://example.com/repost"
    ]);
    expect(p.eventDate).toBeNull();
    expect(p.importedAt).toBeNull();
    expect(p.legacyDate).toBe("2026-07-16");
    expect(p.legacyImportedOn).toBe("2026-10-17");
    expect(p.originalSource).toBeNull();
    expect(p.declaredSourceType).toBe("archived_ai");
    expect(p.warnings).toContain("legacy_imported_on_not_inferred");
    expect(p.warnings).toContain("source_url_not_confirmed_original");
  });
  it("source_type unverified is not a real source class",()=>{
    const p=fixture("09_Templates/News Intake Template.md",[
      "type: news","source_type: unverified"
    ]);
    expect(p.role).toBe("method");
    expect(p.declaredSourceType).toBeNull();
    expect(p.warnings).toContain("source_type_misused_for_verification");
  });
  it("excerpt-only verification receipt never masquerades as entire raw document",()=>{
    const p=fixture("08_Daily_Weekly/Research Indexes/Source Receipt.md",[
      "type: primary_source_verification_receipt","claim_id: AMD-Q2",
      "source_excerpt_sha256: "+ "a".repeat(64),"original_source_sha256: null"
    ]);
    expect(p.role).toBe("source_receipt");
    expect(p.claimCount).toBe(0);
    expect(p.sourceHashScope).toBe("excerpt_only");
    expect(p.warnings).toContain("receipt_is_audit_metadata_not_independent_evidence");
  });
  it("flags missing unit/period and impossible dates on a structured record",()=>{
    const p=fixture("08_Daily_Weekly/Research Indexes/Bad.md",[
      "type: investment_structured_claim_register","domain: company",
      "entity: AMD","event_date: 2026-02-30",
      "claims:","  - claim_id: C1","    metric: revenue","    value: \"123\""
    ]);
    expect(p.eventDate).toBeNull();
    expect(p.warnings).toContain("invalid_event_date");
    expect(p.claimIssues).toContain("claim_0_missing_period");
    expect(p.claimIssues).toContain("claim_0_missing_unit");
  });
  it("maps existing source, index, industry and legacy research types from real Vault roles",()=>{
    const data=[
      {path:"08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md",type:"primary_ir_evidence_review",role:"source"},
      {path:"08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md",type:"investment_evolution_master",role:"timeline"},
      {path:"08_Daily_Weekly/Research Indexes/00_Industry_TAM_Vintage_CPU_GPU_Optical.md",type:"industry_tam_version_register",role:"industry"},
      {path:"08_Daily_Weekly/Research Indexes/00_AI_Infrastructure_Economic_Transmission.md",type:"investment_economic_transmission_graph",role:"industry"},
      {path:"03_Concepts/OCS.md",type:"concept_hub",role:"industry"},
      {path:"10_Knowledge/Company Research/AMD old summary.md",type:"research_note",role:"review"}
    ];
    for(const x of data){
      const p=fixture(x.path,["type: "+x.type,"verification: not_reverified"]);
      expect(p.role,x.path).toBe(x.role);
      expect(p.canAutoUpdateThesis).toBe(false);
    }
  });
  it("draft Current Thesis is never inferred owner approved",()=>{
    const p=fixture("05_Thesis/NVDA - Current Thesis.md",[
      "type: current_thesis","status: draft_from_archived_evidence",
      "verification: not_reverified"
    ]);
    expect(p.role).toBe("thesis");
    expect(p.warnings).toContain("thesis_not_owner_approved_by_status");
    expect(p.canAutoUpdateThesis).toBe(false);
  });
});

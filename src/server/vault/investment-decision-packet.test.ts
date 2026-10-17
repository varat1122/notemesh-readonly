import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"decision-packet-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,content:string) {
  const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,content,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(p);
}
const nvda={
  domain:"company" as const,entity:"NVDA",metric:"operating_cash_flow",
  period:"FY27_H1_ended_2026-07-26",originalSource:"https://example.com/nvda-fy27q2",
  statement:"NVIDIA reported operating cash flow of USD 74,421 million during its six-month reporting period.",
  value:"74421",unit:"USD millions",eventDate:"2026-08-26"
};
const macro={
  domain:"macro" as const,entity:"Vietnam",metric:"gdp_real_growth_yoy",
  period:"2026Q3",originalSource:"https://example.gov/vietnam-q3-2026",
  statement:"Vietnam official release estimated GDP growth at 9.95 percent during Q3 2026.",
  value:"9.95",unit:"percent",eventDate:"2026-10-03"
};
async function packet(input:typeof nvda|typeof macro|any){
  const {reviewInvestmentClaim}=await import("./investment-claim-review");
  const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
  const review=reviewInvestmentClaim(input);
  return {review,packet:buildInvestmentDecisionPacket(input,review)};
}
describe("universal investment decision packet",()=>{
  it("does not infer issuer approval, cash-flow impact or a Thesis change from a matching source",async()=>{
    await add("05_Thesis/NVDA - Current Thesis.md",
      "---\nverification: not_reverified\nstatus: draft_from_archived_evidence\n---\n# NVDA draft Thesis\nRisks require receipts.");
    await add("05_Thesis/NVDA - Evidence Register.md",
      "# Evidence Register\n## Counter-evidence\nCustomer financing needs validation.");
    await add("08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md",
      `---
ticker: [NVDA]
source_url: ${nvda.originalSource}
verification: verified_against_primary
claims:
  - claim_id: NVDA-OCF-27H1
    metric: operating_cash_flow
    period: FY27_H1_ended_2026-07-26
    value: "74421"
    unit: USD millions
---
# FY27Q2 SEC note
OCF reported for six months.`);
    const {review,packet:p}=await packet(nvda);
    expect(review.classification).toBe("duplicate_candidate");
    expect(p.status).toBe("analyst_review_packet_not_verified");
    expect(p.claimGate.classification).toBe("duplicate_candidate");
    expect(p.claimGate.externalPrimaryVerification).toBe("not_performed");
    expect(p.historicalContext.protectedThesisPaths).toContain("05_Thesis/NVDA - Current Thesis.md");
    expect(p.historicalContext.historicalThesisOwnerApproval).toBe("not_established");
    expect(p.businessTransmission.priorityCheckpoints).toContain("cash_flow");
    expect(p.businessTransmission.stages.every(x=>x.status==="not_assessed")).toBe(true);
    expect(p.thesisDecision.selected).toBeNull();
    expect(p.thesisDecision.confidence).toBeNull();
    expect(p.thesisDecision.canAutoUpdateThesis).toBe(false);
    expect(p.changeLogDraft.matchedClaimIds).toContain("NVDA-OCF-27H1");
  });
  it("treats contradictory numerical metadata as an unresolved adjudication, not a bearish thesis",async()=>{
    await add("10_Knowledge/Company Research/NVDA OCF.md",`---
entity: NVDA
metric: operating_cash_flow
period: FY27_H1_ended_2026-07-26
source_url: ${nvda.originalSource}
value: "74000"
unit: USD millions
---
# OCF comparison`);
    const {review,packet:p}=await packet(nvda);
    expect(review.classification).toBe("possible_correction_or_contradiction");
    expect(p.nextActions[0]).toContain("Adjudicate");
    expect(p.thesisDecision.selected).toBe(null);
    expect(p.pricingAndPortfolio.marketPricing).toBe("not_checked");
  });
  it("uses Macro → asset classes → industry → company transmission, without requiring Current Thesis",async()=>{
    await add("10_Knowledge/Macro and Markets/2026-10-03 - Vietnam GDP.md",`---
country: Vietnam
source_type: primary
source_url: ${macro.originalSource}
verification: verified_against_primary
claims:
  - claim_id: VNM-2026Q3-GDP
    metric: gdp_real_growth_yoy
    period: 2026Q3
    value: "9.95"
    unit: percent
---
# Vietnam GDP Q3`);
    const {packet:p}=await packet(macro);
    expect(p.businessTransmission.stages.map(x=>x.id)).toEqual(
      expect.arrayContaining(["macro_demand_policy","asset_classes","industry_supply_chain","revenue_conversion","earnings_cash_flow","valuation","portfolio"]));
    expect(p.historicalContext.protectedThesisPaths).toEqual([]);
    expect(p.historicalContext.missing.join(" ")).not.toContain("owner-endorsed");
    expect(p.changeLogDraft.eventDate).toBe("2026-10-03");
    expect(p.thesisDecision.status).toBe("undetermined_requires_research");
    expect(p.pricingAndPortfolio.consensus).toBe("not_checked");
  });
  it("does not silently invent new industry/asset events when no structured records exist",async()=>{
    const cases=[
      {domain:"industry" as const,entity:"Optical Networking",metric:"800G_transceiver_shipments",period:"2026Q3",originalSource:"https://example.org/shipments",statement:"Synthetic optical shipments require independent original industry sourcing."},
      {domain:"asset" as const,entity:"US10Y",metric:"treasury_yield_close",period:"2026-10-16",originalSource:"https://example.org/treasury",statement:"Synthetic Treasury yield close requires historical price and curve verification."}
    ];
    for(const input of cases){
      const {review,packet:p}=await packet(input);
      expect(review.classification).toBe("unresolved");
      expect(p.historicalContext.retrieval).toBe("bounded_lexical_only");
      expect(p.businessTransmission.stages.length).toBeGreaterThanOrEqual(6);
      expect(p.thesisDecision.selected).toBeNull();
      expect(p.pricingAndPortfolio.portfolioExposure).toBe("not_checked");
      expect(p.nextActions[0]).toContain("Search");
    }
  });
  it("produces source-linked change log candidate without Vault writes",async()=>{
    const abs=path.join(vault,"10_Knowledge","Macro and Markets","Vietnam GDP Q3.md");
    await add("10_Knowledge/Macro and Markets/Vietnam GDP Q3.md",`---
country: Vietnam
source_url: ${macro.originalSource}
---
# Vietnam previous comment`);
    const before=fs.readFileSync(abs,"utf8");
    const {packet:p}=await packet(macro);
    expect(p.changeLogDraft.status).toBe("draft_not_approved_or_written");
    expect(p.changeLogDraft.requiredBeforeWrite.join(" ")).toContain("owner");
    expect(p.counterEvidence.status).toBe("not_verified");
    expect(p.historicalContext.missing.some(x=>x.includes("original source"))).toBe(true);
    expect(fs.readFileSync(abs,"utf8")).toBe(before);
  });
});

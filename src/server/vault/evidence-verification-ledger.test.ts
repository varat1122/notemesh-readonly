import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"evidence-ledger-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,body:string){
  const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(p);
}
const src="https://sec.example.com/Archives/Issuer-Q2.html";
const claim={
  domain:"company" as const,entity:"NVDA",metric:"operating_cash_flow",period:"FY27H1",
  originalSource:src,statement:"Issuer reported USD 74421 million operating cash flow in six-month period.",
  value:"74421",unit:"USD millions",eventDate:"2026-08-26",publishedAt:"2026-08-26"
};
async function review(input:any){
  const {reviewInvestmentClaim}=await import("./investment-claim-review");
  const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
  return buildInvestmentDecisionPacket(input,reviewInvestmentClaim(input)).evidenceVerificationLedger;
}
describe("evidence verification and source lineage ledger",()=>{
  it("preserves declared historical verification separately from an unperformed fresh primary check",async()=>{
    await add("08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA SEC.md",`---
domain: company
entity: NVDA
source_type: primary
original_source: ${src}
original_source_sha256: null
verification: verified_against_primary
event_date: 2026-08-26
published_at: 2026-08-26
imported_at: 2026-10-17
verified_at: 2026-10-17
claims:
  - claim_id: C-OCF-H1
    metric: operating_cash_flow
    period: FY27H1
    value: "74421"
    unit: USD millions
  - claim_id: C-AR-H1
    metric: accounts_receivable_cash_flow_change
    period: FY27H1
    value: "-24590"
    unit: USD millions
---
# Primary source note\nHistorical report.`);
    const e=await review(claim);
    expect(e.entries).toHaveLength(2);
    const ocf=e.entries.find(x=>x.claimId==="C-OCF-H1");
    expect(ocf).toMatchObject({
      role:"same_metric_candidate",noteDeclaredVerification:"verified_against_primary",
      noteDeclaredSourceType:"primary",noteDeclaredEventDate:"2026-08-26",
      noteDeclaredPublishedAt:"2026-08-26",noteDeclaredImportedAt:"2026-10-17",
      noteDeclaredVerifiedAt:"2026-10-17",
      originalVerifiedThisRun:false,originalSourceIndependent:"unknown",
      sameOriginalUrlAsIncoming:true
    });
    expect(e.entries.find(x=>x.claimId==="C-AR-H1")?.role).toBe("other_same_event_metric");
    expect(e.gates.originalPrimarySourceRead).toBe("not_performed");
    expect(e.gates.ownerApprovedThesisChange).toBe(false);
    expect(e.canAutoUpdateThesis).toBe(false);
    expect(e.scanned.matchedMetricRows).toBe(1);
  });
  it("reports conflicting metadata values without calling it a verified filing correction",async()=>{
    await add("10_Knowledge/Company Research/NVDA Record A.md",`---
entity: NVDA
metric: operating_cash_flow
period: FY27H1
source_url: ${src}
value: "74421"
unit: USD millions
---
# First original quote`);
    await add("10_Knowledge/Company Research/NVDA Record B.md",`---
entity: NVDA
metric: operating_cash_flow
period: FY27H1
source_url: ${src}
value: "74200"
unit: USD millions
---
# Second different quote`);
    const ledger=await review(claim);
    expect(ledger.internalDiscrepancies.sameSourceMetricPeriodUnitDifferentValues).toBe(true);
    expect(ledger.internalDiscrepancies.comparedRows).toBe(1);
    expect(ledger.lineage.sourceRevisionsChecked).toBe(false);
    expect(ledger.lineage.sourceFamiliesVerified).toBe(false);
    expect(ledger.missingEvidence.join(" ")).toContain("Conflicting values");
  });
  it("does not count a new URL or archived AI as independent verification",async()=>{
    await add("07_Sources/ChatGPT/Entries/AI Financial Repost.md",`---
entity: NVDA
source_type: archived_ai
verification: not_reverified
metric: operating_cash_flow
period: FY27H1
source_url: https://repost.example.org/sec-copy
value: "74421"
unit: USD millions
---
# AI repost of source`);
    const e=await review(claim);
    expect(e.entries[0].noteDeclaredSourceType).toBe("archived_ai");
    expect(e.entries[0].noteDeclaredVerification).toBe("not_reverified");
    expect(e.entries[0].sameOriginalUrlAsIncoming).toBe(false);
    expect(e.entries[0].originalSourceIndependent).toBe("unknown");
    expect(e.lineage.differentUrlsNotIndependentByDefault).toBe(true);
    expect(e.gates.sourceLineageAndIndependenceVerified).toBe("not_performed");
  });
  it("tracks source-linked unstructured notes without pretending a novel event or verifying bytes",async()=>{
    const p="08_Daily_Weekly/Research Indexes/NVDA Historical Summary.md";
    await add(p,`---
ticker: [NVDA]
source_url: ${src}
verification: not_reverified
---
# Unstructured 10-Q commentary\nNo typed cashflow claim.`);
    const contentBefore=fs.readFileSync(path.join(vault,p),"utf8");
    const e=await review(claim);
    expect(e.entries).toHaveLength(1);
    expect(e.entries[0].role).toBe("source_linked_unstructured");
    expect(e.entries[0].originalVerifiedThisRun).toBe(false);
    expect(e.gates.originalSourceBytesHashed).toBe("not_confirmed");
    expect(e.scanned.truncated).toBe(false);
    expect(e.scanned.unstructuredSameSourceNotes).toBe(1);
    expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe(contentBefore);
  });
  it("keeps Macro and Industry without original metadata unresolved, never emits assumed analyst approval",async()=>{
    for(const data of [
      {domain:"macro",entity:"Vietnam",metric:"gdp_real_growth_yoy",period:"2026Q3",value:"9.95",unit:"percent"},
      {domain:"industry",entity:"Optical Networking",metric:"800G_transceiver_shipments",period:"2026Q3",value:"120",unit:"units"}
    ]){
      const e=await review({...data,originalSource:"https://example.org/unknown-source",
        statement:"Synthetic example to check incomplete historical coverage and no imaginary evidence."});
      expect(e.entries).toHaveLength(0);
      expect(e.gates.ownerApprovedThesisChange).toBe(false);
      expect(e.permittedNextStep).toBe("manual_primary_verification_and_analysis");
      expect(e.missingEvidence[0]).toContain("NOT evidence that the event is new");
    }
  });
});

import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"investment-claim-review-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,body:string){
  const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(p);
}
const claim={domain:"company" as const,entity:"NVDA",metric:"operating_cash_flow",period:"FY27H1",
  originalSource:"https://www.sec.gov/Archives/filing-A.htm",
  statement:"Operating cash flow for the first six months is disclosed.",
  value:"74421",unit:"USD millions"};
const structured=(entity:string,metric:string,period:string,source:string,value:string,unit="USD millions")=>
  `---\nentity: ${entity}\nmetric: ${metric}\nperiod: ${period}\noriginal_source: ${source}\nvalue: "${value}"\nunit: ${unit}\nverification: not_reverified\n---\n# Claim record\n\nStructured for intake regression only.\n`;

describe("universal structured claim intake review (read only)",()=>{
  it("flags same source+issuer+metric+period+value as duplicate candidate",async()=>{
    await add("10_Knowledge/Company Research/NVDA - Cash Record.md",
      structured("NVDA","operating_cash_flow","FY27H1",claim.originalSource,claim.value));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const r=reviewInvestmentClaim(claim);
    expect(r.classification).toBe("duplicate_candidate");
    expect(r.matchingClaims[0].verification).toBe("not_reverified");
    expect(r.canAutoUpdateThesis).toBe(false);
  });
  it("marks conflicting exact structured amount as needing correction adjudication, not a factual contradiction",async()=>{
    await add("10_Knowledge/Company Research/NVDA - OCF Record.md",
      structured("NVDA","operating_cash_flow","FY27H1",claim.originalSource,"71000"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(reviewInvestmentClaim(claim).classification).toBe("possible_correction_or_contradiction");
  });
  it("does not count matching secondary source as independent confirmation",async()=>{
    await add("10_Knowledge/Company Research/NVDA - Repost.md",
      structured("NVDA","operating_cash_flow","FY27H1","https://news.example.com/repost","74421"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(reviewInvestmentClaim(claim).classification).toBe("confirmation_candidate_not_independent");
  });
  it("finds another structured metric under same original period/source as possible added detail",async()=>{
    await add("10_Knowledge/Company Research/NVDA - Revenue.md",
      structured("NVDA","revenue","FY27H1",claim.originalSource,"191000"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(reviewInvestmentClaim(claim).classification).toBe("added_detail_candidate");
  });
  it("keeps different fiscal vintage, missing unit, or other issuer unresolved",async()=>{
    await add("10_Knowledge/Company Research/AMD - OCF.md",
      structured("AMD","operating_cash_flow","FY27H1",claim.originalSource,"74421"));
    await add("10_Knowledge/Company Research/NVDA - Previous Period.md",
      structured("NVDA","operating_cash_flow","FY26H1",claim.originalSource,"74421"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const r=reviewInvestmentClaim(claim);
    expect(r.classification).toBe("unresolved");
    expect(r.matchingClaims).toHaveLength(0);
  });
  it("works for macro as well as equities, does not require a Company Current Thesis",async()=>{
    await add("10_Knowledge/Macro and Markets/Vietnam GDP.md",
      structured("Vietnam","GDP growth","2026Q3","https://official.example.gov/gdp","9.95","percent"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const r=reviewInvestmentClaim({domain:"macro",entity:"Vietnam",metric:"GDP growth",period:"2026Q3",
      originalSource:"https://official.example.gov/gdp",
      statement:"Vietnam GDP growth released for the third quarter 2026.",
      value:"9.95",unit:"percent"});
    expect(r.classification).toBe("duplicate_candidate");
    expect(r.suggestedThesisAction).toBe("maintain_pending_review");
    expect(r.possibleHistoricalPaths.every(x=>!x.path.startsWith("05_Thesis/"))).toBe(true);
  });
  it("treats archive-only textual references as unresolved, never upgrades verification",async()=>{
    await add("07_Sources/ChatGPT/Entries/Archive NVDA.md",
      "# NVDA cash flow claim\n\n74421 OCF FY27H1 verified according to an old bot.");
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const r=reviewInvestmentClaim(claim);
    expect(r.classification).toBe("unresolved");
    expect(r.status).toBe("review_only_not_verified");
    expect(r.evidenceNeeded.join(" ")).toContain("No conclusive structured claim match");
  });
  it("preserves case-sensitive source URL paths rather than inventing a same-source duplicate",async()=>{
    await add("10_Knowledge/Company Research/NVDA Case-Sensitive Filing.md",
      structured("NVDA","operating_cash_flow","FY27H1",
      "https://www.sec.gov/Archives/filing-a.htm","74421"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const r=reviewInvestmentClaim(claim);
    expect(r.classification).not.toBe("duplicate_candidate");
    expect(r.classification).toBe("confirmation_candidate_not_independent");
  });
  it("will not compare or contradict numeric evidence without an explicit matching unit",async()=>{
    await add("10_Knowledge/Company Research/NVDA Missing Unit.md",
      structured("NVDA","operating_cash_flow","FY27H1",claim.originalSource,"74421",""));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(reviewInvestmentClaim(claim).classification).toBe("unresolved");
    expect(reviewInvestmentClaim({...claim,unit:undefined}).classification).toBe("unresolved");
  });
  it("prefers source conflict review over another repeated number",async()=>{
    await add("10_Knowledge/Company Research/NVDA Duplicate A.md",
      structured("NVDA","operating_cash_flow","FY27H1",claim.originalSource,"74421"));
    await add("10_Knowledge/Company Research/NVDA Conflict B.md",
      structured("NVDA","operating_cash_flow","FY27H1",claim.originalSource,"74200"));
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(reviewInvestmentClaim(claim).classification).toBe("possible_correction_or_contradiction");
  });
  it("inherits top-level original source for nested claims but rejects unrelated child issuer",async()=>{
    await add("10_Knowledge/Company Research/Multi Claims.md",`---
ticker: [NVDA]
source_url: ${claim.originalSource}
verification: not_reverified
claims:
  - claim_id: C77
    metric: operating_cash_flow
    period: FY27H1
    value: "74421"
    unit: USD millions
  - entity: AMD
    claim_id: C78
    metric: revenue
    period: FY27H1
    value: "191000"
    unit: USD millions
---
# Historical structured multi-claim note
`);
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const result=reviewInvestmentClaim(claim);
    expect(result.classification).toBe("duplicate_candidate");
    expect(result.matchingClaims.map(r=>r.claimId)).toContain("C77");
    expect(result.matchingClaims.map(r=>r.claimId)).not.toContain("C78");
    const mismatched=reviewInvestmentClaim({...claim,metric:"revenue",value:"191000"});
    expect(mismatched.classification).not.toBe("duplicate_candidate");
  });
  it("links previous unstructured notes with the same source without falsely classifying duplicate",async()=>{
    await add("08_Daily_Weekly/Research Indexes/Review - NVDA Cash Conversion.md",
      `---
ticker: [NVDA]
event_key: NVDA|SEC10Q|FY27Q2
source_url: ${claim.originalSource}
verification: verified_against_primary
---
# Cash Conversion Review
OCF quoted in the review body but not registered as a structured metric.
`);
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const r=reviewInvestmentClaim(claim);
    expect(r.classification).toBe("unresolved");
    expect(r.sourceLinkedUnstructuredPaths).toContain("08_Daily_Weekly/Research Indexes/Review - NVDA Cash Conversion.md");
    expect(r.metadataScan.truncated).toBe(false);
    expect(r.metadataScan.notesScanned).toBeGreaterThanOrEqual(1);
    expect(r.evidenceNeeded.join(" ")).toContain("same original source");
  });
  it("rejects impossible dates and non-offset ISO datetimes",async()=>{
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(()=>reviewInvestmentClaim({...claim,eventDate:"2026-02-30"})).toThrow();
    expect(()=>reviewInvestmentClaim({...claim,publishedAt:"2026-10-17T12:00:00"})).toThrow();
    expect(reviewInvestmentClaim({...claim,eventDate:null,publishedAt:"2026-10-17T12:00:00+07:00"}).status)
      .toBe("review_only_not_verified");
  });
  it("rejects missing source/date integrity and meaningless claims",async()=>{
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    expect(()=>reviewInvestmentClaim({...claim,originalSource:""})).toThrow();
    expect(()=>reviewInvestmentClaim({...claim,statement:"ok"})).toThrow();
    expect(()=>reviewInvestmentClaim({...claim,eventDate:"yesterday"})).toThrow();
  });
});

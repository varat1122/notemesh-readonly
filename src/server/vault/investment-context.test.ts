import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
let vault: string;
beforeEach(() => {
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"investment-context-")));
  vault=path.join(root,"vault");
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function fixture(){
  const { reindexPath }=await import("./indexer");
  const add=(p:string,raw:string)=>{
    const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});
    fs.writeFileSync(abs,raw);reindexPath(p);
  };
  add("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md",
    "# Evidence and Update Rules\n\nNVDA events must distinguish reported earnings from archived analysis.");
  add("08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md",
    "# Investment Evolution Master\n\nNVDA timeline history and valuation methodology.");
  add("01_Companies/NVDA.md","# NVDA\n\nNVDA business description and Data Center infrastructure.");
  add("05_Thesis/NVDA - Current Thesis.md",
    "---\nverification: not_reverified\nstatus: draft_from_archived_evidence\n---\n# NVDA Thesis\n\nNVDA draft risks and catalysts, not owner endorsed.");
  add("05_Thesis/NVDA - Evidence Register.md",
    "---\nverification: not_reverified\n---\n# Evidence Register\n\nNVDA prior claims; " +
    Array.from({length:24},(_,i)=>"Source claim chronology "+i+".").join("\n") +
    "\n## ข้อขัดแย้งที่ต้องอ่านร่วมกัน\nCustomer monetization not independently verified; GPU competitors and margin pressure.");
  add("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
    "# NVDA Evolution\n\nNVDA earnings event and margin progression.");
  add("08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md",
    "---\nverification: verified_against_primary\nevent_date: 2026-08-26\npublished_at: 2026-08-26\n---\n# NVDA Earnings\n\nNVDA FY27Q2 company revenue, not analyst consensus.");
  add("02_Industries_Themes/AI Infrastructure.md",
    "# AI Infrastructure\n\nNVDA GPU industry demand and capacity tradeoffs.");
  for(let n=0;n<12;n++)add("07_Sources/ChatGPT/Entries/Archive-"+n+".md",
    "# Chat quote NVDA\n\nNVDA revenue rumor duplicate NVDA rumors.");
  const {buildInvestmentContextPack}=await import("./investment-context");
  return buildInvestmentContextPack;
}
async function addExtra(p:string,raw:string){
  const abs=path.join(vault,p);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,raw);
  const {reindexPath}=await import("./indexer");
  reindexPath(p);
}
describe("investment context retrieval",()=>{
  it("reads issuer, draft thesis, evidence, industry and company timeline before archive duplicates",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA earnings and GPU capacity risk",issuers:["NVDA"],focus:"earnings",maxNotes:11,maxChars:12000});
    const paths=p.items.map(x=>x.path);
    expect(p.status).toBe("retrieval_only_not_verified");
    expect(paths).toContain("05_Thesis/NVDA - Current Thesis.md");
    expect(paths).toContain("05_Thesis/NVDA - Evidence Register.md");
    expect(paths).toContain("08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2.md");
    expect(paths).toContain("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md");
    expect(paths.filter(x=>x.startsWith("07_Sources/ChatGPT/"))).toHaveLength(0);
    expect(p.items.find(x=>x.role==="thesis")?.declaredVerification).toBe("not_reverified");
    expect(p.items.find(x=>x.role==="thesis")?.schemaCompatibility.role).toBe("thesis");
    expect(p.items.find(x=>x.role==="thesis")?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
    expect(p.items.find(x=>x.role==="source")?.schemaCompatibility.declaredVerification).toBe("verified_against_primary");
  });
  it("returns counter-evidence passage with its own source line pointer, not just a flattering lead excerpt",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA earnings",issuers:["NVDA"],maxNotes:11,maxChars:12000});
    const evidence=p.items.find(x=>x.role==="evidence_register");
    expect(evidence).toBeDefined();
    expect(evidence?.counterEvidenceExcerptIncluded).toBe(true);
    expect(evidence?.excerpt).toContain("Counter-evidence / risk section: source lines");
    expect(evidence?.excerpt).toContain("Customer monetization not independently verified");
  });
  it("stays within requested excerpt and note caps even when many archives match",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA GPU",issuers:["NVDA"],maxNotes:5,maxChars:4500});
    expect(p.selected).toBeLessThanOrEqual(5);
    expect(p.excerptChars).toBeLessThanOrEqual(4500);
    expect(p.omitted.length).toBeGreaterThan(0);
  });
  it("marks absent required roles rather than silently inventing thesis or sources",async()=>{
    const build=await fixture();
    const p=build({question:"ZZZZ company earnings",issuers:["ZZZZ"],maxNotes:10});
    expect(p.incomplete.some(x=>x.includes("ZZZZ"))).toBe(true);
    expect(p.incomplete.some(x=>x.includes("No Current Thesis"))).toBe(true);
  });
  it("never promotes an archived verification flag to independently verified facts",async()=>{
    const build=await fixture();
    const p=build({question:"NVDA earnings",issuers:["NVDA"]});
    expect(p.warnings.join(" ")).toContain("not");
    expect(p.items.find(x=>x.role==="thesis")?.declaredVerification).toBe("not_reverified");
    expect(p.items.find(x=>x.role==="source")?.declaredVerification).toBe("verified_against_primary");
  });
  it("distinguishes issuer JPM from broker JPM and rejects another issuer's timeline",async()=>{
    const build=await fixture();
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - AAPL.md",
      "# AAPL evolution\nJPM broker research on consumer devices, not JPMorgan bank earnings.");
    await addExtra("10_Knowledge/Industry and Concepts/JPM Hardware Model.md",
      "# JPM Hardware Model\nJPM technology research on optical networking and cloud hardware.");
    await addExtra("10_Knowledge/Company Research/JPM - Bank Credit Losses.md",
      "# JPM bank credit risk\nJPMorgan banking, bank lending credit losses and earnings.");
    await addExtra("10_Knowledge/Company Research/ASML - JPM Q3 Preview.md",
      "# ASML semiconductor estimates\nJPM research Q3 preview on ASML chip equipment; not JPM bank results.");
    const p=build({question:"JPM banking loan growth and credit losses",
      issuers:["JPM"],industry:"banking",focus:"earnings",maxNotes:12});
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain("10_Knowledge/Company Research/JPM - Bank Credit Losses.md");
    expect(paths).not.toContain("08_Daily_Weekly/Research Indexes/Company Evolution - AAPL.md");
    expect(paths).not.toContain("10_Knowledge/Industry and Concepts/JPM Hardware Model.md");
    expect(paths).not.toContain("10_Knowledge/Company Research/ASML - JPM Q3 Preview.md");
    expect(p.incomplete).toContain("No Current Thesis selected; owner-endorsed thesis is unknown.");
  });
  it("anchors a country macro query and does not request a company Current Thesis",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/2026-10 - Vietnam GDP.md",
      "# Vietnam GDP macro growth\nVietnam policy, GDP and central bank liquidity.");
    await addExtra("10_Knowledge/Macro and Markets/2026-10 - US CMBS.md",
      "# US CMBS macro\nUnited States property debt and GDP liquidity.");
    await addExtra("01_Companies/NVO.md",
      "# NVO company\nHealthcare developments and incidental Vietnam mention.");
    const p=build({question:"Vietnam GDP economic growth and central bank liquidity",
      industry:"Vietnam macro and markets",focus:"macro",maxNotes:12});
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain("10_Knowledge/Macro and Markets/2026-10 - Vietnam GDP.md");
    expect(paths).not.toContain("10_Knowledge/Macro and Markets/2026-10 - US CMBS.md");
    expect(paths).not.toContain("01_Companies/NVO.md");
    expect(p.incomplete.some(x=>x.includes("Current Thesis")||x.includes("Evidence Register"))).toBe(false);
  });
  it("excludes incidental country mentions in Japan and US-Russia headlines and surfaces missing macro primary-source evidence",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/2026-10-04 - Japan BOJ forecast.md",
      "# Japan monetary outlook\nJapan interest-rate forecast; Vietnam is mentioned once in a broader ASEAN note.");
    await addExtra("10_Knowledge/Macro and Markets/2026-10-04 - US-Russia oil deal.md",
      "# US Russia crude\nTrade pact news; Vietnam is incidental, not the main economic topic.");
    await addExtra("10_Knowledge/Macro and Markets/2026-10-03 - Vietnam GDP Q3.md",
      "# Vietnam GDP third quarter\nHistorical Vietnam macro commentary, without an original official primary source URL.");
    const p=build({question:"Vietnam GDP third quarter economic growth and bank liquidity",
      industry:"Vietnam macro and markets",focus:"macro",maxNotes:10});
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain("10_Knowledge/Macro and Markets/2026-10-03 - Vietnam GDP Q3.md");
    expect(paths).not.toContain("10_Knowledge/Macro and Markets/2026-10-04 - Japan BOJ forecast.md");
    expect(paths).not.toContain("10_Knowledge/Macro and Markets/2026-10-04 - US-Russia oil deal.md");
    expect(p.incomplete.some(x=>x.includes("primary macro/statistical"))).toBe(true);
  });
  it("recognizes a country-scoped original primary statistical note without claiming its figures were reverified",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/2026-10-07 - Vietnam official GDP 2026Q3.md",
      `---
domain: macro
country: Vietnam
source_type: primary
source_url: https://www.nso.gov.vn/official-gdp
verification: not_reverified
published_at: 2026-10-07
---
# Vietnam original GDP quarterly statistics
Official-file source candidate (no verified numeric facts in this synthetic test).`);
    await addExtra("10_Knowledge/Macro and Markets/2026-10-08 - Vietnam GDP Bot recap.md",
      "# Vietnam GDP commentary\nVietnam GDP growth Q3 2026 official release repost commentary without source verification.");
    const p=build({question:"Vietnam GDP 2026Q3 official release",industry:"Vietnam macro and markets",focus:"macro",maxNotes:10});
    expect(p.items.some(x=>x.path==="10_Knowledge/Macro and Markets/2026-10-07 - Vietnam official GDP 2026Q3.md")).toBe(true);
    const paths=p.items.map(x=>x.path);
    expect(paths.indexOf("10_Knowledge/Macro and Markets/2026-10-07 - Vietnam official GDP 2026Q3.md"))
      .toBeLessThan(paths.indexOf("10_Knowledge/Macro and Markets/2026-10-08 - Vietnam GDP Bot recap.md"));
    expect(p.incomplete.some(x=>x.includes("primary macro/statistical"))).toBe(false);
    expect(p.status).toBe("retrieval_only_not_verified");
    expect(p.items.find(x=>x.path.includes("official GDP"))?.declaredVerification).toBe("not_reverified");
  });
  it("rejects absent research question",async()=>{
    const build=await fixture();
    expect(()=>build({question:"  "})).toThrow(/Question/);
  });
});


describe("legacy Company Index routing across both retained Vault locations", () => {
  it("retrieves a canonical older history index and never falsely reports it missing", async () => {
    const build=await fixture();
    const legacy="10_Knowledge/Indexes/Company - NVDA.md";
    await addExtra(legacy,"# Company - NVDA\\n\\nArchived historical NVIDIA source-linked events; not new issuer verification.");
    const p=build({question:"NVDA historical investment research", issuers:["NVDA"], maxNotes:16});
    expect(p.items.map(x=>x.path)).toContain(legacy);
    expect(p.incomplete.some(x=>x.includes("No legacy Company Index found for NVDA"))).toBe(false);
    expect(p.incomplete).not.toContain("08_Daily_Weekly/Research Indexes/Company - NVDA.md");
    // Old navigation must not be mistaken for independently verified primary evidence.
    expect(p.items.find(x=>x.path===legacy)?.role).toBe("research");
    expect(p.items.find(x=>x.path===legacy)?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
  });
  it("preserves discoverability of both indexes if both coexist without bulk moving history", async () => {
    const build=await fixture();
    const newer="08_Daily_Weekly/Research Indexes/Company - NVDA.md";
    const older="10_Knowledge/Indexes/Company - NVDA.md";
    await addExtra(newer,"# Newer navigational view NVDA\\nExisting source note links.");
    await addExtra(older,"# Older navigational view NVDA\\nHistorical chat event links.");
    const p=build({question:"NVDA historic company events", issuers:["NVDA"],maxNotes:16});
    expect(p.items.map(x=>x.path)).toContain(newer);
    expect(p.items.map(x=>x.path)).toContain(older);
    expect(p.incomplete.some(x=>x.includes("No legacy Company Index"))).toBe(false);
  });
});


describe("old event retrieval for safe new-input reconciliation", () => {
  it("prefers the original CRWD × CLEAR archived analysis over generic CRWD recaps", async () => {
    const build=await fixture();
    await addExtra("01_Companies/CRWD.md", "# CRWD\\nCrowdStrike enterprise cybersecurity.");
    const eventPath="10_Knowledge/Company Research/2026-08-31 - CrowdStrike × CLEAR - Stock160726-190.md";
    await addExtra(eventPath, [
      "---", "type: knowledge_note", "company: [CRWD]", "verification: not_reverified",
      "source_records:", "  - 07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0190.md",
      "---", "# CrowdStrike × CLEAR biometric identity partnership",
      "CRWD x CLEAR archived user conversation, not issuer verified."
    ].join("\\n"));
    await addExtra("10_Knowledge/Company Research/CRWD - Generic software recap.md",
      "# CRWD software overview\\nHistoric CRWD AI security growth overview; no CLEAR partnership.");
    await addExtra("10_Knowledge/Company Research/ASML - CLEAR wafer process.md",
      "# ASML CLEAR wafer process\\nASML source unrelated to CRWD security.");
    const p=build({
      question:"CRWD CrowdStrike CLEAR biometric identity partnership Stock160726 190",
      issuers:["CRWD"],maxNotes:14,maxChars:14000
    });
    const paths=p.items.map(x=>x.path);
    expect(paths).toContain(eventPath);
    expect(paths).not.toContain("10_Knowledge/Company Research/ASML - CLEAR wafer process.md");
    const event=p.items.find(x=>x.path===eventPath);
    expect(event?.declaredVerification).toBe("not_reverified");
    expect(event?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
  });
});

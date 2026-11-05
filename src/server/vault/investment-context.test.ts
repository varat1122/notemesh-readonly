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

// Synthetic, explicitly declared mappings only; these fixtures are not a
// production security master or evidence that any live Hub has these aliases.
async function tsmcHub(aliases="[TSM]"){
  await addExtra("01_Companies/TSMC.md",`---\naliases: ${aliases}\n---\n# TSMC issuer context`);
  await addExtra("05_Thesis/TSMC - Current Thesis.md","# TSMC draft\nNot owner endorsed.");
  await addExtra("05_Thesis/TSMC - Evidence Register.md","# TSMC evidence\n## Counter-evidence\nCapacity assumptions require validation.");
  await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - TSMC.md","# TSMC chronology");
  await addExtra("08_Daily_Weekly/Research Indexes/Primary Evidence - TSMC Q3.md",
    "---\nverification: not_reverified\n---\n# TSMC original-source candidate");
}
describe("RI-001 issuer context resolution",()=>{
  it("reuses the existing indexed Hub alias contract to retrieve TSMC context for TSM",async()=>{
    const build=await fixture();await tsmcHub();
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    expect(planCanonicalRoutingV2({domain:"company",entities:["TSM"],topic:"earnings"}).companyHubs[0].resolution).toBe("indexed_alias");
    const pack=build({question:"TSM earnings",issuers:["TSM"],maxNotes:14});
    expect(pack.items.map(x=>x.path)).toContain("08_Daily_Weekly/Research Indexes/Primary Evidence - TSMC Q3.md");
    expect(pack.issuerResolution).toEqual([expect.objectContaining({requested:"TSM",status:"indexed_alias",contextKey:"TSMC",hubPath:"01_Companies/TSMC.md"})]);
    expect(pack.issuers).toEqual(["TSM"]);
    expect(pack.incomplete).not.toContain("05_Thesis/TSM - Current Thesis.md");
    expect(pack.items.find(x=>x.role==="evidence_register")?.counterEvidenceExcerptIncluded).toBe(true);
    expect(pack.status).toBe("retrieval_only_not_verified");
  });
  it("does not guess TSM→TSMC from names, prose, broker mentions or prefix similarity",async()=>{
    const build=await fixture();await tsmcHub("[]");
    await addExtra("01_Companies/TSMX.md","# TSMX\nTSM is a casual mention, not an alias.");
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("unresolved");
    expect(pack.items.some(x=>/TSMC|TSMX/.test(x.path))).toBe(false);
    expect(pack.incomplete.join(" ")).toContain("unresolved");
  });
  it.each([false,true])("fails closed on ambiguous alias, including exact-title collision=%s",async exact=>{
    const build=await fixture();await tsmcHub();
    await addExtra(`01_Companies/${exact?"TSM":"OTHER"}.md`,"---\naliases: [TSM]\n---\n# Another issuer");
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("ambiguous_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it.each(["changed","missing"])("refuses %s Hub alias readback",async mode=>{
    const build=await fixture();await tsmcHub();
    const file=path.join(vault,"01_Companies/TSMC.md");
    if(mode==="missing")fs.unlinkSync(file);else fs.writeFileSync(file,"---\naliases: []\n---\n# Changed without reindex");
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("readback_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it("does not silently strip market/exchange/DR qualifiers or substitute a price instrument",async()=>{
    const build=await fixture();await tsmcHub();
    for(const id of ["US:TSM","NYSE:TSM","TH:TSM80","2330.TW","TSM80"]){
      const pack=build({question:id+" earnings",issuers:[id]});
      expect(pack.issuers).toEqual([id]);
      expect(pack.items.some(x=>x.path.includes("TSMC"))).toBe(false);
      expect(pack.issuerResolution[0].status).toBe("unresolved");
    }
  });
  it("allows only an explicit qualified alias as company-context linkage, not security equivalence",async()=>{
    const build=await fixture();await tsmcHub('["US:TSM"]');
    const pack=build({question:"TSM issuer earnings",issuers:["US:TSM"]});
    expect(pack.items.map(x=>x.path)).toContain("01_Companies/TSMC.md");
    expect(pack.issuers).toEqual(["US:TSM"]);
    expect(pack.warnings.join(" ")).toContain("not security/listing equivalence");
  });
  it("keeps MRVL missing roles visible even alongside the complete NVDA control",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Company Research/MRVL historical.md","---\ncompany: MRVL\nsource_type: chatgpt_history\n---\n# MRVL historical earnings");
    const before=fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"));
    const pack=build({question:"NVDA MRVL historical earnings",issuers:["NVDA","MRVL"],maxNotes:16,maxChars:18000});
    expect(pack.items.some(x=>x.path.includes("MRVL historical"))).toBe(true);
    expect(pack.issuerCoverage.find(x=>x.requested==="MRVL")?.missingRoles).toEqual(expect.arrayContaining(["thesis","evidence_register","timeline","source"]));
    expect(pack.issuerCoverage.find(x=>x.requested==="NVDA")?.missingRoles).toEqual([]);
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"))).toEqual(before);
  });
  it("never drops invalid issuer scope into an unscoped or macro query",async()=>{
    const build=await fixture();
    const pack=build({question:"NVDA earnings",issuers:["../NVDA"],focus:"macro"});
    expect(pack.issuerResolution[0].status).toBe("invalid_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it.each(["aliases","alias","company_name","ticker"])("reuses explicit %s metadata without adding a curated TSM alias",async field=>{
    const build=await fixture();await tsmcHub("[]");
    await addExtra("01_Companies/TSMC.md",`---\n${field}: TSM\n---\n# TSMC issuer context`);
    expect(build({question:"TSM results",issuers:["TSM"]}).issuerResolution[0].status).toBe("indexed_alias");
  });
  it("does not establish uniqueness from a truncated Hub scan",async()=>{
    const build=await fixture();await tsmcHub();
    const {db}=await import("../db");
    const insert=db().prepare("INSERT INTO notes(path,title,mtime,size,frontmatter) VALUES (?,?,0,0,'{}')");
    db().transaction(()=>{for(let i=0;i<3001;i++)insert.run(`01_Companies/Fixture-${i}.md`,"Fixture");})();
    const pack=build({question:"TSM earnings",issuers:["TSM"]});
    expect(pack.issuerResolution[0].status).toBe("index_limit_hold");
    expect(pack.items.every(x=>x.role==="rules")).toBe(true);
  });
  it("preserves protected bytes, index rows and auth state across read-only retrieval",async()=>{
    const build=await fixture();await tsmcHub();
    const protectedPaths=["05_Thesis/NVDA - Current Thesis.md","05_Thesis/TSMC - Evidence Register.md",
      "08_Daily_Weekly/Research Indexes/Company Evolution - TSMC.md","06_Portfolio/Account.md","06_Portfolio/Trade.md"];
    for(const p of protectedPaths.slice(3))await addExtra(p,"# Protected synthetic fixture\nNever infer an execution.");
    const bytes=protectedPaths.map(p=>fs.readFileSync(path.join(vault,p)));
    const {db}=await import("../db");
    const before=db().prepare("SELECT * FROM notes ORDER BY path").all();
    const changes=db().prepare("SELECT total_changes() AS n").get();
    for(const issuers of [["TSM"],["NVDA"],["MRVL"],["TH:TSM80"]])build({question:"company earnings and risks",issuers});
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(changes);
    expect(db().prepare("SELECT * FROM notes ORDER BY path").all()).toEqual(before);
    protectedPaths.forEach((p,i)=>expect(fs.readFileSync(path.join(vault,p))).toEqual(bytes[i]));
  });
});

describe("RI-001 macro relevance and archive independence",()=>{
  it.each(["null","[]","42"])("treats non-object legacy index metadata %s as absent, never primary evidence",async metadata=>{
    const build=await fixture();
    const note="10_Knowledge/Macro and Markets/Vietnam GDP legacy.md";
    await addExtra(note,"# Vietnam GDP\nLegacy commentary without primary verification.");
    const {db}=await import("../db");
    db().prepare("UPDATE notes SET frontmatter=? WHERE path=?").run(metadata,note);
    const pack=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pack.items.map(x=>x.path)).toContain(note);
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
  it("does not report a counter-evidence heading that was clipped out of the excerpt",async()=>{
    const build=await fixture();
    await addExtra("05_Thesis/NVDA - Evidence Register.md","# NVDA evidence\n"+"x".repeat(2500)+"\n## Counter-evidence\nRisks not in the selected excerpt.");
    const item=build({question:"NVDA evidence",issuers:["NVDA"]}).items.find(x=>x.role==="evidence_register")!;
    expect(item.excerpt).not.toContain("## Counter-evidence");
    expect(item.counterEvidenceExcerptIncluded).toBe(false);
  });
  it("reports bounded recall when many archive hits compete for the lexical window",async()=>{
    const build=await fixture();
    for(let i=0;i<105;i++)await addExtra(`07_Sources/ChatGPT/Vietnam GDP ${i}.md`,"# Vietnam GDP\nVietnam GDP recap.");
    const pack=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pack.incomplete.join(" ")).toContain("Search window truncated");
    expect(pack.items.filter(x=>x.evidenceUse==="historical_context_only")).toHaveLength(1);
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
  it("supports a multiword explicit macro scope without broadening to similarly named countries",async()=>{
    const build=await fixture();
    await addExtra("10_Knowledge/Macro and Markets/United States GDP.md","# United States GDP\nUnited States GDP release.");
    await addExtra("10_Knowledge/Macro and Markets/United Kingdom GDP.md","# United Kingdom GDP\nUnited Kingdom GDP release.");
    const pack=build({question:"What is the latest United States GDP",industry:"United States macro and markets",focus:"macro"});
    expect(pack.items.some(x=>x.path.includes("United States"))).toBe(true);
    expect(pack.items.some(x=>x.path.includes("United Kingdom"))).toBe(false);
  });
  it("retrieves subject-scoped official candidates ahead of unrelated country releases and AI recaps",async()=>{
    const build=await fixture();
    const target="10_Knowledge/Macro and Markets/Vietnam GDP original.md";
    await addExtra(target,"---\ncountry: Vietnam\nsource_type: primary\nsource_url: https://example.gov/gdp\nverification: not_reverified\n---\n# Vietnam GDP\nVietnam GDP output release.\n## Counter-evidence\nPrior estimates may be revised.");
    for(let i=0;i<12;i++){
      await addExtra(`10_Knowledge/Macro and Markets/Vietnam GDP recap ${i}.md`,"---\ncountry: Vietnam\nsource_type: chatgpt_history\nverification: verified_against_primary\n---\n# Vietnam GDP GDP GDP\nVietnam GDP archived AI recap.");
      await addExtra(`10_Knowledge/Macro and Markets/Vietnam fisheries ${i}.md`,"---\ncountry: Vietnam\nsource_type: primary\nsource_url: https://example.gov/fish\n---\n# Vietnam fisheries\nUnrelated fish landings report.");
    }
    const pack=build({question:"Vietnam GDP",industry:"Vietnam macro and markets",focus:"macro",maxNotes:5});
    expect(pack.items.map(x=>x.path)).toContain(target);
    // H2: country context remains eligible even without subject vocabulary.
    // It has a bounded background slot and cannot displace the requested release.
    const background=pack.items.filter(x=>x.path.includes("fisheries"));
    expect(background.length).toBeLessThanOrEqual(1);
    for(const item of background)expect(pack.items.findIndex(x=>x.path===target)).toBeLessThan(pack.items.indexOf(item));
    expect(pack.items.filter(x=>x.evidenceUse==="historical_context_only").length).toBeLessThanOrEqual(1);
    expect(pack.items.find(x=>x.path===target)?.counterEvidenceExcerptIncluded).toBe(true);
    expect(pack.status).toBe("retrieval_only_not_verified");
  });
  it("does not use an archived primary declaration to fill the macro primary-evidence gap",async()=>{
    const build=await fixture();
    await addExtra("07_Sources/ChatGPT/Vietnam GDP.md","---\ncountry: Vietnam\nsource_type: primary\nsource_url: https://example.gov/gdp\nverification: verified_against_primary\n---\n# Vietnam GDP\nHistorical AI recap only.");
    const pack=build({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pack.items.find(x=>x.path.includes("Vietnam GDP"))?.evidenceUse).toBe("historical_context_only");
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
  it("retains explicitly requested archive history without treating copies as independent evidence",async()=>{
    const build=await fixture();
    for(let i=0;i<7;i++)await addExtra(`10_Knowledge/Macro and Markets/Vietnam GDP archive ${i}.md`,"---\ncountry: Vietnam\nsource_type: chatgpt_export\n---\n# Vietnam GDP historical summary");
    const pack=build({question:"Vietnam GDP historical archive",industry:"Vietnam",focus:"macro"});
    expect(pack.items.filter(x=>x.evidenceUse==="historical_context_only").length).toBeGreaterThan(0);
    expect(pack.incomplete.join(" ")).toContain("primary macro/statistical");
  });
});
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
    await addExtra("01_Companies/CRWD.md", "# CRWD\nCrowdStrike enterprise cybersecurity.");
    const eventPath="10_Knowledge/Company Research/2026-08-31 - CrowdStrike × CLEAR - Stock160726-190.md";
    await addExtra(eventPath, [
      "---", "type: knowledge_note", "company: [CRWD]", "verification: not_reverified",
      "source_records:", "  - 07_Sources/ChatGPT/Entries/Stock 160726/Stock 160726 - 0190.md",
      "---", "# CrowdStrike × CLEAR biometric identity partnership",
      "CRWD x CLEAR archived user conversation, not issuer verified."
    ].join("\n"));
    await addExtra("10_Knowledge/Company Research/CRWD - Generic software recap.md",
      "# CRWD software overview\nHistoric CRWD AI security growth overview; no CLEAR partnership.");
    await addExtra("10_Knowledge/Company Research/ASML - CLEAR wafer process.md",
      "# ASML CLEAR wafer process\nASML source unrelated to CRWD security.");
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


describe("multi-issuer archived research matching", () => {
  it("retains a jointly tagged INTC/CRWD archived security event for the CRWD question", async () => {
    const build=await fixture();
    const target="10_Knowledge/Company Research/2026-09-02 - INTC × CRWD security.md";
    await addExtra(target, [
      "---", "company: [INTC, CRWD]", "verification: not_reverified", "---",
      "# Intel INTC and CRWD security",
      "CRWD silicon and cloud security discussion from archived chat, not issuer verified."
    ].join("\n"));
    const p=build({question:"CRWD INTC silicon security historical event",issuers:["CRWD"],maxNotes:14});
    expect(p.items.map(x=>x.path)).toContain(target);
    expect(p.items.find(x=>x.path===target)?.declaredVerification).toBe("not_reverified");
  });
});


describe("bounded canonical Timeline → Industry retrieval",()=>{
  it("selects the exact linked existing Industry even when issuer question lacks sector terms",async()=>{
    const build=await fixture();
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "# NVDA Evolution\nNVDA earnings\n[[02_Industries_Themes/AI Infrastructure|AI Infrastructure]]");
    const pack=build({question:"NVDA company cash conversion and valuation risk",issuers:["NVDA"],maxNotes:12,maxChars:16000});
    expect(pack.items.map(x=>x.path)).toContain("02_Industries_Themes/AI Infrastructure.md");
    expect(pack.items.find(x=>x.path==="02_Industries_Themes/AI Infrastructure.md")?.role).toBe("industry");
    expect(pack.incomplete.some(x=>x.includes("No industry/TAM"))).toBe(false);
  });
  it("ignores incidental co-mention and a nonexistent/noncanonical Industry link",async()=>{
    const build=await fixture();
    await addExtra("02_Industries_Themes/Unrelated Banking.md",
      "# Unrelated Banking\nLegacy banking note also says NVDA but is not linked from NVIDIA's Timeline.");
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "# NVDA\n[[02_Industries_Themes/AI Infrastructure]]\n[[02_Industries_Themes/Nonexistent Concept]]");
    const pack=build({question:"NVDA operating cash generation",issuers:["NVDA"],maxNotes:12,maxChars:16000});
    expect(pack.items.map(x=>x.path)).toContain("02_Industries_Themes/AI Infrastructure.md");
    expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/Unrelated Banking.md");
    expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/Nonexistent Concept.md");
  });
  it("honors caller's explicitly supplied different industry scope over inherited Timeline link",async()=>{
    const build=await fixture();
    await addExtra("08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md",
      "# NVDA Evolution\n[[02_Industries_Themes/AI Infrastructure]]");
    await addExtra("02_Industries_Themes/Optical.md","# Optical research\nNo direct NVIDIA AI infrastructure connection asserted.");
    const pack=build({question:"NVDA optical packaging supply",issuers:["NVDA"],industry:"Optical",maxNotes:12,maxChars:16000});
    expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/AI Infrastructure.md");
  });
});

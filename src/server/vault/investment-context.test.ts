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
    "---\nverification: not_reverified\n---\n# Evidence Register\n\nNVDA prior claims counter-evidence.");
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
  it("rejects absent research question",async()=>{
    const build=await fixture();
    expect(()=>build({question:"  "})).toThrow(/Question/);
  });
});

import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {kernelCanonicalCreate} from "../../../tests/source-event-fixture";

// RQ-2 FIX B regression references. Paths and dates mirror the real diagnostic
// cases (MA01 China, MA02 Vietnam, MA03 Fed, MA04 BLS); every body is synthetic
// and asserts nothing as fact. PR #184's historyCutoff/macroScope are reused.
let root:string,vault:string;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const M="10_Knowledge/Macro and Markets/";
const T={timeout:60_000};
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"rq2-macro-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Macro and Markets","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  vi.useFakeTimers({toFake:["Date"]});
});
afterEach(()=>{
  vi.useRealTimers();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];vi.restoreAllMocks();
});
const at=(iso:string)=>vi.setSystemTime(new Date(iso));
async function note(p:string,raw:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),raw);
  (await import("./indexer")).reindexPath(p);return p;
}
// Receipted Source + canonical macro Review written through the real Safe Edit
// kernel at the (fake) clock, so known_at is the server receipt, not a caller date.
async function receipted(id:string,subject:string,published:string,body:string,country?:string){
  const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`,reviewPath=`${M}Investment Review - ${subject} - ${id}.md`;
  const dates=`event_date: ${JSON.stringify(published)}\npublished_at: ${JSON.stringify(published)}`,tag=`Source token: InvestmentIntake${id.slice(3)}`;
  const source=`---\ntype: investment_source_intake\nintake_id: ${id}\nsource_type: user_supplied\nsource_text_sha256: ${sha(id)}\n${dates}\n---\n${tag}\n${body}`;
  const review=`---\ntype: investment_research_review\nreview_scope: macro\nintake_id: ${id}\n${country?`country: ${country}\n`:""}original_source_path: "${sourcePath}"\nsource_type: chatgpt_analysis\nverification: not_reverified\n${dates}\n---\n# Review ${subject}\n${tag}\n[[${sourcePath.slice(0,-3)}]]\n${body}`;
  await kernelCanonicalCreate([{kind:"source_intake",path:sourcePath,content:source},{kind:"canonical_review",path:reviewPath,content:review}],
    "oauth:rq2-fixture",{reason:"RQ-2 synthetic macro fixture"});
  return {sourcePath,reviewPath};
}
async function receiptedSource(id:string,published:string,body:string){
  const p=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
  const content=`---\ntype: investment_source_intake\nintake_id: ${id}\nsource_type: user_supplied\ncountry: China\nsource_text_sha256: ${sha(id)}\nevent_date: "2026-11-16"\npublished_at: ${JSON.stringify(published)}\n---\nSource token: InvestmentIntake${id.slice(3)}\n${body}`;
  await kernelCanonicalCreate([{kind:"source_intake",path:p,content}],"oauth:rq2-fixture",{reason:"RQ-2 synthetic source fixture"});
  return p;
}
async function pack(req:Record<string,unknown>){
  return (await import("./investment-context")).buildInvestmentContextPack({focus:"macro",maxNotes:12,maxChars:16000,...req} as never);
}
type P=Awaited<ReturnType<typeof pack>>;
const selected=(p:P)=>p.items.map(i=>i.path);
const reasons=(p:P,path:string)=>p.discovery.paths.find(x=>x.path===path);

// The four real-case shapes in one isolated Vault, written in date order.
async function corpus(){
  at("2026-09-19T03:00:00.000Z");
  const fedSep19=await note(`${M}2026-09-19 - Wall Street เลิกมอง Fed แบบ One-and-Done - Feed170926-022.md`,
    "---\nsource_type: chatgpt_history\nverification: not_reverified\npublished_at: 2026-09-19\n---\n# Wall Street rethinks a one-and-done Fed hike\nBanks attributed a further Fed hike expectation in September (archived forecast, not verified).");
  at("2026-10-17T03:00:00.000Z");
  const vnRegister=await note(`${M}Claim Register - Vietnam GDP 2026Q3 NSO - 2026-10-17.md`,
    "---\ncountry: Vietnam\npublished_at: 2026-10-17\n---\n# Claim Register - Vietnam GDP 2026Q3\nNSO preliminary real GDP growth claim for 2026Q3 (synthetic register entry, original SHA null).");
  at("2026-11-11T03:00:00.000Z");
  const usCpi=await receipted("IN-691A51101E47E345","United States","2026-11-10",
    "Bureau of Labor Statistics October CPI release: headline and core monthly changes (synthetic, assistant-fetched).");
  at("2026-11-12T03:00:00.000Z");
  const vnRates=await receipted("IN-399B3783FC22E6F4","Rates and Liquidity","2026-11-12","Vietnam interest-rate and liquidity opinion (synthetic).","Vietnam");
  at("2026-11-16T03:00:00.000Z");
  const chinaNbs=await note(`${M}2026-11-16 - China National Bureau of Statistics October retail sales.md`,
    "---\ncountry: China\nsource_type: primary\npublished_at: 2026-11-16\n---\n# China National Bureau of Statistics October retail sales\nNational Bureau of Statistics of China: October retail sales (synthetic).");
  const zh=await receiptedSource("IN-C0000000000000A1","2026-11-16","China October retail sales 国家统计局 社会消费品零售总额 (synthetic Chinese primary).");
  at("2026-11-17T03:00:00.000Z");
  const en=await receiptedSource("IN-C0000000000000B2","2026-11-17","China October retail sales: NBS English rendering of the 16 Nov release (synthetic).");
  const enBackdated=await receiptedSource("IN-C0000000000000C3","2026-11-16","China October retail sales: English rendering whose publication is falsely declared 16 Nov (synthetic).");
  at("2026-11-24T03:00:00.000Z");
  return {fedSep19,vnRegister,usCpi,vnRates,chinaNbs,zh,en,enBackdated};
}

describe("RQ-2 macro scope: right subject, right country",()=>{
  it("a generic 'Bureau of Labor Statistics' question does not admit China's NBS as the same subject",T,async()=>{
    const c=await corpus();
    const p=await pack({question:"Bureau of Labor Statistics US October CPI"});
    // Baseline 2a8845d selected China NBS with matchedMacroScopes ["BUREAU"].
    expect(selected(p)).not.toContain(c.chinaNbs);
    expect(p.items.some(i=>i.matchedMacroScopes.length)).toBe(false);
    expect(p.macroCoverage).toEqual([]);
    expect(p.incomplete.join(" ")).toContain("Macro subject not established from the question text");
  });
  it("'United States ...' retrieves the US CPI review by its declared subject, without verifying it",T,async()=>{
    const c=await corpus();
    const p=await pack({question:"United States October CPI Bureau of Labor Statistics"});
    expect(selected(p)).toContain(c.usCpi.reviewPath);
    expect(selected(p)).not.toContain(c.chinaNbs);
    expect(p.items.find(i=>i.path===c.usCpi.reviewPath)?.matchedMacroScopes).toEqual(["UNITED STATES"]);
    expect(p.status).toBe("retrieval_only_not_verified");
    expect(p.items.find(i=>i.path===c.usCpi.reviewPath)?.declaredVerification).not.toBe("verified");
  });
  it("a country or agency passed as an issuer under macro focus is a HOLD, not a phantom company scope",T,async()=>{
    await corpus();
    for(const issuers of [["US"],["Vietnam"]])
      await expect(pack({question:"October macro data",issuers})).rejects.toThrow(/macro_issuer_scope_hold/);
    // An indexed company under macro focus keeps the existing issuer behaviour.
    await note("01_Companies/NVDA.md","# NVDA company context");
    await expect(pack({question:"NVDA rates sensitivity",issuers:["NVDA"]})).resolves.toMatchObject({status:"retrieval_only_not_verified"});
  });
  it("finds the existing Vietnam GDP NSO Claim Register in a legitimate macro scope",T,async()=>{
    const c=await corpus();
    for(const req of [{industry:"Vietnam"},{macroScope:{version:"RI001-MACRO-HISTORY-1",key:"VIETNAM",label:"Vietnam"}},{}]){
      const p=await pack({question:"Vietnam GDP 2026Q3",...req});
      expect(selected(p)).toContain(c.vnRegister);
      expect(p.items.find(i=>i.path===c.vnRegister)?.matchedMacroScopes).toEqual(["VIETNAM"]);
      expect(selected(p).some(x=>x.includes("China")||x===c.usCpi.reviewPath)).toBe(false);
    }
  });
});

describe("RQ-2 macro scope without complete metadata (false-HOLD correction)",()=>{
  it("Vietnam GDP finds the Vietnam register from its title when no country metadata exists, and nothing else",T,async()=>{
    const register=await note(`${M}Claim Register - Vietnam GDP 2026Q3 NSO - 2026-10-17.md`,
      "---\npublished_at: 2026-10-17\n---\n# Claim Register - Vietnam GDP 2026Q3\nNSO preliminary real GDP growth claim (synthetic, no country metadata).");
    const thai=await note(`${M}Thailand GDP 2026Q3 release.md`,"---\npublished_at: 2026-11-17\n---\n# Thailand GDP\nNESDC GDP release (synthetic).");
    const china=await note(`${M}2026-11-16 - China National Bureau of Statistics October retail sales.md`,"---\npublished_at: 2026-11-16\n---\n# China NBS\nNational Bureau of Statistics of China (synthetic).");
    const p=await pack({question:"Vietnam GDP 2026Q3"});
    expect(selected(p)).toContain(register);
    expect(selected(p)).not.toContain(thai);
    expect(selected(p)).not.toContain(china);
    expect(p.items.find(i=>i.path===register)?.matchedMacroScopes.length).toBe(1);
    expect(p.incomplete.join(" ")).toContain("taken from Macro note titles only");
  });
  it("an existing Theme Hub named exactly as the country scopes the question without metadata",T,async()=>{
    const hub=await note("02_Industries_Themes/Thailand.md","# Thailand\nTheme hub (synthetic).");
    const exports=await note(`${M}Thailand exports outlook.md`,"---\npublished_at: 2026-11-01\n---\n# Thailand exports\nExports outlook (synthetic).");
    const vn=await note(`${M}Vietnam exports outlook.md`,"---\npublished_at: 2026-11-01\n---\n# Vietnam exports\nExports outlook (synthetic).");
    const p=await pack({question:"Thailand exports outlook"});
    expect(selected(p)).toEqual(expect.arrayContaining([hub,exports]));
    expect(selected(p)).not.toContain(vn);
    expect(p.macroCoverage.map(m=>m.scope)).toEqual(["THAILAND"]);
  });
  it("BLS CPI still never pulls China, and an unnameable subject is a HOLD with its reason",T,async()=>{
    const china=await note(`${M}2026-11-16 - China National Bureau of Statistics October retail sales.md`,"---\npublished_at: 2026-11-16\n---\n# China NBS\nNational Bureau of Statistics October retail sales (synthetic).");
    await note(`${M}Investment Review - Rates and Liquidity - IN-399B3783FC22E6F4.md`,"---\npublished_at: 2026-11-12\n---\n# Rates\nVietnam rates opinion (synthetic).");
    for(const question of ["Bureau of Labor Statistics US October CPI","Investment review of regional outlook"]){
      const p=await pack({question});
      expect(selected(p)).not.toContain(china);
      expect(p.items.filter(i=>i.role!=="rules")).toEqual([]);
      expect(p.incomplete.join(" ")).toContain("Macro subject not established from the question text");
    }
  });
});

describe("RQ-2 point-in-time: no look-ahead, explicit reasons",()=>{
  it("China NBS: the Chinese primary of 16 Nov is eligible; the 17 Nov English rendering cannot be backdated",T,async()=>{
    const c=await corpus();
    const p=await pack({question:"China October retail sales",industry:"China",historyCutoff:"2026-11-16T15:59:59.999Z"});
    expect(selected(p)).toEqual([c.zh]);
    expect(p.items[0].pointInTime).toMatchObject({knownAt:"2026-11-16T03:00:00.000Z",cutoff:"2026-11-16T15:59:59.999Z"});
    expect(reasons(p,c.en)?.reasons).toContain("pit_after_cutoff");
    // A caller-declared 16 Nov publication does not override the 17 Nov receipt.
    expect(reasons(p,c.enBackdated)?.reasons).toContain("pit_after_cutoff");
    // No receipt => known_at unknown => HOLD, never assumed eligible.
    expect(reasons(p,c.chinaNbs)?.reasons).toContain("pit_receipt_unverified");
  });
  it("Fed 28 Oct with a 27 Oct cutoff: Sep 19 forecast is visible as unreceipted; the Nov 12 Vietnam review is after the cutoff",T,async()=>{
    const c=await corpus();
    const cutoff="2026-10-27T23:59:59.999Z",question="Fed FOMC October 28 decision versus September hike expectations";
    const fed=await pack({question,industry:"Fed",historyCutoff:cutoff});
    expect(reasons(fed,c.fedSep19)).toMatchObject({disposition:"PIT_HOLD",reasons:["pit_receipt_unverified"]});
    expect(selected(fed)).not.toContain(c.vnRates.reviewPath);
    // Even inside a Vietnam scope, the receipted Nov 12 review is rejected for the
    // right reason (baseline reported it as pit_receipt_unverified).
    const vn=await pack({question,industry:"Vietnam",historyCutoff:cutoff});
    expect(reasons(vn,c.vnRates.reviewPath)).toMatchObject({disposition:"PIT_HOLD",reasons:["pit_after_cutoff"]});
  });
  it("BLS: the Nov 10/11 CPI Source+Review is current-time only and excluded from pre-Nov 9 history",T,async()=>{
    const c=await corpus();
    const current=await pack({question:"United States October CPI",industry:"United States"});
    expect(selected(current)).toContain(c.usCpi.reviewPath);
    expect(current.items.find(i=>i.path===c.usCpi.reviewPath)?.pointInTime).toBeUndefined();
    const history=await pack({question:"United States October CPI",industry:"United States",historyCutoff:"2026-11-08T23:59:59.999Z"});
    expect(selected(history)).not.toContain(c.usCpi.reviewPath);
    expect(reasons(history,c.usCpi.reviewPath)).toMatchObject({disposition:"PIT_HOLD",reasons:["pit_after_cutoff"]});
  });
  it("a receipted macro Review before the cutoff is eligible with its server known-at",T,async()=>{
    const c=await corpus();
    const p=await pack({question:"Vietnam rates and liquidity",industry:"Vietnam",historyCutoff:"2026-11-13T00:00:00.000Z"});
    expect(selected(p)).toContain(c.vnRates.reviewPath);
    expect(p.items.find(i=>i.path===c.vnRates.reviewPath)?.pointInTime).toMatchObject({knownAt:"2026-11-12T03:00:00.000Z"});
    // The unreceipted register stays HOLD under PIT even though it is older.
    expect(reasons(p,c.vnRegister)?.reasons).toContain("pit_receipt_unverified");
  });
});

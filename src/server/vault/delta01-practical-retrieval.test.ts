import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

// PRACTICAL-RETRIEVAL-DELTA-01 (C1, C1b, C2, C3, C4). Paths mirror the Practical
// Research Pilot v0.1 shapes (US flash PMI, Goldman, Bowman, HPE without a Hub);
// every body is synthetic and asserts nothing as fact. No real Vault or data.
let root:string,vault:string;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const M="10_Knowledge/Macro and Markets/";
const T={timeout:60_000};
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"delta01-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","05_Thesis","06_Portfolio","10_Knowledge/Macro and Markets","10_Knowledge/Research Methods"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;vi.restoreAllMocks();});
async function note(p:string,raw:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),raw);
  (await import("./indexer")).reindexPath(p);return p;
}
const hist=(meta="",date="2026-09-24")=>`---\nsource_type: chatgpt_history\nverification: not_reverified\n${meta}published_at: ${date}\n---\n`;
async function pack(req:Record<string,unknown>){
  return (await import("./investment-context")).buildInvestmentContextPack({maxNotes:12,maxChars:16000,...req} as never);
}
type P=Awaited<ReturnType<typeof pack>>;
const selected=(p:P)=>p.items.map(i=>i.path);
const pointers=(p:P,reason:string)=>p.researchFallback.candidates.filter(c=>c.reason===reason);
const reasons=(p:P,x:string)=>p.discovery.paths.find(d=>d.path===x)?.reasons??[];
const Q="United States November 2026 flash PMI: growth, orders, supply capacity, inflation, Fed policy and asset transmission; prior US survey and policy evidence";
const macro=(industry:string,extra:Record<string,unknown>={})=>pack({question:Q,industry,focus:"macro",...extra});
async function usCore(){
  await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
  const review=await note(`${M}Investment Review - United States - IN-691A51101E47E345.md`,"---\nreview_scope: macro\nsource_type: chatgpt_analysis\nverification: not_reverified\npublished_at: 2026-11-10\n---\n# United States CPI review\nOctober CPI inflation (synthetic).");
  const flash=await note(`${M}2026-09-24 - US Flash PMI ร้อนแรงกว่าคาดมาก — Growth Resilience แข็งขึ้น แต่ข่าวนี้ Hawkish - Feed170926-069.md`,
    hist()+"# US Flash PMI September\nUS flash PMI growth and orders beat (archived viewpoint, synthetic).");
  return {review,flash};
}

describe("C1 closed United States identity aliases",()=>{
  it("every closed form resolves to one canonical scope and admits both US- and United States-titled notes",T,async()=>{
    const c=await usCore();
    for(const industry of ["United States","US","U.S.","USA","U.S.A.","สหรัฐฯ","สหรัฐอเมริกา"]){
      const p=await macro(industry);
      expect(selected(p)).toEqual(expect.arrayContaining([c.review,c.flash]));
      expect(p.macroCoverage.map(m=>m.scope)).toEqual(["UNITED STATES"]);
      for(const x of [c.review,c.flash])expect(p.items.find(i=>i.path===x)?.matchedMacroScopes).toEqual(["UNITED STATES"]);
      expect(p.items.find(i=>i.path===c.flash)?.evidenceUse).toBe("historical_context_only");
      expect(p.status).toBe("retrieval_only_not_verified");
    }
  });
  it("declared metadata aliases attribute a note whose title names no country",T,async()=>{
    await usCore();
    const a=await note(`${M}2026-10-01 - Survey breadth note.md`,hist("country: U.S.\n")+"# Survey breadth\nUS flash PMI breadth (synthetic).");
    const b=await note(`${M}2026-10-02 - Orders note.md`,hist("geography: สหรัฐอเมริกา\n")+"# Orders\nUS flash PMI orders (synthetic).");
    const p=await macro("United States");
    for(const x of [a,b])expect(p.items.find(i=>i.path===x)?.matchedMacroScopes).toEqual(["UNITED STATES"]);
  });
  it("short tokens, other countries and look-alike names never match the United States scope",T,async()=>{
    await usCore();
    await note(`${M}2026-11-20 - Vietnam GDP note.md`,"---\ncountry: Vietnam\n---\n# Vietnam\nVietnam GDP (synthetic).");
    const wrong=[
      await note(`${M}2026-11-23 - China Caixin flash PMI November.md`,"---\ncountry: China\n---\n# China PMI\nChina flash PMI growth orders; US demand (synthetic)."),
      await note(`${M}2026-11-23 - AUD and USD flash PMI reaction.md`,"---\n---\n# FX\nflash PMI orders (synthetic)."),
      await note(`${M}2026-11-23 - AUS flash PMI growth.md`,"---\n---\n# AUS\nflash PMI growth (synthetic)."),
      await note(`${M}2026-11-23 - USMCA flash PMI trade.md`,"---\n---\n# USMCA\nflash PMI orders (synthetic)."),
      await note(`${M}2026-11-23 - Tell us about flash PMI.md`,"---\n---\n# Q\nflash PMI growth (synthetic)."),
      await note(`${M}2026-11-23 - สหรัฐอาหรับเอมิเรตส์ flash PMI.md`,"---\n---\n# UAE\nflash PMI growth (synthetic)."),
    ];
    const p=await macro("US");
    for(const x of wrong){
      expect(selected(p)).not.toContain(x);
      expect(p.macroCoverage[0].subjectEvidence.paths).not.toContain(x);
    }
    // A declared other country is never even a pointer.
    expect(p.researchFallback.candidates.map(c=>c.path)).not.toContain(wrong[0]);
  });
  it("explicit conflicting or ambiguous declared geography fails closed against a title match",T,async()=>{
    await usCore();
    const vn=await note(`${M}2026-10-05 - US Flash PMI read-through for exporters.md`,hist("country: Vietnam\n")+"# Read-through\nUS flash PMI orders for Vietnam exporters (synthetic).");
    const global=await note(`${M}2026-10-06 - US flash PMI global wrap.md`,hist("region: Global\n")+"# Wrap\nUS flash PMI growth (synthetic).");
    const odd=await note(`${M}2026-10-07 - US flash PMI odd metadata.md`,hist("country:\n  name: United States\n")+"# Odd\nUS flash PMI growth (synthetic).");
    const us=await macro("United States");
    for(const x of [vn,global,odd])expect(selected(us)).not.toContain(x);
    // The same note stays available to its own declared country.
    const vnPack=await macro("Vietnam");
    expect(vnPack.items.find(i=>i.path===vn)?.matchedMacroScopes).toEqual(["VIETNAM"]);
  });
  it("conflicting, multi-country or malformed declarations override a matching US alias, title or entity",T,async()=>{
    await usCore();
    const fm=(meta:string)=>`---\nsource_type: primary\nverification: not_reverified\n${meta}---\n`;
    const conflicted=[
      await note(`${M}2026-10-11 - US flash PMI note A.md`,fm("country: US\ngeography: China\n")+"# A\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-12 - Flash PMI note B.md`,fm("country: China\nentity: United States\n")+"# B\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-13 - US flash PMI note C.md`,fm("country: [US, China]\n")+"# C\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-14 - US flash PMI note D.md`,fm("country: United States\nregion: Global\n")+"# D\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-15 - US flash PMI note E.md`,fm('country: ""\n')+"# E\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-16 - US flash PMI note F.md`,fm("geography:\n  name: United States\n")+"# F\nUS flash PMI growth (synthetic)."),
    ];
    const consistent=[
      await note(`${M}2026-10-17 - Flash PMI consistent G.md`,fm("country: US\ngeography: United States\n")+"# G\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-18 - Flash PMI consistent H.md`,fm("country: [US, U.S.]\n")+"# H\nUS flash PMI growth (synthetic)."),
      await note(`${M}2026-10-19 - Flash PMI entity I.md`,fm("entity: United States\n")+"# I\nUS flash PMI growth (synthetic)."),
    ];
    const p=await macro("United States");
    for(const x of conflicted){
      expect(selected(p)).not.toContain(x);
      expect(p.macroCoverage[0].subjectEvidence.paths).not.toContain(x);
      // An attributed conflict is not reclassified as a country-unattributed pointer.
      expect(p.researchFallback.candidates.map(c=>c.path)).not.toContain(x);
    }
    for(const x of consistent)expect(p.items.find(i=>i.path===x)?.matchedMacroScopes).toEqual(["UNITED STATES"]);
  });
  it("the conflict precedence is confined to the identity-alias path; a non-US scope keeps its contract",T,async()=>{
    const multi=await note(`${M}2026-10-20 - Mekong exports note.md`,"---\ncountry: [Vietnam, Thailand]\n---\n# Mekong\nVietnam exports (synthetic).");
    const p=await pack({question:"Vietnam exports",industry:"Vietnam",focus:"macro"});
    expect(p.items.find(i=>i.path===multi)?.matchedMacroScopes).toEqual(["VIETNAM"]);
  });
  it("a source-bound macroScope keeps the exact literal contract (no aliases)",T,async()=>{
    const c=await usCore();
    const p=await pack({question:Q,focus:"macro",macroScope:{version:"RI001-MACRO-HISTORY-1",key:"UNITED STATES",label:"United States"}});
    expect(selected(p)).toContain(c.review);
    expect(selected(p)).not.toContain(c.flash);
  });
});

describe("C1b country-unattributed subject notes are pointers only",()=>{
  it("Goldman-shaped notes become labelled pointers; Fed-only, other-country and intake notes do not",T,async()=>{
    await usCore();
    await note(`${M}2026-11-20 - China retail note.md`,"---\ncountry: China\n---\n# China\nChina retail (synthetic).");
    const goldman=await note(`${M}2026-09-25 - Goldman มอง Bond Selloff หลัง Flash PMI “Overreaction” — ต้องลดน้ำหนัก Thesis  - Feed170926-092.md`,
      hist("","2026-09-25")+"# Goldman on the selloff\nBroker view: the US flash PMI reaction was an overreaction (archived, synthetic).");
    const bowman=await note(`${M}2026-10-02 - Bowman ส่งสัญญาณ “พักดูผล” หลังขึ้นดอกเบี้ยเดือนกันยายน — ลดโอกาสขึ้นต่อทันที  - Macro021026-003.md`,
      hist("","2026-10-02")+"# Bowman signals a pause\nFed and FOMC policy pause after the September hike (archived, synthetic).");
    const china=await note(`${M}2026-11-21 - China flash PMI spillover.md`,hist("","2026-11-21")+"# Spillover\nUS flash PMI spillover into orders (synthetic).");
    const declared=await note(`${M}2026-11-22 - Exporters flash PMI.md`,hist("country: Vietnam\n","2026-11-22")+"# Exporters\nUS flash PMI orders (synthetic).");
    const intake=await note("00_Inbox/ChatGPT/Investment Intake - IN-0000000000000D01.md","---\nsource_type: user_supplied\n---\nUS flash PMI growth orders (unverified).");
    const p=await macro("United States");
    const got=pointers(p,"macro_country_unattributed");
    expect(got.map(c=>c.path)).toEqual([goldman]);
    expect(got[0]).toMatchObject({kind:"related_context",countryAttribution:"not_established",bindingStatus:"HOLD",sha256:null,accessStatus:"AVAILABLE_NOT_RETRIEVED"});
    for(const x of [goldman,bowman,china,declared,intake])expect(selected(p)).not.toContain(x);
    expect(p.macroCoverage[0].subjectEvidence.paths).not.toContain(goldman);
    expect(reasons(p,goldman)).toContain("macro_country_unattributed");
    expect(p.incomplete.join(" ")).toContain("Country-unattributed macro notes");
    // Under a history cutoff no pointer is exposed (titles could leak later notes).
    const pit=await macro("United States",{historyCutoff:"2026-11-24T00:00:00.000Z"});
    expect(pointers(pit,"macro_country_unattributed")).toEqual([]);
  });
});

describe("C1b and C2 stay inside existing boundaries",()=>{
  it("a scope without a reviewed identity set exposes no country-unattributed pointers",T,async()=>{
    await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
    const japan=await note(`${M}Japan GDP.md`,"# Japan GDP\nVietnam GDP is only a comparison reference (synthetic).");
    const p=await pack({question:"Vietnam GDP",industry:"Vietnam",focus:"macro"});
    expect(pointers(p,"macro_country_unattributed")).toEqual([]);
    expect(selected(p)).not.toContain(japan);
  });
  it("relevant history never displaces substantial non-archive evidence",T,async()=>{
    await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
    for(const n of ["release","survey"])await note(`${M}US flash PMI ${n}.md`,`---\nsource_type: primary\nverification: not_reverified\n---\n# US flash PMI ${n}\nUS flash PMI growth ${n} (synthetic).`);
    for(let i=0;i<4;i++)await note(`${M}2026-09-2${i} - US flash PMI recap ${i}.md`,hist("",`2026-09-2${i}`)+`# US flash PMI recap ${i}\nUS flash PMI growth recap (archived, synthetic).`);
    const p=await macro("United States");
    expect(p.items.filter(i=>i.evidenceUse==="historical_context_only")).toEqual([]);
  });
});

describe("C2 relevant macro history is bounded, deduplicated and stays historical",()=>{
  it("at most 3 relevant historical items plus 1 background, all historical_context_only with declared trust",T,async()=>{
    await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
    const relevant=[];
    for(const d of ["2026-09-24","2026-09-25","2026-09-26","2026-09-27","2026-09-28"])
      relevant.push(await note(`${M}${d} - US flash PMI history ${d}.md`,hist("",d)+`# US flash PMI ${d}\nUS flash PMI growth view on ${d} (archived, synthetic).`));
    const background=await note(`${M}2026-09-20 - US housing backdrop.md`,hist("","2026-09-20")+"# US housing\nUS housing starts backdrop (archived, synthetic).");
    const background2=await note(`${M}2026-09-21 - US retail backdrop.md`,hist("","2026-09-21")+"# US retail\nUS retail sales backdrop (archived, synthetic).");
    const p=await macro("United States");
    const rel=relevant.filter(x=>selected(p).includes(x)),bg=[background,background2].filter(x=>selected(p).includes(x));
    expect(rel).toHaveLength(3);
    expect(bg.length).toBeLessThanOrEqual(1);
    for(const x of [...rel,...bg])expect(p.items.find(i=>i.path===x)).toMatchObject({evidenceUse:"historical_context_only",declaredVerification:"not_reverified"});
    const capped=relevant.filter(x=>!rel.includes(x));
    for(const x of capped)expect(reasons(p,x)).toContain("historical_context_cap");
    expect(p.incomplete.join(" ")).toContain("Relevant historical macro context bounded to 3 items; 2 further");
    expect(p.incomplete.join(" ")).toContain("Every selected scope-matched macro item is historical_context_only");
    expect(p.incomplete.join(" ")).toContain("Server-verified primary macro/statistical evidence not established");
  });
  it("same-origin history is selected once per declared source family",T,async()=>{
    await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
    const url="https://www.example.com/pmi/release";
    const first=await note(`${M}2026-09-24 - US flash PMI repost A.md`,hist(`source_url: "${url}"\n`)+"# A\nUS flash PMI growth repost (synthetic).");
    const second=await note(`${M}2026-09-24 - US flash PMI repost B.md`,hist(`source_url: "${url}#top"\n`)+"# B\nUS flash PMI growth repost (synthetic).");
    const other=await note(`${M}2026-09-24 - US flash PMI other origin.md`,hist(`source_url: "https://www.example.org/other"\n`)+"# C\nUS flash PMI growth (synthetic).");
    const p=await macro("United States");
    const kept=[first,second].filter(x=>selected(p).includes(x));
    expect(kept).toHaveLength(1);
    expect(reasons(p,[first,second].find(x=>!kept.includes(x))!)).toContain("source_family_duplicate");
    expect(selected(p)).toContain(other);
    expect(p.incomplete.join(" ")).toContain("Same-source-family historical duplicates omitted (1)");
  });
  it("a history cutoff still holds unreceipted history: no look-ahead through the new quota",T,async()=>{
    const c=await usCore();
    const p=await macro("United States",{historyCutoff:"2026-10-27T00:00:00.000Z"});
    expect(selected(p)).not.toContain(c.flash);
    expect(reasons(p,c.flash)).toContain("pit_receipt_unverified");
  });
});

async function hpeCorpus(withIntake=true){
  await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
  const amd=await note("08_Daily_Weekly/Research Indexes/Primary Evidence - AMD Helion 2026-10-12.md",
    "---\nsource_type: issuer_release\nverification: not_reverified\ncompany: AMD\n---\n# AMD Helion\nHPE partner quote: HPE to ship Helion racks (partner statement, not proven orders).");
  // An unreceipted intake is a standalone-source readback HOLD once HPE has a Hub (existing contract).
  const intake=withIntake?await note("00_Inbox/ChatGPT/Investment Intake - IN-BD68217B2E9A2E6C.md","---\nsource_type: user_supplied\n---\nAMD corpus mentioning HPE networking (unverified)."):null;
  const thesis=await note("05_Thesis/AMD - Current Thesis.md","# AMD thesis\nHPE is one rack partner (synthetic).");
  const fm=["---","title: HPE Networking Investor Day AI infrastructure earnings","source_type: chatgpt_history","verification: not_reverified","company: [HPE]",
    "tags: [HPE, AI, Networking, earnings, guidance]","published_at: 2024-09-26","conversation_id: x","model: y","created: 2024-09-26","updated: 2024-09-26","imported_at: 2026-09-01","aliases: []","---"];
  const body=["# Stock 240926 - 0054","","Intro chat line.","",...Array.from({length:10},(_,i)=>`Filler line ${i}.`),
    "## HPE Networking Investor Day","HPE Networking AI infrastructure catalyst: integration and networking margin target (archived, synthetic).","## Risks","Execution risk on integration."];
  const stockRaw=[...fm,...body].join("\n");
  const stock=await note("07_Sources/ChatGPT/Entries/Stock 240926 - 0054.md",stockRaw);
  const master=await note("08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md",["# Master timeline",...Array.from({length:30},(_,i)=>`Entry ${i}.`),
    "## NVDA","NVDA fourth quarter earnings: AI infrastructure revenue, guidance changed.",...Array.from({length:30},(_,i)=>`Entry b${i}.`),"## HPE","HPE networking order backlog note (synthetic)."].join("\n"));
  return {amd,intake,thesis,stock,stockRaw,master,fmLines:fm.length};
}
const HPEQ="HPE FY2026 fourth quarter earnings: what changed in AI infrastructure and Networking, revenue conversion, profit margin, cash conversion, guidance and counter-evidence?";

describe("C3 a company without a Hub gets related-context pointers, never evidence",()=>{
  it("another issuer's literal HPE mention is a pointer; coverage, identity and absence stay honest",T,async()=>{
    const c=await hpeCorpus();
    const p=await pack({question:HPEQ,issuers:["HPE"],focus:"earnings",maxNotes:8,maxChars:12000});
    expect(p.issuerResolution).toEqual([{requested:"HPE",status:"unresolved",contextKey:null,hubPath:null}]);
    const got=pointers(p,"other_issuer_literal_mention");
    expect(got.map(x=>x.path)).toEqual([c.amd]);
    expect(got[0]).toMatchObject({kind:"related_context",issuerAttribution:"not_established",literalMention:"HPE",bindingStatus:"HOLD",sha256:null});
    for(const x of [c.amd,c.intake!,c.thesis])expect(selected(p)).not.toContain(x);
    expect(p.researchFallback.candidates.map(x=>x.path)).not.toEqual(expect.arrayContaining([c.intake!]));
    expect(p.researchFallback.candidates.map(x=>x.path)).not.toEqual(expect.arrayContaining([c.thesis]));
    expect(p.issuerCoverage[0].selectedRoles).not.toContain("source");
    const text=p.incomplete.join(" ");
    expect(text).toContain("No original issuer/filing source selected");
    expect(text).toContain("HPE: issuer context unresolved");
    expect(text).toContain("not HPE issuer evidence, a supplier/customer relationship");
    expect(fs.existsSync(path.join(vault,"01_Companies/HPE.md"))).toBe(false);
    const pit=await pack({question:HPEQ,issuers:["HPE"],focus:"earnings",maxNotes:8,maxChars:12000,historyCutoff:"2026-11-24T00:00:00.000Z"});
    expect(pointers(pit,"other_issuer_literal_mention")).toEqual([]);
  });
  it("a resolved issuer gets no literal-mention pointers",T,async()=>{
    await note("10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md","# Evidence and Update Rules\nRules (synthetic).");
    await note("01_Companies/NVDA.md","# NVDA company context");
    await note("08_Daily_Weekly/Research Indexes/Primary Evidence - AMD MI400 2026-10-12.md","---\ncompany: AMD\n---\n# AMD\nNVDA comparison in an AMD release (synthetic).");
    const p=await pack({question:"NVDA earnings",issuers:["NVDA"],focus:"earnings"});
    expect(pointers(p,"other_issuer_literal_mention")).toEqual([]);
  });
});

describe("C4 excerpts select substantive body text with exact citations",()=>{
  it("a YAML-heavy archive yields the HPE body section, exact spans and unchanged declared metadata",T,async()=>{
    const c=await hpeCorpus();
    const p=await pack({question:HPEQ,issuers:["HPE"],focus:"earnings",maxNotes:8,maxChars:12000});
    const item=p.items.find(i=>i.path===c.stock)!;
    expect(item.excerpt).toContain("HPE Networking AI infrastructure catalyst");
    expect(item.excerpt).not.toContain("source_type:");
    expect(item.line).toBeGreaterThan(c.fmLines);
    expect(item.contentSha256).toBe(sha(c.stockRaw));
    expect(item.citationSpans.length).toBeGreaterThan(0);
    for(const s of item.citationSpans)expect(c.stockRaw.slice(s.start,s.end)).toBe(item.excerpt.slice(s.excerptStart,s.excerptEnd));
    const first=item.citationSpans[0];
    expect(c.stockRaw.slice(0,first.start).split("\n").length).toBe(item.line);
    expect(item).toMatchObject({declaredVerification:"not_reverified",evidenceUse:"historical_context_only"});
    const master=p.items.find(i=>i.path===c.master)!;
    expect(master.excerpt).toContain("HPE networking order backlog");
    expect(master.excerpt).not.toContain("NVDA fourth quarter");
  });
  it("a note with frontmatter but no body content still returns its text",T,async()=>{
    await note("01_Companies/NVDA.md","---\naliases: []\n---\n");
    const only=await note("10_Knowledge/Company Research/NVDA - frontmatter only.md","---\ncompany: NVDA\nsummary: NVDA earnings summary held in metadata\n---\n");
    const p=await pack({question:"NVDA earnings",issuers:["NVDA"],focus:"earnings"});
    const item=p.items.find(i=>i.path===only);
    expect(item?.excerpt).toContain("NVDA earnings summary");
  });
  it("Judge witnesses bind the new excerpt: a stale pre-change witness or edited note is not current",T,async()=>{
    const c=await hpeCorpus(false);
    await note("01_Companies/HPE.md","# HPE company context (synthetic Hub fixture for witness binding)");
    const {judgeScopeWitness,judgeScopeCurrent}=await import("./research-judge-scope");
    const p=await pack({question:HPEQ,issuers:["HPE"],focus:"earnings",maxNotes:8,maxChars:12000});
    const witness=judgeScopeWitness(p);
    expect(witness.selection.some(s=>s.path===c.stock)).toBe(true);
    expect(judgeScopeCurrent(witness,p.retrieval,[],"IN-0000000000000E01","oauth:delta01")).toBe(true);
    // The witness a pre-DELTA-01 server produced (frontmatter-only excerpt) no longer matches.
    const legacy="[Source lines 1-12]\n"+c.stockRaw.split("\n").slice(0,12).join("\n");
    const stale=structuredClone(witness);
    stale.selection.find(s=>s.path===c.stock)!.excerptSha256=sha(legacy);
    expect(judgeScopeCurrent(stale,p.retrieval,[],"IN-0000000000000E01","oauth:delta01")).toBe(false);
    await note(c.stock,c.stockRaw+"\nEdited after assessment.");
    expect(judgeScopeCurrent(witness,p.retrieval,[],"IN-0000000000000E01","oauth:delta01")).toBe(false);
  });
});

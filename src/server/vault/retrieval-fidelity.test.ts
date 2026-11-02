import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"core-eng-003-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault);
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();vi.stubGlobal("fetch",vi.fn(()=>{throw Error("Local fixture only");}));
});
afterEach(async()=>{
  expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.useRealTimers();
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;
});
async function add(rel:string,content:string){
  const abs=path.join(vault,rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,content);
  (await import("./indexer")).reindexPath(rel);
}

it("C12 behavior: TSM and TSMC converge through the existing exact alias mechanism",async()=>{
  await add("01_Companies/TSMC.md","# TSMC\nFoundry company hub without a declared ticker alias.");
  await add("05_Thesis/TSMC - Current Thesis.md","# TSMC foundry\nSynthetic thesis, not approved.");
  await add("10_Knowledge/Company Research/Investment Review - TSMC - Capacity.md","# TSMC capacity\nFoundry capacity conversion.");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const canonical=build({question:"TSMC",issuers:["TSMC"]});
  const alias=build({question:"TSM",issuers:["TSM"]});
  expect(alias.issuers).toEqual(canonical.issuers);
  expect(alias.items.map(x=>x.path)).toEqual(canonical.items.map(x=>x.path));
  expect(build({question:"TSM"}).issuers).toEqual(["TSMC"]);
});

it.each(["NVDA","AMD"])("C11 behavior: %s subject Review survives FTS flooding without issuer-specific ranking",async(issuer)=>{
  await add(`01_Companies/${issuer}.md`,`# ${issuer}\nCompany hub.`);
  const target=`10_Knowledge/Company Research/Investment Review - ${issuer} - Supply Chain Capacity - 2026-10-21.md`;
  await add(target,`---\nentity: ${issuer}\nticker: [${issuer}]\n---\n# ${issuer} supply chain capacity\n`+"Background without query terms. ".repeat(2500));
  for(let i=0;i<125;i++)await add(`10_Knowledge/Company Research/Other ${i}.md`,
    `---\ncompany: OTHER\n---\n# ${issuer} supply chain capacity\n`+`${issuer} supply chain capacity `.repeat(20));
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const pack=build({question:`${issuer} supply chain capacity`,issuers:[issuer],maxNotes:5,maxChars:4500});
  expect(pack.items.map(x=>x.path)).toContain(target);
  expect(pack.items.every(x=>!x.path.includes("/Other "))).toBe(true);
  expect(pack.selected).toBeLessThanOrEqual(5);expect(pack.excerptChars).toBeLessThanOrEqual(4500);
});

it.each(["Investment Review - TSMC - Earnings","2026-07-16 - TSMC — Earnings - Synthetic002"])("C07 behavior: anomalous NET company tag on %s does not contaminate Cloudflare retrieval",async(title)=>{
  await add("01_Companies/TSMC.md","# TSMC\nFoundry.");
  await add("01_Companies/NET.md","# NET — Cloudflare\nNetwork services.");
  const target=`10_Knowledge/Company Research/${title}.md`;
  await add(target,"---\ntype: knowledge_note\ncompany: [TSMC, NET]\nsource_type: chatgpt_history\n---\n# TSMC Earnings\nNET INCOME increased in this synthetic source.");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  expect(build({question:"NET earnings",issuers:["NET"]}).items.map(x=>x.path)).not.toContain(target);
  const primary=build({question:"TSMC earnings",issuers:["TSMC"]});
  expect(primary.items.map(x=>x.path)).toContain(target);
  expect(primary.warnings.some(x=>x.includes("entity_metadata_disagrees_with_primary_subject"))).toBe(true);
  expect(primary.items.find(x=>x.path===target)?.schemaCompatibility.independenceAssessment).toBe("not_independent_archived_ai");
});

it("NET producer trace: source prose NET INCOME does not create a Cloudflare entity or link",async()=>{
  await add("01_Companies/TSMC.md","# TSMC\nFoundry.");
  await add("01_Companies/Cloudflare.md","---\naliases: [NET]\n---\n# Cloudflare\nNetwork services.");
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const input={domain:"company" as const,entities:["TSMC"],topic:"TSMC earnings",
    inputFormat:"text" as const,sourceKind:"issuer_release" as const,sourceChat:"synthetic-C07",
    extractedText:"TSMC reports NET INCOME in a synthetic financial statement.",
    completedAnalysis:"บทวิเคราะห์จำลองที่ยังไม่ยืนยัน"};
  const plan=planInvestmentWriteback(input);
  const {buildCanonicalSafeEditWorkflow}=await import("./canonical-writeback-workflow");
  expect(plan.routingV2.companyHubs.map(x=>x.path)).toEqual(["01_Companies/TSMC.md"]);
  const review=buildCanonicalSafeEditWorkflow(input,plan).steps.find(x=>x.kind==="canonical_review")!;
  expect(review.safeEditRequest?.change.content).not.toContain("01_Companies/Cloudflare");
  expect(plan.entityScope).toEqual(["TSMC"]);
});

it("uses unambiguous indexed aliases and refuses collisions instead of broadening scope",async()=>{
  await add("01_Companies/Example Foundry.md","---\naliases: [EFD]\n---\n# Example Foundry");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  expect(build({question:"EFD capacity",issuers:["EFD"]}).issuers).toEqual(["Example Foundry"]);
  await add("01_Companies/Other Foundry.md","---\naliases: [EFD]\n---\n# Other Foundry");
  expect(()=>build({question:"EFD capacity",issuers:["EFD"]})).toThrow(/Ambiguous/);
});

it("C13 behavior: cutoff excludes late knowledge despite old event date and redacts future filenames",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2030-01-04T12:00:00Z"));
  await add("01_Companies/EXM.md","# EXM");
  const a="10_Knowledge/Company Research/Investment Review - EXM - Event A.md";
  const b="10_Knowledge/Company Research/Investment Review - EXM - FUTURE_B_SECRET.md";
  await add(a,"---\npublished_at: 2030-01-01\nevent_date: 2031-01-01\n---\n# EXM capacity\nA forward-looking expectation, known before cutoff.");
  await add(b,"---\npublished_at: 2030-01-01\nevent_date: 2029-12-01\nreceived_at: 2030-01-03\n---\n# EXM capacity\nFUTURE_B_SECRET");
  for(const rel of [a,b])fs.utimesSync(path.join(vault,rel),new Date("2030-01-01"),new Date("2030-01-01"));
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const pack=build({question:"EXM capacity",issuers:["EXM"],asOf:"2030-01-02T12:00:00Z"} as any);
  expect(pack.items.map(x=>x.path)).toContain(a);
  expect(JSON.stringify(pack)).not.toContain("FUTURE_B_SECRET");
  expect(pack.manifest.asOf).toBe("2030-01-02T12:00:00.000Z");
  expect(pack.decisions.some(x=>x.path===null&&x.decision==="excluded")).toBe(true);
});

it("C13 behavior: backdating mtime cannot expose content modified after cutoff",async()=>{
  const target="10_Knowledge/Company Research/Investment Review - EXM - Capacity.md";
  await add(target,"# EXM capacity\nEvent A");
  await new Promise(r=>setTimeout(r,15));
  const cutoff=new Date().toISOString();
  await new Promise(r=>setTimeout(r,15));
  await add(target,"# EXM capacity\nBACKDATED_FUTURE_CONTENT");
  fs.utimesSync(path.join(vault,target),new Date("2020-01-01"),new Date("2020-01-01"));
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const pack=build({question:"EXM capacity",issuers:["EXM"],asOf:cutoff} as any);
  expect(JSON.stringify(pack)).not.toContain("BACKDATED_FUTURE_CONTENT");
  expect(pack.items.map(x=>x.path)).not.toContain(target);
});

it("binds actual excerpt bytes and detects changed context or a forged rehashed excerpt",async()=>{
  const target="10_Knowledge/Company Research/Investment Review - EXM - Capacity.md";
  await add(target,"# EXM capacity\nObserved facts are unverified.");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const {verifyContextManifest,createContextManifest,sha256}=await import("./context-provenance");
  const pack=build({question:"EXM capacity",issuers:["EXM"]});
  expect(verifyContextManifest(pack.manifest).id).toBe(pack.manifest.id);
  const forged=structuredClone(pack.manifest);const text="Fabricated source excerpt";
  forged.entries[0].excerptBase64=Buffer.from(text).toString("base64");forged.entries[0].excerptSha256=sha256(text);
  forged.coverage.excerptChars=text.length;
  const {id:_id,attestation:_attestation,...payload}=forged;void _id;void _attestation;
  expect(()=>verifyContextManifest(createContextManifest(payload))).toThrow(/EXCERPT_NOT_FROM_SOURCE/);
  await add(target,"# EXM capacity\nChanged version");
  expect(()=>verifyContextManifest(pack.manifest)).toThrow(/CONTEXT_VERSION_CHANGED/);
});

it("explains bounded selection and omits only with an explicit reason",async()=>{
  for(let i=0;i<8;i++)await add(`10_Knowledge/Company Research/Investment Review - EXM - Capacity ${i}.md`,"# EXM capacity\nSynthetic context.");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const pack=build({question:"EXM capacity",issuers:["EXM"],maxNotes:5});
  expect(pack.decisions.filter(x=>x.decision==="selected")).toHaveLength(pack.items.length);
  expect(pack.decisions.filter(x=>x.decision==="omitted").every(x=>/maxNotes|maxChars|role_quota/.test(x.reason))).toBe(true);
  expect(pack.decisions.some(x=>x.decision==="omitted")).toBe(true);
});

it("rejects a rehashed manifest without the current server attestation",async()=>{
  await add("01_Companies/EXM.md","# EXM\nCompany.");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const {verifyContextManifest,createContextManifest}=await import("./context-provenance");
  const original=build({question:"EXM context",issuers:["EXM"]}).manifest;
  const {id:_id,attestation,...payload}=original;void _id;
  const changed=createContextManifest({...payload,limitations:["False claim of complete coverage"]});
  expect(()=>verifyContextManifest({...changed,attestation})).toThrow(/ATTESTATION_MISMATCH/);
});

it("excludes later research as-of metadata even when publication and filesystem dates are earlier",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2030-01-04T12:00:00Z"));
  const note="10_Knowledge/Company Research/Investment Review - EXM - LATE_ANALYSIS_SECRET.md";
  await add(note,'---\npublished_at: 2030-01-01\nresearch_provenance: {asOf: "2030-01-03T12:00:00Z"}\n---\n# EXM capacity\nLATE_ANALYSIS_SECRET');
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const pack=build({question:"EXM capacity",issuers:["EXM"],asOf:"2030-01-02T12:00:00Z"});
  expect(JSON.stringify(pack)).not.toContain("LATE_ANALYSIS_SECRET");
  expect(()=>build({question:"EXM capacity",asOf:"2030-01-05T12:00:00Z"})).toThrow(/later than retrieved/);
});

it("does not follow a stale/future link index edge absent from the cutoff-eligible Timeline bytes",async()=>{
  const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - EXM.md";
  await add("01_Companies/EXM.md","# EXM");
  await add("02_Industries_Themes/Actual Sector.md","# Actual Sector\nEXM operating context.");
  await add("02_Industries_Themes/Unrelated Sector.md","# Unrelated Sector\nEXM is only an incidental mention.");
  await add(timeline,"# EXM\n[[02_Industries_Themes/Actual Sector]]");
  await new Promise(r=>setTimeout(r,15));const cutoff=new Date().toISOString();
  (await import("../db")).db().prepare("INSERT INTO links(source_path,target,resolved_path) VALUES(?,?,?)")
    .run(timeline,"02_Industries_Themes/Unrelated Sector","02_Industries_Themes/Unrelated Sector.md");
  const {buildInvestmentContextPack:build}=await import("./investment-context");
  const pack=build({question:"EXM earnings",issuers:["EXM"],asOf:cutoff,maxNotes:16});
  expect(pack.items.map(x=>x.path)).toContain("02_Industries_Themes/Actual Sector.md");
  expect(pack.items.map(x=>x.path)).not.toContain("02_Industries_Themes/Unrelated Sector.md");
});

import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-adversarial-")));vault=path.join(root,"vault");
  fs.mkdirSync(vault);process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;vi.restoreAllMocks();});
async function add(p:string,raw:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),raw);
  (await import("./indexer")).reindexPath(p);return p;
}
const macro="10_Knowledge/Macro and Markets/";
async function pack(question:string,industry:string,extra={}){
  return (await import("./investment-context")).buildInvestmentContextPack({question,industry,focus:"macro",...extra});
}
async function release(country:string,suffix=""){
  return add(`${macro}${country} GDP release${suffix}.md`,`---\ncountry: ${country}\nsource_type: primary\nsource_url: https://example.gov/output\npublished_at: 2026-10-01\n---\n# ${country} GDP\nOfficial output release; synthetic attribution, not verified.`);
}
async function adverse(country:string){
  return add(`${macro}${country} Credit stress.md`,`---\ncountry: ${country}\npublished_at: 2026-09-01\n---\n# ${country} Credit stress\n## Downside risks\nOverdue loans and missed payments threaten household balance sheets.`);
}
describe("RI-001 adversarial macro coverage",()=>{
  it("retains country adverse evidence with no subject-keyword overlap under an official-release flood",async()=>{
    const target=await release("Vietnam");for(let i=0;i<12;i++)await release("Vietnam",String(i));
    const risk=await adverse("Vietnam");await adverse("Thailand");
    const p=await pack("Vietnam GDP","Vietnam",{maxNotes:5,maxChars:4500});
    expect(p.items.map(x=>x.path)).toContain(target);
    expect(p.items.map(x=>x.path)).toContain(risk);
    expect(p.items.some(x=>x.path.includes("Thailand"))).toBe(false);
    expect(p.macroCoverage[0].counterEvidence).toMatchObject({status:"FOUND",paths:[risk]});
    expect(p.items.find(x=>x.path===risk)?.counterEvidenceExcerptIncluded).toBe(true);
  });
  it("keeps multiple macro scopes and their contrary evidence separate",async()=>{
    const vn=await release("Vietnam"),th=await release("Thailand");
    const vr=await adverse("Vietnam"),tr=await adverse("Thailand");await release("Japan");
    const p=await pack("Vietnam / Thailand GDP comparison","Vietnam / Thailand",{maxNotes:5,maxChars:4500});
    expect(p.items.map(x=>x.path)).toEqual(expect.arrayContaining([vn,th,vr,tr]));
    expect(p.items.some(x=>x.path.includes("Japan"))).toBe(false);
    expect(p.macroCoverage.map(x=>x.scope)).toEqual(["VIETNAM","THAILAND"]);
    expect(p.items.find(x=>x.path===th)?.matchedMacroScopes).toEqual(["THAILAND"]);
    expect(p.macroCoverage[0].counterEvidence.paths).toEqual([vr]);
    expect(p.macroCoverage[1].counterEvidence.paths).toEqual([tr]);
  });
  it("reports bounded risk scanning and omitted scopes rather than absence",async()=>{
    for(let i=0;i<30;i++)await release("Vietnam",String(i));
    const p=await pack("Vietnam GDP","Vietnam / Thailand / Japan / Korea / Malaysia");
    expect(p.macroCoverage[0].counterEvidence.status).toBe("SCAN_INCOMPLETE");
    expect(p.macroCoverage[0].counterEvidence.reasons).toContain("counter_read_limit");
    expect(p.incomplete.join(" ")).toContain("Macro scope limit");
  });
  it("reserves country context when a broad multi-country question has no literal subject hits",async()=>{
    for(let i=0;i<12;i++)await release("Vietnam",String(i));
    const th=await release("Thailand");
    const p=await pack("Regional outlook","Vietnam / Thailand",{maxNotes:5});
    expect(p.items.map(x=>x.path)).toContain(th);
    expect(p.items.some(x=>x.matchedMacroScopes.includes("VIETNAM"))).toBe(true);
    expect(p.items.some(x=>x.matchedMacroScopes.includes("THAILAND"))).toBe(true);
    expect(p.incomplete.join(" ")).toContain("No subject-matched macro");
  });
});
describe("RI-001 identity HOLD across consumers",()=>{
  it.each(["collision","stale"])("retains literal duplicate-event hints during %s without issuer alias expansion",async fault=>{
    const hub=await add("01_Companies/NVDA.md","---\naliases: [NVIDIA]\n---\n# NVDA");
    if(fault==="collision")await add("01_Companies/OTHER.md","---\naliases: [NVDA]\n---\n# OTHER");
    else fs.writeFileSync(path.join(vault,hub),"---\naliases: []\n---\n# NVDA");
    const history=await add("10_Knowledge/Company Research/NVDA capacity event.md","---\ncompany: NVDA\nsource_type: chatgpt_history\n---\n# NVDA capacity event\nHistorical reported capacity expansion; not independently verified.");
    await add("10_Knowledge/Company Research/OTHER capacity event.md","---\ncompany: OTHER\n---\n# OTHER capacity event\nNVDA is mentioned as a peer only.");
    const {buildInvestmentContextPack}=await import("./investment-context");
    const p=buildInvestmentContextPack({question:"NVDA capacity event",issuers:["NVDA"]});
    expect(p.issuerResolution[0]).toMatchObject({contextKey:null,status:fault==="collision"?"ambiguous_hold":"readback_hold"});
    expect(p.identityHoldDiscovery[0]).toMatchObject({requested:"NVDA",mappingVerified:false,candidatePaths:[history]});
    expect(p.items.every(x=>x.role==="rules")).toBe(true);
    const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const input={domain:"company" as const,entity:"NVDA",metric:"capacity",period:"2026",statement:"NVDA capacity event discussion",originalSource:"https://example.org/event"};
    const decision=buildInvestmentDecisionPacket(input,reviewInvestmentClaim(input));
    expect(decision.historicalContext.identityHoldDiscovery[0].candidatePaths).toEqual([history]);
    expect(decision.historicalContext.noteDeclaredPrimaryCandidates).toEqual([]);
    expect(decision.claimGate.externalPrimaryVerification).toBe("not_performed");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const router=planInvestmentWriteback({domain:"company",entities:["NVDA"],topic:"NVDA capacity event",inputFormat:"text",sourceKind:"user_commentary",extractedText:"NVDA capacity event is an unverified historical report requiring original-source review."});
    expect(router.historicalEventReview.candidatePaths).toContain(history);
    expect(router.historical.identityHoldDiscovery[0].candidatePaths).toEqual([history]);
    expect(router.historicalEventReview.duplicateAdjudicated).toBe(false);
    expect(router.gates.canAutoWrite).toBe(false);
    expect(router.gates.canAutoUpdateThesis).toBe(false);
  });
  it("does not search another issuer through an ambiguous alias or an invalid identifier",async()=>{
    for(const issuer of ["TSMC","OTHER"])await add(`01_Companies/${issuer}.md`,"---\naliases: [TSM]\n---\n# Hub");
    await add("10_Knowledge/Company Research/TSMC capacity.md","---\ncompany: TSMC\n---\n# TSMC\nTSM body mention.");
    const {buildInvestmentContextPack}=await import("./investment-context");
    const p=buildInvestmentContextPack({question:"TSM capacity",issuers:["TSM"]});
    expect(p.identityHoldDiscovery[0].candidatePaths).toEqual([]);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
    expect(buildInvestmentContextPack({question:"NVDA event",issuers:["../NVDA"]}).identityHoldDiscovery).toEqual([]);
  });
  it("keeps historical lookup bounded and reports failed note readback during identity HOLD",async()=>{
    await add("01_Companies/NVDA.md","# NVDA");await add("01_Companies/OTHER.md","---\naliases: [NVDA]\n---\n# Other");
    for(let i=0;i<35;i++)await add(`10_Knowledge/Company Research/NVDA ${i}.md`,"---\ncompany: NVDA\n---\n# NVDA history");
    const {buildInvestmentContextPack}=await import("./investment-context");
    let p=buildInvestmentContextPack({question:"NVDA history",issuers:["NVDA"]});
    expect(p.identityHoldDiscovery[0].candidatePaths).toHaveLength(12);
    expect(p.identityHoldDiscovery[0]).toMatchObject({scanComplete:false,mappingVerified:false,reasons:expect.arrayContaining(["literal_search_limit","literal_read_limit"])});
    const stale=p.identityHoldDiscovery[0].candidatePaths[0];
    fs.writeFileSync(path.join(vault,stale),"---\ncompany: OTHER\n---\n# Changed without reindex");
    p=buildInvestmentContextPack({question:"NVDA history",issuers:["NVDA"]});
    expect(p.identityHoldDiscovery[0].candidatePaths).not.toContain(stale);
    expect(p.identityHoldDiscovery[0].reasons).toContain("literal_readback_unavailable");
    fs.rmSync(path.join(vault,"10_Knowledge/Company Research"),{recursive:true});
    p=buildInvestmentContextPack({question:"NVDA history",issuers:["NVDA"]});
    expect(p.identityHoldDiscovery[0]).toMatchObject({scanComplete:false,candidatePaths:[],reasons:["literal_folder_unavailable"]});
  });
});
describe("RI-001 chronology and Hub scope bounds",()=>{
  it("orders similarly relevant 2026 and 2024 publications without treating import or analysis time as an event",async()=>{
    await add("01_Companies/NVDA.md","# NVDA");
    const old=await add("10_Knowledge/Company Research/NVDA A capacity.md","---\ncompany: NVDA\npublished_at: 2024-01-01\nanalysis_date: 2026-12-01\nimported_at: 2027-01-01\n---\n# NVDA capacity\nNVDA capacity discussion.");
    const recent=await add("10_Knowledge/Company Research/NVDA Z capacity.md","---\ncompany: NVDA\npublished_at: 2026-01-01\nanalysis_date: 2026-02-01\nimported_at: 2026-03-01\n---\n# NVDA capacity\nNVDA capacity discussion.");
    fs.utimesSync(path.join(vault,old),new Date("2030-01-01"),new Date("2030-01-01"));
    const {buildInvestmentContextPack}=await import("./investment-context");
    const p=buildInvestmentContextPack({question:"NVDA capacity research",issuers:["NVDA"]});
    expect(p.items.findIndex(x=>x.path===recent)).toBeLessThan(p.items.findIndex(x=>x.path===old));
    const item=p.items.find(x=>x.path===old)!;
    expect(item.chronology).toMatchObject({eventDate:{status:"UNKNOWN",value:null},publicationDate:{status:"DECLARED",value:"2024-01-01"},analysisDate:{value:"2026-12-01"},importDate:{value:"2027-01-01"}});
    expect(item.declaredEventDate).toBeNull();
  });
  it("does not infer chronology from review creation, legacy date or invalid dates",async()=>{
    const pth=await add(macro+"Vietnam GDP undated.md","---\ncreated_at: 2026-01-01\ndate: 2024-01-01\nanalysis_date: 2026-02-30\npublished_at: 2026-02-30\nimported_at: 2026-11-01\n---\n# Vietnam GDP\nUndated synthetic commentary.");
    const p=await pack("Vietnam GDP","Vietnam");
    expect(p.items.find(x=>x.path===pth)?.chronology).toMatchObject({eventDate:{status:"UNKNOWN"},publicationDate:{status:"UNKNOWN"},analysisDate:{status:"UNKNOWN"},importDate:{status:"DECLARED"}});
  });
  it("applies the 3000-Hub sentinel after excluding nested/non-Hub files",async()=>{
    await add("01_Companies/ZZ.md","---\naliases: [ZZZ]\n---\n# Fixture issuer");
    const {db}=await import("../db");const q=db().prepare("INSERT INTO notes(path,title,mtime,size,frontmatter) VALUES (?, 'Fixture',0,0,'{}')");
    db().transaction(()=>{for(let i=0;i<3100;i++)q.run(`01_Companies/A/Nested-${i}.md`);for(let i=0;i<2999;i++)q.run(`01_Companies/H-${i}.md`);})();
    q.run("01_Companies/Not-a-Hub.png");
    const {buildInvestmentContextPack}=await import("./investment-context");
    expect(buildInvestmentContextPack({question:"ZZZ earnings",issuers:["ZZZ"]}).issuerResolution[0].status).toBe("indexed_alias");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    expect(planCanonicalRoutingV2({domain:"company",entities:["ZZZ"],topic:"earnings"}).companyHubs).toHaveLength(1);
    q.run("01_Companies/ZZZ-extra.md");
    expect(buildInvestmentContextPack({question:"ZZZ earnings",issuers:["ZZZ"]}).issuerResolution[0].status).toBe("index_limit_hold");
    expect(planCanonicalRoutingV2({domain:"company",entities:["ZZZ"],topic:"earnings"}).companyHubs).toEqual([]);
  });
  it("keeps protected bytes, indexed state and claim verification unchanged under the new discovery paths",async()=>{
    const protectedPaths=["05_Thesis/NVDA - Current Thesis.md","05_Thesis/NVDA - Evidence Register.md","06_Portfolio/Positions.md","06_Portfolio/Trades.md"];
    for(const p of protectedPaths)await add(p,"# Protected fixture\nNever change these bytes.");
    await add("01_Companies/NVDA.md","# NVDA");await add("01_Companies/OTHER.md","---\naliases: [NVDA]\n---\n# OTHER");
    await add("10_Knowledge/Company Research/NVDA event.md","---\ncompany: NVDA\nsource_type: chatgpt_history\n---\n# NVDA history");
    await release("Vietnam");await adverse("Vietnam");await release("Thailand");
    const {db}=await import("../db");const before=db().prepare("SELECT total_changes() AS n").get();
    const bytes=protectedPaths.map(p=>fs.readFileSync(path.join(vault,p)));
    const {buildInvestmentContextPack}=await import("./investment-context");
    buildInvestmentContextPack({question:"NVDA event",issuers:["NVDA"]});
    const p=await pack("Vietnam / Thailand GDP","Vietnam / Thailand");
    expect(p.status).toBe("retrieval_only_not_verified");
    expect(p.items.map(x=>x.evidenceUse)).not.toContain("verified_primary");
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(protectedPaths.map(p=>fs.readFileSync(path.join(vault,p)))).toEqual(bytes);
  });
});

describe("N5 safe issuer onboarding — routing and historical identity must agree",()=>{
  const routeInput=(issuer:string)=>({
    domain:"company" as const,entities:[issuer],topic:issuer+" attributed company event",
    inputFormat:"text" as const,sourceKind:"user_commentary" as const,
    extractedText:issuer+" appeared in an unverified company news item."
  });
  it("holds exact-title versus another Hub alias collision instead of linking the wrong issuer",async()=>{
    await add("01_Companies/TSM.md","# TSM company hub");
    await add("01_Companies/OTHER.md","---\naliases: [TSM]\n---\n# OTHER company hub");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const {buildInvestmentContextPack}=await import("./investment-context");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const input=routeInput("TSM");
    const routing=planCanonicalRoutingV2(input);
    const context=buildInvestmentContextPack({question:input.topic,issuers:["TSM"]});
    const plan=planInvestmentWriteback(input);
    expect(context.issuerResolution[0]).toMatchObject({status:"ambiguous_hold",hubPath:null});
    expect(routing.companyHubs).toEqual([]);
    expect(routing.unresolvedEntities).toEqual(["TSM"]);
    expect(plan.routingV2.companyHubs).toEqual([]);
    expect(plan.historical.identityHoldDiscovery[0]?.mappingVerified).toBe(false);
    expect(plan.routes.find(r=>r.kind==="raw_input")?.action).toBe("candidate_create");
    expect(plan.routes.find(r=>r.kind==="company_timeline_candidate")?.action).toBe("link_existing_or_hold");
    expect(plan.gates.canAutoWrite).toBe(false);
  });
  it("holds conflicting explicitly declared DR aliases without inferring an underlying",async()=>{
    await add("01_Companies/ISSUER_A.md",'---\naliases: ["TH:TEST80"]\n---\n# Issuer A');
    await add("01_Companies/ISSUER_B.md",'---\naliases: ["TH:TEST80"]\n---\n# Issuer B');
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const {buildInvestmentContextPack}=await import("./investment-context");
    const input=routeInput("TH:TEST80");
    expect(planCanonicalRoutingV2(input)).toMatchObject({companyHubs:[],unresolvedEntities:["TH:TEST80"]});
    expect(buildInvestmentContextPack({question:input.topic,issuers:["TH:TEST80"]}).issuerResolution[0].status).toBe("ambiguous_hold");
  });
  it("never lets a curated name override a conflicting canonical Hub alias",async()=>{
    await add("01_Companies/MU.md","# MU company hub");
    await add("01_Companies/OTHER.md","---\naliases: [MU]\n---\n# Separate issuer");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const routing=planCanonicalRoutingV2(routeInput("Micron Technology"));
    expect(routing.companyHubs).toEqual([]);
    expect(routing.unresolvedEntities).toEqual(["Micron Technology"]);
  });
  it.each(["missing","stale"])("rejects %s indexed Hub metadata without fresh readback",async fault=>{
    const hub="01_Companies/TSMC.md";
    await add(hub,"---\naliases: [TSM]\n---\n# TSMC");
    if(fault==="missing")fs.unlinkSync(path.join(vault,hub));
    else fs.writeFileSync(path.join(vault,hub),"---\naliases: [OTHER]\n---\n# TSMC altered outside index");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const {buildInvestmentContextPack}=await import("./investment-context");
    const {db}=await import("../db");
    const baseline=db().prepare("SELECT total_changes() AS n").get();
    const result=planCanonicalRoutingV2(routeInput("TSM"));
    const historical=buildInvestmentContextPack({question:"TSM historical update",issuers:["TSM"]});
    expect(result.companyHubs).toEqual([]);
    expect(result.unresolvedEntities).toEqual(["TSM"]);
    expect(historical.issuerResolution[0].status).toBe("readback_hold");
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(baseline);
  });
  it("does not recover a stale Micron Technology alias through the curated MU fallback",async()=>{
    const hub="01_Companies/MU.md";
    await add(hub,"---\naliases: [Micron Technology]\n---\n# MU");
    fs.writeFileSync(path.join(vault,hub),"---\naliases: [Different Company]\n---\n# MU changed outside index");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const {buildInvestmentContextPack}=await import("./investment-context");
    const input=routeInput("Micron Technology");
    expect(planCanonicalRoutingV2(input)).toMatchObject({companyHubs:[],unresolvedEntities:["Micron Technology"]});
    expect(buildInvestmentContextPack({question:input.topic,issuers:["Micron Technology"]}).issuerResolution[0].status).toBe("readback_hold");
  });
  it("keeps genuine exact-title and unique-alias navigation working",async()=>{
    const p="01_Companies/MU.md";
    await add(p,"---\naliases: [MU, Micron Technology]\n---\n# MU");
    const {planCanonicalRoutingV2}=await import("./investment-routing-v2");
    const exact=planCanonicalRoutingV2(routeInput("MU"));
    const alias=planCanonicalRoutingV2(routeInput("Micron Technology"));
    expect(exact.companyHubs).toEqual([expect.objectContaining({path:p,resolution:"exact_existing_title"})]);
    expect(alias.companyHubs).toEqual([expect.objectContaining({path:p,resolution:"indexed_alias"})]);
    expect(exact.unresolvedEntities).toEqual([]);
    expect(alias.unresolvedEntities).toEqual([]);
  });
});

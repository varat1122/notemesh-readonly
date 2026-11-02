import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string;
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"foundation002-comparator-"));
  vi.stubEnv("DATA_DIR",root);vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,12).toString("base64"));
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2031-01-01T12:00:00Z"));
  vi.resetModules();
});
afterEach(async()=>{
  (await import("../db")).db().close();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();
  fs.rmSync(root,{recursive:true,force:true});
});
async function add(issuer:string,label:string,metadata:Record<string,unknown>,imported=1000){
  const rel=`10_Knowledge/Company Research/Investment Review - ${issuer} - ${label}.md`;
  const abs=path.join(root,"vault",rel);fs.mkdirSync(path.dirname(abs),{recursive:true});
  const fm={type:"investment_research_review",verification:"not_reverified",event_date:null,published_at:null,...metadata};
  fs.writeFileSync(abs,"---\n"+Object.entries(fm).filter(([,v])=>v!==undefined).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+`\n---\n# ${issuer} ${label}\nSynthetic analytical context.\n`);
  (await import("./indexer")).reindexPath(rel);
  (await import("../db")).db().prepare("UPDATE notes SET created=?,modified=?,mtime=? WHERE path=?").run(imported,imported,imported,rel);
  return rel;
}
async function pack(issuer="AMD",asOf?:string,question=`${issuer} research comparator`){
  return (await import("./investment-context")).buildInvestmentContextPack({question,issuers:[issuer],asOf,maxNotes:16,maxChars:16000});
}
// Historical semantic fixtures use the actual bytes/index/RET-02 reader. Only
// OS timestamp bounds are fixed before 2026-11-02, so a later CI execution date
// cannot mask a missing analysis_as_of cutoff guard. Physical-version cutoff
// regressions continue to exercise real clocks in retrieval-fidelity.test.ts.
function historicalFilesystemClock(){
  const fixed=Date.parse("2026-10-01T00:00:00Z");
  const realFstat=fs.fstatSync,realLstat=fs.lstatSync;
  const times=(s:fs.Stats)=>Object.assign(s,{mtimeMs:fixed,ctimeMs:fixed,birthtimeMs:fixed});
  vi.spyOn(fs,"fstatSync").mockImplementation(((fd:number,options?:any)=>times(realFstat(fd,options) as fs.Stats)) as typeof fs.fstatSync);
  vi.spyOn(fs,"lstatSync").mockImplementation(((p:fs.PathLike,options?:any)=>times(realLstat(p,options) as fs.Stats)) as typeof fs.lstatSync);
}

it("A: AMD baseline → Q3 synthesis survives later Q1/Q2 backfill without fake economic dates",async()=>{
  await add("AMD","Q2",{event_date:"2026-08-04",analysis_as_of:"2026-08-05",comparator_eligible:false});
  const baseline=await add("AMD","Analyst Baseline",{analysis_as_of:"2026-11-02",comparator_eligible:true},2000);
  expect((await pack()).analyticalComparators[0]).toMatchObject({status:"selected",path:baseline,eventDate:null,analysisAsOf:"2026-11-02"});
  const current=await add("AMD","Q3 Synthesis",{event_date:"2026-11-03",analysis_as_of:"2026-11-03T18:00:00Z",comparator_eligible:true},3000);
  expect((await pack()).analyticalComparators[0].path).toBe(current);
  const q1=await add("AMD","Q1Backfill",{event_date:"2026-05-05",received_at:"2026-11-10"},9000);
  const q2=await add("AMD","Q2Backfill",{event_date:"2026-08-04",analysis_as_of:"2026-11-10",comparator_eligible:false},10000);
  expect((await pack()).analyticalComparators[0].path).toBe(current);
  expect((await pack("AMD",undefined,"AMD Q1Backfill historical")).items.map(x=>x.path)).toContain(q1);
  expect((await pack("AMD",undefined,"AMD Q2Backfill historical")).items.map(x=>x.path)).toContain(q2);
  historicalFilesystemClock();
  const beforeQ3=await pack("AMD","2026-11-02T23:59:59.999Z");
  expect(beforeQ3.analyticalComparators[0].path).toBe(baseline);
  expect(JSON.stringify(beforeQ3)).not.toContain("Q3 Synthesis");
});
it.each(["NVDA","AMZN","EXM"])("B: %s baseline with event_date null can be a comparator",async issuer=>{
  const baseline=await add(issuer,"Analyst Baseline",{analysis_as_of:"2026-11-02",comparator_eligible:true});
  const result=await pack(issuer);
  expect(result.analyticalComparators[0]).toMatchObject({status:"selected",path:baseline,eventDate:null,analysisAsOf:"2026-11-02"});
  expect(result.items.find(x=>x.path===baseline)?.declaredEventDate).toBeNull();
  expect(result.items.find(x=>x.path===baseline)?.declaredAnalysisAsOf).toBe("2026-11-02");
  expect(result.items.find(x=>x.path===baseline)?.declaredComparatorEligible).toBe(true);
});
it("C: incomplete historical metadata is reported without disabling a valid baseline",async()=>{
  const old=await add("AMD","Undated History",{event_date:"2026-05-05"},9000);
  const baseline=await add("AMD","Baseline",{analysis_as_of:"2026-11-02",comparator_eligible:true},1000);
  const result=await pack();
  expect(result.analyticalComparators[0]).toMatchObject({status:"selected",path:baseline});
  expect(result.items.map(x=>x.path)).toContain(old);
  expect(result.warnings.join(" ")).toMatch(/comparator metadata incomplete/i);
  expect(result.manifest.limitations.join(" ")).toMatch(/comparator metadata incomplete/i);
  expect(result.incomplete.join(" ")).not.toMatch(/comparator HOLD/);
});
it("D: analysis_as_of alone excludes the future Review identity and bytes before its cutoff",async()=>{
  const earlier=await add("AMD","Baseline",{analysis_as_of:"2026-11-02",comparator_eligible:true});
  await add("AMD","FUTURE_ANALYSIS_SECRET",{analysis_as_of:"2026-11-03",comparator_eligible:true});
  historicalFilesystemClock();
  const result=await pack("AMD","2026-11-02T23:59:59.999Z");
  expect(result.analyticalComparators[0].path).toBe(earlier);
  expect(JSON.stringify(result)).not.toContain("FUTURE_ANALYSIS_SECRET");
});
it("D: date-only horizons are end-of-day UTC; intraday precision must be explicit",async()=>{
  const earlier=await add("AMD","Prior Baseline",{analysis_as_of:"2026-11-01",comparator_eligible:true});
  await add("AMD","DAY_END_SECRET",{analysis_as_of:"2026-11-02",comparator_eligible:true});
  historicalFilesystemClock();
  expect((await pack("AMD","2026-11-02T12:00:00Z")).analyticalComparators[0].path).toBe(earlier);
  expect(JSON.stringify(await pack("AMD","2026-11-02T12:00:00Z"))).not.toContain("DAY_END_SECRET");
});
it("E: equally latest eligible horizons HOLD even with different timezone spelling and import order",async()=>{
  await add("AMD","First",{analysis_as_of:"2026-11-03T09:00:00Z",comparator_eligible:true},1000);
  await add("AMD","Second",{analysis_as_of:"2026-11-03T10:00:00+01:00",comparator_eligible:true},9000);
  const result=await pack();
  expect(result.analyticalComparators[0]).toMatchObject({status:"hold",path:null,reason:"ambiguous_latest_analysis_as_of"});
  expect(result.incomplete.join(" ")).toMatch(/comparator HOLD/);
});
it.each([[null],["unknown"],["2026-02-30"],[["2026-11-02"]]])("incomplete eligible chronology %j cannot disable another valid comparator",async invalid=>{
  await add("AMD","Incomplete",{analysis_as_of:invalid,comparator_eligible:true},9000);
  const valid=await add("AMD","Valid",{analysis_as_of:"2026-11-02",comparator_eligible:true},1000);
  expect((await pack()).analyticalComparators[0]).toMatchObject({status:"selected",path:valid});
});
it.each([undefined,null,"true",false])("eligibility %j never opts a historical Review into comparator ranking",async eligibility=>{
  await add("AMD","Historical",{event_date:"2026-11-10",analysis_as_of:"2026-11-10",comparator_eligible:eligibility},9000);
  const valid=await add("AMD","Baseline",{analysis_as_of:"2026-11-02",comparator_eligible:true},1000);
  expect((await pack()).analyticalComparators[0].path).toBe(valid);
});
it("legacy event/provenance/import dates never imply comparator eligibility or analytical horizon",async()=>{
  const legacy=await add("AMD","Legacy",{event_date:"2026-11-02",received_at:"2026-11-03",imported_at:"2026-11-10",
    research_provenance:{asOf:"2026-11-02T12:00:00Z"}},9000);
  const result=await pack();
  expect(result.analyticalComparators[0]).toMatchObject({status:"hold",path:null,reason:"no_valid_analytical_comparator"});
  expect(result.items.map(x=>x.path)).toContain(legacy);
});

it("D: an ineligible future historical synthesis cannot leak through ordinary retrieval either",async()=>{
  const baseline=await add("AMD","Current",{analysis_as_of:"2026-11-02",comparator_eligible:true});
  await add("AMD","INELIGIBLE_FUTURE_SECRET",{event_date:"2026-05-05",analysis_as_of:"2026-11-03",comparator_eligible:false});
  historicalFilesystemClock();
  const result=await pack("AMD","2026-11-02T23:59:59.999Z");
  expect(result.analyticalComparators[0].path).toBe(baseline);
  expect(JSON.stringify(result)).not.toContain("INELIGIBLE_FUTURE_SECRET");
});

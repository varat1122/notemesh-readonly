import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

/**
 * RI-011 x M5.3: executable *local* closed-loop research integration.
 * ALL files live in a new temporary Vault, never the user's Investment_OS.
 * Assertions on receipts only prove local writer/readback/index correctness,
 * not ChatGPT production permissions, publisher authenticity or device Sync.
 */
let root:string, vault:string;
const actor="oauth:ri011-integration-synthetic";
const sourceUrl="https://example.org/tsmc-q3-test-primary-not-verified";
const period="2026Q3_ended_2026-09-30";
const input={
  domain:"company" as const,entities:["TSMC"],topic:"TSMC Q3 foundry revenue and Q4 guidance",
  inputFormat:"text" as const,sourceKind:"news_media" as const,
  sourceLanguage:"en",sourceChat:"RI011_M53_LOCAL_TEST",publisher:"Synthetic user-supplied research",
  sourceUrl,eventDate:"2026-10-15",publicationDate:"2026-10-15",
  extractedText:"Synthetic user excerpt: TSMC 2026 Q3 revenue USD 46.72 billion, Q4 guidance USD 52.3-54.3 billion. No original issuer document was read.",
  completedAnalysis:"## What Changed\nSynthetic attributed 2026 Q3 revenue; guidance is an expectation, not reported 2026 Q4 revenue.\n\n## Mechanism\nDemand and utilization affect revenue conversion, margin and FCF; customer causality unverified.\n\n## Counter-evidence\nCapacity, FX, 2nm yields and customer allocations still require verified documents.\n\n## Thesis\nNo automatic thesis or portfolio revision."
};
const claim={domain:"company" as const,entity:"TSMC",metric:"net_revenue_actual",period,
  originalSource:sourceUrl,value:"46.72",unit:"USD billions",
  statement:"The user-supplied excerpt attributes Q3 revenue of USD 46.72bn to TSMC."};
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri011-m53-loop-")));
 vault=path.join(root,"vault");
 for(const folder of ["00_Inbox/ChatGPT","01_Companies","05_Thesis","06_Portfolio",
   "07_Sources/ChatGPT/Entries","10_Knowledge/Company Research"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
 process.env.DATA_DIR=root;
 process.env.ENCRYPTION_KEY??=Buffer.alloc(32,14).toString("base64");
 process.env.SAFE_EDIT_ENABLED="1";
 process.env.SAFE_EDIT_SINGLE_WRITER="1";
 vi.resetModules();
});
afterEach(()=>{
 fs.rmSync(root,{recursive:true,force:true});
 for(const key of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])
  delete process.env[key];
});
async function seed(rel:string,body:string){
 const abs=path.join(vault,rel);
 fs.mkdirSync(path.dirname(abs),{recursive:true});
 fs.writeFileSync(abs,body,"utf8");
 const {reindexPath}=await import("./indexer");reindexPath(rel);
}
async function plan(override:Partial<typeof input>={}){
 const {planInvestmentWriteback}=await import("./investment-writeback-router");
 return planInvestmentWriteback({...input,...override});
}
async function replay(steps:NonNullable<Awaited<ReturnType<typeof plan>>["safeEditWorkflow"]>["steps"]){
 const {preview,apply}=await import("../safe-edit/engine");
 const paths:string[]=[];
 for(const step of steps){
  if(!step.safeEditRequest)continue;
  const pending=preview(step.safeEditRequest,actor);
  const receipt=apply({operationId:pending.operationId,previewToken:pending.previewToken,
    expectedHash:pending.beforeHash},actor);
  expect(receipt).toMatchObject({status:"written",
    receipt:{write:"written",readback:"verified",reindex:"verified",
      mobileSync:"unverified",remoteSync:"unverified"}});
  const actual=fs.readFileSync(path.join(vault,step.path),"utf8");
  expect(createHash("sha256").update(actual,"utf8").digest("hex")).toBe(step.expectedSha256);
  paths.push(step.path);
 }
 return paths;
}

describe("RI-011 evidence discovery -> M5.3 safe edit -> readback",()=>{
 it("uses archived evidence only as candidate, then captures new Source+Review with full local receipt and repeat idempotence",async()=>{
  const historical="07_Sources/ChatGPT/Entries/TSMC 2026Q3 old.md";
  const protectedThesis="05_Thesis/TSMC - Current Thesis.md";
  const protectedPortfolio="06_Portfolio/Team.md";
  await seed(historical,"# TSMC 2026Q3 archived summary\nTSMC 2026Q3 old analysis, original filing not authenticated.");
  await seed("01_Companies/TSMC.md","# TSMC company hub\n");
  await seed(protectedThesis,"# Protected Current Thesis\nOwner approval required.\n");
  await seed(protectedPortfolio,"# Protected Portfolio\nNo automatic trade.\n");
  const beforeThesis=fs.readFileSync(path.join(vault,protectedThesis),"utf8");
  const beforePortfolio=fs.readFileSync(path.join(vault,protectedPortfolio),"utf8");
  const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
  const discovery=hybridClaimPreview({...claim,searchQueries:["TSMC 2026Q3"]});
  expect(discovery.classification).toBe("HISTORICAL_NOTE_CANDIDATE");
  expect(discovery.historical.candidates.some(x=>x.path===historical)).toBe(true);
  expect(discovery.gates.claimVerifiedAgainstOriginal).toBe(false);
  expect(discovery.gates.canAutoWrite).toBe(false);
  const initial=await plan();
  expect(initial.status).toBe("read_only_plan_not_written");
  expect(initial.safeEditWorkflow?.status).toBe("pending_safe_edit");
  expect(initial.safeEditWorkflow?.steps.map(s=>s.state)).toEqual(["needs_create","needs_create"]);
  expect(initial.gates.canAutoWrite).toBe(false);
  const written=await replay(initial.safeEditWorkflow!.steps);
  expect(written).toHaveLength(2);
  const verified=await plan();
  expect(verified.planId).toBe(initial.planId);
  expect(verified.safeEditWorkflow).toMatchObject({status:"saved_verified",
    readyForNextNews:true,writesPerformedByPlanner:false,protectedNotesTouched:false,
    perDeviceSync:"unverified"});
  expect(verified.safeEditWorkflow?.steps.every(s=>s.state==="verified_existing"&&
    s.readbackVerified&&s.indexed&&s.searchable)).toBe(true);
  expect(verified.safeEditWorkflow?.steps.every(s=>s.safeEditRequest===null)).toBe(true);
  const {searchVault,outgoingLinks}=await import("./queries");
  const tag="InvestmentIntake"+initial.planId.slice(3);
  expect(searchVault(tag,{limit:20}).hits.map(h=>h.path)).toEqual(expect.arrayContaining(written));
  expect(outgoingLinks(written[1]).map(x=>x.resolved)).toContain(written[0]);
  const discovered=hybridClaimPreview({...claim,
    searchQueries:["TSMC "+tag],maxFtsHits:10});
  const review=discovered.historical.candidates.find(x=>x.path===written[1]);
  expect(review?.provenance.linkedSourcePath).toBe(written[0]);
  expect(review?.provenance.linkedSourceIndexed).toBe(true);
  expect(review?.provenance.linkedIntakeIdMatches).toBe(true);
  expect(review?.provenance.originalDocumentVerifiedThisRun).toBe(false);
  expect(discovered.gates.canAutoWrite).toBe(false);
  expect(fs.readFileSync(path.join(vault,protectedThesis),"utf8")).toBe(beforeThesis);
  expect(fs.readFileSync(path.join(vault,protectedPortfolio),"utf8")).toBe(beforePortfolio);
 });
 it("holds canonical review for a prior same-source economic event; Source capture alone is permitted, not a duplicate fact",async()=>{
  const prior="10_Knowledge/Company Research/TSMC prior event.md";
  await seed(prior,["---","company: TSMC","event_date: 2026-10-15",
    "source_url: "+sourceUrl,"verification: not_reverified","---",
    "# Historical TSMC Q3 event, identity still requires analyst adjudication"].join("\n"));
  const {hybridClaimPreview}=await import("./investment-hybrid-readonly");
  const candidate=hybridClaimPreview(claim);
  expect(candidate.gates.canAutoWrite).toBe(false);
  const proposed=await plan();
  expect(proposed.sourceEventReview.candidatePaths).toContain(prior);
  expect(proposed.safeEditWorkflow?.status).toBe("hold_source_event_review");
  expect(proposed.safeEditWorkflow?.steps.map(s=>s.state)).toEqual([
    "needs_create","hold_event_review"]);
  expect(proposed.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
  const captured=await replay(proposed.safeEditWorkflow!.steps);
  expect(captured).toHaveLength(1);
  const after=await plan();
  expect(after.safeEditWorkflow?.steps[0].state).toBe("verified_existing");
  expect(after.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
  expect(after.safeEditWorkflow?.readyForNextNews).toBe(false);
  expect(fs.readFileSync(path.join(vault,prior),"utf8")).toContain("not_reverified");
 });
});

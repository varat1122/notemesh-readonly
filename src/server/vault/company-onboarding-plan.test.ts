import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
let root:string,vault:string;
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-n6-onboarding-")));
 vault=path.join(root,"vault");fs.mkdirSync(vault);
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,9).toString("base64");
 vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,body:string){
 const dst=path.join(vault,p);fs.mkdirSync(path.dirname(dst),{recursive:true});
 fs.writeFileSync(dst,body);
 (await import("./indexer")).reindexPath(p);
}
const input=(issuer:string)=>({
 domain:"company" as const,entities:[issuer],topic:issuer+" synthetic attributed news item",
 inputFormat:"text" as const,sourceKind:"user_commentary" as const,
 extractedText:"Synthetic issuer news, source-only attribution, with no authenticated legal issuer mapping."
});
describe("N6 company onboarding evidence proposal is read-only and non-authoritative",()=>{
 it("proposes onboarding for an unknown issuer, preserving Source and not creating a Hub",async()=>{
  await add("10_Knowledge/Company Research/NEWCO old discussion.md",
    "---\ncompany: NEWCO\nsource_type: chatgpt_history\n---\n# Unverified historical NEWCO mention");
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const plan=planInvestmentWriteback(input("NEWCO"));
  expect(plan.companyOnboarding).toMatchObject({
   status:"read_only_evidence_checklist_not_written",
   missingOrHeld:1,sourcePreservationIsIndependent:true,noAutoHubCreation:true,noProtectedMutation:true,
   entries:[{requested:"NEWCO",status:"unresolved_requires_onboarding",
     currentHubCandidate:null,issuerVsSecurityVsListing:"not_adjudicated",
     drUnderlyingEquivalence:"not_inferred",requiresOwnerIdentityReview:true}]
  });
  expect(plan.companyOnboarding?.entries[0].requiredEvidence.join(" ")).toContain("dated");
  expect(plan.routes.find(x=>x.kind==="raw_input")?.action).toBe("candidate_create");
  expect(plan.gates.canAutoWrite).toBe(false);
  expect(fs.existsSync(path.join(vault,"01_Companies/NEWCO.md"))).toBe(false);
 });
 it("holds two competing issuer aliases and exposes index-only conflict paths",async()=>{
  for(const h of ["A","B"])await add("01_Companies/"+h+".md",
    "---\naliases: [TSM]\n---\n# Synthetic issuer");
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const plan=planInvestmentWriteback(input("TSM"));
  expect(plan.companyOnboarding?.entries[0]).toMatchObject({
   status:"ambiguous_hold",currentHubCandidate:null,
   historicalStatus:"ambiguous_hold",
   indexedConflictCandidatePaths:["01_Companies/A.md","01_Companies/B.md"]
  });
  expect(plan.routes.find(x=>x.kind==="raw_input")?.action).toBe("candidate_create");
  expect(plan.routingV2.companyHubs).toEqual([]);
 });
 it("reports existing Hub only as navigational candidate, not legal verification",async()=>{
  await add("01_Companies/NVDA.md","---\naliases: [NVIDIA]\n---\n# Synthetic NVDA");
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const plan=planInvestmentWriteback(input("NVDA"));
  expect(plan.companyOnboarding?.entries[0]).toMatchObject({
   status:"existing_hub_context_candidate",currentHubCandidate:"01_Companies/NVDA.md",
   routingBasis:"exact_existing_title",historicalStatus:"exact_existing_title",
   requiresOwnerIdentityReview:true,
   issuerVsSecurityVsListing:"not_adjudicated"
  });
  expect(plan.companyOnboarding?.missingOrHeld).toBe(0);
  expect(plan.gates.canAutoWrite).toBe(false);
 });
 it("never converts an explicitly qualified DR label to an underlying on alias collision",async()=>{
  await add("01_Companies/ISSUER_A.md",'---\naliases: ["TH:TEST80"]\n---\n# Issuer A');
  await add("01_Companies/ISSUER_B.md",'---\naliases: ["TH:TEST80"]\n---\n# Issuer B');
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const plan=planInvestmentWriteback(input("TH:TEST80"));
  expect(plan.companyOnboarding?.entries[0]).toMatchObject({
   status:"ambiguous_hold",drUnderlyingEquivalence:"not_inferred",
   indexedConflictCandidatePaths:["01_Companies/ISSUER_A.md","01_Companies/ISSUER_B.md"]
  });
  expect(plan.companyOnboarding?.entries[0].requiredEvidence.join(" ")).toContain("DR/ADR");
  expect(plan.routingV2.companyHubs).toHaveLength(0);
 });
 it("does not emit issuer onboarding on Macro/Industry contexts",async()=>{
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const p=planInvestmentWriteback({domain:"industry",entities:["AI Optics"],
    topic:"Synthetic AI optics supply context",sourceKind:"industry_research",inputFormat:"text",
    extractedText:"Synthetic optics research for industry context only, no specific issuer."});
  expect(p.companyOnboarding).toBeNull();
  expect(p.gates.canAutoWrite).toBe(false);
 });
 it("fails closed under an incomplete 3000-Hub index without guessing uniqueness",async()=>{
  await add("01_Companies/NEWCO.md","# NEWCO");
  const {db}=await import("../db");
  const insert=db().prepare("INSERT INTO notes(path,title,mtime,size,frontmatter) VALUES (?, 'Fixture',0,0,'{}')");
  db().transaction(()=>{for(let i=0;i<3001;i++)insert.run("01_Companies/ZZ-"+i+".md");})();
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  const plan=planInvestmentWriteback(input("NEWCO"));
  expect(plan.companyOnboarding?.entries[0]).toMatchObject({
   status:"index_limit_hold",currentHubCandidate:null,candidateScanComplete:false
  });
  expect(plan.routes.find(x=>x.kind==="company_timeline_candidate")?.action).toBe("link_existing_or_hold");
 });
});

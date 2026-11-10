/** N5 read-only onboarding preview, synthetic and without Vault writes. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
let root:string,vault:string;
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"n5-onboarding-")));
 vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,9).toString("base64");
 vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;vi.restoreAllMocks();});
async function add(p:string,content:string){
 const full=path.join(vault,p);fs.mkdirSync(path.dirname(full),{recursive:true});
 fs.writeFileSync(full,content);
 (await import("./indexer")).reindexPath(p);return p;
}
const data=(entities:string[],domain:"company"|"industry"="company")=>({
 domain,entities,topic:"Synthetic issuer onboarding candidate",inputFormat:"text" as const,
 sourceKind:"user_commentary" as const,
 extractedText:"A user-supplied report mentions a company; issuer and listing are not independently verified."
});
async function preview(entities:string[],domain:"company"|"industry"="company"){
 const {planInvestmentWriteback}=await import("./investment-writeback-router");
 return planInvestmentWriteback(data(entities,domain));
}
it("missing Hub gives an unapproved onboarding proposal while keeping Source route",async()=>{
 const p=await preview(["NEWCO"]);
 const c=p.companyOnboarding?.candidates[0];
 expect(c).toMatchObject({requested:"NEWCO",status:"no_indexed_hub_candidate",
  action:"owner_onboarding_proposal",existingHubPath:null,issuerSecurityListingVerified:false,
  mayCreateHub:false,mayWriteIssuerSpecificClaims:false,mayMutateProtectedNotes:false});
 expect(c?.evidenceNeeded.join(" ")).toContain("exchange");
 expect(p.routes.find(r=>r.kind==="raw_input")?.action).toBe("candidate_create");
 expect(p.gates).toMatchObject({canAutoWrite:false,canAutoUpdateThesis:false});
 expect(fs.readdirSync(vault)).toHaveLength(0);
});
it("unique existing Hub supports only navigation; indexed alias never verifies issuer/security identity",async()=>{
 const hub=await add("01_Companies/TSMC.md","---\naliases: [TSM]\n---\n# TSMC");
 const p=await preview(["TSM"]);
 expect(p.companyOnboarding?.candidates[0]).toMatchObject({status:"existing_hub_navigation_only",
  action:"reuse_existing_hub_for_navigation",existingHubPath:hub,historicalIdentityStatus:"indexed_alias",
  issuerSecurityListingVerified:false,mayWriteIssuerSpecificClaims:false});
 expect(p.routingV2.companyHubs).toEqual([expect.objectContaining({path:hub,resolution:"indexed_alias"})]);
});
it("conflicting title and alias preserve Source but require owner reconciliation",async()=>{
 await add("01_Companies/TSM.md","# TSM");
 await add("01_Companies/OTHER.md","---\naliases: [TSM]\n---\n# OTHER");
 const p=await preview(["TSM"]);
 expect(p.companyOnboarding?.candidates[0]).toMatchObject({status:"ambiguous_identity_hold",
  action:"owner_identity_review_required",existingHubPath:null});
 expect(p.routingV2.companyHubs).toEqual([]);
 expect(p.routes.find(r=>r.kind==="raw_input")?.action).toBe("candidate_create");
 expect(p.gates.canAutoWrite).toBe(false);
});
it("stale Hub aliases produce an explicit readback HOLD rather than a new issuer assertion",async()=>{
 const hub=await add("01_Companies/TSMC.md","---\naliases: [TSM]\n---\n# TSMC");
 fs.writeFileSync(path.join(vault,hub),"---\naliases: [OTHER]\n---\n# TSMC stale outside index");
 const p=await preview(["TSM"]);
 expect(p.companyOnboarding?.candidates[0]).toMatchObject({status:"stale_hub_readback_hold",
  action:"owner_identity_review_required",existingHubPath:null});
 expect(p.routingV2.companyHubs).toEqual([]);
});
it("qualified DR label retains mapping HOLD even when explicitly indexed as an alias",async()=>{
 const hub=await add("01_Companies/ISSUER_A.md",'---\naliases: ["TH:TEST80"]\n---\n# Issuer A');
 const p=await preview(["TH:TEST80"]);
 expect(p.routingV2.companyHubs).toEqual([expect.objectContaining({path:hub,resolution:"indexed_alias"})]);
 expect(p.companyOnboarding?.candidates[0]).toMatchObject({status:"qualified_listing_mapping_hold",
  action:"owner_identity_review_required",existingHubPath:hub,mayConvertDrOrAdr:false,
  issuerSecurityListingVerified:false,mayWriteIssuerSpecificClaims:false});
 expect(p.companyOnboarding?.candidates[0].evidenceNeeded.join(" ")).toContain("conversion ratio");
});
it("curated alias is merely a hint; no verified mapping or new Hub",async()=>{
 const hub=await add("01_Companies/MU.md","# MU");
 const p=await preview(["Micron Technology"]);
 expect(p.routingV2.companyHubs).toEqual([expect.objectContaining({path:hub,resolution:"curated_alias"})]);
 expect(p.companyOnboarding?.candidates[0]).toMatchObject({status:"curated_alias_hint_hold",
  action:"owner_identity_review_required",existingHubPath:hub,issuerSecurityListingVerified:false});
});
it("mixed issuer cases do not mutate protected bytes or create Company Hubs",async()=>{
 const protectedPath="05_Thesis/NEWCO - Current Thesis.md";
 await add(protectedPath,"# Protected synthetic thesis\n");
 const before=fs.readFileSync(path.join(vault,protectedPath));
 const {db}=await import("../db");const previous=db().prepare("SELECT total_changes() AS n").get();
 const p=await preview(["NEWCO","MISSING"]);
 expect(p.companyOnboarding?.candidates.map(c=>c.status)).toEqual(["no_indexed_hub_candidate","no_indexed_hub_candidate"]);
 expect(fs.readFileSync(path.join(vault,protectedPath))).toEqual(before);
 expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(previous);
 expect(p.companyOnboarding?.automaticHubCreation).toBe(false);
});
it("non-company planning does not claim company onboarding",async()=>{
 const p=await preview(["Memory"],"industry");
 expect(p.companyOnboarding).toBeUndefined();
});

import {it,expect} from "vitest";
it.runIf(Boolean(process.env.N2_COLD_ROOT))("N2 independent cold process readback",async()=>{
 process.env.DATA_DIR=process.env.N2_COLD_ROOT;
 const paths=JSON.parse(process.env.N2_COLD_PATHS!) as string[],{readPersistedClaim}=await import("../vault/canonical-claims");
 const {searchVault}=await import("../vault/queries"),{readNote}=await import("../vault/notes"),{researchTrust}=await import("../vault/research-state"),{splitFrontmatter}=await import("../vault/markdown");
 for(const p of paths.slice(1,-1)){const r=readPersistedClaim(p);expect(r.bindingStatus).toBe("receipt_readback_index_link_verified");expect(r.claim.original_source).toBeNull();expect(r.claim.verification).toBe("unverified");
  expect(searchVault(String(r.claim.claim_id)).hits.some(x=>x.path===p)).toBe(true);expect(r.reviewReferences).toEqual([paths.at(-1)]);
  const found=(await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",entity:"NVDA",metric:String(r.claim.metric),period:String(r.claim.period),unit:String(r.claim.unit),value:String(r.claim.value),evidenceClass:r.claim.evidence_class as "reported_actual",statement:String(r.claim.statement),originalSource:paths[0]});
  expect(found.classification).toBe("duplicate_candidate");expect(found.matchingClaims[0].sourceBinding?.origin).toBe("received_user_source");expect(found.matchingClaims[0].originalSource).toBeNull();
 }
 const trust=researchTrust(paths.at(-1)!,splitFrontmatter(readNote(paths.at(-1)!).content).data);expect(trust).toMatchObject({research_status:"draft",usage_tier:"historical_analysis_only",independent_evidence_increment:0,comparator_eligible:false,primary_authority:false});
});

import {it,expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
it.runIf(Boolean(process.env.N2_HOLD_ROOT))("P1 cold process refuses damaged generated claim fallback",async()=>{
 process.env.DATA_DIR=process.env.N2_HOLD_ROOT;
 const p=process.env.N2_HOLD_PATH!,full=path.join(process.env.DATA_DIR!,"vault",p),before=fs.readFileSync(full),{readPersistedClaim}=await import("../vault/canonical-claims");
 expect(()=>readPersistedClaim(p)).toThrow("claim_metadata_invalid");
 const found=(await import("../vault/investment-claim-review")).reviewInvestmentClaim(JSON.parse(process.env.N2_HOLD_QUERY!));
 expect(found.matchingClaims).toHaveLength(0);expect(found.relatedEventClaims).toHaveLength(0);expect(found.claimBindingHolds.map(h=>h.path)).toEqual([p]);
 expect(found.sourceLinkedUnstructuredPaths).not.toContain(p);expect(fs.readFileSync(full)).toEqual(before);
});

it.runIf(Boolean(process.env.N2_SCOPE_ROOT))("N2 cold process reports unknown-scope binding HOLD",async()=>{
 process.env.DATA_DIR=process.env.N2_SCOPE_ROOT;
 const p=process.env.N2_SCOPE_PATH!,full=path.join(process.env.DATA_DIR!,"vault",p),bytes=fs.readFileSync(full);
 const {readPersistedClaim}=await import("../vault/canonical-claims");expect(()=>readPersistedClaim(p)).toThrow();
 const r=(await import("../vault/investment-claim-review")).reviewInvestmentClaim(JSON.parse(process.env.N2_SCOPE_QUERY!));
 expect(r.matchingClaims).toHaveLength(0);expect(r.relatedEventClaims).toHaveLength(0);
 expect(r.claimBindingHolds).toEqual([{path:p,reason:"claim_receipt_readback_index_link_unverified",scope:"unknown"}]);
 expect(r.metadataScan).toMatchObject({coverage:"incomplete",integrityHoldCount:1,integrityHoldsTruncated:false});
 expect(r.sourceLinkedUnstructuredPaths).not.toContain(p);expect(r.possibleHistoricalPaths.map(x=>x.path)).not.toContain(p);expect(fs.readFileSync(full)).toEqual(bytes);
});

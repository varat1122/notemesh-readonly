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

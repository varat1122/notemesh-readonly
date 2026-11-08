/** Attributed identity dimensions, never financial inference or primary authority.
 * Omitted dimensions retain the historical RI001-1 identity/bytes. Explicit
 * dimensions use RI001-2; null is unknown, never an inferred provider/vintage. */
import {z} from "zod";
const label=z.string().trim().min(1).max(140).nullable().default(null);
export const estimateSchema=z.object({
  role:z.enum(["broker_estimate","consensus","unspecified"]).default("unspecified"),
  provider:label,forecastVintage:label
}).strict().describe("Attributed estimate identity: broker_estimate, consensus or unspecified role, explicit provider and forecastVintage. Omitted members remain unknown; never inferred or primary verified. Only for analyst_estimate claims.");
export const accountingBasisSchema=z.object({standard:label,shareBasis:label,scope:label,definition:label}).strict()
  .describe("Explicit attributed accounting identity: standard (e.g. GAAP), shareBasis (basic/diluted), scope (segment/consolidated), definition (e.g. issuer-defined FCF). Omitted members stay unknown; labels are not semantically verified.");
export interface ClaimDimensions {
  estimate?:z.infer<typeof estimateSchema>;
  accountingBasis?:z.infer<typeof accountingBasisSchema>;
}
const norm=(s:string|null)=>s===null?null:s.trim().normalize("NFC").toLowerCase().replace(/\s+/g," ");
export function dimensionKey(c:ClaimDimensions){
  return JSON.stringify([c.estimate?[c.estimate.role,norm(c.estimate.provider),norm(c.estimate.forecastVintage)]:null,
    c.accountingBasis?[norm(c.accountingBasis.standard),norm(c.accountingBasis.shareBasis),norm(c.accountingBasis.scope),norm(c.accountingBasis.definition)]:null]);
}
export const hasClaimDimensions=(c:ClaimDimensions)=>c.estimate!==undefined||c.accountingBasis!==undefined;
export const estimateIdentityComplete=(c:ClaimDimensions)=>!!c.estimate&&c.estimate.role!=="unspecified"&&!!c.estimate.provider&&!!c.estimate.forecastVintage;

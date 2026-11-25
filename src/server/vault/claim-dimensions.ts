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
/** B1: caller-declared observation vintage and optional same-instance prior
 * lineage. Attributed identity only: a declared series, release vintage or
 * relation is never a verified fact. The server separately verifies `prior`. */
const releaseDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{
  const d=new Date(s+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
},"releaseVintage must be a real YYYY-MM-DD calendar date");
export const observationSchema=z.object({
  seriesId:z.string().trim().min(1).max(120).nullable().default(null),
  seasonalAdjustment:z.enum(["seasonally_adjusted","not_seasonally_adjusted","not_applicable"]),
  releaseVintage:releaseDate,
  vintageStatus:z.enum(["first_release","revised","unchanged_repeat"]),
  prior:z.object({claimId:z.string().regex(/^ICL-[A-F0-9]{32}$/),relation:z.enum(["revision_of","confirmation_of"])}).strict().optional()
}).strict().describe("Optional typed observation identity (reported_actual only): seriesId (publisher series id, null if none), seasonalAdjustment, releaseVintage (publication date of THIS vintage, YYYY-MM-DD, never future) and vintageStatus. first_release has no prior; an optional prior must be revision_of for revised and confirmation_of for unchanged_repeat (no prior = no lineage claimed). prior must be an already-saved observation claim in this instance from a different intake with the same entity/metric/period/unit/seriesId/seasonalAdjustment/basis and an earlier releaseVintage. Declared values are not verified facts.");
export type ClaimObservation=z.infer<typeof observationSchema>;
export interface ClaimDimensions {
  estimate?:z.infer<typeof estimateSchema>;
  accountingBasis?:z.infer<typeof accountingBasisSchema>;
  observation?:ClaimObservation;
}
const norm=(s:string|null)=>s===null?null:s.trim().normalize("NFC").toLowerCase().replace(/\s+/g," ");
// Unchanged: observation is deliberately NOT part of dimensionKey/hasClaimDimensions,
// so historical RI001-1/2/3 identities are byte-for-byte stable.
export function dimensionKey(c:ClaimDimensions){
  return JSON.stringify([c.estimate?[c.estimate.role,norm(c.estimate.provider),norm(c.estimate.forecastVintage)]:null,
    c.accountingBasis?[norm(c.accountingBasis.standard),norm(c.accountingBasis.shareBasis),norm(c.accountingBasis.scope),norm(c.accountingBasis.definition)]:null]);
}
export const hasClaimDimensions=(c:ClaimDimensions)=>c.estimate!==undefined||c.accountingBasis!==undefined;
/** Separate identity component, appended to the claim ID hash only when an
 * observation is present (marker claim_observation_version RI001-OBS-1). */
export const hasObservation=(c:ClaimDimensions)=>c.observation!==undefined;
export function observationKey(o:ClaimObservation){
  return JSON.stringify([norm(o.seriesId),o.seasonalAdjustment,o.releaseVintage,o.vintageStatus,o.prior?[o.prior.claimId,o.prior.relation]:null]);
}
/** Only planning normalizes absence of information. Historical RI001-2 identity
 * readback deliberately continues using its original stored dimensions. */
export function omitEmptyDimensions<T extends ClaimDimensions>(claim:T):T{
  const out={...claim};
  if(out.estimate?.role==="unspecified"&&out.estimate.provider===null&&out.estimate.forecastVintage===null)delete out.estimate;
  if(out.accountingBasis&&Object.values(out.accountingBasis).every(x=>x===null))delete out.accountingBasis;
  return out;
}
export const estimateIdentityComplete=(c:ClaimDimensions)=>!!c.estimate&&c.estimate.role!=="unspecified"&&!!c.estimate.provider&&!!c.estimate.forecastVintage;

import { z } from "zod";
import { instrument, PriceError, type InstrumentInput } from "./model.ts";
import { assetDefinition } from "./universe.ts";

const reviewSchema = z.object({
  provider: z.literal("yahoo-chart"), scope: z.literal("private_team_archive"),
  evidenceRef: z.string().trim().min(12).max(500), termsUrl: z.string().url().max(1000),
  reviewedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  instrumentIds: z.array(z.string().min(1).max(40)).min(1).max(204),
}).strict();
// Configuration attests an operator's rights review. It does not manufacture a data license.
export function priceRights(input: InstrumentInput, now = new Date()) {
  const i = instrument(input), definition = assetDefinition(i.id);
  if (definition && !definition.supported) return { status: "UNSUPPORTED" as const, reason: "unsupported_gold_series_or_roll_basis" };
  try {
    const r = reviewSchema.parse(JSON.parse(process.env.MARKET_PRICES_RIGHTS_REVIEW ?? "null"));
    if (!definition || !r.instrumentIds.includes(i.id) || new Set(r.instrumentIds).size !== r.instrumentIds.length ||
      !r.termsUrl.startsWith("https://") || Date.parse(r.reviewedAt) > now.getTime() || Date.parse(r.expiresAt) <= now.getTime() ||
      Date.parse(r.expiresAt) <= Date.parse(r.reviewedAt)) throw Error();
    return { status: "OPERATOR_ATTESTED" as const, reason: "private_team_archive_rights_attested_not_independently_verified", evidenceRef: r.evidenceRef, termsUrl: r.termsUrl };
  } catch { return { status: "RIGHTS_HOLD" as const, reason: "missing_expired_or_out_of_scope_provider_rights_review" }; }
}
export function assertPriceRights(input: InstrumentInput, now: Date) {
  const result = priceRights(input, now);
  if (result.status !== "OPERATOR_ATTESTED") throw new PriceError(result.status === "UNSUPPORTED" ? "unsupported_price_instrument" : "price_rights_hold");
  return result;
}

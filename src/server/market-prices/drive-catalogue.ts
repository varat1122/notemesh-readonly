import crypto from "node:crypto";
import { z } from "zod";
import { driveKey } from "./drive-auth.ts";
import { instrument, instrumentSchema, isoDate, MAX_PRICE_INSTRUMENTS, PriceError } from "./model.ts";

export const CATALOGUE_LIMIT = 512 * 1024;
const stamp = z.string().datetime();
export const catalogueEntrySchema = z.object({
  instrument: instrumentSchema, archiveId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), databaseBytes: z.number().int().min(512).max(4 * 1024 * 1024),
  barCount: z.number().int().min(0).max(10000), firstDate: isoDate.nullable(), lastDate: isoDate.nullable(),
  lastFetchedAt: stamp.nullable(), lastSuccessfulRefresh: stamp.nullable(), lastAttemptAt: stamp,
  lastAttemptSuccess: z.boolean(), lastError: z.string().max(100).nullable(), qualityIssueCount: z.number().int().min(0),
  lastFullRefreshAt: stamp.nullable(),
}).strict();
export const catalogueSchema = z.object({ version: z.literal(2), updatedAt: stamp,
  providerRetryAfter: stamp.nullable(), entries: z.array(catalogueEntrySchema).max(MAX_PRICE_INSTRUMENTS),
}).strict().refine(value => new Set(value.entries.map(e => instrument(e.instrument).id)).size === value.entries.length, "duplicate partition");
export type PriceCatalogue = z.infer<typeof catalogueSchema>;
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;
export function emptyCatalogue(): PriceCatalogue { return { version: 2, updatedAt: new Date().toISOString(), providerRetryAfter: null, entries: [] }; }
function signature(payload: string): Buffer { return crypto.createHmac("sha256", driveKey("catalogue-integrity-v2")).update(payload).digest(); }
export function packPriceCatalogue(catalogue: PriceCatalogue): Buffer {
  const payload = JSON.stringify(catalogueSchema.parse(catalogue));
  const bytes = Buffer.from(JSON.stringify({ payload, mac: signature(payload).toString("hex") }));
  if (bytes.length > CATALOGUE_LIMIT) throw new PriceError("drive_catalogue_too_large");
  return bytes;
}
export function unpackPriceCatalogue(bytes: Buffer): PriceCatalogue {
  try {
    if (bytes.length > CATALOGUE_LIMIT) throw Error();
    const value = z.object({ payload: z.string().max(CATALOGUE_LIMIT), mac: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(bytes.toString("utf8")));
    if (!crypto.timingSafeEqual(signature(value.payload), Buffer.from(value.mac, "hex"))) throw Error();
    return catalogueSchema.parse(JSON.parse(value.payload));
  } catch { throw new PriceError("drive_catalogue_integrity_failed"); }
}

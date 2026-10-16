import { z } from "zod";
const text = z.string().max(100_000);
export const operationId = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const date = z.string().datetime({ offset: true }).or(z.string().date()).nullable();
export const properties = z.object({
  updated: date.optional(), event_date: date.optional(), published_at: date.optional(),
  received_at: date.optional(), imported_at: date.optional(), verified_at: date.optional(),
  verification: z.enum(["unverified", "not_reverified", "verified_against_primary", "disputed", "superseded"]).optional(),
  related_claim_ids: z.array(z.string().min(1).max(100)).max(100).optional(),
  thesis_impact: z.enum(["unassessed", "confirms", "strengthens", "weakens", "contradicts", "changes", "no_change", "unresolved"]).optional(),
}).strict();
export const change = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("replace"), oldText:text.min(1), newText:text}).strict(),
  z.object({kind:z.literal("append"), heading:z.string().min(1).max(200), content:text.min(1), date:z.string().date()}).strict(),
  z.object({kind:z.literal("frontmatter"), properties}).strict(),
  z.object({kind:z.literal("create"), content:text.min(1)}).strict(),
  z.object({kind:z.literal("rollback"), operationId}).strict(),
]);
export const evidence = z.object({
  entity:z.string().min(1).max(120), event:z.string().min(1).max(200),
  period:z.string().min(1).max(100), originalSource:z.string().min(1).max(500),
  classification:z.enum(["duplicate","new_event","added_detail","confirmation","correction","contradiction","thesis_changing","unresolved"]),
  delta:z.string().min(1).max(2000), independent:z.boolean().default(false),
  verification:z.enum(["unverified","not_reverified","verified_against_primary","disputed","superseded"]),
  sourceType:z.enum(["primary","attributed","user_supplied","archived_ai"]),
  primaryUrl:z.string().url().max(500).optional(),
  event_date:date, published_at:date, received_at:date, imported_at:date, verified_at:date,
  relatedPaths:z.array(z.string().min(1).max(350)).max(20),
}).strict();
export const previewSchema = z.object({
  operationId, path:z.string().min(1).max(350), reason:z.string().min(1).max(1000),
  change, evidence:evidence.optional(),
}).strict();
export type PreviewInput = z.infer<typeof previewSchema>;
export const applySchema = z.object({operationId, previewToken:z.string().regex(/^[a-f0-9]{64}$/), expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();

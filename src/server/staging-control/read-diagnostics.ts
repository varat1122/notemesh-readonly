import { z } from "zod";

export const MAX_INSPECT_DB_BYTES = 256 * 1024 * 1024;
export const INSPECT_CACHE_KIB = 64 * 1024;
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const file = z.object({ exists: z.boolean(), bytes: bytes.nullable() }).strict()
  .refine(f => f.exists ? f.bytes !== null : f.bytes === null);
const cache = z.number().int().min(-2_147_483_648).max(2_147_483_647);
export const dbCharacteristicsSchema = z.object({
  sqlite_version: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  database: file, wal: file, shm: file,
  page_size: z.number().int().min(512).max(65536).refine(n => (n & (n - 1)) === 0),
  page_count: z.number().int().min(1).max(MAX_INSPECT_DB_BYTES / 512),
  cache_size: cache, mmap_size: bytes.nullable(), query_only: z.literal(1),
  foreign_keys: z.literal(1), trusted_schema: z.literal(0), ignore_check_constraints: z.literal(0),
}).strict().refine(d => d.database.exists && d.database.bytes! <= MAX_INSPECT_DB_BYTES &&
  d.page_size * d.page_count <= MAX_INSPECT_DB_BYTES);
export const readProfileSchema = z.object({
  profile: z.enum(["baseline", "cache64", "mmap-bounded", "cache64-mmap-bounded"]),
  cache_size_effective: cache, cache_target_kib: z.union([z.literal(INSPECT_CACHE_KIB), z.null()]),
  mmap_requested_bytes: bytes.max(MAX_INSPECT_DB_BYTES).nullable(),
  mmap_size_effective: bytes.nullable(), mmap_active: z.boolean(),
  query_only: z.literal(1), foreign_keys: z.literal(1), trusted_schema: z.literal(0), ignore_check_constraints: z.literal(0),
  persistent_configuration_changes: z.literal(false),
}).strict().refine(p => p.mmap_active === (p.mmap_size_effective !== null && p.mmap_size_effective > 0) &&
  (p.cache_target_kib === null || p.cache_size_effective === -INSPECT_CACHE_KIB) &&
  (p.mmap_requested_bytes === null || p.mmap_size_effective === null || p.mmap_size_effective <= p.mmap_requested_bytes));
export const diagnosticSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("db_characteristics"), data: dbCharacteristicsSchema }).strict(),
  z.object({ kind: z.literal("db_read_profile"), data: readProfileSchema }).strict(),
]);
export type DbCharacteristics = z.infer<typeof dbCharacteristicsSchema>;
export type DbReadProfile = z.infer<typeof readProfileSchema>;
export type ReadDiagnostic = z.infer<typeof diagnosticSchema>;
export type DiagnosticReporter = (event: ReadDiagnostic) => void;

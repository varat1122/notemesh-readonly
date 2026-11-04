import type { DatabaseSync } from "node:sqlite";
import { Hold } from "./contract";
import { dbCharacteristicsSchema, readProfileSchema, INSPECT_CACHE_KIB, MAX_INSPECT_DB_BYTES, type DbCharacteristics, type DbReadProfile } from "./read-diagnostics";

export const FULL_INTEGRITY_SQL = "PRAGMA integrity_check(10)";
type Files = Pick<DbCharacteristics, "database" | "wal" | "shm">;
const value = (db: DatabaseSync, pragma: string) => Object.values(db.prepare(`PRAGMA ${pragma}`).get() ?? {})[0];
const mmap = (db: DatabaseSync) => { const v = value(db, "mmap_size"); return v === undefined ? null : Number(v); };
function guards(db: DatabaseSync) {
  return { query_only: Number(value(db, "query_only")), foreign_keys: Number(value(db, "foreign_keys")),
    trusted_schema: Number(value(db, "trusted_schema")), ignore_check_constraints: Number(value(db, "ignore_check_constraints")) };
}
// Fixed PRAGMA projections only; never schema names, row data, paths, errors or compile-option strings.
export function dbCharacteristics(db: DatabaseSync, files: Files): DbCharacteristics {
  const parsed = dbCharacteristicsSchema.safeParse({ ...files, sqlite_version: String(db.prepare("SELECT sqlite_version() AS version").get()!.version),
    page_size: Number(value(db, "page_size")), page_count: Number(value(db, "page_count")),
    cache_size: Number(value(db, "cache_size")), mmap_size: mmap(db), ...guards(db) });
  if (!parsed.success) throw new Hold("DB_CHARACTERISTICS_UNAVAILABLE_HOLD");
  return parsed.data;
}
// Only the dedicated inspect connection calls this; no defaults on the normal app, preview or recovery connection change.
// cache_size is a session-local suggested page-cache limit. mmap_size bounds mapped bytes on this connection.
// Neither is a file-header/default_cache_size change; no checkpoint, migration or integrity shortcut is used.
export function configureIntegrityRead(db: DatabaseSync, before: DbCharacteristics,
  profile: DbReadProfile["profile"] = "cache64-mmap-bounded"): DbReadProfile {
  const useCache = profile === "cache64" || profile === "cache64-mmap-bounded";
  const useMap = profile === "mmap-bounded" || profile === "cache64-mmap-bounded";
  const requested = useMap ? Math.floor(Math.min(before.database.bytes!, before.page_size * before.page_count, MAX_INSPECT_DB_BYTES) / before.page_size) * before.page_size : null;
  if (useCache) db.exec(`PRAGMA main.cache_size=-${INSPECT_CACHE_KIB}`);
  if (requested !== null) db.exec(`PRAGMA main.mmap_size=${requested}`);
  const effectiveMap = mmap(db);
  const parsed = readProfileSchema.safeParse({ profile, cache_size_effective: Number(value(db, "cache_size")),
    cache_target_kib: useCache ? INSPECT_CACHE_KIB : null, mmap_requested_bytes: requested,
    mmap_size_effective: effectiveMap, mmap_active: effectiveMap !== null && effectiveMap > 0,
    ...guards(db), persistent_configuration_changes: false });
  if (!parsed.success) throw new Hold("DB_READ_PROFILE_UNAVAILABLE_HOLD");
  return parsed.data;
}
export function fullIntegrity(db: DatabaseSync) {
  try {
    const rows = db.prepare(FULL_INTEGRITY_SQL).all();
    return { ok: rows.length === 1 && rows[0].integrity_check === "ok", result_rows: rows.length,
      statement: FULL_INTEGRITY_SQL, scope: "full database; exactly one ok row required; FK checked separately" };
  } catch { throw new Hold("FULL_INTEGRITY_QUERY_FAILED_HOLD"); }
}

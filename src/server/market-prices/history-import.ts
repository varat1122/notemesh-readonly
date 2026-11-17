/** Local history input boundary; persistence belongs exclusively to PriceStore.
 * Reuses the #182 CSV parser. This is not a replacement for either read-only audit.
 */
import crypto from "node:crypto";
import { parsePriceImportCsv } from "./import-cache-audit.ts";
import { instrument, isoDate, PriceError, type PriceBar } from "./model.ts";

export const HISTORY_IMPORT_SCHEMA = "ios-price-history-import-v1";
export const HISTORY_SOURCE_SCHEMA = "ios-price-history-source-v1";
export const SYNTHETIC_HISTORY_REF = "fixture://IOS-W05-LOCAL-MOCK-ONLY";
export const historyHash = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");
export type HistoryBasis = "RAW" | "SPLIT_ADJUSTED" | "DIVIDEND_ADJUSTED" | "TOTAL_RETURN";
export type HistoryImportOptions = {
  mode?: "NO_APPLY" | "APPLY";
  // These claims are accepted ONLY in a factory-created disposable synthetic DB.
  // They can never grant runtime D1 admission or rights for owner files.
  mapping?: { instrumentId: string; currency: string; evidenceRef: string };
  rights?: { scope: "synthetic_fixture_only"; evidenceRef: string };
};
export type HistoryRow = PriceBar & {
  sourceLine: number; observedAt: string; retrievedAt: string | null;
  decimalValues: (string | null)[]; inputValueHash: string;
};
export type HistoryBatch = {
  fileSha256: string; source: "owner_csv"; sourceRef: string; priceBasis: HistoryBasis;
  target: ReturnType<typeof instrument>; rows: HistoryRow[];
};
export type HistoryReceipt = {
  schema: typeof HISTORY_IMPORT_SCHEMA; receiptId: string; fileSha256: string;
  source: "owner_csv"; dataOrigin: "synthetic_fixture"; instrumentId: string;
  sourceRef: string; priceBasis: HistoryBasis; importedAt: string;
  revision: number; sourceRecordVersion: typeof HISTORY_SOURCE_SCHEMA;
  inserted: number; unchanged: number; inputRows: number; totalRows: number;
  coverage: { firstSession: string; lastSession: string; rows: number; officialCalendarVerified: false };
  rights: { status: "SYNTHETIC_ONLY_NOT_ENTITLED"; evidenceRef: string };
  mappingEvidenceRef: string; independentVerification: false;
};
export type HistoryImportResult = {
  status: "NO_APPLY" | "D1_HOLD" | "RIGHTS_HOLD" | "MAPPING_HOLD" | "INPUT_HOLD" |
    "HOLD_CONFLICT" | "WRITER_BUSY" | "APPLIED_SYNTHETIC" | "IDEMPOTENT";
  applied: boolean; fileSha256: string; reason?: string; receipt?: HistoryReceipt;
  conflict?: { existing: unknown; incoming: unknown };
};

function decimal(value: string | undefined, volume = false): string | null {
  if (value === undefined || value === "") return null;
  if (!(volume ? /^\d{1,15}$/ : /^\d{1,12}(?:\.\d{1,8})?$/).test(value)) throw new PriceError("invalid_history_number");
  const n = Number(value);
  if (!Number.isFinite(n) || (volume ? !Number.isSafeInteger(n) || n < 0 : n <= 0)) throw new PriceError("invalid_history_number");
  const [whole, fraction = ""] = value.split(".");
  const rest = fraction.replace(/0+$/, "");
  return whole.replace(/^0+(?=\d)/, "") + (rest ? "." + rest : "");
}
function timestamp(value: string | undefined, required: boolean): string | null {
  if (!value && !required) return null;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !isoDate.safeParse(value.slice(0, 10)).success || Number(value.slice(11, 13)) > 23
    || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59
    || !Number.isFinite(Date.parse(value))) throw new PriceError("invalid_history_timestamp");
  return value;
}

/** Validate bytes again at the writer boundary; never accept a preview as write authority. */
export function prepareHistoryBatch(bytes: Uint8Array, now: Date): HistoryBatch {
  if (!bytes.length || bytes.length > 256 * 1024) throw new PriceError("history_byte_limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new PriceError("history_nul_byte");
  const input = parsePriceImportCsv(text);
  if (!input.length || input.length > 500) throw new PriceError("history_row_limit");
  const target = instrument({ market: "US", symbol: "AAPL" });
  const first = input[0];
  if (!["RAW", "SPLIT_ADJUSTED", "DIVIDEND_ADJUSTED", "TOTAL_RETURN"].includes(first.adjustment_basis)) throw new PriceError("unknown_history_basis");
  const priceBasis = first.adjustment_basis as HistoryBasis;
  const seen = new Set<string>();
  const rows = input.map(row => {
    if (row.instrument_id !== target.id || row.currency !== target.currency) throw new PriceError("history_listing_out_of_scope");
    if (row.source_type !== "owner_csv" || row.source_file_or_uri !== SYNTHETIC_HISTORY_REF) throw new PriceError("real_file_apply_requires_D1");
    if (row.adjustment_basis !== priceBasis) throw new PriceError("mixed_history_basis");
    isoDate.parse(row.session_date);
    if (row.session_date > now.toISOString().slice(0, 10)) throw new PriceError("future_history_date");
    if (seen.has(row.session_date)) throw new PriceError("duplicate_history_date");
    seen.add(row.session_date);
    const observedAt = timestamp(row.observed_at, true)!;
    const retrievedAt = timestamp(row.retrieved_at, false);
    if (Date.parse(observedAt) > now.getTime() || (retrievedAt && (Date.parse(retrievedAt) < Date.parse(observedAt) || Date.parse(retrievedAt) > now.getTime()))) throw new PriceError("history_timestamp_order");
    const values = [decimal(row.open), decimal(row.high), decimal(row.low), decimal(row.close), decimal(row.volume, true), decimal(row.adjusted_close)];
    const [open, high, low, close, volume, adjustedClose] = values.map(v => v === null ? null : Number(v));
    const full = open !== null && high !== null && low !== null;
    const closeOnly = open === null && high === null && low === null;
    if (close === null || (!full && !closeOnly) || (full && (low! > Math.min(open!, close) || high! < Math.max(open!, close, low!)))) throw new PriceError("invalid_history_ohlc");
    return { date: row.session_date, open, high, low, close, volume, adjustedClose,
      sourceLine: row.sourceLine, observedAt, retrievedAt, decimalValues: values,
      inputValueHash: historyHash(JSON.stringify([target.id, "owner_csv", priceBasis, row.session_date, ...values])) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { fileSha256: historyHash(bytes), source: "owner_csv", sourceRef: SYNTHETIC_HISTORY_REF, target, priceBasis, rows };
}

/**
 * IOS Prices: read-only import preflight for historical and future daily bars.
 * NO DB writes, provider calls, authorization grants, or PriceStore fallback.
 * Caller-supplied mapping/coverage metadata can only create a *proposal*.
 * The canonical writer must recheck rights, versions and rows under D1.
 */
export const IMPORT_PREVIEW_SCHEMA = "ios-price-import-preview-v0.3.0" as const;

export type HistoricalInputRow = {
  sourceLine: number;
  instrument_id: string;
  session_date: string;
  currency: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  adjusted_close?: string;
  adjustment_basis: string;
  source_type: string;
  source_file_or_uri: string;
  observed_at?: string;
  retrieved_at?: string;
};

export type SourceAttestation = {
  instrument_id: string;
  status: "APPROVED" | "PENDING" | "HOLD";
  currency: string;
  rights_for_storage: boolean;
  source_locator: string;
};

export type BaselineBar = Omit<HistoricalInputRow, "sourceLine" | "source_file_or_uri">;
export type BaselineSnapshot = {
  bars: readonly BaselineBar[];
  completeWindows: readonly {
    instrument_id: string;
    start: string;
    end: string;
    sourceReceipt: string;
    complete: boolean;
  }[];
};

export type PreviewAction = "HOLD" | "EXACT_NOOP_NOT_APPLIED" | "PROPOSE_INSERT_NO_APPLY";
export type ImportPreviewRow = {
  sourceLine: number;
  instrumentId: string;
  sessionDate: string;
  action: PreviewAction;
  reasons: string[];
};
export type ImportPreviewResult = {
  schema: typeof IMPORT_PREVIEW_SCHEMA;
  mode: "OFFLINE_NO_APPLY";
  inputRows: number;
  actions: Record<PreviewAction, number>;
  rows: ImportPreviewRow[];
  remarks: string[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTRUMENT = /^[A-Z0-9_]{2,15}:[A-Z0-9.\-]{1,30}$/;
const CURRENCY = /^[A-Z]{3}$/;
const BASIS = new Set(["RAW", "SPLIT_ADJUSTED", "DIVIDEND_ADJUSTED", "TOTAL_RETURN"]);
const LEGACY_MARKETS = new Set(["US", "TH", "HK", "JP"]);
const NUMERICS = ["open", "high", "low", "close", "volume", "adjusted_close"] as const;
const COMPARISON = ["currency", "adjustment_basis", "source_type"] as const;

type NumberField = typeof NUMERICS[number];

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Exact decimal comparison without IEEE-754 rounding or an invented volume. */
function canonicalDecimal(value: string | undefined, field: NumberField): string | null {
  if (value == null || !value.trim()) return null;
  const text = value.trim();
  if (!/^\+?\d+(?:\.\d+)?$/.test(text) || text.length > 64) return "INVALID";
  const [whole, frac = ""] = text.replace(/^\+/, "").split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  const decimal = frac.replace(/0+$/, "");
  const clean = `${integer}${decimal ? "." + decimal : ""}`;
  if (field !== "volume" && !/[1-9]/.test(clean)) return "INVALID";
  if (field === "volume" && decimal) return "INVALID";
  return clean;
}

function stablePriceKey(row: HistoricalInputRow | BaselineBar): string {
  return JSON.stringify([
    ...NUMERICS.map(field => canonicalDecimal(row[field], field)),
    ...COMPARISON.map(field => (row[field] ?? "").trim().toUpperCase()),
  ]);
}

function timeWithZone(value: string | undefined): number | null | "INVALID" {
  if (!value?.trim()) return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return "INVALID";
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : "INVALID";
}

function reasonsFor(row: HistoricalInputRow, asOf: string): string[] {
  const reasons: string[] = [];
  const id = row.instrument_id.trim();
  const day = row.session_date.trim();
  if (!INSTRUMENT.test(id)) reasons.push("invalid_instrument_id");
  if (!validDate(day)) reasons.push("invalid_session_date");
  else {
    if (day > asOf) reasons.push("future_session_date");
    if ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) reasons.push("weekend_session_needs_calendar_review");
  }
  if (!LEGACY_MARKETS.has(id.split(":", 1)[0])) reasons.push("legacy_market_schema_unavailable");
  if (!CURRENCY.test(row.currency.trim().toUpperCase())) reasons.push("invalid_currency");
  const prices = Object.fromEntries(NUMERICS.map(field => [field, canonicalDecimal(row[field], field)])) as Record<NumberField, string | null>;
  for (const field of NUMERICS) if (prices[field] === "INVALID") reasons.push(`invalid_${field}`);
  if (prices.close === null) reasons.push("missing_close");
  const ohl = [prices.open, prices.high, prices.low];
  if (ohl.some(x => x !== null) && !ohl.every(x => x !== null && x !== "INVALID")) reasons.push("partial_ohl_not_supported");
  if (ohl.every(x => x === null) && prices.close !== null) reasons.push("close_only_requires_new_schema");
  if (prices.volume === null) reasons.push("volume_missing_in_legacy_store");
  // JS comparison below is only a conservative range check; equality stays decimal-string exact.
  if (ohl.every(x => x != null && x !== "INVALID") && prices.close != null && prices.close !== "INVALID") {
    const [open, high, low, close] = [prices.open, prices.high, prices.low, prices.close].map(Number);
    if (!(low <= open && open <= high && low <= close && close <= high)) reasons.push("ohlc_range_violation");
  }
  const basis = row.adjustment_basis.trim().toUpperCase();
  if (!BASIS.has(basis)) reasons.push("unknown_or_invalid_price_basis");
  if (!row.source_type.trim()) reasons.push("missing_source_type");
  if (!row.source_file_or_uri.trim()) reasons.push("missing_source_locator");
  // The deployed PriceSnapshot.source is literally "yahoo-chart"; never rebrand owner Excel as Yahoo.
  if (row.source_type.trim().toLowerCase() !== "yahoo-chart") reasons.push("legacy_store_source_provenance_incompatible");
  const observed = timeWithZone(row.observed_at);
  const fetched = timeWithZone(row.retrieved_at);
  if (observed === "INVALID") reasons.push("invalid_observed_timestamp");
  if (fetched === "INVALID") reasons.push("invalid_retrieved_timestamp");
  if (typeof observed === "number" && typeof fetched === "number" && fetched < observed) reasons.push("retrieved_before_observed");
  return reasons;
}

function declaredComplete(snapshot: BaselineSnapshot, id: string, day: string): boolean {
  return snapshot.completeWindows.some(x => x.complete === true && x.instrument_id === id
    && validDate(x.start) && validDate(x.end) && x.start <= day && day <= x.end && x.sourceReceipt.trim());
}

/** The caller must keep all original source rows/lines and never pre-deduplicate. */
export function previewHistoricalPriceImport(
  rows: readonly HistoricalInputRow[], options: {
    asOf: string;
    attestations?: readonly SourceAttestation[];
    baseline?: BaselineSnapshot;
  },
): ImportPreviewResult {
  if (!validDate(options.asOf)) throw new Error("invalid_preview_as_of");
  if (rows.length > 100_000) throw new Error("preview_too_many_rows_chunk_first");
  const attestations = new Map<string, SourceAttestation>();
  for (const item of options.attestations ?? []) {
    if (attestations.has(item.instrument_id)) throw new Error("duplicate_attestation");
    attestations.set(item.instrument_id, item);
  }
  const baseline = new Map<string, BaselineBar>();
  if (options.baseline) for (const item of options.baseline.bars) {
    const key = `${item.instrument_id}\u0000${item.session_date}`;
    if (baseline.has(key)) throw new Error("duplicate_baseline_key");
    baseline.set(key, item);
  }
  const keyFrequency = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.instrument_id.trim()}\u0000${row.session_date.trim()}`;
    keyFrequency.set(key, (keyFrequency.get(key) ?? 0) + 1);
  }
  const planned = rows.map(row => {
    const id = row.instrument_id.trim(), day = row.session_date.trim();
    const key = `${id}\u0000${day}`;
    const problems = reasonsFor(row, options.asOf);
    if (keyFrequency.get(key)! > 1) problems.push("ambiguous_duplicate_input_key");
    const mapping = attestations.get(id);
    if (!mapping || mapping.status !== "APPROVED") problems.push("mapping_not_approved");
    else {
      if (mapping.currency !== row.currency.trim().toUpperCase()) problems.push("mapping_currency_mismatch");
      if (!mapping.rights_for_storage) problems.push("retention_rights_not_attested");
      if (!mapping.source_locator.trim()) problems.push("mapping_source_untraceable");
    }
    const old = baseline.get(key);
    if (!options.baseline) problems.push("no_cached_baseline");
    else if (old && stablePriceKey(row) !== stablePriceKey(old)) problems.push("baseline_conflict_review_required");
    else if (!old && !declaredComplete(options.baseline, id, day)) problems.push("baseline_window_not_proven_complete");
    const reasons = [...new Set(problems)].sort();
    const action: PreviewAction = reasons.length ? "HOLD" : old ? "EXACT_NOOP_NOT_APPLIED" : "PROPOSE_INSERT_NO_APPLY";
    return { sourceLine: row.sourceLine, instrumentId: id, sessionDate: day, action, reasons };
  });
  const actions: Record<PreviewAction, number> = { HOLD: 0, EXACT_NOOP_NOT_APPLIED: 0, PROPOSE_INSERT_NO_APPLY: 0 };
  for (const row of planned) actions[row.action]++;
  return { schema: IMPORT_PREVIEW_SCHEMA, mode: "OFFLINE_NO_APPLY", inputRows: rows.length, actions, rows: planned,
    remarks: [
      "No market/provider requests, PriceStore writes, Vault writes, runtime changes or implied rights approvals.",
      "Caller-supplied APPROVED and complete-window claims are unverified assertions: the authorized writer must independently recheck before any commit.",
      "Current V1 PriceStore is Yahoo-only/full-OHLCV and cannot persist Close-only or DR sources without a reviewed schema+writer change.",
    ] };
}

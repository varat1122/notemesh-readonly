import { describe, it, expect } from "vitest";
import { previewHistoricalPriceImport, type HistoricalInputRow, type BaselineBar } from "./import-preview";

const base: HistoricalInputRow = {
  sourceLine: 2, instrument_id: "US:NVDA", session_date: "2026-11-13", currency: "USD",
  open: "169.91", high: "170", low: "158.39", close: "162.85", volume: "363819700", adjusted_close: "162.85",
  adjustment_basis: "RAW", source_type: "yahoo-chart", source_file_or_uri: "fixture://source", observed_at: "2026-11-13T21:00:00Z", retrieved_at: "2026-11-16T06:00:21Z",
};
const attestation = { instrument_id: "US:NVDA", status: "APPROVED" as const, currency: "USD", rights_for_storage: true, source_locator: "fixture://mapping" };
const baseline: BaselineBar = { ...base };
type PreviewOptions = Parameters<typeof previewHistoricalPriceImport>[1];
const options: PreviewOptions = { asOf: "2026-11-17", attestations: [attestation], baseline: { bars: [baseline], completeWindows: [{ instrument_id: "US:NVDA", start: "2026-11-01", end: "2026-11-16", sourceReceipt: "fixture-receipt", complete: true }] } };
const preview = (patch: Partial<HistoricalInputRow>, opts: PreviewOptions = options) => previewHistoricalPriceImport([{ ...base, ...patch }], opts);
const reasons = (patch: Partial<HistoricalInputRow>, opts: PreviewOptions = options) => preview(patch, opts).rows[0].reasons;

describe("IOS price import preview: isolated NO_APPLY", () => {
  it("returns an exact-noop proposal for an explicitly aligned baseline", () => {
    const result = preview({}); expect(result.actions.EXACT_NOOP_NOT_APPLIED).toBe(1);
    expect(result.mode).toBe("OFFLINE_NO_APPLY");
  });
  it("compares exact decimals without float normalization", () => {
    expect(preview({ close: "00162.8500" }).rows[0].action).toBe("EXACT_NOOP_NOT_APPLIED");
  });
  it("only proposes inserts in a declared complete baseline window", () => {
    const result = preview({ session_date: "2026-11-14" });
    expect(result.rows[0].action).toBe("HOLD"); // weekend session
    const onSession = preview({ session_date: "2026-11-12" });
    expect(onSession.rows[0].action).toBe("PROPOSE_INSERT_NO_APPLY");
  });
  it("rejects incomplete baseline windows", () => {
    const opts = { ...options, baseline: { bars: [], completeWindows: [] } };
    expect(reasons({ session_date: "2026-11-12" }, opts)).toContain("baseline_window_not_proven_complete");
  });
  it("rejects an empty baseline", () => {
    expect(reasons({}, { ...options, baseline: undefined })).toContain("no_cached_baseline");
  });
  it("refuses conflicting existing bars", () => {
    expect(reasons({ close: "162.84" })).toContain("baseline_conflict_review_required");
  });
  it("holds close-only rows rather than inventing OHLC", () => {
    expect(reasons({ open: "", high: "", low: "" })).toContain("close_only_requires_new_schema");
  });
  it("holds missing legacy volume", () => {
    expect(reasons({ volume: "" })).toContain("volume_missing_in_legacy_store");
  });
  it("refuses partial OHL", () => {
    expect(reasons({ low: "" })).toContain("partial_ohl_not_supported");
  });
  it("refuses impossible OHLC bounds", () => {
    expect(reasons({ low: "171" })).toContain("ohlc_range_violation");
  });
  it("refuses weekend dates", () => {
    expect(reasons({ session_date: "2026-11-15" })).toContain("weekend_session_needs_calendar_review");
  });
  it("refuses future and invalid dates", () => {
    expect(reasons({ session_date: "2026-11-18" })).toContain("future_session_date");
    expect(reasons({ session_date: "2026-02-30" })).toContain("invalid_session_date");
  });
  it("holds unsupported DR identity", () => {
    expect(reasons({ instrument_id: "DR:AAPL80" })).toContain("legacy_market_schema_unavailable");
  });
  it("never silently relabels an Excel source as Yahoo", () => {
    expect(reasons({ source_type: "owner_excel" })).toContain("legacy_store_source_provenance_incompatible");
  });
  it("requires explicit storage and mapping claims", () => {
    expect(reasons({}, { ...options, attestations: [] })).toContain("mapping_not_approved");
    expect(reasons({}, { ...options, attestations: [{ ...attestation, rights_for_storage: false }] })).toContain("retention_rights_not_attested");
  });
  it("holds mapping currency mismatch", () => {
    expect(reasons({ currency: "JPY" })).toContain("mapping_currency_mismatch");
  });
  it("requires a known price adjustment basis", () => {
    expect(reasons({ adjustment_basis: "UNKNOWN" })).toContain("unknown_or_invalid_price_basis");
  });
  it("validates timezone and temporal ordering", () => {
    expect(reasons({ observed_at: "2026-11-13T21:00:00" })).toContain("invalid_observed_timestamp");
    expect(reasons({ retrieved_at: "2026-11-13T20:00:00Z" })).toContain("retrieved_before_observed");
  });
  it("rejects ambiguous duplicate keys on both lines", () => {
    const result = previewHistoricalPriceImport([base, { ...base, sourceLine: 3 }], options);
    expect(result.actions.HOLD).toBe(2);
    expect(result.rows.every(x => x.reasons.includes("ambiguous_duplicate_input_key"))).toBe(true);
  });
  it("rejects duplicate baseline entries rather than choosing one", () => {
    expect(() => preview({}, { ...options, baseline: { bars: [baseline, baseline], completeWindows: [] } })).toThrow("duplicate_baseline_key");
  });
  it("rejects duplicate attestations", () => {
    expect(() => preview({}, { ...options, attestations: [attestation, attestation] })).toThrow("duplicate_attestation");
  });
  it("refuses malformed as-of dates", () => {
    expect(() => previewHistoricalPriceImport([base], { asOf: "2026-02-30" })).toThrow("invalid_preview_as_of");
  });
  it("rejects negative/nonintegral numeric volume", () => {
    expect(reasons({ volume: "-3" })).toContain("invalid_volume");
    expect(reasons({ volume: "2.5" })).toContain("invalid_volume");
  });
  it("does not imply any PriceStore writer or live provider fetch", () => {
    const report = preview({});
    expect(report.remarks.some(x => x.includes("No market/provider requests"))).toBe(true);
  });
});

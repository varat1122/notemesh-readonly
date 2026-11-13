import fs from "node:fs";
import crypto from "node:crypto";
import { instrument, isoDate, type Market } from "./model.ts";

// W05 Phase A: bounded, no-write preview of ONE synthetic daily OHLCV CSV for ONE configured listing.
// It never stores, fetches, reads rights configuration or relabels a file as `yahoo-chart`: the
// Yahoo-only PriceStore persistence boundary is deliberately not reached. A preview is not storage
// entitlement, listing verification or market-data verification.
export const CSV_PREVIEW_CONTRACT = "ios-prices-w05-preview-v0";
export const CSV_PREVIEW_MAX_BYTES = 256 * 1024;
export const CSV_PREVIEW_MAX_ROWS = 500;
const MAX_FIELD_CHARS = 64;
const MAX_PATH_CHARS = 4096;
const MAX_ISSUES = 50;
export const CSV_PREVIEW_HEADER = ["market", "symbol", "venue", "currency", "time_zone", "session_date", "open", "high", "low",
  "close", "volume", "adjusted_close", "price_basis", "source_type", "source_ref", "source_captured_at"] as const;
type Column = typeof CSV_PREVIEW_HEADER[number];
// Only the configured synthetic fixture listing and markers are admissible in v0.
const PREVIEW_LISTINGS = new Set(["US:AAPL"]);
const SYNTHETIC_MARKERS = { price_basis: "synthetic_raw_ohlcv", source_type: "synthetic_fixture",
  source_ref: "IOS-W05-LOCAL-MOCK-ONLY", source_captured_at: "2026-11-13T00:00:00Z" } as const;
const PRICE = /^\d{1,12}(\.\d{1,8})?$/, NEGATIVE = /^-\d{1,12}(\.\d{1,8})?$/, VOLUME = /^\d{1,15}$/;

export type CsvPreviewStatus = "PREVIEW_VALID_SYNTHETIC" | "PREVIEW_QC_HOLD" | "PREVIEW_HOLD";
/** Sanitized diagnostic: a code plus row pointer (1-based data row; 0 = header). Raw cell content is never echoed. */
export interface CsvPreviewIssue { code: string; row?: number; column?: Column }
export interface CsvPreview {
  contract: typeof CSV_PREVIEW_CONTRACT;
  status: CsvPreviewStatus;
  sourceOrigin: "synthetic_fixture" | "not_admitted";
  fileSha256: string | null;
  bytes: number;
  previewAt: string;
  inputRows: number | null;
  candidateRows: number;
  quarantinedRows: number;
  identity: { id: string; venue: string; currency: string; timeZone: string; identityVerifiedLive: false } | null;
  coverage: { firstSession: string; lastSession: string; sessions: number; officialCalendarVerified: false; coverageProvisional: true } | null;
  issues: CsvPreviewIssue[];
  issuesTruncated: boolean;
  persistenceEligible: false;
  wouldWrite: false;
  networkRequests: 0;
  databaseWrites: 0;
  driveWrites: 0;
  vaultWrites: 0;
}

class Hold extends Error {
  readonly issue: CsvPreviewIssue;
  constructor(issue: CsvPreviewIssue) { super(issue.code); this.issue = issue; }
}
function hold(code: string, row?: number, column?: Column): never {
  throw new Hold({ code, ...(row === undefined ? {} : { row }), ...(column ? { column } : {}) });
}

function result(now: Date, fields: Partial<CsvPreview> & Pick<CsvPreview, "status">): CsvPreview {
  const issues = fields.issues ?? [];
  return { contract: CSV_PREVIEW_CONTRACT, status: fields.status, sourceOrigin: fields.sourceOrigin ?? "not_admitted",
    fileSha256: fields.fileSha256 ?? null, bytes: fields.bytes ?? 0, previewAt: now.toISOString(), inputRows: fields.inputRows ?? null,
    candidateRows: fields.candidateRows ?? 0, quarantinedRows: fields.quarantinedRows ?? 0, identity: fields.identity ?? null,
    coverage: fields.coverage ?? null, issues: issues.slice(0, MAX_ISSUES), issuesTruncated: issues.length > MAX_ISSUES,
    persistenceEligible: false, wouldWrite: false, networkRequests: 0, databaseWrites: 0, driveWrites: 0, vaultWrites: 0 };
}

/** Strict RFC 4180 records (CRLF or LF). Bounded by the byte cap, field length and row cap. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false, wasQuoted = false;
  const push = () => { row.push(field); field = ""; wasQuoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else {
        inQuotes = false; wasQuoted = true;
        if (![undefined, ",", "\r", "\n"].includes(text[i + 1])) hold("malformed_quote", rows.length);
      }
    } else if (c === '"') {
      if (field !== "" || wasQuoted) hold("malformed_quote", rows.length);
      inQuotes = true;
    } else if (c === ",") push();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] !== "\n") hold("bare_carriage_return", rows.length);
      if (c === "\r") i++;
      push(); rows.push(row); row = [];
      if (rows.length > CSV_PREVIEW_MAX_ROWS + 1) hold("row_cap_exceeded");
    } else field += c;
    if (field.length > MAX_FIELD_CHARS) hold("field_too_long", rows.length);
  }
  if (inQuotes) hold("unterminated_quote", rows.length);
  if (field !== "" || wasQuoted || row.length) { push(); rows.push(row); }
  if (rows.length > CSV_PREVIEW_MAX_ROWS + 1) hold("row_cap_exceeded");
  return rows;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// Spreadsheet formula triggers; a leading "-" is allowed only as a plain negative decimal (classified later).
const formulaLike = (value: string) => /^[=+@]/.test(value) || (value.startsWith("-") && !NEGATIVE.test(value));

function priceIssue(value: string): string | null {
  if (value === "") return "missing_price_value";
  if (NEGATIVE.test(value)) return "nonpositive_price";
  if (!PRICE.test(value)) return "invalid_number";
  return Number(value) > 0 ? null : "nonpositive_price";
}
function volumeIssue(value: string): string | null {
  if (value === "") return "missing_volume";
  if (/^-\d+$/.test(value)) return "negative_volume";
  return VOLUME.test(value) ? null : "invalid_volume"; // <= 15 digits is always a safe integer
}
/** First row-level OHLCV problem, or null. Never repairs, rounds or fills a value. */
function barIssue(r: Record<Column, string>): CsvPreviewIssue | null {
  for (const column of ["open", "high", "low", "close"] as const) {
    const code = priceIssue(r[column]);
    if (code) return { code, column };
  }
  const volume = volumeIssue(r.volume);
  if (volume) return { code: volume, column: "volume" };
  if (r.adjusted_close !== "" && priceIssue(r.adjusted_close)) return { code: "invalid_adjusted_close", column: "adjusted_close" };
  const [open, high, low, close] = [r.open, r.high, r.low, r.close].map(Number);
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return { code: "invalid_ohlc_range" };
  return null;
}

/** Preview exact raw bytes. Pure: no filesystem, network, database, environment or timer access. */
export function previewPriceCsv(bytes: Uint8Array, now = new Date()): CsvPreview {
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  let inputRows: number | null = null, synthetic = false;
  try {
    if (raw.byteLength > CSV_PREVIEW_MAX_BYTES) hold("byte_cap_exceeded");
    if (raw.byteLength === 0) hold("empty_input");
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) hold("utf8_bom_not_supported");
    if (raw.includes(0)) hold("nul_byte");
    let text = "";
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); } catch { hold("invalid_utf8"); }
    const records = parseCsv(text);
    if (records[0]?.length !== CSV_PREVIEW_HEADER.length || CSV_PREVIEW_HEADER.some((name, i) => records[0][i] !== name)) hold("invalid_header", 0);
    const data = records.slice(1);
    inputRows = data.length;
    if (!data.length) hold("no_data_rows");
    data.forEach((cells, i) => { if (cells.length !== CSV_PREVIEW_HEADER.length) hold("inconsistent_row_width", i + 1); });
    const rows = data.map(cells => Object.fromEntries(CSV_PREVIEW_HEADER.map((name, i) => [name, cells[i]])) as Record<Column, string>);
    rows.forEach((r, i) => CSV_PREVIEW_HEADER.forEach(column => {
      if (CONTROL.test(r[column])) hold("control_character", i + 1, column);
      if (formulaLike(r[column])) hold("formula_like_value", i + 1, column);
    }));
    // Provenance gate before identity: only the frozen synthetic markers are admissible; no rights promotion.
    rows.forEach((r, i) => (Object.keys(SYNTHETIC_MARKERS) as (keyof typeof SYNTHETIC_MARKERS)[]).forEach(column => {
      if (r[column] !== SYNTHETIC_MARKERS[column]) hold(`${column}_not_permitted`, i + 1, column);
    }));
    synthetic = true;
    const listings = new Set(rows.map(r => `${r.market}:${r.symbol}`));
    if (listings.size !== 1) hold("mixed_listing_not_supported_v1");
    const [id] = listings;
    // Exact configured key only; no case folding, suffix stripping or symbol-only/cross-listing resolution.
    if (!PREVIEW_LISTINGS.has(id)) hold("listing_not_in_preview_scope", 1);
    const target = instrument({ market: rows[0].market as Market, symbol: rows[0].symbol });
    rows.forEach((r, i) => {
      if (r.venue !== target.venue) hold("venue_mismatch", i + 1, "venue");
      if (r.currency !== target.currency) hold("currency_mismatch", i + 1, "currency");
      if (r.time_zone !== target.timeZone) hold("time_zone_mismatch", i + 1, "time_zone");
    });
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (!isoDate.safeParse(r.session_date).success) hold("invalid_session_date", i + 1, "session_date");
      if (seen.has(r.session_date)) hold("duplicate_session_date", i + 1, "session_date");
      if (i && r.session_date < rows[i - 1].session_date) hold("session_dates_not_increasing", i + 1, "session_date");
      seen.add(r.session_date);
    });
    const issues: CsvPreviewIssue[] = [], valid: string[] = [];
    rows.forEach((r, i) => {
      const issue = barIssue(r);
      if (issue) issues.push({ code: issue.code, row: i + 1, ...(issue.column ? { column: issue.column } : {}) });
      else valid.push(r.session_date);
    });
    const identity = { id, venue: target.venue, currency: target.currency, timeZone: target.timeZone, identityVerifiedLive: false as const };
    const common = { sourceOrigin: "synthetic_fixture" as const, fileSha256, bytes: raw.byteLength, inputRows, identity, candidateRows: valid.length };
    // Any quarantined row holds the whole file; never claim coverage from a silently reduced subset.
    if (issues.length) return result(now, { ...common, status: "PREVIEW_QC_HOLD", quarantinedRows: issues.length, issues });
    return result(now, { ...common, status: "PREVIEW_VALID_SYNTHETIC",
      coverage: { firstSession: valid[0], lastSession: valid[valid.length - 1], sessions: valid.length, officialCalendarVerified: false, coverageProvisional: true } });
  } catch (error) {
    const issue = error instanceof Hold ? error.issue : { code: "unexpected_preview_failure" };
    return result(now, { status: "PREVIEW_HOLD", sourceOrigin: synthetic ? "synthetic_fixture" : "not_admitted",
      fileSha256, bytes: raw.byteLength, inputRows, issues: [issue] });
  }
}

/** Read one explicit local regular `.csv` file (no symlink, FIFO, device or directory), bounded, read-only. */
export function previewPriceFile(inputPath: string, now = new Date()): CsvPreview {
  const fileHold = (code: string, bytes = 0) => result(now, { status: "PREVIEW_HOLD", bytes, issues: [{ code }] });
  if (typeof inputPath !== "string" || !inputPath || inputPath.length > MAX_PATH_CHARS || inputPath.includes("\0") || !/\.csv$/i.test(inputPath)) {
    return fileHold("unsafe_input_path");
  }
  let fd: number | undefined;
  try {
    const before = fs.lstatSync(inputPath);
    if (before.isSymbolicLink()) return fileHold("symlink_not_allowed");
    if (!before.isFile()) return fileHold("not_a_regular_file");
    if (before.size > CSV_PREVIEW_MAX_BYTES) return fileHold("byte_cap_exceeded", before.size);
    fd = fs.openSync(inputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) return fileHold("input_changed_during_open");
    const buffer = Buffer.alloc(CSV_PREVIEW_MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const n = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > CSV_PREVIEW_MAX_BYTES) return fileHold("byte_cap_exceeded", size);
    return previewPriceCsv(buffer.subarray(0, size), now);
  } catch {
    return fileHold("input_unreadable");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

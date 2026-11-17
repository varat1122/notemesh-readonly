/**
 * Read-only, CSV-to-cache inspection for the existing IOS PriceStore reader.
 * No Quote API, database mutation, storage rights assertion, or import execution.
 * The result is an audit, NOT an approved write plan.
 */
import { previewHistoricalPriceImport, type HistoricalInputRow, type ImportPreviewResult } from "./import-preview.ts";

const MANDATORY = ["instrument_id", "session_date", "currency", "close", "adjustment_basis", "source_type", "source_file_or_uri"] as const;
const NUMERIC = ["open", "high", "low", "close", "volume", "adjusted_close"] as const;
const HEADER = new Set([...MANDATORY, ...NUMERIC, "dataset_id", "provider_symbol", "venue", "observed_at", "retrieved_at", "data_vintage", "row_status"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MARKETS = {
  US: /^[A-Z][A-Z0-9-]{0,14}$/,
  TH: /^[A-Z0-9][A-Z0-9-]{0,19}$/,
  HK: /^\d{4,5}$/,
  JP: /^[0-9][A-Z0-9]{3}$/,
} as const;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

export type CacheBar = {
  date: string; open: number; high: number; low: number; close: number;
  volume: number; adjustedClose: number | null; fetchedAt?: string;
};
export type CacheReader = {
  instruments(): unknown;
  read(input: {market: "US" | "TH" | "HK" | "JP"; symbol: string}, start?: string, end?: string, limit?: number): {
    instrument: {currency: string}; total: number; truncated: boolean; bars: CacheBar[];
    qualityIssues?: {date: string; reason: string}[];
  };
};
export type CacheObservation = {
  sourceLine: number; instrumentId: string; sessionDate: string;
  status: "MATCHING_SUPPLIED_FIELDS" | "DIFFERENT_FROM_CACHE" | "ABSENT_IN_CACHE" |
    "CACHE_INSTRUMENT_NOT_FOUND" | "CACHE_QUARANTINED" | "CACHE_READ_INCOMPLETE" |
    "INVALID_OR_UNSUPPORTED_ID" | "INVALID_DATE" | "CACHE_CURRENCY_MISMATCH" | "NO_COMPARABLE_PRICE_FIELDS";
  comparedFields: string[]; differentFields: string[]; cachedFetchedAt: string | null;
};

/** CSV RFC-4180 quoting, CRLF and embedded newlines; retain physical source row numbers. */
export function parsePriceImportCsv(csv: string): HistoricalInputRow[] {
  if (new TextEncoder().encode(csv).byteLength > MAX_BYTES) throw new Error("csv_exceeds_5mib_limit");
  const source = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  const records: {line: number; cells: string[]}[] = [];
  let line = 1, recordLine = 1, cell = "", cells: string[] = [], inQuote = false, closedQuote = false, rowStarted = false;
  const finish = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0] === "" && !rowStarted)) records.push({line: recordLine, cells});
    cell = ""; cells = []; recordLine = line; rowStarted = false; closedQuote = false;
    if (records.length > MAX_ROWS + 1) throw new Error("csv_exceeds_10000_rows");
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuote) {
      if (c === '"' && source[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuote = false; closedQuote = true; }
      else { cell += c; if (c === "\n") line++; }
      continue;
    }
    if (c === '"') {
      if (cell.length || closedQuote) throw new Error(`csv_malformed_quote_line_${line}`);
      inQuote = true; rowStarted = true;
    } else if (c === ",") {
      cells.push(cell); cell = ""; closedQuote = false; rowStarted = true;
    } else if (c === "\n") {
      finish(); line++; recordLine = line;
    } else if (c === "\r" && source[i+1] === "\n") {
      i++; finish(); line++; recordLine = line;
    } else {
      if (closedQuote) throw new Error(`csv_chars_after_quote_line_${line}`);
      if (c === "\r") throw new Error(`csv_bare_cr_line_${line}`);
      cell += c; rowStarted = true;
    }
  }
  if (inQuote) throw new Error("csv_unclosed_quote");
  if (rowStarted || cells.length) finish();
  if (!records.length) throw new Error("csv_empty");
  const columns = records[0].cells.map(x => x.trim());
  if (new Set(columns).size !== columns.length || columns.some(x => !x)) throw new Error("csv_duplicate_or_empty_header");
  if (MANDATORY.some(x => !columns.includes(x))) throw new Error("csv_missing_required_column");
  if (columns.some(x => !HEADER.has(x))) throw new Error("csv_unknown_column");
  return records.slice(1).map(record => {
    if (record.cells.length !== columns.length) throw new Error(`csv_column_count_line_${record.line}`);
    const cells = Object.fromEntries(columns.map((x, i) => [x, record.cells[i]]));
    return {
      sourceLine: record.line,
      instrument_id: cells.instrument_id,
      session_date: cells.session_date,
      currency: cells.currency,
      open: cells.open, high: cells.high, low: cells.low, close: cells.close,
      volume: cells.volume, adjusted_close: cells.adjusted_close,
      adjustment_basis: cells.adjustment_basis,
      source_type: cells.source_type,
      source_file_or_uri: cells.source_file_or_uri,
      observed_at: cells.observed_at, retrieved_at: cells.retrieved_at,
    };
  });
}

function validDay(day: string): boolean {
  if (!DATE.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export function parseLegacyCacheInstrument(id: string): { market: "US" | "TH" | "HK" | "JP"; symbol: string } | null {
  const parts = id.split(":");
  if (parts.length !== 2 || !(parts[0] in MARKETS)) return null;
  const market = parts[0] as keyof typeof MARKETS;
  if (!MARKETS[market].test(parts[1])) return null;
  return {market,symbol:parts[1]};
}

function monthBounds(day: string): {start: string; end: string} {
  const month = day.slice(0, 7);
  const end = new Date(Date.UTC(+day.slice(0,4), +day.slice(5,7), 0)).toISOString().slice(0, 10);
  return {start: `${month}-01`, end};
}

/**
 * Uses the existing cache reader for ONE instrument only. Query is bounded per calendar
 * month (<=31 daily rows); even 20y of source rows never requires a 20y reader response.
 * All comparisons are observational only; no baseline completion or rights inferred.
 */
export function auditHistoricalPriceCsvAgainstCache(rows: readonly HistoricalInputRow[], reader: CacheReader, asOf: string): {
  contract: "ios-price-csv-cache-audit-v0.1.0";
  mode: "READ_ONLY_NO_APPLY";
  preview: ImportPreviewResult;
  observations: CacheObservation[];
  statusCounts: Record<string, number>;
  notes: string[];
} {
  if (rows.length > MAX_ROWS) throw new Error("csv_exceeds_10000_rows");
  const preview = previewHistoricalPriceImport(rows, {asOf}); // NO user-provided rights or completeness proof
  const candidates = new Set(rows.map(x => x.instrument_id.trim()));
  if (candidates.size > 1) throw new Error("one_instrument_per_cache_audit");
  const id = rows[0]?.instrument_id.trim() ?? "";
  const instrument = parseLegacyCacheInstrument(id);
  const listedRaw = reader.instruments();
  const listed = Array.isArray(listedRaw) ? listedRaw as {id?: string; currency?: string}[] : [];
  const declared = listed.find(x => x.id === id);
  const months = new Map<string, {bars: Map<string, CacheBar>; quarantine: Set<string>; incomplete: boolean; currency: string}>();
  if (instrument && declared) {
    const keys = [...new Set(rows.filter(x => validDay(x.session_date.trim())).map(x => x.session_date.trim().slice(0,7)))].sort();
    for (const key of keys) {
      const {start,end} = monthBounds(`${key}-01`);
      const value = reader.read(instrument,start,end,1500);
      if (value.total > 1500 || value.truncated || value.bars.length !== value.total) {
        months.set(key,{bars:new Map(),quarantine:new Set(),incomplete:true,currency:value.instrument.currency});
      } else {
        months.set(key,{bars:new Map(value.bars.map(x=>[x.date,x])),quarantine:new Set((value.qualityIssues??[]).map(x=>x.date)),incomplete:false,currency:value.instrument.currency});
      }
    }
  }
  const observations: CacheObservation[] = rows.map(row => {
    const instrumentId=row.instrument_id.trim(), sessionDate=row.session_date.trim();
    const base={sourceLine:row.sourceLine,instrumentId,sessionDate,comparedFields:[] as string[],differentFields:[] as string[],cachedFetchedAt:null as string|null};
    if (!instrument || instrumentId!==id) return {...base,status:"INVALID_OR_UNSUPPORTED_ID" as const};
    if (!validDay(sessionDate)) return {...base,status:"INVALID_DATE" as const};
    if (!declared) return {...base,status:"CACHE_INSTRUMENT_NOT_FOUND" as const};
    const month=months.get(sessionDate.slice(0,7));
    if (!month || month.incomplete) return {...base,status:"CACHE_READ_INCOMPLETE" as const};
    if (row.currency.trim().toUpperCase() !== month.currency) return {...base,status:"CACHE_CURRENCY_MISMATCH" as const};
    if (month.quarantine.has(sessionDate)) return {...base,status:"CACHE_QUARANTINED" as const};
    const cached=month.bars.get(sessionDate);
    if (!cached) return {...base,status:"ABSENT_IN_CACHE" as const};
    const comparable: Record<typeof NUMERIC[number], number|null> = {
      open:cached.open,high:cached.high,low:cached.low,close:cached.close,volume:cached.volume,adjusted_close:cached.adjustedClose,
    };
    const comparedFields: string[] = [], differentFields: string[] = [];
    for (const field of NUMERIC) {
      const supplied = row[field]?.trim();
      if (supplied == null || supplied === "") continue;
      comparedFields.push(field);
      const number = Number(supplied);
      if (!/^\+?\d+(?:\.\d+)?$/.test(supplied) || !Number.isFinite(number) || comparable[field] == null || number !== comparable[field]) differentFields.push(field);
    }
    return {...base, comparedFields,differentFields,cachedFetchedAt:cached.fetchedAt??null,
      status:!comparedFields.length ? "NO_COMPARABLE_PRICE_FIELDS" as const : differentFields.length ? "DIFFERENT_FROM_CACHE" as const : "MATCHING_SUPPLIED_FIELDS" as const};
  });
  const statusCounts:Record<string,number>={};
  for(const x of observations) statusCounts[x.status]=(statusCounts[x.status]??0)+1;
  return {contract:"ios-price-csv-cache-audit-v0.1.0",mode:"READ_ONLY_NO_APPLY",preview,observations,statusCounts,notes:[
    "No DB writes, collector updates, provider calls or source/rights approvals occurred.",
    "MATCHING_SUPPLIED_FIELDS compares numeric fields only. It does not verify source, rights, adjusted basis, or Point-in-Time validity.",
    "The import preview retains HOLD without independent mapping, storage rights, and a complete baseline. No rows have been imported.",
    "Missing from the cache does not prove that an exchange session, entitlement, or historical row exists.",
  ]};
}

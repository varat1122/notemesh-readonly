import { describe, it, expect } from "vitest";
import { auditHistoricalPriceCsvAgainstCache, parsePriceImportCsv, type CacheReader } from "./import-cache-audit";
import type { HistoricalInputRow } from "./import-preview";

const header = "dataset_id,instrument_id,provider_symbol,source_type,venue,currency,session_date,open,high,low,close,volume,adjusted_close,adjustment_basis,source_file_or_uri,observed_at,retrieved_at,data_vintage,row_status";
const data = "sample,US:NVDA,NVDA,owner_excel,NASDAQ,USD,2026-11-13,10,12,9,11,100,11,RAW,fixture://nvda,2026-11-13T21:00:00Z,2026-11-16T06:00:00Z,2026-11-16,RAW";
const csv = [header,data].join("\r\n")+"\r\n";
const base: HistoricalInputRow = {sourceLine:2,instrument_id:"US:NVDA",session_date:"2026-11-13",currency:"USD",open:"10",high:"12",low:"9",close:"11",volume:"100",adjusted_close:"11",adjustment_basis:"RAW",source_type:"owner_excel",source_file_or_uri:"fixture://nvda"};
function reader(overrides: {listed?:boolean; close?:number; currency?:string; quarantined?:boolean; truncated?:boolean}={}): CacheReader {
  return {
    instruments: () => overrides.listed===false ? [] : [{id:"US:NVDA",currency:"USD"}],
    read: (_input,start,end,limit) => {
      if (!start || !end || limit!==1500) throw new Error("unexpected_reader_contract");
      return {instrument:{currency:overrides.currency??"USD"},total:overrides.truncated ? 1501:1,truncated:!!overrides.truncated,
        bars:[{date:"2026-11-13",open:10,high:12,low:9,close:overrides.close??11,volume:100,adjustedClose:11,fetchedAt:"2026-11-16T06:00:00Z"}],
        qualityIssues:overrides.quarantined ? [{date:"2026-11-13",reason:"invalid_provider_bar"}]:[]};
    },
  };
}
const audit = (rows:HistoricalInputRow[],r:CacheReader=reader()) => auditHistoricalPriceCsvAgainstCache(rows,r,"2026-11-17");

describe("Historical CSV audit: native PriceStore Reader, NO APPLY",()=>{
  it("parses owner import template columns, CRLF, and preserves physical source lines",()=>{
    const rows=parsePriceImportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({sourceLine:2,instrument_id:"US:NVDA",session_date:"2026-11-13",close:"11",volume:"100",adjustment_basis:"RAW"});
  });
  it("handles quoted CSV field commas and escaped double quotes",()=>{
    const rows=parsePriceImportCsv(csv.replace("fixture://nvda",'"a, ""quoted"" source"'));
    expect(rows[0].source_file_or_uri).toBe('a, "quoted" source');
  });
  it("allows UTF8 BOM and quoted multiline fields with correct source lines",()=>{
    const rows=parsePriceImportCsv("\uFEFF"+csv.replace("fixture://nvda",'"source\nline"')+data.replace("sample,","sample2,")+"\n");
    expect(rows[0].source_file_or_uri).toBe("source\nline");
    expect(rows[1].sourceLine).toBe(4);
  });
  it("holds an owner Excel row even when numeric fields match cache",()=>{
    const result=audit([base]);
    expect(result.mode).toBe("READ_ONLY_NO_APPLY");
    expect(result.observations[0]).toMatchObject({status:"MATCHING_SUPPLIED_FIELDS",cachedFetchedAt:"2026-11-16T06:00:00Z"});
    expect(result.preview.rows[0].action).toBe("HOLD");
    expect(result.preview.rows[0].reasons).toContain("legacy_store_source_provenance_incompatible");
    expect(result.preview.rows[0].reasons).toContain("mapping_not_approved");
  });
  it("reports exact numeric differences without deciding overwrite",()=>{
    const result=audit([{...base,close:"11.01"}]);
    expect(result.observations[0]).toMatchObject({status:"DIFFERENT_FROM_CACHE",differentFields:["close"]});
    expect(result.preview.rows[0].action).toBe("HOLD");
  });
  it("does not equate a rounded provider float with a different exact number",()=>{
    const result=audit([base],reader({close:11.00000001}));
    expect(result.observations[0].differentFields).toEqual(["close"]);
  });
  it("isolates Yahoo float32 representation from genuine price conflicts",()=>{
    const row = {...base, close:"162.85", adjusted_close:"162.85", open:"", high:"", low:"", volume:""};
    const r=reader();
    r.read=()=>({instrument:{currency:"USD"},total:1,truncated:false,bars:[{
      date:"2026-11-13",open:Math.fround(169.91),high:170,low:Math.fround(158.39),
      close:Math.fround(162.85),volume:363819700,adjustedClose:Math.fround(162.85),
      fetchedAt:"2026-11-16T06:00:21.520Z"}],qualityIssues:[]});
    const report=audit([row],r);
    expect(report.observations[0]).toMatchObject({status:"PRECISION_LIMITED_MATCH_CANDIDATE",differentFields:[],
      precisionLimitedFields:["close","adjusted_close"]});
    expect(report.preview.rows[0].action).toBe("HOLD");
    expect(audit([{...row,close:"162.84"}],r).observations[0]).toMatchObject({
      status:"DIFFERENT_FROM_CACHE",differentFields:["close"]});
    // The supplied source asserts eight decimal places, so the rounded float32
    // cannot silently pass as a displayed-precision match.
    expect(audit([{...row,close:"162.85000000"}],r).observations[0]).toMatchObject({
      status:"DIFFERENT_FROM_CACHE",differentFields:["close"]});
  });
  it("preserves missing O/H/L/Volume from the newer PriceStore close-only schema",()=>{
    const r=reader();
    r.read=()=>({instrument:{currency:"USD"},total:1,truncated:false,bars:[{
      date:"2026-11-13",open:null,high:null,low:null,close:11,volume:null,adjustedClose:null,
      fetchedAt:"2026-11-16T06:00:00Z"}],qualityIssues:[]});
    const full=audit([base],r);
    expect(full.observations[0]).toMatchObject({status:"CACHE_FIELD_NOT_AVAILABLE",
      missingCachedFields:["open","high","low","volume","adjusted_close"],differentFields:[]});
    const closeOnly=audit([{...base,open:"",high:"",low:"",volume:"",adjusted_close:""}],r);
    expect(closeOnly.observations[0]).toMatchObject({status:"MATCHING_SUPPLIED_FIELDS",comparedFields:["close"],
      missingCachedFields:[]});
    expect(closeOnly.preview.rows[0].action).toBe("HOLD");
  });
  it("marks close-only rows as partial numeric observation, but holds import",()=>{
    const row={...base,open:"",high:"",low:"",volume:""};
    const result=audit([row]);
    expect(result.observations[0]).toMatchObject({status:"MATCHING_SUPPLIED_FIELDS",comparedFields:["close","adjusted_close"]});
    expect(result.preview.rows[0].reasons).toContain("close_only_requires_new_schema");
  });
  it("reports missing history without synthesizing an empty baseline",()=>{
    const result=audit([{...base,session_date:"2026-11-12"}]);
    expect(result.observations[0].status).toBe("ABSENT_IN_CACHE");
    expect(result.preview.rows[0].action).toBe("HOLD");
  });
  it("does not read a missing instrument and reports it distinctly",()=>{
    const r=reader({listed:false});
    r.read=()=>{throw new Error("must_not_read_missing_instrument");};
    expect(audit([base],r).observations[0].status).toBe("CACHE_INSTRUMENT_NOT_FOUND");
  });
  it("holds market identity outside the existing V1 reader",()=>{
    const result=audit([{...base,instrument_id:"DR:AAPL80"}],reader());
    expect(result.observations[0].status).toBe("INVALID_OR_UNSUPPORTED_ID");
    expect(result.preview.rows[0].reasons).toContain("legacy_market_schema_unavailable");
  });
  it("rejects invalid dates and does not query cache",()=>{
    const r=reader();r.read=()=>{throw new Error("must_not_read_invalid_date");};
    expect(audit([{...base,session_date:"2026-02-30"}],r).observations[0].status).toBe("INVALID_DATE");
  });
  it("never claims unverified currency equivalence",()=>{
    expect(audit([{...base,currency:"JPY"}]).observations[0].status).toBe("CACHE_CURRENCY_MISMATCH");
  });
  it("quarantined source rows cannot be treated as cache matches",()=>{
    expect(audit([base],reader({quarantined:true})).observations[0].status).toBe("CACHE_QUARANTINED");
  });
  it("refuses truncated month reads rather than treating missing rows as absent",()=>{
    expect(audit([base],reader({truncated:true})).observations[0].status).toBe("CACHE_READ_INCOMPLETE");
  });
  it("uses per-calendar-month bounded queries across years, not one huge historical slice",()=>{
    const rows=[{...base,session_date:"2010-01-04"},{...base,sourceLine:3}];
    const months:string[]=[];
    const r=reader();const original=r.read;
    r.read=(input,start,end,limit)=>{months.push(`${start}/${end}`);return original(input,start,end,limit);};
    audit(rows,r);
    expect(months).toEqual(["2010-01-01/2010-01-31","2026-11-01/2026-11-30"]);
  });
  it("rejects multiple instruments in one bounded run",()=>{
    expect(()=>audit([base,{...base,sourceLine:3,instrument_id:"US:SPY"}])).toThrow("one_instrument_per_cache_audit");
  });
  it("rejects malformed CSV quotations",()=>{
    expect(()=>parsePriceImportCsv(csv.replace("fixture://nvda",'"unclosed'))).toThrow("csv_unclosed_quote");
  });
  it("rejects duplicate/unknown/missing required headers",()=>{
    expect(()=>parsePriceImportCsv(csv.replace("dataset_id,instrument_id", "instrument_id,instrument_id"))).toThrow("csv_duplicate_or_empty_header");
    expect(()=>parsePriceImportCsv(csv.replace("dataset_id", "unsafe"))).toThrow("csv_unknown_column");
    expect(()=>parsePriceImportCsv(csv.replace("instrument_id", "not_in_schema"))).toThrow("csv_missing_required_column");
  });
  it("rejects malformed row length instead of treating it as correct",()=>{
    expect(()=>parsePriceImportCsv(csv+"short,data\n")).toThrow("csv_column_count_line_3");
  });
  it("checks cap before allocating huge source row array",()=>{
    expect(()=>parsePriceImportCsv("x".repeat(5*1024*1024+1))).toThrow("csv_exceeds_5mib_limit");
  });
});

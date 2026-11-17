/** Read-only CLI for Owner-supplied historical CSV versus existing IOS PriceStore cache. */
import fs from "node:fs";
import { readCachedPrices } from "../src/server/market-prices/backend.ts";
import { auditHistoricalPriceCsvAgainstCache, parsePriceImportCsv, parseLegacyCacheInstrument } from "../src/server/market-prices/import-cache-audit.ts";

const args = process.argv.slice(2);
const file = args[0];
const asOfArgument = args.find(x => x.startsWith("--as-of="));
const asOf = asOfArgument?.slice("--as-of=".length) ?? new Date().toISOString().slice(0,10);
try {
  if (!file || args.some(x => x.startsWith("-") && !x.startsWith("--as-of="))) throw new Error("usage: pnpm prices:import-audit <price-history.csv> [--as-of=YYYY-MM-DD]");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw new Error("csv_file_not_regular_or_too_large");
  const csv = fs.readFileSync(file,"utf8");
  const rows = parsePriceImportCsv(csv);
  if (!rows.length) throw new Error("csv_no_data_rows");
  const ids = [...new Set(rows.map(x=>x.instrument_id.trim()))];
  if (ids.length !== 1) throw new Error("one_instrument_per_cache_audit");
  const requestedInstrument = parseLegacyCacheInstrument(ids[0]);
  const requested = requestedInstrument ? [requestedInstrument] : [];
  const output = await readCachedPrices(reader => auditHistoricalPriceCsvAgainstCache(rows,reader,asOf),requested);
  if (output && typeof output === "object" && "available" in output && output.available === false) {
    console.log(JSON.stringify({mode:"READ_ONLY_NO_APPLY",status:"CACHE_NOT_INITIALIZED",inputRows:rows.length,reason:output.reason},null,2));
    process.exitCode=2;
  } else {
    console.log(JSON.stringify(output,null,2));
  }
} catch(error) {
  console.error(error instanceof Error ? error.message : "csv_import_audit_failed");
  process.exitCode=1;
}

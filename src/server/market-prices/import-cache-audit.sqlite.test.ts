/**
 * End-to-end PREVIEW ONLY proof using the real local PriceStore SQLite reader.
 * Every byte is synthetic; no market provider, production path or import writer.
 * A parser/reader PASS is NOT source entitlement, D1 approval or write admission.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readCachedPrices } from "./backend.ts";
import { auditHistoricalPriceCsvAgainstCache, parsePriceImportCsv } from "./import-cache-audit.ts";
import { PriceStore, priceDbPath } from "./store.ts";
import { parseYahooChart } from "./yahoo.ts";
import { chartFixture, TEST_NOW } from "./fixtures.ts";

const listing = { market: "US", symbol: "NVDA" } as const;
const HEADER = [
  "dataset_id", "instrument_id", "provider_symbol", "source_type", "venue", "currency",
  "session_date", "open", "high", "low", "close", "volume", "adjusted_close",
  "adjustment_basis", "source_file_or_uri", "observed_at", "retrieved_at", "data_vintage", "row_status",
].join(",");
const row = (date: string, close = "11", fields = "10,12,9") =>
  ["synthetic-readonly", "US:NVDA", "NVDA", "owner_excel", "XNAS", "USD", date,
    ...fields.split(","), close, "100", "10.5", "RAW", "fixture://synthetic-owner",
    "2026-10-15T21:00:00Z", "2026-10-16T06:20:00Z", "2026-10-16", "RAW"].join(",");
const csv = (...data: string[]) => [HEADER, ...data].join("\r\n") + "\r\n";
const hash = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-price-native-audit-"));
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv("MARKET_PRICES_STORAGE", "disk");
  vi.stubEnv("MARKET_PRICES_MAX_DB_MB", "4");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function seedSyntheticPriceStore(): string {
  const filename = priceDbPath();
  const writer = new PriceStore(filename, true);
  try {
    const result = writer.save(parseYahooChart(chartFixture(listing), listing, TEST_NOW));
    expect(result.inserted).toBe(2); // 14 and 15 Oct; 16 Oct incomplete current exchange session
  } finally { writer.close(); }
  return filename;
}

/** Output is only a comparison: all owner-import decisions must remain HOLD. */
describe("Historical CSV vs real SQLite PriceStore Reader (disposable, NO APPLY)", () => {
  it("reads two existing bars through the native cache interface and does not change DB bytes", async () => {
    const filename = seedSyntheticPriceStore();
    const before = hash(fs.readFileSync(filename));
    const rows = parsePriceImportCsv(csv(row("2026-10-14"), row("2026-10-13")));
    const result = await readCachedPrices(reader => auditHistoricalPriceCsvAgainstCache(rows, reader, "2026-10-16"), [listing]) as ReturnType<typeof auditHistoricalPriceCsvAgainstCache>;
    expect(result).toMatchObject({ mode: "READ_ONLY_NO_APPLY", statusCounts: {
      MATCHING_SUPPLIED_FIELDS: 1, ABSENT_IN_CACHE: 1,
    } });
    expect(result.preview.rows.every(x => x.action === "HOLD")).toBe(true);
    expect(result.observations[0]).toMatchObject({ sourceLine: 2, status: "MATCHING_SUPPLIED_FIELDS" });
    expect(result.observations[1]).toMatchObject({ sourceLine: 3, status: "ABSENT_IN_CACHE" });
    expect(hash(fs.readFileSync(filename))).toBe(before);
  });

  it("runs the published owner CSV CLI end-to-end against a disposable SQLite DB", () => {
    const filename = seedSyntheticPriceStore();
    const before = hash(fs.readFileSync(filename));
    const csvPath = path.join(root, "owner-synthetic.csv");
    fs.writeFileSync(csvPath, csv(row("2026-10-14")), { mode: 0o600 });
    const child = spawnSync(process.execPath, ["scripts/prices-import-audit.ts", csvPath, "--as-of=2026-10-16"], {
      cwd: process.cwd(), env: { ...process.env, DATA_DIR: root, MARKET_PRICES_STORAGE: "disk" },
      encoding: "utf8", timeout: 25_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    const result = JSON.parse(child.stdout) as { mode: string; preview: {rows: {action:string}[]}; observations: {status:string}[] };
    expect(result.mode).toBe("READ_ONLY_NO_APPLY");
    expect(result.preview.rows.map(x => x.action)).toEqual(["HOLD"]);
    expect(result.observations.map(x => x.status)).toEqual(["MATCHING_SUPPLIED_FIELDS"]);
    expect(hash(fs.readFileSync(filename))).toBe(before);
    expect(fs.existsSync(path.join(root,"vault"))).toBe(false);
  });

  it("distinguishes genuinely different close values from an exact native cache match", async () => {
    const filename = seedSyntheticPriceStore();
    const before = hash(fs.readFileSync(filename));
    const rows = parsePriceImportCsv(csv(row("2026-10-14", "11.5")));
    const result = await readCachedPrices(reader => auditHistoricalPriceCsvAgainstCache(rows, reader, "2026-10-16"), [listing]);
    expect(result).toMatchObject({ mode: "READ_ONLY_NO_APPLY", observations: [{
      status: "DIFFERENT_FROM_CACHE", differentFields: ["close"],
    }] });
    expect(hash(fs.readFileSync(filename))).toBe(before);
  });

  it("honors a real SQLite quarantine record rather than treating a missing bar as clean", async () => {
    const filename = priceDbPath();
    const writer = new PriceStore(filename, true);
    try {
      writer.save(parseYahooChart(chartFixture(listing), listing, TEST_NOW));
      const bad = parseYahooChart(chartFixture(listing), listing, TEST_NOW);
      const removed = bad.bars.shift()!;
      bad.quarantinedBars.push({ date: removed.date, reason: "invalid_provider_bar", values: {
        open: 10, high: 9, low: 8, close: 11, volume: 100,
      } });
      writer.save(bad);
    } finally { writer.close(); }
    const before = hash(fs.readFileSync(filename));
    const rows = parsePriceImportCsv(csv(row("2026-10-14")));
    const report = await readCachedPrices(reader => auditHistoricalPriceCsvAgainstCache(rows, reader, "2026-10-16"), [listing]) as
      ReturnType<typeof auditHistoricalPriceCsvAgainstCache>;
    expect(report.observations[0].status).toBe("CACHE_QUARANTINED");
    expect(report.preview.rows[0].action).toBe("HOLD");
    expect(hash(fs.readFileSync(filename))).toBe(before);
  });

  it("does not initialize a missing database, even when invoked via the CLI", () => {
    const filename = priceDbPath();
    const csvPath = path.join(root,"no-cache.csv");
    fs.writeFileSync(csvPath, csv(row("2026-10-14")), {mode:0o600});
    const child = spawnSync(process.execPath, ["scripts/prices-import-audit.ts", csvPath, "--as-of=2026-10-16"], {
      cwd: process.cwd(), env:{...process.env, DATA_DIR:root, MARKET_PRICES_STORAGE:"disk"},
      encoding:"utf8", timeout:25_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({mode:"READ_ONLY_NO_APPLY",status:"CACHE_NOT_INITIALIZED"});
    expect(fs.existsSync(filename)).toBe(false);
  });
});

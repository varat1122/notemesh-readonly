import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PriceStore } from "./store";
import { instrument, type InstrumentInput, type PriceBar } from "./model";
import { TEST_NOW, chartFixture } from "./fixtures";
import { fetchYahooDaily } from "./yahoo";
import { buildLocalPriceSnapshot, exportLocalPriceSnapshot, queryLocalPriceSnapshot, readLocalPriceExport, verifyLocalPriceExport } from "./local-snapshot";

let root: string, database: string;
const nvda = { market: "US", symbol: "NVDA" } as const, japan = { market: "JP", symbol: "1306" } as const;
const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const dates: string[] = [];
for (const d = new Date("2026-10-15T12:00:00Z"); dates.length < 62; d.setUTCDate(d.getUTCDate() - 1)) if (![0, 6].includes(d.getUTCDay())) dates.unshift(d.toISOString().slice(0, 10));
const bars: PriceBar[] = dates.map((date, n) => ({ date, open: 99 + n, high: 102 + n, low: 98 + n, close: 100 + n, volume: 1000 + n, adjustedClose: 100 + n }));
function seed(inputs: InstrumentInput[] = [nvda, japan]) {
  const store = new PriceStore(database, true);
  try { for (const input of inputs) store.save({ instrument: instrument(input), source: "yahoo-chart", dataOrigin: "synthetic_fixture",
    fetchedAt: TEST_NOW.toISOString(), bars, actions: [], missingBars: 0, quarantinedBars: [], excludedCurrentSession: 0 }); }
  finally { store.close(); }
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "local-price-snapshot-")); database = path.join(root, "prices.sqlite");
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("MARKET_PRICES_PROFILE", "");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("snapshot_network_forbidden")); seed();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it("separates stored facts, quality and explicit price-return arithmetic without issuer/FX inference", () => {
  const store = new PriceStore(database);
  try {
    const snapshot = buildLocalPriceSnapshot(store, nvda, TEST_NOW), result = queryLocalPriceSnapshot(snapshot);
    expect(snapshot.identity).toMatchObject({ ticker: "NVDA", exchange: null, currency: "USD", timezone: "America/New_York", source_symbol: "NVDA" });
    expect(snapshot.provenance.data_origin).toBe("synthetic_fixture");
    expect(result.canonicalListingId).toBeNull(); expect(result.raw_facts).toHaveLength(20);
    expect(result.latest_session).toBe("2026-10-15"); expect(result.quality_flags.flags).toEqual([]);
    expect(result.derived_values.returns.map(r => r.status)).toEqual(["CALCULATED", "CALCULATED", "CALCULATED"]);
    expect(result.derived_values.returns[0].value_pct).toBeCloseTo(0.625);
    expect(result.derived_values.returns[1].value_pct).toBeCloseTo(3.205128205);
    expect(result.derived_values.returns[2].value_pct).toBeCloseTo(15);
    expect(result.derived_values.extrema).toMatchObject({ min_close: 142, max_close: 161, min_low: 140, max_high: 163 });
    expect(buildLocalPriceSnapshot(store, japan, TEST_NOW).identity).toMatchObject({ ticker: "1306", exchange: null, currency: "JPY", timezone: "Asia/Tokyo", source_symbol: "1306.T" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally { store.close(); }
});

it("publishes an immutable reproducible generation, reads one listing and reopens the exact SQLite backup", () => {
  const before = hash(database), result = exportLocalPriceSnapshot(database, root, TEST_NOW);
  expect(result.status).toBe("PUBLISHED_LOCAL_ONLY");
  expect(result.generation).toContain("Market_Data/2026/10/16/"); expect(hash(database)).toBe(before);
  expect(verifyLocalPriceExport(result.generation).files).toHaveLength(3);
  expect(exportLocalPriceSnapshot(database, root, TEST_NOW)).toMatchObject({ status: "REPLAY_NO_CHANGE", generationId: result.generationId });
  const read = vi.spyOn(fs, "readFileSync");
  const view = readLocalPriceExport(result.generation, nvda, { start: "2026-10-01", end: "2026-10-15", limit: 20 });
  expect(view.raw_facts).toHaveLength(11);
  expect(read.mock.calls.map(c => String(c[0]))).toEqual([path.join(result.generation, "manifest.json"), path.join(result.generation, "US_NVDA.json")]);
  read.mockRestore();
  const reopened = new PriceStore(path.join(result.generation, "prices.sqlite"));
  try { expect(reopened.read(nvda).total).toBe(62); expect(reopened.db.pragma("quick_check", { simple: true })).toBe("ok"); }
  finally { reopened.close(); }
});

it.each(["source_failure", "stale", "missing_session", "quarantine"])("holds derived values for %s while preserving the observed prices", reason => {
  const store = new PriceStore(database, true);
  try {
    if (reason === "source_failure") store.failure(nvda, "provider_unavailable", TEST_NOW);
    if (reason === "missing_session") store.db.prepare("DELETE FROM bars WHERE instrument_id=? AND date=?").run("US:NVDA", dates[55]);
    if (reason === "quarantine") store.db.prepare("INSERT INTO quality_issues VALUES (?,?,?,?,?,?,NULL)").run("US:NVDA", dates[55], "invalid_provider_bar", "{}", TEST_NOW.toISOString(), TEST_NOW.toISOString());
    const asOf = reason === "stale" ? new Date("2026-10-20T06:30:00Z") : TEST_NOW;
    const snapshot = buildLocalPriceSnapshot(store, nvda, asOf), result = queryLocalPriceSnapshot(snapshot);
    expect(result.quality_flags.flags.length).toBeGreaterThan(0);
    expect(result.derived_values.returns.every(r => r.status === "QUALITY_HOLD" && r.value_pct === null)).toBe(true);
    expect(result.derived_values.extrema).toBeNull(); expect(result.raw_facts.at(-1)?.close).toBe(161);
    expect(store.read(nvda).bars.at(-1)?.close).toBe(161);
  } finally { store.close(); }
});

it("refuses to calculate across a split using an assumed ratio", () => {
  const store = new PriceStore(database, true);
  try {
    store.db.prepare("INSERT INTO actions VALUES (?,?,?,?,?,?,?)").run("US:NVDA", "split:test", dates.at(-1), "split", 2, 1, TEST_NOW.toISOString());
    const result = queryLocalPriceSnapshot(buildLocalPriceSnapshot(store, nvda, TEST_NOW));
    expect(result.derived_values.returns.every(r => r.status === "CORPORATE_ACTION_HOLD" && r.value_pct === null)).toBe(true);
  } finally { store.close(); }
});

it("keeps old quality history visible without blocking a clean exported window", () => {
  const store = new PriceStore(database, true);
  try {
    store.db.prepare("INSERT INTO quality_issues VALUES (?,?,?,?,?,?,NULL)").run("US:NVDA", "2024-01-01", "invalid_provider_bar", "{}", TEST_NOW.toISOString(), TEST_NOW.toISOString());
    const result = queryLocalPriceSnapshot(buildLocalPriceSnapshot(store, nvda, TEST_NOW));
    expect(result.derived_values.returns.every(r => r.status === "CALCULATED")).toBe(true);
    expect(result.quality_flags).toMatchObject({ total_source_issue_count: 1, export_window_issue_count: 0 });
  } finally { store.close(); }
});

it("does not lose a recent split behind the store consumer's historical action limit", () => {
  const store = new PriceStore(database, true);
  try {
    const insert = store.db.prepare("INSERT INTO actions VALUES (?,?,?,?,?,?,?)");
    for (let n = 0; n < 201; n++) insert.run("US:NVDA", `old:${n}`, "2024-01-01", "dividend", 1, null, TEST_NOW.toISOString());
    insert.run("US:NVDA", "new:split", dates.at(-1), "split", 2, 1, TEST_NOW.toISOString());
    const result = queryLocalPriceSnapshot(buildLocalPriceSnapshot(store, nvda, TEST_NOW));
    expect(result.derived_values.returns.every(r => r.status === "CORPORATE_ACTION_HOLD")).toBe(true);
  } finally { store.close(); }
});

it("rejects tampering and manifest replacement before returning prices", () => {
  const result = exportLocalPriceSnapshot(database, root, TEST_NOW), file = path.join(result.generation, "US_NVDA.json");
  const bytes = fs.readFileSync(file); bytes[100] ^= 1; fs.writeFileSync(file, bytes);
  expect(() => readLocalPriceExport(result.generation, nvda)).toThrow("snapshot_file_checksum_mismatch");
  fs.writeFileSync(path.join(result.generation, "manifest.json"), "{}");
  expect(() => readLocalPriceExport(result.generation, nvda)).toThrow("snapshot_manifest_checksum_mismatch");
});

it("never serializes a non-finite stored price as a fabricated JSON null", () => {
  const store = new PriceStore(database, true);
  try {
    store.db.prepare("UPDATE bars SET open=9e999,high=9e999,low=9e999,close=9e999 WHERE instrument_id=? AND date=?").run("US:NVDA", dates.at(-1));
    expect(() => buildLocalPriceSnapshot(store, nvda, TEST_NOW)).toThrow("snapshot_nonfinite_stored_value");
  } finally { store.close(); }
  expect(() => exportLocalPriceSnapshot(database, root, TEST_NOW)).toThrow("snapshot_nonfinite_stored_value");
  expect(fs.existsSync(path.join(root, "Market_Data"))).toBe(false);
});

it("ignores interrupted staging, preserves the prior generation and safely regenerates after restart", () => {
  const old = exportLocalPriceSnapshot(database, root, TEST_NOW);
  const nextTime = new Date("2026-10-16T07:30:00Z"), rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw Error("simulated_process_interruption"); });
  expect(() => exportLocalPriceSnapshot(database, root, nextTime)).toThrow("simulated_process_interruption"); rename.mockRestore();
  const pending = fs.readdirSync(path.dirname(old.generation)).find(f => f.startsWith(".pending-"))!;
  expect(() => readLocalPriceExport(path.join(path.dirname(old.generation), pending), nvda)).toThrow("unpublished_snapshot_generation");
  expect(readLocalPriceExport(old.generation, nvda).latest_session).toBe("2026-10-15");
  const recovered = exportLocalPriceSnapshot(database, root, nextTime);
  expect(recovered.status).toBe("PUBLISHED_LOCAL_ONLY"); expect(verifyLocalPriceExport(recovered.generation).files).toHaveLength(3);
});

it("recovers a real interrupted SQLite transaction without damaging historical prices", () => {
  const code = `import {PriceStore} from './src/server/market-prices/store.ts'; const s=new PriceStore(${JSON.stringify(database)},true); s.db.exec("BEGIN IMMEDIATE; UPDATE bars SET close=high;"); process.kill(process.pid,'SIGKILL');`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: root }, encoding: "utf8", timeout: 10000 });
  expect(child.signal).toBe("SIGKILL");
  const recovered = new PriceStore(database, true);
  try { expect(recovered.read(nvda).bars.at(-1)?.close).toBe(161); expect(recovered.read(nvda).total).toBe(62); expect(recovered.db.pragma("quick_check", { simple: true })).toBe("ok"); }
  finally { recovered.close(); }
  expect(exportLocalPriceSnapshot(database, root, TEST_NOW).status).toBe("PUBLISHED_LOCAL_ONLY");
});

it("requires an explicit valid export window and refuses unsupported universe size", () => {
  const store = new PriceStore(database);
  try {
    expect(() => buildLocalPriceSnapshot(store, nvda, new Date("2026-10-01"))).toThrow("snapshot_as_of_precedes_observation");
    expect(() => buildLocalPriceSnapshot(store, nvda, TEST_NOW, 10000)).toThrow("invalid_snapshot_window");
  } finally { store.close(); }
  seed(Array.from({ length: 19 }, (_, n) => ({ market: "US" as const, symbol: `EXTRA${n}` })));
  expect(() => exportLocalPriceSnapshot(database, root, TEST_NOW)).toThrow("snapshot_requires_one_to_twenty_listings");
});

it("runs the actual CLI export on an isolated SQLite copy without enabling collection", () => {
  const child = spawnSync(process.execPath, ["scripts/market-prices.ts", "snapshot", "--database", database, "--output", root, "--as-of", TEST_NOW.toISOString()],
    { cwd: process.cwd(), env: { ...process.env, DATA_DIR: root, MARKET_PRICES_ENABLED: "0" }, encoding: "utf8", timeout: 10000 });
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout);
  expect(readLocalPriceExport(result.generation, nvda).raw_facts).toHaveLength(20);
});

it("reads the legacy schema without migrating it or manufacturing missing identity metadata", () => {
  const writer = new PriceStore(database, true);
  writer.db.exec("DROP TABLE partial_bars; DROP TABLE series_metadata"); writer.close();
  const before = hash(database), exported = exportLocalPriceSnapshot(database, root, TEST_NOW);
  const read = readLocalPriceExport(exported.generation, nvda);
  expect(read.coverage).toMatchObject({ database_rows: 62, exported_rows: 62 });
  expect(read.identity).toMatchObject({ exchange: null, status: "database_declaration_not_independently_verified" });
  expect(read.provenance.data_origin).toBe("UNKNOWN"); expect(hash(database)).toBe(before);
  const source = new PriceStore(database);
  try { expect(source.db.prepare("SELECT 1 FROM sqlite_master WHERE name='partial_bars'").get()).toBeUndefined(); }
  finally { source.close(); }
});

it("refuses a symlinked output ancestor before creating any directory through it", () => {
  const outside = path.join(root, "outside"); fs.mkdirSync(outside);
  const link = path.join(root, "linked"); fs.symlinkSync(outside, link);
  expect(() => exportLocalPriceSnapshot(database, path.join(link, "new"), TEST_NOW)).toThrow("unsafe_snapshot_output_directory");
  expect(fs.readdirSync(outside)).toEqual([]);
});

it("binds observed exchange metadata to the requested listing and refresh without claiming canonical registry verification", async () => {
  vi.stubEnv("MARKET_PRICES_PROFILE", "listing-local-bounded-v1");
  const raw = chartFixture(nvda); raw.chart.result[0].meta.exchangeName = "MOCK_VENUE";
  const response = JSON.stringify(raw), source = await fetchYahooDaily(nvda, { now: TEST_NOW, fetcher: async () => new Response(response) });
  source.dataOrigin = "synthetic_fixture";
  const file = path.join(root, "observed.sqlite"), writer = new PriceStore(file, true); writer.save(source); writer.close();
  const receipt = path.join(root, "provider-receipt.json");
  fs.writeFileSync(receipt, JSON.stringify({ results: [{ instrumentId: "US:NVDA", providerIdentity: source.providerIdentity }] }));
  const exported = exportLocalPriceSnapshot(file, root, TEST_NOW, 62, receipt), read = readLocalPriceExport(exported.generation, nvda);
  expect(verifyLocalPriceExport(exported.generation).files.map(f => f.name)).toContain("provider-receipt.json");
  expect(read.identity).toMatchObject({ exchange: "MOCK_VENUE", exchange_namespace: "yahoo_exchangeName", status: "provider_metadata_observed_not_registry_verified",
    observation_receipt_sha256: hash(receipt), source_response_sha256: crypto.createHash("sha256").update(response).digest("hex") });
  expect(read.canonicalListingId).toBeNull(); expect(read.raw_facts.every(b => b.exchange === "MOCK_VENUE")).toBe(true);
  for (const changed of [{ currency: "GBP" }, { sourceSymbol: "WRONG" }, { observedAt: "2025-01-01T00:00:00.000Z" }, { sourceUrl: "https://unrelated.example/chart/NVDA" }]) {
    fs.writeFileSync(receipt, JSON.stringify({ results: [{ instrumentId: "US:NVDA", providerIdentity: { ...source.providerIdentity, ...changed } }] }));
    expect(() => exportLocalPriceSnapshot(file, root, TEST_NOW, 62, receipt)).toThrow("snapshot_observation_binding_mismatch");
  }
});

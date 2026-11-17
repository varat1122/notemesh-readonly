import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPriceTools } from "../mcp/price-tools.ts";
import { inProcessDrWriterFence as fence } from "../backup/writer-fence.ts";
import { PriceStore } from "./store.ts";
import { historyHash, SYNTHETIC_HISTORY_REF, type HistoryImportOptions } from "./history-import.ts";
import { PILOT_INSTRUMENTS, BENCHMARKS, instrument } from "./model.ts";
import { parseYahooChart } from "./yahoo.ts";
import { chartFixture, TEST_NOW } from "./fixtures.ts";
import { REVIEWED_PILOT } from "./universe.ts";
import { analyzePriceEvent } from "./event-analysis.ts";

// Reuse the frozen W05 prices and captured time; adapt only its documented CSV headers.
// owner_csv describes the import transport, while dataOrigin remains synthetic_fixture.
const fixture = fs.readFileSync("tests/fixtures/market-prices-w05/W05_GOOD_SYNTHETIC.csv", "utf8");
const [header, ...lines] = fixture.trim().split(/\r?\n/).map(line => line.split(","));
const originals = lines.map(values => Object.fromEntries(header.map((key, i) => [key, values[i]])));
const COLUMNS = ["instrument_id", "currency", "session_date", "open", "high", "low", "close", "volume", "adjusted_close", "adjustment_basis", "source_type", "source_file_or_uri", "observed_at", "retrieved_at"];
const adapted = originals.map(r => ({ instrument_id: `${r.market}:${r.symbol}`, currency: r.currency,
  session_date: r.session_date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
  adjusted_close: r.adjusted_close, adjustment_basis: "RAW", source_type: "owner_csv",
  source_file_or_uri: SYNTHETIC_HISTORY_REF, observed_at: r.source_captured_at, retrieved_at: "" } as Record<string, string>));
const csv = (rows = adapted) => Buffer.from([COLUMNS.join(","), ...rows.map(row => COLUMNS.map(key => row[key] ?? "").join(","))].join("\n") + "\n");
const modified = (patch: Record<string, string>, index = 0) => csv(adapted.map((r, i) => i === index ? { ...r, ...patch } : r));
const opts: HistoryImportOptions = { mode: "APPLY", mapping: { instrumentId: "US:AAPL", currency: "USD", evidenceRef: SYNTHETIC_HISTORY_REF }, rights: { scope: "synthetic_fixture_only", evidenceRef: SYNTHETIC_HISTORY_REF } };
const aapl = { market: "US", symbol: "AAPL" } as const;
let store: PriceStore, root: string;
const dbHash = () => historyHash(fs.readFileSync(store.filename));
beforeEach(() => {
  ({ store, root } = PriceStore.createDisposableHistoryFixture());
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("MARKET_PRICES_STORAGE", "disk");
  vi.stubEnv("MARKET_PRICES_DIR", path.join(root, "market-prices"));
  vi.stubEnv("MARKET_PRICES_ENABLED", "1");
  vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw Error("provider_network_forbidden_in_history_tests"); });
});
afterEach(() => {
  if (store.db.open) store.close();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(fence.status.activeWriters).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
});

describe("single native history writer — disposable W05 fixtures only", () => {
  it("defaults to NO_APPLY with no schema, bytes or row mutation", () => {
    const before = dbHash();
    expect(store.importHistory(csv())).toMatchObject({ status: "NO_APPLY", applied: false });
    expect(dbHash()).toBe(before); expect(store.instruments()).toEqual([]);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'history_%'").all()).toEqual([]);
  });

  it("imports six W05 OHLCV rows with exact file hash, immutable receipt and separately versioned coverage", () => {
    const bytes = csv(), before = dbHash(), result = store.importHistory(bytes, opts);
    expect(result).toMatchObject({ status: "APPLIED_SYNTHETIC", applied: true, fileSha256: historyHash(bytes), receipt: {
      source: "owner_csv", dataOrigin: "synthetic_fixture", inserted: 6, unchanged: 0, revision: 1,
      priceBasis: "RAW", independentVerification: false, coverage: { firstSession: "2026-10-05", lastSession: "2026-10-12", rows: 6 },
    } });
    expect(dbHash()).not.toBe(before);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM history_source_versions").get()).toEqual({ n: 1 });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM history_bar_provenance").get()).toEqual({ n: 6 });
    const read = store.read(aapl);
    expect(read.policy.source).toBe("owner_csv"); expect(read.policy.priceBasis).toBe("RAW");
    expect(read.bars[0]).toMatchObject({ date: "2026-10-05", open: 100, high: 103, low: 99, close: 101, volume: 1000,
      provenance: { fileSha256: historyHash(bytes), observedAt: originals[0].source_captured_at, retrievedAt: null, revision: 1 } });
    expect(read.bars[0].valueHash).toBe(historyHash(JSON.stringify(["US:AAPL", "owner_csv", "RAW", "2026-10-05", 100, 103, 99, 101, 1000, null])));
    expect(read.revisionAudit.importReceipts?.[0]).toEqual(result.receipt);
  });

  it("replays identical bytes idempotently without changing the DB hash or import timestamp", () => {
    const first = store.importHistory(csv(), opts), before = dbHash();
    expect(store.importHistory(csv(), opts)).toMatchObject({ status: "IDEMPOTENT", applied: false, receipt: first.receipt });
    expect(dbHash()).toBe(before);
  });

  it("records a new file revision for identical overlap plus new dates without rewriting old provenance", () => {
    const first = store.importHistory(csv(adapted.slice(0, 3)), opts);
    const provenance = store.read(aapl).bars[0].provenance;
    const next = store.importHistory(csv(), opts);
    expect(next.receipt).toMatchObject({ inserted: 3, unchanged: 3, revision: 2, totalRows: 6 });
    expect(store.read(aapl).bars[0].provenance).toEqual(provenance);
    const receipts = store.read(aapl).revisionAudit.importReceipts;
    expect(receipts?.[1]).toEqual(first.receipt);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM history_source_versions").get()).toEqual({ n: 2 });
  });

  it("HOLD_CONFLICT preserves old/new provenance and all DB bytes on changed overlap", () => {
    store.importHistory(csv(), opts); const before = dbHash();
    const result = store.importHistory(modified({ close: "102" }), opts);
    expect(result).toMatchObject({ status: "HOLD_CONFLICT", applied: false, conflict: {
      existing: { bar: { close: 101 }, provenance: { source: "owner_csv" } }, incoming: { bar: { close: 102 }, source: "owner_csv" },
    } });
    expect(dbHash()).toBe(before); expect(store.read(aapl).bars[0].close).toBe(101);
  });

  it("keeps Close-only fields null and reads actual SQLite through the existing MCP read_price_bars", async () => {
    const bytes = modified({ open: "", high: "", low: "", volume: "" });
    expect(store.importHistory(bytes, opts).status).toBe("APPLIED_SYNTHETIC"); store.close();
    const before = dbHash();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "native-price-readback-fixture", version: "1" });
    registerPriceTools(server); // real default readCachedPrices; no reader mock/seam
    const client = new Client({ name: "history-fixture", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "read_price_bars", arguments: { ...aapl, start: "2026-10-05", end: "2026-10-12" } });
      expect(result.isError).not.toBe(true);
      const body = JSON.parse((result.content as { text: string }[])[0].text);
      expect(body).toMatchObject({ total: 6, policy: { source: "owner_csv", priceBasis: "RAW" }, series: { dataOrigin: "synthetic_fixture" } });
      expect(body.bars[0]).toMatchObject({ open: null, high: null, low: null, volume: null, close: 101,
        completeness: "close_only", provenance: { fileSha256: historyHash(bytes), source: "owner_csv" } });
      expect(dbHash()).toBe(before);
      const status = await client.callTool({ name: "get_price_data_status", arguments: {} });
      const statusBody = JSON.parse((status.content as { text: string }[])[0].text);
      expect(statusBody.policy.source).toBe("per_series");
      expect(statusBody.instruments[0]).toMatchObject({ id: "US:AAPL", source: "owner_csv", priceBasis: "RAW" });
      const reader = new PriceStore(store.filename);
      try {
        expect(reader.db.pragma("query_only", { simple: true })).toBe(1);
        expect(() => reader.db.prepare("DELETE FROM bars").run()).toThrow(/readonly/i);
      } finally { reader.close(); }
      expect(fs.existsSync(path.join(root, "app.sqlite"))).toBe(false);
      expect(fs.existsSync(path.join(root, "vault"))).toBe(false);
    } finally { await client.close(); await server.close(); }
  });

  it("retains supplied adjusted values and rejects later basis splicing", () => {
    const adjusted = csv(adapted.map(r => ({ ...r, adjustment_basis: "SPLIT_ADJUSTED", adjusted_close: "99" })));
    expect(store.importHistory(adjusted, opts).status).toBe("APPLIED_SYNTHETIC");
    expect(store.read(aapl).bars[0]).toMatchObject({ close: 101, adjustedClose: 99, priceBasis: "SPLIT_ADJUSTED" });
    const before = dbHash(); expect(store.importHistory(csv(), opts).reason).toBe("source_or_basis_conflict"); expect(dbHash()).toBe(before);
  });

  it("does not manufacture volume when OHLC is present", () => {
    expect(store.importHistory(modified({ volume: "" }), opts).status).toBe("APPLIED_SYNTHETIC");
    expect(store.read(aapl).bars[0]).toMatchObject({ open: 100, high: 103, low: 99, close: 101, volume: null, completeness: "ohlc_without_volume" });
  });

  it("compares original decimal values rather than mistaking float rounding for an identical row", () => {
    const row = { ...adapted[0], open: "100000000000", low: "99999999999", high: "100000000001", close: "100000000000.00000001" };
    expect(Number(row.close)).toBe(Number("100000000000.00000002"));
    store.importHistory(csv([row]), opts); const before = dbHash();
    expect(store.importHistory(csv([{ ...row, close: "100000000000.00000002" }]), opts).status).toBe("HOLD_CONFLICT");
    expect(dbHash()).toBe(before);
  });

  it("preserves all eight existing Yahoo fixture instruments", () => {
    const controls = [...PILOT_INSTRUMENTS, ...Object.values(BENCHMARKS)];
    for (const input of controls) store.save(parseYahooChart(chartFixture(input), input, TEST_NOW));
    const before = controls.map(input => store.read(input));
    expect(store.importHistory(csv(), opts).status).toBe("APPLIED_SYNTHETIC");
    expect(controls.map(input => store.read(input))).toEqual(before);
    expect(store.instruments()).toHaveLength(9);
  });

  it("preserves the exact eight REVIEWED_PILOT instruments and holds the already-Yahoo AAPL", () => {
    for (const input of REVIEWED_PILOT) store.save(parseYahooChart(chartFixture(input), input, TEST_NOW));
    const before = REVIEWED_PILOT.map(input => store.read(input)), bytes = dbHash();
    expect(store.importHistory(csv(), opts).status).toBe("HOLD_CONFLICT");
    expect(REVIEWED_PILOT.map(input => store.read(input))).toEqual(before);
    expect(dbHash()).toBe(bytes); expect(store.instruments()).toHaveLength(8);
  });

  it("does not send imported history into legacy Yahoo event analysis", () => {
    store.importHistory(csv(), opts);
    expect(() => analyzePriceEvent(store, { ...aapl, eventSessionDate: "2026-10-06", timing: "before_open" }))
      .toThrow("history_event_analysis_requires_basis_review");
  });

  it("rejects Yahoo-to-owner source mixing even on disjoint dates and never rewrites Yahoo", () => {
    store.save(parseYahooChart(chartFixture(aapl), aapl, TEST_NOW)); const before = dbHash();
    expect(store.importHistory(csv(), opts)).toMatchObject({ status: "HOLD_CONFLICT", conflict: { existing: { series: { source: "yahoo-chart" } }, incoming: { source: "owner_csv" } } });
    expect(dbHash()).toBe(before);
  });

  it("rejects a later Yahoo refresh into an owner_csv series", () => {
    store.importHistory(csv(), opts); const before = dbHash();
    expect(() => store.save(parseYahooChart(chartFixture(aapl), aapl, TEST_NOW))).toThrow("price_source_conflict");
    expect(dbHash()).toBe(before);
  });

  it("rolls back both bar tables, provenance, receipts and lease after mid-batch SQLite failure", () => {
    store.db.exec(`CREATE TEMP TRIGGER fail_history BEFORE INSERT ON partial_bars WHEN NEW.date='2026-10-07' BEGIN SELECT RAISE(ABORT,'injected_mid_batch'); END`);
    const before = dbHash(); const bytes = modified({ open: "", high: "", low: "", volume: "" }, 2);
    expect(() => store.importHistory(bytes, opts)).toThrow("injected_mid_batch");
    expect(dbHash()).toBe(before); expect(store.instruments()).toEqual([]);
    expect(store.db.prepare("SELECT * FROM collector_lease").all()).toEqual([]);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'history_%'").all()).toEqual([]);
    store.db.exec("DROP TRIGGER fail_history");
    expect(store.importHistory(bytes, opts).receipt?.inserted).toBe(6);
  });

  it("fails closed for a two-table duplicate and a missing receipt bar", () => {
    store.importHistory(csv(), opts);
    store.db.exec("INSERT INTO partial_bars SELECT * FROM bars WHERE date='2026-10-05'");
    const before = dbHash();
    expect(store.importHistory(csv(), opts).reason).toBe("ambiguous_price_bar_key");
    expect(() => store.read(aapl)).toThrow("ambiguous_price_bar_key"); expect(dbHash()).toBe(before);
    store.db.exec("DELETE FROM partial_bars; DELETE FROM bars WHERE date='2026-10-05'");
    expect(store.importHistory(csv(), opts).reason).toBe("orphan_history_provenance");
  });

  it("refuses concurrent collector lease ownership without stealing or changing DB bytes", () => {
    const token = store.acquireLease(new Date())!, before = dbHash();
    expect(store.importHistory(csv(), opts).status).toBe("WRITER_BUSY"); expect(dbHash()).toBe(before);
    store.releaseLease(token); expect(store.importHistory(csv(), opts).status).toBe("APPLIED_SYNTHETIC");
  });

  it("uses native freeze admission and keeps real/runtime handles D1_HOLD", async () => {
    store.close();
    await fence.withFrozenWriters(async () => {
      expect(() => PriceStore.createDisposableHistoryFixture()).toThrow("backup_writer_freeze_active");
      const reader = new PriceStore(store.filename);
      try { expect(reader.importHistory(csv(), opts).status).toBe("D1_HOLD"); } finally { reader.close(); }
    });
    const ordinary = new PriceStore(store.filename, true), before = dbHash();
    try { expect(ordinary.importHistory(csv(), opts).status).toBe("D1_HOLD"); expect(dbHash()).toBe(before); } finally { ordinary.close(); }
    vi.stubEnv("NODE_ENV", "production"); expect(() => PriceStore.createDisposableHistoryFixture()).toThrow("D1_HOLD");
    expect(fence.getAdmissionEvidence().productionSnapshotReady).toBe(false);
  });

  it.each([
    ["missing rights", { ...opts, rights: undefined }, "RIGHTS_HOLD"],
    ["missing mapping", { ...opts, mapping: undefined }, "MAPPING_HOLD"],
  ] as const)("rejects %s before mutation", (_name, options, status) => {
    const before = dbHash(); expect(store.importHistory(csv(), options).status).toBe(status); expect(dbHash()).toBe(before);
  });

  it.each([
    { close: "NaN" }, { close: "Infinity" }, { close: "0" }, { close: "-1" }, { close: "" },
    { volume: "1.5" }, { low: "" }, { high: "1" }, { instrument_id: "US:MSFT" }, { currency: "JPY" },
    { adjustment_basis: "UNKNOWN" }, { observed_at: "2026-02-30T00:00:00Z" }, { observed_at: "2026-11-13T24:00:00Z" },
  ] as Record<string, string>[])("rejects malformed/out-of-scope row %j atomically", patch => {
    const before = dbHash(); expect(store.importHistory(modified(patch), opts).status).toBe("INPUT_HOLD"); expect(dbHash()).toBe(before);
  });

  it("rejects duplicate input dates, real-source claims, and mixed bases", () => {
    const before = dbHash();
    expect(store.importHistory(csv([...adapted, adapted[0]]), opts).reason).toBe("duplicate_history_date");
    expect(store.importHistory(modified({ source_file_or_uri: "owner-history.csv" }), opts).status).toBe("D1_HOLD");
    expect(store.importHistory(modified({ adjustment_basis: "TOTAL_RETURN" }, 1), opts).reason).toBe("mixed_history_basis");
    expect(dbHash()).toBe(before);
    expect(instrument(aapl).id).toBe("US:AAPL");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { previewPriceCsv, previewPriceFile, CSV_PREVIEW_HEADER, CSV_PREVIEW_MAX_BYTES, type CsvPreview, type CsvPreviewIssue } from "./csv-preview";

// W05 Phase A acceptance W05-P01…P12 against the frozen synthetic fixture pack. Synthetic only.
type Column = typeof CSV_PREVIEW_HEADER[number];
const FIXTURES = path.resolve("tests/fixtures/market-prices-w05");
const GOOD = "W05_GOOD_SYNTHETIC.csv", INVALID = "W05_INVALID_BAR_SYNTHETIC.csv", DUPLICATE = "W05_DUPLICATE_DATE_SYNTHETIC.csv";
const MIXED = "W05_MIXED_LISTING_SYNTHETIC.csv", CHANGED = "W05_CHANGED_PAYLOAD_SYNTHETIC.csv";
const fixture = (name: string) => path.join(FIXTURES, name);
const read = (name: string) => fs.readFileSync(fixture(name));
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const EXPECTED = JSON.parse(fs.readFileSync(fixture("W05_EXPECTED_PREVIEWS.json"), "utf8"));
const NOW = new Date("2026-11-13T01:02:03Z");
const HEADER = CSV_PREVIEW_HEADER.join(",");
const GOOD_ROWS = read(GOOD).toString("utf8").split("\r\n").slice(1, -1);
const CONTRACT_KEYS = ["contract", "status", "sourceOrigin", "fileSha256", "bytes", "previewAt", "inputRows", "candidateRows", "quarantinedRows",
  "identity", "coverage", "issues", "issuesTruncated", "persistenceEligible", "wouldWrite", "networkRequests", "databaseWrites", "driveWrites", "vaultWrites"];
const NO_SIDE_EFFECTS = { persistenceEligible: false, wouldWrite: false, networkRequests: 0, databaseWrites: 0, driveWrites: 0, vaultWrites: 0 };

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const edit = (line: string, changes: Partial<Record<Column, string>>) => {
  const cells = line.split(",");
  for (const [column, value] of Object.entries(changes)) cells[CSV_PREVIEW_HEADER.indexOf(column as Column)] = value!;
  return cells.join(",");
};
const csv = (rows: string[], eol = "\r\n") => Buffer.from([HEADER, ...rows].join(eol) + eol);
const dailyRows = (count: number) => Array.from({ length: count }, (_, i) =>
  edit(GOOD_ROWS[0], { session_date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10) }));
const preview = (bytes: Buffer) => previewPriceCsv(bytes, NOW);
const essentials = ({ previewAt: _previewAt, ...rest }: CsvPreview) => rest;
const holdIssue = (bytes: Buffer): CsvPreviewIssue => {
  const result = preview(bytes);
  expect(result).toMatchObject({ status: "PREVIEW_HOLD", candidateRows: 0, quarantinedRows: 0, identity: null, coverage: null, ...NO_SIDE_EFFECTS });
  expect(result.issues).toHaveLength(1);
  return result.issues[0];
};
/** Compare one fixture with the frozen golden JSON (field names mapped to the contract output). */
const golden = (name: string) => {
  const expected = EXPECTED.cases[name], result = previewPriceFile(fixture(name), NOW);
  expect(sha(read(name))).toBe(expected.fileSha256);
  expect(result).toMatchObject({ status: expected.status, fileSha256: expected.fileSha256, bytes: expected.bytes, inputRows: expected.rawRows,
    candidateRows: expected.candidateRows, ...EXPECTED.allOutputsMustHave, ...NO_SIDE_EFFECTS });
  expect(result.persistenceEligible).toBe(expected.eligibleForPersistence);
  if ("quarantinedRows" in expected) expect(result.quarantinedRows).toBe(expected.quarantinedRows);
  if (expected.reason) expect(result.issues[0].code).toBe(expected.reason);
  if (expected.identity) expect(result.identity?.id).toBe(expected.identity);
  if (expected.firstSession) expect(result.coverage).toMatchObject({ firstSession: expected.firstSession, lastSession: expected.lastSession });
  return result;
};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ios-w05-preview-"));
/** Relative static import closure of the preview module (proves which modules can run). */
const importClosure = (entry: string) => {
  const graph = new Map<string, string[]>();
  const visit = (file: string) => {
    const key = path.relative(process.cwd(), file);
    if (graph.has(key)) return;
    const specs = [...fs.readFileSync(file, "utf8").matchAll(/^import\s[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/gm)].map(m => m[1] ?? m[2]);
    graph.set(key, specs);
    for (const spec of specs) if (spec.startsWith(".")) visit(path.resolve(path.dirname(file), spec));
  };
  visit(path.resolve(entry));
  return graph;
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("W05-P01 happy path: raw-byte SHA-256, exact rows and coverage, never writes", () => {
  const file = fixture(GOOD), before = fs.statSync(file);
  const result = golden(GOOD);
  expect(result).toEqual({ contract: "ios-prices-w05-preview-v0", status: "PREVIEW_VALID_SYNTHETIC", sourceOrigin: "synthetic_fixture",
    fileSha256: sha(fs.readFileSync(file)), bytes: 1120, previewAt: NOW.toISOString(), inputRows: 6, candidateRows: 6, quarantinedRows: 0,
    identity: { id: "US:AAPL", venue: "XNAS", currency: "USD", timeZone: "America/New_York", identityVerifiedLive: false },
    coverage: { firstSession: "2026-10-05", lastSession: "2026-10-12", sessions: 6, officialCalendarVerified: false, coverageProvisional: true },
    issues: [], issuesTruncated: false, ...NO_SIDE_EFFECTS });
  const after = fs.statSync(file);
  expect([after.size, after.mtimeMs, after.ino]).toEqual([before.size, before.mtimeMs, before.ino]);
});

it("W05-P02 exact input replay: stable SHA and output essentials, no persisted state", () => {
  const first = previewPriceFile(fixture(GOOD), NOW);
  const later = previewPriceFile(fixture(GOOD), new Date("2026-11-20T09:00:00Z"));
  const fromBytes = previewPriceCsv(Buffer.from(read(GOOD)), NOW);
  expect(fromBytes).toEqual(first);
  expect(essentials(later)).toEqual(essentials(first));
  // The importer's own clock is separate from session dates and the fixture's source_captured_at.
  expect([first.previewAt, later.previewAt]).toEqual([NOW.toISOString(), "2026-11-20T09:00:00.000Z"]);
  // No database: no inserted/revised/no-change or replay-authorization claims exist in the output.
  expect(Object.keys(later)).toEqual(CONTRACT_KEYS);
});

it("W05-P03 invalid OHLC: QC_HOLD, quarantined rows reported, no subset published", () => {
  expect(golden(INVALID)).toMatchObject({ status: "PREVIEW_QC_HOLD", candidateRows: 1, quarantinedRows: 1, coverage: null,
    issues: [{ code: "invalid_ohlc_range", row: 2 }] });
  const rows = GOOD_ROWS.map((line, i) => i === 1 ? edit(line, { low: "105.00" }) : i === 3 ? edit(line, { high: "98.00" }) : line);
  const result = preview(csv(rows));
  expect(result).toMatchObject({ status: "PREVIEW_QC_HOLD", inputRows: 6, candidateRows: 4, quarantinedRows: 2, coverage: null, ...NO_SIDE_EFFECTS });
  expect(result.issues).toEqual([{ code: "invalid_ohlc_range", row: 2 }, { code: "invalid_ohlc_range", row: 4 }]);
});

it("W05-P04 same-date duplicate: whole file HOLD, no silent dedup", () => {
  expect(golden(DUPLICATE)).toMatchObject({ status: "PREVIEW_HOLD", candidateRows: 0, identity: null, coverage: null,
    issues: [{ code: "duplicate_session_date", row: 2, column: "session_date" }] });
  expect(holdIssue(csv([...GOOD_ROWS, GOOD_ROWS[5]]))).toEqual({ code: "duplicate_session_date", row: 7, column: "session_date" });
  expect(holdIssue(csv([GOOD_ROWS[0], edit(GOOD_ROWS[1], { session_date: "2026-10-05" })]))).toEqual({ code: "duplicate_session_date", row: 2, column: "session_date" });
  expect(holdIssue(csv([GOOD_ROWS[1], GOOD_ROWS[0]]))).toEqual({ code: "session_dates_not_increasing", row: 2, column: "session_date" });
  expect(holdIssue(csv([edit(GOOD_ROWS[0], { session_date: "2026-02-30" })]))).toEqual({ code: "invalid_session_date", row: 1, column: "session_date" });
  expect(holdIssue(csv([edit(GOOD_ROWS[0], { session_date: "2026/10/05" })]))).toEqual({ code: "invalid_session_date", row: 1, column: "session_date" });
});

it("W05-P05 mixed listing or wrong venue/currency/time zone: HOLD, no symbol-only or cross-listing resolution", () => {
  expect(golden(MIXED)).toMatchObject({ status: "PREVIEW_HOLD", identity: null, issues: [{ code: "mixed_listing_not_supported_v1" }] });
  const cases: [Partial<Record<Column, string>>, CsvPreviewIssue][] = [
    [{ venue: "XNYS" }, { code: "venue_mismatch", row: 1, column: "venue" }],
    [{ currency: "THB" }, { code: "currency_mismatch", row: 1, column: "currency" }],
    [{ time_zone: "Asia/Bangkok" }, { code: "time_zone_mismatch", row: 1, column: "time_zone" }],
    [{ symbol: "MSFT" }, { code: "listing_not_in_preview_scope", row: 1 }],
    [{ symbol: "aapl" }, { code: "listing_not_in_preview_scope", row: 1 }],
    [{ symbol: "AAPL.O" }, { code: "listing_not_in_preview_scope", row: 1 }],
    [{ market: "TH" }, { code: "listing_not_in_preview_scope", row: 1 }],
  ];
  for (const [change, issue] of cases) expect(holdIssue(csv(GOOD_ROWS.map(line => edit(line, change))))).toEqual(issue);
  expect(holdIssue(csv(GOOD_ROWS.map((line, i) => i === 5 ? edit(line, { venue: "XNYS" }) : line)))).toEqual({ code: "venue_mismatch", row: 6, column: "venue" });
  expect(holdIssue(csv([GOOD_ROWS[0], edit(GOOD_ROWS[1], { market: "TH" })]))).toEqual({ code: "mixed_listing_not_supported_v1" });
});

it("W05-P06 formula-like metadata, CSV injection, unsafe path or symlink: HOLD, no evaluation or opening", () => {
  const injections: [Partial<Record<Column, string>>, CsvPreviewIssue][] = [
    [{ source_ref: quote('=HYPERLINK("http://evil.invalid","x")') }, { code: "formula_like_value", row: 1, column: "source_ref" }],
    [{ symbol: "+AAPL" }, { code: "formula_like_value", row: 1, column: "symbol" }],
    [{ venue: "@SUM(A1)" }, { code: "formula_like_value", row: 1, column: "venue" }],
    [{ source_type: "-2+3+cmd|' /C calc'!A0" }, { code: "formula_like_value", row: 1, column: "source_type" }],
    [{ open: "=1+1" }, { code: "formula_like_value", row: 1, column: "open" }],
    [{ session_date: "\t2026-10-05" }, { code: "control_character", row: 1, column: "session_date" }],
    [{ price_basis: quote("synthetic_raw_ohlcv\r") }, { code: "control_character", row: 1, column: "price_basis" }],
  ];
  for (const [change, issue] of injections) {
    const bytes = csv([edit(GOOD_ROWS[0], change)]);
    expect(holdIssue(bytes)).toEqual(issue);
    expect(JSON.stringify(preview(bytes))).not.toMatch(/HYPERLINK|evil|cmd|calc|SUM\(|=1\+1/);
  }
  const dir = tempDir();
  try {
    const real = path.join(dir, "real.csv"), link = path.join(dir, "link.csv"), folder = path.join(dir, "folder.csv"), fifo = path.join(dir, "pipe.csv");
    fs.copyFileSync(fixture(GOOD), real);
    fs.symlinkSync(real, link);
    fs.mkdirSync(folder);
    execFileSync("mkfifo", [fifo]);
    const open = vi.spyOn(fs, "openSync");
    const unsafe: [string, string][] = [[link, "symlink_not_allowed"], [folder, "not_a_regular_file"], [fifo, "not_a_regular_file"],
      [path.join(dir, "real.txt"), "unsafe_input_path"], [`${real}\0.csv`, "unsafe_input_path"], ["", "unsafe_input_path"],
      ["https://example.invalid/prices.csv", "input_unreadable"], [path.join(dir, "missing.csv"), "input_unreadable"]];
    for (const [input, code] of unsafe) {
      const result = previewPriceFile(input, NOW);
      expect(result).toMatchObject({ status: "PREVIEW_HOLD", fileSha256: null, identity: null, issues: [{ code }], ...NO_SIDE_EFFECTS });
      expect(JSON.stringify(result)).not.toContain(dir);
    }
    expect(open).not.toHaveBeenCalled();
    expect(previewPriceFile(real, NOW).status).toBe("PREVIEW_VALID_SYNTHETIC");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("W05-P07 empty close, negative volume, NaN/Inf, out-of-range: bounded QC_HOLD or HOLD, nothing fabricated", () => {
  const cases: [Partial<Record<Column, string>>, CsvPreviewIssue][] = [
    [{ close: "" }, { code: "missing_price_value", row: 3, column: "close" }],
    [{ open: "" }, { code: "missing_price_value", row: 3, column: "open" }],
    [{ volume: "-5" }, { code: "negative_volume", row: 3, column: "volume" }],
    [{ volume: "" }, { code: "missing_volume", row: 3, column: "volume" }],
    [{ volume: "1.5" }, { code: "invalid_volume", row: 3, column: "volume" }],
    [{ volume: "1234567890123456" }, { code: "invalid_volume", row: 3, column: "volume" }],
    [{ close: "NaN" }, { code: "invalid_number", row: 3, column: "close" }],
    [{ high: "Infinity" }, { code: "invalid_number", row: 3, column: "high" }],
    [{ low: "1e2" }, { code: "invalid_number", row: 3, column: "low" }],
    [{ close: quote("1,000") }, { code: "invalid_number", row: 3, column: "close" }],
    [{ close: "1234567890123.00" }, { code: "invalid_number", row: 3, column: "close" }],
    [{ close: "99.123456789" }, { code: "invalid_number", row: 3, column: "close" }],
    [{ open: "0.00" }, { code: "nonpositive_price", row: 3, column: "open" }],
    [{ low: "-1.00" }, { code: "nonpositive_price", row: 3, column: "low" }],
    [{ adjusted_close: "0" }, { code: "invalid_adjusted_close", row: 3, column: "adjusted_close" }],
    [{ adjusted_close: "abc" }, { code: "invalid_adjusted_close", row: 3, column: "adjusted_close" }],
  ];
  for (const [change, issue] of cases) {
    const result = preview(csv(GOOD_ROWS.map((line, i) => i === 2 ? edit(line, change) : line)));
    expect(result).toMatchObject({ status: "PREVIEW_QC_HOLD", inputRows: 6, candidateRows: 5, quarantinedRows: 1, coverage: null, ...NO_SIDE_EFFECTS });
    expect(result.issues).toEqual([issue]);
  }
  expect(holdIssue(csv([edit(GOOD_ROWS[0], { close: "-Infinity" })]))).toEqual({ code: "formula_like_value", row: 1, column: "close" });
  // Empty adjusted_close is admissible (no value is inferred from close); a positive one is admissible too.
  expect(preview(csv(GOOD_ROWS.map(line => edit(line, { adjusted_close: "100.5" })))).status).toBe("PREVIEW_VALID_SYNTHETIC");
  expect(preview(csv(GOOD_ROWS.map(line => edit(line, { close: "" }))))).toMatchObject({ status: "PREVIEW_QC_HOLD", candidateRows: 0, quarantinedRows: 6, coverage: null });
  const many = preview(csv(dailyRows(60).map(line => edit(line, { volume: "-1" }))));
  expect(many).toMatchObject({ quarantinedRows: 60, issuesTruncated: true });
  expect(many.issues).toHaveLength(50);
});

it("W05-P08 UTF-8, CSV quoting, headers, oversized input and row cap: deterministic bounds and reasons", () => {
  const good = read(GOOD);
  const cases: [Buffer, CsvPreviewIssue][] = [
    [Buffer.alloc(0), { code: "empty_input" }],
    [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), good]), { code: "utf8_bom_not_supported" }],
    [Buffer.concat([good.subarray(0, 200), Buffer.from([0xff, 0xfe]), good.subarray(200)]), { code: "invalid_utf8" }],
    [Buffer.concat([good.subarray(0, 200), Buffer.from([0]), good.subarray(200)]), { code: "nul_byte" }],
    [Buffer.from(`${HEADER}\r\n`), { code: "no_data_rows" }],
    [Buffer.from(`${HEADER.replace("open,high", "high,open")}\r\n${GOOD_ROWS[0]}\r\n`), { code: "invalid_header", row: 0 }],
    [Buffer.from(`${HEADER},note\r\n${GOOD_ROWS[0]},x\r\n`), { code: "invalid_header", row: 0 }],
    [Buffer.from(`${HEADER.replace(",source_captured_at", "")}\r\n${GOOD_ROWS[0]}\r\n`), { code: "invalid_header", row: 0 }],
    [Buffer.from(`${HEADER.toUpperCase()}\r\n${GOOD_ROWS[0]}\r\n`), { code: "invalid_header", row: 0 }],
    [csv([`${GOOD_ROWS[0]},`]), { code: "inconsistent_row_width", row: 1 }],
    [csv([GOOD_ROWS[0], GOOD_ROWS[1].split(",").slice(0, 15).join(",")]), { code: "inconsistent_row_width", row: 2 }],
    [csv([GOOD_ROWS[0], "", GOOD_ROWS[1]]), { code: "inconsistent_row_width", row: 2 }],
    [csv([edit(GOOD_ROWS[0], { source_ref: 'IOS"W05' })]), { code: "malformed_quote", row: 1 }],
    [csv([edit(GOOD_ROWS[0], { source_ref: '"IOS-W05-LOCAL-MOCK-ONLY"x' })]), { code: "malformed_quote", row: 1 }],
    [Buffer.from(`${HEADER}\r\n${edit(GOOD_ROWS[0], { source_captured_at: '"2026' })}`), { code: "unterminated_quote", row: 1 }],
    [Buffer.from(`${HEADER}\r${GOOD_ROWS[0]}`), { code: "bare_carriage_return", row: 0 }],
    [csv([edit(GOOD_ROWS[0], { source_ref: quote("X".repeat(65)) })]), { code: "field_too_long", row: 1 }],
    [Buffer.alloc(CSV_PREVIEW_MAX_BYTES + 1, 0x41), { code: "byte_cap_exceeded" }],
    [csv(dailyRows(501)), { code: "row_cap_exceeded" }],
  ];
  for (const [bytes, issue] of cases) {
    const first = preview(bytes);
    expect(preview(Buffer.from(bytes))).toEqual(first);
    expect(first).toMatchObject({ status: "PREVIEW_HOLD", fileSha256: sha(bytes), bytes: bytes.length, candidateRows: 0, identity: null, coverage: null, ...NO_SIDE_EFFECTS });
    expect(first.issues).toEqual([issue]);
  }
  const text = good.toString("utf8");
  const variants = [
    Buffer.from([HEADER, ...GOOD_ROWS].map(line => line.split(",").map(quote).join(",")).join("\r\n") + "\r\n"),
    Buffer.from(text.replaceAll("\r\n", "\n")),
    Buffer.from(text.slice(0, -2)),
  ];
  for (const bytes of variants) {
    expect(preview(bytes)).toMatchObject({ status: "PREVIEW_VALID_SYNTHETIC", fileSha256: sha(bytes), inputRows: 6, candidateRows: 6,
      coverage: { firstSession: "2026-10-05", lastSession: "2026-10-12" } });
    expect(sha(bytes)).not.toBe(sha(good));
  }
  expect(preview(csv(dailyRows(500)))).toMatchObject({ status: "PREVIEW_VALID_SYNTHETIC", inputRows: 500, candidateRows: 500 });
  const dir = tempDir();
  try {
    const big = path.join(dir, "big.csv");
    fs.writeFileSync(big, Buffer.concat([good, Buffer.alloc(CSV_PREVIEW_MAX_BYTES, 0x41)]));
    expect(previewPriceFile(big, NOW)).toMatchObject({ status: "PREVIEW_HOLD", fileSha256: null, bytes: CSV_PREVIEW_MAX_BYTES + good.length,
      issues: [{ code: "byte_cap_exceeded" }], ...NO_SIDE_EFFECTS });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("W05-P09 fake Yahoo source type or real-market rows: HOLD, rights gate not bypassed", () => {
  // Even a syntactically valid operator attestation in the environment cannot admit or persist a file preview.
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", JSON.stringify({ provider: "yahoo-chart", scope: "private_team_archive",
    evidenceRef: "w05-test-sentinel-not-a-license", termsUrl: "https://example.invalid/terms", reviewedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z", instrumentIds: ["US:AAPL"] }));
  const cases: [Partial<Record<Column, string>>, Column][] = [
    [{ source_type: "yahoo-chart" }, "source_type"], [{ source_type: "real_market" }, "source_type"],
    [{ source_type: "manual_csv_v1" }, "source_type"], [{ source_type: "OPERATOR_ATTESTED" }, "source_type"],
    [{ source_ref: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL" }, "source_ref"],
    [{ price_basis: "provider_quote_v1" }, "price_basis"], [{ source_captured_at: "2026-11-12T00:00:00Z" }, "source_captured_at"],
  ];
  for (const [change, column] of cases) {
    const result = preview(csv(GOOD_ROWS.map((line, i) => i === 4 ? edit(line, change) : line)));
    expect(result).toMatchObject({ status: "PREVIEW_HOLD", sourceOrigin: "not_admitted", candidateRows: 0, identity: null, ...NO_SIDE_EFFECTS });
    expect(result.issues).toEqual([{ code: `${column}_not_permitted`, row: 5, column }]);
    expect(JSON.stringify(result)).not.toMatch(/yahoo|OPERATOR_ATTESTED|real_market|manual_csv/i);
  }
  expect(previewPriceFile(fixture(GOOD), NOW)).toMatchObject({ status: "PREVIEW_VALID_SYNTHETIC", ...NO_SIDE_EFFECTS });
});

it("W05-P10 source copy and changed bytes: original SHA stable, changed payload distinct, no inferred market revision", () => {
  const dir = tempDir();
  try {
    const copy = path.join(dir, "copy.csv");
    fs.copyFileSync(fixture(GOOD), copy);
    const original = previewPriceFile(fixture(GOOD), NOW), copied = previewPriceFile(copy, NOW), changed = golden(CHANGED);
    expect(copied).toEqual(original);
    expect(changed.fileSha256).toBe(EXPECTED.cases[CHANGED].fileSha256);
    expect(changed.fileSha256).not.toBe(original.fileSha256);
    expect({ ...essentials(changed), fileSha256: null }).toEqual({ ...essentials(original), fileSha256: null });
    expect(Object.keys(changed)).toEqual(CONTRACT_KEYS);
    expect(sha(read(GOOD))).toBe(EXPECTED.cases[GOOD].fileSha256);
    const differs = read(GOOD).toString("utf8").split("\r\n").filter((line, i) => line !== read(CHANGED).toString("utf8").split("\r\n")[i]);
    expect(differs).toEqual([GOOD_ROWS[4]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("W05-P11 all negative/positive paths: zero network, DB, Drive, Vault, scheduler and secret access", () => {
  const graph = importClosure("src/server/market-prices/csv-preview.ts");
  expect([...graph.keys()].sort()).toEqual(["src/server/market-prices/csv-preview.ts", "src/server/market-prices/model.ts", "src/server/market-prices/universe.ts"]);
  const external = [...graph.values()].flat().filter(spec => !spec.startsWith("."));
  expect([...new Set(external)].sort()).toEqual(["node:crypto", "node:fs", "zod"]);
  expect(fs.readFileSync("src/server/market-prices/csv-preview.ts", "utf8")).not.toMatch(/process\.env|fetch\(|setTimeout\(|setInterval\(|setImmediate\(|better-sqlite3|new PriceStore|\.save\(|writeFile|appendFile|mkdir|googleapis|parseYahooChart|assertPriceRights/);

  const dir = tempDir(), link = path.join(dir, "link.csv");
  try {
    fs.symlinkSync(fixture(GOOD), link);
    const paths = [GOOD, INVALID, DUPLICATE, MIXED, CHANGED].map(fixture).concat([link, path.join(dir, "missing.csv"), path.join(dir, "x.txt")]);
    const buffers = [csv(GOOD_ROWS.map(line => edit(line, { volume: "-1" }))), csv([edit(GOOD_ROWS[0], { source_type: "yahoo-chart" })]),
      csv([edit(GOOD_ROWS[0], { source_ref: "=cmd" })]), Buffer.from([0xff]), Buffer.alloc(CSV_PREVIEW_MAX_BYTES + 1), csv(dailyRows(501))];
    const forbidden = () => { throw Error("forbidden side effect"); };
    const effects = [vi.spyOn(globalThis, "fetch").mockImplementation(forbidden), vi.spyOn(net, "connect").mockImplementation(forbidden),
      vi.spyOn(net, "createConnection").mockImplementation(forbidden), vi.spyOn(tls, "connect").mockImplementation(forbidden),
      vi.spyOn(http, "request").mockImplementation(forbidden), vi.spyOn(https, "request").mockImplementation(forbidden),
      vi.spyOn(dns, "lookup").mockImplementation(forbidden),
      ...(["writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "renameSync", "rmSync", "unlinkSync", "copyFileSync",
        "symlinkSync", "linkSync", "truncateSync", "writeSync", "chmodSync", "utimesSync", "createWriteStream"] as const)
        .map(name => vi.spyOn(fs as unknown as Record<string, () => unknown>, name).mockImplementation(forbidden))];
    const open = vi.spyOn(fs, "openSync");
    const realEnv = process.env, envReads: PropertyKey[] = [], scope = globalThis as unknown as Record<string, unknown>;
    const timers = { setTimeout: scope.setTimeout, setInterval: scope.setInterval, setImmediate: scope.setImmediate };
    let timerCalls = 0, results: CsvPreview[] = [];
    try {
      process.env = new Proxy(realEnv, { get: (target, key) => { envReads.push(key); return Reflect.get(target, key); },
        has: (target, key) => { envReads.push(key); return Reflect.has(target, key); }, ownKeys: target => { envReads.push("*"); return Reflect.ownKeys(target); } });
      for (const name of Object.keys(timers)) scope[name] = () => { timerCalls++; throw Error("timer"); };
      results = [...paths.map(file => previewPriceFile(file, NOW)), ...buffers.map(bytes => previewPriceCsv(bytes, NOW))];
    } finally {
      process.env = realEnv;
      Object.assign(scope, timers);
    }
    const effectCalls = effects.map(spy => spy.mock.calls.length), openFlags = open.mock.calls.map(([, flags]) => Number(flags));
    vi.restoreAllMocks();
    expect(new Set(results.map(r => r.status))).toEqual(new Set(["PREVIEW_VALID_SYNTHETIC", "PREVIEW_QC_HOLD", "PREVIEW_HOLD"]));
    for (const result of results) expect(result).toMatchObject(NO_SIDE_EFFECTS);
    expect(effectCalls.every(count => count === 0)).toBe(true);
    const writeFlags = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
    expect(openFlags).toHaveLength(5);
    for (const flags of openFlags) expect(flags & writeFlags).toBe(0);
    expect(envReads).toEqual([]);
    expect(timerCalls).toBe(0);
  } finally {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("W05-P12 existing Yahoo/store paths unchanged and unreachable; CLI dispatch is bounded", () => {
  const modules = [...importClosure("src/server/market-prices/csv-preview.ts").keys()];
  for (const name of ["yahoo.ts", "store.ts", "rights.ts", "collector.ts", "backend.ts", "drive-backend.ts", "local-snapshot.ts"]) {
    expect(modules).not.toContain(`src/server/market-prices/${name}`);
  }
  const dataDir = tempDir();
  try {
    const env = { PATH: process.env.PATH ?? "", HOME: dataDir, DATA_DIR: dataDir, NODE_NO_WARNINGS: "1" };
    const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/market-prices.ts", ...args], { env, encoding: "utf8", timeout: 30000 });
    const good = run("price-file-preview", "--input", fixture(GOOD));
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout)).toMatchObject({ status: "PREVIEW_VALID_SYNTHETIC", fileSha256: EXPECTED.cases[GOOD].fileSha256, ...NO_SIDE_EFFECTS });
    const held = run("price-file-preview", "--input", fixture(INVALID));
    expect(held.status).toBe(1);
    expect(JSON.parse(held.stdout)).toMatchObject({ status: "PREVIEW_QC_HOLD", ...NO_SIDE_EFFECTS });
    const missing = run("price-file-preview");
    expect([missing.status, missing.stdout, missing.stderr.trim()]).toEqual([1, "", "price_file_preview_requires_input"]);
    const unknown = run("not-a-price-command");
    expect([unknown.status, unknown.stderr.trim()]).toEqual([1, "invalid_price_job_command"]);
    expect(fs.readdirSync(dataDir)).toEqual([]);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}, 60000);

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrivePriceCache } from "./drive-backend";
import { type ArchiveRepository } from "./drive-archive";
import { chartFixture, TEST_NOW } from "./fixtures";
import { parseYahooChart } from "./yahoo";
import { type InstrumentInput, PriceError } from "./model";
import { unpackPriceCatalogue } from "./drive-catalogue";
import { runPriceRefresh } from "./collector";

let root: string;
const index = { market: "US", symbol: "^GSPC" } as const;
const stock = { market: "US", symbol: "AAPL" } as const;
class MockRepository implements ArchiveRepository {
  files = new Map<string, Buffer>(); writes = 0;
  async latest() { const id = [...this.files.keys()].at(-1); return id ? { id, bytes: this.files.get(id)! } : null; }
  async get(id: string) { const bytes = this.files.get(id); if (!bytes) throw new PriceError("drive_http_404"); return bytes; }
  async publish(bytes: Buffer) { const id = "mock" + ++this.writes; const copy = Buffer.from(bytes); this.files.set(id, copy); return { id, bytes: copy }; }
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-drive-"));
  for (const [k, v] of Object.entries({ DATA_DIR: root, ENCRYPTION_KEY: "ab".repeat(32), MARKET_PRICES_PROFILE: "reviewed-pilot-v1",
    MARKET_PRICES_DRIVE_SINGLE_WRITER: "1", MARKET_PRICES_ENABLED: "1", MARKET_PRICES_REFRESH_ENABLED: "1", MARKET_PRICES_SCHEDULE: "external" })) vi.stubEnv(k, v);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const fetcher = async (input: InstrumentInput) => {
  const raw = chartFixture(input);
  if (input.symbol === "^GSPC") for (const k of ["open", "high", "low", "volume"] as const)
    (raw.chart.result[0].indicators.quote[0][k] as (number | null)[]).fill(null);
  return parseYahooChart(raw, input, TEST_NOW);
};
const options = { now: TEST_NOW, fetcher, pause: async () => {}, watchlist: [stock, index] };

it("reports a held cached listing as RIGHTS_HOLD even when its source refresh is not due", async () => {
  const archives = new MockRepository(), catalogues = new MockRepository(), cache = new DrivePriceCache(archives, catalogues);
  try {
    await cache.refresh(options);
    vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", JSON.stringify({ provider: "yahoo-chart", scope: "private_team_archive",
      evidenceRef: "SYNTHETIC-ONLY-NOT-A-LICENSE", termsUrl: "https://terms.example.invalid/test",
      reviewedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z", instrumentIds: ["US:AAPL"] }));
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("no real network"));
    const writes = archives.writes + catalogues.writes;
    const result = await cache.refresh({ now: TEST_NOW, watchlist: [stock, index] });
    expect(result).toMatchObject({ status: "partial_failure", listingReceipts: expect.arrayContaining([
      expect.objectContaining({ instrumentId: "US:AAPL", status: "ALREADY_CURRENT" }),
      expect.objectContaining({ instrumentId: "US:^GSPC", status: "RIGHTS_HOLD" }),
    ]) });
    expect(network).not.toHaveBeenCalled(); expect(archives.writes + catalogues.writes).toBe(writes);
  } finally { cache.close(); }
});

it("cold-reads signed close-only series, preserves removed watchlist history and replays without duplicate archives", async () => {
  const archives = new MockRepository(), catalogues = new MockRepository();
  let cache = new DrivePriceCache(archives, catalogues);
  try {
    const first = await cache.refresh(options);
    expect(first).toMatchObject({ status: "complete", listingReceipts: expect.arrayContaining([expect.objectContaining({ instrumentId: "US:^GSPC", status: "UPDATED", latestSessionDate: "2026-10-15", rowCount: 2 })]) });
    expect(archives.writes).toBe(2);
    cache.close(); cache = new DrivePriceCache(archives, catalogues);
    expect(await cache.read(s => s.read(index), [index])).toMatchObject({ total: 2, seriesSchemaVersion: 2,
      bars: [expect.objectContaining({ open: null, volume: null, completeness: "close_only" }), expect.objectContaining({ close: 12 })] });
    const replay = await cache.refresh(options);
    expect(replay.listingReceipts.every(r => r.status === "ALREADY_CURRENT")).toBe(true);
    expect(archives.writes).toBe(2);
    await cache.refresh({ ...options, watchlist: [stock], force: true });
    const last = (await catalogues.latest())!;
    expect(unpackPriceCatalogue(last.bytes).entries).toHaveLength(2);
    cache.close(); cache = new DrivePriceCache(archives, catalogues);
    expect(await cache.read(s => s.read(index), [index])).toMatchObject({ total: 2 });
    expect(fs.existsSync(path.join(root, "market-prices", "prices.sqlite"))).toBe(false);
  } finally { cache.close(); }
});
it("publishes no catalogue pointer after archive creation followed by catalogue permission denial", async () => {
  const archives = new MockRepository(), catalogues = new MockRepository(), cache = new DrivePriceCache(archives, catalogues);
  vi.spyOn(catalogues, "publish").mockRejectedValue(new PriceError("drive_http_403"));
  try {
    await expect(cache.refresh({ ...options, watchlist: [stock] })).rejects.toThrow("drive_http_403");
    expect(archives.writes).toBe(1); expect(catalogues.writes).toBe(0);
    expect(await new DrivePriceCache(archives, catalogues).read(s => s.instruments())).toMatchObject({ available: false });
  } finally { cache.close(); }
});
it.each(["missing", "corrupt"])("fails closed for a %s referenced partition", async kind => {
  const archives = new MockRepository(), catalogues = new MockRepository();
  const writer = new DrivePriceCache(archives, catalogues);
  await writer.refresh({ ...options, watchlist: [stock] }); writer.close();
  const id = [...archives.files.keys()][0];
  if (kind === "missing") archives.files.delete(id); else archives.files.set(id, Buffer.from("corrupt"));
  const reader = new DrivePriceCache(archives, catalogues);
  try { await expect(reader.read(s => s.read(stock), [stock])).rejects.toThrow(kind === "missing" ? "drive_http_404" : "drive_partition_checksum_mismatch"); }
  finally { reader.close(); }
});
it("reports stale series per symbol while preserving useful history and healthy listing receipt", async () => {
  const archives = new MockRepository(), catalogues = new MockRepository(), cache = new DrivePriceCache(archives, catalogues);
  try {
    const result = await runPriceRefresh({ ...options, trigger: "job", batch: o => cache.refresh(o),
      fetcher: async input => {
        const snap = await fetcher(input); if (input.symbol === "^GSPC") snap.bars.pop(); return snap;
      } });
    expect(result.status).toBe("partial_failure");
    expect(result.listingReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ instrumentId: "US:AAPL", status: "UPDATED" }),
      expect.objectContaining({ instrumentId: "US:^GSPC", status: "STALE_SOURCE", latestSessionDate: "2026-10-14" }),
    ]));
    expect(await cache.read(s => s.read(index), [index])).toMatchObject({ total: 1, latestRefresh: { success: 0, error_code: "stale_source_session" } });
  } finally { cache.close(); }
});
it("stops at 429 and reports later symbols as interrupted rather than updated", async () => {
  const archives = new MockRepository(), catalogues = new MockRepository(), cache = new DrivePriceCache(archives, catalogues);
  const limited = vi.fn(async () => { throw new PriceError("provider_rate_limited"); });
  try {
    const result = await runPriceRefresh({ ...options, fetcher: limited, trigger: "job", batch: o => cache.refresh(o) });
    expect(limited).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("partial_failure");
    expect(result.listingReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ instrumentId: "US:AAPL", status: "FAILED", reason: "provider_rate_limited" }),
      expect.objectContaining({ instrumentId: "US:^GSPC", status: "FAILED", reason: "not_attempted_or_interrupted" }),
    ]));
  } finally { cache.close(); }
});

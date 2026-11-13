import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPriceTools } from "../mcp/price-tools.ts";
import { DrivePriceCache } from "./drive-backend.ts";
import { unpackDriveArchive, type ArchiveRepository } from "./drive-archive.ts";
import { unpackPriceCatalogue } from "./drive-catalogue.ts";
import { PriceStore } from "./store.ts";
import { runPriceRefresh } from "./collector.ts";
import { instrumentSchema, instrument, PriceError, type InstrumentInput } from "./model.ts";
import { MVP_PILOT } from "./universe.ts";
import { fetchYahooDaily } from "./yahoo.ts";
import { DEMO_CLOSURES, syntheticDailyChart } from "./offline-fixtures.ts";

const hash = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
export function offlineWatchlist(value: unknown = MVP_PILOT): InstrumentInput[] {
  try {
    const list = z.array(instrumentSchema).min(1).max(5).parse(value);
    const ids = list.map(i => instrument(i).id);
    if (new Set(ids).size !== ids.length || ids.some(id => !MVP_PILOT.some(i => instrument(i).id === id))) throw Error();
    return list;
  } catch { throw new PriceError("invalid_offline_watchlist_choose_up_to_five_pilot_symbols"); }
}
/** In-memory analogue of immutable Drive generations; no OAuth, HTTP or filesystem payloads. */
class OfflineArchives implements ArchiveRepository {
  private files = new Map<string, Buffer>();
  writes = 0;
  async latest() { const id = [...this.files.keys()].at(-1); return id ? { id, bytes: await this.get(id) } : null; }
  async get(id: string) { const bytes = this.files.get(id); if (!bytes) throw new PriceError("offline_archive_missing"); return Buffer.from(bytes); }
  async publish(bytes: Buffer) {
    const copy = Buffer.from(bytes), id = `offline_${++this.writes}_${hash(copy).slice(0, 20)}`;
    this.files.set(id, copy); return { id, bytes: Buffer.from(copy) };
  }
  manifest() { return [...this.files].map(([id, bytes]) => ({ id, bytes: bytes.length, sha256: hash(bytes) })); }
}
let demoBusy = false;
/** CLI-only disposable fixture demonstration. Never imported by an HTTP route or scheduled collector. */
export async function runOfflinePriceDemo(value?: unknown) {
  const watchlist = offlineWatchlist(value);
  if (demoBusy) throw new PriceError("offline_demo_busy");
  demoBusy = true;
  const previousFetch = globalThis.fetch, oldEnv = new Map<string, string | undefined>();
  let root: string | undefined, cache: DrivePriceCache | undefined, server: McpServer | undefined, client: Client | undefined;
  let networkAttempts = 0, fixtureRequests = 0;
  const set = (name: string, value: string | undefined) => {
    oldEnv.set(name, process.env[name]);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  };
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-prices-offline-"));
    fs.chmodSync(root, 0o700);
    for (const [name, value] of Object.entries({ DATA_DIR: root, ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
      MARKET_PRICES_PROFILE: "free-first-mvp-v1", MARKET_PRICES_ENABLED: "1", MARKET_PRICES_REFRESH_ENABLED: "1",
      MARKET_PRICES_SCHEDULE: "external", MARKET_PRICES_STORAGE: "google-drive", MARKET_PRICES_DRIVE_SINGLE_WRITER: "1",
      MARKET_PRICES_BATCH_SIZE: "5", MARKET_PRICES_MAX_DB_MB: "4", MARKET_PRICES_WATCHLIST: JSON.stringify(watchlist),
      MARKET_PRICES_SESSION_CLOSURES: JSON.stringify({ US: DEMO_CLOSURES }) })) set(name, value);
    set("MARKET_PRICES_DIR", undefined);
    set("MARKET_PRICES_RIGHTS_REVIEW", undefined); // No fabricated operator attestation, even in the demo.
    globalThis.fetch = async () => { networkAttempts++; throw new PriceError("offline_network_disabled"); };
    const jobId = crypto.randomUUID(), archives = new OfflineArchives(), catalogues = new OfflineArchives();
    cache = new DrivePriceCache(archives, catalogues);
    const phases = [
      { name: "backfill", now: "2026-10-15T03:23:00Z" },
      { name: "next_day_increment", now: "2026-10-16T03:23:00Z" },
      { name: "same_day_replay", now: "2026-10-16T03:23:00Z" },
      { name: "late_correction", now: "2026-10-17T03:23:00Z", correction: true },
      { name: "before_holiday", now: "2026-12-25T03:23:00Z", correction: true },
      { name: "holiday_no_session", now: "2026-12-26T03:23:00Z", correction: true },
      { name: "quality_rejection", now: "2026-12-29T03:23:00Z", correction: true, quality: true },
      { name: "rate_limit_stop", now: "2026-12-30T03:23:00Z", limited: true },
    ];
    const receipts: { receiptId: string; sha256: string; body: Record<string, unknown> }[] = [];
    for (const phase of phases) {
      const now = new Date(phase.now), before = fixtureRequests, writes = archives.writes;
      const fetcher: typeof fetchYahooDaily = async (input, options) => {
        const snapshot = await fetchYahooDaily(input, { ...options, fetcher: async () => {
          if (++fixtureRequests > 40) throw new PriceError("offline_total_request_budget_exhausted");
          if (phase.limited) return new Response(null, { status: 429 });
          const fault = phase.quality ? input.symbol === "AAPL" ? "anomaly" : input.symbol === "MSFT" ? "partial" : undefined : undefined;
          return new Response(JSON.stringify(syntheticDailyChart(input, now, { start: options?.start, correction: phase.correction, fault })));
        } });
        snapshot.dataOrigin = "synthetic_fixture";
        return snapshot;
      };
      const result = await runPriceRefresh({ trigger: "job", now, watchlist, fetcher, pause: async () => {}, batch: o => cache!.refresh(o) });
      const receiptId = crypto.randomUUID(), body = { syntheticOnly: true, jobId, receiptId, phase: phase.name,
        simulatedAt: phase.now, status: result.status, fixtureRequests: fixtureRequests - before,
        newArchiveGenerations: archives.writes - writes, changes: result.results, listings: result.listingReceipts };
      receipts.push({ receiptId, sha256: hash(JSON.stringify(body)), body });
      if (phase.name === "backfill") { cache.close(); cache = new DrivePriceCache(archives, catalogues); }
    }
    // Actual MCP SDK transport + the existing registered tools, with only the archive reader injected.
    server = new McpServer({ name: "ios-prices-synthetic-demo", version: "1.0" });
    registerPriceTools(server, (read, requested) => cache!.read(read, requested));
    client = new Client({ name: "offline-analyst-fixture", version: "1.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const aiReaderResults: unknown[] = [];
    for (const input of watchlist) {
      const reply = await client.callTool({ name: "read_price_bars", arguments: { ...input, limit: 2 } });
      if (reply.isError) throw new PriceError("offline_mcp_read_failed");
      aiReaderResults.push(JSON.parse((reply.content as { text: string }[])[0].text));
    }
    const listed = await client.callTool({ name: "list_price_instruments", arguments: {} });
    if (listed.isError) throw new PriceError("offline_mcp_list_failed");
    const latest = await archives.latest(), damaged = Buffer.from(latest!.bytes);
    damaged[damaged.length - 1] ^= 1;
    let tamperRejected = false;
    try { unpackDriveArchive(damaged); } catch (e) { tamperRejected = e instanceof PriceError && e.code === "drive_snapshot_integrity_failed"; }
    const catalogue = unpackPriceCatalogue((await catalogues.latest())!.bytes);
    const corrected = catalogue.entries.find(e => e.instrument.symbol === "AAPL");
    let revisionEvidence: unknown[] = [];
    if (corrected) {
      const audit = new PriceStore(unpackDriveArchive(await archives.get(corrected.archiveId)).database);
      try { revisionEvidence = audit.db.prepare("SELECT date,observed_at AS observedAt,before_json AS beforeValues,after_json AS afterValues FROM revisions ORDER BY id LIMIT 10").all(); }
      finally { audit.close(); }
    }
    let liveRightsHold = false;
    try { await fetchYahooDaily(watchlist[0], { now: new Date("2026-12-30T03:23Z") }); }
    catch (e) { liveRightsHold = e instanceof PriceError && e.code === "price_rights_hold"; }
    if (!liveRightsHold || !tamperRejected || networkAttempts) throw new PriceError("offline_safety_invariant_failed");
    return { status: "OFFLINE_DEMO_COMPLETE", syntheticOnly: true, jobId, requested: watchlist.map(instrument),
      simulatedWindow: { start: "2025-10-01", end: "2026-12-29", calendar: "illustrative_weekdays_plus_explicit_closures_not_official" },
      rights: { liveStatus: "RIGHTS_HOLD", operatorAttestationUsed: false },
      cost: { marketApiRequests: 0, googleDriveRequests: 0, networkAttempts, apiCostUSD: 0, fixtureRequests,
        maxFixtureRequests: 40, maxSymbols: 5, maxRequestsPerRun: 10, parallelCollection: false, automaticRetries: 0 },
      receipts, revisionEvidence, integrity: { tamperRejected, archives: archives.manifest(), catalogues: catalogues.manifest() },
      aiReader: { transport: "MCP_SDK_InMemoryTransport", tools: ["read_price_bars", "list_price_instruments"],
        instruments: JSON.parse((listed.content as { text: string }[])[0].text), results: aiReaderResults },
      persistence: "All price/archive/catalogue bytes are synthetic RAM fixtures; disposable lock directory removed before return. stdout receipt may be saved locally.",
      activation: { schedulerEnabled: false, realDriveEnabled: false, liveProviderEnabled: false } };
  } finally {
    try { await client?.close(); } finally {
      try { await server?.close(); } finally {
        cache?.close();
        globalThis.fetch = previousFetch;
        for (const [name, value] of oldEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
        if (root) fs.rmSync(root, { recursive: true, force: true });
        demoBusy = false;
      }
    }
  }
}

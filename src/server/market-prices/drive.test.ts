import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceStore, priceDbPath } from "./store";
import { PriceError, instrument, type PriceBar, type InstrumentInput } from "./model";
import { DrivePriceCache } from "./drive-backend";
import { inProcessDrWriterFence } from "../backup/writer-fence";
import { packDriveArchive, unpackDriveArchive, GoogleDriveArchives, DRIVE_DB_LIMIT, type ArchiveRepository } from "./drive-archive";
import { beginDriveConsent, finishDriveConsent, sealDriveCredential, driveAccessToken, DRIVE_SCOPE } from "./drive-auth";
import { prepareDriveCredential, claimDriveCredential } from "./drive-admin";
import { packPriceCatalogue, unpackPriceCatalogue } from "./drive-catalogue";
import { googleBytes } from "./drive-http";
import { parseYahooChart } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";
import { runPriceRefresh } from "./collector";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "drive-prices-"));
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("ENCRYPTION_KEY", "12".repeat(32));
  vi.stubEnv("BASE_URL", "https://investment.example");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("MARKET_PRICES_DRIVE_SINGLE_WRITER", "1");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });
const options = { now: TEST_NOW, pause: async () => {},
  fetcher: async (input: { market: "US" | "TH" | "HK" | "JP"; symbol: string }) => parseYahooChart(chartFixture(input), input, TEST_NOW) };
class MemoryRepository implements ArchiveRepository {
  files = new Map<string, Buffer>();
  writes = 0; reads = 0;
  async latest() { const id = [...this.files.keys()].at(-1); return id ? { bytes: this.files.get(id)!, id } : null; }
  async get(id: string) { this.reads++; const value = this.files.get(id); if (!value) throw Error("missing fixture"); return value; }
  async publish(bytes: Buffer) { const id = "archive" + ++this.writes; const copy = Buffer.from(bytes); this.files.set(id, copy); return { bytes: copy, id }; }
}

it("DR freeze refuses direct DrivePriceCache.refresh before any remote or local writer work",async()=>{
  const partitions = new MemoryRepository(),catalogues = new MemoryRepository();
  const latest=vi.spyOn(catalogues,"latest"),publish=vi.spyOn(partitions,"publish");
  const cache=new DrivePriceCache(partitions,catalogues);
  try {
    await inProcessDrWriterFence.withFrozenWriters(async()=>{
      await expect(cache.refresh(options)).rejects.toThrow("backup_writer_freeze_active");
      expect(latest).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(inProcessDrWriterFence.status.activeWriters).toBe(0);
    });
    expect(inProcessDrWriterFence.status).toEqual({frozen:false,activeWriters:0});
  }finally{cache.close();}
});

it("DR freeze waits for direct async Drive cache refresh before allowing snapshot",async()=>{
  const partitions=new MemoryRepository(),catalogues=new MemoryRepository();
  const cache=new DrivePriceCache(partitions,catalogues);
  let unpause!:()=>void,fetchEntered=false,snapshotStarted=false;
  const gate=new Promise<void>(resolve=>{unpause=resolve;});
  const fetcher=async(input:InstrumentInput)=>{
    fetchEntered=true;
    await gate;
    return parseYahooChart(chartFixture(input),input,TEST_NOW);
  };
  try {
    const writer=cache.refresh({...options,fetcher});
    await vi.waitFor(()=>expect(fetchEntered).toBe(true));
    const snapshot=inProcessDrWriterFence.withFrozenWriters(()=>{
      snapshotStarted=true;
      expect(inProcessDrWriterFence.status.activeWriters).toBe(0);
      expect(catalogues.writes).toBeGreaterThan(0);
    });
    expect(inProcessDrWriterFence.status.frozen).toBe(true);
    expect(inProcessDrWriterFence.status.activeWriters).toBeGreaterThan(0);
    expect(snapshotStarted).toBe(false);
    await expect(cache.refresh(options)).rejects.toThrow("backup_writer_freeze_active");
    expect(catalogues.writes).toBe(0);
    unpause();
    await writer;
    await snapshot;
    expect(snapshotStarted).toBe(true);
    expect(inProcessDrWriterFence.status).toEqual({frozen:false,activeWriters:0});
  }finally{unpause();cache.close();}
});

it("drains multiple signed Drive batches in one run, reads back after restart and does not duplicate a day", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_SCHEDULE", "external");
  const files = new MemoryRepository(), catalogues = new MemoryRepository();
  let cache = new DrivePriceCache(files, catalogues);
  const batch = (o: Parameters<typeof cache.refresh>[0]) => cache.refresh(o);
  const result = await runPriceRefresh({ ...options, trigger: "job", batch });
  expect(result).toMatchObject({ status: "complete", batches: 2, remainingDue: 0, universeSize: 8 });
  expect(files.writes).toBe(8); expect(catalogues.writes).toBe(2); cache.close();
  cache = new DrivePriceCache(files, catalogues);
  const same = await runPriceRefresh({ ...options, trigger: "admin", batch });
  expect(same).toMatchObject({ status: "complete", batches: 1 }); expect(files.writes).toBe(8);
  expect(await cache.read(s => s.read({ market: "US", symbol: "NVDA" }), [{ market: "US", symbol: "NVDA" }])).toMatchObject({ total: 2 });
  cache.close(); expect(fs.existsSync(priceDbPath())).toBe(false);
});

it("drains all bounded Drive batches and removes the lock before a DR snapshot can start", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1");
  vi.stubEnv("MARKET_PRICES_SCHEDULE", "external");
  const files = new MemoryRepository(), catalogues = new MemoryRepository();
  const cache = new DrivePriceCache(files, catalogues);
  let release!: () => void, entered = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const batch = (o: Parameters<typeof cache.refresh>[0]) => cache.refresh(o);
  const run = runPriceRefresh({ ...options, trigger: "job", batch, fetcher: async input => {
    entered = true; await held; return parseYahooChart(chartFixture(input), input, TEST_NOW);
  } });
  let snapshot: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    let captured = false;
    snapshot = inProcessDrWriterFence.withFrozenWriters(() => {
      captured = true;
      expect(catalogues.writes).toBe(2); expect(files.writes).toBe(8);
      expect(fs.existsSync(path.join(path.dirname(priceDbPath()), "refresh-run.lock"))).toBe(false);
    });
    expect(captured).toBe(false);
    await expect(runPriceRefresh({ ...options, trigger: "admin", batch })).rejects.toThrow("backup_writer_freeze_active");
    release();
    expect(await run).toMatchObject({ status: "complete", batches: 2, remainingDue: 0 });
    await snapshot;
    expect(captured).toBe(true);
    expect(inProcessDrWriterFence.status).toEqual({ frozen: false, activeWriters: 0 });
  } finally { release(); await run; await snapshot; cache.close(); }
});

it("opens a bounded memory DB without touching a filesystem and authenticates a closed archive", () => {
  const disk = vi.spyOn(fs, "statfsSync").mockImplementation(() => { throw Error("no disk"); });
  const store = new PriceStore(":memory:", true);
  store.save(parseYahooChart(chartFixture(), { market: "US", symbol: "NVDA" }, TEST_NOW));
  const packed = packDriveArchive(store.db.serialize(), TEST_NOW); store.close();
  const decoded = unpackDriveArchive(packed), reader = new PriceStore(decoded.database);
  expect(reader.read({ market: "US", symbol: "NVDA" }).total).toBe(2);
  expect(reader.status().storage.mode).toBe("memory");
  expect(() => reader.db.prepare("DELETE FROM bars").run()).toThrow(); reader.close();
  expect(disk).not.toHaveBeenCalled(); expect(fs.readdirSync(root)).toEqual([]);
});
it("refuses tampering and a wrong signing key before SQLite is opened", () => {
  const store = new PriceStore(":memory:", true), packed = packDriveArchive(store.db.serialize()); store.close();
  const changed = Buffer.from(packed); changed[changed.length - 5] ^= 1;
  expect(() => unpackDriveArchive(changed)).toThrow("drive_snapshot_integrity_failed");
  vi.stubEnv("ENCRYPTION_KEY", "34".repeat(32));
  expect(() => unpackDriveArchive(packed)).toThrow("drive_snapshot_integrity_failed");
  expect(() => packDriveArchive(Buffer.alloc(DRIVE_DB_LIMIT + 1))).toThrow("drive_snapshot_limit_exceeded");
});
it("publishes bounded batches and a verified catalogue, preserving provider cooldown across restart", async () => {
  const repository = new MemoryRepository(), catalogues = new MemoryRepository(), cache = new DrivePriceCache(repository, catalogues);
  expect(await cache.read(s => s.status())).toMatchObject({ available: false });
  const first = await cache.refresh(options); expect(first.results).toHaveLength(5); expect(first).toMatchObject({ status: "batch_complete", remainingDue: 3 });
  const network = vi.spyOn(globalThis, "fetch");
  expect(await cache.read(s => s.read({ market: "US", symbol: "NVDA" }), [{ market: "US", symbol: "NVDA" }])).toMatchObject({ total: 2, archive: { catalogueId: "archive1", lastError: null } });
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  expect((await cache.refresh(options)).results).toHaveLength(3);
  expect((await cache.refresh(options)).results).toHaveLength(0); cache.close();
  const restarted = new DrivePriceCache(repository, catalogues);
  expect((await restarted.refresh(options)).results).toHaveLength(0);
  const limited = vi.fn(async () => { throw new PriceError("provider_rate_limited"); });
  await restarted.refresh({ ...options, force: true, fetcher: limited }); restarted.close();
  const afterFailure = new DrivePriceCache(repository, catalogues);
  expect((await afterFailure.refresh({ ...options, force: true, fetcher: limited })).status).toBe("provider_cooldown");
  expect(limited).toHaveBeenCalledTimes(1); afterFailure.close();
  expect(fs.readdirSync(root)).toEqual([]);
});
it("retains the previous verified catalogue/cache when upload readback fails", async () => {
  const repository = new MemoryRepository(), catalogues = new MemoryRepository(), cache = new DrivePriceCache(repository, catalogues);
  await cache.refresh(options);
  const requested = [{ market: "US" as const, symbol: "NVDA" }];
  await cache.read(s => s.read(requested[0]), requested);
  vi.spyOn(repository, "publish").mockResolvedValue({ id: "bad", bytes: Buffer.from("corrupt") });
  await expect(cache.refresh({ ...options, force: true })).rejects.toThrow("drive_readback_mismatch");
  expect(await cache.read(s => s.read(requested[0]), requested)).toMatchObject({ total: 2, archive: { lastError: "drive_readback_mismatch" } });
  expect((await cache.refresh(options)).status).toBe("drive_retry_backoff"); cache.close();
});
it("refuses a second writer and malformed watchlist before storage/network work", async () => {
  const repository = new MemoryRepository(), read = vi.spyOn(repository, "latest"), cache = new DrivePriceCache(repository, new MemoryRepository());
  vi.stubEnv("MARKET_PRICES_DRIVE_SINGLE_WRITER", "0");
  await expect(cache.refresh(options)).rejects.toThrow("drive_single_writer_required");
  vi.stubEnv("MARKET_PRICES_DRIVE_SINGLE_WRITER", "1");
  await expect(cache.refresh({ watchlist: [{ market: "US", symbol: "../BAD" }] })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled(); cache.close();
});
it("covers 200 instruments in bounded batches and reads only requested partitions with bounded RAM", async () => {
  const repository = new MemoryRepository(), catalogues = new MemoryRepository(), cache = new DrivePriceCache(repository, catalogues);
  const watchlist = Array.from({ length: 200 }, (_, i) => ({ market: "US" as const, symbol: "A" + i }));
  const bars: PriceBar[] = [];
  for (const day = new Date("2021-10-18T00:00Z"); bars.length < 1250; day.setUTCDate(day.getUTCDate() + 1)) {
    if ([0, 6].includes(day.getUTCDay())) continue;
    bars.push({ date: day.toISOString().slice(0, 10), open: 10, high: 12, low: 9, close: 11, volume: 1000, adjustedClose: 10.5 });
  }
  const fetcher = async (input: InstrumentInput) => ({ instrument: instrument(input), source: "yahoo-chart" as const,
    fetchedAt: TEST_NOW.toISOString(), bars, actions: [], quarantinedBars: [], missingBars: 0, excludedCurrentSession: 0 });
  let result;
  for (let i = 0; i < 40; i++) {
    result = await cache.refresh({ ...options, watchlist, fetcher });
    expect(result.results.length).toBeLessThanOrEqual(5);
  }
  expect(result).toMatchObject({ status: "complete", remainingDue: 0, universeSize: 200 });
  expect(unpackPriceCatalogue((await catalogues.latest())!.bytes).entries).toHaveLength(200);
  expect(unpackPriceCatalogue((await catalogues.latest())!.bytes).entries.reduce((sum, entry) => sum + entry.barCount, 0)).toBe(250000);
  expect(repository.reads).toBe(0); cache.close();
  const restarted = new DrivePriceCache(repository, catalogues);
  expect(await restarted.read(s => ({ instruments: s.instruments() }))).toMatchObject({ instruments: expect.any(Array) });
  expect(repository.reads).toBe(0);
  await restarted.read(s => ({ first: s.read(watchlist[0]), second: s.read(watchlist[1]) }), watchlist.slice(0, 2));
  expect(repository.reads).toBe(2);
  for (const input of watchlist.slice(2, 12)) await restarted.read(s => s.read(input), [input]);
  const status = await restarted.read(s => s.status());
  expect(status).toMatchObject({ storage: { cachedPartitionCount: 8, maxCachedPartitions: 8 } });
  expect((status as { storage: { cachedDatabaseBytes: number } }).storage.cachedDatabaseBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  const network = repository.reads;
  await restarted.read(s => s.read(watchlist[11]), [watchlist[11]]); expect(repository.reads).toBe(network);
  expect(fs.readdirSync(root)).toEqual([]); restarted.close();
}, 60000);
it("authenticates catalogue capacity and rejects tampered metadata", () => {
  const bytes = packPriceCatalogue({ version: 2, updatedAt: TEST_NOW.toISOString(), providerRetryAfter: null, entries: [] });
  const altered = Buffer.from(bytes.toString().replace("2026", "2025"));
  expect(() => unpackPriceCatalogue(altered)).toThrow("drive_catalogue_integrity_failed");
});
it("keeps source cooldown in-process even if Drive cannot persist the failure receipt", async () => {
  vi.useFakeTimers(); vi.setSystemTime(TEST_NOW);
  const repository = new MemoryRepository(), catalogues = new MemoryRepository(), cache = new DrivePriceCache(repository, catalogues);
  vi.spyOn(repository, "publish").mockRejectedValue(new PriceError("drive_request_failed"));
  const fetcher = vi.fn(async () => { throw new PriceError("provider_rate_limited"); });
  await expect(cache.refresh({ ...options, fetcher })).rejects.toThrow("drive_request_failed");
  vi.advanceTimersByTime(11 * 60 * 1000);
  expect((await cache.refresh({ ...options, now: new Date(), fetcher, force: true })).status).toBe("provider_cooldown");
  expect(fetcher).toHaveBeenCalledTimes(1); cache.close();
});
it("binds consent to the admin, exact callback and PKCE, then consumes state once", async () => {
  const url = new URL(beginDriveConsent("admin1")), state = url.searchParams.get("state")!;
  expect(url.searchParams.get("scope")).toBe(DRIVE_SCOPE);
  expect(url.searchParams.get("redirect_uri")).toBe("https://investment.example/api/market-prices-drive/callback");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 3600, refresh_token: "refresh-test-token", scope: DRIVE_SCOPE })));
  await expect(finishDriveConsent("other", state, "code")).rejects.toThrow("drive_invalid_oauth_state");
  expect(network).not.toHaveBeenCalled();
  const sealed = await finishDriveConsent("admin1", state, "code"); expect(sealed).not.toContain("refresh-test-token");
  await expect(finishDriveConsent("admin1", state, "code")).rejects.toThrow("drive_invalid_oauth_state");
  const body = new URLSearchParams(String(network.mock.calls[0][1]?.body));
  expect(body.get("code_verifier")).toBeTruthy(); expect(body.get("grant_type")).toBe("authorization_code");
});
it("rejects expired consent, insufficient offline consent and broader scopes", async () => {
  vi.useFakeTimers();
  const expired = new URL(beginDriveConsent("admin1")).searchParams.get("state")!;
  vi.advanceTimersByTime(6 * 60 * 1000);
  await expect(finishDriveConsent("admin1", expired, "code")).rejects.toThrow("drive_invalid_oauth_state");
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 3600, scope: DRIVE_SCOPE })));
  let state = new URL(beginDriveConsent("admin1")).searchParams.get("state")!;
  await expect(finishDriveConsent("admin1", state, "code")).rejects.toThrow("drive_offline_consent_required");
  network.mockResolvedValue(new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 3600, refresh_token: "refresh-test-token", scope: "https://www.googleapis.com/auth/drive" })));
  state = new URL(beginDriveConsent("admin1")).searchParams.get("state")!;
  await expect(finishDriveConsent("admin1", state, "code")).rejects.toThrow("drive_oauth_scope_refused");
});
it("keeps the prepared credential private, admin-bound, expiring and single-use", () => {
  const id = prepareDriveCredential("admin1", "encrypted-value");
  expect(() => claimDriveCredential("other", id)).toThrow();
  expect(claimDriveCredential("admin1", id)).toBe("encrypted-value");
  expect(() => claimDriveCredential("admin1", id)).toThrow();
  vi.useFakeTimers(); const expired = prepareDriveCredential("admin1", "encrypted-value");
  vi.advanceTimersByTime(11 * 60 * 1000); expect(() => claimDriveCredential("admin1", expired)).toThrow();
});
it("refreshes only a correctly sealed client-bound credential, never exposing tokens", async () => {
  vi.stubEnv("MARKET_PRICES_DRIVE_CREDENTIAL", sealDriveCredential("refresh-test-token"));
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 3600, scope: DRIVE_SCOPE })));
  expect(await driveAccessToken()).toBe("access-test-token"); expect(await driveAccessToken()).toBe("access-test-token");
  expect(network).toHaveBeenCalledTimes(1);
  vi.stubEnv("MARKET_PRICES_DRIVE_CREDENTIAL", "broken");
  await expect(driveAccessToken()).rejects.toThrow("drive_credential_missing_or_invalid");
});
it("enforces fixed origins, response limits and redacts errors without retrying", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private-provider-error", { status: 429 }));
  await expect(googleBytes("https://evil.example/file")).rejects.toThrow("drive_origin_refused");
  expect(network).not.toHaveBeenCalled();
  await expect(googleBytes("https://www.googleapis.com/drive/v3/files")).rejects.toThrow("drive_http_429");
  expect(network).toHaveBeenCalledTimes(1);
  network.mockResolvedValue(new Response("123456"));
  await expect(googleBytes("https://www.googleapis.com/drive/v3/files", {}, 5)).rejects.toThrow("drive_response_too_large");
  expect(network.mock.calls[1][1]?.redirect).toBe("error");
});
it("uses private multipart creates and exact readback; never deletes, patches or shares files", async () => {
  vi.stubEnv("MARKET_PRICES_DRIVE_CREDENTIAL", sealDriveCredential("refresh-test-token"));
  const store = new PriceStore(":memory:", true), packed = packDriveArchive(store.db.serialize()); store.close();
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 3600 }));
    if (url.includes("uploadType=multipart")) {
      expect(Buffer.isBuffer(init?.body)).toBe(true);
      expect(Buffer.from(init!.body as Buffer).includes(packed)).toBe(true);
      return new Response(JSON.stringify({ id: "archive1" }));
    }
    if (url.includes("alt=media")) return new Response(new Uint8Array(packed));
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "folder1" }));
    return new Response(JSON.stringify({ files: [] }));
  });
  const repository = new GoogleDriveArchives(); expect(await repository.latest()).toBeNull();
  expect((await repository.publish(packed)).bytes).toEqual(packed);
  expect(network.mock.calls.every(([, init]) => [undefined, "POST"].includes(init?.method))).toBe(true);
  expect(network.mock.calls.every(([url]) => !String(url).includes("permissions"))).toBe(true);
});

it("a long-lived read server sees another authorized run's new signed catalogue without restart", async () => {
  const files = new MemoryRepository(), catalogues = new MemoryRepository();
  const writer = new DrivePriceCache(files, catalogues), reader = new DrivePriceCache(files, catalogues);
  await writer.refresh(options);
  const before = await reader.read(s => s.status()) as { archive: { catalogueId: string } };
  await writer.refresh(options);
  const clock = Date.now(); vi.spyOn(Date,"now").mockReturnValue(clock + 61000);
  const after = await reader.read(s => s.status()) as { archive: { catalogueId: string }; instruments: unknown[] };
  expect(after.archive.catalogueId).not.toBe(before.archive.catalogueId); expect(after.instruments).toHaveLength(8);
  reader.close(); writer.close();
});

it("a delayed catalogue read cannot replace a newer generation published by the running collector", async () => {
  const files = new MemoryRepository(), catalogues = new MemoryRepository(), cache = new DrivePriceCache(files,catalogues);
  await cache.refresh(options); const old = await catalogues.latest();
  const original = catalogues.latest.bind(catalogues);
  let release!: (value: typeof old) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(Date,"now").mockReturnValue(Date.now()+61000);
  vi.spyOn(catalogues,"latest").mockImplementationOnce(() => { entered(); return new Promise(resolve => { release=resolve; }); }).mockImplementation(original);
  const delayed = cache.read(s=>({instruments:s.instruments()})); await started;
  await cache.refresh(options); release(old);
  const result = await delayed as { instruments: unknown[]; archive: { catalogueId: string } };
  expect(result.archive.catalogueId).toBe((await catalogues.latest())!.id);
  expect(result.instruments).toHaveLength(8);
  cache.close();
});

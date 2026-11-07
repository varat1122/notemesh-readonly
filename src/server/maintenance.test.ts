import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

vi.mock("./ob/cli", () => ({ obIsAuthenticated: async () => true, obSyncConfigured: async () => true,
  obSyncOnce: async () => ({ ok: true, combined: "" }), obSyncConfigs: async () => ({ ok: true, stdout: "", stderr: "", combined: "" }) }));

const KEY = Symbol.for("notemesh.maintenance.registry.v1");
let root: string;
const file = () => path.join(root, "maintenance.json");
const dbFile = () => path.join(root, "app.sqlite");
const id = "0f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const record = (state = "active", rid = id) => JSON.stringify({ version: 1, id: rid, state, requestedAt: "2026-11-07T00:00:00.000Z", settledAt: null, drain: null });
const req = (p: string, method = "GET") => new Request(`http://local${p}`, { method });
const event = (res: EventEmitter | null = new EventEmitter()) => ({ request: req("/api/mcp", "POST"), nativeEvent: res ? { node: { res } } : undefined });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maint-")));
  process.env.DATA_DIR = root;
  for (const k of ["NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"]) delete process.env[k];
  delete (globalThis as Record<symbol, unknown>)[KEY];
  vi.resetModules();
});
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  for (const k of ["DATA_DIR", "NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED",
    "NOTEMESH_MAINTENANCE_OPERATOR_ID", "CLOUD_INTAKE", "MARKET_PRICES_ENABLED"]) delete process.env[k];
});

describe("durable state and fail-closed reading", () => {
  it("is inactive without a record; a begun maintenance is durable, verified and 0600 before anything else", async () => {
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(false);
    const r = m.beginMaintenance();
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ version: 1, id: r.id, state: "draining" });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root).filter((n) => n.includes(".tmp"))).toEqual([]);
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "process", state: "draining", id: r.id });
    expect(m.mutationFenced()).toBe(false);
  });
  it("cannot begin maintenance it cannot write: nothing latched, nothing fenced", async () => {
    const m = await import("./maintenance");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw Object.assign(Error("EROFS"), { code: "EROFS" }); });
    expect(() => m.beginMaintenance()).toThrow("EROFS");
    expect(m.maintenanceActive()).toBe(false);
    expect(m.isMaintenanceLatched()).toBe(false);
  });
  it.each([
    ["garbage", () => fs.writeFileSync(file(), "{not json")],
    ["wrong version", () => fs.writeFileSync(file(), JSON.stringify({ version: 2, id, state: "active", requestedAt: "x" }))],
    ["non-scalar drain", () => fs.writeFileSync(file(), JSON.stringify({ version: 1, id, state: "active", requestedAt: "x", settledAt: null, drain: { a: {} } }))],
    ["oversized", () => fs.writeFileSync(file(), " ".repeat(20_000))],
    ["directory", () => fs.mkdirSync(file())],
    ["symlink", () => { fs.writeFileSync(path.join(root, "elsewhere"), record()); fs.symlinkSync(path.join(root, "elsewhere"), file()); }],
  ])("a present but %s record is maintenance with unknown state and fences mutation", async (_n, make) => {
    make();
    const m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "file", state: "unknown", id: null });
    expect(m.mutationFenced()).toBe(true);
  });
  it("a crash mid-drain boots back into maintenance in the draining state", async () => {
    let m = await import("./maintenance");
    const r = m.beginMaintenance();
    delete (globalThis as Record<symbol, unknown>)[KEY];
    vi.resetModules();
    m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "file", state: "draining", id: r.id });
    expect(m.mutationFenced()).toBe(true);
  });
});

describe("one process-wide registry", () => {
  it("module copies (one per router bundle) share latch, work and bundle count", async () => {
    const a = await import("./maintenance");
    vi.resetModules();
    const b = await import("./maintenance");
    expect(b).not.toBe(a);
    expect(b.bundleCount()).toBe(2);
    const w = a.beginWork("http");
    expect(b.pendingWork().count).toBe(1);
    b.endWork(w);
    a.beginMaintenance();
    expect(b.isMaintenanceLatched()).toBe(true);
  });
});

describe("request lifecycle", () => {
  it("an async handler holds its request until it settles, whether the client stayed or not", async () => {
    const m = await import("./maintenance");
    const res = new EventEmitter(), ev = event(res);
    m.admitRequest(ev);
    let finish = () => {};
    const handler = m.tracked(async (_e: unknown) => { await new Promise<void>((r) => (finish = r)); return "done"; });
    const running = handler(ev);
    res.emit("close");
    expect(m.pendingWork().count).toBe(1);
    finish();
    expect(await running).toBe("done");
    expect(m.pendingWork().count).toBe(0);
  });
  it("a synchronous handler stays synchronous; a throwing one releases", async () => {
    const m = await import("./maintenance");
    const a = event(), b = event();
    m.admitRequest(a);
    m.admitRequest(b);
    expect(m.tracked((_e: unknown) => 42)(a)).toBe(42);
    expect(() => m.tracked((_e: unknown) => { throw Error("x"); })(b)).toThrow("x");
    await expect(m.tracked(async (_e: unknown) => { throw Error("y"); })(b)).rejects.toThrow("y");
    expect(m.pendingWork().count).toBe(0);
  });
  it("holdUntilClose keeps a streamed response pending until it closes, but not past an early disconnect", async () => {
    const m = await import("./maintenance");
    const live = new EventEmitter(), gone = new EventEmitter();
    const a = event(live), b = event(gone);
    m.admitRequest(a);
    m.admitRequest(b);
    const handler = m.tracked(async (_e: unknown) => "stream", { holdUntilClose: true });
    gone.emit("close");
    await handler(a);
    await handler(b);
    expect(m.pendingWork().count).toBe(1);
    live.emit("close");
    expect(m.pendingWork().count).toBe(0);
  });
  it("middleware releases: on its own answer, and onBeforeResponse only for unclaimed handlers", async () => {
    const m = await import("./maintenance");
    const a = event(), b = event();
    m.admitRequest(a);
    m.admitRequest(b);
    m.releaseRequest(a);
    const pending = m.tracked(async (_e: unknown) => sleep(30))(b);
    m.releaseUnclaimedRequest(b);
    expect(m.pendingWork().count).toBe(1);
    await pending;
    expect(m.pendingWork().count).toBe(0);
  });
  it("a request that cannot be followed is untracked forever and blocks quiescence", async () => {
    const d = await import("./maintenance-drain");
    d.maintenanceGate(event(null));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await d.enterMaintenanceAndDrain({ timeoutMs: 150 })).state).toBe("drain_failed");
  });
});

describe("MCP tool calls outlive their HTTP stream", () => {
  it("a disconnected client's tool is waited for, writes while draining, and nothing can write after quiescence", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { trackToolExecution } = await import("./mcp/maintenance-tools");
    const { db } = await import("./db");
    const d = await import("./maintenance-drain");
    db().prepare("INSERT INTO settings (key,value) VALUES ('seed','1')").run();
    let release = () => {};
    let started = () => {};
    const began = new Promise<void>((r) => (started = r));
    const server = trackToolExecution(new McpServer({ name: "t", version: "1" }));
    server.registerTool("slow_write", { inputSchema: { key: z.string() } }, async ({ key }) => {
      started();
      await new Promise<void>((r) => (release = r));
      db().prepare("INSERT INTO settings (key,value) VALUES (?,'1')").run(key);
      return { content: [{ type: "text" as const, text: "ok" }] };
    });
    const client = new Client({ name: "c", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    void client.callTool({ name: "slow_write", arguments: { key: "during-drain" } }).catch(() => {});
    await began;
    await client.close();
    const settled = d.enterMaintenanceAndDrain({ timeoutMs: 3_000 });
    await sleep(200);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).state).toBe("draining");
    release();
    const outcome = await settled;
    expect(outcome.state).toBe("active");
    expect(outcome.drain).toMatchObject({ pendingTools: 0, dbConnections: 1, dbFenced: 1 });
    expect(db().prepare("SELECT value FROM settings WHERE key='during-drain'").get()).toBeTruthy();
    const after = hash(dbFile());
    expect(() => db().prepare("INSERT INTO settings (key,value) VALUES ('late','1')").run()).toThrow();
    await expect((server as unknown as { executeToolHandler: (...a: unknown[]) => Promise<unknown> })
      .executeToolHandler({ handler: async () => ({}) }, {}, {})).rejects.toThrow(/Maintenance/);
    expect(hash(dbFile())).toBe(after);
  });
  it("refuses to serve if the SDK no longer exposes the tracked execution path", async () => {
    const { trackToolExecution } = await import("./mcp/maintenance-tools");
    expect(() => trackToolExecution({})).toThrow(/cannot be tracked/);
  });
});

describe("drain", () => {
  it("fences every DB connection in the process, including another bundle's", async () => {
    const a = await import("./db");
    a.db();
    vi.resetModules();
    const b = await import("./db");
    b.db();
    const d = await import("./maintenance-drain");
    const outcome = await d.enterMaintenanceAndDrain({ timeoutMs: 1_000 });
    expect(outcome).toMatchObject({ state: "active", drain: { dbConnections: 2, dbFenced: 2 } });
    expect(Number(a.db().pragma("query_only", { simple: true }))).toBe(1);
    expect(Number(b.db().pragma("query_only", { simple: true }))).toBe(1);
  });
  it("excludes the admin entry by identity and reports what it waited for", async () => {
    const d = await import("./maintenance-drain");
    const m = await import("./maintenance");
    const admin = event();
    d.maintenanceGate(admin);
    const outcome = await d.enterMaintenanceAndDrain({ timeoutMs: 1_000, event: admin });
    expect(outcome.state).toBe("active");
    expect(outcome.drain).toMatchObject({ pendingWork: 0, untrackedRequests: 0, gitQuiescent: true, obsidianQuiescent: true,
      indexerQuiescent: true, cloudIntakeIdle: true, priceCollectorIdle: true, safeEditLockAbsent: true,
      gitMutationLockAbsent: true, safeEditWritingRows: 0 });
    expect(m.registry().work.size).toBe(1);
    expect(d.maintenanceGate({ request: req("/api/rpc/syncNow", "POST") })!.status).toBe(503);
  });
  it.each([
    ["a held Safe Edit lock", () => fs.writeFileSync(path.join(root, "safe-edit.lock"), "")],
    ["a held Git mutation lock", () => fs.mkdirSync(path.join(root, "git-mutation.lock"))],
  ])("times out to drain_failed on %s, which still refuses and persists", async (_n, hold) => {
    const d = await import("./maintenance-drain");
    hold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const settled = await d.enterMaintenanceAndDrain({ timeoutMs: 150 });
    expect(settled.state).toBe("drain_failed");
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).state).toBe("drain_failed");
  });
  it("adopts a record written under a running process that already admitted requests", async () => {
    const d = await import("./maintenance-drain");
    const m = await import("./maintenance");
    const ev = event();
    d.maintenanceGate(ev);
    m.releaseRequest(ev);
    fs.writeFileSync(file(), record("draining"));
    expect(d.maintenanceGate({ request: req("/api/mcp", "POST") })!.status).toBe(503);
    for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(file(), "utf8")).state === "draining"; i++) await sleep(20);
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ id, state: "active" });
  });
});

describe("the gate", () => {
  it("serves only a DB-free health answer; everything else is 503", async () => {
    fs.writeFileSync(file(), record());
    const { maintenanceGate } = await import("./maintenance-drain");
    const health = maintenanceGate({ request: req("/api/health") })!;
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, serving: "maintenance_only", maintenance: { active: true, state: "active", id } });
    for (const [p, method] of [["/api/mcp", "POST"], ["/api/rpc/syncNow", "POST"], ["/api/health", "POST"], ["/_server", "POST"],
      ["/.well-known/oauth-authorization-server", "GET"], ["/api/auth/sign-in/email", "POST"]] as const) {
      expect(maintenanceGate({ request: req(p, method) })!.status).toBe(503);
    }
    expect(fs.existsSync(dbFile())).toBe(false);
  });
});

describe("resume", () => {
  it("archives an active record to history before removing it, then starts normally", async () => {
    fs.writeFileSync(file(), record());
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(false);
    expect(fs.existsSync(file())).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, "maintenance-history", `${id}.json`), "utf8"))).toMatchObject({ id, state: "active" });
  });
  it("a removal that fails after the history entry stays in maintenance, and the next boot refuses it as a replay", async () => {
    fs.writeFileSync(file(), record());
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => { throw Object.assign(Error("EIO"), { code: "EIO" }); });
    let m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(true);
    unlink.mockRestore();
    delete (globalThis as Record<symbol, unknown>)[KEY];
    vi.resetModules();
    m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(true);
    expect(fs.existsSync(file())).toBe(true);
  });
  it.each([
    ["a different id", record(), "1f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a"],
    ["an unreadable record", "{broken", id],
  ])("stays in maintenance for %s", async (_n, content, wanted) => {
    fs.writeFileSync(file(), content);
    process.env.NOTEMESH_MAINTENANCE_RESUME = wanted;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(true);
    expect(err).toHaveBeenCalled();
  });
  it("a stale resume value with no record does nothing, and cannot clear a later maintenance in the same process", async () => {
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(false);
    fs.writeFileSync(file(), record());
    expect(m.maintenanceActive()).toBe(true);
  });
});

describe("workers never start or mutate in maintenance", () => {
  beforeEach(() => fs.writeFileSync(file(), record()));
  it("startup hooks touch neither the DB nor the Vault; the DB is not even opened", async () => {
    process.env.CLOUD_INTAKE = "1";
    process.env.MARKET_PRICES_ENABLED = "1";
    const interval = vi.spyOn(globalThis, "setInterval");
    const { ensureSyncStarted } = await import("./sync");
    const { ensureIndexerStarted } = await import("./vault/indexer");
    const { ensureCloudIntakeStarted, processCloudIntake } = await import("./cloud-intake");
    const { ensurePriceCollectorStarted } = await import("./market-prices/collector");
    const { db } = await import("./db");
    ensureSyncStarted();
    ensureIndexerStarted();
    ensureCloudIntakeStarted();
    ensurePriceCollectorStarted();
    processCloudIntake();
    expect(() => db()).toThrow(/Maintenance/);
    expect(interval).not.toHaveBeenCalled();
    expect(fs.readdirSync(root).sort()).toEqual(["maintenance.json"]);
  });
  it("Git: start, timers, manual sync after Stop and Safe Edit pause are refused", async () => {
    const { GitBackend } = await import("./sync/git");
    const g = new GitBackend();
    const reconcile = vi.spyOn(g as never, "reconcile");
    g.start();
    expect(g.state).toBe("stopped");
    g.stop();
    expect(await g.syncNow()).toMatchObject({ ok: false });
    expect(await (g as unknown as { cycle(r: string): Promise<boolean> }).cycle("manual")).toBe(false);
    await expect(g.withPausedForEdit(() => 1)).rejects.toThrow(/Maintenance/);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("Obsidian: an edit in progress when maintenance began does not restart the daemon; ob commands are refused", async () => {
    fs.rmSync(file());
    const { SyncSupervisor } = await import("./ob/supervisor");
    const m = await import("./maintenance");
    const s = new SyncSupervisor();
    let finish = () => {};
    const promise = new Promise<void>((resolve) => { finish = () => { (s as unknown as { child: null }).child = null; s.state = "stopped"; resolve(); }; });
    (s as unknown as { child: unknown }).child = Object.assign(promise, { kill: vi.fn(() => queueMicrotask(finish)) });
    s.state = "running";
    const spawned = vi.spyOn(s as never, "obBin");
    expect(await s.withPausedForEdit(() => { m.beginMaintenance(); return "edited"; })).toBe("edited");
    expect(spawned).not.toHaveBeenCalled();
    expect(s.isQuiescent()).toBe(true);
    m.settleMaintenance("active", {});
    const { runOb } = await vi.importActual<typeof import("./ob/cli")>("./ob/cli");
    expect((await runOb(["sync-status"])).combined).toMatch(/Maintenance/);
  });
  it("the index is not rebuilt and archive/attachment writes are refused", async () => {
    const { indexer } = await import("./vault/indexer");
    const m = await import("./maintenance");
    await expect(indexer().rebuild()).rejects.toThrow(/Maintenance/);
    expect(() => m.assertMutationAllowed("x")).toThrow(/Maintenance/);
    expect(fs.existsSync(dbFile())).toBe(false);
  });
});

describe("separate operator processes need an explicit gate", () => {
  it("the ob wrapper refuses to launch anything during maintenance", () => {
    fs.writeFileSync(file(), record());
    let failed: { status?: number; stderr?: Buffer } = {};
    try {
      execFileSync(process.execPath, ["scripts/ob-readonly.mjs", "sync-status"], { env: { PATH: process.env.PATH, DATA_DIR: root }, stdio: "pipe" });
    } catch (e) {
      failed = e as typeof failed;
    }
    expect(failed.status).toBe(75);
    expect(String(failed.stderr)).toMatch(/Maintenance is active/);
  });
  it("the account cleanup --apply needs the maintenance id as an explicit acknowledgement", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dbPath = path.join(root, "app.sqlite");
    new DatabaseSync(dbPath).close();
    fs.writeFileSync(file(), record());
    // @ts-expect-error standalone operator script is deliberately not bundled
    const { cleanupAccountIssuer } = await import("../../scripts/account-issuer-cleanup.mjs");
    expect(() => cleanupAccountIssuer(dbPath, { apply: true })).toThrow(/NOTEMESH_MAINTENANCE_OPERATOR_ID/);
    process.env.NOTEMESH_MAINTENANCE_OPERATOR_ID = id;
    expect(() => cleanupAccountIssuer(dbPath, { apply: true })).not.toThrow(/NOTEMESH_MAINTENANCE_OPERATOR_ID/);
  });
});

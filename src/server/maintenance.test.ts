import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("./ob/cli", () => ({ obIsAuthenticated: async () => true, obSyncConfigured: async () => true, obSyncOnce: async () => ({ ok: true, combined: "" }) }));

let root: string;
const file = () => path.join(root, "maintenance.json");
const db = () => path.join(root, "app.sqlite");
const id = "0f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const record = (state = "active", rid = id) => JSON.stringify({ version: 1, id: rid, state, requestedAt: "2026-11-07T00:00:00.000Z", settledAt: null, drain: null });
const req = (p: string, method = "GET") => new Request(`http://local${p}`, { method });
const event = (res: EventEmitter | null = new EventEmitter()) => ({ request: req("/api/mcp", "POST"), nativeEvent: res ? { node: { res } } : {} });

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maint-")));
  process.env.DATA_DIR = root;
  delete process.env.NOTEMESH_MAINTENANCE;
  delete process.env.NOTEMESH_MAINTENANCE_RESUME;
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
  for (const k of ["DATA_DIR", "NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "CLOUD_INTAKE", "MARKET_PRICES_ENABLED"]) delete process.env[k];
});

describe("durable state and fail-closed reading", () => {
  it("is inactive without a record, and a begun maintenance is durable before anything else", async () => {
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(false);
    const r = m.beginMaintenance();
    expect(r.state).toBe("draining");
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ version: 1, id: r.id, state: "draining" });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root).filter((n) => n.includes(".tmp"))).toEqual([]);
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "process", state: "draining", id: r.id });
  });
  it.each([
    ["garbage", () => fs.writeFileSync(file(), "{not json")],
    ["wrong version", () => fs.writeFileSync(file(), JSON.stringify({ version: 2, id, state: "active", requestedAt: "x" }))],
    ["oversized", () => fs.writeFileSync(file(), " ".repeat(20_000))],
    ["directory", () => fs.mkdirSync(file())],
    ["symlink", () => { fs.writeFileSync(path.join(root, "elsewhere"), record()); fs.symlinkSync(path.join(root, "elsewhere"), file()); }],
  ])("a present but %s record is maintenance with unknown state", async (_n, make) => {
    make();
    const m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "file", state: "unknown", id: null });
  });
  it("NOTEMESH_MAINTENANCE=1 forces maintenance without any file or DB", async () => {
    process.env.NOTEMESH_MAINTENANCE = "1";
    const m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "env", forcedByEnv: true });
    expect(fs.existsSync(db())).toBe(false);
  });
  it("a crash mid-drain boots back into maintenance in the draining state", async () => {
    let m = await import("./maintenance");
    const r = m.beginMaintenance();
    vi.resetModules();
    m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "file", state: "draining", id: r.id, settledAt: null });
  });
  it("survives a restart: a new module instance still sees the record, and deleting the file never resumes a latched process", async () => {
    let m = await import("./maintenance");
    const r = m.beginMaintenance();
    m.settleMaintenance("active", { ok: true });
    vi.resetModules();
    m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "file", state: "active", id: r.id });
    const latched = m.beginMaintenance();
    expect(latched.id).toBe(r.id);
    fs.rmSync(file());
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "process", id: r.id });
  });
});

describe("explicit resume, only at boot and only on an exact id", () => {
  it("archives the record and resumes on an exact match", async () => {
    fs.writeFileSync(file(), record("drain_failed"));
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(false);
    expect(fs.existsSync(file())).toBe(false);
    const history = fs.readdirSync(path.join(root, "maintenance-history"));
    expect(history).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(root, "maintenance-history", history[0]), "utf8")).id).toBe(id);
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
    expect(fs.existsSync(file())).toBe(true);
    expect(err).toHaveBeenCalled();
  });
  it("is consumed once: a resume variable left set cannot clear a later maintenance in the same process", async () => {
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    const m = await import("./maintenance");
    expect(m.maintenanceActive()).toBe(false);
    fs.writeFileSync(file(), record());
    expect(m.maintenanceActive()).toBe(true);
  });
  it("a forced env maintenance is not lifted by a matching resume id", async () => {
    fs.writeFileSync(file(), record());
    process.env.NOTEMESH_MAINTENANCE = "1";
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const m = await import("./maintenance");
    expect(m.maintenanceStatus()).toMatchObject({ active: true, source: "env" });
  });
});

describe("the gate", () => {
  it("serves only a DB-free health answer; everything else is 503", async () => {
    fs.writeFileSync(file(), record());
    const { maintenanceGate } = await import("./maintenance-drain");
    const health = maintenanceGate({ request: req("/api/health") })!;
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, serving: "maintenance_only", maintenance: { active: true, state: "active", id } });
    for (const [p, method] of [["/api/mcp", "POST"], ["/api/rpc/syncNow", "POST"], ["/api/health", "POST"], ["/status", "GET"],
      ["/.well-known/oauth-authorization-server", "GET"], ["/api/auth/sign-in/email", "POST"], ["/api/safe-edit", "POST"]] as const) {
      const r = maintenanceGate({ request: req(p, method) })!;
      expect(r.status).toBe(503);
      expect(r.headers.get("retry-after")).toBe("300");
    }
    expect(fs.existsSync(db())).toBe(false);
  });
  it("counts admitted requests until their response closes; an unobservable one is untracked forever", async () => {
    const m = await import("./maintenance");
    const { maintenanceGate } = await import("./maintenance-drain");
    const res = new EventEmitter();
    expect(maintenanceGate(event(res))).toBeNull();
    expect(m.inflightRequests()).toEqual({ inflight: 1, untracked: 0 });
    res.emit("close");
    res.emit("close");
    expect(m.inflightRequests()).toEqual({ inflight: 0, untracked: 0 });
    maintenanceGate(event(null));
    expect(m.inflightRequests()).toEqual({ inflight: 0, untracked: 1 });
  });
});

describe("drain", () => {
  it("settles active only after an admitted request finishes, and records the observed report", async () => {
    const { maintenanceGate, enterMaintenanceAndDrain } = await import("./maintenance-drain");
    const res = new EventEmitter();
    maintenanceGate(event(res));
    const pending = enterMaintenanceAndDrain({ timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 120));
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).state).toBe("draining");
    expect(maintenanceGate({ request: req("/api/mcp", "POST") })!.status).toBe(503);
    res.emit("close");
    const settled = await pending;
    expect(settled.state).toBe("active");
    expect(settled.drain).toMatchObject({ httpInflight: 0, httpUntracked: 0, gitQuiescent: true, obsidianQuiescent: true,
      indexerQuiescent: true, cloudIntakeIdle: true, priceCollectorIdle: true, safeEditLockAbsent: true,
      gitMutationLockAbsent: true, safeEditWritingRows: 0 });
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ state: "active", id: settled.id });
    expect(enterMaintenanceAndDrain()).toBeInstanceOf(Promise);
    expect((await enterMaintenanceAndDrain()).id).toBe(settled.id);
  });
  it.each([
    ["an in-flight request that never finishes", () => {}],
    ["a held Safe Edit lock", () => fs.writeFileSync(path.join(root, "safe-edit.lock"), "")],
    ["a held Git mutation lock", () => fs.mkdirSync(path.join(root, "git-mutation.lock"))],
  ])("times out to drain_failed on %s, which still refuses requests and persists", async (_n, hold) => {
    const { maintenanceGate, enterMaintenanceAndDrain } = await import("./maintenance-drain");
    if (_n.startsWith("an in-flight")) maintenanceGate(event(new EventEmitter()));
    hold();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const settled = await enterMaintenanceAndDrain({ timeoutMs: 150 });
    expect(settled.state).toBe("drain_failed");
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).state).toBe("drain_failed");
    expect(maintenanceGate({ request: req("/api/rpc/syncNow", "POST") })!.status).toBe(503);
  });
  it("does not claim quiescence while a Git cycle started before Stop is still running", async () => {
    const { gitBackend } = await import("./sync/git");
    const { enterMaintenanceAndDrain } = await import("./maintenance-drain");
    const g = gitBackend() as any;
    let finish = () => {};
    g.inFlight = new Promise<boolean>((r) => { finish = () => { g.inFlight = null; g.busy = false; r(true); }; });
    g.busy = true;
    const pending = enterMaintenanceAndDrain({ timeoutMs: 5_000 });
    await new Promise((r) => setTimeout(r, 120));
    expect(g.stopping).toBe(true);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).state).toBe("draining");
    finish();
    expect((await pending).state).toBe("active");
  });
  it("adopts a record written under a running process that already admitted requests", async () => {
    const { maintenanceGate } = await import("./maintenance-drain");
    const res = new EventEmitter();
    maintenanceGate(event(res));
    res.emit("close");
    fs.writeFileSync(file(), record("draining"));
    expect(maintenanceGate({ request: req("/api/mcp", "POST") })!.status).toBe(503);
    for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(file(), "utf8")).state === "draining"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ id, state: "active" });
  });
});

describe("workers never start or mutate in maintenance", () => {
  beforeEach(() => fs.writeFileSync(file(), record()));
  it("startup hooks touch neither the DB nor the Vault", async () => {
    process.env.CLOUD_INTAKE = "1";
    process.env.MARKET_PRICES_ENABLED = "1";
    const interval = vi.spyOn(globalThis, "setInterval");
    const { ensureSyncStarted } = await import("./sync");
    const { ensureIndexerStarted } = await import("./vault/indexer");
    const { ensureCloudIntakeStarted, processCloudIntake } = await import("./cloud-intake");
    const { ensurePriceCollectorStarted } = await import("./market-prices/collector");
    ensureSyncStarted();
    ensureIndexerStarted();
    ensureCloudIntakeStarted();
    ensurePriceCollectorStarted();
    processCloudIntake();
    expect(interval).not.toHaveBeenCalled();
    expect(fs.readdirSync(root).sort()).toEqual(["maintenance.json"]);
  });
  it("Git: start, timers, manual sync and Safe Edit pause are all refused, manual included after Stop", async () => {
    const { GitBackend } = await import("./sync/git");
    const g = new GitBackend();
    const reconcile = vi.spyOn(g as any, "reconcile");
    g.start();
    expect(g.state).toBe("stopped");
    expect(g.isQuiescent()).toBe(true);
    g.stop();
    expect(await g.syncNow()).toMatchObject({ ok: false });
    expect(await (g as any).cycle("manual")).toBe(false);
    expect(await (g as any).cycle("poll")).toBe(false);
    await expect(g.withPausedForEdit(() => 1)).rejects.toThrow(/Maintenance/);
    expect(reconcile).not.toHaveBeenCalled();
    expect(fs.existsSync(db())).toBe(false);
  });
  it("Obsidian: an edit that was in progress when maintenance began does not restart the daemon afterwards", async () => {
    fs.rmSync(file());
    const { SyncSupervisor } = await import("./ob/supervisor");
    const m = await import("./maintenance");
    const s = new SyncSupervisor();
    let finish = () => {};
    const promise = new Promise<void>((resolve) => { finish = () => { (s as any).child = null; s.state = "stopped"; resolve(); }; });
    (s as any).child = Object.assign(promise, { kill: vi.fn(() => queueMicrotask(finish)) });
    s.state = "running";
    const spawned = vi.spyOn(s as any, "obBin");
    expect(await s.withPausedForEdit(() => { m.beginMaintenance(); return "edited"; })).toBe("edited");
    expect(spawned).not.toHaveBeenCalled();
    expect((s as any).child).toBeNull();
    expect(s.isQuiescent()).toBe(true);
    expect(await s.syncNow()).toMatchObject({ ok: false });
  });
  it("the index is not rebuilt", async () => {
    const { indexer } = await import("./vault/indexer");
    await expect(indexer().rebuild()).rejects.toThrow(/Maintenance/);
    expect(fs.existsSync(db())).toBe(false);
  });
});

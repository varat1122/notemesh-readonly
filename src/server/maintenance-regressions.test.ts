import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Independent-review regressions (R1–R3, R8–R12). Written against behaviour
 * shared by the reviewed candidate and its remediation, so the same file shows
 * the old candidate failing and the corrected one passing. Where an API was
 * added by the remediation it is feature-detected, never required.
 */

const settings = vi.hoisted(() => ({ release: () => {}, calls: 0 }));
vi.mock("./ob/cli", () => ({
  obIsAuthenticated: async () => true,
  obSyncConfigured: async () => true,
  obSyncOnce: async () => ({ ok: true, combined: "" }),
  obSyncConfigs: () => {
    settings.calls++;
    return new Promise((resolve) => { settings.release = () => resolve({ ok: true, stdout: "", stderr: "", combined: "" }); });
  },
}));

let root: string;
const record = () => path.join(root, "maintenance.json");
const id = "0f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const write = (state = "active", rid = id) => fs.writeFileSync(record(),
  JSON.stringify({ version: 1, id: rid, state, requestedAt: "2026-11-07T00:00:00.000Z", settledAt: null, drain: null }));
const onDisk = () => JSON.parse(fs.readFileSync(record(), "utf8"));
const req = (p: string, method = "POST") => new Request(`http://local${p}`, { method });
const event = (res = new EventEmitter()) => ({ request: req("/api/mcp"), nativeEvent: { node: { res } } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Drain = typeof import("./maintenance-drain");
// The reviewed candidate took { ownRequests }, the remediation { event }.
const enter = (d: Drain, opts: Record<string, unknown>) => (d.enterMaintenanceAndDrain as (o: unknown) => Promise<{ id: string; state: string; drain: Record<string, unknown> | null }>)(opts);
async function wrap<A extends unknown[], R>(fn: (...a: A) => R): Promise<(...a: A) => R> {
  const m = (await import("./maintenance")) as Record<string, unknown>;
  return typeof m.tracked === "function" ? (m.tracked as (f: typeof fn) => typeof fn)(fn) : fn;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maint-r-")));
  process.env.DATA_DIR = root;
  for (const k of ["NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"]) delete process.env[k];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
  vi.resetModules();
});
afterEach(() => {
  // The registry is process-wide by design; never leak a latch into another file.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  for (const k of ["DATA_DIR", "NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED", "OB_BIN", "CLOUD_INTAKE"]) delete process.env[k];
});

describe("R1 handler completion survives client disconnect", () => {
  it("a disconnected request whose handler is still running keeps the drain open", async () => {
    const d = await import("./maintenance-drain");
    const res = new EventEmitter(), ev = event(res);
    d.maintenanceGate(ev);
    let finish = () => {};
    const handler = await wrap(async (_e: unknown) => { await new Promise<void>((r) => (finish = r)); return new Response("ok"); });
    const running = handler(ev);
    res.emit("close");
    const settled = enter(d, { timeoutMs: 2_000 });
    await sleep(200);
    expect(onDisk().state).toBe("draining");
    finish();
    await running;
    expect((await settled).state).toBe("active");
  });
});

describe("R2 identity, not a count", () => {
  it("an admin entry whose client went away cannot hide an unrelated in-flight request", async () => {
    const d = await import("./maintenance-drain");
    const adminRes = new EventEmitter(), admin = event(adminRes);
    d.maintenanceGate(admin);
    d.maintenanceGate(event());
    const settled = enter(d, { timeoutMs: 400, ownRequests: 1, event: admin });
    adminRes.emit("close");
    expect((await settled).state).toBe("drain_failed");
  });
});

describe("R3 one registry for every bundle copy", () => {
  it("a drain in one module copy waits for a request admitted by another", async () => {
    const a = await import("./maintenance-drain");
    vi.resetModules();
    const b = await import("./maintenance-drain");
    expect(b).not.toBe(a);
    a.maintenanceGate(event());
    expect((await enter(b, { timeoutMs: 300 })).state).toBe("drain_failed");
  });
  it("a drain in one module copy stops the intake timer started by another", async () => {
    process.env.CLOUD_INTAKE = "1";
    const set = vi.spyOn(globalThis, "setInterval"), clear = vi.spyOn(globalThis, "clearInterval");
    const intakeA = await import("./cloud-intake");
    intakeA.ensureCloudIntakeStarted();
    const timer = set.mock.results.at(-1)?.value;
    vi.resetModules();
    const b = await import("./maintenance-drain");
    await enter(b, { timeoutMs: 1_000 });
    expect(clear).toHaveBeenCalledWith(timer);
  });
});

describe("R8 detached helpers are pending work", () => {
  it("an Obsidian settings-sync helper started with the daemon keeps the supervisor non-quiescent", async () => {
    const { setSetting } = await import("./db");
    setSetting("sync_backend", "obsidian");
    process.env.OB_BIN = "/bin/true";
    const { SyncSupervisor } = await import("./ob/supervisor");
    const s = new SyncSupervisor();
    s.start();
    for (let i = 0; i < 100 && (s as unknown as { child: unknown }).child; i++) await sleep(20);
    s.stop();
    await sleep(50);
    expect(settings.calls).toBe(1);
    expect(s.isQuiescent()).toBe(false);
    settings.release();
    await sleep(20);
    expect(s.isQuiescent()).toBe(true);
  });
});

describe("R9 price writes refuse maintenance in-process and in a separate CLI process", () => {
  it.each([
    ["a durable record", () => write(), {}],
    ["NOTEMESH_MAINTENANCE=1", () => {}, { NOTEMESH_MAINTENANCE: "1" }],
  ] as const)("CLI refresh is refused under %s before any store, lease or file", (_n, prepare, extra) => {
    prepare();
    const before = fs.readdirSync(root).sort();
    const run = spawnSync(process.execPath, ["scripts/market-prices.ts", "refresh"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: root, MARKET_PRICES_STORAGE: "disk", ...extra },
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("maintenance_active");
    expect(fs.readdirSync(root).sort()).toEqual(before);
  });
  it("direct refreshPrices and a writable store are refused", async () => {
    write();
    const { refreshPrices } = await import("./market-prices/collector");
    const { PriceStore } = await import("./market-prices/store");
    await expect(refreshPrices({ filename: path.join(root, "p.sqlite") })).rejects.toThrow("maintenance_active");
    expect(() => new PriceStore(path.join(root, "q.sqlite"), true)).toThrow("maintenance_active");
    expect(fs.readdirSync(root)).toEqual(["maintenance.json"]);
  });
});

describe("R10 the deadline covers stopping, and stop failures are terminal", () => {
  it.each([
    ["hangs", () => new Promise<void>(() => {})],
    ["rejects", () => Promise.reject(Error("synthetic stop failure"))],
  ])("an index stop that %s ends drain_failed within the deadline", async (_n, stop) => {
    const { indexer } = await import("./vault/indexer");
    vi.spyOn(indexer(), "stopForMaintenance").mockImplementation(stop);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await import("./maintenance-drain");
    const started = Date.now();
    const settled = await Promise.race([enter(d, { timeoutMs: 300 }), sleep(3_000).then(() => ({ state: "hung" }))]);
    expect(settled.state).toBe("drain_failed");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(onDisk().state).toBe("drain_failed");
  });
});

describe("R11 durable success only", () => {
  it("an outcome that cannot be persisted is never reported active", async () => {
    const d = await import("./maintenance-drain");
    const rename = fs.renameSync;
    let calls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((a, b) => {
      if (++calls > 1) throw Object.assign(Error("EIO"), { code: "EIO" });
      return rename(a, b);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const settled = await enter(d, { timeoutMs: 1_000 });
    expect(settled.state).toBe("drain_failed");
    expect(onDisk().state).toBe("draining");
  });
  it("a fenced process: delayed DB writes and new DB opens fail after quiescence", async () => {
    const { db } = await import("./db");
    db().prepare("INSERT INTO settings (key,value) VALUES ('before','1')").run();
    const d = await import("./maintenance-drain");
    expect((await enter(d, { timeoutMs: 1_000 })).state).toBe("active");
    const size = fs.statSync(path.join(root, "app.sqlite")).size;
    expect(() => db().prepare("INSERT INTO settings (key,value) VALUES ('late','1')").run()).toThrow();
    vi.resetModules();
    const fresh = await import("./db");
    expect(() => fresh.db()).toThrow();
    expect(fs.statSync(path.join(root, "app.sqlite")).size).toBe(size);
  });
  it("git is refused once maintenance has settled", async () => {
    write();
    const { runGit } = await import("./sync/git-exec");
    expect((await runGit(["--version"], { cwd: root })).combined).toMatch(/Maintenance/);
  });
});

describe("R12 resume order, precedence and replay", () => {
  const boot = async () => (await import("./maintenance")).maintenanceStatus();
  it("forced maintenance wins and keeps the record", async () => {
    write();
    process.env.NOTEMESH_MAINTENANCE = "1";
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await boot()).active).toBe(true);
    expect(fs.existsSync(record())).toBe(true);
  });
  it("a record that never reached active needs the explicit undrained acknowledgement", async () => {
    write("drain_failed");
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await boot()).active).toBe(true);
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
    process.env.NOTEMESH_MAINTENANCE_RESUME_UNDRAINED = id;
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await boot()).active).toBe(false);
  });
  it("an id that was already resumed cannot be replayed", async () => {
    fs.mkdirSync(path.join(root, "maintenance-history"));
    fs.writeFileSync(path.join(root, "maintenance-history", `${id}.json`), "{}");
    write();
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await boot()).active).toBe(true);
    expect(fs.existsSync(record())).toBe(true);
  });
});

describe("container start", () => {
  it("in maintenance the entrypoint neither creates nor re-owns anything on the volume", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "entry-bin-"));
    const log = path.join(bin, "calls.log");
    const stub = (name: string, body: string) => {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
    };
    stub("mkdir", "exit 0");
    stub("chown", "exit 0");
    // "test -w" answers "not writable"; the final exec just records itself.
    stub("setpriv", 'case "$*" in *" test -w "*) exit 1;; esac\nexit 0');
    try {
      for (const [envs, volume] of [[{ NOTEMESH_MAINTENANCE: "1" }, path.join(root, "absent")], [{}, root]] as const) {
        if (!Object.keys(envs).length) write();
        fs.rmSync(log, { force: true });
        execFileSync("sh", ["docker-entrypoint.sh", "node", "server.mjs"], {
          env: { PATH: `${bin}:/usr/bin:/bin`, DATA_DIR: volume, ...envs }, stdio: "pipe" });
        const calls = fs.readFileSync(log, "utf8");
        expect(calls).not.toMatch(/^(mkdir|chown) /m);
        expect(calls).toMatch(/setpriv .* node server\.mjs/);
      }
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

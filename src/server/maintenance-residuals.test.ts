import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Independent maintenance review residuals: M-HIGH-1 (cross-process price
 * continuation), M-MEDIUM-2 (resume failure after unlink), M-MEDIUM-3
 * (adoption advertising stale quiescence), and the operator-exception
 * contract. Uses only entry points shared with the reviewed candidate, so the
 * same file demonstrates the defect on 24fb712 and the fix here.
 */

const KEY = Symbol.for("notemesh.maintenance.registry.v1");
let root: string;
const record = () => path.join(root, "maintenance.json");
const marker = () => path.join(root, "maintenance-resume.json");
const id = "0f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const write = (state = "active", extra: Record<string, unknown> = {}) => fs.writeFileSync(record(),
  JSON.stringify({ version: 1, id, state, requestedAt: "2026-11-07T00:00:00.000Z", settledAt: null, drain: null, ...extra }));
// Settled by an earlier server process that has exited, on a volume whose writer inventory exists
// (extra fields are ignored by candidates that predate ownership).
const writeOwned = (state = "active") => {
  fs.mkdirSync(path.join(root, "maintenance-writers"), { recursive: true });
  fs.writeFileSync(path.join(root, "maintenance-writers", ".inventory.json"), JSON.stringify({ version: 1, id: crypto.randomUUID() }));
  write(state, { owner: { pid: 4_000_000, start: "0" } });
};
type M = typeof import("./maintenance") & { resolveServerBoot?: () => void; registerServer?: () => unknown };
// The server's boot step and its registration before admitting requests, where the candidate has them.
const boot = async () => {
  const m = (await import("./maintenance")) as M;
  m.resolveServerBoot?.();
  return m;
};
const serving = async () => ((await import("./maintenance")) as M).registerServer?.();
const onDisk = () => JSON.parse(fs.readFileSync(record(), "utf8"));
const hash = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw Error("timed out waiting");
    await sleep(20);
  }
};
const reset = () => delete (globalThis as Record<symbol, unknown>)[KEY];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maint-res-")));
  process.env.DATA_DIR = root;
  for (const k of ["NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED", "NOTEMESH_MAINTENANCE_OPERATOR_ID"]) delete process.env[k];
  reset();
  vi.resetModules();
});
afterEach(() => {
  reset();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  for (const k of ["DATA_DIR", "NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED", "NOTEMESH_MAINTENANCE_OPERATOR_ID"]) delete process.env[k];
});

// A real separate process running the real price collector, blocked inside
// its fetcher while it holds the store open and the lease taken.
function priceChild(gate: string, inside: string): { child: ChildProcess; output: () => string; exited: Promise<number | null> } {
  const script = path.join(root, "child.mjs");
  fs.writeFileSync(script, `
import fs from "node:fs";
const { refreshPrices } = await import(${JSON.stringify(pathToFileURL(path.resolve("src/server/market-prices/collector.ts")).href)});
const { PriceError } = await import(${JSON.stringify(pathToFileURL(path.resolve("src/server/market-prices/model.ts")).href)});
try {
  const result = await refreshPrices({ force: true, watchlist: [{ market: "US", symbol: "NVDA" }], pause: async () => {},
    fetcher: async () => {
      fs.writeFileSync(${JSON.stringify(inside)}, "inside");
      while (!fs.existsSync(${JSON.stringify(gate)})) await new Promise(r => setTimeout(r, 20));
      throw new PriceError("provider_http_500");
    } });
  console.log("RESULT " + result.status);
} catch (e) { console.log("ERR " + (e?.code ?? e?.message)); }
`);
  let out = "";
  const child = spawn(process.execPath, [script], { env: { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: root, MARKET_PRICES_STORAGE: "disk" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  return { child, output: () => out, exited };
}

describe("M-HIGH-1 a price writer in another process", () => {
  it("is waited for, and nothing it does after maintenance began reaches the price database", async () => {
    const gate = path.join(root, "release"), inside = path.join(root, "inside");
    const c = priceChild(gate, inside);
    try {
      await until(() => fs.existsSync(inside));
      const prices = path.join(root, "market-prices", "prices.sqlite");
      const atEntry = hash(prices);
      const d = await import("./maintenance-drain");
      await serving();
      const settling = d.enterMaintenanceAndDrain({ timeoutMs: 8_000 });
      await sleep(400);
      // The other process still holds its lease: no false quiescence.
      expect(onDisk().state).toBe("draining");
      fs.writeFileSync(gate, "go");
      const settled = await settling;
      const atActive = hash(prices);
      expect(settled.state).toBe("active");
      expect(await c.exited).toBe(0);
      await sleep(200);
      // The provider failure record and the lease release were refused.
      expect(c.output()).toContain("maintenance_active");
      expect(hash(prices)).toBe(atActive);
      expect(atActive).toBe(atEntry);
    } finally {
      fs.writeFileSync(gate, "go");
      c.child.kill();
    }
  }, 20_000);

  it("a writer cannot slip in between its own check and a drain (announce-then-check)", async () => {
    const m = await import("./maintenance");
    if (typeof (m as Record<string, unknown>).withMaintenanceWriter !== "function") {
      // The reviewed candidate has no cross-process admission at all.
      expect.fail("no cross-process writer admission");
    }
    const open = fs.openSync;
    let injected = false;
    vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (!injected && String(file).includes("maintenance-writers")) {
        injected = true;
        write("draining");
      }
      return (open as (...a: unknown[]) => number)(file, ...rest);
    }) as typeof fs.openSync);
    const run = vi.fn();
    await expect((m as unknown as { withMaintenanceWriter: (n: string, f: () => unknown) => Promise<unknown> })
      .withMaintenanceWriter("price", run)).rejects.toThrow("maintenance_active");
    expect(injected).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(root, "maintenance-writers")).filter((n) => !n.startsWith("."))).toEqual([]);
  });

  it("racing price processes never produce a write after active", async () => {
    const children = Array.from({ length: 3 }, (_, i) => {
      const gate = path.join(root, `go-${i}`), inside = path.join(root, `in-${i}`);
      fs.writeFileSync(gate, "go");
      return priceChild(gate, inside);
    });
    await sleep(150);
    const d = await import("./maintenance-drain");
    await serving();
    const settled = await d.enterMaintenanceAndDrain({ timeoutMs: 15_000 });
    const prices = path.join(root, "market-prices", "prices.sqlite");
    const atActive = fs.existsSync(prices) ? hash(prices) : "absent";
    await Promise.all(children.map((c) => c.exited));
    expect(["active", "drain_failed"]).toContain(settled.state);
    expect(fs.existsSync(prices) ? hash(prices) : "absent").toBe(atActive);
  }, 30_000);

  it("every persistent price write re-checks maintenance, lease release and failure records included", async () => {
    const { PriceStore } = await import("./market-prices/store");
    const file = path.join(root, "p.sqlite");
    const store = new PriceStore(file, true);
    const lease = store.acquireLease(new Date())!;
    write();
    const before = hash(file);
    expect(() => store.failure({ market: "US", symbol: "NVDA" }, "provider_http_500", new Date())).toThrow("maintenance_active");
    expect(() => store.releaseLease(lease)).toThrow("maintenance_active");
    expect(() => store.acquireLease(new Date())).toThrow("maintenance_active");
    store.close();
    expect(hash(file)).toBe(before);
  });
});

describe("M-MEDIUM-2 resume never opens the gate on a failed step", () => {
  // `after` narrows the fault to a protocol step (e.g. only once the history entry exists).
  const fsyncFailAfterUnlink = (target: () => string, after: () => boolean = () => true) => {
    const open = fs.openSync, fsync = fs.fsyncSync, fds = new Map<number, string>();
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      const fd = (open as (...a: unknown[]) => number)(p, ...rest);
      fds.set(fd, String(p));
      return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd: number) => {
      if (fds.get(fd) === root && !fs.existsSync(target()) && after()) throw Object.assign(Error("EIO: fsync"), { code: "EIO" });
      return fsync(fd);
    });
  };
  it("a directory fsync failure after the record is unlinked keeps every process closed, and restart completes only with the exact id", async () => {
    writeOwned();
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    fsyncFailAfterUnlink(record);
    let m = await boot();
    const { db } = await import("./db");
    expect(m.maintenanceActive()).toBe(true);
    expect(() => db()).toThrow(/Maintenance/);
    expect(fs.existsSync(path.join(root, "app.sqlite"))).toBe(false);
    // Another process (no in-memory latch) still sees maintenance on disk.
    expect(fs.existsSync(record()) || fs.existsSync(marker())).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Restart without the resume variable: still closed.
    delete process.env.NOTEMESH_MAINTENANCE_RESUME;
    reset();
    vi.resetModules();
    m = await boot();
    expect(m.maintenanceActive()).toBe(true);
    // Restart with the exact id: the interrupted resume completes.
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    reset();
    vi.resetModules();
    m = await boot();
    expect(m.maintenanceActive()).toBe(false);
    expect(fs.existsSync(record())).toBe(false);
    expect(fs.existsSync(marker())).toBe(false);
  });
  it("a failure while removing the resume marker restores it and keeps this process closed", async () => {
    writeOwned();
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    fsyncFailAfterUnlink(marker, () => fs.existsSync(path.join(root, "maintenance-history", `${id}.json`)));
    const m = await boot();
    expect(m.maintenanceActive()).toBe(true);
    expect(fs.existsSync(marker())).toBe(true);
  });
  it("an unrelated or unreadable interrupted resume is not completed by another id", async () => {
    fs.writeFileSync(marker(), "{broken");
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await boot();
    expect(m.maintenanceActive()).toBe(true);
  });
});

describe("M-MEDIUM-3 adoption never advertises an earlier process's quiescence", () => {
  const event = (res = new EventEmitter()) => ({ request: new Request("http://local/api/mcp", { method: "POST" }), nativeEvent: { node: { res } } });
  it("a pending request at adoption: health shows draining with live pending work, and the record is rewritten first", async () => {
    const d = await import("./maintenance-drain");
    d.maintenanceGate(event());
    write("active", { settledAt: "2026-11-07T00:00:01.000Z", drain: { pendingWork: 0, gitQuiescent: true } });
    const res = d.maintenanceGate({ request: new Request("http://local/api/health") })!;
    const view = (await res.json()).maintenance;
    expect(view.state).toBe("draining");
    expect(view.drainedByThisProcess).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/"pendingWork":0/);
    expect(onDisk()).toMatchObject({ id, state: "draining", drain: null });
  });
  it("an adoption that cannot be persisted is held, never quiescent", async () => {
    const d = await import("./maintenance-drain");
    d.maintenanceGate(event());
    write("active", { settledAt: "2026-11-07T00:00:01.000Z", drain: { pendingWork: 0 } });
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw Object.assign(Error("EROFS"), { code: "EROFS" }); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const view = (await d.maintenanceGate({ request: new Request("http://local/api/health") })!.json()).maintenance;
    expect(view.state).toBe("draining");
    expect(view.drainedByThisProcess).toBe(false);
  });
});

describe("operator exception is not part of the strict window", () => {
  it("account cleanup --apply is refused in maintenance even with an operator id", async () => {
    write();
    process.env.NOTEMESH_MAINTENANCE_OPERATOR_ID = id;
    const { DatabaseSync } = await import("node:sqlite");
    const dbPath = path.join(root, "app.sqlite");
    new DatabaseSync(dbPath).close();
    // @ts-expect-error standalone operator script is deliberately not bundled
    const { cleanupAccountIssuer } = await import("../../scripts/account-issuer-cleanup.mjs");
    expect(() => cleanupAccountIssuer(dbPath, { apply: true })).toThrow(/strict no-mutation window/);
  });
});

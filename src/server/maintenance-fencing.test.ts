import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Independent re-review residuals M1–M4 (fencing of writers outside request
 * tracking, cross-process resume, adoption ownership, remote mutations).
 * Uses only entry points shared with the reviewed candidate (fe1329b); newer
 * APIs are feature-detected. Each test gathers its observations into one
 * object and asserts it once, so a failing run shows the full old behaviour.
 */

const KEY = Symbol.for("notemesh.maintenance.registry.v1");
const id = "0f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const DEAD = { pid: 4_000_000, start: "0" };
let root: string;
const record = () => path.join(root, "maintenance.json");
const marker = () => path.join(root, "maintenance-resume.json");
const history = () => path.join(root, "maintenance-history", `${id}.json`);
const writers = () => path.join(root, "maintenance-writers");
const prices = () => path.join(root, "market-prices", "prices.sqlite");
const write = (state = "active", extra: Record<string, unknown> = {}) => fs.writeFileSync(record(),
  JSON.stringify({ version: 1, id, state, requestedAt: "2026-11-07T00:00:00.000Z", settledAt: null, drain: null, ...extra }));
const inventory = () => {
  fs.mkdirSync(writers(), { recursive: true });
  fs.writeFileSync(path.join(writers(), ".inventory.json"), JSON.stringify({ version: 1, id: crypto.randomUUID() }));
};
const onDisk = () => JSON.parse(fs.readFileSync(record(), "utf8"));
const hash = (p: string) => fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : "absent";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw Error("timed out waiting");
    await sleep(20);
  }
};
const reset = () => delete (globalThis as Record<symbol, unknown>)[KEY];
type M = typeof import("./maintenance") & { resolveServerBoot?: () => void; registerServer?: () => unknown };
const maintenance = async () => (await import("./maintenance")) as M;
/** The server's boot step where the candidate has one; otherwise its first status read (which resumed there). */
const boot = async () => {
  const m = await maintenance();
  if (m.resolveServerBoot) m.resolveServerBoot();
  else m.maintenanceActive();
  return m;
};
const serving = async () => (await maintenance()).registerServer?.();
const quiet = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
};
const ENV = ["NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maint-fence-")));
  process.env.DATA_DIR = root;
  for (const k of ENV) delete process.env[k];
  reset();
  vi.resetModules();
});
afterEach(() => {
  reset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  for (const k of ["DATA_DIR", ...ENV]) delete process.env[k];
});

// ---- real separate processes ---------------------------------------------------

const src = (p: string) => JSON.stringify(pathToFileURL(path.resolve("src/server", p)).href);
function child(name: string, body: string, opts: { env?: Record<string, string>; preload?: string } = {}) {
  const script = path.join(root, `${name}.mjs`);
  fs.writeFileSync(script, `import fs from "node:fs";\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n${body}`);
  const args = opts.preload ? ["--import", pathToFileURL(opts.preload).href, script] : [script];
  let out = "";
  const proc: ChildProcess = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: root, MARKET_PRICES_STORAGE: "disk", ...opts.env } });
  proc.stdout!.on("data", (d) => (out += d));
  proc.stderr!.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const result = async () => {
    await exited;
    const m = /RESULT (.*)/.exec(out);
    return m ? JSON.parse(m[1]) : `no result: ${out.slice(-400)}`;
  };
  return { proc, output: () => out, exited, result };
}
const refreshBody = (wait = "") => `
const { refreshPrices } = await import(${src("market-prices/collector.ts")});
const { PriceError } = await import(${src("market-prices/model.ts")});
try {
  const r = await refreshPrices({ force: true, watchlist: [{ market: "US", symbol: "NVDA" }], pause: async () => {},
    fetcher: async () => { ${wait} throw new PriceError("provider_http_500"); } });
  console.log("RESULT " + JSON.stringify(r.status));
} catch (e) { console.log("RESULT " + JSON.stringify(e?.code ?? e?.message)); }
`;
/** Makes fsync of DATA_DIR fail in a child process: a filesystem that cannot confirm durability. */
const fsyncFailPreload = () => {
  const file = path.join(root, "fsync-fail.mjs");
  fs.writeFileSync(file, `import fs from "node:fs";
const dir = process.env.DATA_DIR, fsync = fs.fsyncSync;
fs.fsyncSync = (fd) => {
  let target = "";
  try { target = fs.readlinkSync("/proc/self/fd/" + fd); } catch {}
  if (target === dir) throw Object.assign(new Error("EIO: fsync"), { code: "EIO" });
  return fsync(fd);
};`);
  return file;
};
const startOf = (pid: number) => {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
};

// ---- M1 (A): writable price stores --------------------------------------------------

describe("M1-A every writable price store is fenced and tracked, however it was opened", () => {
  it("a store opened in another process before maintenance cannot write after it began, and active waits for it", async () => {
    const ready = path.join(root, "ready"), gate = path.join(root, "gate");
    const c = child("store", `
const { PriceStore, priceDbPath } = await import(${src("market-prices/store.ts")});
const store = new PriceStore(priceDbPath(), true);
fs.writeFileSync(${JSON.stringify(ready)}, "1");
while (!fs.existsSync(${JSON.stringify(gate)})) await sleep(20);
const out = {};
for (const [name, run] of Object.entries({
  ensureInstrument: () => store.ensureInstrument({ market: "US", symbol: "AAPL" }),
  rawStatement: () => store.db.prepare("INSERT INTO instruments VALUES ('US:ZZZ','US','ZZZ','ZZZ','USD','America/New_York')").run(),
  rawExec: () => store.db.exec("DELETE FROM collector_lease"),
})) { try { run(); out[name] = "written"; } catch (e) { out[name] = e?.code ?? e?.message; } }
store.close();
console.log("RESULT " + JSON.stringify(out));
`);
    try {
      await until(() => fs.existsSync(ready));
      const atEntry = hash(prices());
      const d = await import("./maintenance-drain");
      await serving();
      const settling = d.enterMaintenanceAndDrain({ timeoutMs: 8_000 });
      await sleep(400);
      const stateWhileOpen = onDisk().state;
      fs.writeFileSync(gate, "go");
      const writes = await c.result();
      const settled = (await settling).state;
      expect({ stateWhileOpen, writes, settled, priceDbChanged: hash(prices()) !== atEntry }).toEqual({
        stateWhileOpen: "draining",
        writes: { ensureInstrument: "maintenance_active", rawStatement: "unfenced_price_write", rawExec: "unfenced_price_write" },
        settled: "active", priceDbChanged: false });
    } finally {
      fs.writeFileSync(gate, "go");
      c.proc.kill();
    }
  }, 20_000);

  it("statements that can write are refused outside the fenced write path; reads still work", async () => {
    const { PriceStore } = await import("./market-prices/store");
    const file = path.join(root, "p.sqlite");
    const store = new PriceStore(file, true);
    const before = hash(file);
    const attempt = (run: () => unknown) => { try { run(); return "written"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
    const observed = {
      prepareRun: attempt(() => store.db.prepare("INSERT INTO instruments VALUES ('US:ZZZ','US','ZZZ','ZZZ','USD','America/New_York')").run()),
      exec: attempt(() => store.db.exec("DELETE FROM collector_lease")),
      pragmaWrite: attempt(() => store.db.pragma("user_version = 7")),
      read: attempt(() => store.instruments()),
      ensureInMaintenance: (write("draining"), attempt(() => store.ensureInstrument({ market: "US", symbol: "AAPL" }))),
    };
    store.close();
    expect({ ...observed, changed: hash(file) !== before }).toEqual({ prepareRun: "unfenced_price_write", exec: "unfenced_price_write",
      pragmaWrite: "unfenced_price_write", read: "written", ensureInMaintenance: "maintenance_active", changed: false });
  });

  it("a write transaction already open in another connection is waited for (SQLite write-lock barrier)", async () => {
    const { PriceStore, priceDbPath } = await import("./market-prices/store");
    new PriceStore(priceDbPath(), true).close();
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(prices());
    raw.exec("BEGIN IMMEDIATE");
    raw.prepare("INSERT INTO instruments VALUES ('US:ZZZ','US','ZZZ','ZZZ','USD','America/New_York')").run();
    const d = await import("./maintenance-drain");
    await serving();
    const settling = d.enterMaintenanceAndDrain({ timeoutMs: 5_000 });
    await sleep(400);
    const stateWhileOpen = onDisk().state;
    raw.exec("COMMIT");
    raw.close();
    const settled = await settling;
    const atActive = hash(prices());
    await sleep(100);
    expect({ stateWhileOpen, settled: settled.state, barrier: settled.drain?.priceDbBarrier, changedAfterActive: hash(prices()) !== atActive })
      .toEqual({ stateWhileOpen: "draining", settled: "active", barrier: true, changedAfterActive: false });
  });
});

// ---- M1 (B): the writer inventory --------------------------------------------------

describe("M1-B a lost, replaced or corrupt writer inventory is never zero writers", () => {
  it("the inventory disappears while a price writer in another process runs: drain_failed, and the writer still cannot write", async () => {
    const gate = path.join(root, "gate"), inside = path.join(root, "inside");
    const c = child("refresh", refreshBody(`fs.writeFileSync(${JSON.stringify(inside)}, "1"); while (!fs.existsSync(${JSON.stringify(gate)})) await sleep(20);`));
    try {
      await until(() => fs.existsSync(inside));
      await serving();
      const atEntry = hash(prices());
      fs.rmSync(writers(), { recursive: true, force: true });
      const d = await import("./maintenance-drain");
      quiet();
      const settled = await d.enterMaintenanceAndDrain({ timeoutMs: 3_000 });
      fs.writeFileSync(gate, "go");
      const childResult = await c.result();
      expect({ state: settled.state, inventoryIntact: settled.drain?.writerInventoryIntact, childResult, changed: hash(prices()) !== atEntry })
        .toEqual({ state: "drain_failed", inventoryIntact: false, childResult: "maintenance_active", changed: false });
    } finally {
      fs.writeFileSync(gate, "go");
      c.proc.kill();
    }
  }, 20_000);

  it("a replaced inventory (removed, then recreated by another writer) is uncertain", async () => {
    const { PriceStore } = await import("./market-prices/store");
    await serving();
    const first = new PriceStore(path.join(root, "a.sqlite"), true);
    fs.rmSync(writers(), { recursive: true, force: true });
    const second = new PriceStore(path.join(root, "b.sqlite"), true);
    second.close();
    const d = await import("./maintenance-drain");
    quiet();
    const settled = await d.enterMaintenanceAndDrain({ timeoutMs: 1_000 });
    first.close();
    expect({ state: settled.state, inventoryIntact: settled.drain?.writerInventoryIntact }).toEqual({ state: "drain_failed", inventoryIntact: false });
  });

  it.each([
    ["an unexpected entry", () => fs.writeFileSync(path.join(writers(), "notes.txt"), "x")],
    ["an unreadable lock", () => fs.writeFileSync(path.join(writers(), `price.123.${crypto.randomUUID()}.lock`), "{broken")],
  ])("%s in the inventory is corruption: drain_failed", async (_n, corrupt) => {
    await serving();
    fs.mkdirSync(writers(), { recursive: true });
    corrupt();
    const d = await import("./maintenance-drain");
    quiet();
    const settled = await d.enterMaintenanceAndDrain({ timeoutMs: 500 });
    expect(settled.state).toBe("drain_failed");
  });

  it("a writer whose own announcement vanished stops writing", async () => {
    const { PriceStore } = await import("./market-prices/store");
    const file = path.join(root, "p.sqlite");
    const store = new PriceStore(file, true);
    const before = hash(file);
    fs.rmSync(writers(), { recursive: true, force: true });
    let outcome = "written";
    try {
      store.ensureInstrument({ market: "US", symbol: "AAPL" });
    } catch (e) {
      outcome = (e as { code?: string }).code ?? String(e);
    }
    store.close();
    expect({ outcome, changed: hash(file) !== before }).toEqual({ outcome: "maintenance_active", changed: false });
  });
});

// ---- M2: resume across processes, restarts and double failures ----------------------

const MUTATORS = ["openSync", "writeFileSync", "fsyncSync", "unlinkSync", "mkdirSync", "renameSync", "linkSync"] as const;
const creates = (flags: unknown) => typeof flags === "number" ? (flags & fs.constants.O_CREAT) !== 0 : typeof flags === "string" && /[wa]/.test(flags);
/** Fail the Nth mutating filesystem call (and, for a crash, every call after it). */
function injector(failAt: number, crash: boolean) {
  let n = 0;
  const spies = MUTATORS.map((name) => {
    const original = (fs[name] as (...a: unknown[]) => unknown).bind(fs);
    return vi.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
      if (name === "openSync" && !creates(args[1])) return original(...args);
      n++;
      if (n === failAt || (crash && failAt > 0 && n > failAt)) throw Object.assign(Error("EIO: injected"), { code: "EIO" });
      return original(...args);
    }) as never);
  });
  return { calls: () => n, stop: () => spies.forEach((s) => s.mockRestore()) };
}

describe("M2 resume is fail-closed at every transition, across restarts and in other processes", () => {
  it("a fault at any step (once, or a crash from that step on) never opens a process without a durable, committed resume", async () => {
    quiet();
    const fresh = () => {
      reset();
      vi.resetModules();
    };
    const setup = () => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maint-fault-")));
      process.env.DATA_DIR = root;
      inventory();
      write("active", { owner: DEAD, settledAt: "2026-11-07T00:00:01.000Z" });
    };
    const top = root;
    // Count the mutating calls of an unfaulted resume.
    setup();
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    fresh();
    const count = injector(0, false);
    expect((await boot()).maintenanceActive()).toBe(false);
    const steps = count.calls();
    count.stop();
    const violations: string[] = [];
    for (const crash of [false, true]) {
      for (let step = 1; step <= steps; step++) {
        const tag = `${crash ? "crash" : "fail"}@${step}`;
        setup();
        process.env.NOTEMESH_MAINTENANCE_RESUME = id;
        fresh();
        const faults = injector(step, crash);
        let m = await boot();
        if (!m.maintenanceActive()) violations.push(`${tag}: this process opened after a failed step`);
        delete process.env.NOTEMESH_MAINTENANCE_RESUME;
        if (crash) {
          // Another process (or a restart) while the filesystem still fails: closed, whatever is visible.
          fresh();
          m = await boot();
          if (!m.maintenanceActive()) violations.push(`${tag}: another process opened while the filesystem could not confirm`);
        }
        faults.stop();
        // The filesystem recovered: plain restart. Open only with nothing pending and the resume committed.
        fresh();
        m = await boot();
        const pending = fs.existsSync(record()) || fs.existsSync(marker());
        if (!m.maintenanceActive() && (pending || !fs.existsSync(history()))) violations.push(`${tag}: opened with pending state or no committed history`);
        if (m.maintenanceActive() && !pending) violations.push(`${tag}: closed with nothing pending`);
        // Only the exact id completes it.
        process.env.NOTEMESH_MAINTENANCE_RESUME = "1f4c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
        fresh();
        m = await boot();
        if (pending && !m.maintenanceActive()) violations.push(`${tag}: a different id opened it`);
        process.env.NOTEMESH_MAINTENANCE_RESUME = id;
        fresh();
        m = await boot();
        if (m.maintenanceActive() || fs.existsSync(record()) || fs.existsSync(marker()) || !fs.existsSync(history()))
          violations.push(`${tag}: the exact id did not complete the resume`);
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    root = top;
    process.env.DATA_DIR = root;
    expect({ steps: steps > 5, violations }).toEqual({ steps: true, violations: [] });
  }, 60_000);

  it("double failure (marker removed, directory fsync fails, marker not restorable): other processes stay closed until durability is confirmed", async () => {
    inventory();
    write("active", { owner: DEAD, settledAt: "2026-11-07T00:00:01.000Z" });
    process.env.NOTEMESH_MAINTENANCE_RESUME = id;
    quiet();
    // From the first DATA_DIR fsync after the marker is gone, every mutating call fails.
    let crashed = false;
    const fsync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd: number) => {
      let target = "";
      try { target = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { /* not a path */ }
      if (crashed || (target === root && !fs.existsSync(marker()) && !fs.existsSync(record()) && fs.existsSync(history()))) {
        crashed = true;
        throw Object.assign(Error("EIO: injected"), { code: "EIO" });
      }
      return fsync(fd);
    });
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (crashed && creates(rest[0])) throw Object.assign(Error("EIO: injected"), { code: "EIO" });
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    const m = await boot();
    const preload = fsyncFailPreload();
    const unconfirmed = await child("a", refreshBody(), { preload }).result();
    const unconfirmedWithResumeEnv = await child("b", refreshBody(), { preload, env: { NOTEMESH_MAINTENANCE_RESUME: id } }).result();
    const createdWhileUnconfirmed = fs.existsSync(prices());
    const confirmed = await child("c", refreshBody()).result();
    expect({ crashed, thisProcessClosed: m.maintenanceActive(), markerOrRecord: fs.existsSync(marker()) || fs.existsSync(record()),
      unconfirmed, unconfirmedWithResumeEnv, createdWhileUnconfirmed, confirmed }).toEqual({
      crashed: true, thisProcessClosed: true, markerOrRecord: false, unconfirmed: "maintenance_active",
      unconfirmedWithResumeEnv: "maintenance_active", createdWhileUnconfirmed: false, confirmed: "partial_failure" });
  }, 30_000);

  it("a CLI process never performs a resume, whatever its environment says", async () => {
    inventory();
    write("active", { owner: DEAD, settledAt: "2026-11-07T00:00:01.000Z" });
    const result = await child("cli", refreshBody(), { env: { NOTEMESH_MAINTENANCE_RESUME: id, NOTEMESH_MAINTENANCE_RESUME_UNDRAINED: id } }).result();
    expect({ result, recordKept: fs.existsSync(record()), resumed: fs.existsSync(history()), priceDb: fs.existsSync(prices()) })
      .toEqual({ result: "maintenance_active", recordKept: true, resumed: false, priceDb: false });
  }, 20_000);
});

// ---- M3: adoption, ownership and stale quiescence -----------------------------------------

const event = (res = new EventEmitter()) => ({ request: new Request("http://local/api/mcp", { method: "POST" }), nativeEvent: { node: { res } } });
const resumer = (extra: Record<string, string> = {}) => child(`resume-${crypto.randomUUID()}`, `
const m = await import(${src("maintenance.ts")});
m.resolveServerBoot?.();
console.log("RESULT " + JSON.stringify({ active: m.maintenanceActive() }));
`, { env: { NOTEMESH_MAINTENANCE_RESUME: id, ...extra } }).result();

describe("M3 resume eligibility is bound to process ownership, not a stale record", () => {
  it("a failed adoption with work in flight keeps another process from resuming the earlier 'active'", async () => {
    const d = await import("./maintenance-drain");
    d.maintenanceGate(event());
    write("active", { owner: DEAD, settledAt: "2026-11-07T00:00:01.000Z", drain: { pendingWork: 0 } });
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw Object.assign(Error("EROFS"), { code: "EROFS" }); });
    quiet();
    const view = (await d.maintenanceGate({ request: new Request("http://local/api/health") })!.json()).maintenance;
    const withoutAck = await resumer();
    const withAck = await resumer({ NOTEMESH_MAINTENANCE_RESUME_UNDRAINED: id });
    expect({ adopterState: view.state, quiescenceProven: view.quiescenceProven ?? false, withoutAck, withAck, recordKept: fs.existsSync(record()) })
      .toEqual({ adopterState: "draining", quiescenceProven: false, withoutAck: { active: true }, withAck: { active: true }, recordKept: true });
  }, 20_000);

  it("an 'active' without a known, exited owner is not proof: it needs the undrained acknowledgement; a live owner refuses", async () => {
    quiet();
    const attempt = async (setup: () => void, ack: boolean) => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root);
      setup();
      process.env.NOTEMESH_MAINTENANCE_RESUME = id;
      if (ack) process.env.NOTEMESH_MAINTENANCE_RESUME_UNDRAINED = id;
      else delete process.env.NOTEMESH_MAINTENANCE_RESUME_UNDRAINED;
      reset();
      vi.resetModules();
      return (await boot()).maintenanceActive() ? "closed" : "opened";
    };
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    await until(() => fs.existsSync(`/proc/${sleeper.pid}/stat`));
    const live = { pid: sleeper.pid!, start: startOf(sleeper.pid!) };
    try {
      const settled = { settledAt: "2026-11-07T00:00:01.000Z" };
      const observed = {
        ownerless: await attempt(() => { inventory(); write("active", settled); }, false),
        ownerlessAcknowledged: await attempt(() => { inventory(); write("active", settled); }, true),
        noInventory: await attempt(() => write("active", { ...settled, owner: DEAD }), false),
        noInventoryAcknowledged: await attempt(() => write("active", { ...settled, owner: DEAD }), true),
        liveOwnerAcknowledged: await attempt(() => { inventory(); write("active", { ...settled, owner: live }); }, true),
        exitedOwner: await attempt(() => { inventory(); write("active", { ...settled, owner: DEAD }); }, false),
      };
      expect(observed).toEqual({ ownerless: "closed", ownerlessAcknowledged: "opened", noInventory: "closed",
        noInventoryAcknowledged: "opened", liveOwnerAcknowledged: "closed", exitedOwner: "opened" });
    } finally {
      sleeper.kill();
    }
  }, 20_000);

  it("health labels an earlier process's drain as such, never as this process's quiescence", async () => {
    write("active", { owner: DEAD, settledAt: "2026-11-07T00:00:01.000Z", drain: { pendingWork: 0, gitQuiescent: true } });
    const d = await import("./maintenance-drain");
    const view = (await d.maintenanceGate({ request: new Request("http://local/api/health") })!.json()).maintenance;
    expect({ recordOwner: view.recordOwner, quiescenceProven: view.quiescenceProven, drainedByThisProcess: view.drainedByThisProcess,
      earlierProcessDrain: view.earlierProcessDrain }).toEqual({ recordOwner: "earlier_process", quiescenceProven: false,
      drainedByThisProcess: false, earlierProcessDrain: { pendingWork: 0, gitQuiescent: true } });
  });
});

// ---- M4: remote Drive mutations (mocked transport only) -------------------------------------

async function driveEnv() {
  vi.stubEnv("ENCRYPTION_KEY", "12".repeat(32));
  vi.stubEnv("BASE_URL", "https://investment.example");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_SECRET", "test-client-secret");
  const { sealDriveCredential } = await import("./market-prices/drive-auth");
  vi.stubEnv("MARKET_PRICES_DRIVE_CREDENTIAL", sealDriveCredential("refresh-test-token"));
  const { PriceStore } = await import("./market-prices/store");
  const { packDriveArchive } = await import("./market-prices/drive-archive");
  const store = new PriceStore(":memory:", true);
  const packed = packDriveArchive(store.db.serialize());
  store.close();
  return packed;
}
type Call = { url: string; method: string; maintenance: boolean };
/** A fake Google: tokens expire at once (so every request awaits a token first); the folder does not exist yet. */
function fakeDrive(packed: Buffer, hooks: { onCall?: (n: number, call: Call) => void; upload?: () => Promise<void> } = {}) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call = { url: String(input), method: (init?.method ?? "GET").toUpperCase(), maintenance: fs.existsSync(record()) };
    calls.push(call);
    hooks.onCall?.(calls.length, call);
    if (call.url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 60 }));
    if (call.url.includes("uploadType=multipart")) {
      await hooks.upload?.();
      return new Response(JSON.stringify({ id: "archive1" }));
    }
    if (call.url.includes("alt=media")) return new Response(new Uint8Array(packed));
    if (call.method === "POST") return new Response(JSON.stringify({ id: "folder1" }));
    return new Response(JSON.stringify({ files: [] }));
  });
  const mutations = (after = 0) => calls.slice(after).filter((c) => c.url.startsWith("https://www.googleapis.com/") && c.method !== "GET");
  return { calls, mutations };
}

describe("M4 no remote Drive mutation is initiated once maintenance exists, at any await boundary", () => {
  it("maintenance beginning during any request of a publish: no later folder creation or upload is sent", async () => {
    const packed = await driveEnv();
    let total = 0;
    {
      vi.resetModules();
      const drive = fakeDrive(packed);
      const { GoogleDriveArchives } = await import("./market-prices/drive-archive");
      await new GoogleDriveArchives().publish(packed);
      total = drive.calls.length;
      vi.restoreAllMocks();
    }
    const violations: string[] = [];
    for (let k = 1; k <= total; k++) {
      fs.rmSync(record(), { force: true });
      reset();
      vi.resetModules();
      // The record appears while request k is awaited (it was initiated before maintenance: in flight, allowed).
      const drive = fakeDrive(packed, { onCall: (n) => { if (n === k) write("draining"); } });
      const { GoogleDriveArchives } = await import("./market-prices/drive-archive");
      await new GoogleDriveArchives().publish(packed).catch(() => {});
      for (const c of drive.mutations()) if (c.maintenance) violations.push(`maintenance at request ${k}: ${c.method} ${new URL(c.url).pathname} initiated`);
      vi.restoreAllMocks();
    }
    expect({ requestsPerPublish: total, violations }).toEqual({ requestsPerPublish: 8, violations: [] });
  });

  it("an upload in flight is tracked: the drain waits for it; nothing new is sent after active", async () => {
    const packed = await driveEnv();
    vi.resetModules();
    let release: (() => void) | undefined;
    const drive = fakeDrive(packed, { upload: () => new Promise<void>((r) => (release = r)) });
    const m = await maintenance();
    const d = await import("./maintenance-drain");
    await serving();
    const { GoogleDriveArchives } = await import("./market-prices/drive-archive");
    const publishing = new GoogleDriveArchives().publish(packed).then(() => "completed", (e) => (e as { code?: string }).code ?? String(e));
    await until(() => release !== undefined);
    const settling = d.enterMaintenanceAndDrain({ timeoutMs: 5_000 });
    await sleep(300);
    const stateWhileInFlight = onDisk().state;
    const inFlight = m.pendingWork().kinds.filter((k) => k === "remote").length;
    release!();
    const firstPublish = await publishing;
    const settled = (await settling).state;
    const before = drive.calls.length;
    const afterActive = await new GoogleDriveArchives().publish(packed).then(() => "completed", (e) => (e as { code?: string }).code ?? String(e));
    expect({ stateWhileInFlight, inFlight, firstPublish, settled, afterActive, mutationsAfterActive: drive.mutations(before).length }).toEqual({
      stateWhileInFlight: "draining", inFlight: 1, firstPublish: "completed", settled: "active", afterActive: "maintenance_active", mutationsAfterActive: 0 });
  });
});

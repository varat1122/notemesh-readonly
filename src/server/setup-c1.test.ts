/** Native disposable setup tests. Auth/worker seams are controlled here;
 * tests/http/c1-pilot.test.ts proves the real Admin/OAuth/server boundary. */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const state = vi.hoisted(() => ({ admin: true, claimed: true, idle: true, calls: [] as string[] }));
vi.mock("./session", () => ({ requireAdmin: async () => { if (!state.admin) throw Error("admin_required"); return { user: { id: "synthetic-admin" } }; } }));
vi.mock("./auth", () => ({ runAuthMigrations: async () => {} }));
vi.mock("./claim", () => ({ isSetupComplete: async () => state.claimed, claimWindowRemainingMs: () => 10, CLAIM_WINDOW_MINUTES: 10 }));
vi.mock("./ob/supervisor", () => ({ supervisor: () => ({ isQuiescent: () => state.idle }) }));
vi.mock("./sync", () => ({ syncBackend: () => ({ note: () => state.calls.push("note"), resetAndStart: () => state.calls.push("start") }) }));
vi.mock("./sync/git", () => ({ gitBackend: () => ({ isQuiescent: () => state.idle }),
  probeRemote: async () => { state.calls.push("probe"); return { ok: true }; },
  cloneVault: async () => { state.calls.push("clone"); return { ok: true }; }, repoDisplayName: () => "Synthetic Git" }));
vi.mock("./ob/cli", () => ({ obLogin: async () => { state.calls.push("login"); return { ok: true }; },
  obListRemoteVaults: async () => { state.calls.push("list"); return { result: { ok: true }, vaults: [] }; },
  obIsAuthenticated: async () => true, obSyncSetup: async () => { state.calls.push("setup"); return { ok: true }; },
  obSyncConfigs: async () => ({ ok: true }), obSyncStatus: async () => ({ ok: true, stdout: "{}" }),
  looksLikeMfaRequired: () => false, looksLikeAuthFailure: () => false }));

let root: string;
let setup: typeof import("./setup"), database: typeof import("./db"), maintenance: typeof import("./maintenance");
const confirmation = { confirmLocalOnly: true as const };
const globals = ["notemesh.c1-pilot.identity.v1", "notemesh.maintenance.registry.v1", "notemesh.d1.native-interlock.v1", "notemesh.d1.database-owners.v1"];
const resetGlobals = () => { for (const name of globals) delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)]; };
const directories = ["00_Inbox", "00_Inbox/ChatGPT", "10_Knowledge", "10_Knowledge/Company Research", "10_Knowledge/Industry and Concepts", "10_Knowledge/Macro and Markets"];
const observedSettings = () => {
  const read = new Database(path.join(root, "app.sqlite"), { readonly: true, fileMustExist: true });
  try { return read.prepare("SELECT key,value FROM settings ORDER BY key").all(); } finally { read.close(); }
};
beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ios-c1-pilot-setup-")));
  fs.mkdirSync(path.join(root, "vault"));
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("C1_RESEARCH_PILOT", "disposable");
  vi.stubEnv("SAFE_EDIT_ENABLED", "1"); vi.stubEnv("SAFE_EDIT_SINGLE_WRITER", "1");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  for (const key of ["NOTEMESH_MAINTENANCE", "NOTEMESH_MAINTENANCE_RESUME", "NOTEMESH_MAINTENANCE_RESUME_UNDRAINED", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"]) vi.stubEnv(key, undefined);
  resetGlobals(); vi.resetModules(); Object.assign(state, { admin: true, claimed: true, idle: true, calls: [] });
  database = await import("./db"); database.db();
  setup = await import("./setup"); maintenance = await import("./maintenance");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetGlobals(); fs.rmSync(root, { recursive: true, force: true }); });

it("creates exactly the six folders and only truthful settings, with idempotent readback", async () => {
  expect(await setup.getSetupProgress()).toMatchObject({ stage: "local-vault", backend: null, localOnly: true });
  expect(await setup.setupLocalPilotVault(confirmation)).toMatchObject({ ok: true, configured: true, externalSync: false,
    remoteBackup: false, createdDirectories: directories, settings: "acknowledged", lock: "released" });
  const entries = fs.readdirSync(path.join(root, "vault"), { recursive: true }).map(String).sort();
  expect(entries).toEqual([...directories].sort());
  expect(observedSettings()).toEqual([{ key: "vault_configured", value: "true" }, { key: "vault_name", value: "C1 Local Research Lab" }]);
  const rows = database.db().prepare("SELECT * FROM settings ORDER BY key").all();
  expect(await setup.setupLocalPilotVault(confirmation)).toMatchObject({ settings: "unchanged", createdDirectories: [] });
  expect(database.db().prepare("SELECT * FROM settings ORDER BY key").all()).toEqual(rows);
  expect(state.calls).toEqual([]);
  expect(fs.existsSync(path.join(root, "safe-edit.lock"))).toBe(false);
  expect(await setup.getSetupStage()).toBe("timezone");
  database.setSetting("timezone", "UTC"); expect(await setup.getSetupStage()).toBe("notifications");
  await setup.acknowledgeNotifications(); expect(await setup.getSetupStage()).toBe("done");
  await setup.relinkVault(); expect(await setup.getSetupStage()).toBe("local-vault"); expect(state.calls).toEqual([]);
});

it("concurrent Admin calls serialize without duplicate notes or configuration", async () => {
  const result = await Promise.all([setup.setupLocalPilotVault(confirmation), setup.setupLocalPilotVault(confirmation)]);
  expect(result.map(r => r.settings)).toEqual(["acknowledged", "unchanged"]);
  expect(result.flatMap(r => r.createdDirectories)).toEqual(directories);
});

it.each([undefined, {}, { confirmLocalOnly: false }, { confirmLocalOnly: true, path: "/outside" }, { confirmLocalOnly: true, pilot: true }])("rejects invalid/hostile confirmation %j before effects", async input => {
  await expect(setup.setupLocalPilotVault(input as never)).rejects.toThrow("c1_local_setup_confirmation_required");
  expect(observedSettings()).toEqual([]); expect(fs.readdirSync(path.join(root, "vault"))).toEqual([]);
});
it("requires the Admin seam even if caller supplies the right confirmation", async () => {
  state.admin = false; await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("admin_required");
  expect(observedSettings()).toEqual([]);
});
it("never equates existing C1 identity with single-writer or Safe Edit enablement", async () => {
  vi.stubEnv("SAFE_EDIT_SINGLE_WRITER", "0");
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("single replica");
  expect(observedSettings()).toEqual([]);
});
it("denies an unsettled worker before directory or setting effects", async () => {
  state.idle = false; await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("external_writer_hold");
  expect(fs.readdirSync(path.join(root, "vault"))).toEqual([]);
});

it.each(["sync_backend", "git_remote", "git_token", "obsidian_logged_in", "obsidian_password"])("preserves conflicting %s without conversion or secret disclosure", async key => {
  database.setSetting(key, "synthetic-conflicting-value");
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("remote_state_hold");
  expect(observedSettings()).toEqual([{ key, value: "synthetic-conflicting-value" }]);
  expect(fs.readdirSync(path.join(root, "vault"))).toEqual([]); expect(state.calls).toEqual([]);
});
it("denies all C1 remote setup before credentials or subprocess calls", async () => {
  for (const call of [() => setup.setupChooseBackend("git"), () => setup.setupGitRepo("https://example.org/fixture.git", "main", "u", "synthetic-secret"),
    () => setup.setupObsidianLogin("fixture@example.org", "synthetic-secret"), () => setup.setupListVaults(), () => setup.setupConfigureVault("fixture", "synthetic-secret")])
    await expect(call()).rejects.toThrow("c1_local_only_remote_setup_denied");
  expect(observedSettings()).toEqual([]); expect(state.calls).toEqual([]);
});
it("retains ordinary legacy backend selection and refuses local setup outside C1", async () => {
  vi.stubEnv("C1_RESEARCH_PILOT", undefined);
  const previous = root; root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-local-setup-"));
  vi.stubEnv("DATA_DIR", root); resetGlobals();
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("requires_disposable_pilot");
  await setup.setupChooseBackend("git"); expect(database.getSetting("sync_backend")).toBe("git");
  expect(await setup.getSetupProgress()).toMatchObject({ stage: "git", backend: "git", localOnly: false });
  fs.rmSync(previous, { recursive: true, force: true });
});
it("does not steal a stale Safe Edit lock", async () => {
  fs.mkdirSync(path.join(root, "safe-edit.lock"));
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("writer_lock_hold");
  expect(fs.existsSync(path.join(root, "safe-edit.lock"))).toBe(true); expect(observedSettings()).toEqual([]);
});
it("DRAINING denies setup and leaves business settings/folders untouched", async () => {
  maintenance.beginMaintenance();
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow(/Maintenance|maintenance/);
  expect(observedSettings()).toEqual([]); expect(fs.readdirSync(path.join(root, "vault"))).toEqual([]);
});
it("does not follow a symlink and reports already-created empty folders accurately", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-setup-"));
  try {
    fs.symlinkSync(outside, path.join(root, "vault/10_Knowledge"));
    const error = await setup.setupLocalPilotVault(confirmation).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.c1SetupOutcome).toMatchObject({ createdDirectories: ["00_Inbox", "00_Inbox/ChatGPT"], settings: "not_attempted", lock: "released" });
    expect(fs.readdirSync(outside)).toEqual([]); expect(observedSettings()).toEqual([]);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});
it("partial EACCES preserves original error and does not claim configuration or no effects", async () => {
  const mkdir = fs.mkdirSync, denied = Object.assign(Error("synthetic-EACCES"), { code: "EACCES" });
  vi.spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike, options: never) => {
    if (String(p).endsWith("/Company Research")) throw denied;
    return mkdir(p, options);
  }) as typeof fs.mkdirSync);
  const error = await setup.setupLocalPilotVault(confirmation).catch(e => e);
  expect(error).toBe(denied); expect(error.c1SetupOutcome).toMatchObject({ createdDirectories: directories.slice(0, 3), settings: "not_attempted", lock: "released" });
  expect(observedSettings()).toEqual([]);
});
it("directory fsync EIO keeps durable uncertainty and the writer lock", async () => {
  const sync = fs.fsyncSync, failure = Object.assign(Error("synthetic-directory-EIO"), { code: "EIO" });
  vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
    if (fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(root, "vault/00_Inbox")) throw failure;
    sync(fd);
  });
  const error = await setup.setupLocalPilotVault(confirmation).catch(e => e);
  expect(error).toBe(failure); expect(error.d1Outcome.outcome).toBe("unknown");
  expect(error.c1SetupOutcome).toMatchObject({ createdDirectories: ["00_Inbox"], settings: "not_attempted", lock: "held" });
  expect(maintenance.maintenanceActive()).toBe(true); expect(observedSettings()).toEqual([]);
  expect(fs.existsSync(path.join(root, "safe-edit.lock"))).toBe(true);
});
it("a real COMMIT followed by release failure is COMMIT_UNKNOWN, never a successful or zero-write response", async () => {
  const observer = new Database(path.join(root, "app.sqlite"), { readonly: true, fileMustExist: true });
  const sync = fs.fsyncSync, fault = Object.assign(Error("synthetic-post-COMMIT-EIO"), { code: "EIO" }); let fired = false;
  try {
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (!fired && observer.prepare("SELECT 1 FROM settings WHERE key='vault_configured'").get()) { fired = true; throw fault; }
      sync(fd);
    });
    const error = await setup.setupLocalPilotVault(confirmation).catch(e => e);
    expect(fired).toBe(true); expect(error).toMatchObject({ code: "COMMIT_UNKNOWN", c1SetupOutcome: { settings: "unknown", lock: "held" } });
    expect(observer.prepare("SELECT value FROM settings WHERE key='vault_configured'").get()).toEqual({ value: "true" });
    expect(database.d1DatabaseStatus().quarantine).toBeTruthy(); expect(maintenance.maintenanceActive()).toBe(true);
  } finally { observer.close(); }
});
it("post-commit Safe Edit lock-release uncertainty is not reported as setup success", async () => {
  const remove = fs.rmdirSync, failure = Object.assign(Error("synthetic-lock-EIO"), { code: "EIO" });
  vi.spyOn(fs, "rmdirSync").mockImplementation(((p: fs.PathLike, options: never) => {
    if (String(p).endsWith("/safe-edit.lock")) throw failure;
    return remove(p, options);
  }) as typeof fs.rmdirSync);
  const error = await setup.setupLocalPilotVault(confirmation).catch(e => e);
  expect(error).toBe(failure); expect(error.c1SetupOutcome).toMatchObject({ settings: "acknowledged", lock: "held" });
  expect(observedSettings()).toContainEqual({ key: "vault_configured", value: "true" });
  expect(maintenance.maintenanceActive()).toBe(true);
});
it("a configured vault with a missing directory is held, not silently repaired", async () => {
  await setup.setupLocalPilotVault(confirmation);
  fs.rmdirSync(path.join(root, "vault/10_Knowledge/Company Research"));
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("directory_missing_hold");
  expect(fs.existsSync(path.join(root, "vault/10_Knowledge/Company Research"))).toBe(false);
});

it("changed pilot mode stays restrictive after enrollment", async () => {
  vi.stubEnv("C1_RESEARCH_PILOT", undefined);
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow("c1_pilot_live_transition_hold");
  expect(fs.readdirSync(path.join(root, "vault"))).toEqual([]);
});
it("a wrong-type fixed directory is refused without overwriting it", async () => {
  fs.writeFileSync(path.join(root, "vault/00_Inbox"), "Synthetic sentinel");
  await expect(setup.setupLocalPilotVault(confirmation)).rejects.toThrow();
  expect(fs.readFileSync(path.join(root, "vault/00_Inbox"), "utf8")).toBe("Synthetic sentinel");
  expect(observedSettings()).toEqual([]);
});

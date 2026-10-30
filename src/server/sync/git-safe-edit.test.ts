import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const m = vi.hoisted(() => ({
  settings: {} as Record<string, string>, fetch: null as null | Promise<any>,
  interrupted: false, calls: [] as string[][], status: "", remoteHead: "abc", auth: false, blockAt: "", block: null as null | Promise<any>, behind: false, ahead: false,
}));
vi.mock("../db", () => ({
  getSetting: (key: string) => m.settings[key],
  db: () => ({ prepare: (sql: string) => ({ get: () => sql.includes("sqlite_master") ? {} : m.interrupted ? {} : undefined }) }),
}));
vi.mock("./conflict", () => ({ probeMerge: async () => ({ clean: true, paths: [] }), resolveConflict: vi.fn() }));
vi.mock("../vault/modified", () => ({ refreshGitTimes: async () => 0 }));
vi.mock("./git-exec", () => ({ runGit: vi.fn(async (args: string[]) => {
  m.calls.push(args);
  if (m.block && args.includes(m.blockAt)) return m.block;
  if (args[0] === "fetch" && m.fetch) return m.fetch;
  let stdout = "";
  if (args[0] === "remote") stdout = m.settings.git_remote;
  if (args[0] === "symbolic-ref") stdout = "main";
  if (args[0] === "status") stdout = m.status;
  if (args[0] === "rev-parse") stdout = args[1] === "--show-toplevel" ? path.join(process.env.DATA_DIR!, "vault") : args[1] === "--git-path" ? `.git/${args[2]}` : "abc";
  if (args[0] === "ls-remote") stdout = `${m.remoteHead}\trefs/heads/main\n`;
  if (args[0] === "rev-list") stdout = String(args[2].startsWith("HEAD..") ? Number(m.behind) : Number(m.ahead));
  const fail = args[0] === "ls-remote" && m.auth;
  return { ok: !fail, stdout, stderr: "", combined: fail ? "Authentication failed" : "", code: fail ? 128 : 0 };
}) }));
import { GitBackend, cloneVault } from "./git";
let root: string;
let b: GitBackend;
const ok = { ok: true, stdout: "", stderr: "", combined: "", code: 0 };
function deferred() { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
beforeEach(async () => {
  vi.useFakeTimers();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "git-edit-race-"));
  fs.mkdirSync(path.join(root, "vault"));
  vi.stubEnv("DATA_DIR", root);
  vi.stubEnv("SAFE_EDIT_ENABLED", "1"); vi.stubEnv("SAFE_EDIT_SINGLE_WRITER", "1"); vi.stubEnv("CLOUD_INTAKE", "1");
  vi.stubEnv("SAFE_EDIT_GIT_REMOTE", "https://example.invalid/staging.git"); vi.stubEnv("SAFE_EDIT_GIT_BRANCH", "main");
  Object.assign(m, { settings: { git_remote: process.env.SAFE_EDIT_GIT_REMOTE, git_branch: "main", sync_backend: "git", vault_configured: "true", git_pull_seconds: "30" }, fetch: null, interrupted: false, calls: [], status: "", remoteHead: "abc", auth: false, blockAt: "", block: null, behind: false, ahead: false });
  b = new GitBackend(); b.start(); await settle();
});
afterEach(async () => { b.stop(); await settle(); vi.useRealTimers(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it("blocks poll, startup/restart, manual sync, clone and debounce throughout an async callback, then reconciles once", async () => {
  const callback = deferred();
  const edit = b.withPausedForEdit(async () => {
    const count = m.calls.length;
    expect(b.isEditPaused()).toBe(true);
    expect((await b.syncNow()).ok).toBe(false);
    expect(() => b.start()).toThrow(/paused/);
    expect(() => b.resetAndStart()).toThrow(/drain/);
    await expect(cloneVault(m.settings.git_remote, "main")).rejects.toThrow();
    b.notifyLocalChange({ tool: "safe-edit", path: "Fixture.md" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.calls).toHaveLength(count);
    await callback.promise;
    return "written";
  });
  await settle(); callback.resolve(ok);
  expect(await edit).toBe("written"); await settle();
  expect(m.calls.filter(a => a[0] === "fetch")).toHaveLength(2);
  expect(b.isEditPaused()).toBe(false);
});
it.each(["fetch", "merge", "push"])("drains a pending %s-stage cycle before callback", async stage => {
  const d = deferred(); m.blockAt = stage; m.block = d.promise;
  m.behind = stage === "merge"; m.ahead = stage === "push";
  const sync = b.syncNow(); await settle();
  expect(m.calls.some(a => a.includes(stage))).toBe(true);
  const run = vi.fn(() => stage);
  const edit = b.withPausedForEdit(run); await settle();
  expect(run).not.toHaveBeenCalled(); expect((await b.syncNow()).ok).toBe(false);
  d.resolve(ok); expect((await sync).ok).toBe(true);
  expect(await edit).toBe(stage); expect(run).toHaveBeenCalledTimes(1);
});
it("fails closed on drain timeout and retains the admission gate until recovery", async () => {
  const d = deferred(); m.fetch = d.promise; const sync = b.syncNow(); await settle();
  const run = vi.fn(); const edit = b.withPausedForEdit(run);
  const rejected = expect(edit).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(10_000); await rejected;
  expect(run).not.toHaveBeenCalled(); expect(b.isEditPaused()).toBe(true);
  expect(fs.existsSync(path.join(root, "git-mutation.lock"))).toBe(true);
  d.resolve(ok); await sync; await settle();
  expect(run).not.toHaveBeenCalled(); expect(b.isEditPaused()).toBe(true);
  expect(() => b.resetAndStart()).toThrow();
});
it("refuses a failed drain without invoking the writer or clearing authentication state", async () => {
  const d = deferred(); m.fetch = d.promise; const sync = b.syncNow(); await settle();
  const run = vi.fn(); const edit = b.withPausedForEdit(run);
  d.resolve({ ...ok, ok: false, combined: "Authentication failed" });
  await sync; await expect(edit).rejects.toThrow(/failed/);
  expect(run).not.toHaveBeenCalled(); expect(b.state).toBe("needs-reauth");
  expect((await b.syncNow()).ok).toBe(false); b.start(); expect(b.state).toBe("needs-reauth");
});
it("resumes once on callback failure without losing a queued notification", async () => {
  await expect(b.withPausedForEdit(() => { b.notifyLocalChange({ tool: "safe-edit", path: "Fixture.md" }); throw Error("callback failed"); })).rejects.toThrow(/callback failed/);
  await settle(); expect(b.isEditPaused()).toBe(false);
  expect(m.calls.filter(a => a[0] === "fetch")).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(m.calls.filter(a => a[0] === "fetch")).toHaveLength(2);
});
it.each(["pin", "branch", "dirty", "diverged", "journal", "lock", "external-lock", "auth", "backoff", "stopped"])("refuses %s before writer callback", async condition => {
  if (condition === "pin") vi.stubEnv("SAFE_EDIT_GIT_REMOTE", "");
  if (condition === "branch") vi.stubEnv("SAFE_EDIT_GIT_BRANCH", "other");
  if (condition === "dirty") m.status = " M Fixture.md";
  if (condition === "diverged") m.remoteHead = "def";
  if (condition === "journal") m.interrupted = true;
  if (condition === "lock") fs.mkdirSync(path.join(root, "safe-edit.lock"));
  if (condition === "external-lock") fs.mkdirSync(path.join(root, "git-mutation.lock"));
  if (condition === "auth") m.auth = true;
  if (condition === "backoff") b.state = "backoff";
  if (condition === "stopped") b.stop();
  const run = vi.fn(); await expect(b.withPausedForEdit(run)).rejects.toThrow(); expect(run).not.toHaveBeenCalled();
});
it("honors operator stop during drain and never restarts from a queued callback", async () => {
  const d = deferred(); m.fetch = d.promise; const sync = b.syncNow(); await settle();
  const run = vi.fn(); const edit = b.withPausedForEdit(run); b.stop(); d.resolve(ok); await sync;
  await expect(edit).rejects.toThrow(); const count = m.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).not.toHaveBeenCalled(); expect(b.state).toBe("stopped"); expect(m.calls).toHaveLength(count);
});

it("holds interrupted callback writes and a new backend refuses to publish the journal", async () => {
  await expect(b.withPausedForEdit(() => { m.interrupted = true; throw Error("interrupted write"); })).rejects.toThrow(/interrupted write/);
  expect(b.isEditPaused()).toBe(true);
  expect(fs.existsSync(path.join(root, "git-mutation.lock"))).toBe(true);
  const count = m.calls.length;
  const other = new GitBackend(); other.start(); await settle(); other.stop();
  expect(m.calls).toHaveLength(count);
});
it("rejects concurrent edit admission", async () => {
  const d = deferred(); const edit = b.withPausedForEdit(async () => { await d.promise; });
  const run = vi.fn(); await expect(b.withPausedForEdit(run)).rejects.toThrow(); expect(run).not.toHaveBeenCalled();
  d.resolve(ok); await edit;
});

it("times out during preflight without releasing its disk lock under late I/O", async () => {
  const d = deferred(); m.blockAt = "ls-remote"; m.block = d.promise;
  const run = vi.fn(); const edit = b.withPausedForEdit(run);
  const rejection = expect(edit).rejects.toThrow(/timed out/);
  await settle(); expect(m.calls.some(a => a[0] === "ls-remote")).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000); await rejection;
  expect(fs.existsSync(path.join(root, "git-mutation.lock"))).toBe(true);
  d.resolve({ ...ok, stdout: "abc\trefs/heads/main\n" }); await settle();
  expect(run).not.toHaveBeenCalled(); expect(b.isEditPaused()).toBe(true);
  expect(fs.existsSync(path.join(root, "git-mutation.lock"))).toBe(true);
});
it("rechecks kill switches and backend after asynchronous drain", async () => {
  const d = deferred(); m.fetch = d.promise; const sync = b.syncNow(); await settle();
  const run = vi.fn(); const edit = b.withPausedForEdit(run); vi.stubEnv("SAFE_EDIT_ENABLED", "0");
  m.settings.sync_backend = "obsidian"; d.resolve(ok); await sync;
  await expect(edit).rejects.toThrow(/deployment changed/); expect(run).not.toHaveBeenCalled();
});
it("invalidates already scheduled debounce work on admission", async () => {
  b.notifyLocalChange({ tool: "fixture", path: "Fixture.md" });
  await vi.advanceTimersByTimeAsync(4_999);
  await b.withPausedForEdit(async () => {
    const count = m.calls.length; await vi.advanceTimersByTimeAsync(1);
    expect(m.calls).toHaveLength(count);
  });
  await settle(); expect(m.calls.filter(a => a[0] === "fetch")).toHaveLength(2);
});

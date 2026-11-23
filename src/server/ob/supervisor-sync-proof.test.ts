import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Safe Edit's sync proof, driven through the real start() against a fake ob
// child, the way supervisor-settings-sync.test.ts drives it. The proof must
// survive the bounded log rotating, and must not survive the child.

const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("./settings-sync", () => ({ enableSettingsSync: async () => ({ ok: true, message: "" }) }));
vi.mock("./cli", () => ({
  obIsAuthenticated: async () => auth.ok,
  obSyncConfigured: async () => true,
  obSyncOnce: async () => ({ ok: true, combined: "" }),
}));
vi.mock("../sync", () => ({ syncKind: () => "obsidian" }));

const { SyncSupervisor, MAX_LOG_LINES, bidirectionalProofOf } = await import("./supervisor");
const { withPausedSync } = await import("../safe-edit/sync");

const MARKER = "[sync-policy] Verified bidirectional sync.";
const FAKE_OB = `#!/usr/bin/env node
const M = ${JSON.stringify(MARKER)};
const err = (s) => process.stderr.write(s + "\\n"), out = (s) => process.stdout.write(s + "\\n");
const noise = () => { for (let i = 0; i < ${MAX_LOG_LINES + 100}; i++) out("noise " + i); };
const mode = process.env.FAKE_PROOF;
if (mode === "verified") { err(M); noise(); }
if (mode === "warned") { err("(node:42) ExperimentalWarning: SQLite is an experimental feature"); err("(Use \`node --trace-warnings ...\` to show where the warning was created)"); err(M); noise(); }
if (mode === "split") { process.stderr.write(M.slice(0, 9)); setTimeout(() => { err(M.slice(9)); noise(); }, 50); }
if (mode === "none") noise();
if (mode === "pull") { err("[readonly] Verified pull-only sync."); noise(); }
if (mode === "stdout") { out(M); noise(); }
if (mode === "late") { err("Fully synced"); err(M); noise(); }
if (mode === "padded") { err(M + " "); noise(); }
if (mode === "active") { err(M); setInterval(() => out("Downloaded a.md"), 300); }
if (mode === "exit") { err(M); setTimeout(() => process.exit(1), 100); }
setInterval(() => {}, 1000);
`;

let root: string;
let sup: InstanceType<typeof SyncSupervisor>;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-sync-proof-")));
  for (const d of ["vault", "home"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  process.env.DATA_DIR = root;
  const script = path.join(root, "fake-ob");
  fs.writeFileSync(script, FAKE_OB);
  fs.chmodSync(script, 0o755);
  process.env.OB_BIN = script;
  Object.assign(process.env, { SAFE_EDIT_ENABLED: "1", SAFE_EDIT_SINGLE_WRITER: "1", CLOUD_INTAKE: "1" });
  auth.ok = true;
  sup = new SyncSupervisor();
  (globalThis as Record<string, unknown>).__notemeshSupervisor = sup;
});

afterEach(async () => {
  sup.stop();
  await vi.waitFor(() => expect(sup.status().state).not.toBe("running"), { timeout: 5_000 });
  for (const k of ["OB_BIN", "DATA_DIR", "FAKE_PROOF", "SAFE_EDIT_ENABLED", "SAFE_EDIT_SINGLE_WRITER", "CLOUD_INTAKE"]) delete process.env[k];
  delete (globalThis as Record<string, unknown>).__notemeshSupervisor;
  fs.rmSync(root, { recursive: true, force: true });
});

async function launch(mode: string) {
  process.env.FAKE_PROOF = mode;
  sup.start();
  // Settle on the last line ob prints, so the head of stderr has been read.
  await vi.waitFor(() => expect(sup.getLogs().some((l) => l.line === `noise ${MAX_LOG_LINES + 99}`)).toBe(true), { timeout: 5_000 });
}

describe("bidirectionalProofOf", () => {
  it("accepts only the wrapper's exact first line, after at most Node's own warnings", () => {
    expect(bidirectionalProofOf(`${MARKER}\n`)).toBe(true);
    expect(bidirectionalProofOf(`(node:7) ExperimentalWarning: x\n(Use \`node --trace-warnings ...\` to show where the warning was created)\n${MARKER}\n`)).toBe(true);
    expect(bidirectionalProofOf(MARKER)).toBeUndefined();
    for (const head of [`${MARKER} \n`, `x${MARKER}\n`, `Downloaded a.md\n${MARKER}\n`, "[readonly] Verified pull-only sync.\n", `${MARKER}X\n`, "x".repeat(5000)]) {
      expect(bidirectionalProofOf(head), head.slice(0, 60)).toBe(false);
    }
  });
});

describe("the supervisor's sync proof", () => {
  it("survives the log rotating past its bound for the same verified idle daemon, and Safe Edit applies", async () => {
    await launch("verified");
    expect(sup.getLogs().some((l) => l.line === MARKER)).toBe(false);
    expect(sup.getLogs()).toHaveLength(MAX_LOG_LINES);
    expect(sup.bidirectionalVerified()).toBe(true);
    const run = vi.fn(() => "written");
    expect(await withPausedSync(run)).toBe("written");
    expect(run).toHaveBeenCalledOnce();
  });

  it.each(["warned", "split"])("accepts the proof when the head arrives as %s", async (mode) => {
    await launch(mode);
    expect(sup.bidirectionalVerified()).toBe(true);
  });

  it.each(["none", "pull", "stdout", "late", "padded"])("holds when the daemon's evidence is %s", async (mode) => {
    await launch(mode);
    sup.note(MARKER);
    expect(sup.getLogs().some((l) => l.line === MARKER)).toBe(true);
    expect(sup.bidirectionalVerified()).toBe(false);
    const run = vi.fn();
    await expect(withPausedSync(run)).rejects.toThrow(/verified, idle bidirectional/);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not carry proof to a new daemon until it proves itself", async () => {
    await launch("verified");
    expect(sup.bidirectionalVerified()).toBe(true);
    sup.stop();
    expect(sup.bidirectionalVerified()).toBe(false);
    await vi.waitFor(() => expect(sup.status().state).toBe("stopped"), { timeout: 5_000 });
    await launch("none");
    expect(sup.status().state).toBe("running");
    expect(sup.bidirectionalVerified()).toBe(false);
    await expect(withPausedSync(vi.fn())).rejects.toThrow();
  });

  it("drops proof on re-authentication even while the same child runs", async () => {
    await launch("verified");
    sup.resetAndStart();
    expect(sup.status().state).toBe("running");
    expect(sup.bidirectionalVerified()).toBe(false);
    await expect(withPausedSync(vi.fn())).rejects.toThrow();
  });

  it("holds an active daemon even when proven", async () => {
    process.env.FAKE_PROOF = "active";
    sup.start();
    await vi.waitFor(() => expect(sup.status().activity.active).toBe(true), { timeout: 5_000 });
    expect(sup.bidirectionalVerified()).toBe(true);
    const run = vi.fn();
    await expect(withPausedSync(run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([[true, "backoff"], [false, "needs-reauth"]] as const)("holds after the proven child exits (authenticated=%s → %s)", async (authed, state) => {
    auth.ok = authed;
    process.env.FAKE_PROOF = "exit";
    sup.start();
    await vi.waitFor(() => expect(sup.status().state).toBe(state), { timeout: 5_000 });
    expect(sup.bidirectionalVerified()).toBe(false);
    await expect(withPausedSync(vi.fn())).rejects.toThrow();
  });

  it("re-proves the restarted daemon after an edit", async () => {
    await launch("verified");
    await withPausedSync(() => 0);
    await vi.waitFor(() => expect(sup.bidirectionalVerified()).toBe(true), { timeout: 5_000 });
    expect(await withPausedSync(() => "again")).toBe("again");
  });
});

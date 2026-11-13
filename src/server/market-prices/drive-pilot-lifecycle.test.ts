import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PilotJournal } from "./drive-pilot-journal";
import { PilotOAuthBinding, bootstrapPilotFolder } from "./drive-pilot-bootstrap";
import { executePilotUpload } from "./drive-pilot-gate";
import { approveMockUpload, bootstrapMockFixture, createMockGateFixture, fixtureOAuth, MockGateHttp } from "./drive-pilot-gate-mock";

const roots: string[] = [];
function fixture() { const f = createMockGateFixture(); roots.push(f.root); return f; }
function pause() { let release!: () => void; const wait = new Promise<void>(r => { release = r; }); return { wait, release }; }
function settle<T>(p: Promise<T>) { return p.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })); }
function record(root: string) { const j = PilotJournal.open(path.join(root, "journal")); try { return j.read(); } finally { j.close(); } }
function posts(root: string) { return new MockGateHttp(root).world.requests.filter(r => r.method === "POST" && r.path === "/upload/drive/v3/files"); }

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "56".repeat(32));
  vi.stubEnv("MARKET_PRICES_PROFILE", "free-first-mvp-v1");
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", ""); vi.stubEnv("MARKET_PRICES_ENABLED", "1"); // Required only for the in-memory MCP; every fetch remains a nonforwarding mock.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("unexpected network in isolated pilot regression")));
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it.each([
  ["bootstrap", "busy"], ["bootstrap", "invalid"], ["upload", "busy"], ["upload", "invalid"],
] as const)("keeps the %s owner alive when a same-handle %s invocation loses admission", async (phase, loser) => {
  const f = fixture();
  if (phase === "upload") await bootstrapMockFixture(f);
  const approved = phase === "upload" ? approveMockUpload(f) : f.bootstrap;
  const j = PilotJournal.open(f.journalDir), oauth = fixtureOAuth(f.root, f.binding), mock = new MockGateHttp(f.root);
  vi.stubGlobal("fetch", mock.fetch);
  const entered = pause(), release = pause();
  const consent = phase === "bootstrap" ? oauth.beginConsent(f.bootstrap, f.authority) : null;
  if (phase === "upload") {
    const valid = oauth.validThrough.bind(oauth);
    vi.spyOn(oauth, "validThrough").mockImplementation(async deadline => { entered.release(); await release.wait; return valid(deadline); });
  }
  const owner = settle<unknown>(phase === "upload"
    ? executePilotUpload(j, oauth, approved, f.authority)
    : bootstrapPilotFolder(j, oauth, approved, f.authority, async () => {
      entered.release(); await release.wait; return { state: consent!.state, code: "MOCK_ONLY_CODE" };
    }));
  let readableAfterLoser = false;
  try {
    await Promise.race([entered.wait, owner.then(() => { throw Error("owner ended before the controlled pause"); })]);
    const count = mock.world.requests.length;
    const envelope = loser === "invalid" ? undefined : approved;
    await expect(phase === "upload"
      ? executePilotUpload(j, oauth, envelope, f.authority, true)
      : bootstrapPilotFolder(j, oauth, envelope, f.authority, { state: consent!.state, code: "MOCK_ONLY_CODE" }, true)).rejects.toThrow();
    expect(mock.world.requests).toHaveLength(count);
    try { j.read(); readableAfterLoser = true; } catch { /* Regression evidence: the losing invocation closed the owner. */ }
  } finally { release.release(); }
  const result = await owner;
  expect(readableAfterLoser).toBe(true);
  expect(result.ok).toBe(true);
  expect(record(f.root).stage).toBe(phase === "upload" ? "DONE" : "READY");
  expect(posts(f.root)).toHaveLength(phase === "upload" ? 2 : 0);
});

it("does not let an in-flight confirmed checkpoint reopen a shared HOLD or dispatch another file", async () => {
  const f = fixture(); await bootstrapMockFixture(f); const approved = approveMockUpload(f);
  const j = PilotJournal.open(f.journalDir), oauth = fixtureOAuth(f.root, f.binding), mock = new MockGateHttp(f.root);
  const entered = pause(), release = pause(); let lease: unknown;
  const acquire = j.acquire.bind(j);
  vi.spyOn(j, "acquire").mockImplementation(() => { const acquired = acquire(); lease = acquired; return acquired; });
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await mock.fetch(input, init);
    if (init?.method === "POST" && new URL(String(input)).pathname === "/upload/drive/v3/files" && posts(f.root).length === 1) {
      entered.release(); await release.wait;
    }
    return response;
  });
  const outcome = settle(executePilotUpload(j, oauth, approved, f.authority));
  try {
    await Promise.race([entered.wait, outcome.then(() => { throw Error("upload ended before uncertain POST pause"); })]);
    Reflect.apply(j.hold, j, ["mock_owner_cancelled", lease]);
    expect(j.read().stage).toBe("HOLD");
  } finally { release.release(); }
  const result = await outcome;
  expect(result.ok).toBe(false);
  expect(record(f.root)).toMatchObject({ stage: "HOLD", holdCode: "mock_owner_cancelled" });
  expect(posts(f.root)).toHaveLength(1);
});

it("rejects the final cold readback that arrives after signed expiry instead of marking DONE", async () => {
  const f = fixture(); await bootstrapMockFixture(f);
  const now = Date.now(), expiry = now + 1000;
  const approved = approveMockUpload(f, { notBefore: new Date(now - 1000).toISOString(), expiresAt: new Date(expiry).toISOString() });
  const mock = new MockGateHttp(f.root), entered = pause(), release = pause(); let archiveReads = 0;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await mock.fetch(input, init), u = new URL(String(input));
    if (u.pathname.endsWith("MOCK_RESERVED_ARCHIVE") && u.searchParams.get("alt") === "media" && ++archiveReads === 2) {
      entered.release(); await release.wait;
    }
    return response;
  });
  const outcome = settle(executePilotUpload(PilotJournal.open(f.journalDir), fixtureOAuth(f.root, f.binding), approved, f.authority));
  try {
    await Promise.race([entered.wait, outcome.then(() => { throw Error("cold readback pause was not reached"); })]);
    vi.setSystemTime(expiry + 1);
  } finally { release.release(); }
  const result = await outcome;
  expect(result.ok).toBe(false);
  expect(record(f.root).stage).toBe("HOLD");
  expect(posts(f.root)).toHaveLength(2);
});

it("bounds a stalled grant wait by the approved window and leaves its reservation terminal", async () => {
  const f = fixture(); await bootstrapMockFixture(f);
  const now = Date.now(), expiry = now + 1000;
  const approved = approveMockUpload(f, { notBefore: new Date(now - 1000).toISOString(), expiresAt: new Date(expiry).toISOString() });
  const oauth = fixtureOAuth(f.root, f.binding), entered = pause(), release = pause(), mock = new MockGateHttp(f.root);
  const valid = oauth.validThrough.bind(oauth);
  vi.spyOn(oauth, "validThrough").mockImplementation(async deadline => { entered.release(); await release.wait; return valid(deadline); });
  vi.stubGlobal("fetch", mock.fetch); vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(now);
  let settled = false;
  const outcome = settle(executePilotUpload(PilotJournal.open(f.journalDir), oauth, approved, f.authority)).then(r => { settled = true; return r; });
  let bounded = false;
  try { await entered.wait; await vi.advanceTimersByTimeAsync(1001); bounded = settled; }
  finally { release.release(); }
  const result = await outcome;
  expect(bounded).toBe(true);
  expect(result.ok).toBe(false);
  expect(record(f.root).stage).toBe("HOLD"); expect(posts(f.root)).toHaveLength(0);
});

it("refuses a delayed custody callback's actual commit after the bootstrap deadline", async () => {
  const f = fixture(), now = Date.now(), expiry = now + 1000;
  const approved = f.sign({ ...f.bootstrap.permit, notBefore: new Date(now - 1000).toISOString(), expiresAt: new Date(expiry).toISOString() });
  const entered = pause(), release = pause(), writes: string[] = [], mock = new MockGateHttp(f.root);
  const oauth = new PilotOAuthBinding(f.binding, async () => "MOCK_ONLY_CLIENT_SECRET", {
    read: async () => null,
    write: async (sealed: string, commit?: (effect: () => void) => void) => {
      entered.release(); await release.wait;
      const effect = () => { writes.push(sealed); };
      if (commit) commit(effect); else effect();
    },
  });
  const consent = oauth.beginConsent(approved, f.authority);
  vi.stubGlobal("fetch", mock.fetch); vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(now);
  let settled = false;
  const outcome = settle(bootstrapPilotFolder(PilotJournal.open(f.journalDir), oauth, approved, f.authority, { state: consent.state, code: "MOCK_ONLY_CODE" }))
    .then(r => { settled = true; return r; });
  let bounded = false;
  try { await entered.wait; await vi.advanceTimersByTimeAsync(1001); bounded = settled; }
  finally { release.release(); }
  const result = await outcome;
  await Promise.resolve(); await Promise.resolve();
  expect.soft(bounded).toBe(true); expect.soft(writes.length).toBe(0);
  expect(result.ok).toBe(false); expect(record(f.root).stage).toBe("HOLD");
  expect(mock.world.requests.filter(r => r.path.startsWith("/drive/"))).toHaveLength(0);
});

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PilotJournal, type PilotLease } from "./drive-pilot-journal";
import { PilotOperation } from "./drive-pilot-operation";
import { PilotOAuthBinding, bootstrapPilotFolder } from "./drive-pilot-bootstrap";
import { executePilotUpload } from "./drive-pilot-gate";
import { PriceError } from "./model";
import { approveMockUpload, bootstrapMockFixture, createMockGateFixture, fixtureOAuth, MockGateHttp } from "./drive-pilot-gate-mock";

const roots: string[] = [];
function fixture() { const f = createMockGateFixture(); roots.push(f.root); return f; }
function pause() { let release!: () => void; const wait = new Promise<void>(r => { release = r; }); return { wait, release }; }
function settle<T>(p: Promise<T>) { return p.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })); }
function record(root: string) { const j = PilotJournal.open(path.join(root, "journal")); try { return j.read(); } finally { j.close(); } }
function posts(root: string) { return new MockGateHttp(root).world.requests.filter(r => r.method === "POST" && r.path === "/upload/drive/v3/files"); }
const drain = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "56".repeat(32)); vi.stubEnv("MARKET_PRICES_PROFILE", "free-first-mvp-v1");
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", ""); vi.stubEnv("MARKET_PRICES_ENABLED", "1"); // In-memory MCP only.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("unexpected network in pilot admission test")));
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("requires the acquiring invocation for mutation and cleanup, even when the journal handle is shared", () => {
  const f = fixture(), j = PilotJournal.open(f.journalDir), other = PilotJournal.open(f.journalDir), owner = j.acquire(), loser = Symbol("not the owner");
  try {
    expect(() => j.update(r => { r.bootstrapBudget.driveRequests++; }, loser)).toThrow("pilot_journal_lease_required");
    expect(() => j.hold("loser", loser)).toThrow("pilot_journal_lease_required");
    j.close(loser); j.close();
    expect(j.read().stage).toBe("PREPARED"); expect(() => other.acquire()).toThrow("pilot_single_writer_busy_hold");
    j.consume(f.bootstrap, false, owner); expect(j.read().stage).toBe("BOOTSTRAP_APPROVED");
  } finally { other.close(); j.close(owner); }
});

it("rejects a stale checkpoint's refunded counters, rolled-back object and renewed start, then keeps HOLD absorbing", async () => {
  const f = fixture(); await bootstrapMockFixture(f); const approved = approveMockUpload(f);
  if (approved.permit.phase !== "upload") throw Error("fixture phase");
  const archive = approved.permit.archive, j = PilotJournal.open(f.journalDir), lease = j.acquire();
  try {
    j.consume(approved, false, lease);
    j.update(r => {
      r.upload!.counters = { requests: 3, uploadedWireBytes: 200, downloadedBytes: 100, downloadReservationBytes: 65536, uploadAttempts: 1 };
      r.upload!.objects = [{ role: "priceArchive", phase: "uncertain", sha256: archive.sha256, bytes: archive.bytes }];
    }, lease);
    const stale = j.read().upload!;
    j.update(r => { r.upload!.counters.requests++; r.upload!.counters.downloadReservationBytes += 65536; r.upload!.objects[0].phase = "confirmed"; r.upload!.objects[0].id = archive.id; r.stage = "ARCHIVE_VERIFIED"; }, lease);
    const reserved = j.read();
    expect(() => j.update(r => { r.upload = stale; }, lease)).toThrow("pilot_journal_regression_hold");
    expect(() => j.update(r => { r.upload!.startedAt++; }, lease)).toThrow("pilot_journal_regression_hold");
    expect(() => j.update(r => { r.bootstrapBudget.driveRequests--; }, lease)).toThrow("pilot_journal_regression_hold");
    expect(j.read()).toEqual(reserved);
    j.hold("first_cause", lease); const held = j.read();
    expect(() => j.update(r => { r.stage = "DONE"; }, lease)).toThrow("pilot_terminal_journal_hold");
    j.hold("late_failure", lease); expect(j.read()).toEqual(held);
  } finally { j.close(lease); }
});

it("keeps successful DONE absorbing when a late failure tries to hold it", async () => {
  const f = fixture(); await bootstrapMockFixture(f); const approved = approveMockUpload(f), mock = new MockGateHttp(f.root);
  vi.stubGlobal("fetch", mock.fetch);
  await executePilotUpload(PilotJournal.open(f.journalDir), fixtureOAuth(f.root, f.binding), approved, f.authority);
  const j = PilotJournal.open(f.journalDir), lease = j.acquire(), done = j.read();
  try {
    j.hold("late_failure", lease); expect(j.read()).toEqual(done);
    expect(() => j.update(r => { r.stage = "UPLOAD_STARTED"; }, lease)).toThrow("pilot_terminal_journal_hold");
    expect(() => j.consume(approved, true, lease)).toThrow("pilot_terminal_journal_hold");
  } finally { j.close(lease); }
  expect(posts(f.root)).toHaveLength(2);
});

it("preserves READBACK_VERIFIED recovery progress until the original remaining cap stops it, without refund or repost", async () => {
  const f = fixture(); await bootstrapMockFixture(f); const approved = approveMockUpload(f), mock = new MockGateHttp(f.root), j = PilotJournal.open(f.journalDir);
  const update = j.update.bind(j); let interrupted = false;
  vi.spyOn(j, "update").mockImplementation((change, lease, admit) => {
    update(change, lease, admit);
    if (!interrupted && j.read().stage === "READBACK_VERIFIED") { interrupted = true; throw new PriceError("drive_request_failed"); }
  });
  vi.stubGlobal("fetch", mock.fetch);
  await expect(executePilotUpload(j, fixtureOAuth(f.root, f.binding), approved, f.authority)).rejects.toThrow("drive_request_failed");
  const before = record(f.root); expect(before.stage).toBe("READBACK_VERIFIED"); expect(before.upload!.counters.requests).toBe(14);
  let firstStage: string | undefined;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => { firstStage ??= record(f.root).stage; return mock.fetch(input, init); });
  await expect(executePilotUpload(PilotJournal.open(f.journalDir), fixtureOAuth(f.root, f.binding), approved, f.authority, true))
    .rejects.toThrow(/pilot_(request|byte)_budget_exhausted/);
  const after = record(f.root);
  expect(firstStage).toBe("READBACK_VERIFIED"); expect(after.stage).toBe("HOLD"); expect(after.holdCode).toMatch(/^pilot_(request|byte)_budget_exhausted$/);
  expect(after.upload!.startedAt).toBe(before.upload!.startedAt); expect(after.upload!.objects).toEqual(before.upload!.objects);
  const priorCounters = before.upload!.counters;
  for (const k of Object.keys(priorCounters) as (keyof typeof priorCounters)[]) expect(after.upload!.counters[k]).toBeGreaterThanOrEqual(priorCounters[k]);
  expect(after.upload!.counters.requests).toBeLessThanOrEqual(24); expect(after.upload!.counters.downloadReservationBytes).toBeLessThanOrEqual(2097152);
  expect(after.readback).toEqual(before.readback); expect(posts(f.root)).toHaveLength(2);
});

it.each([1, 5])("stops before dispatch when explicit journal fsync fails at reservation boundary %s", async failAt => {
  const f = fixture(), j = PilotJournal.open(f.journalDir), oauth = fixtureOAuth(f.root, f.binding), consent = oauth.beginConsent(f.bootstrap, f.authority), mock = new MockGateHttp(f.root);
  const sync = fs.fsyncSync; let calls = 0;
  vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (++calls === failAt) throw Error("mock disk sync failure"); sync(fd); });
  vi.stubGlobal("fetch", mock.fetch);
  await expect(bootstrapPilotFolder(j, oauth, f.bootstrap, f.authority, { state: consent.state, code: "MOCK_ONLY_CODE" })).rejects.toThrow();
  expect(mock.world.requests).toHaveLength(0);
  const r = record(f.root); expect(r.stage).toBe(failAt === 1 ? "PREPARED" : "HOLD");
  expect(r.bootstrapBudget.oauthTokenCalls).toBe(failAt === 1 ? 0 : 1);
});

it.each(["HOLD", "lost_owner"] as const)("rejects an actual delayed custody commit after %s and preserves the current owner's state", async reason => {
  const f = fixture(), j = PilotJournal.open(f.journalDir), mock = new MockGateHttp(f.root), entered = pause(), release = pause();
  let lease!: PilotLease, attempts = 0; const writes: string[] = [], acquire = j.acquire.bind(j);
  vi.spyOn(j, "acquire").mockImplementation(() => { lease = acquire(); return lease; });
  const oauth = new PilotOAuthBinding(f.binding, async () => "MOCK_ONLY_CLIENT_SECRET", { read: async () => null,
    write: async (sealed, commit) => { entered.release(); await release.wait; attempts++; commit(() => { writes.push(sealed); }); },
  });
  const consent = oauth.beginConsent(f.bootstrap, f.authority); vi.stubGlobal("fetch", mock.fetch);
  const outcome = settle(bootstrapPilotFolder(j, oauth, f.bootstrap, f.authority, { state: consent.state, code: "MOCK_ONLY_CODE" }));
  try {
    await Promise.race([entered.wait, outcome.then(() => { throw Error("custody pause not reached"); })]);
    if (reason === "HOLD") j.hold("owner_cancelled", lease);
    else { // Fault-inject a replaced shared lease; the stale invocation must not release or hold it.
      const db = new Database(j.filename); db.prepare("UPDATE lease SET nonce='MOCK_REPLACEMENT_OWNER' WHERE id=1").run(); db.close();
    }
  } finally { release.release(); }
  const result = await outcome; expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatchObject({ code: reason === "HOLD" ? "owner_cancelled" : "pilot_journal_lease_lost_hold" });
  expect(attempts).toBe(1); expect(writes).toHaveLength(0); expect(oauth.receipt()).toBeNull();
  expect(record(f.root).stage).toBe(reason === "HOLD" ? "HOLD" : "BOOTSTRAP_APPROVED");
  if (reason === "HOLD") expect(record(f.root).holdCode).toBe("owner_cancelled");
  else { const db = new Database(j.filename); expect(db.prepare("SELECT nonce FROM lease WHERE id=1").get()).toEqual({ nonce: "MOCK_REPLACEMENT_OWNER" }); db.close(); }
  expect(mock.world.requests.filter(r => r.path.startsWith("/drive/"))).toHaveLength(0);
});

it.each(["secret", "custody_read"] as const)("bounds a stalled %s and ignores its late return without granting access or dispatching", async phase => {
  const f = fixture(); if (phase === "custody_read") await bootstrapMockFixture(f);
  const sealed = phase === "custody_read" ? fs.readFileSync(path.join(f.root, "mock-custody.sealed"), "utf8") : null;
  const now = Date.now(), expires = now + 1000, window = { notBefore: new Date(now - 1000).toISOString(), expiresAt: new Date(expires).toISOString() };
  const approved = phase === "secret" ? f.sign({ ...f.bootstrap.permit, ...window }) : approveMockUpload(f, window);
  const entered = pause(), release = pause(), mock = new MockGateHttp(f.root), before = mock.world.requests.length;
  const oauth = new PilotOAuthBinding(f.binding, async () => { entered.release(); await release.wait; return "MOCK_ONLY_CLIENT_SECRET"; }, {
    read: async () => { entered.release(); await release.wait; return sealed; }, write: async () => { throw Error("unexpected custody write"); },
  });
  const consent = phase === "secret" ? oauth.beginConsent(approved, f.authority) : null;
  vi.stubGlobal("fetch", mock.fetch); vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(now);
  let settled = false;
  const outcome = settle<unknown>(phase === "secret"
    ? bootstrapPilotFolder(PilotJournal.open(f.journalDir), oauth, approved, f.authority, { state: consent!.state, code: "MOCK_ONLY_CODE" })
    : executePilotUpload(PilotJournal.open(f.journalDir), oauth, approved, f.authority)).then(r => { settled = true; return r; });
  let bounded = false;
  try { await entered.wait; await vi.advanceTimersByTimeAsync(1001); bounded = settled; } finally { release.release(); }
  expect((await outcome).ok).toBe(false); await drain();
  expect(bounded).toBe(true); expect(oauth.receipt()).toBeNull(); expect(mock.world.requests).toHaveLength(before);
  const r = record(f.root); expect(r.stage).toBe("HOLD");
  if (phase === "custody_read") expect(r.upload).toMatchObject({ startedAt: now, counters: { requests: 0 } });
  else expect(r.bootstrapBudget.oauthTokenCalls).toBe(1); // Reservation is never refunded by timeout.
});

it.each(["body", "last_mcp_tool", "mcp_cleanup"] as const)("bounds delayed %s and rejects finalization without late state or further HTTP", async phase => {
  const f = fixture(); await bootstrapMockFixture(f);
  const now = Date.now(), expires = now + 1000;
  const approved = approveMockUpload(f, { notBefore: new Date(now - 1000).toISOString(), expiresAt: new Date(expires).toISOString() });
  const mock = new MockGateHttp(f.root), entered = pause(), release = pause();
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await mock.fetch(input, init), u = new URL(String(input));
    if (phase !== "body" || !u.pathname.endsWith("MOCK_RESERVED_ARCHIVE") || u.searchParams.get("alt") !== "media") return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      entered.release(); void release.wait.then(() => { controller.enqueue(bytes); controller.close(); });
    } })); // Deliberately ignores abort to exercise the outer absolute deadline.
  });
  if (phase === "last_mcp_tool") {
    const call = Client.prototype.callTool;
    vi.spyOn(Client.prototype, "callTool").mockImplementation(async function (this: Client, ...args) {
      const result = await call.apply(this, args);
      if (args[0].name === "list_price_instruments") { entered.release(); await release.wait; }
      return result;
    });
  }
  if (phase === "mcp_cleanup") {
    const close = Client.prototype.close;
    vi.spyOn(Client.prototype, "close").mockImplementation(async function (this: Client) { await close.call(this); entered.release(); await release.wait; });
  }
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(now);
  let settled = false;
  const outcome = settle(executePilotUpload(PilotJournal.open(f.journalDir), fixtureOAuth(f.root, f.binding), approved, f.authority)).then(r => { settled = true; return r; });
  let bounded = false, count = 0;
  try {
    await Promise.race([entered.wait, outcome.then(() => { throw Error("controlled pause not reached"); })]);
    count = mock.world.requests.length; await vi.advanceTimersByTimeAsync(1001); bounded = settled;
  } finally { release.release(); }
  expect((await outcome).ok).toBe(false); await drain();
  expect(bounded).toBe(true); expect(mock.world.requests).toHaveLength(count);
  const held = record(f.root); expect(held.stage).toBe("HOLD"); expect(held.readback?.mcpBarsDigest).toBeUndefined();
  expect(posts(f.root)).toHaveLength(phase === "body" ? 1 : 2);
  if (phase === "body") expect(held.upload!.objects[0].phase).toBe("uncertain");
});

it("preserves caller cancellation in bounded waits and refuses an adapter that finishes without its admitted commit", async () => {
  const f = fixture(), j = PilotJournal.open(f.journalDir), lease = j.acquire(), op = new PilotOperation(j, lease, Date.now() + 5000), caller = new AbortController();
  let observed: AbortSignal | undefined; const entered = pause();
  const waiting = op.run(signal => { observed = signal; entered.release(); return new Promise<never>(() => {}); }, caller.signal);
  try {
    await entered.wait; caller.abort(); await expect(waiting).rejects.toThrow("pilot_cancelled_hold"); expect(observed?.aborted).toBe(true);
    const admission = op.custodyCommit(); expect(() => admission.finish()).toThrow("pilot_custody_commit_missing");
    expect(() => admission.commit(() => {})).toThrow("pilot_custody_commit_refused");
  } finally { op.close(); j.close(lease); }
});


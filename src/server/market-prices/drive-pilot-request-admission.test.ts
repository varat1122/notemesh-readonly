import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoogleDriveArchives } from "./drive-archive";
import { PilotJournal } from "./drive-pilot-journal";
import { PilotOperation } from "./drive-pilot-operation";
import { DrivePilotSession } from "./drive-pilot";
import { syntheticPilotBundle } from "./drive-pilot-demo";
import { MOCK_PILOT, mockPilotGrant } from "./drive-pilot-mock";
import { approveMockUpload, bootstrapMockFixture, createMockGateFixture, MockGateHttp } from "./drive-pilot-gate-mock";

const roots: string[] = [];
function fixture() { const f = createMockGateFixture(); roots.push(f.root); return f; }
function ownedSession(f: ReturnType<typeof fixture>) {
  const approved = approveMockUpload(f), p = approved.permit;
  if (p.phase !== "upload") throw Error("fixture phase");
  const j = PilotJournal.open(f.journalDir), owner = j.acquire(); j.consume(approved, false, owner);
  const initial = j.read().upload!, op = new PilotOperation(j, owner, Math.min(Date.parse(p.expiresAt), initial.startedAt + 120000));
  const bundle = syntheticPilotBundle(), session = new DrivePilotSession(MOCK_PILOT, mockPilotGrant, {
    initial, payloads: { priceArchive: bundle.archive, priceCatalogue: bundle.catalogue(p.archive.id) },
    plannedIds: { priceArchive: p.archive.id, priceCatalogue: p.catalogue.id }, folderEvidenceSha256: p.folderEvidenceSha256,
    deadlineAt: op.deadlineAt, operation: op, save: checkpoint => op.update(r => { r.upload = checkpoint; }),
  });
  return { j, owner, op, session, bundle };
}
function receipt(name: string, data: unknown) {
  const directory = process.env.IOS_ORCH_EVIDENCE_DIR;
  if (directory) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify({
      syntheticOnly: true, actualNetworkRequests: 0,
      implementationSha256: crypto.createHash("sha256").update(fs.readFileSync(new URL("./drive-pilot.ts", import.meta.url))).digest("hex"),
      result: data,
    }, null, 2));
  }
}
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "56".repeat(32)); vi.stubEnv("MARKET_PRICES_PROFILE", "free-first-mvp-v1");
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("unexpected network in request admission test")));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// Selectively adapted from C1's six request-admission cases; retain ORIGINAL-R1 ownership/operation APIs.
it.each(["outside_id", "unscoped_list", "raw_post"])("rejects %s before transport or spending an unapproved dispatch", async kind => {
  const f = fixture(); await bootstrapMockFixture(f); const s = ownedSession(f);
  const transport = vi.fn(async () => Response.json({ id: "MOCK_OUTSIDE" })); vi.stubGlobal("fetch", transport);
  const url = kind === "outside_id" ? "https://www.googleapis.com/drive/v3/files/MOCK_OUTSIDE"
    : kind === "unscoped_list" ? "https://www.googleapis.com/drive/v3/files" : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  let denied = 0;
  try {
    for (let i = 0; i < 3; i++) try { await s.session.bytes(url, kind === "raw_post" ? { method: "POST", body: Buffer.from("raw") } : {}); } catch { denied++; }
    receipt(kind, { denied, dispatched: transport.mock.calls.length, counters: s.session.status() });
    expect(denied).toBe(3); expect(transport).not.toHaveBeenCalled(); expect(s.session.status().uploadAttempts).toBe(0);
  } finally { s.op.close(); s.j.close(s.owner); }
});

it.each(["parent", "id", "payload"])("rejects altered multipart %s before any upload POST", async kind => {
  const f = fixture(); await bootstrapMockFixture(f); const s = ownedSession(f), m = new MockGateHttp(f.root); vi.stubGlobal("fetch", m.fetch);
  const original = s.session.bytes.bind(s.session);
  vi.spyOn(s.session, "bytes").mockImplementation(async (url, init = {}, max) => {
    if (init.method === "POST") {
      const body = Buffer.from(init.body as Buffer), begin = body.indexOf("\r\n\r\n") + 4, end = body.indexOf("\r\n--", begin), meta = JSON.parse(body.subarray(begin, end).toString());
      if (kind === "parent") meta.parents = ["MOCK_FOREIGN_PARENT"];
      if (kind === "id") meta.id = "MOCK_FOREIGN_ID";
      const changed = Buffer.concat([body.subarray(0, begin), Buffer.from(JSON.stringify(meta)), body.subarray(end)]);
      if (kind === "payload") changed[changed.length - 80] ^= 1;
      init = { ...init, body: changed };
    }
    return original(url, init, max);
  });
  try {
    await expect(new GoogleDriveArchives("priceArchive", s.session).publish(s.bundle.archive)).rejects.toThrow();
    const posts = m.world.requests.filter(r => r.path === "/upload/drive/v3/files");
    receipt("multipart_" + kind, { dispatchedPosts: posts.length, counters: s.session.status() });
    expect(posts).toHaveLength(0); expect(s.session.status().uploadAttempts).toBe(1);
  } finally { s.op.close(); s.j.close(s.owner); }
});

it("consumes a valid multipart dispatch ticket once and never forwards its replay", async () => {
  const f = fixture(); await bootstrapMockFixture(f); const s = ownedSession(f), m = new MockGateHttp(f.root); vi.stubGlobal("fetch", m.fetch);
  const original = s.session.bytes.bind(s.session);
  let sent: { url: string; init: RequestInit } | undefined;
  vi.spyOn(s.session, "bytes").mockImplementation((url, init = {}, max) => {
    if (init.method === "POST") sent = { url, init: { ...init, body: Buffer.from(init.body as Buffer) } };
    return original(url, init, max);
  });
  try {
    await new GoogleDriveArchives("priceArchive", s.session).publish(s.bundle.archive);
    if (!sent) throw Error("valid adapter POST was not reached");
    const before = m.world.requests.filter(r => r.path === "/upload/drive/v3/files").length;
    await expect(original(sent.url, sent.init)).rejects.toThrow();
    const after = m.world.requests.filter(r => r.path === "/upload/drive/v3/files").length;
    receipt("ticket_replay", { before, after, counters: s.session.status() });
    expect(before).toBe(1); expect(after).toBe(1); expect(s.session.status().uploadAttempts).toBe(1);
  } finally { s.op.close(); s.j.close(s.owner); }
});

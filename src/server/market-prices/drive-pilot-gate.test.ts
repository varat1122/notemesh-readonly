import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canonicalJSON, gateDigest, verifyGatePermit, type GatePermit } from "./drive-pilot-approval";
import { PilotJournal } from "./drive-pilot-journal";
import { bootstrapPilotFolder, pilotConsentCallback } from "./drive-pilot-bootstrap";
import { executePilotUpload, uploadPermitProposal, singleUseGatePlan } from "./drive-pilot-gate";
import { createMockGateFixture, bootstrapMockFixture, approveMockUpload, fixtureOAuth, invokeMockWorker, MockGateHttp, runSingleUseGateDryRun, type MockFailure } from "./drive-pilot-gate-mock";

const roots: string[] = [];
function fixture() { const f = createMockGateFixture(); roots.push(f.root); return f; }
function worldFailure(root: string, failure: MockFailure) { const m = new MockGateHttp(root); m.world.failure = failure; m.save(); }
function record(root: string) { const j = PilotJournal.open(path.join(root, "journal")); try { return j.read(); } finally { j.close(); } }
function posts(root: string) { return new MockGateHttp(root).world.requests.filter(r => r.method === "POST" && r.path === "/upload/drive/v3/files"); }
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "56".repeat(32)); vi.stubEnv("MARKET_PRICES_PROFILE", "free-first-mvp-v1");
  vi.stubEnv("MARKET_PRICES_RIGHTS_REVIEW", ""); vi.stubEnv("MARKET_PRICES_ENABLED", "0");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("proves normal and two SIGKILL/restart flows through the real adapter/formats/cold MCP without forwarding any fetch", async () => {
  const sentinel = vi.fn().mockRejectedValue(Error("no network allowed")); vi.stubGlobal("fetch", sentinel);
  const r = await runSingleUseGateDryRun();
  expect(r).toMatchObject({ status: "SINGLE_USE_GATE_MOCK_PASS", actualNetworkRequests: 0, actualDriveRequests: 0, actualOAuthRequests: 0, actualMarketRequests: 0, ownerApprovedLive: "UNSET" });
  expect(r.results).toHaveLength(3);
  for (const x of r.results) {
    expect(x.bootstrap).toMatchObject({ budget: { driveRequests: 6, oauthTokenCalls: 1, folderCreates: 1 }, oauth: { actualScopeObservedAtExchange: true } });
    expect(x.result).toMatchObject({ status: "DONE", mcp: { bars: { instrument: { id: "US:AAPL" }, series: { dataOrigin: "synthetic_fixture", rights: { status: "RIGHTS_HOLD" } } } }, durability: { journalMode: "delete", synchronous: 2, explicitFileAndDirectoryFsync: true } });
    expect(x.result.mcp.bars.bars).toHaveLength(2); expect(x.files).toHaveLength(2);
    expect(x.mockRequests.filter(q => q.path === "/upload/drive/v3/files")).toHaveLength(2);
    expect(x.result.budget.requests).toBeLessThanOrEqual(24); expect(x.result.budget.downloadReservationBytes).toBeLessThanOrEqual(2097152);
    expect(x.duplicateInvocation).toMatchObject({ status: "STOPPED", exitCode: 1, code: "pilot_terminal_journal_hold" });
    if (x.scenario !== "start") expect(x.firstExit.signal).toBe("SIGKILL");
  }
  expect(r.results.map(x => x.result.budget.requests)).toEqual([14, 19, 22]);
  expect(JSON.stringify(r)).not.toMatch(/MOCK_ONLY_(EPHEMERAL_ACCESS|CLIENT_SECRET|CODE)/);
  expect(sentinel).not.toHaveBeenCalled(); expect(globalThis.fetch).toBe(sentinel); expect(process.env.MARKET_PRICES_ENABLED).toBe("0");
}, 30000);

it.each(["absent_signature", "operator_key", "wrong_candidate", "wrong_principal", "wrong_client", "wrong_scope", "expired", "future", "missing_owner_evidence", "unconfirmed_quota", "paid_cost", "wrong_key_custody"])("rejects an invalid independent permit before HTTP: %s", reason => {
  const f = fixture(), sentinel = vi.fn(); vi.stubGlobal("fetch", sentinel);
  const p = JSON.parse(JSON.stringify(f.bootstrap.permit)) as GatePermit;
  if (reason === "wrong_candidate") p.binding.candidateTree = "0".repeat(40);
  if (reason === "wrong_principal") p.binding.principalId = "MOCK_OTHER_OWNER";
  if (reason === "wrong_client") p.binding.clientId = "other.apps.googleusercontent.com";
  if (reason === "wrong_scope") (p.binding as { scope: string }).scope = "https://www.googleapis.com/auth/drive";
  if (reason === "expired") { p.notBefore = new Date(Date.now() - 3000).toISOString(); p.expiresAt = new Date(Date.now() - 1000).toISOString(); }
  if (reason === "future") { p.notBefore = new Date(Date.now() + 3000).toISOString(); p.expiresAt = new Date(Date.now() + 10000).toISOString(); }
  if (reason === "missing_owner_evidence") p.ownerEvidenceRef = "UNSET";
  if (reason === "unconfirmed_quota") p.quotaEvidenceRef = "UNSET";
  if (reason === "paid_cost") (p as { expectedCostUSD: number }).expectedCostUSD = 1;
  if (reason === "wrong_key_custody") vi.stubEnv("ENCRYPTION_KEY", "67".repeat(32));
  const envelope = reason === "absent_signature" ? { permit: p, approvalRef: "operator-claims-approved" } : reason === "operator_key" ? fixture().sign(p) : f.sign(p);
  expect(() => verifyGatePermit(envelope, f.authority, f.binding, "bootstrap")).toThrow("pilot_independent_approval_missing_invalid_expired_or_mismatched");
  expect(sentinel).not.toHaveBeenCalled(); expect(record(f.root).stage).toBe("PREPARED");
});
it("binds PKCE exchange to the exact approved client/redirect/scope and never stores a token in the journal", async () => {
  const f = fixture(), m = new MockGateHttp(f.root), oauth = fixtureOAuth(f.root, f.binding);
  const consent = oauth.beginConsent(f.bootstrap, f.authority), challenge = new URL(consent.url).searchParams.get("code_challenge");
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input).includes("oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe(f.binding.clientId); expect(body.get("redirect_uri")).toBe(f.binding.redirectUri);
      expect(crypto.createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(challenge);
    }
    return m.fetch(input, init);
  });
  const result = await bootstrapPilotFolder(PilotJournal.open(f.journalDir), oauth, f.bootstrap, f.authority, { state: consent.state, code: "MOCK_ONLY_CODE" });
  expect(result.status).toBe("READY_FOR_SEPARATE_UPLOAD_APPROVAL");
  expect(result.ownerOnlyAcl).toMatchObject({ ownerPermissionIds: [f.binding.principalId], permissions: [{ id: f.binding.principalId, type: "user", role: "owner" }], shared: false, ownedByMe: true });
  expect(record(f.root).readback?.bootstrapOwnerOnlyAcl).toEqual(result.ownerOnlyAcl);
  expect(canonicalJSON(record(f.root))).not.toMatch(/MOCK_ONLY_(EPHEMERAL_ACCESS|CLIENT_SECRET|CODE)/);
  expect(record(f.root).allocatedIds).toEqual({ archive: "MOCK_RESERVED_ARCHIVE", catalogue: "MOCK_RESERVED_CATALOGUE" });
});
it("accepts a simulated pilot-only callback and refuses wrong state, denial, redirect or duplicate code without browser/network", () => {
  const f = fixture(), callback = f.binding.redirectUri + "?state=MOCK_STATE&code=MOCK_ONLY_CODE";
  expect(pilotConsentCallback(f.binding, "MOCK_STATE", callback)).toEqual({ state: "MOCK_STATE", code: "MOCK_ONLY_CODE" });
  for (const url of [callback.replace("MOCK_STATE", "WRONG_STATE"), callback + "&code=SECOND", callback + "&error=access_denied", callback.replace(":39005/", ":39006/")])
    expect(() => pilotConsentCallback(f.binding, "MOCK_STATE", url)).toThrow("pilot_callback_denied_or_mismatched");
});
it.each(["scope", "consent_denied", "wrong_principal", "shared", "wrong_owner", "unbound", "preexisting", "nonempty"] as const)("HOLDs unsafe mocked consent/folder bootstrap: %s", async reason => {
  const f = fixture(); worldFailure(f.root, reason);
  await expect(bootstrapMockFixture(f)).rejects.toThrow();
  expect(record(f.root).stage).toBe("HOLD"); expect(posts(f.root)).toHaveLength(0);
  expect(new MockGateHttp(f.root).world.requests.filter(q => q.role === "folder").length).toBeLessThanOrEqual(1);
});
it.each(["wrong_state", "missing_scope", "oauth_budget"])("refuses unsafe consent before any folder request: %s", async reason => {
  const f = fixture(), oauth = fixtureOAuth(f.root, f.binding), c = oauth.beginConsent(f.bootstrap, f.authority), m = new MockGateHttp(f.root);
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await m.fetch(input, init);
    if (reason === "missing_scope" && String(input).includes("oauth2.googleapis.com")) { const data = await response.json(); delete data.scope; return Response.json(data); }
    return response;
  });
  if (reason === "oauth_budget") { const j = PilotJournal.open(f.journalDir), lease = j.acquire(); j.update(r => { r.bootstrapBudget.oauthTokenCalls = 2; }, lease); j.close(lease); }
  await expect(bootstrapPilotFolder(PilotJournal.open(f.journalDir), oauth, f.bootstrap, f.authority, { state: reason === "wrong_state" ? "WRONG_STATE" : c.state, code: "MOCK_ONLY_CODE" })).rejects.toThrow();
  expect(new MockGateHttp(f.root).world.requests.filter(r => r.path.includes("/drive/"))).toHaveLength(0);
});
it.each(["unsigned_proposal", "parent", "manifest", "acl_evidence", "wrong_grant"])("rejects an unbound upload before HTTP: %s", async reason => {
  const f = fixture(); await bootstrapMockFixture(f); const approved = approveMockUpload(f);
  const p = approved.permit; if (p.phase !== "upload") throw Error("test setup");
  if (reason === "parent") p.folderId = "MOCK_PASTED_PREEXISTING_FOLDER";
  if (reason === "manifest") p.catalogue.sha256 = "0".repeat(64);
  if (reason === "acl_evidence") p.folderEvidenceSha256 = "0".repeat(64);
  const m = new MockGateHttp(f.root), count = m.world.requests.length; vi.stubGlobal("fetch", m.fetch);
  const oauth = fixtureOAuth(f.root, reason === "wrong_grant" ? { ...f.binding, clientId: "wrong.apps.googleusercontent.com" } : f.binding);
  await expect(executePilotUpload(PilotJournal.open(f.journalDir), oauth, reason === "unsigned_proposal" ? { permit: p } : f.sign(p), f.authority)).rejects.toThrow();
  expect(new MockGateHttp(f.root).world.requests).toHaveLength(count); expect(record(f.root).stage).toBe("READY");
});
it("does not consume a permit from a proposal alone or allow a bootstrap permit to execute twice", async () => {
  const f = fixture(); await bootstrapMockFixture(f); const before = new MockGateHttp(f.root).world.requests.length;
  await expect(bootstrapMockFixture(f)).rejects.toThrow("pilot_permit_used_or_wrong_stage");
  expect(new MockGateHttp(f.root).world.requests).toHaveLength(before); expect(record(f.root).stage).toBe("READY");
  const j = PilotJournal.open(f.journalDir); try { uploadPermitProposal(j, { permitId: "MOCK_PROPOSAL", notBefore: new Date().toISOString(), expiresAt: new Date(Date.now() + 100000).toISOString(), ownerEvidenceRef: "MOCK_REFERENCE_ONLY", quotaEvidenceRef: "MOCK_REFERENCE_ONLY" }); expect(j.read().stage).toBe("READY"); expect(j.read().uploadPermitDigest).toBeNull(); } finally { j.close(); }
});
it("recovers an abruptly exited folder create by marker without creating a second folder or resetting its budget", () => {
  const f = fixture(); expect(invokeMockWorker(f.root, "bootstrap-crash").signal).toBe("SIGKILL");
  expect(record(f.root)).toMatchObject({ stage: "BOOTSTRAP_APPROVED", folderAttempted: true, folderId: null });
  const recovered = invokeMockWorker(f.root, "bootstrap-recover");
  expect(recovered.payload).toMatchObject({ status: "READY_FOR_SEPARATE_UPLOAD_APPROVAL", budget: { driveRequests: 8, oauthTokenCalls: 1, folderCreates: 1 } });
  expect(new MockGateHttp(f.root).world.requests.filter(q => q.role === "folder")).toHaveLength(1);
}, 15000);
it.each(["missing", "ambiguous", "tamper", "shared", "unbound", "403", "429", "revoked"] as const)("HOLDs restarted recovery on %s without repost/reauthorization/delete", async reason => {
  const f = fixture(); await bootstrapMockFixture(f); approveMockUpload(f);
  expect(invokeMockWorker(f.root, "crash-archive").signal).toBe("SIGKILL");
  worldFailure(f.root, reason); const out = invokeMockWorker(f.root, "recover");
  expect(out.status).toBe("STOPPED"); expect(record(f.root).stage).toBe("HOLD"); expect(posts(f.root)).toHaveLength(1);
  const world = new MockGateHttp(f.root).world;
  expect(world.requests.filter(q => q.path === "/token")).toHaveLength(1); expect(world.requests.some(q => ["PATCH", "DELETE"].includes(q.method))).toBe(false);
}, 15000);
it.each(["requests", "wire", "download", "objects", "time"])("preserves hard %s budget across restart", async kind => {
  const f = fixture(); await bootstrapMockFixture(f); approveMockUpload(f); expect(invokeMockWorker(f.root, "crash-archive").signal).toBe("SIGKILL");
  const j = PilotJournal.open(f.journalDir), lease = j.acquire();
  if (kind === "time") {
    // Seed an expired historical fixture directly; the production writer refuses changes to startedAt.
    const r = j.read(); r.upload!.startedAt = Date.now() - 120001;
    const db = new Database(j.filename); db.prepare("UPDATE state SET payload=?,digest=? WHERE id=1").run(JSON.stringify(r), gateDigest(r)); db.close();
  } else j.update(r => { const c = r.upload!.counters; if (kind === "requests") c.requests = 24; if (kind === "wire") c.uploadedWireBytes = 1048576; if (kind === "download") c.downloadReservationBytes = 2097152; if (kind === "objects") c.uploadAttempts = 2; }, lease);
  j.close(lease);
  expect(invokeMockWorker(f.root, "recover").status).toBe("STOPPED"); expect(record(f.root).stage).toBe("HOLD"); expect(posts(f.root)).toHaveLength(1);
}, 15000);
it("HOLDs missing custody or journal after a crash and never rebuilds either from approvalRef", async () => {
  const f = fixture(); await bootstrapMockFixture(f); approveMockUpload(f); expect(invokeMockWorker(f.root, "crash-archive").signal).toBe("SIGKILL");
  const before = new MockGateHttp(f.root).world.requests.length;
  fs.unlinkSync(path.join(f.root, "mock-custody.sealed")); expect(invokeMockWorker(f.root, "recover").status).toBe("STOPPED");
  expect(new MockGateHttp(f.root).world.requests).toHaveLength(before); expect(record(f.root).stage).toBe("HOLD");
  const empty = path.join(f.root, "missing-journal"); fs.mkdirSync(empty, { mode: 0o700 });
  expect(() => PilotJournal.open(empty)).toThrow("pilot_missing_journal_hold"); expect(fs.readdirSync(empty)).toHaveLength(0);
}, 15000);
it("refuses unsafe journal permissions/symlinks, corrupted records and concurrent writers", () => {
  const f = fixture(), first = PilotJournal.open(f.journalDir), second = PilotJournal.open(f.journalDir);
  const lease = first.acquire();
  try { expect(() => second.acquire()).toThrow("pilot_single_writer_busy_hold"); expect(first.durability()).toMatchObject({ synchronous: 2, explicitFileAndDirectoryFsync: true }); }
  finally { second.close(); first.close(lease); }
  const link = path.join(f.root, "linked"); fs.symlinkSync(f.journalDir, link); expect(() => PilotJournal.open(link)).toThrow("pilot_journal_directory_unsafe");
  fs.chmodSync(path.join(f.journalDir, "pilot-journal.sqlite"), 0o644); expect(() => PilotJournal.open(f.journalDir)).toThrow("pilot_journal_file_unsafe");
  fs.chmodSync(path.join(f.journalDir, "pilot-journal.sqlite"), 0o600);
  fs.writeFileSync(path.join(f.journalDir, "pilot-journal.sqlite"), "corrupt fixture only"); expect(() => PilotJournal.open(f.journalDir)).toThrow("pilot_journal_open_failed_hold");
});
it("refuses dead-PID takeover if the kernel boot or PID namespace is different", () => {
  const f = fixture(), j = PilotJournal.open(f.journalDir), lease = j.acquire();
  const db = new Database(j.filename); db.prepare("UPDATE lease SET host='MOCK_DIFFERENT_HOST'").run(); db.close();
  const other = PilotJournal.open(f.journalDir);
  try { expect(() => other.acquire()).toThrow("pilot_journal_host_or_namespace_changed_hold"); }
  finally { other.close(); j.close(lease); }
});
it("leaves every unverified live field UNSET and supplies no live execution command", () => {
  const plan = singleUseGatePlan(); expect(plan.liveExecutionEnabled).toBe(false); expect(plan.checks).toEqual({ offline: "UNSET", liveOAuth: "UNSET", liveFolder: "UNSET", liveApproval: "UNSET", liveQuota: "UNSET", realDriveReadback: "UNSET" });
  expect(plan.independentOwnerPublicKeySpkiSha256).toBe("UNSET"); expect(plan.folderId).toBe("UNSET"); expect(plan.chargeCeilingUSD).toBe(0);
});

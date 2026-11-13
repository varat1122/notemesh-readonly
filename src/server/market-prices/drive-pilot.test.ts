import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrivePilotSession, PILOT_LIMITS } from "./drive-pilot";
import { MOCK_PILOT, MockPilotHttp, mockPilotGrant } from "./drive-pilot-mock";
import { drivePilotPlan, runDrivePilotDryRun, syntheticPilotBundle } from "./drive-pilot-demo";
import { GoogleDriveArchives, packDriveArchive, unpackDriveArchive } from "./drive-archive";
import { packPriceCatalogue, unpackPriceCatalogue } from "./drive-catalogue";
import { PriceStore } from "./store";
import { parseYahooChart } from "./yahoo";
import { chartFixture, TEST_NOW } from "./fixtures";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "34".repeat(32)));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() {
  const mock = new MockPilotHttp(); vi.stubGlobal("fetch", mock.fetch);
  const session = new DrivePilotSession(MOCK_PILOT, mockPilotGrant);
  return { mock, session, archive: new GoogleDriveArchives("priceArchive", session), catalogue: new GoogleDriveArchives("priceCatalogue", session), bundle: syntheticPilotBundle() };
}
it("runs the real multipart adapter, signed formats and cold MCP read with two mock objects and no external transport", async () => {
  const sentinel = vi.fn().mockRejectedValue(Error("external transport forbidden")); vi.stubGlobal("fetch", sentinel);
  vi.stubEnv("MARKET_PRICES_ENABLED", "0");
  const r = await runDrivePilotDryRun();
  expect(r).toMatchObject({ status: "MOCK_DRIVE_PILOT_PASS", actualDriveRequests: 0, actualOAuthRequests: 0, actualMarketRequests: 0,
    normal: { tamperRejected: true, budget: { requests: 14, uploadAttempts: 2, stopped: null },
      mcpRead: { instrument: { id: "US:AAPL", currency: "USD", timeZone: "America/New_York" },
        series: { dataOrigin: "synthetic_fixture", rights: { status: "RIGHTS_HOLD" } }, bars: expect.any(Array) } },
    uncertainRecovery: { first: "drive_request_failed", blockedRetry: "pilot_uncertain_reconcile_before_retry", uploads: 1, files: 1,
      reconciled: { status: "FOUND_VERIFIED_NO_REPOST" } } });
  expect(r.normal.mcpRead.bars).toHaveLength(2);
  expect(r.normal.objects).toHaveLength(2);
  expect(r.normal.objects.every(f => f.parent === MOCK_PILOT.folderId && f.mimeType === "application/octet-stream" && f.sha256 === f.appProperties.pilotSha256)).toBe(true);
  expect(r.normal.budget.uploadedWireBytes).toBeLessThan(PILOT_LIMITS.uploadedWireBytes);
  expect(r.normal.requests.every(q => ["GET", "POST"].includes(q.method))).toBe(true);
  expect(JSON.stringify(r)).not.toContain("MOCK_PLACEHOLDER_NOT_A_REAL_TOKEN");
  expect(r.stopped).toEqual(expect.arrayContaining([expect.objectContaining({ code: "drive_http_403", files: 0, furtherRequests: 0 }), expect.objectContaining({ code: "drive_http_429", files: 0, furtherRequests: 0 })]));
  expect(sentinel).not.toHaveBeenCalled(); expect(globalThis.fetch).toBe(sentinel);
  expect(process.env.MARKET_PRICES_ENABLED).toBe("0");
});
it.each([undefined, {}, { ...MOCK_PILOT, folderId: "UNSET" }, { ...MOCK_PILOT, folderId: "root" },
  { ...MOCK_PILOT, folderId: "bad' or 'q" }, { ...MOCK_PILOT, approvalRef: "UNSET" },
  { ...MOCK_PILOT, scope: "https://www.googleapis.com/auth/drive" }])("refuses an unset/unapproved context before network: %j", config => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(() => new DrivePilotSession(config, mockPilotGrant)).toThrow("pilot_unapproved_or_unset_context");
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["clientId", "principalId", "scope", "accessToken"] as const)("refuses wrong grant %s before any HTTP", async field => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const session = new DrivePilotSession(MOCK_PILOT, async () => ({ ...await mockPilotGrant(), [field]: field === "accessToken" ? "" : "WRONG" }));
  await expect(new GoogleDriveArchives("priceArchive", session).publish(syntheticPilotBundle().archive)).rejects.toThrow("pilot_identity_or_scope_mismatch");
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["wrong_principal", "shared_folder", "wrong_marker", "wrong_owner", "no_permissions", "no_write_capability"])("refuses unsafe preflight: %s", async failure => {
  const s = setup(), fake = s.mock.fetch;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await fake(input, init), u = new URL(String(input));
    if (!u.searchParams.has("fields")) return response;
    const data = await response.json();
    if (u.pathname === "/drive/v3/about" && failure === "wrong_principal") data.user.permissionId = "WRONG_OWNER";
    if (u.pathname.endsWith(MOCK_PILOT.folderId)) {
      if (failure === "shared_folder") data.shared = true;
      if (failure === "wrong_marker") data.appProperties = {};
      if (failure === "wrong_owner") data.owners[0].permissionId = "WRONG_OWNER";
      if (failure === "no_permissions") delete data.permissions;
      if (failure === "no_write_capability") data.capabilities.canAddChildren = false;
    }
    return Response.json(data);
  });
  await expect(s.archive.publish(s.bundle.archive)).rejects.toThrow(/pilot_/);
  expect(s.mock.files).toHaveLength(0); expect(s.mock.requests.some(r => r.method === "POST")).toBe(false);
});
it("rejects invalid/oversized archives and mislabelled source identity before HTTP", async () => {
  const s = setup();
  for (const b of [Buffer.alloc(0), Buffer.alloc(PILOT_LIMITS.archiveBytes + 1), Buffer.from("not an archive")]) await expect(s.archive.publish(b)).rejects.toThrow();
  // Create a valid fixture in a writable in-memory database, then change its source identity.
  const writable = new PriceStore(":memory:", true);
  try {
    const input = { market: "US", symbol: "AAPL" } as const;
    writable.save({ ...parseYahooChart(chartFixture(input), input, TEST_NOW), dataOrigin: "synthetic_fixture" });
    writable.db.prepare("UPDATE instruments SET currency='THB' WHERE id='US:AAPL'").run();
    await expect(s.archive.publish(packDriveArchive(writable.db.serialize()))).rejects.toThrow("pilot_synthetic_manifest_refused");
  } finally { writable.close(); }
  expect(s.mock.requests).toHaveLength(0);
});
it("rejects a catalogue before archive verification and inconsistent/duplicate coverage before its POST", async () => {
  const s = setup();
  await expect(s.catalogue.publish(s.bundle.catalogue("MOCK_FILE_1"))).rejects.toThrow("pilot_catalogue_manifest_refused");
  const a = await s.archive.publish(s.bundle.archive), valid = unpackPriceCatalogue(s.bundle.catalogue(a.id));
  const posts = s.mock.requests.filter(r => r.method === "POST").length;
  for (const c of [{ ...valid, entries: [{ ...valid.entries[0], archiveId: "OTHER_FILE" }] },
    { ...valid, entries: [{ ...valid.entries[0], lastDate: "2026-10-01" }] }])
    await expect(s.catalogue.publish(packPriceCatalogue(c))).rejects.toThrow();
  expect(() => packPriceCatalogue({ ...valid, entries: [valid.entries[0], valid.entries[0]] })).toThrow("duplicate partition");
  expect(s.mock.requests.filter(r => r.method === "POST")).toHaveLength(posts);
});
it.each(["tamper", "wrongParent"])("refuses a bad upload readback and cannot publish catalogue: %s", async failure => {
  const s = setup(); if (failure === "tamper") s.mock.failure = "tamper"; else s.mock.wrongParent = true;
  await expect(s.archive.publish(s.bundle.archive)).rejects.toThrow(/pilot_(readback_mismatch|file_outside_approved_manifest)/);
  await expect(s.catalogue.publish(s.bundle.catalogue("MOCK_FILE_1"))).rejects.toThrow("pilot_stopped");
  expect(s.mock.files).toHaveLength(1); expect(s.mock.files[0].appProperties.priceCatalogue).toBeUndefined();
});
it("leaves the verified archive orphan intact when catalogue publication fails; never creates a current catalogue", async () => {
  const s = setup(), a = await s.archive.publish(s.bundle.archive); s.mock.failure = "catalogue_403";
  await expect(s.catalogue.publish(s.bundle.catalogue(a.id))).rejects.toThrow("drive_http_403");
  expect(s.mock.files).toHaveLength(1); expect(s.mock.requests.every(r => !["DELETE", "PATCH"].includes(r.method))).toBe(true);
});
it.each([401, 403, 404, 429])("stops on HTTP %i with no automatic retry or fresh authentication", async status => {
  const s = setup(), fake = s.mock.fetch;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => init?.method === "POST" ? new Response("redacted", { status }) : fake(input, init));
  await expect(s.archive.publish(s.bundle.archive)).rejects.toThrow(`drive_http_${status}`);
  const count = s.session.status().requests;
  await expect(s.archive.publish(s.bundle.archive)).rejects.toThrow("pilot_stopped");
  await expect(s.session.reconcile("priceArchive")).rejects.toThrow("pilot_stopped");
  expect(s.session.status().requests).toBe(count);
});
it.each(["missing", "duplicate", "tampered"])("holds uncertain publication with %s reconciliation; never reposts", async failure => {
  const s = setup(); s.mock.failure = "unknown_after_store";
  await expect(s.archive.publish(s.bundle.archive)).rejects.toThrow("drive_request_failed");
  if (failure === "missing") s.mock.files = [];
  if (failure === "duplicate") s.mock.files.push({ ...s.mock.files[0], id: "MOCK_DUPLICATE" });
  if (failure === "tampered") s.mock.failure = "tamper";
  await expect(s.session.reconcile("priceArchive")).rejects.toThrow(/pilot_(reconciliation_hold|readback_mismatch)/);
  await expect(s.archive.publish(s.bundle.archive)).rejects.toThrow("pilot_stopped");
  expect(s.mock.requests.filter(r => r.method === "POST")).toHaveLength(1);
});
it("is idempotent for the same verified bytes, rejects changed manifests and holds a fresh process on a nonempty folder", async () => {
  const s = setup(), a = await s.archive.publish(s.bundle.archive);
  await expect(s.archive.publish(s.bundle.archive)).resolves.toMatchObject({ id: a.id });
  const db = unpackDriveArchive(s.bundle.archive).database;
  await expect(s.archive.publish(packDriveArchive(db, new Date("2026-10-17T00:00Z")))).rejects.toThrow("pilot_manifest_changed");
  const fresh = new GoogleDriveArchives("priceArchive", new DrivePilotSession(MOCK_PILOT, mockPilotGrant));
  await expect(fresh.publish(s.bundle.archive)).rejects.toThrow("pilot_existing_files_require_operator_reconciliation");
  expect(s.mock.requests.filter(r => r.method === "POST")).toHaveLength(1);
});
it("refuses duplicate catalogue generations during cold discovery", async () => {
  const s = setup(), a = await s.archive.publish(s.bundle.archive); await s.catalogue.publish(s.bundle.catalogue(a.id));
  s.mock.files.push({ ...s.mock.files[1], id: "MOCK_DUPLICATE" });
  await expect(s.catalogue.latest()).rejects.toThrow("pilot_missing_or_duplicate_generation");
});
it.each(["unscoped", "outside_path", "wrong_method", "request_cap", "wire_cap", "download_cap", "deadline"])("enforces bounded HTTP: %s", async failure => {
  const s = setup(), url = "https://www.googleapis.com/drive/v3/about?fields=user(permissionId)";
  if (failure === "unscoped") await expect(s.session.list("trashed=false")).rejects.toThrow("pilot_unscoped_listing_refused");
  if (failure === "outside_path") await expect(s.session.bytes("https://www.googleapis.com/oauth2/v1/userinfo")).rejects.toThrow("pilot_request_refused");
  if (failure === "wrong_method") await expect(s.session.bytes(url, { method: "DELETE" })).rejects.toThrow("pilot_request_refused");
  if (failure === "request_cap") {
    for (let i = 0; i < PILOT_LIMITS.requests; i++) await s.session.bytes(url);
    await expect(s.session.bytes(url)).rejects.toThrow("pilot_request_budget_exhausted");
    expect(s.mock.requests).toHaveLength(PILOT_LIMITS.requests);
  }
  if (failure === "wire_cap") await expect(s.session.bytes("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", { method: "POST", body: Buffer.alloc(PILOT_LIMITS.uploadedWireBytes + 1) })).rejects.toThrow("pilot_byte_budget_exhausted");
  if (failure === "download_cap") {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(PILOT_LIMITS.downloadedBytes + 1)));
    await expect(s.session.bytes(url, {}, PILOT_LIMITS.downloadedBytes + 1)).rejects.toThrow("pilot_byte_budget_exhausted");
  }
  if (failure === "deadline") { vi.spyOn(Date, "now").mockReturnValue(Date.now() + PILOT_LIMITS.durationMs + 1); await expect(s.session.bytes(url)).rejects.toThrow("pilot_request_budget_exhausted"); }
});
it("prints a HOLD plan with no real identity or credentials and rejects arguments that suggest live mode", () => {
  expect(drivePilotPlan()).toMatchObject({ status: "PRE_LIVE_HOLD", liveExecutionEnabled: false, folderId: "UNSET", oauthPrincipal: "UNSET", observedGrantedScope: "UNSET", objectCount: { dataArchives: 1, catalogues: 1, folderCreatesInUploadPhase: 0 } });
  const out = execFileSync(process.execPath, ["scripts/market-prices.ts", "drive-pilot-plan"], { encoding: "utf8", timeout: 15000 });
  expect(JSON.parse(out).checks.liveOAuth).toBe("UNSET");
  expect(() => execFileSync(process.execPath, ["scripts/market-prices.ts", "drive-pilot-dry-run", "--live"], { stdio: "pipe", timeout: 15000 })).toThrow();
});

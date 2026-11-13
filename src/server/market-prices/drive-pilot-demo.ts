import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPriceTools } from "../mcp/price-tools.ts";
import { DrivePilotSession, PILOT_LIMITS, pilotSha256 } from "./drive-pilot.ts";
import { MOCK_PILOT, mockPilotGrant, MockPilotHttp } from "./drive-pilot-mock.ts";
import { GoogleDriveArchives, packDriveArchive, unpackDriveArchive } from "./drive-archive.ts";
import { packPriceCatalogue } from "./drive-catalogue.ts";
import { DrivePriceCache } from "./drive-backend.ts";
import { PriceStore } from "./store.ts";
import { parseYahooChart } from "./yahoo.ts";
import { chartFixture, TEST_NOW } from "./fixtures.ts";
import { PriceError } from "./model.ts";

export function syntheticPilotBundle() {
  const input = { market: "US", symbol: "AAPL" } as const, snapshot = parseYahooChart(chartFixture(input), input, TEST_NOW);
  snapshot.dataOrigin = "synthetic_fixture";
  const store = new PriceStore(":memory:", true);
  try {
    store.save(snapshot); const database = store.db.serialize(), coverage = store.instruments()[0];
    return { archive: packDriveArchive(database, TEST_NOW), catalogue: (archiveId: string) => packPriceCatalogue({ version: 2,
      updatedAt: TEST_NOW.toISOString(), providerRetryAfter: null, entries: [{ instrument: input, archiveId, databaseBytes: database.length,
        barCount: 2, firstDate: coverage.firstDate, lastDate: coverage.lastDate, lastFetchedAt: coverage.lastFetchedAt,
        lastSuccessfulRefresh: coverage.lastSuccessfulRefresh, lastAttemptAt: TEST_NOW.toISOString(), lastAttemptSuccess: true,
        lastError: null, qualityIssueCount: 0, lastFullRefreshAt: TEST_NOW.toISOString() }] }) };
  } finally { store.close(); }
}
export function drivePilotPlan() {
  return { task: "IOS-PRICES-004", planVersion: 1, status: "PRE_LIVE_HOLD", liveExecutionEnabled: false,
    source: "candidate_synthetic_AAPL_only", sourceRights: "SYNTHETIC_ONLY; live Yahoo RIGHTS_HOLD unchanged",
    candidateTree: "UNSET", folderId: "UNSET", folderNameProposed: "InvestmentOS-Prices-Pilot-ONLY", pilotId: "UNSET",
    oauthPrincipal: "UNSET", oauthClientId: "UNSET", observedGrantedScope: "UNSET", requiredScope: MOCK_PILOT.scope,
    credentialLocation: "UNSET", signingKeyCustodian: "UNSET", accountAclEvidence: "UNSET", scopeEvidence: "UNSET",
    oneTimeApprovalReference: "UNSET", oneTimeApprovalRegistry: "UNSET", auditReceiptPath: "UNSET", executionWindow: "UNSET",
    expectedCostUSD: 0, expectedCostConditional: "Proposal only; account/storage/quota/billing must confirm zero charge before approval. No paid or quota-overage use approved.", accountQuotaAndBillingConfirmation: "UNSET", limits: PILOT_LIMITS,
    objectCount: { dataArchives: 1, catalogues: 1, folderCreatesInUploadPhase: 0 },
    separatePreparation: { approved: false, appCreatedFolderRequired: true, folderCreatesMax: 1, driveRequestsMax: 8, oauthRequestsMax: 2,
      note: "Separate approved consent/folder bootstrap before approving the exact upload parent; not implemented as a live command here." },
    readback: ["principal/client/scope", "private_owner_only_acl", "exact_parent_and_pilot_marker", "mime_role_bytes_sha256", "HMAC_and_SQLite_quick_check", "catalogue_partition_identity_and_count", "cold_MCP_read"],
    rollback: { policy: "LEAVE_AND_REPORT_UNLESS_SEPARATELY_APPROVED", trashApproved: false, deleteApproved: false },
    recovery: "No blind repost. Unknown upload -> explicit exact-parent read-only reconcile or HOLD;403/429/revoked grant ->STOP.",
    checks: { offline: "RUN_drive-pilot-dry-run_FOR_CURRENT_EVIDENCE", liveOAuth: "UNSET", liveFolder: "UNSET", liveQuota: "UNSET", durableApprovalAndCrashJournal: "UNSET" } };
}
/** Self-contained offline command; no live mode, key/credential arguments or app registration. */
export async function runDrivePilotDryRun() {
  const old = new Map<string, string | undefined>(), priorFetch = globalThis.fetch;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-drive-pilot-mock-"));
  let cache: DrivePriceCache | undefined, server: McpServer | undefined, client: Client | undefined;
  const set = (k: string, v: string | undefined) => { old.set(k, process.env[k]); if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    for (const [k, v] of Object.entries({ DATA_DIR: root, ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
      MARKET_PRICES_PROFILE: "free-first-mvp-v1", MARKET_PRICES_ENABLED: "1", MARKET_PRICES_REFRESH_ENABLED: "0",
      MARKET_PRICES_SCHEDULE: "manual", MARKET_PRICES_STORAGE: "google-drive" })) set(k, v);
    set("MARKET_PRICES_DIR", undefined); set("MARKET_PRICES_RIGHTS_REVIEW", undefined);
    const mock = new MockPilotHttp(); globalThis.fetch = mock.fetch;
    const session = new DrivePilotSession(MOCK_PILOT, mockPilotGrant), archives = new GoogleDriveArchives("priceArchive", session), catalogues = new GoogleDriveArchives("priceCatalogue", session);
    const bundle = syntheticPilotBundle(), a = await archives.publish(bundle.archive);
    await catalogues.publish(bundle.catalogue(a.id));
    cache = new DrivePriceCache(new GoogleDriveArchives("priceArchive", session), new GoogleDriveArchives("priceCatalogue", session));
    server = new McpServer({ name: "drive-pilot-mock-only", version: "1.0" });
    registerPriceTools(server, (read, requested) => cache!.read(read, requested));
    client = new Client({ name: "pilot-readback-fixture", version: "1.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(st), client.connect(ct)]);
    const read = await client.callTool({ name: "read_price_bars", arguments: { market: "US", symbol: "AAPL", limit: 2 } });
    const list = await client.callTool({ name: "list_price_instruments", arguments: {} });
    if (read.isError || list.isError) throw new PriceError("pilot_mcp_readback_failed");
    const tampered = Buffer.from(a.bytes); tampered[tampered.length - 1] ^= 1;
    let tamperRejected = false; try { unpackDriveArchive(tampered); } catch { tamperRejected = true; }
    const normal = { objects: mock.files.map(f => ({ id: f.id, name: f.name, parent: f.parents[0], mimeType: f.mimeType,
      appProperties: f.appProperties, bytes: f.bytes.length, sha256: pilotSha256(f.bytes) })), requests: [...mock.requests], budget: session.status(),
      mcpRead: JSON.parse((read.content as { text: string }[])[0].text), mcpList: JSON.parse((list.content as { text: string }[])[0].text), tamperRejected };
    if (normal.objects.length !== 2 || !tamperRejected || normal.mcpRead.instrument.id !== "US:AAPL" ||
      normal.mcpRead.series.dataOrigin !== "synthetic_fixture" || normal.mcpRead.bars.length !== 2) throw new PriceError("pilot_mcp_readback_failed");
    const uncertainMock = new MockPilotHttp(); uncertainMock.failure = "unknown_after_store"; globalThis.fetch = uncertainMock.fetch;
    const uncertain = new DrivePilotSession(MOCK_PILOT, mockPilotGrant), retryRepo = new GoogleDriveArchives("priceArchive", uncertain);
    let first = "", blockedRetry = "";
    try { await retryRepo.publish(bundle.archive); } catch (e) { first = e instanceof PriceError ? e.code : "unexpected_error"; }
    try { await retryRepo.publish(bundle.archive); } catch (e) { blockedRetry = e instanceof PriceError ? e.code : "unexpected_error"; }
    const reconciled = await uncertain.reconcile("priceArchive"); await retryRepo.publish(bundle.archive);
    const stopped: unknown[] = [];
    for (const failure of ["403", "429"] as const) {
      const m = new MockPilotHttp(); m.failure = failure; globalThis.fetch = m.fetch;
      const guard = new DrivePilotSession(MOCK_PILOT, mockPilotGrant), repo = new GoogleDriveArchives("priceArchive", guard);
      let code = ""; try { await repo.publish(bundle.archive); } catch (e) { code = e instanceof PriceError ? e.code : "unexpected_error"; }
      const before = m.requests.length; try { await repo.publish(bundle.archive); } catch { /* deliberate refusal, no retry */ }
      stopped.push({ failure, code, files: m.files.length, furtherRequests: m.requests.length - before, budget: guard.status() });
    }
    return { status: "MOCK_DRIVE_PILOT_PASS", syntheticOnly: true, actualDriveRequests: 0, actualOAuthRequests: 0,
      actualMarketRequests: 0, apiCostUSD: 0, liveAuthorizationEvidence: "UNSET", normal,
      uncertainRecovery: { first, blockedRetry, reconciled, uploads: uncertainMock.requests.filter(r => r.method === "POST").length, files: uncertainMock.files.length },
      stopped, livePlan: drivePilotPlan(), warning: "MOCK grant/IDs are fixtures, not OAuth/ACL/Owner approval evidence. Live binding and durable single-use/crash journal remain HOLD." };
  } finally {
    try { await client?.close(); } finally { try { await server?.close(); } finally {
      cache?.close(); globalThis.fetch = priorFetch;
      for (const [k, v] of old) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(root, { recursive: true, force: true });
    } }
  }
}

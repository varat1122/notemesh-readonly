import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MOCK_PILOT, MockPilotHttp, type MockPilotFile } from "./drive-pilot-mock.ts";
import { canonicalJSON, gateDigest, signingKeyProof, type GateBinding, type GatePermit, type OwnerAuthority, type SignedGatePermit } from "./drive-pilot-approval.ts";
import { PilotJournal } from "./drive-pilot-journal.ts";
import { PilotOAuthBinding, bootstrapPilotFolder } from "./drive-pilot-bootstrap.ts";
import { executePilotUpload, uploadPermitProposal } from "./drive-pilot-gate.ts";
import { PriceError } from "./model.ts";

const FIXTURE_MARKER = "IOS_PRICES_005_SYNTHETIC_MOCK_ONLY_NOT_OWNER_AUTHORITY";
export type MockFailure = "none" | "scope" | "consent_denied" | "wrong_principal" | "shared" | "wrong_owner" | "unbound" | "preexisting" | "nonempty" | "tamper" | "403" | "429" | "revoked" | "ambiguous" | "missing";
interface World { marker: string; folderCreated: boolean; failure: MockFailure; files: (Omit<MockPilotFile, "bytes"> & { bytes: string })[];
  requests: { method: string; path: string; parent: string; bytes: number; role: string | null; status: number }[]; }
function atomicMockJSON(file: string, data: unknown) {
  const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  const fd = fs.openSync(tmp, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file); const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
/** Persists only an invented fake server world for independent-process tests; never forwards fetch. */
export class MockGateHttp {
  world: World;
  private file: string;
  private base = new MockPilotHttp();
  crashAfter: "none" | "archive" | "catalogue" | "folder" = "none";
  constructor(root: string) {
    this.file = path.join(root, "mock-world.json"); this.world = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (this.world.marker !== FIXTURE_MARKER) throw new PriceError("mock_fixture_marker_missing");
    this.base.files = this.world.files.map(f => ({ ...f, bytes: Buffer.from(f.bytes, "base64") }));
  }
  save() { this.world.files = this.base.files.map(f => ({ ...f, bytes: f.bytes.toString("base64") })); atomicMockJSON(this.file, this.world); }
  fetch: typeof fetch = async (input, init) => {
    const u = new URL(String(input)), method = init?.method ?? "GET";
    if (!["https://www.googleapis.com", "https://oauth2.googleapis.com"].includes(u.origin)) throw new PriceError("mock_external_network_refused");
    const row = { method, path: u.pathname, parent: u.searchParams.get("q") ?? "", bytes: init?.body ? Buffer.byteLength(init.body as Buffer) : 0, role: null as string | null, status: 200 };
    this.world.requests.push(row);
    const failure = this.world.failure;
    let response: Response;
    if (u.origin === "https://oauth2.googleapis.com") {
      if (u.pathname !== "/token" || method !== "POST") throw new PriceError("mock_unexpected_oauth_endpoint");
      const body = new URLSearchParams(init?.body as string);
      if (body.get("client_id") !== MOCK_PILOT.clientId || body.get("redirect_uri") !== "http://127.0.0.1:39005/api/market-prices-drive/callback" || !body.get("code_verifier") || body.get("client_secret") !== "MOCK_ONLY_CLIENT_SECRET") throw new PriceError("mock_wrong_oauth_client_request");
      response = failure === "consent_denied" ? new Response("mock denied", { status: 400 }) : Response.json({ access_token: "MOCK_ONLY_EPHEMERAL_ACCESS", token_type: "Bearer", expires_in: 3600, scope: failure === "scope" ? "https://www.googleapis.com/auth/drive" : MOCK_PILOT.scope });
    } else if (["403", "429", "revoked"].includes(failure)) response = new Response("mock refused", { status: failure === "revoked" ? 401 : Number(failure) });
    else if (u.pathname === "/drive/v3/files/generateIds") response = Response.json({ ids: ["MOCK_RESERVED_ARCHIVE", "MOCK_RESERVED_CATALOGUE"], space: "drive" });
    else if (u.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init?.body));
      if (meta.mimeType !== "application/vnd.google-apps.folder" || canonicalJSON(meta.parents) !== '["root"]' || meta.appProperties.investmentOsPilot !== MOCK_PILOT.pilotId) throw new PriceError("mock_folder_create_refused");
      this.world.folderCreated = true; row.parent = "root"; row.role = "folder"; response = Response.json({ id: MOCK_PILOT.folderId });
    } else if (u.pathname === "/drive/v3/files" && row.parent.includes("'root' in parents")) response = Response.json({ files: this.world.folderCreated || failure === "preexisting" ? [{ id: MOCK_PILOT.folderId }] : [] });
    else {
      if (failure === "wrong_principal") this.base.observedPrincipal = "MOCK_WRONG_OWNER";
      if (failure === "shared") this.base.folderShared = true;
      if (failure === "tamper") this.base.failure = "tamper";
      const before = this.base.requests.length; response = await this.base.fetch(input, init);
      if (this.base.requests.length > before) Object.assign(row, this.base.requests.at(-1));
      if (u.pathname.endsWith(MOCK_PILOT.folderId) && !u.searchParams.has("alt")) {
        if (!this.world.folderCreated) response = new Response("mock missing folder", { status: 404 });
        else { const data = await response.json(); data.appProperties.pilotClientIdSha256 = gateDigest(MOCK_PILOT.clientId);
          if (failure === "wrong_owner") data.owners[0].permissionId = "MOCK_WRONG_OWNER";
          if (failure === "unbound") data.appProperties.pilotClientIdSha256 = "MOCK_WRONG_APP";
          response = Response.json(data); }
      }
      if (u.pathname === "/drive/v3/files" && row.parent.includes(`'${MOCK_PILOT.folderId}' in parents`)) {
        const data = await response.json();
        if (failure === "nonempty" && !row.parent.includes("appProperties")) data.files = [{ id: "MOCK_UNJOURNALED_CHILD" }];
        if (failure === "ambiguous" && row.parent.includes("pilotSha256")) data.files = [{ id: "MOCK_RESERVED_ARCHIVE" }, { id: "MOCK_DUPLICATE" }];
        if (failure === "missing" && row.parent.includes("pilotSha256")) data.files = [];
        response = Response.json(data);
      }
    }
    row.status = response.status; this.save();
    if (method === "POST" && (this.crashAfter === "folder" && row.role === "folder" || this.crashAfter === "archive" && row.role === "priceArchive" || this.crashAfter === "catalogue" && row.role === "priceCatalogue")) process.kill(process.pid, "SIGKILL");
    return response;
  };
}
export function fixtureOAuth(root: string, binding: GateBinding) {
  return new PilotOAuthBinding(binding, async () => "MOCK_ONLY_CLIENT_SECRET", {
    read: async () => { try { return fs.readFileSync(path.join(root, "mock-custody.sealed"), "utf8"); } catch { return null; } },
    write: async (sealed, commit) => commit(() => { const f = path.join(root, "mock-custody.sealed"); fs.writeFileSync(f, sealed, { mode: 0o600 }); const fd = fs.openSync(f, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const dir = fs.openSync(root, "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }),
  });
}
/** Independent fixture signer is confined to mock setup; never a live enrollment/approval API. */
export function createMockGateFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-drive-gate-mock-")), journalDir = path.join(root, "journal"); fs.mkdirSync(journalDir, { mode: 0o700 });
  const key = crypto.generateKeyPairSync("ed25519"), publicKeyPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  const authority: OwnerAuthority = { publicKeyPem, pinnedSpkiSha256: crypto.createHash("sha256").update(key.publicKey.export({ type: "spki", format: "der" })).digest("hex"), enrollmentEvidenceRef: "MOCK_INDEPENDENT_OWNER_ENROLLMENT_ONLY" };
  const binding: GateBinding = { pilotId: MOCK_PILOT.pilotId, journalId: "MOCK_JOURNAL_" + crypto.randomUUID(), candidateTree: "5".repeat(40),
    principalId: MOCK_PILOT.principalId, clientId: MOCK_PILOT.clientId, redirectUri: "http://127.0.0.1:39005/api/market-prices-drive/callback", scope: MOCK_PILOT.scope, signingKeyProof: signingKeyProof(), signingCustodyRef: "MOCK_SIGNING_KEY_CUSTODY_ONLY" };
  const sign = (permit: GatePermit): SignedGatePermit => ({ permit, signature: crypto.sign(null, Buffer.from(canonicalJSON(permit)), key.privateKey).toString("base64url") });
  const bootstrap = sign({ version: 1, phase: "bootstrap", permitId: "MOCK_BOOTSTRAP_PERMIT", binding, notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), ownerEvidenceRef: "MOCK_OWNER_BOOTSTRAP_APPROVAL_ONLY", quotaEvidenceRef: "MOCK_ZERO_COST_QUOTA_ONLY", expectedCostUSD: 0, chargeCeilingUSD: 0,
    folderName: "InvestmentOS-Prices-Pilot-ONLY", parent: "root", maxFolders: 1, maxDriveRequests: 8, maxOAuthTokenCalls: 2 });
  PilotJournal.prepare(journalDir, binding).close();
  atomicMockJSON(path.join(root, "fixture.json"), { marker: FIXTURE_MARKER, authority, binding, bootstrap });
  atomicMockJSON(path.join(root, "mock-world.json"), { marker: FIXTURE_MARKER, folderCreated: false, failure: "none", files: [], requests: [] });
  return { root, journalDir, binding, authority, bootstrap, sign };
}
export async function bootstrapMockFixture(f: ReturnType<typeof createMockGateFixture>) {
  const mock = new MockGateHttp(f.root), prior = globalThis.fetch; globalThis.fetch = mock.fetch;
  try {
    const oauth = fixtureOAuth(f.root, f.binding), consent = oauth.beginConsent(f.bootstrap, f.authority);
    return await bootstrapPilotFolder(PilotJournal.open(f.journalDir), oauth, f.bootstrap, f.authority, { state: consent.state, code: "MOCK_ONLY_CODE" });
  } finally { globalThis.fetch = prior; }
}
export function approveMockUpload(f: ReturnType<typeof createMockGateFixture>, changes: Partial<GatePermit> = {}) {
  const j = PilotJournal.open(f.journalDir);
  try {
    const proposal = uploadPermitProposal(j, { permitId: "MOCK_UPLOAD_PERMIT", notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 110000).toISOString(), ownerEvidenceRef: "MOCK_OWNER_UPLOAD_APPROVAL_ONLY", quotaEvidenceRef: "MOCK_ZERO_COST_QUOTA_ONLY" });
    const approved = f.sign({ ...proposal, ...changes } as GatePermit); atomicMockJSON(path.join(f.root, "upload-permit.json"), approved); return approved;
  } finally { j.close(); }
}
export async function runMockGateWorker(root: string, mode: string) {
  if (fs.realpathSync(root) !== path.resolve(root) || !path.basename(root).startsWith("ios-drive-gate-mock-") || !["start", "recover", "crash-archive", "crash-catalogue", "bootstrap-crash", "bootstrap-recover"].includes(mode)) throw new PriceError("mock_worker_context_refused");
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8")); if (fixture.marker !== FIXTURE_MARKER) throw new PriceError("mock_fixture_marker_missing");
  const mock = new MockGateHttp(root), prior = globalThis.fetch; globalThis.fetch = mock.fetch;
  mock.crashAfter = mode === "crash-archive" ? "archive" : mode === "crash-catalogue" ? "catalogue" : mode === "bootstrap-crash" ? "folder" : "none";
  try {
    const oauth = fixtureOAuth(root, fixture.binding);
    if (mode.startsWith("bootstrap-")) {
      const consent = mode === "bootstrap-crash" ? oauth.beginConsent(fixture.bootstrap, fixture.authority) : undefined;
      return await bootstrapPilotFolder(PilotJournal.open(path.join(root, "journal")), oauth, fixture.bootstrap, fixture.authority,
        consent ? { state: consent.state, code: "MOCK_ONLY_CODE" } : undefined, mode === "bootstrap-recover");
    }
    return await executePilotUpload(PilotJournal.open(path.join(root, "journal")), oauth, JSON.parse(fs.readFileSync(path.join(root, "upload-permit.json"), "utf8")), fixture.authority, mode === "recover");
  }
  finally { globalThis.fetch = prior; }
}
export function invokeMockWorker(root: string, mode: string) {
  const entry = process.argv[1]?.endsWith("price-job.mjs") ? process.argv[1] : fileURLToPath(new URL("../../../scripts/market-prices.ts", import.meta.url));
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? os.tmpdir(), DATA_DIR: path.join(root, "disposable"), ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    MARKET_PRICES_PROFILE: "free-first-mvp-v1", MARKET_PRICES_ENABLED: "1", MARKET_PRICES_REFRESH_ENABLED: "0", MARKET_PRICES_SCHEDULE: "manual", MARKET_PRICES_RIGHTS_REVIEW: "", CLOUD_INTAKE: "0", SAFE_EDIT_ENABLED: "0" };
  try { const out = execFileSync(process.execPath, [entry, "drive-pilot-gate-mock-worker", root, mode], { env, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }); return { status: "RETURNED", payload: JSON.parse(out), signal: null }; }
  catch (e) { const failure = e as { signal?: string; status?: number; stderr?: Buffer | string }; return { status: "STOPPED", payload: null, signal: failure.signal ?? null, exitCode: failure.status ?? null, code: String(failure.stderr ?? "").trim().split("\n").at(-1) ?? "mock_worker_failed" }; }
}
export async function runSingleUseGateDryRun() {
  const old = new Map<string, string | undefined>();
  const set = (k: string, v: string) => { old.set(k, process.env[k]); process.env[k] = v; };
  const fixtures: string[] = [];
  try {
    set("ENCRYPTION_KEY", crypto.randomBytes(32).toString("hex")); set("MARKET_PRICES_PROFILE", "free-first-mvp-v1"); set("MARKET_PRICES_RIGHTS_REVIEW", "");
    const results = [];
    for (const mode of ["start", "crash-archive", "crash-catalogue"]) {
      const f = createMockGateFixture(); fixtures.push(f.root); const bootstrap = await bootstrapMockFixture(f); approveMockUpload(f);
      const first = invokeMockWorker(f.root, mode), result = mode === "start" ? first : invokeMockWorker(f.root, "recover");
      const mock = new MockGateHttp(f.root), j = PilotJournal.open(f.journalDir);
      try {
        if (result.payload?.status !== "DONE" || j.read().stage !== "DONE" || mock.world.files.length !== 2 || mode !== "start" && first.signal !== "SIGKILL") throw new PriceError("pilot_mock_cross_process_proof_failed");
        results.push({ scenario: mode, firstExit: { status: first.status, signal: first.signal }, bootstrap, result: result.payload,
          mockRequests: mock.world.requests, files: mock.world.files.map(f => ({ id: f.id, parent: f.parents[0], bytes: Buffer.from(f.bytes, "base64").length, appProperties: f.appProperties })), duplicateInvocation: invokeMockWorker(f.root, "start") });
      } finally { j.close(); }
    }
    return { status: "SINGLE_USE_GATE_MOCK_PASS", syntheticOnly: true, actualNetworkRequests: 0, actualDriveRequests: 0, actualOAuthRequests: 0, actualMarketRequests: 0, apiCostUSD: 0,
      ownerApprovedLive: "UNSET", authority: "INDEPENDENT_FIXTURE_KEY_ONLY_NOT_OWNER_APPROVAL", results };
  } finally { for (const [k, v] of old) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } for (const root of fixtures) fs.rmSync(root, { recursive: true, force: true }); }
}

import crypto from "node:crypto";
import http from "node:http";
import { z } from "zod";
import { DRIVE_SCOPE, driveKey } from "./drive-auth.ts";
import { googleBytes } from "./drive-http.ts";
import { gateBindingSchema, gateDigest, gateId, verifyGatePermit, type GateBinding, type OwnerAuthority } from "./drive-pilot-approval.ts";
import { pilotFolderEvidence, type PilotGrant } from "./drive-pilot.ts";
import { PilotJournal, type PilotLease } from "./drive-pilot-journal.ts";
import { PilotOperation } from "./drive-pilot-operation.ts";
import { PriceError } from "./model.ts";

/** A trusted pilot adapter may prepare asynchronously, but its storage mutation must
 * be synchronous inside commit. A timed-out Promise alone cannot revoke a late write. */
export interface PilotTokenCustody { read(): Promise<string | null>; write(sealed: string, commit: (effect: () => void) => void): Promise<void>; }
/** Pure callback validation, also used by the short-lived loopback receiver. Never logs a callback URL. */
export function pilotConsentCallback(binding: GateBinding, expectedState: string, rawUrl: string) {
  const u = new URL(rawUrl), target = new URL(binding.redirectUri);
  if (u.origin !== target.origin || u.pathname !== target.pathname || u.hash || u.searchParams.getAll("state").length !== 1 ||
    u.searchParams.get("state") !== expectedState || u.searchParams.has("error") || u.searchParams.getAll("code").length !== 1 ||
    !u.searchParams.get("code") || u.searchParams.get("code")!.length > 4000) throw new PriceError("pilot_callback_denied_or_mismatched");
  return { state: expectedState, code: u.searchParams.get("code")! };
}
const tokenSchema = z.object({ access_token: z.string().min(10).max(8000), scope: z.literal(DRIVE_SCOPE), token_type: z.literal("Bearer"), expires_in: z.number().int().min(180).max(86400) });
const storedSchema = z.object({ bindingDigest: z.string(), token: z.string().min(10).max(8000), expiresAt: z.number().int().positive(),
  receipt: z.object({ clientId: z.string(), redirectUri: z.string(), scope: z.literal(DRIVE_SCOPE), principalId: z.string(), exchange: z.literal("client-authenticated-PKCE-code-exchange") }) }).strict();
type StoredGrant = z.infer<typeof storedSchema>;
/** Pilot-only code exchange. No legacy login/env/default credentials, introspection, refresh or real CLI. */
export class PilotOAuthBinding {
  readonly binding: GateBinding;
  private custody: PilotTokenCustody;
  private secret: () => Promise<string>;
  private pending: { state: string; verifier: string; expires: number; permitDigest: string } | null = null;
  private access: StoredGrant | null = null;
  constructor(binding: GateBinding, secret: () => Promise<string>, custody: PilotTokenCustody) { this.binding = gateBindingSchema.parse(binding); this.secret = secret; this.custody = custody; }
  beginConsent(envelope: unknown, authority: OwnerAuthority) {
    const approved = verifyGatePermit(envelope, authority, this.binding, "bootstrap");
    const state = crypto.randomBytes(32).toString("base64url"), verifier = crypto.randomBytes(32).toString("base64url");
    this.pending = { state, verifier, expires: Math.min(Date.now() + 300000, Date.parse(approved.permit.expiresAt)), permitDigest: gateDigest(approved.permit) };
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: this.binding.clientId, redirect_uri: this.binding.redirectUri, response_type: "code", scope: DRIVE_SCOPE,
      state, code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return { url: url.toString(), state };
  }
  async finishConsent(state: string, code: string, journal: PilotJournal, operation: PilotOperation) {
    operation.check();
    const pending = this.pending; this.pending = null;
    if (!pending || pending.state !== state || pending.expires <= Date.now() || !code || code.length > 4000 ||
      journal.read().stage !== "BOOTSTRAP_APPROVED" || journal.read().bootstrapPermitDigest !== pending.permitDigest || gateDigest(journal.read().binding) !== gateDigest(this.binding)) throw new PriceError("pilot_consent_state_or_binding_refused");
    const consentOperation = new PilotOperation(journal, operation.lease, Math.min(operation.deadlineAt, pending.expires));
    try {
      consentOperation.update(r => { if (r.bootstrapBudget.oauthTokenCalls >= 2) throw new PriceError("pilot_oauth_budget_exhausted"); r.bootstrapBudget.oauthTokenCalls++; });
      const secret = await consentOperation.run(() => this.secret()); if (secret.length < 10 || secret.length > 500) throw new PriceError("pilot_client_secret_unavailable");
      const b = await consentOperation.run(signal => googleBytes("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal,
        body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: pending.verifier, client_id: this.binding.clientId, client_secret: secret, redirect_uri: this.binding.redirectUri }).toString() }), undefined, 15000);
      let token: z.infer<typeof tokenSchema>;
      try { token = tokenSchema.parse(JSON.parse(b.toString("utf8"))); } catch { throw new PriceError("pilot_actual_grant_scope_or_token_refused"); }
      const access: StoredGrant = { bindingDigest: gateDigest(this.binding), token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000,
        receipt: { clientId: this.binding.clientId, redirectUri: this.binding.redirectUri, scope: token.scope, principalId: this.binding.principalId, exchange: "client-authenticated-PKCE-code-exchange" } };
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", driveKey("pilot-token-custody-v1"), iv);
      cipher.setAAD(Buffer.from(gateDigest(this.binding)));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(access)), cipher.final()]);
      const admission = consentOperation.custodyCommit();
      try {
        await consentOperation.run(() => this.custody.write([iv, ciphertext, cipher.getAuthTag()].map(b => b.toString("base64url")).join("."), admission.commit));
        admission.finish(); operation.check(); this.access = access; return this.receipt();
      } finally { admission.close(); }
    } finally { consentOperation.close(); }
  }
  async restore(operation?: PilotOperation) {
    operation?.check(); let access = this.access;
    if (!access) try {
      const sealed = operation ? await operation.run(() => this.custody.read()) : await this.custody.read(); if (!sealed || sealed.length > 16000) throw Error();
      const parts = sealed.split("."); if (parts.length !== 3) throw Error();
      const [iv, ciphertext, tag] = parts.map(s => Buffer.from(s, "base64url")); if (iv.length !== 12 || tag.length !== 16) throw Error();
      const decipher = crypto.createDecipheriv("aes-256-gcm", driveKey("pilot-token-custody-v1"), iv);
      decipher.setAAD(Buffer.from(gateDigest(this.binding))); decipher.setAuthTag(tag);
      access = storedSchema.parse(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")));
    } catch { operation?.check(); throw new PriceError("pilot_custody_missing_invalid_or_unbound"); }
    if (access.bindingDigest !== gateDigest(this.binding) || access.expiresAt <= Date.now() + 15000 || gateDigest(access.receipt) !== gateDigest({ clientId: this.binding.clientId, redirectUri: this.binding.redirectUri, scope: DRIVE_SCOPE, principalId: this.binding.principalId, exchange: "client-authenticated-PKCE-code-exchange" })) throw new PriceError("pilot_grant_expired_revoked_or_unbound");
    operation?.check(); this.access = access; return access;
  }
  async grant(operation?: PilotOperation): Promise<PilotGrant> { const a = await this.restore(operation); operation?.check(); return { clientId: this.binding.clientId, principalId: this.binding.principalId, scope: DRIVE_SCOPE, accessToken: a.token }; }
  async validThrough(deadline: number, operation?: PilotOperation) { if ((await this.restore(operation)).expiresAt < deadline + 15000) throw new PriceError("pilot_grant_expires_before_window"); operation?.check(); }
  receipt() { return this.access ? { ...this.access.receipt, expiresAt: this.access.expiresAt, actualScopeObservedAtExchange: true } : null; }
}

/** Future explicitly approved one-shot operator only. No app route, auto-browser or default listener. */
export async function receivePilotConsentLocally(oauth: PilotOAuthBinding, envelope: unknown, authority: OwnerAuthority, showAuthorizationUrl: (url: string) => void, signal?: AbortSignal) {
  const approved = verifyGatePermit(envelope, authority, oauth.binding, "bootstrap"), redirect = new URL(oauth.binding.redirectUri);
  if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || Number(redirect.port) < 1024) throw new PriceError("pilot_local_callback_configuration_required");
  const consent = oauth.beginConsent(approved, authority);
  const deadline = Math.min(Date.now() + 300000, Date.parse(approved.permit.expiresAt));
  if (signal?.aborted) throw new PriceError("pilot_local_consent_cancelled_expired_or_invalid");
  return await new Promise<{ state: string; code: string }>((resolve, reject) => {
    let count = 0, settled = false;
    const finish = (result?: { state: string; code: string }) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel); server.close();
      if (result && !signal?.aborted && Date.now() < deadline) resolve(result); else reject(new PriceError("pilot_local_consent_cancelled_expired_or_invalid"));
    };
    const server = http.createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("Content-Security-Policy", "default-src 'none'");
      if (++count > 4 || request.method !== "GET" || request.headers.host !== redirect.host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "") || (request.url?.length ?? 0) > 8192) { response.writeHead(400).end("Pilot callback refused"); finish(); return; }
      if (new URL(request.url ?? "/", redirect.origin).pathname !== redirect.pathname) { response.writeHead(404).end(); return; }
      try { const result = pilotConsentCallback(oauth.binding, consent.state, new URL(request.url!, redirect.origin).toString()); response.writeHead(200, { "Content-Type": "text/plain" }).end("Pilot callback received. Return to the local operator."); finish(result); }
      catch { response.writeHead(400).end("Pilot callback refused"); finish(); }
    });
    const timer = setTimeout(() => finish(), Math.max(1, deadline - Date.now()));
    const cancel = () => finish(); signal?.addEventListener("abort", cancel, { once: true });
    server.on("error", () => finish());
    server.listen(Number(redirect.port), "127.0.0.1", () => { if (settled || signal?.aborted || Date.now() >= deadline) { finish(); return; } try { showAuthorizationUrl(consent.url); } catch { finish(); } });
  });
}

const folderFields = "id,name,mimeType,parents,trashed,shared,ownedByMe,owners(permissionId),permissions(id,type,role),capabilities(canAddChildren),appProperties";
export async function bootstrapPilotFolder(journal: PilotJournal, oauth: PilotOAuthBinding, envelope: unknown, authority: OwnerAuthority, consent?: { state: string; code: string } | ((signal: AbortSignal) => Promise<{ state: string; code: string }>), recover = false) {
  let consumed = false, lease: PilotLease | undefined, operation: PilotOperation | undefined;
  try {
    const binding = journal.read().binding, approved = verifyGatePermit(envelope, authority, binding, "bootstrap");
    if (gateDigest(binding) !== gateDigest(oauth.binding)) throw new PriceError("pilot_oauth_binding_mismatch");
    lease = journal.acquire(); journal.consume(approved, recover, lease); consumed = true;
    const op = operation = new PilotOperation(journal, lease, Date.parse(approved.permit.expiresAt));
    if (recover) await op.run(() => oauth.restore(op));
    else { if (!consent) throw new PriceError("pilot_consent_missing"); const result = typeof consent === "function" ? await op.run(consent) : consent; await op.run(() => oauth.finishConsent(result.state, result.code, journal, op)); }
    const headers = { Authorization: `Bearer ${(await op.run(() => oauth.grant(op))).accessToken}` };
    const call = async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      if (u.origin !== "https://www.googleapis.com" || !/^\/drive\/v3\/(about|files(?:\/[A-Za-z0-9_-]{3,200})?)$/.test(u.pathname) || !["GET", "POST"].includes(init.method ?? "GET") ||
        (init.method === "POST" && u.pathname !== "/drive/v3/files")) throw new PriceError("pilot_bootstrap_target_refused");
      op.check(init.signal);
      op.update(r => { if (r.bootstrapBudget.driveRequests >= 8) throw new PriceError("pilot_bootstrap_budget_exhausted"); r.bootstrapBudget.driveRequests++; });
      const b = await op.run(signal => googleBytes(url, { ...init, headers: { ...headers, ...init.headers }, signal }), init.signal, 15000);
      try { return JSON.parse(b.toString("utf8")); } catch { throw new PriceError("pilot_bootstrap_invalid_json"); }
    };
    const about = await call("https://www.googleapis.com/drive/v3/about?fields=user(permissionId)");
    if (about.user?.permissionId !== binding.principalId) throw new PriceError("pilot_observed_principal_mismatch");
    const marker = { investmentOsPilot: binding.pilotId, pilotClientIdSha256: gateDigest(binding.clientId) };
    const q = `trashed=false and 'root' in parents and mimeType='application/vnd.google-apps.folder' and appProperties has { key='investmentOsPilot' and value='${binding.pilotId}' }`;
    const listed = z.object({ files: z.array(z.object({ id: gateId })).max(2), nextPageToken: z.string().optional() }).parse(await call("https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id),nextPageToken", pageSize: "2", spaces: "drive" })));
    if (listed.nextPageToken || listed.files.length > 1) throw new PriceError("pilot_bootstrap_folder_ambiguous_hold");
    let folderId = journal.read().folderId;
    if (journal.read().folderAttempted) {
      if (!recover || listed.files.length !== 1 || folderId && folderId !== listed.files[0].id) throw new PriceError("pilot_bootstrap_uncertain_folder_hold");
      folderId = listed.files[0].id;
    } else {
      if (listed.files.length || recover) throw new PriceError("pilot_preexisting_or_unbound_folder_refused");
      op.update(r => { if (r.bootstrapBudget.folderCreates >= 1) throw new PriceError("pilot_folder_create_budget_exhausted"); r.folderAttempted = true; r.bootstrapBudget.folderCreates++; });
      const result = z.object({ id: gateId }).parse(await call("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "InvestmentOS-Prices-Pilot-ONLY", mimeType: "application/vnd.google-apps.folder", parents: ["root"], appProperties: marker }) }));
      folderId = result.id;
    }
    op.update(r => { r.folderId = folderId; });
    const folder = await call(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=${encodeURIComponent(folderFields)}`);
    if (folder.id !== folderId || folder.mimeType !== "application/vnd.google-apps.folder" || folder.name !== "InvestmentOS-Prices-Pilot-ONLY" ||
      folder.trashed !== false || folder.shared !== false || folder.ownedByMe !== true || folder.driveId || folder.owners?.length !== 1 || folder.owners[0].permissionId !== binding.principalId ||
      folder.permissions?.length !== 1 || folder.permissions[0].id !== binding.principalId || folder.permissions[0].role !== "owner" || folder.permissions[0].type !== "user" || !folder.capabilities?.canAddChildren || gateDigest(folder.appProperties) !== gateDigest(marker)) throw new PriceError("pilot_bootstrap_private_app_folder_refused");
    const children = await call("https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q: `trashed=false and '${folderId}' in parents`, fields: "files(id),nextPageToken", pageSize: "1", spaces: "drive" }));
    if (!Array.isArray(children.files) || children.files.length || children.nextPageToken) throw new PriceError("pilot_bootstrap_nonempty_folder_refused");
    let ids = journal.read().allocatedIds;
    if (!ids) {
      const generated = z.object({ ids: z.array(gateId).length(2), space: z.literal("drive").optional() }).parse(await call("https://www.googleapis.com/drive/v3/files/generateIds?count=2&space=drive&type=files"));
      if (new Set([...generated.ids, folderId]).size !== 3) throw new PriceError("pilot_allocated_ids_refused");
      ids = { archive: generated.ids[0], catalogue: generated.ids[1] };
    }
    const evidence = pilotFolderEvidence(folder, binding);
    const ownerOnlyAcl = { ownerPermissionIds: folder.owners.map((o: { permissionId: string }) => o.permissionId),
      permissions: folder.permissions, shared: folder.shared, ownedByMe: folder.ownedByMe, clientMarker: folder.appProperties.pilotClientIdSha256 };
    op.update(r => { r.folderEvidenceSha256 = evidence; r.allocatedIds = ids; r.readback = { bootstrapOwnerOnlyAcl: ownerOnlyAcl }; r.stage = "READY"; });
    op.check();
    return { status: "READY_FOR_SEPARATE_UPLOAD_APPROVAL", folderId, folderEvidenceSha256: evidence, ownerOnlyAcl, allocatedIds: ids, oauth: oauth.receipt(), budget: journal.read().bootstrapBudget };
  } catch (e) {
    const code = e instanceof PriceError ? e.code : "pilot_bootstrap_validation_failed";
    if (consumed && journal.owns(lease) && (code !== "drive_request_failed" || !journal.read().folderAttempted)) journal.hold(code, lease);
    throw new PriceError(code);
  } finally { operation?.close(); journal.close(lease); }
}

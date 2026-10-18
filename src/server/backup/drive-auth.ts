/**
 * Dedicated Google Drive OAuth handshake for encrypted NoteMesh DR ONLY.
 * Neither this module nor the setup routes schedules backups or grants
 * existing Drive folders to drive.file. Feature-off unless explicitly enabled.
 */
import crypto from "node:crypto";
import { env } from "../env.ts";

export const DR_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DR_DRIVE_CALLBACK_PATH = "/api/backup-drive/callback";
const PURPOSE = "investment-os-notemesh-dr/oauth-v1";

export function driveSetupEnabled(): boolean {
  return process.env.NOTEMESH_DRIVE_SETUP_ENABLED === "1";
}
export function driveSetupClient() {
  const id = process.env.NOTEMESH_DRIVE_CLIENT_ID ?? "";
  const secret = process.env.NOTEMESH_DRIVE_CLIENT_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id) ||
      secret.length < 10 || secret.length > 500) throw Error("dr_oauth_client_not_configured");
  if (!env.baseUrl.startsWith("https://") &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.baseUrl)) throw Error("dr_oauth_https_required");
  return { id, secret, redirectUri: env.baseUrl + DR_DRIVE_CALLBACK_PATH };
}
function envelopeKey(): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", env.encryptionKey, "investment-os-notemesh-dr", PURPOSE, 32));
}
export function sealDrRefreshToken(refreshToken: string): string {
  const client = driveSetupClient();
  if (refreshToken.length < 10 || refreshToken.length > 4000) throw Error("dr_refresh_token_invalid");
  const data = JSON.stringify({ version: 1, clientId: client.id, scope: DR_DRIVE_SCOPE, refreshToken });
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", envelopeKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  return [nonce, encrypted, cipher.getAuthTag()].map(b => b.toString("base64url")).join(".");
}
export function openDrCredential(sealed: string): { clientId: string; refreshToken: string; scope: string } {
  try {
    if (!sealed || sealed.length > 10000) throw Error();
    const chunks = sealed.split(".");
    if (chunks.length !== 3 || chunks.some(x => !x)) throw Error();
    const [nonce, encrypted, tag] = chunks.map(x => Buffer.from(x, "base64url"));
    if (nonce.length !== 12 || tag.length !== 16) throw Error();
    const decipher = crypto.createDecipheriv("aes-256-gcm", envelopeKey(), nonce);
    decipher.setAuthTag(tag);
    const d = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
    if (d.version !== 1 || d.scope !== DR_DRIVE_SCOPE || d.clientId !== driveSetupClient().id ||
        typeof d.refreshToken !== "string" || d.refreshToken.length < 10 || d.refreshToken.length > 4000)
      throw Error();
    return { clientId: d.clientId, refreshToken: d.refreshToken, scope: d.scope };
  } catch { throw Error("dr_oauth_credential_invalid_or_missing"); }
}

const pending = new Map<string, { userId: string; verifier: string; until: number }>();
export function beginDrDriveConsent(userId: string): string {
  if (!driveSetupEnabled()) throw Error("dr_drive_setup_disabled");
  const client = driveSetupClient();
  for (const [id, value] of pending) if (value.until <= Date.now()) pending.delete(id);
  if (pending.size >= 20) throw Error("dr_consent_busy");
  const state = crypto.randomBytes(32).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  pending.set(state, { userId, verifier, until: Date.now() + 5 * 60_000 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: client.id, redirect_uri: client.redirectUri, response_type: "code",
    scope: DR_DRIVE_SCOPE, access_type: "offline", prompt: "consent",
    state, code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
export async function finishDrDriveConsent(userId: string, state: string, code: string): Promise<string> {
  if (!driveSetupEnabled()) throw Error("dr_drive_setup_disabled");
  const value = pending.get(state);
  if (!value || value.userId !== userId || value.until <= Date.now()) throw Error("dr_oauth_state_refused");
  pending.delete(state); // No retries after attempted exchange.
  if (!code || code.length > 4000) throw Error("dr_oauth_code_invalid");
  const client = driveSetupClient();
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: client.id, client_secret: client.secret,
    code, redirect_uri: client.redirectUri, code_verifier: value.verifier,
  });
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body, redirect: "error", signal: AbortSignal.timeout(25_000),
    });
  } catch {
    console.warn("[dr-oauth] token_exchange_network_error");
    throw Error("dr_oauth_token_exchange_failed");
  }
  if (!response.ok) {
    // Only HTTP status is safe for observability: never log Google response
    // JSON, the authorization code, client secret or bearer credentials.
    console.warn("[dr-oauth] token_exchange_http_failure", { status: response.status });
    await response.body?.cancel();
    throw Error("dr_oauth_token_exchange_failed");
  }
  // Never echo Google's response/error JSON (could contain bearer credentials).
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 32_768) throw Error("dr_oauth_token_response_too_large");
  let token: Record<string, unknown>;
  try { token = JSON.parse(Buffer.from(buffer).toString("utf8")); }
  catch { throw Error("dr_oauth_token_invalid"); }
  if (token.token_type !== "Bearer" || typeof token.refresh_token !== "string" ||
      token.refresh_token.length < 10 || token.refresh_token.length > 4000 ||
      (token.scope !== undefined && token.scope !== DR_DRIVE_SCOPE)) throw Error("dr_oauth_offline_scope_required");
  return sealDrRefreshToken(token.refresh_token);
}

import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../env.ts";
import { PriceError } from "./model.ts";
import { googleJson } from "./drive-http.ts";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_CALLBACK_PATH = "/api/market-prices-drive/callback";
export function driveKey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", env.encryptionKey, "investment-os-market-prices", purpose, 32));
}
export function driveClient() {
  const id = process.env.MARKET_PRICES_DRIVE_CLIENT_ID ?? "", secret = process.env.MARKET_PRICES_DRIVE_CLIENT_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id) || secret.length < 10 || secret.length > 500) {
    throw new PriceError("drive_oauth_client_not_configured");
  }
  if (!env.baseUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.baseUrl)) {
    throw new PriceError("drive_https_required");
  }
  return { id, secret, callback: env.baseUrl + DRIVE_CALLBACK_PATH };
}
const credentialSchema = z.object({ version: z.literal(1), clientId: z.string().max(250),
  refreshToken: z.string().min(10).max(4000), scope: z.literal(DRIVE_SCOPE) }).strict();
export function sealDriveCredential(refreshToken: string): string {
  const data = credentialSchema.parse({ version: 1, clientId: driveClient().id, refreshToken, scope: DRIVE_SCOPE });
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", driveKey("oauth-credential-v1"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return [iv, ciphertext, cipher.getAuthTag()].map(b => b.toString("base64url")).join(".");
}
function credential(): z.infer<typeof credentialSchema> {
  try {
    const raw = process.env.MARKET_PRICES_DRIVE_CREDENTIAL ?? "";
    if (!raw || raw.length > 10000) throw Error();
    const parts = raw.split("."); if (parts.length !== 3) throw Error();
    const [iv, ciphertext, tag] = parts.map(p => Buffer.from(p, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw Error();
    const decipher = crypto.createDecipheriv("aes-256-gcm", driveKey("oauth-credential-v1"), iv);
    decipher.setAuthTag(tag);
    const value = credentialSchema.parse(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")));
    if (value.clientId !== driveClient().id) throw Error();
    return value;
  } catch { throw new PriceError("drive_credential_missing_or_invalid"); }
}
const tokenSchema = z.object({ access_token: z.string().min(10).max(8000), expires_in: z.number().int().min(60).max(86400),
  token_type: z.literal("Bearer"), refresh_token: z.string().min(10).max(4000).optional(), scope: z.string().optional() });
async function tokenRequest(body: URLSearchParams) {
  const client = driveClient(); body.set("client_id", client.id); body.set("client_secret", client.secret);
  const token = tokenSchema.safeParse(await googleJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  }));
  if (!token.success || (token.data.scope && token.data.scope !== DRIVE_SCOPE)) throw new PriceError("drive_oauth_scope_refused");
  return token.data;
}
let access: { token: string; until: number; credential: string } | undefined;
export async function driveAccessToken(): Promise<string> {
  const raw = process.env.MARKET_PRICES_DRIVE_CREDENTIAL ?? "";
  if (access && access.until > Date.now() && access.credential === raw) return access.token;
  const data = credential();
  const token = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.refreshToken }));
  // Refresh-token rotation must be persisted by reauthorization; never silently discard a replacement.
  if (token.refresh_token && token.refresh_token !== data.refreshToken) throw new PriceError("drive_reauthorization_required");
  access = { token: token.access_token, until: Date.now() + (token.expires_in - 60) * 1000, credential: raw };
  return access.token;
}
const pending = new Map<string, { userId: string; verifier: string; expires: number }>();
export function beginDriveConsent(userId: string): string {
  const client = driveClient();
  for (const [key, value] of pending) if (value.expires <= Date.now()) pending.delete(key);
  if (pending.size >= 20) throw new PriceError("drive_consent_busy");
  const state = crypto.randomBytes(32).toString("hex"), verifier = crypto.randomBytes(32).toString("base64url");
  pending.set(state, { userId, verifier, expires: Date.now() + 5 * 60 * 1000 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: client.id, redirect_uri: client.callback, response_type: "code",
    scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent", state,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return url.toString();
}
export async function finishDriveConsent(userId: string, state: string, code: string): Promise<string> {
  const item = pending.get(state);
  if (!item || item.userId !== userId || item.expires <= Date.now()) throw new PriceError("drive_invalid_oauth_state");
  pending.delete(state); // Single use, even when the token request fails.
  if (!code || code.length > 4000) throw new PriceError("drive_oauth_code_missing");
  const token = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: item.verifier,
    redirect_uri: driveClient().callback }));
  if (!token.refresh_token) throw new PriceError("drive_offline_consent_required");
  return sealDriveCredential(token.refresh_token);
}

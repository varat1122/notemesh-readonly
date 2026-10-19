/** Admin-initiated, STAGING-ONLY DR refresh credential smoke test.
 * Never exposes OAuth credentials, calls Drive, or enables uploads.
 */
import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { inProcessDrWriterFence } from "~/server/backup/writer-fence";
import { env } from "~/server/env";
import { drConsentRequestOriginAllowed, validDrConsentFormProof } from "~/server/backup/drive-consent-form";
import { driveSetupClient, driveSetupEnabled, openDrCredential, DR_DRIVE_SCOPE } from "~/server/backup/drive-auth";
import { drDriveHeaders as headers } from "~/server/backup/drive-admin";

const endpoint = "https://oauth2.googleapis.com/token";
const safe = (message: string, status: number) => new Response(message, { status, headers });
export async function POST({ request }: APIEvent) {
  // Never run the smoke test in production, regardless of other flags.
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging" || !driveSetupEnabled())
    return safe("DR credential check is restricted to an approved Staging environment.", 403);
  await runAuthMigrations();
  const admin = await inProcessDrWriterFence.withWrite(() => auth.api.getSession({ headers: request.headers }), "better_auth_adapter");
  if (!admin) return safe("Admin session required.", 401);
  if (!drConsentRequestOriginAllowed(request.headers, env.baseUrl))
    return safe("Forbidden request origin.", 403);
  // Require a session-bound proof even when Chrome sends a valid Origin.
  let proof: FormDataEntryValue | null;
  try {
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded" ||
        Number(request.headers.get("content-length") ?? 0) > 4096) throw Error();
    proof = (await request.formData()).get("dr_consent_proof");
  } catch { return safe("Invalid test form; reload the setup page.", 403); }
  if (typeof proof !== "string" ||
      !validDrConsentFormProof(proof, admin.session?.id ?? admin.user.id, env.encryptionKey))
    return safe("Expired test form; reload the setup page.", 403);

  let refreshToken: string, id: string, secret: string;
  try {
    const client = driveSetupClient();
    const sealed = process.env.NOTEMESH_DRIVE_CREDENTIAL ?? "";
    const opened = openDrCredential(sealed);
    refreshToken = opened.refreshToken;
    id = client.id;
    secret = client.secret;
  } catch {
    return safe("Encrypted DR Credential did not decrypt or match this OAuth client. No Drive operation was attempted. (dr_credential_invalid)", 400);
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id, client_secret: secret, refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return safe("Google token refresh request could not be completed. No Drive operation was attempted. (dr_refresh_network_error)", 502);
  }
  if (!response.ok) {
    const status = response.status; // Never read, log or echo Google's response body.
    await response.body?.cancel();
    return safe(`Google rejected DR token refresh (HTTP ${status}). No Drive operation was attempted. (dr_refresh_denied)`, 502);
  }
  let result: Record<string, unknown>;
  try {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 32768) throw Error();
    result = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch { return safe("Invalid Google token response. No Drive operation was attempted. (dr_refresh_invalid)", 502); }
  if (result.token_type !== "Bearer" || typeof result.access_token !== "string" ||
      !result.access_token || (result.scope !== undefined && result.scope !== DR_DRIVE_SCOPE))
    return safe("Google refresh token response is missing the required least-privilege grant. (dr_refresh_scope_invalid)", 502);
  return safe("PASS: Encrypted DR Credential decrypted and Google accepted the refresh token. No Google Drive files were accessed, uploaded or changed; backup is not activated.", 200);
}

import type { APIEvent } from "@solidjs/start/server";
import { inProcessDrWriterFence } from "~/server/backup/writer-fence";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { driveSetupEnabled, finishDrDriveConsent } from "~/server/backup/drive-auth";
import { drDriveHeaders as headers, prepareDrCredential } from "~/server/backup/drive-admin";

export async function GET({ request }: APIEvent) {
  await runAuthMigrations();
  const admin = await inProcessDrWriterFence.withWrite(() => auth.api.getSession({ headers: request.headers }), "better_auth_adapter");
  if (!admin) return new Response("Admin session required; reconnect from signed-in dashboard.", { status: 401, headers });
  if (!driveSetupEnabled()) return new Response("DR OAuth disabled", { status: 403, headers });
  const url = new URL(request.url);
  // Google returns ?error=... instead of a code when the user declines
  // consent or its own policy blocks the request. Never echo query parameters.
  if (url.searchParams.has("error")) {
    console.warn("[dr-oauth] callback_denied_or_cancelled");
    return new Response("Google did not grant authorization. Confirm the test user and requested Drive permission; then reconnect. No backup was activated.", { status: 400, headers });
  }
  try {
    const sealed = await finishDrDriveConsent(
      admin.user.id, url.searchParams.get("state") ?? "", url.searchParams.get("code") ?? ""
    );
    const id = prepareDrCredential(admin.user.id, sealed);
    // Strip Google authorization code from the visible URL before displaying
    // the one-use encrypted credential. Do not store raw tokens in Vault or DB.
    return new Response(null, { status: 303, headers: {
      ...headers, Location: `${env.baseUrl}/api/backup-drive?prepared=${id}`
    } });
  } catch (cause) {
    const allowed = new Set([
      "dr_oauth_state_refused", "dr_oauth_code_invalid",
      "dr_oauth_token_exchange_failed", "dr_oauth_offline_scope_required",
      "dr_oauth_token_invalid", "dr_oauth_token_response_too_large",
      "dr_handoff_busy", "dr_refresh_token_invalid",
    ]);
    const raw = cause instanceof Error ? cause.message : "";
    const reason = allowed.has(raw) ? raw : "dr_oauth_callback_failed";
    // Strictly whitelisted category only. No state, query params, codes, or tokens.
    console.warn("[dr-oauth] callback_failed", { reason });
    const messages: Record<string, string> = {
      dr_oauth_state_refused: "OAuth session expired or was not recognized. Open the DR setup page again and use its new direct Google link.",
      dr_oauth_code_invalid: "Google returned no usable authorization code. Start a new Google connection from the DR setup page.",
      dr_oauth_token_exchange_failed: "Google token exchange failed. Check the dedicated OAuth client, its redirect URI and test-user access.",
      dr_oauth_offline_scope_required: "Google did not return the required offline Drive permission. Revoke the test app consent and reconnect.",
    };
    return new Response(`${messages[reason] ?? "DR OAuth could not finish. Try one new connection."} (Diagnostic: ${reason}). No backup was activated.`, { status: 400, headers });
  }
}

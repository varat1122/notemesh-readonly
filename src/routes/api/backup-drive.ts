import type { APIEvent } from "@solidjs/start/server";
import { inProcessDrWriterFence } from "~/server/backup/writer-fence";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { issueDrConsentFormProof, validDrConsentFormProof, drConsentRequestOriginAllowed } from "~/server/backup/drive-consent-form";
import { beginDrDriveConsent, driveSetupClient, driveSetupEnabled, DR_DRIVE_CALLBACK_PATH } from "~/server/backup/drive-auth";
import { claimDrCredential, drDriveHeaders as headers, escapeHtml as esc } from "~/server/backup/drive-admin";

async function adminSession(request: Request) {
  await runAuthMigrations();
  return inProcessDrWriterFence.withWrite(() => auth.api.getSession({ headers: request.headers }), "better_auth_adapter");
}
export async function GET({ request }: APIEvent) {
  const admin = await adminSession(request);
  if (!admin) return new Response("Sign in to your NoteMesh admin dashboard first.", { status: 401, headers });
  const requestUrl = new URL(request.url);
  let sealed = "";
  if (requestUrl.searchParams.has("prepared")) {
    try { sealed = claimDrCredential(admin.user.id, requestUrl.searchParams.get("prepared") ?? ""); }
    catch { return new Response("One-use credential expired or viewed already. Reconnect.", { status: 400, headers }); }
  }
  let configured = false;
  try { driveSetupClient(); configured = true; } catch { /* Do not reveal secrets. */ }
  // HTML form-action CSP can block a form POST redirect to accounts.google.com.
  // A normal direct link is a user-initiated navigation, not a form redirect.
  // Issue a short-lived state only for this authenticated setup page.
  let directConsentUrl = "";
  if (driveSetupEnabled() && configured && !sealed) {
    try { directConsentUrl = beginDrDriveConsent(admin.user.id); }
    catch { /* Bounded pending states: never loosen rate limits to build a link. */ }
  }
  const page = `<!doctype html><html lang="en"><meta charset="utf-8">
  <title>Investment OS — DR Drive setup</title><body><main>
  <h1>Investment OS — Disaster Recovery Google Drive</h1>
  <p>Dedicated drive.file connection for <strong>encrypted backup bundles only</strong>.
  This is NOT the market-price Drive backend and it will not activate uploads,
  scheduling, retention, restore or production snapshotting.</p>
  <p>OAuth setup enabled: ${driveSetupEnabled()}. Dedicated OAuth client configured: ${configured}.
  Stored sealed credential present: ${!!process.env.NOTEMESH_DRIVE_CREDENTIAL}.</p>
  <p>Exact Authorized redirect URI to register in Google Cloud:</p>
  <pre>${esc(env.baseUrl + DR_DRIVE_CALLBACK_PATH)}</pre>
  <p>OAuth Client: Web application. Add this exact HTTPS URI under Authorized redirect URIs.
  Configure NOTEMESH_DRIVE_CLIENT_ID and NOTEMESH_DRIVE_CLIENT_SECRET directly in
  Railway's private Variables UI, never in chat or GitHub. Set
  NOTEMESH_DRIVE_SETUP_ENABLED=1 only when explicitly approving a test connection.</p>
  ${sealed ? `<h2>Google consent completed: encrypted credential (single display)</h2>
  <p>Place the encrypted credential below into the private Railway variable
  NOTEMESH_DRIVE_CREDENTIAL. Do not paste it into chat, commits or a Vault note.
  Keep the original ENCRYPTION_KEY secure; rotating it without a migration invalidates this credential.
  This page is one-time. Google Drive uploading is NOT enabled by storing it.</p>
  <textarea readonly rows="8" cols="72">${esc(sealed)}</textarea>` : ""}
  ${driveSetupEnabled() && configured ?
   `<p><strong>Mobile browser:</strong> tap the direct Google consent link below. It navigates to Google without a form redirect.</p>\n  ${directConsentUrl ? `<p><a href="${esc(directConsentUrl)}" target="_self" rel="noreferrer noopener" referrerpolicy="no-referrer">Open Google consent directly (recommended)</a></p>` : `<p>Consent link temporarily unavailable; wait five minutes, then reload.</p>`}` :
   '<p>Consent is disabled until the OAuth callback is deployed and the feature flag is approved.</p>'}
  ${process.env.RAILWAY_ENVIRONMENT_NAME === "staging" && driveSetupEnabled() && !!process.env.NOTEMESH_DRIVE_CREDENTIAL ?
    `<h2>Staging-only credential smoke test (no Drive file access)</h2>
    <p>Use the button once to verify the encrypted credential decrypts and Google accepts its refresh grant. It does not upload or schedule anything.</p>
    <form method="post" action="/api/backup-drive/credential-check"><input type="hidden" name="dr_consent_proof" value="${esc(issueDrConsentFormProof(admin.session?.id ?? admin.user.id, env.encryptionKey))}"><button type="submit">Verify stored Google DR credential (no upload)</button></form>` : ""}
  ${process.env.RAILWAY_ENVIRONMENT_NAME === "staging" &&
     process.env.NOTEMESH_DRIVE_FIXTURE_TEST_ENABLED === "1" &&
     driveSetupEnabled() && !!process.env.NOTEMESH_DRIVE_CREDENTIAL ?
    `<h2>Optional STAGING synthetic Drive upload/readback (manual only)</h2>
    <p>This one-shot test creates one NEW application-owned Drive folder and uploads a small encrypted
    random fixture into it, then downloads, hashes and decrypts that test object. The test files are left
    in that folder for audit. It does NOT read Vault or existing Drive folders, run actual .nmb backup,
    restore production data, activate a backup scheduler or automatically retry failures.</p>
    <form method="post" action="/api/backup-drive/fixture-upload"><input type="hidden" name="dr_consent_proof"
    value="${esc(issueDrConsentFormProof(admin.session?.id ?? admin.user.id, env.encryptionKey))}">
    <button type="submit">Run one synthetic encrypted Drive upload/download (creates test folder)</button></form>` : ""}
  <p>Required next gates: explicit permission to access an authorized app-created Drive folder,
  production writer coordination, verified upload/download, isolated restore drill, alerts and scheduling.</p>
  </main></body></html>`;
  return new Response(page, { headers });
}
export async function POST({ request }: APIEvent) {
  const admin = await adminSession(request);
  if (!admin) return new Response("Unauthorized", { status: 401, headers });
  if (!driveSetupEnabled()) return new Response("DR setup disabled", { status: 403, headers });
  // Do not accept an explicit cross-site Origin/Referer/Fetch-Metadata signal.
  // Browsers omitting Origin must still prove they loaded the current admin's
  // short-lived, server-signed form; this replaces the brittle header-only gate.
  if (!drConsentRequestOriginAllowed(request.headers, env.baseUrl))
    return new Response("Forbidden origin", { status: 403, headers });
  // Preserve the original trusted same-origin POST behavior. Only browser
  // requests with missing/opaque Origin must present the signed proof.
  if (request.headers.get("origin") !== env.baseUrl) {
    let proof: FormDataEntryValue | null;
    try {
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
          "application/x-www-form-urlencoded" ||
          Number(request.headers.get("content-length") ?? 0) > 4096) throw Error();
      proof = (await request.formData()).get("dr_consent_proof");
    } catch {
      return new Response("Invalid form", { status: 403, headers });
    }
    if (typeof proof !== "string" ||
        !validDrConsentFormProof(proof, admin.session?.id ?? admin.user.id, env.encryptionKey))
      return new Response("Invalid or expired form. Reload this page and try again.", { status: 403, headers });
  }
  try {
    const location = beginDrDriveConsent(admin.user.id);
    return new Response(null, { status: 303, headers: { ...headers, Location: location } });
  } catch { return new Response("Dedicated DR OAuth client not ready.", { status: 400, headers }); }
}

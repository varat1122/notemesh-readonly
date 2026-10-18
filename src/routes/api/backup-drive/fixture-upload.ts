/** Deliberate, one-shot synthetic Drive write/readback from STAGING only.
 * Never reads DATA_DIR/Obsidian Vault or writes any production backup.
 */
import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { drConsentRequestOriginAllowed, validDrConsentFormProof } from "~/server/backup/drive-consent-form";
import { driveSetupClient, driveSetupEnabled, openDrCredential, DR_DRIVE_SCOPE } from "~/server/backup/drive-auth";
import { drDriveHeaders as headers, escapeHtml as esc } from "~/server/backup/drive-admin";
import { driveSyntheticFixtureTest } from "~/server/backup/drive-fixture";

let attempted = false; // one attempt per deployed process; no automatic retries or scheduling
const safe = (message: string, status: number) => new Response(message, { status, headers });
export async function POST({request}: APIEvent) {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging" ||
      process.env.NOTEMESH_DRIVE_FIXTURE_TEST_ENABLED !== "1" || !driveSetupEnabled())
    return safe("Synthetic DR fixture test not explicitly enabled for Staging.",403);
  await runAuthMigrations();
  const admin = await auth.api.getSession({headers:request.headers});
  if (!admin) return safe("Admin session required.",401);
  if (!drConsentRequestOriginAllowed(request.headers,env.baseUrl))
    return safe("Forbidden request origin.",403);
  let proof:FormDataEntryValue|null;
  try {
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded" ||
        Number(request.headers.get("content-length") ?? 0)>4096) throw Error();
    proof=(await request.formData()).get("dr_consent_proof");
  } catch { return safe("Invalid fixture test form.",403); }
  if (typeof proof !== "string" ||
      !validDrConsentFormProof(proof,admin.session?.id ?? admin.user.id,env.encryptionKey))
    return safe("Invalid or expired fixture test authorization. Reload the DR setup page.",403);
  if (attempted) return safe("Synthetic Drive test already attempted in this Staging deployment. No retry without deliberate review.",409);
  attempted=true; // fail closed on timeouts/uncertain Drive responses

  let clientId:string,secret:string,refreshToken:string;
  try {
    const client=driveSetupClient();
    clientId=client.id;secret=client.secret;
    refreshToken=openDrCredential(process.env.NOTEMESH_DRIVE_CREDENTIAL??"").refreshToken;
  } catch {return safe("Encrypted DR credential did not decrypt (dr_fixture_credential_invalid)",400);}

  let token:string;
  try {
    const res=await fetch("https://oauth2.googleapis.com/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({client_id:clientId,client_secret:secret,
        refresh_token:refreshToken,grant_type:"refresh_token"}),
      redirect:"error",signal:AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const status=res.status;await res.body?.cancel();
      return safe(`Google rejected the staging fixture grant (HTTP ${status}). No Drive files touched.`,502);
    }
    const bytes=await res.arrayBuffer();
    if(bytes.byteLength>32768)throw Error();
    const data=JSON.parse(Buffer.from(bytes).toString("utf8"));
    if(data.token_type!=="Bearer"||typeof data.access_token!=="string"||
       !data.access_token || (data.scope!==undefined && data.scope!==DR_DRIVE_SCOPE))
      throw Error();
    token=data.access_token;
  } catch { return safe("Could not refresh staging fixture authorization. No Drive write attempted.",502); }

  try {
    const receipt=await driveSyntheticFixtureTest(token);
    const html=`<!doctype html><html><meta charset="utf-8"><title>DR synthetic fixture receipt</title><body>
      <h2>PASS: Synthetic encrypted Google Drive upload/readback</h2>
      <p>Only random synthetic fixture data was encrypted and uploaded into a new app-created test folder.
      Google Drive ciphertext was downloaded and verified by SHA-256, then decrypted back into the original synthetic payload.
      No Vault, SQLite, Obsidian Sync, or existing Drive backup folder was read or changed.</p>
      <p>App-created test folder: <code>${esc(receipt.appCreatedFolderName)}</code></p>
      <p>Encrypted bytes: ${receipt.encryptedBytes}. Ciphertext SHA-256: <code>${receipt.sha256}</code></p>
      <p>IMPORTANT: Test artifacts remain in the new folder; do not mistake them for recoverable .nmb backups.
      This does NOT prove a production-safe snapshot, live-data restore, retention, alerts or automated scheduling.
      No production backup was activated.</p></body></html>`;
    return safe(html,200);
  } catch {
    // A Drive folder and/or file may have been created before the failure.
    // Never delete or retry blindly: preserve test evidence for diagnosis.
    return safe("Synthetic Google Drive fixture was NOT fully verified. An app-created test folder or file may remain. No existing Drive folder, Vault or production backup was modified. (dr_fixture_unverified)",502);
  }
}

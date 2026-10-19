import type { APIEvent } from "@solidjs/start/server";
import { inProcessDrWriterFence } from "~/server/backup/writer-fence";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { beginDriveConsent, DRIVE_CALLBACK_PATH, driveClient } from "~/server/market-prices/drive-auth";
import { driveAdminHeaders as headers, htmlEscape as escape, claimDriveCredential } from "~/server/market-prices/drive-admin";
import { readCachedPrices } from "~/server/market-prices/backend";

async function session(request: Request) { await runAuthMigrations(); return inProcessDrWriterFence.withWrite(() => auth.api.getSession({ headers: request.headers }), "better_auth_adapter"); }
export async function GET({ request }: APIEvent) {
  const admin = await session(request);
  if (!admin) return new Response("Sign in to the existing Investment OS administrator dashboard, then reopen /api/market-prices-drive.", { status: 401, headers });
  const url = new URL(request.url);
  let prepared = "";
  if (url.searchParams.has("prepared")) {
    try { prepared = claimDriveCredential(admin.user.id, url.searchParams.get("prepared") ?? ""); }
    catch { return new Response("Prepared credential expired or already viewed. Start a fresh connection.", { status: 400, headers }); }
  }
  let configured = false; try { driveClient(); configured = true; } catch { /* No secrets in this status. */ }
  let cachedStatus: unknown;
  try { cachedStatus = await readCachedPrices(store => store.status()); } catch { cachedStatus = { available: false, reason: "price_status_unavailable" }; }
  const output = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Investment OS price storage</title><body><main>
    <h1>Google Drive price storage</h1><p>This connects the server to app-created price files using drive.file only. It does not grant ChatGPT broader Drive access or enable Safe Edit.</p>
    <p>OAuth client configured: ${configured}. Stored credential present: ${!!process.env.MARKET_PRICES_DRIVE_CREDENTIAL}. Backend: ${escape(process.env.MARKET_PRICES_STORAGE ?? "disk")}.</p>
    <p>Exact authorized redirect URI:</p><pre>${escape(env.baseUrl + DRIVE_CALLBACK_PATH)}</pre>
    <p>Configure MARKET_PRICES_DRIVE_CLIENT_ID and MARKET_PRICES_DRIVE_CLIENT_SECRET in the existing Railway service first. Do not paste secrets into chat or GitHub.</p>
    ${prepared ? `<h2>Connection consent received; persistence still required</h2><p>Copy this encrypted credential directly into the Railway variable MARKET_PRICES_DRIVE_CREDENTIAL. Treat it as a secret. This page is one-use; restarting before saving requires reconnecting. ENCRYPTION_KEY must remain unchanged.</p><textarea readonly rows="8" cols="70">${escape(prepared)}</textarea><p>After saving, set MARKET_PRICES_STORAGE=google-drive and MARKET_PRICES_DRIVE_SINGLE_WRITER=1 only after confirming one replica and no CLI/second deployment writes to this dataset. Retain MARKET_PRICES_ENABLED=1. Redeploy and verify the collector upload/read-back before declaring activation complete.</p>` : ""}
    ${configured ? '<form method="post"><button type="submit">Connect Google Drive for price files</button></form>' : "<p>OAuth setup is not ready yet. Existing connections continue independently.</p>"}
    <p>Drive snapshots are signed, compressed closed databases, opened only in RAM. No live SQLite file is synced or mounted. No automatic file deletion, sharing, paid resize or quota purchase occurs.</p>
    <h2>Price catalogue status (no source quote refresh)</h2><pre>${escape(JSON.stringify(cachedStatus, null, 2))}</pre>
    </main></body></html>`;
  return new Response(output, { headers });
}
export async function POST({ request }: APIEvent) {
  if (request.headers.get("origin") !== env.baseUrl) return new Response("Forbidden origin", { status: 403, headers });
  const admin = await session(request);
  if (!admin) return new Response("Unauthorized", { status: 401, headers });
  try { return new Response(null, { status: 303, headers: { ...headers, Location: beginDriveConsent(admin.user.id) } }); }
  catch { return new Response("Drive OAuth client not ready. Check the dedicated Drive variables and HTTPS origin.", { status: 400, headers }); }
}

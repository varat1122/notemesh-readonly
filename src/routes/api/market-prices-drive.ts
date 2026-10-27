import type { APIEvent } from "@solidjs/start/server";
import { inProcessDrWriterFence } from "~/server/backup/writer-fence";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { beginDriveConsent, DRIVE_CALLBACK_PATH, driveClient } from "~/server/market-prices/drive-auth";
import { driveAdminHeaders as headers, htmlEscape as escape, claimDriveCredential } from "~/server/market-prices/drive-admin";
import { priceDataStatus } from "~/server/market-prices/status";
import { runPriceRefresh } from "~/server/market-prices/collector";

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
  try { cachedStatus = await priceDataStatus(); } catch { cachedStatus = { available: false, reason: "price_status_unavailable" }; }
  const output = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Investment OS price storage</title><body><main>
    <h1>Google Drive price storage</h1><p>This connects the server to app-created price files using drive.file only. It does not grant ChatGPT broader Drive access or enable Safe Edit.</p>
    <h2>Daily price update</h2><p>Update the configured watchlist using the existing collector. This uses no AI tokens and never writes Vault notes. A successful download does not guarantee the latest exchange session; inspect the dates below.</p>
    ${process.env.MARKET_PRICES_ENABLED === "1" && process.env.MARKET_PRICES_REFRESH_ENABLED === "1" ? '<form method="post"><button name="action" value="refresh">อัปเดตราคา / Update prices</button></form><p>One bounded run, up to five minutes. Keep this tab open. If incomplete, inspect status before continuing; do not start a second writer.</p>' : '<p>Manual updates are disabled pending owner-approved activation.</p>'}
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
  let action = "connect";
  if (request.body) {
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response("Invalid action form", { status: 400, headers });
    const reader = request.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 128) throw Error(); chunks.push(part.value); }
    } catch { return new Response("Invalid action form", { status: 400, headers }); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if ([...form.keys()].some(k => k !== "action") || form.getAll("action").length > 1) return new Response("Invalid action form", { status: 400, headers });
    action = form.get("action") ?? "connect";
  }
  if (action === "refresh") {
    if (process.env.MARKET_PRICES_ENABLED !== "1" || process.env.MARKET_PRICES_REFRESH_ENABLED !== "1") return new Response("Price refresh disabled", { status: 403, headers });
    try {
      const result = await runPriceRefresh({ trigger: "admin" });
      return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Price refresh result</title><body><h1>Price refresh: '+escape(result.status)+'</h1><pre>'+escape(JSON.stringify(result, null, 2))+'</pre><p><a href="/api/market-prices-drive">Read coverage and freshness</a></p><p>No Vault note was written. An incomplete or failed run is not a fresh-data receipt.</p></body></html>', { status: result.status === "complete" ? 200 : 409, headers });
    } catch { return new Response("Price refresh refused; inspect configuration and existing writer state. No automatic retry.", { status: 409, headers }); }
  }
  if (action !== "connect") return new Response("Unknown action", { status: 400, headers });
  try { return new Response(null, { status: 303, headers: { ...headers, Location: beginDriveConsent(admin.user.id) } }); }
  catch { return new Response("Drive OAuth client not ready. Check the dedicated Drive variables and HTTPS origin.", { status: 400, headers }); }
}

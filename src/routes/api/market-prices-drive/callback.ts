import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { finishDriveConsent } from "~/server/market-prices/drive-auth";
import { driveAdminHeaders as headers, prepareDriveCredential } from "~/server/market-prices/drive-admin";

export async function GET({ request }: APIEvent) {
  await runAuthMigrations(); const admin = await auth.api.getSession({ headers: request.headers });
  if (!admin) return new Response("Administrator session required. Reconnect from the signed-in setup page.", { status: 401, headers });
  const url = new URL(request.url);
  try {
    const sealed = await finishDriveConsent(admin.user.id, url.searchParams.get("state") ?? "", url.searchParams.get("code") ?? "");
    const id = prepareDriveCredential(admin.user.id, sealed);
    // Strip Google's authorization code from the URL before showing the encrypted credential.
    return new Response(null, { status: 303, headers: { ...headers, Location: `${env.baseUrl}/api/market-prices-drive?prepared=${id}` } });
  } catch { return new Response("Google Drive connection refused, expired or cancelled. Return to the setup page and try a fresh consent. No price backend was activated.", { status: 400, headers }); }
}

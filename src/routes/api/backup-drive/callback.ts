import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { driveSetupEnabled, finishDrDriveConsent } from "~/server/backup/drive-auth";
import { drDriveHeaders as headers, prepareDrCredential } from "~/server/backup/drive-admin";

export async function GET({ request }: APIEvent) {
  await runAuthMigrations();
  const admin = await auth.api.getSession({ headers: request.headers });
  if (!admin) return new Response("Admin session required; reconnect from signed-in dashboard.", { status: 401, headers });
  if (!driveSetupEnabled()) return new Response("DR OAuth disabled", { status: 403, headers });
  const url = new URL(request.url);
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
  } catch { return new Response("Drive connection failed, expired or cancelled. No backup was activated.", { status: 400, headers }); }
}

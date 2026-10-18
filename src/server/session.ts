import { getRequestEvent } from "solid-js/web";
import { redirect } from "@solidjs/router";
import { auth, isSetupComplete, runAuthMigrations } from "./auth";
import { inProcessDrWriterFence } from "./backup/writer-fence";

// Server-side guard for admin pages and admin server functions.
export async function requireAdmin() {
  "use server";
  await runAuthMigrations();
  if (!(await isSetupComplete())) throw redirect("/setup");
  const event = getRequestEvent();
  const session = await inProcessDrWriterFence.withWrite(() => auth.api.getSession({
    headers: event!.request.headers,
  }));
  if (!session) throw redirect("/login");
  return session;
}

export async function getSessionOrNull() {
  "use server";
  await runAuthMigrations();
  const event = getRequestEvent();
  return inProcessDrWriterFence.withWrite(() => auth.api.getSession({ headers: event!.request.headers }));
}

import { json } from "@solidjs/router";
import { getSetting } from "~/server/db";
import { tracked } from "~/server/maintenance";

function handleGET() {
  return json({
    ok: true,
    configured: getSetting("vault_configured") === "true",
  });
}

// Pending work until the handler settles, even if the client disconnects (maintenance drain).
export const GET = tracked(handleGET);

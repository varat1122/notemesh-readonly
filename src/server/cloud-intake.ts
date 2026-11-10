import { c1Pilot } from "./c1-pilot";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { env } from "./env";
import { getSetting } from "./db";
import { nextIntake, acknowledge } from "./intake";
import { syncBackend, syncKind } from "./sync";
import { maintenanceActive, worker } from "./maintenance";

export const cloudIntakeEnabled = () => process.env.CLOUD_INTAKE === "1";
// Timer and busy flag live in the process-wide maintenance registry: the built
// server evaluates this module once per router bundle, and a drain started in
// one bundle must see and stop a tick started in the other.
const state = () => worker("cloudIntake");
let lastRun: string | null = null;
let lastResult = "waiting";
let verifiedStart: number | null | undefined;
const require = createRequire(import.meta.url);

export function cloudIntakeStatus() {
  return { enabled: cloudIntakeEnabled(), processor: cloudIntakeEnabled() ? "railway" : "desktop",
    lastRun, lastResult, computerRequired: !cloudIntakeEnabled(),
    syncConfirmation: "imported confirms server files only; verify arrival on another Obsidian device separately" };
}

// One synchronous consumer in this single-replica deployment. The old worker
// endpoint is disabled in cloud mode, so a desktop cannot race this importer.
export function processCloudIntake() {
  if (c1Pilot()) return;
  if (maintenanceActive() || !cloudIntakeEnabled() || state().busy || getSetting("vault_configured") !== "true" || syncKind() !== "obsidian") return;
  const sync = syncBackend();
  const status = sync.status();
  // Do not dequeue or acknowledge while a guarded mutation is admitted.
  // This consumer is synchronous: an active import finishes before another
  // request can admit an edit. Git intake remains unsupported/queued above.
  if (status.state !== "running" || sync.isEditPaused?.()) return;
  if (sync.getLogs().some(l => l.line === "[sync-policy] Verified bidirectional sync." && (!status.startedAt || l.ts >= status.startedAt))) verifiedStart = status.startedAt;
  if (verifiedStart !== status.startedAt) return;
  state().busy = true;
  try {
    const item = nextIntake();
    lastRun = new Date().toISOString();
    if (!item) { lastResult = "idle"; return; }
    const space = fs.statfsSync(env.dataDir);
    if (space.bavail * space.bsize < 50_000_000 + Buffer.byteLength(JSON.stringify(item)) * 5) {
      lastResult = "waiting_for_disk_space"; return;
    }
    try {
      const { importItem } = require(path.resolve("scripts/intake-importer.cjs")) as {
        importItem: (item: unknown, vault: string, archive: string) => string[];
      };
      const paths = importItem(item, env.vaultDir, path.join(env.dataDir, "intake-archive"));
      acknowledge({ id: item.id, status: "imported", paths,
        message: "Cloud receiver verified new server files. Desktop not required. Obsidian Sync upload and device arrival must still be verified." });
      lastResult = "imported";
    } catch (e) {
      acknowledge({ id: item.id, status: "blocked", paths: [], message: String(e instanceof Error ? e.message : e).slice(0,1000) });
      lastResult = "blocked";
    }
  } finally { state().busy = false; }
}

export function ensureCloudIntakeStarted() {
  if (c1Pilot()) return;
  const w = state();
  if (!cloudIntakeEnabled() || w.timer || maintenanceActive()) return;
  const tick = () => { try { processCloudIntake(); } catch { lastResult = "retrying"; } };
  w.timer = setInterval(tick, 5000);
  w.timer.unref();
}

export function stopCloudIntake() {
  const w = state();
  if (w.timer) clearInterval(w.timer);
  w.timer = undefined;
}

export function cloudIntakeBusy(): boolean {
  return state().busy;
}

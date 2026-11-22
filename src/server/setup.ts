import { getRequestEvent } from "solid-js/web";
import { db, assertResearchEntry, deleteSetting, getSetting, setSetting } from "./db";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { c1Pilot } from "./c1-pilot";
import { assertEnabled } from "./safe-edit/engine";
import { assertNoMaintenance, maintenanceActive, withD1NativeInterlock, worker } from "./maintenance";
import { supervisor } from "./ob/supervisor";
import { PublicError } from "./public-error";
import { env, detectOriginMismatch, type OriginMismatch } from "./env";
import { runAuthMigrations } from "./auth";
import { validateRemoteUrl } from "./sync/remote";
import { isSetupComplete, claimWindowRemainingMs, CLAIM_WINDOW_MINUTES } from "./claim";
import {
  obLogin,
  obListRemoteVaults,
  obIsAuthenticated,
  obSyncSetup,
  obSyncConfigs,
  obSyncStatus,
  looksLikeMfaRequired,
  looksLikeAuthFailure,
  type RemoteVault,
} from "./ob/cli";
import { storeObsidianAccount, storeVaultPassword } from "./ob/credentials";
import { syncBackend } from "./sync";
import { SETTINGS_SYNC_CATEGORIES } from "./ob/settings-sync";
import { requireAdmin } from "./session";
import { probeRemote, cloneVault, repoDisplayName, gitBackend } from "./sync/git";
import { storeGitCredentials, clearGitCredentials } from "./sync/git-credentials";

export type SetupStage =
  | "admin" // no admin account yet — wizard step 1
  | "backend" // admin exists, hasn't chosen how the vault syncs
  | "local-vault" // verified disposable C1 instance, never a sync backend
  | "obsidian-login" // Obsidian backend: account not linked
  | "vault" // Obsidian backend: logged in, vault not chosen
  | "git" // git backend: repo not linked
  | "timezone" // vault works; "today" not yet pinned to a zone
  | "notifications" // told how they will hear about security fixes
  | "done";

async function computeStage(): Promise<SetupStage> {
  await runAuthMigrations();
  if (!(await isSetupComplete())) return "admin";
  if (c1Pilot()) {
    if (getSetting("vault_configured") !== "true") return "local-vault";
  } else {
    const backend = getSetting("sync_backend");
    if (!backend) return "backend";
    if (backend === "git") {
      if (getSetting("vault_configured") !== "true") return "git";
    } else {
      if (getSetting("obsidian_logged_in") !== "true") return "obsidian-login";
      if (getSetting("vault_configured") !== "true") return "vault";
    }
  }
  // Asked last, because it is the only step that needs nothing else to work and
  // the only one a deployer can skip without the vault breaking. The container
  // runs in UTC, so leaving it unset silently files an evening daily note under
  // tomorrow's date for anyone west of Greenwich.
  //
  // Keyed on the setting being absent rather than on its value: an instance that
  // finished setup before this step existed reaches the dashboard normally
  // (middleware gates on vault_configured, not on this), and only sees the step
  // if it visits the wizard.
  if (getSetting("timezone") === undefined) return "timezone";
  // Last, and its own step rather than a card on the finish screen, because it
  // is the one thing this server cannot do for the operator later: it has no
  // way to contact them, so if they scroll past this they have no channel for
  // a security fix at all. A step they have to acknowledge is read; a card
  // below a "Go to Dashboard" button is not.
  //
  // Keyed on absence, like the timezone step. An instance that finished setup
  // before this existed will see it once on its next visit to the wizard.
  if (getSetting("notifications_acknowledged") === undefined) return "notifications";
  return "done";
}

/**
 * Record that the operator has been shown how they will hear about updates.
 *
 * Stores only that the screen was acknowledged. Whether they actually
 * subscribed happens on another site entirely and this server has no way to
 * know — claiming otherwise in a setting would be recording a fact we do not
 * have.
 */
export async function acknowledgeNotifications(): Promise<{ ok: boolean }> {
  "use server";
  await requireAdmin();
  setSetting("notifications_acknowledged", "true");
  return { ok: true };
}

// Same stage, plus the chosen backend, so the wizard can number its steps: the
// Obsidian path has one more than the git path, and which one is in play isn't
// derivable from a stage that both paths share.
export async function getSetupProgress(): Promise<{
  stage: SetupStage;
  backend: "obsidian" | "git" | null;
  localOnly: boolean;
}> {
  "use server";
  const stage = await getSetupStage();
  const backend = getSetting("sync_backend");
  const localOnly = c1Pilot();
  return { stage, backend: localOnly ? null : backend === "git" ? "git" : backend ? "obsidian" : null, localOnly };
}

const LOCAL_VAULT_NAME = "C1 Local Research Lab";
const LOCAL_DIRECTORIES = ["00_Inbox", "00_Inbox/ChatGPT", "10_Knowledge",
  "10_Knowledge/Company Research", "10_Knowledge/Industry and Concepts", "10_Knowledge/Macro and Markets"] as const;
const localConfirmation = z.object({ confirmLocalOnly: z.literal(true) }).strict();
function denyRemotePilotSetup() {
  if (c1Pilot()) throw new PublicError("c1_local_only_remote_setup_denied", 409);
}
function entryExists(file: string): boolean {
  try { fs.lstatSync(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function cleanLocalSettings() {
  for (const key of ["sync_backend", "git_remote", "git_branch", "git_username", "git_token",
    "obsidian_logged_in", "obsidian_email", "obsidian_password", "vault_password"])
    if (getSetting(key) !== undefined) throw new PublicError("c1_local_setup_remote_state_hold", 409);
  const configured = getSetting("vault_configured"), name = getSetting("vault_name");
  if ((configured !== undefined && configured !== "false" && configured !== "true") ||
    (name !== undefined && name !== LOCAL_VAULT_NAME) || (configured === "true" && name !== LOCAL_VAULT_NAME))
    throw new PublicError("c1_local_setup_existing_state_hold", 409);
  // Refuse ambiguous on-disk remote configuration without invoking either CLI.
  if (entryExists(path.join(env.vaultDir, ".git")) || entryExists(path.join(env.vaultDir, ".obsidian")))
    throw new PublicError("c1_local_setup_remote_state_hold", 409);
  if (entryExists(env.obHomeDir)) {
    const stat = fs.lstatSync(env.obHomeDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PublicError("c1_local_setup_remote_state_hold", 409);
    const directory = fs.opendirSync(env.obHomeDir);
    try { if (directory.readSync()) throw new PublicError("c1_local_setup_remote_state_hold", 409); }
    finally { directory.closeSync(); }
  }
}
function localAdmission() {
  if (!c1Pilot()) throw new PublicError("c1_local_setup_requires_disposable_pilot", 403);
  assertEnabled();
  assertResearchEntry();
  assertNoMaintenance("C1 local setup");
  const intake = worker("cloudIntake");
  if (intake.busy || intake.timer || !supervisor().isQuiescent() || !gitBackend().isQuiescent())
    throw new PublicError("c1_pilot_external_writer_hold", 409);
}

/** Configuration only: no notes, receipts, reviewer decisions or new backend.
 * Auth awaits finish BEFORE the synchronous lock/native/transaction section. */
export async function setupLocalPilotVault(input: { confirmLocalOnly: true }) {
  "use server";
  await requireAdmin();
  if (!localConfirmation.safeParse(input).success) throw new PublicError("c1_local_setup_confirmation_required", 400);
  localAdmission();
  const connection = db();
  cleanLocalSettings();
  const opened = new Map<string, { fd: number; dev: number; ino: number }>();
  const outcome = { createdDirectories: [] as string[], settings: "not_attempted" as "not_attempted" | "acknowledged" | "unchanged" | "unknown",
    lock: "not_acquired" as "not_acquired" | "held" | "release_unverified" | "released" };
  let lockIdentity: fs.Stats | undefined;
  let lockPath = "";
  const openDirectory = (absolute: string, anchored = absolute) => {
    const fd = fs.openSync(anchored, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd), named = fs.lstatSync(absolute);
      if (!named.isDirectory() || named.isSymbolicLink() || named.dev !== stat.dev || named.ino !== stat.ino ||
        fs.readlinkSync(`/proc/self/fd/${fd}`) !== absolute) throw Error("c1_local_setup_directory_identity_hold");
      opened.set(absolute, { fd, dev: stat.dev, ino: stat.ino });
      return fd;
    } catch (error) {
      try { fs.closeSync(fd); }
      catch (closeError) { if (error instanceof Error && Object.isExtensible(error)) Object.assign(error, { setupCloseErrors: [closeError] }); }
      throw error;
    }
  };
  const verifyDirectories = () => {
    for (const [absolute, open] of opened) {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== open.dev || stat.ino !== open.ino ||
        fs.readlinkSync(`/proc/self/fd/${open.fd}`) !== absolute) throw Error("c1_local_setup_directory_identity_hold");
    }
    if (outcome.lock === "held") {
      const stat = fs.lstatSync(lockPath);
      if (!lockIdentity || stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== lockIdentity.dev || stat.ino !== lockIdentity.ino)
        throw Error("c1_local_setup_lock_identity_hold");
    }
  };
  const effect = <T>(operation: string, run: () => T): T => {
    localAdmission();
    // One native mutation per interlock. No DB call, await or nested interlock
    // inside this callback; descriptor/identity checks are read-only.
    return withD1NativeInterlock("business", () => { verifyDirectories(); return run(); }, { operation });
  };
  const closeOpened = () => {
    const descriptors = [...opened.values()]; opened.clear();
    const errors: unknown[] = [];
    for (const { fd } of descriptors) {
      try { fs.closeSync(fd); } catch (error) { errors.push(error); }
    }
    return errors;
  };
  let primaryError: unknown;
  let dataFd = -1;
  const release = () => {
    effect("c1_setup.lock_remove", () => { fs.rmdirSync(lockPath); outcome.lock = "release_unverified"; });
    effect("c1_setup.lock_sync", () => fs.fsyncSync(dataFd));
    outcome.lock = "released";
  };
  try {
    dataFd = openDirectory(env.dataDir);
    const vaultFd = openDirectory(env.vaultDir, `/proc/self/fd/${dataFd}/vault`);
    lockPath = `/proc/self/fd/${dataFd}/safe-edit.lock`;
    if (entryExists(lockPath)) throw new PublicError("c1_local_setup_writer_lock_hold", 409);
    effect("c1_setup.lock_create", () => {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      outcome.lock = "held";
      lockIdentity = fs.lstatSync(lockPath);
    });
    effect("c1_setup.lock_sync", () => fs.fsyncSync(dataFd));
    cleanLocalSettings();
    const alreadyConfigured = getSetting("vault_configured") === "true";
    for (const relative of LOCAL_DIRECTORIES) {
      const absolute = path.join(env.vaultDir, relative), parent = path.dirname(absolute);
      const parentFd = parent === env.vaultDir ? vaultFd : opened.get(parent)!.fd;
      const anchored = `/proc/self/fd/${parentFd}/${path.basename(relative)}`;
      verifyDirectories();
      if (!entryExists(anchored)) {
        // A configured instance losing a directory requires reconciliation,
        // not an idempotent call silently repairing its filesystem.
        if (alreadyConfigured) throw new PublicError("c1_local_setup_directory_missing_hold", 409);
        effect("c1_setup.directory_create", () => { fs.mkdirSync(anchored, { mode: 0o700 }); outcome.createdDirectories.push(relative); });
      }
      const fd = openDirectory(absolute, anchored);
      effect("c1_setup.directory_sync", () => fs.fsyncSync(fd));
      effect("c1_setup.parent_sync", () => fs.fsyncSync(parentFd));
    }
    localAdmission(); verifyDirectories(); cleanLocalSettings();
    if (alreadyConfigured) outcome.settings = "unchanged";
    else {
      // Even a thrown COMMIT can have written. Preserve the original D1 error
      // and keep unknown distinct from "not attempted" and acknowledged.
      outcome.settings = "unknown";
      connection.transaction(() => {
        verifyDirectories(); cleanLocalSettings();
        setSetting("vault_name", LOCAL_VAULT_NAME);
        setSetting("vault_configured", "true");
      })();
      outcome.settings = "acknowledged";
    }
    if (getSetting("vault_configured") !== "true" || getSetting("vault_name") !== LOCAL_VAULT_NAME)
      throw Error("c1_local_setup_readback_hold");
    verifyDirectories();
    release();
    const closeErrors = closeOpened();
    if (closeErrors.length) throw Error("c1_local_setup_descriptor_close_hold", { cause: closeErrors[0] });
    return { ok: true as const, localOnly: true as const, configured: true as const,
      externalSync: false as const, remoteBackup: false as const, ...outcome };
  } catch (error) {
    primaryError = error;
    // Release only our known lock after a determinate refusal. D1 uncertainty,
    // changed ownership or maintenance leaves recovery evidence in place.
    if (outcome.lock === "held" && !maintenanceActive() && outcome.settings !== "unknown") {
      try { release(); }
      catch (releaseError) { if (error instanceof Error && Object.isExtensible(error)) Object.assign(error, { setupReleaseError: releaseError }); }
    }
    if (error instanceof Error && Object.isExtensible(error)) Object.assign(error, { c1SetupOutcome: outcome });
    console.error("[c1-local-setup] HOLD", outcome);
    throw error;
  } finally {
    const closeErrors = closeOpened();
    if (closeErrors.length && primaryError instanceof Error && Object.isExtensible(primaryError))
      Object.assign(primaryError, { setupCloseErrors: closeErrors });
  }
}

/**
 * Reopen the vault step of the wizard.
 *
 * The stage is computed from settings alone, so an instance whose
 * vault_configured says "true" reports setup as finished even when the sync
 * client has no configuration for that vault — which left the Status tab
 * correctly reporting an unlinked vault and its own button leading to a page
 * saying setup was complete.
 *
 * Clearing the flag here rather than automatically when the supervisor
 * notices: it sends every admin page to the wizard, so it should be something
 * the operator chose, not something a background check did to them.
 */
export async function relinkVault(): Promise<{ ok: boolean }> {
  "use server";
  await requireAdmin();
  deleteSetting("vault_configured");
  if (!c1Pilot()) syncBackend().note("[admin] Vault unlinked — finish the wizard to link it again.");
  return { ok: true };
}

export async function setupChooseBackend(kind: "obsidian" | "git"): Promise<{ ok: boolean }> {
  "use server";
  await requireAdmin();
  denyRemotePilotSetup();
  setSetting("sync_backend", kind === "git" ? "git" : "obsidian");
  return { ok: true };
}

export interface GitSetupResult {
  ok: boolean;
  message?: string;
}

// Link a git repo as the vault. Probes the remote first so a bad URL, a bad
// token, or a too-old git reports precisely instead of failing halfway through
// a clone.
export async function setupGitRepo(
  remote: string,
  branch: string,
  username: string,
  token: string,
): Promise<GitSetupResult> {
  "use server";
  await requireAdmin();
  denyRemotePilotSetup();
  const ref = branch.trim() || "main";
  // HTTPS only, and never with credentials in it — see sync/remote.ts.
  // OB_ALLOW_LOCAL_GIT exists so the project's own tests can point at a bare
  // repo on disk; it is not documented for deployments and does nothing unless
  // explicitly set.
  const checked = validateRemoteUrl(remote, process.env.OB_ALLOW_LOCAL_GIT === "1");
  if (!checked.ok) return { ok: false, message: checked.message };
  const url = checked.url;
  if (!/^[\w.\-/]+$/.test(ref)) {
    return { ok: false, message: "Branch names are limited to letters, numbers, . - _ and /." };
  }

  storeGitCredentials(username, token);
  const probe = await probeRemote(url, ref);
  if (!probe.ok) {
    clearGitCredentials();
    return { ok: false, message: probe.message ?? "Could not reach the repository." };
  }

  setSetting("git_remote", url);
  setSetting("git_branch", ref);
  const cloned = await cloneVault(url, ref);
  if (!cloned.ok) {
    return { ok: false, message: cloned.message ?? "Clone failed." };
  }

  setSetting("vault_name", repoDisplayName(url));
  setSetting("vault_configured", "true");
  syncBackend().resetAndStart();
  return { ok: true };
}

// Plain server function, deliberately NOT wrapped in solid-router's query():
// query() caches by key, so the wizard's refetch after each step would see the
// stale stage and never advance.
export async function getSetupStage(): Promise<SetupStage> {
  "use server";
  return computeStage();
}

export interface ClaimState {
  claimable: boolean;
  secondsLeft: number;
  windowMinutes: number;
  /**
   * Set when the server was reached at an origin it wasn't configured with.
   * Surfaced here specifically because this is the page where it bites: the
   * auth layer refuses sign-up with "Invalid origin" before there is any
   * account to sign in with, so the warnings on the admin tabs are unreachable.
   */
  originMismatch: OriginMismatch | null;
}

// Public by necessity: this drives the very first screen, before any account
// exists to authenticate against. Once the instance is claimed it reports a
// closed window unconditionally, so it stops describing the process to anyone
// who asks.
export async function getClaimState(): Promise<ClaimState> {
  "use server";
  await runAuthMigrations();
  const mismatch = detectOriginMismatch(
    env.baseUrl,
    getRequestEvent()?.request.headers.get("host"),
  );
  if (await isSetupComplete()) {
    return {
      claimable: false,
      secondsLeft: 0,
      windowMinutes: CLAIM_WINDOW_MINUTES,
      originMismatch: mismatch,
    };
  }
  const remaining = claimWindowRemainingMs();
  return {
    claimable: remaining > 0,
    secondsLeft: Math.ceil(remaining / 1000),
    windowMinutes: CLAIM_WINDOW_MINUTES,
    originMismatch: mismatch,
  };
}

export interface ObsidianLoginResult {
  ok: boolean;
  mfaRequired?: boolean;
  message?: string;
}

// Wizard step: link the Obsidian account. Requires an admin session — the
// admin account is created before this step, so all ob-facing actions are
// behind login.
export async function setupObsidianLogin(
  email: string,
  password: string,
  mfa?: string,
): Promise<ObsidianLoginResult> {
  "use server";
  await requireAdmin();
  denyRemotePilotSetup();
  const res = await obLogin(email, password, mfa || undefined);
  if (!res.ok) {
    if (looksLikeMfaRequired(res.combined)) {
      return { ok: false, mfaRequired: true, message: "Multi-factor code required." };
    }
    return { ok: false, message: lastLines(res.combined) || "Login failed." };
  }
  // ob exits 0 even when the login did not take, so a zero exit proves nothing.
  // Confirm with a command that genuinely requires auth before recording
  // success — otherwise the wizard advances to the vault picker and only then
  // discovers there is no session, with no way back.
  if (!(await obIsAuthenticated())) {
    if (looksLikeMfaRequired(res.combined)) {
      return { ok: false, mfaRequired: true, message: "Multi-factor code required." };
    }
    // A wrong password fails loudly: the CLI exits non-zero with "Login failed,
    // please double check your email and password". Exiting cleanly with no
    // output at all means something else — in practice, that it prompted for a
    // two-factor code and reached end-of-input, because a server can't answer
    // an interactive prompt.
    if (!res.combined.trim()) {
      return {
        ok: false,
        mfaRequired: true,
        message:
          "The sync client stopped without an error, which almost always means it asked for a " +
          "two-factor code. Enter the current code from your authenticator and try again.",
      };
    }
    return {
      ok: false,
      message:
        lastLines(res.combined) ||
        "Obsidian did not accept those credentials. Check the email and password for your " +
          "Obsidian.md account — these are not your vault's encryption password.",
    };
  }
  storeObsidianAccount(email, password);
  setSetting("obsidian_logged_in", "true");
  return { ok: true };
}

export interface VaultListResult {
  ok: boolean;
  vaults: RemoteVault[];
  raw: string;
  message?: string;
}

export async function setupListVaults(): Promise<VaultListResult> {
  "use server";
  await requireAdmin();
  denyRemotePilotSetup();
  const { result, vaults } = await obListRemoteVaults();
  if (!result.ok || (!vaults.length && looksLikeAuthFailure(result.combined))) {
    // Losing the session here means the wizard would otherwise sit on a vault
    // picker it can never populate. Drop back to the login step so the
    // credentials can simply be entered again.
    if (looksLikeAuthFailure(result.combined)) {
      setSetting("obsidian_logged_in", "false");
      return {
        ok: false,
        vaults: [],
        raw: result.combined,
        message: "The Obsidian session is gone — sign in again.",
      };
    }
    return { ok: false, vaults: [], raw: result.combined, message: lastLines(result.combined) };
  }
  return { ok: true, vaults, raw: result.stdout };
}

export async function setupConfigureVault(
  vault: string,
  encryptionPassword: string,
): Promise<{ ok: boolean; message?: string }> {
  "use server";
  await requireAdmin();
  denyRemotePilotSetup();
  const res = await obSyncSetup(vault, encryptionPassword || undefined);
  if (!res.ok) {
    return { ok: false, message: lastLines(res.combined) || "sync-setup failed." };
  }
  if (encryptionPassword) storeVaultPassword(encryptionPassword);

  // Ask for the vault's own core-plugin settings, which is where Obsidian keeps
  // daily-notes.json. Config sync is off by default, so without this the vault
  // arrives with no .obsidian folder at all and the daily_note tool falls back
  // to YYYY-MM-DD at the vault root — quietly building a second set of dailies
  // beside the real ones for anyone who keeps them in a folder.
  //
  // Best effort on purpose. The vault is linked and usable either way, and
  // failing setup over a convenience would be the wrong trade; the Settings tab
  // can still set the folder by hand. Reported into the sync log so the reason
  // is visible if the daily path later looks wrong.
  const configs = await obSyncConfigs(SETTINGS_SYNC_CATEGORIES);
  if (configs.ok) {
    syncBackend().note("[setup] Syncing your vault's core plugin settings (daily notes, etc).");
  } else {
    syncBackend().note(
      "[setup] Could not enable settings sync — set the daily note folder on the Settings tab if it looks wrong.",
      "warn",
    );
  }

  setSetting("vault_configured", "true");
  // The picker passes the vault id; sync-status --json knows the display name.
  let vaultName = vault;
  const status = await obSyncStatus();
  if (status.ok) {
    try {
      const parsed = JSON.parse(status.stdout);
      if (typeof parsed.vaultName === "string" && parsed.vaultName) vaultName = parsed.vaultName;
    } catch {
      // keep the id as the name
    }
  }
  setSetting("vault_name", vaultName);
  syncBackend().resetAndStart();
  return { ok: true };
}

// Trim CLI output to something presentable in the UI.
function lastLines(s: string, n = 4): string {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join("\n");
}

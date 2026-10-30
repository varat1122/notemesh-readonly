import { acquireGitMutationLock } from "./mutation-lock";
import { redactRemote, remoteHasCredentials, validateRemoteUrl } from "./remote";
import { fenceInline } from "../mcp/boundary";
import { postNotice } from "../notices";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { db, getSetting } from "../db";
import { runGit } from "./git-exec";
import { refreshGitTimes } from "../vault/modified";
import type { ConflictRecord } from "./types";
import { probeMerge, resolveConflict } from "./conflict";
import { LogRing, type LogLine, type SyncBackend, type SyncState, type SyncStatus } from "./types";

// Git-backed vault sync.
//
// Conflict handling is the whole design here. Git merges per file and then per
// hunk, so the overwhelming majority of concurrent edits — different notes, or
// the same note in different places — merge cleanly with nothing lost. A real
// conflict needs the same region of the same file touched on both sides inside
// one debounce window, which in a single-user product means you editing the
// exact note your agent is writing to, right then.
//
// When that does happen we never let git write conflict markers into the vault:
// `git merge-tree` performs the merge in the object database and reports the
// result without touching the working tree, so the indexer and the model never
// see `<<<<<<<`. The remote's version keeps the filename and ours is written
// beside it as a conflicted copy, committed and pushed so it reaches every
// device — where the user resolves it in Obsidian. Nothing is discarded, and
// nothing is left for the server to wait on: a handled conflict is information
// on the Status tab, not a state.

const DEFAULT_DEBOUNCE_SECONDS = 5;
const DEFAULT_PULL_SECONDS = 30;
// A pure debounce never fires while an agent keeps writing, so cap the wait.
const MIN_MAX_WAIT_MS = 30_000;
// `git merge-tree --write-tree` needs this; Debian trixie ships 2.47.
const MIN_GIT_VERSION = [2, 38];
// The Status tab lists recent conflicts as information; this bounds the list.
const MAX_RECENT_CONFLICTS = 20;

export interface GitConfig {
  remote: string;
  branch: string;
}

export function gitConfig(): GitConfig | null {
  const remote = getSetting("git_remote");
  if (!remote) return null;
  return { remote, branch: getSetting("git_branch") || "main" };
}

function debounceMs(): number {
  const n = Number(getSetting("git_debounce_seconds"));
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_DEBOUNCE_SECONDS) * 1000;
}

function pullMs(): number {
  const n = Number(getSetting("git_pull_seconds"));
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_PULL_SECONDS) * 1000;
}

export async function gitVersionOk(): Promise<{ ok: boolean; version: string }> {
  const res = await runGit(["--version"], { cwd: env.dataDir, timeoutMs: 10_000 });
  const m = res.stdout.match(/(\d+)\.(\d+)/);
  if (!m) return { ok: false, version: res.stdout.trim() || "unknown" };
  const [major, minor] = [Number(m[1]), Number(m[2])];
  const ok =
    major > MIN_GIT_VERSION[0] || (major === MIN_GIT_VERSION[0] && minor >= MIN_GIT_VERSION[1]);
  return { ok, version: `${major}.${minor}` };
}

/**
 * The one-shot notice for a handled conflict. The prose is the server's; the
 * paths came from the vault, so they travel fenced — a filename can be a
 * sentence, and a block described to the model as trusted must not carry
 * one unmarked (#58).
 */
export function conflictNotice(notePath: string, copy: string | null): string {
  const at = fenceInline(notePath);
  return copy
    ? `a sync conflict on ${at} was resolved by saving your assistant's version as ${fenceInline(copy)}. Ask the user how they would like the two merged.`
    : `a sync conflict on ${at} was resolved in favour of the other device's version.`;
}

export function looksLikeAuthFailure(text: string): boolean {
  return /authentication failed|could not read Username|invalid username or password|403 Forbidden|401 Unauthorized|Permission denied \(publickey\)|remote: Repository not found/i.test(
    text,
  );
}

export function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

export class GitBackend implements SyncBackend {
  readonly kind = "git" as const;

  private _state: SyncState = "stopped";
  /** When `state` last changed. */
  stateSince: number | null = null;
  get state(): SyncState {
    return this._state;
  }
  set state(next: SyncState) {
    if (next !== this._state) this.stateSince = Date.now();
    this._state = next;
  }
  startedAt: number | null = null;
  lastActivityAt: number | null = null;
  restartCount = 0;
  conflicts: ConflictRecord[] = [];

  private ring = new LogRing();
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushDeadline: number | null = null;
  private busy = false;
  private inFlight: Promise<boolean> | null = null;
  private editPaused = false;
  private generation = 0;
  private stopping = false;

  isEditPaused(): boolean { return this.editPaused; }

  private clearTimers() {
    if (this.pullTimer) clearInterval(this.pullTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pullTimer = null;
    this.pushTimer = null;
    this.pushDeadline = null;
  }

  private armPoll() {
    const generation = this.generation;
    this.pullTimer = setInterval(() => {
      if (generation === this.generation) void this.cycle("poll");
    }, pullMs());
  }

  // Admission is synchronous. Every source of Git work checks this gate again
  // when it actually wakes up; cancelling timers alone is not exclusion.
  async withPausedForEdit<T>(run: () => T | Promise<T>): Promise<T> {
    if (this.editPaused || this.state !== "running" || !this.pullTimer || this.stopping)
      throw Error("Git must be running and healthy before Safe Edit");
    const cfg = gitConfig();
    const expected = process.env.SAFE_EDIT_GIT_REMOTE;
    if (!cfg || !expected || cfg.remote !== expected || !validateRemoteUrl(expected, process.env.OB_ALLOW_LOCAL_GIT === "1").ok ||
        !/^[A-Za-z0-9][\w./-]*$/.test(cfg.branch) ||
        process.env.SAFE_EDIT_GIT_BRANCH !== cfg.branch)
      throw Error("Safe Edit requires an exact reviewed Git remote and branch pin");
    this.editPaused = true;
    this.generation++;
    this.clearTimers();
    let release: (() => void) | undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(Error("Git pause timed out; no edit applied; administrator recovery required"));
      }, 10_000);
    });
    try {
      const prepare = async () => {
        if (this.inFlight && !await this.inFlight) throw Error("In-flight Git cycle failed; no edit applied");
        // A timed-out continuation must never acquire a lock or invoke run.
        if (timedOut) return;
        if (this.busy || this.state !== "running") throw Error("Git drain was not healthy");
        release = acquireGitMutationLock();
        await this.assertEditWorktree(cfg);
      };
      await Promise.race([prepare(), deadline]);
      if (timer) clearTimeout(timer);
      const current = gitConfig();
      if (this.stopping || this.state !== "running" || getSetting("sync_backend") !== "git" ||
          getSetting("vault_configured") !== "true" || current?.remote !== cfg.remote || current?.branch !== cfg.branch ||
          process.env.SAFE_EDIT_ENABLED !== "1" || process.env.SAFE_EDIT_SINGLE_WRITER !== "1" ||
          process.env.CLOUD_INTAKE !== "1" || process.env.SAFE_EDIT_GIT_REMOTE !== cfg.remote ||
          process.env.SAFE_EDIT_GIT_BRANCH !== cfg.branch) throw Error("Git deployment changed during pause; no edit applied");
      // Await even an accidental async callback: never resume under its writes.
      return await run();
    } finally {
      if (timer) clearTimeout(timer);
      if (timedOut || this.interruptedEdit()) {
        // Neither a timer nor an unknown subprocess completion proves safety.
        // Retain the gate and any acquired disk lock until explicit recovery.
        this.note("[git] Safe Edit pause held; administrator recovery required", "error");
      } else {
        release?.();
        this.editPaused = false;
        this.generation++;
        if (!this.stopping && this.state === "running") {
          this.armPoll();
          // One reconcile discovers callback writes even without notification.
          void this.cycle("safe-edit-resume");
        }
      }
    }
  }

  private interruptedEdit(): boolean {
    if (fs.existsSync(path.join(env.dataDir, "safe-edit.lock"))) return true;
    const d = db();
    return Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get() &&
      d.prepare("SELECT 1 FROM safe_edit_operations WHERE status='writing' LIMIT 1").get());
  }

  private async assertEditWorktree(cfg: GitConfig) {
    if (this.interruptedEdit()) throw Error("Interrupted Safe Edit operation requires recovery");
    const check = async (args: string[]) => {
      const result = await runGit(args, { timeoutMs: 5_000 });
      if (!result.ok) throw Error("Git preflight failed; no edit applied");
      return result.stdout.trim();
    };
    await check(["check-ref-format", `refs/heads/${cfg.branch}`]);
    const top = await check(["rev-parse", "--show-toplevel"]);
    if (fs.realpathSync(top) !== fs.realpathSync(env.vaultDir)) throw Error("Git root must be the configured vault");
    if (await check(["remote", "get-url", "--all", "origin"]) !== cfg.remote ||
        await check(["remote", "get-url", "--push", "--all", "origin"]) !== cfg.remote ||
        await check(["symbolic-ref", "--short", "HEAD"]) !== cfg.branch ||
        await check(["status", "--porcelain", "--untracked-files=all"]))
      throw Error("Git remote, branch or clean worktree preflight refused edit");
    for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "index.lock", "HEAD.lock", "shallow"]) {
      const location = await check(["rev-parse", "--git-path", name]);
      if (fs.existsSync(path.resolve(env.vaultDir, location))) throw Error("Git has interrupted work or an external lock");
    }
    // Read-only remote observation. Remote writers are external; ordinary
    // non-force reconciliation still handles changes after this observation.
    const observed = await runGit(["ls-remote", "--exit-code", "origin", `refs/heads/${cfg.branch}`], { authenticated: true, timeoutMs: 5_000 });
    if (!observed.ok) {
      this.state = looksLikeAuthFailure(observed.combined) ? "needs-reauth" : "backoff";
      throw Error("Cannot verify Git remote HEAD; no edit applied");
    }
    const head = await check(["rev-parse", "HEAD"]);
    if (observed.stdout.trim() !== `${head}\trefs/heads/${cfg.branch}` ||
        await check(["rev-parse", `refs/remotes/origin/${cfg.branch}`]) !== head)
      throw Error("Git remote divergence requires a successful sync before editing");
  }
  private pending: { tool: string; path: string }[] = [];
  private counts = { downloaded: 0, uploaded: 0, deleted: 0, startedAt: null as number | null, lastEventAt: null as number | null };

  private log(line: string, level?: "error" | "warn") {
    this.ring.push(line, level);
    this.lastActivityAt = Date.now();
  }

  getLogs(): LogLine[] {
    return this.ring.all();
  }

  note(line: string, level?: "error" | "warn") {
    this.ring.push(line, level);
  }

  start() {
    if (this.editPaused) throw Error("Git is paused for Safe Edit");
    if (this.pullTimer || this.inFlight || this.state === "needs-reauth") return;
    this.stopping = false;
    this.generation++;
    const cfg = gitConfig();
    if (!cfg) {
      this.log("[git] no remote configured", "error");
      return;
    }
    this.state = "running";
    this.startedAt = Date.now();
    this.log(`[git] watching ${redactRemote(cfg.remote)} (${cfg.branch})`);
    if (remoteHasCredentials(cfg.remote)) {
      // Stored under a version that accepted it. Git still uses it, so sync
      // works; but it sits in plaintext settings, so say so where the operator
      // is looking, and every time, until it is moved.
      this.log(
        "[git] the remote URL carries credentials. Re-run the git step in Setup with the URL alone " +
          "and the token in its own field, where it is stored encrypted.",
        "warn",
      );
    }
    // Commit times first, so the index a boot rebuilds carries them; then pull
    // promptly so the model isn't reading a stale vault, then on the
    // configured interval.
    // Startup history loading is part of the tracked cycle, too.
    void this.cycle("startup");
    this.armPoll();
  }

  stop() {
    this.stopping = true;
    this.generation++;
    this.clearTimers();
    this.state = "stopped";
    this.log("[git] stopped");
  }

  resetAndStart() {
    if (this.editPaused || this.inFlight) throw Error("Git work must drain before restart");
    this.restartCount = 0;
    if (this.state === "needs-reauth" || this.state === "backoff") this.state = "stopped";
    this.stop();
    this.start();
  }

  // Debounce, with a ceiling: a chatty agent writing continuously would
  // otherwise keep resetting the timer and never publish anything.
  notifyLocalChange(change: { tool: string; path: string }) {
    if (this.pending.length < 200) this.pending.push(change);
    if (this.editPaused || this.stopping || this.state === "needs-reauth") return;
    const generation = this.generation;
    const now = Date.now();
    const maxWait = Math.max(MIN_MAX_WAIT_MS, debounceMs() * 6);
    if (this.pushDeadline === null) this.pushDeadline = now + maxWait;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    const delay = Math.min(debounceMs(), Math.max(0, this.pushDeadline - now));
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushDeadline = null;
      if (generation === this.generation) void this.cycle("write");
    }, delay);
  }

  async syncNow(): Promise<{ ok: boolean; output: string }> {
    if (this.editPaused || this.inFlight || this.state === "needs-reauth")
      return { ok: false, output: "Git is busy, paused or requires re-authentication" };
    const before = this.ring.all().length;
    const ok = await this.cycle("manual");
    const lines = this.ring
      .all()
      .slice(before)
      .map((l) => l.line)
      .slice(-5)
      .join("\n");
    return { ok, output: lines };
  }

  status(): SyncStatus {
    const a = this.counts;
    return {
      kind: this.kind,
      state: this.state,
      stateSince: this.stateSince,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      restartCount: this.restartCount,
      activity: { ...a, active: this.busy },
      conflicts: this.conflicts.length ? [...this.conflicts] : undefined,
    };
  }

  // One full reconcile: publish local work, take remote work, push.
  // Serialized — overlapping cycles would race on the index and the ref.
  private cycle(reason: string): Promise<boolean> {
    if (this.editPaused || this.state === "needs-reauth" || (this.stopping && reason !== "manual")) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    const cfg = gitConfig();
    if (!cfg) return Promise.resolve(false);
    this.busy = true;
    const work = this.reconcile(reason, cfg);
    this.inFlight = work;
    void work.then(() => { if (this.inFlight === work) this.inFlight = null; }, () => { if (this.inFlight === work) this.inFlight = null; });
    return work;
  }

  private async reconcile(reason: string, cfg: GitConfig): Promise<boolean> {
    let release: (() => void) | undefined;
    try {
      release = acquireGitMutationLock();
      if (this.interruptedEdit()) throw Error("Interrupted Safe Edit requires recovery before Git sync");
      if (reason === "startup") await this.refreshTimes();
      const committed = await this.commitPending(cfg);
      const fetched = await this.fetch(cfg);
      if (!fetched) return false;
      const integrated = await this.integrate(cfg);
      if (!integrated) return false;
      if (committed || (await this.aheadOfRemote(cfg))) {
        return await this.push(cfg);
      }
      return true;
    } catch (e: any) {
      this.log(`[git] ${reason} cycle failed: ${String(e?.message ?? e)}`, "error");
      if (!this.stopping) this.state = "backoff";
      return false;
    } finally {
      try { release?.(); } finally { this.busy = false; }
      if (this.stopping) this.state = "stopped";
    }
  }

  private async commitPending(cfg: GitConfig): Promise<boolean> {
    const st = await runGit(["status", "--porcelain"]);
    if (!st.ok) {
      this.log(`[git] status failed: ${st.combined.trim()}`, "error");
      return false;
    }
    if (!st.stdout.trim()) {
      this.pending = [];
      return false;
    }
    const changed = st.stdout.trim().split("\n").length;
    await runGit(["add", "-A"]);
    const message = this.commitMessage(changed);
    // Identity is set per-invocation rather than in .git/config so `git log
    // --author=notemesh` cleanly separates assistant edits from the operator's.
    const res = await runGit([
      "-c",
      "user.name=notemesh",
      "-c",
      "user.email=notemesh@localhost",
      "commit",
      "-m",
      message,
    ]);
    this.pending = [];
    if (!res.ok) {
      this.log(`[git] commit failed: ${res.combined.trim()}`, "error");
      return false;
    }
    this.counts.uploaded += changed;
    this.counts.lastEventAt = Date.now();
    this.log(`[git] committed ${changed} file${changed === 1 ? "" : "s"}`);
    void cfg;
    return true;
  }

  private commitMessage(changed: number): string {
    const tools = [...new Set(this.pending.map((p) => p.tool))];
    const paths = [...new Set(this.pending.map((p) => p.path))];
    if (!tools.length) return `notemesh: ${changed} file${changed === 1 ? "" : "s"} changed`;
    const head = `notemesh: ${tools.join(", ")}`;
    const shown = paths.slice(0, 10).join("\n");
    const more = paths.length > 10 ? `\n…and ${paths.length - 10} more` : "";
    return `${head}\n\n${shown}${more}`;
  }

  private async fetch(cfg: GitConfig): Promise<boolean> {
    const res = await runGit(["fetch", "--prune", "origin", cfg.branch], { authenticated: true });
    if (res.ok) {
      if (this.state === "backoff" || this.state === "needs-reauth") this.state = "running";
      return true;
    }
    if (looksLikeAuthFailure(res.combined)) {
      this.state = "needs-reauth";
      this.log(`[git] authentication rejected — check the access token`, "error");
    } else {
      this.state = "backoff";
      this.restartCount += 1;
      this.log(`[git] fetch failed: ${res.combined.trim()}`, "error");
    }
    return false;
  }

  private async aheadOfRemote(cfg: GitConfig): Promise<boolean> {
    const res = await runGit(["rev-list", "--count", `origin/${cfg.branch}..HEAD`]);
    return res.ok && Number(res.stdout.trim()) > 0;
  }

  // Bring remote work in. Never runs a bare `git merge` without checking first:
  // merge-tree does the merge in the object database, so a conflict is detected
  // with the working tree — and therefore the vault the model reads — untouched.
  private async integrate(cfg: GitConfig): Promise<boolean> {
    const remote = `origin/${cfg.branch}`;
    const behind = await runGit(["rev-list", "--count", `HEAD..${remote}`]);
    if (!behind.ok || Number(behind.stdout.trim()) === 0) return true;

    const probe = await probeMerge(env.vaultDir, "HEAD", remote);
    if (probe.clean) {
      const merged = await runGit([
        "-c",
        "user.name=notemesh",
        "-c",
        "user.email=notemesh@localhost",
        "merge",
        "--no-edit",
        remote,
      ]);
      if (!merged.ok) {
        // Should not happen after a clean probe; abort rather than leave the
        // vault mid-merge with markers on disk.
        await runGit(["merge", "--abort"]);
        this.log(`[git] merge failed after a clean probe; aborted`, "error");
        this.state = "backoff";
        return false;
      }
      const n = Number(behind.stdout.trim());
      this.counts.downloaded += n;
      this.counts.lastEventAt = Date.now();
      this.log(`[git] merged ${n} remote commit${n === 1 ? "" : "s"}`);
      await this.refreshTimes();
      return true;
    }

    const outcome = await resolveConflict({
      dir: env.vaultDir,
      remoteRef: remote,
      paths: probe.paths,
    });
    if (!outcome.ok) {
      this.log(`[git] ${outcome.message}`, "error");
      this.state = "backoff";
      return false;
    }
    // Recorded, bounded, and not a state. The copy is written and about to be
    // pushed; the user picks it up in Obsidian. The state stays whatever the
    // cycle makes it — running, once the push lands.
    this.conflicts.push({ at: Date.now(), paths: outcome.paths, copies: outcome.copies });
    // The one-shot notice to connectors. A conflict is found here, on a timer,
    // never inside a tool call, so it rides the next call from each connector.
    outcome.paths.forEach((p, i) => postNotice(conflictNotice(p, outcome.copies?.[i] ?? null)));
    if (this.conflicts.length > MAX_RECENT_CONFLICTS) {
      this.conflicts.splice(0, this.conflicts.length - MAX_RECENT_CONFLICTS);
    }
    this.log(`[git] ${outcome.message}`, "warn");
    await this.refreshTimes();
    return true;
  }

  // The pulled files now carry the pull as their mtime; git knows better. A
  // failure here is a degraded listing, not a sync problem, so it is logged
  // and the cycle carries on.
  private async refreshTimes() {
    const n = await refreshGitTimes(env.vaultDir);
    if (n === null) this.log("[git] could not read commit times; listings show file mtimes", "warn");
  }

  private async push(cfg: GitConfig): Promise<boolean> {
    const res = await runGit(["push", "origin", `HEAD:${cfg.branch}`], { authenticated: true });
    if (res.ok) {
      this.state = "running";
      this.log(`[git] pushed to ${cfg.branch}`);
      return true;
    }
    if (looksLikeAuthFailure(res.combined)) {
      this.state = "needs-reauth";
      this.log(`[git] push rejected: authentication failed`, "error");
      return false;
    }
    // Remote moved between fetch and push. Nothing is damaged — the next cycle
    // fetches and integrates properly.
    this.log(`[git] push rejected, will retry: ${res.combined.trim()}`, "warn");
    return false;
  }
}

const globalKey = "__obSyncGitBackend";

export function gitBackend(): GitBackend {
  const g = globalThis as any;
  if (!g[globalKey]) g[globalKey] = new GitBackend();
  const inst = g[globalKey] as GitBackend;
  // Dev HMR keeps the instance but reloads the module — rebind so new methods
  // exist on the old object.
  if (Object.getPrototypeOf(inst) !== GitBackend.prototype) {
    Object.setPrototypeOf(inst, GitBackend.prototype);
  }
  return inst;
}

// --- setup helpers -------------------------------------------------------

// Validate the remote and credentials before doing anything destructive.
// ls-remote is cheap and exercises URL, auth, and repo existence in one go, so
// the wizard can report a precise error instead of a half-finished clone.
export async function probeRemote(
  remote: string,
  branch: string,
): Promise<{ ok: boolean; message?: string; branchExists?: boolean; empty?: boolean }> {
  const version = await gitVersionOk();
  if (!version.ok) {
    return {
      ok: false,
      message: `git ${version.version} is too old; 2.38+ is required for safe conflict detection.`,
    };
  }
  const res = await runGit(["ls-remote", "--heads", "--", remote], {
    cwd: env.dataDir,
    authenticated: true,
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    if (looksLikeAuthFailure(res.combined)) {
      return { ok: false, message: "Authentication failed — check the username and token." };
    }
    return { ok: false, message: res.combined.trim().split("\n").slice(-3).join("\n") };
  }
  const heads = res.stdout.trim();
  if (!heads) return { ok: true, empty: true, branchExists: false };
  const branchExists = heads.split("\n").some((l) => l.endsWith(`refs/heads/${branch}`));
  return { ok: true, branchExists, empty: false };
}

// Clone the vault. Refuses to touch a non-empty directory: switching an
// existing instance between backends would mean deleting a vault copy, and
// that is not a decision to make silently.
export async function cloneVault(
  remote: string,
  branch: string,
): Promise<{ ok: boolean; message?: string }> {
  const release = acquireGitMutationLock();
  try { return await cloneVaultLocked(remote, branch); }
  finally { release(); }
}

async function cloneVaultLocked(remote: string, branch: string): Promise<{ ok: boolean; message?: string }> {
  const dir = env.vaultDir;
  if (isGitRepo(dir)) {
    const cur = await runGit(["remote", "get-url", "origin"]);
    if (cur.ok && cur.stdout.trim() === remote) return { ok: true };
    return { ok: false, message: "The vault directory is already a git repo for a different remote." };
  }
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // created below by clone
  }
  if (entries.length) {
    return {
      ok: false,
      message:
        "The vault directory already has files in it (from a previous setup). " +
        "Reset the volume, or redeploy with an empty one, before linking a git repo.",
    };
  }

  const res = await runGit(["clone", "--", remote, dir], {
    cwd: env.dataDir,
    authenticated: true,
    timeoutMs: 900_000, // a large vault over LFS can take a while
  });
  if (!res.ok) {
    return { ok: false, message: res.combined.trim().split("\n").slice(-3).join("\n") };
  }

  // Land on the requested branch whether it already exists, or the repo is
  // empty and this is the first commit that will create it.
  const cur = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!cur.ok || cur.stdout.trim() !== branch) {
    const exists = await runGit(["rev-parse", "--verify", `origin/${branch}`]);
    const co = exists.ok
      ? await runGit(["checkout", branch])
      : await runGit(["checkout", "-B", branch]);
    if (!co.ok) return { ok: false, message: co.combined.trim() };
  }
  return { ok: true };
}

// Repo name, for display where the Obsidian backend shows a vault name.
export function repoDisplayName(remote: string): string {
  const trimmed = remote.replace(/\.git$/, "").replace(/\/+$/, "");
  const parts = trimmed.split(/[/:]/).filter(Boolean);
  return parts.slice(-2).join("/") || trimmed;
}

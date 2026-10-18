import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cloneVault,
  gitBackend,
  gitVersionOk,
  isGitRepo,
  looksLikeAuthFailure,
  probeRemote,
  repoDisplayName,
} from "./git";
import { runGit, runGitBuffer } from "./git-exec";

// The sync plumbing either side of conflict resolution: proving the remote is
// reachable before anything destructive happens, cloning, and classifying
// failures so a bad token surfaces as "fix your token" rather than a retry loop.

let root: string;
let remote: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).toString();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-git-"));
  remote = path.join(root, "remote.git");
  git(root, "init", "-q", "--bare", "-b", "main", "remote.git");
  // DATA_DIR drives env.vaultDir, which is where cloneVault writes.
  process.env.DATA_DIR = path.join(root, "data");
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function seedRemote(branch = "main") {
  const seed = path.join(root, "seed");
  git(root, "clone", "-q", remote, "seed");
  fs.writeFileSync(path.join(seed, "Note.md"), "# Note\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "seed");
  git(seed, "branch", "-M", branch);
  git(seed, "push", "-q", "-u", "origin", branch);
}

describe("gitVersionOk", () => {
  it("finds a git new enough for safe conflict detection", async () => {
    // merge-tree --write-tree needs 2.38+; everything below depends on it.
    const v = await gitVersionOk();
    expect(v.ok, `git ${v.version} is too old for these tests`).toBe(true);
  });
});

describe("probeRemote", () => {
  it("accepts a reachable repository and reports the branch exists", async () => {
    seedRemote();
    const res = await probeRemote(remote, "main");
    expect(res.ok).toBe(true);
    expect(res.branchExists).toBe(true);
    expect(res.empty).toBe(false);
  });

  it("reports a branch that isn't there without failing outright", async () => {
    seedRemote();
    const res = await probeRemote(remote, "nonexistent");
    expect(res.ok).toBe(true);
    expect(res.branchExists).toBe(false);
  });

  it("recognises an empty repository as usable", async () => {
    // Starting a fresh vault from an empty repo is a legitimate flow.
    const res = await probeRemote(remote, "main");
    expect(res.ok).toBe(true);
    expect(res.empty).toBe(true);
  });

  it("fails on a remote that does not exist", async () => {
    const res = await probeRemote(path.join(root, "nope.git"), "main");
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it("does not create anything when the probe fails", async () => {
    await probeRemote(path.join(root, "nope.git"), "main");
    expect(fs.existsSync(path.join(root, "data", "vault"))).toBe(false);
  });
});

describe("cloneVault", () => {
  it("clones into the vault directory and lands on the requested branch", async () => {
    seedRemote();
    const res = await cloneVault(remote, "main");
    expect(res.ok).toBe(true);
    const vault = path.join(root, "data", "vault");
    expect(fs.readFileSync(path.join(vault, "Note.md"), "utf8")).toBe("# Note\n");
    expect(git(vault, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });

  it("clones a repo whose default branch differs from the one requested", async () => {
    seedRemote("trunk");
    const res = await cloneVault(remote, "trunk");
    expect(res.ok).toBe(true);
    expect(git(path.join(root, "data", "vault"), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(
      "trunk",
    );
  });

  it("clones an empty repo and prepares the branch for the first commit", async () => {
    const res = await cloneVault(remote, "main");
    expect(res.ok).toBe(true);
    expect(isGitRepo(path.join(root, "data", "vault"))).toBe(true);
  });

  it("refuses a vault directory that already has files in it", async () => {
    // Switching backends would otherwise mean silently deleting a vault copy.
    seedRemote();
    const vault = path.join(root, "data", "vault");
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "Existing.md"), "keep me");
    const res = await cloneVault(remote, "main");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/already has files/i);
    // And it really did leave the file alone.
    expect(fs.readFileSync(path.join(vault, "Existing.md"), "utf8")).toBe("keep me");
  });

  it("is idempotent when the vault is already a clone of the same remote", async () => {
    seedRemote();
    expect((await cloneVault(remote, "main")).ok).toBe(true);
    expect((await cloneVault(remote, "main")).ok).toBe(true);
  });

  it("refuses when the vault is a clone of a different remote", async () => {
    seedRemote();
    await cloneVault(remote, "main");
    const other = path.join(root, "other.git");
    git(root, "init", "-q", "--bare", "-b", "main", "other.git");
    const res = await cloneVault(other, "main");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/different remote/i);
  });
});

describe("looksLikeAuthFailure", () => {
  // Misclassifying here has real consequences: a genuine auth problem retried
  // forever never tells the operator to fix their token, and a transient
  // network blip latched as needs-reauth stops syncing until someone notices.
  it.each([
    "remote: Invalid username or password.",
    "fatal: Authentication failed for 'https://github.com/x/y.git/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "The requested URL returned error: 403 Forbidden",
    "The requested URL returned error: 401 Unauthorized",
    "git@github.com: Permission denied (publickey).",
    "remote: Repository not found.",
  ])("classifies %s as an auth failure", (text) => {
    expect(looksLikeAuthFailure(text)).toBe(true);
  });

  it.each([
    "fatal: unable to access 'https://example.com/': Could not resolve host: example.com",
    "error: failed to push some refs to 'origin'",
    "fatal: the remote end hung up unexpectedly",
    "Auto-merging Note.md",
    "",
  ])("does not classify %s as an auth failure", (text) => {
    expect(looksLikeAuthFailure(text)).toBe(false);
  });
});

describe("repoDisplayName", () => {
  it("shows owner/repo for a GitHub URL", () => {
    expect(repoDisplayName("https://github.com/someone/my-vault.git")).toBe("someone/my-vault");
  });

  it("drops a trailing slash", () => {
    expect(repoDisplayName("https://gitlab.com/someone/my-vault/")).toBe("someone/my-vault");
  });

  it("handles a self-hosted path", () => {
    expect(repoDisplayName("https://git.example.com/team/notes.git")).toBe("team/notes");
  });
});

describe("runGit", () => {
  it("reports failure rather than throwing", async () => {
    const res = await runGit(["rev-parse", "--verify", "nope"], { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.code).not.toBe(0);
  });

  it("never waits on an interactive credential prompt", async () => {
    // GIT_TERMINAL_PROMPT=0 — without it a daemon hangs forever instead of
    // failing, which is far worse than a clear error.
    // An executable shim checks the real child's environment without relying
    // on DNS/proxy timeout behavior in the host running the test.
    const bin=path.join(root,"git-shim");fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin,"git"),'#!/bin/sh\nif [ "$GIT_TERMINAL_PROMPT" = "0" ] && [ -z "$GIT_ASKPASS" ]; then exit 19; fi\nexit 0\n',{mode:0o755});
    vi.stubEnv("PATH",`${bin}:${process.env.PATH??""}`);
    try {
      const res=await runGit(["ls-remote","https://example.invalid/nope.git"],{cwd:root,authenticated:true,timeoutMs:1000});
      expect(res.ok).toBe(false);expect(res.code).toBe(19);
    } finally {vi.unstubAllEnvs();}
  });
});

describe("runGitBuffer", () => {
  it("returns bytes unmangled, which text mode would corrupt", async () => {
    seedRemote();
    await cloneVault(remote, "main");
    const vault = path.join(root, "data", "vault");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    fs.writeFileSync(path.join(vault, "image.png"), bytes);
    git(vault, "add", "-A");
    git(vault, "commit", "-m", "image");

    const res = await runGitBuffer(["show", "HEAD:image.png"], { cwd: vault });
    expect(res.ok).toBe(true);
    expect(res.stdout).toEqual(bytes);
  });

  it("reports failure with an empty buffer", async () => {
    const res = await runGitBuffer(["show", "HEAD:nope"], { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.stdout.length).toBe(0);
  });
});

describe("DR Phase 2.4 — Git sync writer admission", () => {
  it("absorbs freeze refusal during startup Git metadata refresh and continues startup", async () => {
    const { setSetting } = await import("../db");
    setSetting("git_remote", remote);
    const backend = gitBackend();
    const refresh = vi.spyOn(backend as any, "refreshTimes")
      .mockRejectedValueOnce(new Error("backup_writer_freeze_active"));
    const cycle = vi.spyOn(backend as any, "cycle").mockResolvedValue(true);
    try {
      backend.start();
      await vi.waitFor(() => expect(cycle).toHaveBeenCalledWith("startup"), { timeout: 1000 });
      expect(backend.getLogs().some(l => l.line.includes("metadata refresh deferred"))).toBe(true);
    } finally {
      backend.stop();
      refresh.mockRestore();
      cycle.mockRestore();
    }
  });

  it("refuses setup clone during freeze without initializing a working tree", async () => {
    seedRemote();
    const { inProcessDrWriterFence: fence } = await import("../backup/writer-fence");
    const dir = path.join(root, "data", "vault");
    await fence.withFrozenWriters(async () => {
      await expect(cloneVault(remote, "main")).rejects.toThrow("backup_writer_freeze_active");
      expect(fs.existsSync(dir)).toBe(false);
    });
    expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
    expect((await cloneVault(remote, "main")).ok).toBe(true);
  });

  it("skips a frozen Git reconcile without latching a healthy backend into backoff", async () => {
    const { inProcessDrWriterFence: fence } = await import("../backup/writer-fence");
    const backend = gitBackend();
    const before = backend.status().state;
    await fence.withFrozenWriters(async () => {
      const response = await backend.syncNow();
      expect(response.ok).toBe(false);
      expect(response.output).toContain("DR writer freeze active");
      expect(backend.status().state).toBe(before);
      expect(backend.status().activity.active).toBe(false);
    });
    expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
  });
});

describe("DR Phase 2.8 — direct Git execution freeze", () => {
  it("refuses both text and binary Git entry points before spawning while frozen", async () => {
    const { inProcessDrWriterFence: fence } = await import("../backup/writer-fence");
    const cwd = path.join(root, "nonexistent-working-tree");
    await fence.withFrozenWriters(async () => {
      await expect(runGit(["init"], { cwd })).rejects.toThrow("backup_writer_freeze_active");
      await expect(runGitBuffer(["show", "HEAD:note.md"], { cwd }))
        .rejects.toThrow("backup_writer_freeze_active");
      expect(fs.existsSync(cwd)).toBe(false);
      expect(fence.status.activeWriters).toBe(0);
    });
    expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
  });

  it("holds a direct Git process ticket until the child exits before snapshot", async () => {
    const { inProcessDrWriterFence: fence } = await import("../backup/writer-fence");
    const bin = path.join(root, "dr-git-shim");
    fs.mkdirSync(bin);
    const started = path.join(root, "dr-git-started");
    const release = path.join(root, "dr-git-release");
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh
echo started > "${started}"
while [ ! -f "${release}" ]; do sleep 0.05; done
exit 0
`, { mode: 0o755 });
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    try {
      const active = runGit(["status"], { cwd: root, timeoutMs: 5000 });
      await vi.waitFor(() => expect(fs.existsSync(started)).toBe(true), { timeout: 3000 });
      expect(fence.status.activeWriters).toBeGreaterThanOrEqual(1);
      let captured = false;
      const cut = fence.withFrozenWriters(() => { captured = true; return "snapshot"; },
        { drainTimeoutMs: 4000 });
      expect(captured).toBe(false);
      await expect(runGit(["status"], { cwd: root })).rejects
        .toThrow("backup_writer_freeze_active");
      fs.writeFileSync(release, "go");
      expect((await active).ok).toBe(true);
      await expect(cut).resolves.toBe("snapshot");
      expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
    } finally { vi.unstubAllEnvs(); }
  });
});

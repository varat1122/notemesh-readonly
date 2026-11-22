import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// The runtime image runs `git lfs install --system`, so every Git merge probe
// saw lfs filter keys and HOLDed (21 normal-path failures on an LFS host).
// Only the exact standard lfs values pass, and only while merge-tree does not
// renormalize; every other external filter/driver remains a HOLD.

let root: string;
let repo: string;
let system: string;
const globals = ["notemesh.maintenance.registry.v1", "notemesh.d1.native-interlock.v1", "notemesh.d1.database-owners.v1"];

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: system } }).trim();
}

beforeEach(() => {
  for (const name of globals) delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)];
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "git-merge-lfs-")));
  repo = path.join(root, "repo"); system = path.join(root, "system.gitconfig");
  fs.mkdirSync(repo); fs.writeFileSync(system, "");
  git("init", "-q", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.org");
  fs.writeFileSync(path.join(repo, "note.md"), "# Note\n\nbase\n"); git("add", "-A"); git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "device"); fs.writeFileSync(path.join(repo, "note.md"), "# Note\n\nDEVICE\n"); git("commit", "-qam", "device");
  git("checkout", "-q", "main"); fs.writeFileSync(path.join(repo, "note.md"), "# Note\n\nASSISTANT\n"); git("commit", "-qam", "assistant");
  vi.stubEnv("DATA_DIR", root); vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null"); vi.stubEnv("GIT_CONFIG_SYSTEM", system); vi.stubEnv("GIT_CONFIG_NOSYSTEM", "");
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

const probe = ["merge-tree", "--write-tree", "--name-only", "main", "device"];
const lfs = (smudge: string, process: string) =>
  `[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = ${smudge}\n\tprocess = ${process}\n\trequired = true\n`;

it.each([
  ["standard install", lfs("git-lfs smudge -- %f", "git-lfs filter-process")],
  ["--skip-smudge install", lfs("git-lfs smudge --skip -- %f", "git-lfs filter-process --skip")],
])("a %s lfs system config keeps the normal conflict outcome without quarantine", async (_, config) => {
  fs.writeFileSync(system, config);
  const { runGit } = await import("./git-exec");
  const result = await runGit(probe, { cwd: repo });
  expect(result).toMatchObject({ ok: false, code: 1, outcome: "merge_conflict_observed" });
  expect(result.stdout.split("\n\n")[0].split("\n").slice(1)).toEqual(["note.md"]);
  const { maintenanceActive } = await import("../maintenance");
  expect(maintenanceActive()).toBe(false);
  expect(fs.existsSync(path.join(root, "maintenance.json"))).toBe(false);
});

it.each([
  ["a non-standard lfs value", lfs("sh -c 'touch smudged' -- %f", "git-lfs filter-process")],
  ["another filter driver", `[filter "custom"]\n\tclean = cat\n`],
  ["lfs with renormalize", lfs("git-lfs smudge -- %f", "git-lfs filter-process") + "[merge]\n\trenormalize = true\n"],
  ["a merge driver", `[merge "custom"]\n\tdriver = true\n`],
])("%s still holds before any merge-tree launch", async (_, config) => {
  fs.writeFileSync(system, config);
  const head = git("rev-parse", "HEAD"), before = fs.readFileSync(path.join(repo, "note.md"), "utf8");
  const { runGit } = await import("./git-exec");
  const result = await runGit(probe, { cwd: repo });
  expect(result.ok).toBe(false);
  expect(result.stderr).toContain("git_merge_probe_external_driver_hold");
  expect(result.outcome).toBe("not_launched");
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(fs.readFileSync(path.join(repo, "note.md"), "utf8")).toBe(before);
  expect(fs.existsSync(path.join(repo, "smudged"))).toBe(false);
});

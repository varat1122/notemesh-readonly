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

// P1 safety controls. A standard string is not proof that no executable runs, so
// the probe is also checked against LFS-tracked attributes with an observable
// git-lfs, and every other configuration source git merges into the same list.
const conflictOutcome = async (cwd: string) => {
  const { runGit } = await import("./git-exec");
  const result = await runGit(probe, { cwd });
  expect(result).toMatchObject({ ok: false, code: 1, outcome: "merge_conflict_observed" });
  expect(result.stdout.split("\n\n")[0].split("\n").slice(1)).toEqual(["note.md"]);
  const { maintenanceActive } = await import("../maintenance");
  expect(maintenanceActive()).toBe(false);
};

it("an explicit merge.renormalize=false keeps the standard lfs exception", async () => {
  fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process") + "[merge]\n\trenormalize = false\n");
  await conflictOutcome(repo);
});

it("with lfs-tracked attributes and an observable git-lfs, merge-tree never launches a filter child", async () => {
  const bin = path.join(root, "bin"), marker = path.join(root, "git-lfs-invocations"), tracked = path.join(root, "tracked");
  fs.mkdirSync(bin); fs.mkdirSync(tracked);
  fs.writeFileSync(path.join(bin, "git-lfs"), `#!/bin/sh\necho "$*" >> '${marker}'\nexec cat\n`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  const run = (...args: string[]) => execFileSync("git", args, { cwd: tracked, encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: system } }).trim();
  const lines = (a: string, b: string) => `# Note\n\n${a}\nkeep 1\nkeep 2\nkeep 3\nkeep 4\n${b}\n`;
  run("init", "-q", "-b", "main"); run("config", "user.name", "Fixture"); run("config", "user.email", "fixture@example.org");
  fs.writeFileSync(path.join(tracked, ".gitattributes"), "*.md filter=lfs diff=lfs merge=lfs -text\n");
  fs.writeFileSync(path.join(tracked, "note.md"), lines("base", "base")); run("add", "-A"); run("commit", "-qm", "base");
  run("checkout", "-q", "-b", "device"); fs.writeFileSync(path.join(tracked, "note.md"), lines("DEVICE", "base")); run("commit", "-qam", "device");
  run("checkout", "-q", "-b", "nearby", "main"); fs.writeFileSync(path.join(tracked, "note.md"), lines("base", "NEARBY")); run("commit", "-qam", "nearby");
  run("checkout", "-q", "main"); fs.writeFileSync(path.join(tracked, "note.md"), lines("ASSISTANT", "base")); run("commit", "-qam", "assistant");
  expect(run("check-attr", "filter", "note.md")).toBe("note.md: filter: lfs");
  // Control: the configured command resolves to the observable git-lfs, so a
  // filter launch would be recorded.
  fs.writeFileSync(system, `[filter "lfs"]\n\tclean = git-lfs clean -- %f\n`);
  run("hash-object", "--path=note.md", "note.md");
  expect(fs.readFileSync(marker, "utf8")).toContain("clean -- note.md");
  fs.rmSync(marker);

  // Snapshots are taken without filters (status itself would run them).
  fs.writeFileSync(system, "");
  const head = run("rev-parse", "HEAD"), status = run("status", "--porcelain");
  fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process"));
  await conflictOutcome(tracked);
  const { runGit } = await import("./git-exec");
  const clean = await runGit(["merge-tree", "--write-tree", "--name-only", "main", "nearby"], { cwd: tracked });
  expect(clean).toMatchObject({ ok: true, code: 0 });
  expect(clean.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
  expect(fs.existsSync(marker)).toBe(false);
  fs.writeFileSync(system, "");
  expect(run("rev-parse", "HEAD")).toBe(head);
  expect(run("status", "--porcelain")).toBe(status);
});

it.each([
  ["a differently-cased filter subsection with standard values",
    () => fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process").replace('"lfs"', '"LFS"'))],
  ["a non-standard duplicate in the repository config", () => {
    fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process"));
    git("config", "--add", "filter.lfs.smudge", "sh -c 'touch smudged' -- %f");
  }],
  ["a non-standard value in the global config", () => {
    fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process"));
    const global = path.join(root, "global.gitconfig");
    fs.writeFileSync(global, `[filter "lfs"]\n\tprocess = sh -c 'touch smudged'\n`); vi.stubEnv("GIT_CONFIG_GLOBAL", global);
  }],
  ["a non-standard value reached through include.path", () => {
    const included = path.join(root, "included.gitconfig");
    fs.writeFileSync(included, `[filter "lfs"]\n\tclean = sh -c 'touch smudged' -- %f\n`);
    fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process") + `[include]\n\tpath = ${included}\n`);
  }],
  ["renormalize inherited from command-line configuration in the environment", () => {
    fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process"));
    vi.stubEnv("GIT_CONFIG_COUNT", "1"); vi.stubEnv("GIT_CONFIG_KEY_0", "merge.renormalize"); vi.stubEnv("GIT_CONFIG_VALUE_0", "true");
  }],
  ["a valueless (implicitly true) merge.renormalize",
    () => fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process") + "[merge]\n\trenormalize\n")],
  ["a valueless lfs filter command", () => fs.writeFileSync(system, `[filter "lfs"]\n\tclean\n`)],
  ["a promisor remote", () => fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process") + `[remote "origin"]\n\tpromisor = true\n`)],
  ["a partial clone extension", () => fs.writeFileSync(system, lfs("git-lfs smudge -- %f", "git-lfs filter-process") + "[extensions]\n\tpartialClone = origin\n")],
])("%s still holds before any merge-tree launch", async (_, setup) => {
  setup();
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

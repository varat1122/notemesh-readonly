import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

// The release workflow holds package, release and signing permissions and
// Docker Hub credentials, so what it runs must not be able to change under
// it. A tag can be moved; a commit cannot.

const dir = ".github/workflows";
const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml")).map((f) => path.join(dir, f));

describe("the workflows", () => {
  it("pin every action to a commit SHA, with the version it was beside it", () => {
    for (const wf of workflows) {
      const uses = [...readFileSync(wf, "utf8").matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
      expect(uses.length, `${wf} uses actions`).toBeGreaterThan(0);
      for (const [, ref, rest] of uses) {
        expect(ref, `${wf}: ${ref}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
        expect(rest.trim(), `${wf}: ${ref} names its version`).toMatch(/^# v\d+\.\d+\.\d+$/);
      }
    }
  });

  it("fail CI on a high or critical production advisory, with a reviewed exception list", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toMatch(/pnpm audit --prod --audit-level=high\s*$/m);
    expect(ci).not.toMatch(/pnpm audit[^\n]*\|\| true/);
    // pnpm 11's bulk endpoint reports GHSA IDs; ignoreCves is no longer read.
    const workspace = parse(readFileSync("pnpm-workspace.yaml", "utf8"));
    // node-forge's high advisories are fixed by a pinned patched dependency,
    // not permanently hidden behind an audit exception.
    expect(workspace.audit.ignore).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
    expect(workspace.audit.ignore).not.toContain("GHSA-86w9-cpqp-85rv");
    expect(workspace.overrides["node-forge"]).toBe("1.4.2");
    const lock = readFileSync("pnpm-lock.yaml", "utf8");
    expect(lock).toContain("node-forge@1.4.2:");
    expect(lock).not.toContain("node-forge@1.4.0:");
    expect(ci).not.toMatch(/--ignore-unfixable|--ignore-registry-errors/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toContain("node scripts/check-runtime-exclusions.mjs");
    expect(readFileSync("Dockerfile", "utf8")).toContain("RUN node /app/check-runtime-exclusions.mjs .output /usr/local/lib/node_modules");
  });

  it("have Dependabot moving the pins", () => {
    expect(readFileSync(".github/dependabot.yml", "utf8")).toMatch(/package-ecosystem: github-actions/);
  });
});

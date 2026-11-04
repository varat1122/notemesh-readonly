import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixtures: string[] = [];
afterEach(() => { for (const p of fixtures.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const run = (script: string, args: string[] = []) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
it("accepts the branch's root config and rejects a normal application Dockerfile", () => {
  expect(run("scripts/check-staging-control-config.mjs").status).toBe(0);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-build-")); fixtures.push(root);
  const file = path.join(root, "railway.json");
  fs.writeFileSync(file, JSON.stringify({ build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" } }));
  expect(run("scripts/check-staging-control-config.mjs", [file]).status).not.toBe(0);
});
it.each(["dockerfile", "startup", "predeploy", "override"])("rejects build selection regression: %s", field => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-build-")); fixtures.push(root);
  const config = JSON.parse(fs.readFileSync("railway.json", "utf8"));
  if (field === "dockerfile") config.build.dockerfilePath = "Dockerfile";
  if (field === "startup") config.deploy.startCommand = "node .output/server/index.mjs";
  if (field === "predeploy") config.deploy.preDeployCommand = [];
  if (field === "override") config.environments = { staging: { build: { dockerfilePath: "Dockerfile" } } };
  const file = path.join(root, "railway.json"); fs.writeFileSync(file, JSON.stringify(config));
  expect(run("scripts/check-staging-control-config.mjs", [file]).status).not.toBe(0);
});
it.each(["missing", "corrupt"])("pre-activation assertion rejects %s control bundle", condition => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ios-artifact-")); fixtures.push(root);
  fs.copyFileSync("scripts/verify-staging-control-artifact.mjs", path.join(root, "verify-artifact.mjs"));
  fs.writeFileSync(path.join(root, "identity.json"), JSON.stringify({
    foundation: "b0aeed37b910efbd3a96a52d41b885621e7f25d7", commit: "a".repeat(40), bundleSha256: "0".repeat(64),
  }));
  if (condition === "corrupt") fs.writeFileSync(path.join(root, "main.mjs"), "throw Error('must never execute')");
  const result = run(path.join(root, "verify-artifact.mjs"));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(condition === "missing" ? /ENOENT/ : /AssertionError/);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireGitMutationLock } from "./mutation-lock";

let root: string, lock: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "git-ownership-"));
  lock = path.join(root, "git-mutation.lock"); vi.stubEnv("DATA_DIR", root);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it("excludes a second owner and a stale release cannot remove a later owner's lock", () => {
  const first = acquireGitMutationLock(); expect(() => acquireGitMutationLock()).toThrow();
  first.assertOwned(); first();
  const second = acquireGitMutationLock();
  expect(() => first()).toThrow(/ownership/); second.assertOwned(); second();
  expect(fs.existsSync(lock)).toBe(false);
});
it.each(["replace-directory", "change-token", "symlink-token"])("fails closed on %s without deleting the lock", mode => {
  const lease = acquireGitMutationLock(), token = path.join(lock, "owner");
  if (mode === "replace-directory") { fs.renameSync(lock, `${lock}.old`); fs.mkdirSync(lock); }
  if (mode === "change-token") fs.writeFileSync(token, "foreign");
  if (mode === "symlink-token") { fs.renameSync(token, path.join(root, "owner-copy")); fs.symlinkSync(path.join(root, "owner-copy"), token); }
  expect(() => lease.assertOwned()).toThrow(/ownership/); expect(() => lease()).toThrow(/ownership/);
  expect(fs.existsSync(lock)).toBe(true);
});
it("never steals an old or ownerless lock", () => {
  fs.mkdirSync(lock); fs.utimesSync(lock, new Date(0), new Date(0));
  expect(() => acquireGitMutationLock()).toThrow(); expect(fs.existsSync(lock)).toBe(true);
});

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env";

export type GitMutationLock = (() => void) & { assertOwned(): void };

// Cooperating server processes share this non-expiring lock. A crash requires
// operator recovery, never stale-lock theft. Keep it outside the synced vault.
export function acquireGitMutationLock(): GitMutationLock {
  const lock = path.join(env.dataDir, "git-mutation.lock");
  fs.mkdirSync(lock, { mode: 0o700 });
  const identity = fs.lstatSync(lock);
  const ownerPath = path.join(lock, "owner");
  const owner = randomUUID();
  // Initialization failure also leaves a recovery lock, never an unlocked
  // writer. No TTL/PID test may authorize deleting another process's lease.
  const fd = fs.openSync(ownerPath, "wx", 0o600);
  try { fs.writeFileSync(fd, owner); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const assertOwned = () => {
    try {
      const current = fs.lstatSync(lock), token = fs.lstatSync(ownerPath);
      if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino ||
          !token.isFile() || fs.readFileSync(ownerPath, "utf8") !== owner) throw Error("replaced lock");
    } catch {
      throw Error("Git mutation lock ownership lost; administrator recovery required");
    }
  };
  return Object.assign(() => {
    assertOwned();
    fs.unlinkSync(ownerPath);
    fs.rmdirSync(lock);
  }, { assertOwned });
}

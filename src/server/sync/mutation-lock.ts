import fs from "node:fs";
import path from "node:path";
import { env } from "../env";

// Cooperating server processes share this non-expiring lock. A crash requires
// operator recovery, never stale-lock theft. Keep it outside the synced vault.
export function acquireGitMutationLock(): () => void {
  const lock = path.join(env.dataDir, "git-mutation.lock");
  fs.mkdirSync(lock, { mode: 0o700 });
  return () => fs.rmdirSync(lock);
}

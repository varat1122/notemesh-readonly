/**
 * OFFLINE FIXTURE orchestration proof, not a live backup entry point.
 *
 * Process-local fencing does not stop another replica, user device, CLI,
 * external Sync daemon or an unregistered database writer. The production
 * gate must remain CLOSED until each writer class and deployment scope has
 * independently verifiable coverage.
 */
import path from "node:path";
import { SnapshotWriterFence } from "./writer-fence";

type SyncPauser = {
  withPausedForEdit<T>(run: () => T | Promise<T>): Promise<T>;
};
type FixtureCutOptions<T> = {
  fence: SnapshotWriterFence;
  sync: SyncPauser;
  assertNoExternalWriters: () => Promise<boolean> | boolean;
  capture: () => Promise<T> | T;
  drainTimeoutMs?: number;
};

/** Never callable from Railway or a deployed DATA_DIR, including Staging. */
export function assertOfflineFixtureOnly(): void {
  if (process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_PROJECT_NAME || process.env.RAILWAY_SERVICE_NAME)
    throw Error("dr_offline_fixture_only_no_railway");
  if (process.env.DATA_DIR &&
      (path.resolve(process.env.DATA_DIR) === "/data" ||
       path.resolve(process.env.DATA_DIR) === "/app/data"))
    throw Error("dr_offline_fixture_only_deployed_data_dir");
}

/**
 * Freeze admissions first; wait for in-flight tickets; pause + await Sync
 * termination next; verify externally imposed fixture-only writer halt; only
 * then capture. The Sync pause and the freeze remain active across async work.
 * Reverse on success/failure. This is a lifecycle TEST helper, not a scheduler.
 */
export async function withOfflineFixtureCut<T>(opts: FixtureCutOptions<T>): Promise<T> {
  assertOfflineFixtureOnly();
  return opts.fence.withFrozenWriters(async () => {
    return opts.sync.withPausedForEdit(async () => {
      const halted = await opts.assertNoExternalWriters();
      if (halted !== true) throw Error("dr_fixture_external_writer_not_halted");
      return await opts.capture();
    });
  }, {drainTimeoutMs: opts.drainTimeoutMs ?? 10000});
}

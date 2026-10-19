import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { installSingleAdminGuard } from "./claim";
import { inProcessDrWriterFence as fence } from "./backup/writer-fence";

function fixtureDb(): Database.Database {
  const database = new Database(":memory:");
  database.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
  return database;
}
function triggerCount(database: Database.Database): number {
  return (database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='single_admin'").get() as { n: number }).n;
}

it("refuses a direct SQLite trigger DDL during a freeze without modifying the schema", async () => {
  const database = fixtureDb();
  try {
    await fence.withFrozenWriters(async () => {
      expect(() => installSingleAdminGuard(database)).toThrow("backup_writer_freeze_active");
      expect(triggerCount(database)).toBe(0);
      expect(fence.status.activeWriters).toBe(0);
    });
    installSingleAdminGuard(database);
    expect(triggerCount(database)).toBe(1);
    expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
  } finally { database.close(); }
});

it("drains the parent async Auth writer before the snapshot sees the trigger, including nested DDL", async () => {
  const database = fixtureDb();
  try {
    let resume!: () => void;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const migration = fence.withWrite(async () => {
      await pending;
      installSingleAdminGuard(database);
    }, "better_auth_adapter");

    expect(fence.getAdmissionEvidence().activeByClass.better_auth_adapter).toBe(1);
    let captured = false;
    const snapshot = fence.withFrozenWriters(() => {
      captured = true;
      expect(triggerCount(database)).toBe(1);
      return "observed_after_migration";
    }, { drainTimeoutMs: 5000 });
    expect(fence.status.frozen).toBe(true);
    expect(captured).toBe(false);
    // A fresh direct DDL attempt must be rejected even while an admitted parent
    // is draining. Only the already-admitted async continuation may finish.
    expect(() => installSingleAdminGuard(database)).toThrow("backup_writer_freeze_active");
    expect(triggerCount(database)).toBe(0);
    resume();
    await expect(migration).resolves.toBeUndefined();
    await expect(snapshot).resolves.toBe("observed_after_migration");
    expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
  } finally { database.close(); }
});

it("releases the admission after SQLite DDL throws; subsequent freeze is not blocked", async () => {
  expect(() => installSingleAdminGuard({
    exec: () => { throw new Error("injected_sqlite_ddl_failure"); },
  })).toThrow("injected_sqlite_ddl_failure");
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
  expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
  await expect(fence.withFrozenWriters(() => "safe_after_error")).resolves.toBe("safe_after_error");
});

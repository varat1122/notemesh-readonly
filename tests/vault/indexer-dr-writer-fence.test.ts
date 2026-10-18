import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Real ephemeral SQLite + Vault. Never use a deployed DATA_DIR or live Vault.
let root: string;
let vault: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nm-dr-indexer-")));
  vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 5).toString("base64");
  delete (globalThis as Record<string, unknown>).__vaultIndexer;
  vi.resetModules();
});
afterEach(async () => {
  const live = (globalThis as Record<string, unknown>).__vaultIndexer as { stop?: () => Promise<void> } | undefined;
  await live?.stop?.();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

it("blocks direct note/FTS/link/attachment updates and index rebuild while frozen, then reconciles", async () => {
  const { reindexPath, indexer } = await import("~/server/vault/indexer");
  const { db } = await import("~/server/db");
  const { inProcessDrWriterFence: fence } = await import("~/server/backup/writer-fence");
  const count = (table: string) =>
    (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  fs.writeFileSync(path.join(vault, "before.md"), "# Before\\n");
  reindexPath("before.md");
  expect(count("notes")).toBe(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await fence.withFrozenWriters(async () => {
    fs.writeFileSync(path.join(vault, "added.md"), "# Added\\n[[before]] #tag\\n");
    fs.writeFileSync(path.join(vault, "picture.png"), "fixture");
    reindexPath("added.md");
    reindexPath("picture.png");
    expect(count("notes")).toBe(1);
    expect(count("notes_fts")).toBe(1);
    expect(count("attachments")).toBe(0);
    await expect(indexer().rebuild()).rejects.toThrow("backup_writer_freeze_active");
    expect(count("notes")).toBe(1); // The wipe itself was refused.
  });
  await vi.waitFor(() => {
    expect(count("notes")).toBe(2);
    expect(count("notes_fts")).toBe(2);
    expect(count("attachments")).toBe(1);
    expect(indexer().ready).toBe(true);
  }, { timeout: 5_000 });
  expect(fence.status).toEqual({ frozen: false, activeWriters: 0 });
});

it("releases writer tickets after normal indexing, so a later freeze can drain", async () => {
  const { reindexPath } = await import("~/server/vault/indexer");
  const { inProcessDrWriterFence: fence } = await import("~/server/backup/writer-fence");
  fs.writeFileSync(path.join(vault, "note.md"), "# Note\\n");
  reindexPath("note.md");
  expect(fence.status.activeWriters).toBe(0);
  await expect(fence.withFrozenWriters(() => "snapshot", { drainTimeoutMs: 50 }))
    .resolves.toBe("snapshot");
});

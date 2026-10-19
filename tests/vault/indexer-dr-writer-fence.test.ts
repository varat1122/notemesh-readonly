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
  fs.writeFileSync(path.join(vault, "before.md"), "# Before\n");
  reindexPath("before.md");
  expect(count("notes")).toBe(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await fence.withFrozenWriters(async () => {
    fs.writeFileSync(path.join(vault, "added.md"), "# Added\n[[before]] #tag\n");
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
  fs.writeFileSync(path.join(vault, "note.md"), "# Note\n");
  reindexPath("note.md");
  expect(fence.status.activeWriters).toBe(0);
  await expect(fence.withFrozenWriters(() => "snapshot", { drainTimeoutMs: 50 }))
    .resolves.toBe("snapshot");
});

it("defers removal of an oversized note until thaw instead of swallowing the freeze error", async () => {
  const { reindexPath, indexer, indexerStatus } = await import("~/server/vault/indexer");
  const { db } = await import("~/server/db");
  const { inProcessDrWriterFence: fence } = await import("~/server/backup/writer-fence");
  const count = () => (db().prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
  const filename = path.join(vault, "large.md");
  fs.writeFileSync(filename, "# Initial\n");
  reindexPath("large.md");
  expect(count()).toBe(1);
  // The branch handling an oversized file calls removeFile INSIDE the read
  // try/catch. A freeze rejection must propagate instead of being mistaken
  // for an ordinary missing/symlinked file.
  fs.writeFileSync(filename, Buffer.alloc(1_000_001, 0x61));
  await fence.withFrozenWriters(async () => {
    reindexPath("large.md");
    expect(count()).toBe(1);
  });
  await vi.waitFor(() => {
    expect(count()).toBe(0);
    expect(indexer().ready).toBe(true);
    expect(indexerStatus().unindexedNotes).toBe(1);
  }, { timeout: 5_000 });
});


it("holds one writer admission across ALL async rebuild yields; DR capture sees a complete SQLite/FTS index",async()=>{
  const {indexer,reindexPath}=await import("~/server/vault/indexer");
  const {db}=await import("~/server/db");
  const {inProcessDrWriterFence:fence}=await import("~/server/backup/writer-fence");
  const total=350;
  for(let n=0;n<total;n++)
    fs.writeFileSync(path.join(vault,`fixture-${n}.md`),`# Fixture ${n}\n\nindexed token ${n}\n`);
  const count=(table:string)=>
    (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n;
  const work=indexer().rebuild();
  // At this tick at least one batch finished, but the indexer has yielded
  // and the source-side SQLite/FTS rebuild is not logically complete yet.
  await new Promise<void>(resolve=>setImmediate(resolve));
  const partial=count("notes");
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(total);
  expect(indexer().ready).toBe(false);
  expect(fence.getAdmissionEvidence().activeByClass.indexer_rebuild).toBe(1);
  expect(fence.status.activeWriters).toBe(1);

  let captured=false;
  const cut=fence.withFrozenWriters(()=>{
    captured=true;
    expect(indexer().ready).toBe(true);
    expect(count("notes")).toBe(total);
    expect(count("notes_fts")).toBe(total);
    return "coherent-fixture-index";
  },{drainTimeoutMs:10000});
  expect(fence.status.frozen).toBe(true);
  expect(captured).toBe(false);
  // A new watcher-initiated mutation is blocked, but admitted rebuild
  // descendants can finish their SQL batches during the drain.
  fs.writeFileSync(path.join(vault,"late.md"),"# Late\n");
  // Direct reindexPath deliberately retries after thaw rather than modifying
  // SQLite under the frozen snapshot.
  reindexPath("late.md");
  expect(count("notes")).toBeLessThanOrEqual(total);
  await work;
  await expect(cut).resolves.toBe("coherent-fixture-index");
  expect(captured).toBe(true);
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  expect(count("notes")).toBe(total);
});

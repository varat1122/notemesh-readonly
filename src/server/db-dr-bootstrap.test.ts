import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
beforeEach(() => {
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-sqlite-init-")));
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DATA_DIR;
  fs.rmSync(root,{recursive:true,force:true});
});

it("refuses first SQLite open and schema migration during a freeze without creating a file",async()=>{
  const { inProcessDrWriterFence: fence }=await import("./backup/writer-fence");
  const { db }=await import("./db");
  const filename=path.join(root,"app.sqlite");
  await fence.withFrozenWriters(async()=>{
    expect(()=>db()).toThrow("backup_writer_freeze_active");
    expect(fs.existsSync(filename)).toBe(false);
    expect(fence.status.activeWriters).toBe(0);
  });
  const conn=db();
  expect(conn.prepare("SELECT name FROM sqlite_master WHERE name='notes'").get())
    .toEqual({name:"notes"});
  expect(fs.existsSync(filename)).toBe(true);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("a database already opened can still be read during a frozen fixture cut",async()=>{
  const { inProcessDrWriterFence: fence }=await import("./backup/writer-fence");
  const { db }=await import("./db");
  const conn=db();
  expect(fence.status.activeWriters).toBe(0);
  await fence.withFrozenWriters(async()=>{
    expect(db()).toBe(conn);
    expect(db().prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({n:0});
    expect(fence.status.activeWriters).toBe(0);
  });
});

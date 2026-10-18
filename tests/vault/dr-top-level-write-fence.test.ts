import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// No live Vault or deployed directory is ever opened by this test.
let root: string, vault: string;
beforeEach(() => {
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-vault-fence-")));
  vault=path.join(root,"vault");
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32,7).toString("base64");
  vi.resetModules();
});
afterEach(() => {
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
const put=(rel:string,data:string)=>{
  const abs=path.join(vault,rel);
  fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,data);
};
const exists=(rel:string)=>fs.existsSync(path.join(vault,rel));

it("refuses all top-level Vault mutations before creating temp files, directories or rewriting links",async()=>{
  const { inProcessDrWriterFence: fence }=await import("~/server/backup/writer-fence");
  const { writeVaultFile }=await import("~/server/vault/disk");
  const { createNote,moveNote,deleteNote }=await import("~/server/vault/notes");
  const { moveFolder,deleteFolder }=await import("~/server/vault/folders");
  put("keep.md","old content");
  put("Folder/n.md","# original");
  fs.mkdirSync(path.join(vault,"Empty"));
  await fence.withFrozenWriters(async()=>{
    expect(()=>writeVaultFile(path.join(vault,"keep.md"),"new content")).toThrow("backup_writer_freeze_active");
    expect(()=>createNote("New/deep.md","# new")).toThrow("backup_writer_freeze_active");
    expect(()=>moveNote("keep.md","Other/renamed.md")).toThrow("backup_writer_freeze_active");
    expect(()=>deleteNote("keep.md")).toThrow("backup_writer_freeze_active");
    expect(()=>moveFolder("Folder","Archive/Folder")).toThrow("backup_writer_freeze_active");
    expect(()=>deleteFolder("Empty")).toThrow("backup_writer_freeze_active");
    expect(fs.readFileSync(path.join(vault,"keep.md"),"utf8")).toBe("old content");
    expect(exists("Other")).toBe(false);
    expect(exists("New")).toBe(false);
    expect(exists("Archive")).toBe(false);
    expect(exists("Folder/n.md")).toBe(true);
    expect(exists("Empty")).toBe(true);
    expect(fs.readdirSync(vault).sort()).toEqual(["Empty","Folder","keep.md"]);
    expect(fence.status.activeWriters).toBe(0);
  });
  writeVaultFile(path.join(vault,"keep.md"),"allowed");
  expect(fs.readFileSync(path.join(vault,"keep.md"),"utf8")).toBe("allowed");
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("releases nested tickets after a parent Vault operation completes",async()=>{
  const { inProcessDrWriterFence: fence }=await import("~/server/backup/writer-fence");
  const { createNote,deleteNote }=await import("~/server/vault/notes");
  expect(createNote("dir/new.md","# created")).toBe("dir/new.md");
  expect(fence.status.activeWriters).toBe(0);
  expect(deleteNote("dir/new.md")).toBe("dir/new.md");
  await expect(fence.withFrozenWriters(()=>true)).resolves.toBe(true);
});

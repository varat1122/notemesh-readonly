import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-intake-schema-")));
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  vi.resetModules();
});
afterEach(async()=>{
  const {db}=await import("./db");
  const d=db();
  if(d.open)d.close();
  delete process.env.DATA_DIR;
  fs.rmSync(root,{recursive:true,force:true});
});
const tableExists=(d:{prepare:(sql:string)=>{get:()=>unknown}}):boolean=>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='intake_queue'").get());

it("refuses read-oriented intakeStatus and nextIntake during freeze before lazy SQLite DDL",async()=>{
  const {db}=await import("./db");
  const {intakeStatus,nextIntake}=await import("./intake");
  const {inProcessDrWriterFence:fence}=await import("./backup/writer-fence");
  const d=db();
  expect(tableExists(d)).toBe(false);
  await fence.withFrozenWriters(()=>{
    expect(()=>intakeStatus("nonexistent")).toThrow("backup_writer_freeze_active");
    expect(()=>nextIntake()).toThrow("backup_writer_freeze_active");
    expect(tableExists(d)).toBe(false);
    expect(fence.status.activeWriters).toBe(0);
  });
  expect(nextIntake()).toBeNull();
  expect(tableExists(d)).toBe(true);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("waits for a previously admitted async intake owner to finish schema creation before capture",async()=>{
  const {db}=await import("./db");
  const {nextIntake}=await import("./intake");
  const {inProcessDrWriterFence:fence}=await import("./backup/writer-fence");
  const d=db();
  let resume!:()=>void;
  const hold=new Promise<void>(resolve=>{resume=resolve;});
  const writer=fence.withWrite(async()=>{
    await hold;
    return nextIntake();
  },"app_sqlite_wal");
  expect(fence.getAdmissionEvidence().activeByClass.app_sqlite_wal).toBe(1);
  let captured=false;
  const cut=fence.withFrozenWriters(()=>{
    captured=true;
    expect(tableExists(d)).toBe(true);
    return "schema_ready";
  },{drainTimeoutMs:5000});
  expect(fence.status.frozen).toBe(true);
  expect(captured).toBe(false);
  expect(()=>nextIntake()).toThrow("backup_writer_freeze_active");
  expect(tableExists(d)).toBe(false);
  resume();
  await expect(writer).resolves.toBeNull();
  await expect(cut).resolves.toBe("schema_ready");
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("releases lazy intake DDL admission after a real SQLite read-only error",async()=>{
  const {db}=await import("./db");
  const {nextIntake}=await import("./intake");
  const {inProcessDrWriterFence:fence}=await import("./backup/writer-fence");
  const d=db();
  d.pragma("query_only = ON");
  try {
    expect(()=>nextIntake()).toThrow();
    expect(tableExists(d)).toBe(false);
    expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
    await expect(fence.withFrozenWriters(()=> "after_ddl_error"))
      .resolves.toBe("after_ddl_error");
  }finally{
    d.pragma("query_only = OFF");
  }
  expect(nextIntake()).toBeNull();
  expect(tableExists(d)).toBe(true);
});

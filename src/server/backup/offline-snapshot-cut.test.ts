import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import { SnapshotWriterFence } from "./writer-fence";
import { assertOfflineFixtureOnly, withOfflineFixtureCut } from "./offline-snapshot-cut";

const railwayVars = [
  "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_NAME", "RAILWAY_SERVICE_NAME",
];
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(r=>{resolve=r;});
  return {promise,resolve};
}
function mockSync(events:string[]){
  let paused=false,calls=0;
  // Keep the generic call signature intact: vi.fn wraps a polymorphic
  // function as Promise<unknown>, which is not a valid SyncPauser contract.
  const sync={
    withPausedForEdit:async<T>(run:()=>Promise<T>|T):Promise<T>=>{
      calls++;
      if(paused)throw Error("cannot_pause_twice");
      events.push("stop_sync");
      paused=true;
      try { return await run(); }
      finally {paused=false;events.push("resume_sync");}
    },
  };
  return {sync,isPaused:()=>paused,calls:()=>calls};
}

let scratch: string;
beforeEach(()=>{
  scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-snapshot-fixture-")));
  vi.stubEnv("DATA_DIR",scratch);
  for(const key of railwayVars)vi.stubEnv(key,"");
});
afterEach(()=>{
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(scratch,{recursive:true,force:true});
});

it.each(railwayVars)("refuses any Railway runtime even with successful external attestation: %s",async(key)=>{
  vi.stubEnv(key,"railway-fixture-test");
  expect(()=>assertOfflineFixtureOnly()).toThrow(/no_railway/);
  const fence=new SnapshotWriterFence(),sync=mockSync([]);
  const capture=vi.fn();
  await expect(withOfflineFixtureCut({
    fence,sync:sync.sync,assertNoExternalWriters:()=>true,capture,
  })).rejects.toThrow(/offline_fixture_only/);
  expect(sync.calls()).toBe(0);
  expect(capture).not.toHaveBeenCalled();
});
it.each(["/data", "/app/data"])("refuses deployed volume root %s without Railway variables",async(dir)=>{
  vi.stubEnv("DATA_DIR",dir);
  expect(()=>assertOfflineFixtureOnly()).toThrow(/deployed_data_dir/);
});

it("refuses a symlink alias to isolated scratch and any non-fixture scratch directory",async()=>{
  const alias=scratch+"-alias",outside=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-unverified-"));
  try{
    fs.symlinkSync(scratch,alias);
    vi.stubEnv("DATA_DIR",alias);
    expect(()=>assertOfflineFixtureOnly()).toThrow(/not_isolated_scratch|symlink_or_unsafe_root/);
    vi.stubEnv("DATA_DIR",outside);
    expect(()=>assertOfflineFixtureOnly()).toThrow(/not_isolated_scratch/);
    expect(fs.readdirSync(scratch)).toEqual([]);
  }finally{
    fs.rmSync(alias,{force:true});
    fs.rmSync(outside,{recursive:true,force:true});
  }
});
it("refuses missing or nonexistent fixture path before freezing writers",async()=>{
  const fence=new SnapshotWriterFence(),events:string[]=[],{sync}=mockSync(events),capture=vi.fn();
  vi.stubEnv("DATA_DIR",scratch+"-gone");
  await expect(withOfflineFixtureCut({fence,sync,assertNoExternalWriters:()=>true,capture}))
    .rejects.toThrow(/missing_root/);
  expect(capture).not.toHaveBeenCalled();
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  expect(events).toEqual([]);
});

it("waits for in-flight writes, then holds Sync pause and admission fence until async cut finishes",async()=>{
  const fence=new SnapshotWriterFence(),events:string[]=[];
  const writerHold=deferred<void>(),captureHold=deferred<string>();
  const writer=fence.withWrite(async()=>{events.push("write_started");await writerHold.promise;events.push("write_done");});
  const {sync,isPaused}=mockSync(events);
  const cut=withOfflineFixtureCut({
    fence,sync,
    assertNoExternalWriters:async()=>{
      events.push("external_halt_verified");
      expect(isPaused()).toBe(true);
      expect(fence.status).toEqual({frozen:true,activeWriters:0});
      return true;
    },
    capture:async()=>{
      events.push("capture_started");
      expect(isPaused()).toBe(true);
      expect(fence.status.frozen).toBe(true);
      return captureHold.promise;
    },
  });
  expect(fence.status).toEqual({frozen:true,activeWriters:1});
  expect(events).toEqual(["write_started"]);
  await expect(fence.withWrite(()=>false)).rejects.toThrow(/freeze_active/);
  expect(()=>fence.withWriteSync(()=>false)).toThrow(/freeze_active/);
  writerHold.resolve();
  await writer;
  await vi.waitFor(()=>expect(events).toContain("capture_started"));
  expect(isPaused()).toBe(true);
  expect(fence.status.frozen).toBe(true);
  captureHold.resolve("fixture-cut-complete");
  await expect(cut).resolves.toBe("fixture-cut-complete");
  expect(events).toEqual([
    "write_started","write_done","stop_sync","external_halt_verified",
    "capture_started","resume_sync",
  ]);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  expect(await fence.withWrite(()=>42)).toBe(42);
});
it("fails closed when an out-of-process writer halt is not proven",async()=>{
  const events:string[]=[],fence=new SnapshotWriterFence(),{sync,isPaused}=mockSync(events);
  const capture=vi.fn();
  await expect(withOfflineFixtureCut({
    fence,sync,assertNoExternalWriters:()=>false,capture,
  })).rejects.toThrow(/external_writer_not_halted/);
  expect(capture).not.toHaveBeenCalled();
  expect(isPaused()).toBe(false);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  expect(events).toEqual(["stop_sync","resume_sync"]);
});
it("resumes Sync and unfreezes writers after a failed isolated snapshot",async()=>{
  const events:string[]=[],fence=new SnapshotWriterFence(),{sync,isPaused}=mockSync(events);
  await expect(withOfflineFixtureCut({
    fence,sync,assertNoExternalWriters:()=>true,
    capture:async()=>{throw Error("fixture_disk_full");},
  })).rejects.toThrow(/fixture_disk_full/);
  expect(isPaused()).toBe(false);
  expect(fence.status.frozen).toBe(false);
  expect(events).toEqual(["stop_sync","resume_sync"]);
});
it("does not execute capture when writer drain times out",async()=>{
  const fence=new SnapshotWriterFence(),done=deferred<void>(),events:string[]=[];
  const busy=fence.withWrite(()=>done.promise),{sync}=mockSync(events),capture=vi.fn();
  await expect(withOfflineFixtureCut({
    fence,sync,assertNoExternalWriters:()=>true,capture,drainTimeoutMs:10,
  })).rejects.toThrow(/drain_timeout/);
  expect(capture).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  expect(fence.status.frozen).toBe(false);
  done.resolve();await busy;
});

it("DR P2.9 refuses a synthetic snapshot when a noncooperating child process modifies source",async()=>{
  const fence=new SnapshotWriterFence(),events:string[]=[],{sync,isPaused}=mockSync(events);
  const note=path.join(scratch,"note.md");
  fs.writeFileSync(note,"before");
  const original="before";
  const childWrite=()=>execFileSync(process.execPath,[
    "-e",
    'require("node:fs").writeFileSync(process.argv[1],"after")',
    note,
  ],{timeout:2000});
  await expect(withOfflineFixtureCut({
    fence,sync,
    // A mock "verified external halt" alone MUST NOT turn a moving source
    // into an accepted fixture snapshot.
    assertNoExternalWriters:()=>true,
    capture:async()=>{
      expect(isPaused()).toBe(true);
      expect(fs.readFileSync(note,"utf8")).toBe(original);
      childWrite();
      return "should-not-be-accepted";
    },
  })).rejects.toThrow("dr_fixture_source_changed_during_cut");
  expect(fs.readFileSync(note,"utf8")).toBe("after");
  expect(events).toEqual(["stop_sync","resume_sync"]);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  // No change to the now-stable fixture should allow the next fixture cut.
  const accepted=await withOfflineFixtureCut({
    fence,sync,assertNoExternalWriters:()=>true,capture:()=>42,
  });
  expect(accepted).toBe(42);
});

it.each(["created","deleted","replaced"])(
  "DR P2.9 detects %s source files during an otherwise accepted offline cut",
  async(change)=>{
    const fence=new SnapshotWriterFence(),events:string[]=[],{sync}=mockSync(events);
    const note=path.join(scratch,"existing.md");
    fs.writeFileSync(note,"initial");
    await expect(withOfflineFixtureCut({
      fence,sync,assertNoExternalWriters:()=>true,
      capture:()=>{
        if(change==="created")fs.writeFileSync(path.join(scratch,"new.md"),"payload");
        else if(change==="deleted")fs.unlinkSync(note);
        else {fs.unlinkSync(note);fs.writeFileSync(note,"replacement");}
        return "unverified-result";
      },
    })).rejects.toThrow("dr_fixture_source_changed_during_cut");
    expect(events).toEqual(["stop_sync","resume_sync"]);
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
  },
);

it("DR P2.9 rejects a linked or excessive source before running capture",async()=>{
  const fence=new SnapshotWriterFence(),{sync}=mockSync([]),capture=vi.fn();
  const file=path.join(scratch,"note.md");
  fs.writeFileSync(file,"content");
  const link=path.join(scratch,"link.md");
  fs.symlinkSync(file,link);
  const opts={fence,sync,assertNoExternalWriters:()=>true,capture};
  await expect(withOfflineFixtureCut(opts)).rejects.toThrow("dr_fixture_source_unsafe_entry");
  expect(capture).not.toHaveBeenCalled();
  fs.unlinkSync(link);
  fs.truncateSync(file,256*1024*1024+1);
  await expect(withOfflineFixtureCut(opts)).rejects.toThrow("dr_fixture_source_fingerprint_limit");
  expect(capture).not.toHaveBeenCalled();
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("DR P2.9 integrates a stable offline fixture cut with genuine encrypted .nmb verify and isolated restore",async()=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-bundle-fixture-"));
  const sourceFile=path.join(scratch,"vault","Research","fixture.md");
  fs.mkdirSync(path.dirname(sourceFile),{recursive:true});
  fs.writeFileSync(sourceFile,"# Synthetic vault\\n");
  const db=new Database(path.join(scratch,"app.sqlite"));
  try{
    db.exec("CREATE TABLE fixture(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO fixture(note) VALUES('synthetic');");
  }finally{db.close();}
  const cli=path.resolve("scripts/backup/nm-backup.mjs");
  const env={
    ...process.env,
    NOTEMESH_BACKUP_PASSPHRASE:"synthetic-dr-fixture-passphrase-1234567890",
    RAILWAY_PROJECT_ID:"",RAILWAY_SERVICE_ID:"",RAILWAY_ENVIRONMENT_ID:"",
    RAILWAY_ENVIRONMENT_NAME:"",RAILWAY_PROJECT_NAME:"",RAILWAY_SERVICE_NAME:"",
  };
  // The CLI correctly refuses backing up the process's own live DATA_DIR,
  // even with --fixture-only. This subprocess is deliberately offline and
  // must not inherit the coordinator's synthetic live-root setting.
  delete env.DATA_DIR;
  const exec=(args:string[])=>JSON.parse(execFileSync(process.execPath,[cli,...args],{
    env,encoding:"utf8",timeout:60000,maxBuffer:1024*1024,
  }).trim()) as Record<string,unknown>;
  const events:string[]=[],fence=new SnapshotWriterFence(),{sync}=mockSync(events);
  try{
    const receipt=await withOfflineFixtureCut({
      fence,sync,assertNoExternalWriters:()=>true,
      capture:()=>exec(["create","--fixture-only","--kind","fixture",
        "--data-dir",scratch,"--out",path.join(output,"encrypted")]),
    });
    const bundle=receipt.bundle as string;
    expect(bundle).toMatch(/\\.nmb$/);
    expect(fs.statSync(bundle).size).toBeGreaterThan(100);
    expect(exec(["verify","--bundle",bundle]).verified).toBe(true);
    const target=path.join(output,"restore");
    expect(exec(["restore","--bundle",bundle,"--dest",target]).verified).toBe(true);
    expect(fs.readFileSync(path.join(target,"vault","Research","fixture.md"),"utf8"))
      .toBe("# Synthetic vault\\n");
    const restored=new Database(path.join(target,"app.sqlite"),{readonly:true});
    try{
      expect(restored.prepare("SELECT note FROM fixture").get()).toEqual({note:"synthetic"});
      expect(restored.pragma("integrity_check",{simple:true})).toBe("ok");
    }finally{restored.close();}
    expect(events).toEqual(["stop_sync","resume_sync"]);
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
  }finally{fs.rmSync(output,{recursive:true,force:true});}
});

import { beforeEach, afterEach, expect, it, vi } from "vitest";
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

beforeEach(()=>{
  vi.stubEnv("DATA_DIR","/tmp/offline-snapshot-fixture");
  for(const key of railwayVars)vi.stubEnv(key,"");
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

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

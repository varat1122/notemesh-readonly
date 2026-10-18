import {describe,it,expect,vi} from "vitest";
import {SnapshotWriterFence} from "./writer-fence";

function deferred<T>() {
  let resolve!:(value:T)=>void;
  let reject!:(error:Error)=>void;
  const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
describe("SnapshotWriterFence (isolated fixture only)",()=>{
  it("holds explicit tickets until resource close and releases exactly once",async()=>{
    const fence=new SnapshotWriterFence();
    const release=fence.acquireWriteTicket();
    expect(fence.status.activeWriters).toBe(1);
    await expect(fence.withFrozenWriters(()=>true,{drainTimeoutMs:15}))
      .rejects.toThrow(/drain_timeout/);
    expect(fence.status).toEqual({frozen:false,activeWriters:1});
    release();
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
    expect(release).toThrow(/already_released/);
    expect(await fence.withFrozenWriters(()=>true)).toBe(true);
  });
  it("freezes new writes immediately and drains existing mutators before snapshot",async()=>{
    const fence=new SnapshotWriterFence();
    const writer=deferred<void>();
    let editing=false;
    const inFlight=fence.withWrite(async()=>{editing=true;await writer.promise;editing=false;});
    const start=vi.fn(()=>{expect(editing).toBe(false);return "snapshot";});
    const snapshot=fence.withFrozenWriters(start);
    expect(fence.status).toEqual({frozen:true,activeWriters:1});
    await expect(fence.withWrite(()=>"not allowed")).rejects.toThrow(/freeze_active/);
    expect(start).not.toHaveBeenCalled();
    writer.resolve();
    await inFlight;
    await expect(snapshot).resolves.toBe("snapshot");
    expect(start).toHaveBeenCalledOnce();
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
  });
  it("keeps writers locked out through asynchronous snapshot and prevents overlap",async()=>{
    const fence=new SnapshotWriterFence(),done=deferred<string>();
    let entered=false;
    const snapshot=fence.withFrozenWriters(async()=>{entered=true;return done.promise;});
    expect(entered).toBe(true);
    await expect(fence.withFrozenWriters(()=>0)).rejects.toThrow(/already_in_progress/);
    await expect(fence.withWrite(()=>0)).rejects.toThrow(/freeze_active/);
    done.resolve("ok");
    await expect(snapshot).resolves.toBe("ok");
    expect(await fence.withWrite(()=>7)).toBe(7);
  });
  it("releases on writer drain timeout without starting snapshot",async()=>{
    const fence=new SnapshotWriterFence(),done=deferred<void>();
    const writer=fence.withWrite(()=>done.promise);
    const snapshot=vi.fn();
    await expect(fence.withFrozenWriters(snapshot,{drainTimeoutMs:10})).rejects.toThrow(/drain_timeout/);
    expect(snapshot).not.toHaveBeenCalled();
    expect(fence.status.frozen).toBe(false);
    done.resolve();
    await writer;
    expect(await fence.withWrite(()=>3)).toBe(3);
  });
  it("unfreezes after snapshot failure, rejects inconsistent deadlines",async()=>{
    const fence=new SnapshotWriterFence();
    await expect(fence.withFrozenWriters(()=>{throw Error("fixture_snapshot_failed");})).rejects.toThrow("fixture_snapshot_failed");
    expect(await fence.withWrite(()=>11)).toBe(11);
    await expect(fence.withFrozenWriters(()=>0,{drainTimeoutMs:0})).rejects.toThrow(/invalid_backup_drain_timeout/);
    expect(fence.status.frozen).toBe(false);
  });
  it("tracks synchronous mutators and refuses admission during a freeze", async()=>{
    const fence=new SnapshotWriterFence();
    expect(fence.withWriteSync(()=>{
      expect(fence.status.activeWriters).toBe(1);
      return 23;
    })).toBe(23);
    expect(fence.status.activeWriters).toBe(0);
    expect(()=>fence.withWriteSync(()=>{throw Error("sync_write_failed");})).toThrow("sync_write_failed");
    expect(fence.status.activeWriters).toBe(0);
    await fence.withFrozenWriters(()=>{
      expect(()=>fence.withWriteSync(()=>99)).toThrow(/freeze_active/);
      expect(fence.status.activeWriters).toBe(0);
    });
    expect(fence.withWriteSync(()=>7)).toBe(7);
  });
  it("releases writer tickets when an async mutation rejects",async()=>{
    const fence=new SnapshotWriterFence();
    await expect(fence.withWrite(async()=>{throw Error("write_error");})).rejects.toThrow("write_error");
    expect(fence.status.activeWriters).toBe(0);
    expect(await fence.withFrozenWriters(()=>5)).toBe(5);
  });
});

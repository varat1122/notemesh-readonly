import { expect, it, vi, beforeEach } from "vitest";
const calls=vi.hoisted(()=>({manual:0}));
vi.mock("./cli",()=>({obIsAuthenticated:async()=>true,obSyncConfigured:async()=>true,obSyncOnce:async()=>{calls.manual++;return {ok:true,combined:"Fully synced"};}}));
import { SyncSupervisor } from "./supervisor";
beforeEach(()=>{vi.restoreAllMocks();calls.manual=0;});
it("awaits actual child exit, holds restart/manual sync off until edit finishes, and resumes once",async()=>{
 const s=new SyncSupervisor();let finish:()=>void=()=>{};
 const promise=new Promise<void>(resolve=>{finish=()=>{(s as any).child=null;s.state="stopped";resolve();};});
 const child=Object.assign(promise,{kill:vi.fn(()=>{queueMicrotask(finish);})});(s as any).child=child;s.state="running";
 const start=vi.spyOn(s,"start").mockImplementation(()=>{}),run=vi.fn(()=>{expect((s as any).child).toBeNull();expect((s as any).editPaused).toBe(true);return "edited";});
 expect(await s.withPausedForEdit(run)).toBe("edited");expect(child.kill).toHaveBeenCalledWith("SIGTERM");expect(start).toHaveBeenCalledOnce();expect(run).toHaveBeenCalledOnce();
});
it("resumes daemon after mutation failure",async()=>{
 const s=new SyncSupervisor();const promise=Promise.resolve();(s as any).child=Object.assign(promise,{kill:()=>{(s as any).child=null;s.state="stopped";}});s.state="running";
 const start=vi.spyOn(s,"start").mockImplementation(()=>{});await expect(s.withPausedForEdit(()=>{throw Error("synthetic failure");})).rejects.toThrow(/synthetic/);expect(start).toHaveBeenCalledOnce();
});
it("fails closed without a running child",async()=>{const s=new SyncSupervisor(),run=vi.fn();await expect(s.withPausedForEdit(run)).rejects.toThrow();expect(run).not.toHaveBeenCalled();});
it("fails closed at ten seconds, never edits a live child, and resumes only after late exit",async()=>{
 vi.useFakeTimers();
 try {
  const s=new SyncSupervisor();let finish:()=>void=()=>{};
  const promise=new Promise<void>(resolve=>{finish=()=>{(s as any).child=null;s.state="stopped";resolve();};});
  const child=Object.assign(promise,{pid:1234,exitCode:null,signalCode:null,kill:vi.fn()});
  (s as any).child=child;s.state="running";
  const start=vi.spyOn(s,"start").mockImplementation(()=>{}),run=vi.fn();
  const pending=expect(s.withPausedForEdit(run)).rejects.toThrow("Sync did not stop; no edit applied");
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(run).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(s.getLogs().some(x=>x.line.includes("safe-edit pause timeout")&&x.line.includes("exitCode=null"))).toBe(true);
  finish();await Promise.resolve();await Promise.resolve();
  expect(start).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
 } finally {vi.useRealTimers();}
});

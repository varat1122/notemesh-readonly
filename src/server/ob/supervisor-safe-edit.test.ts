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

it("holds Obsidian Sync paused throughout an asynchronous snapshot callback",async()=>{
 const s=new SyncSupervisor();
 const stopPromise=Promise.resolve();
 (s as any).child=Object.assign(stopPromise,{kill:()=>{(s as any).child=null;s.state="stopped";}});
 s.state="running";
 const start=vi.spyOn(s,"start").mockImplementation(()=>{});
 let complete!: (value:string)=>void;
 const pending=new Promise<string>(resolve=>{complete=resolve;});
 let reached=false;
 const result=s.withPausedForEdit(async()=>{
   reached=true;
   expect((s as any).editPaused).toBe(true);
   expect((s as any).child).toBeNull();
   return pending;
 });
 await vi.waitFor(()=>expect(reached).toBe(true));
 expect(start).not.toHaveBeenCalled();
 expect((s as any).editPaused).toBe(true);
 await expect(s.withPausedForEdit(()=>"overlap")).rejects.toThrow(/paused safely/);
 complete("complete");
 await expect(result).resolves.toBe("complete");
 expect(start).toHaveBeenCalledOnce();
});

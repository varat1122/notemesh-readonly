import { expect, it, vi, beforeEach } from "vitest";
const mock=vi.hoisted(()=>({kind:"obsidian",state:"running",active:false,verified:true,paused:0,gitPaused:0,gitAvailable:true}));
vi.mock("../sync",()=>({syncKind:()=>mock.kind,syncBackend:()=>({kind:mock.kind,withPausedForEdit:mock.gitAvailable?async(run:()=>unknown)=>{mock.gitPaused++;return run();}:undefined})}));
vi.mock("../ob/supervisor",()=>({supervisor:()=>({status:()=>({state:mock.state,activity:{active:mock.active},startedAt:100}),getLogs:()=>mock.verified?[{line:"[sync-policy] Verified bidirectional sync.",ts:101}]:[],withPausedForEdit:async(run:()=>unknown)=>{mock.paused++;return run();}})}));
import { withPausedSync } from "./sync";
beforeEach(()=>{process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";process.env.CLOUD_INTAKE="1";Object.assign(mock,{kind:"obsidian",state:"running",active:false,verified:true,paused:0,gitPaused:0,gitAvailable:true});});
it("runs mutation only through the verified daemon pause boundary",async()=>{expect(await withPausedSync(()=>"written")).toBe("written");expect(mock.paused).toBe(1);});
it.each([{state:"stopped"},{active:true},{verified:false}])("refuses unsafe Sync state %j",async changes=>{Object.assign(mock,changes);const run=vi.fn();await expect(withPausedSync(run)).rejects.toThrow();expect(run).not.toHaveBeenCalled();});
it("refuses disabled deployment or missing exclusive-writer acknowledgement",async()=>{process.env.SAFE_EDIT_ENABLED="0";await expect(withPausedSync(()=>0)).rejects.toThrow(/disabled/);process.env.SAFE_EDIT_ENABLED="1";delete process.env.SAFE_EDIT_SINGLE_WRITER;await expect(withPausedSync(()=>0)).rejects.toThrow(/single replica/);});

it("routes Git only through the backend pause contract",async()=>{mock.kind="git";expect(await withPausedSync(()=>"written")).toBe("written");expect(mock.gitPaused).toBe(1);expect(mock.paused).toBe(0);mock.gitAvailable=false;const run=vi.fn();await expect(withPausedSync(run)).rejects.toThrow(/unavailable/);expect(run).not.toHaveBeenCalled();});
it("requires cloud intake deployment for either backend",async()=>{delete process.env.CLOUD_INTAKE;const run=vi.fn();for(const kind of ["git","obsidian"]){mock.kind=kind;await expect(withPausedSync(run)).rejects.toThrow();}expect(run).not.toHaveBeenCalled();});

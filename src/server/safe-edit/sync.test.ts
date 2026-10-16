import { expect, it, vi, beforeEach } from "vitest";
const mock=vi.hoisted(()=>({kind:"obsidian",state:"running",active:false,verified:true,paused:0}));
vi.mock("../sync",()=>({syncKind:()=>mock.kind}));
vi.mock("../ob/supervisor",()=>({supervisor:()=>({status:()=>({state:mock.state,activity:{active:mock.active},startedAt:100}),getLogs:()=>mock.verified?[{line:"[sync-policy] Verified bidirectional sync.",ts:101}]:[],withPausedForEdit:async(run:()=>unknown)=>{mock.paused++;return run();}})}));
import { withPausedSync } from "./sync";
beforeEach(()=>{process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";process.env.CLOUD_INTAKE="1";Object.assign(mock,{kind:"obsidian",state:"running",active:false,verified:true,paused:0});});
it("runs mutation only through the verified daemon pause boundary",async()=>{expect(await withPausedSync(()=>"written")).toBe("written");expect(mock.paused).toBe(1);});
it.each([{kind:"git"},{state:"stopped"},{active:true},{verified:false}])("refuses unsafe Sync state %j",async changes=>{Object.assign(mock,changes);const run=vi.fn();await expect(withPausedSync(run)).rejects.toThrow();expect(run).not.toHaveBeenCalled();});
it("refuses disabled deployment or missing exclusive-writer acknowledgement",async()=>{process.env.SAFE_EDIT_ENABLED="0";await expect(withPausedSync(()=>0)).rejects.toThrow(/disabled/);process.env.SAFE_EDIT_ENABLED="1";delete process.env.SAFE_EDIT_SINGLE_WRITER;await expect(withPausedSync(()=>0)).rejects.toThrow(/single replica/);});

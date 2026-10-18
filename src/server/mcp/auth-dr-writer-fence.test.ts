import {beforeEach,expect,it,vi} from "vitest";

const adapter=vi.hoisted(()=>({
  calls:0,
  pending:null as Promise<void>|null,
}));
vi.mock("../auth",()=>({
  auth:{api:{verifyApiKey:async()=>{
    adapter.calls++;
    if(adapter.pending)await adapter.pending;
    return {valid:true,key:{id:"fixture",name:"research"}};
  }}},
}));
import {accessFromApiKey} from "./auth";
import {inProcessDrWriterFence as fence} from "../backup/writer-fence";

const request=()=>new Request("https://fixture.example/api/mcp",{
  headers:{"x-api-key":"synthetic-key"},
});
beforeEach(()=>{adapter.calls=0;adapter.pending=null;});

it("DR P2.8 refuses direct MCP Better Auth adapter calls before verification under freeze",async()=>{
  await fence.withFrozenWriters(async()=>{
    await expect(accessFromApiKey(request())).rejects
      .toThrow("backup_writer_freeze_active");
    expect(adapter.calls).toBe(0);
    expect(fence.status.activeWriters).toBe(0);
  });
  const access=await accessFromApiKey(request());
  expect(access).toMatchObject({read:true,write:false,label:"api-key:research"});
  expect(adapter.calls).toBe(1);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("DR P2.8 holds a direct verification adapter call until its asynchronous result is settled",async()=>{
  let release!:()=>void;
  adapter.pending=new Promise<void>(r=>{release=r;});
  const active=accessFromApiKey(request());
  await vi.waitFor(()=>expect(adapter.calls).toBe(1));
  expect(fence.status.activeWriters).toBe(1);
  let captured=false;
  const snapshot=fence.withFrozenWriters(()=>{captured=true;return "captured";});
  expect(captured).toBe(false);
  release();
  expect((await active)?.read).toBe(true);
  await expect(snapshot).resolves.toBe("captured");
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

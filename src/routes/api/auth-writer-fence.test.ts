import {beforeEach,afterEach,expect,it,vi} from "vitest";

const flow=vi.hoisted(()=>({get:0,post:0,migrations:0,hold:null as null|Promise<void>}));
vi.mock("better-auth/solid-start",()=>({
  toSolidStartHandler:()=>({
    GET:async()=>{flow.get++;if(flow.hold)await flow.hold;return Response.json({ok:true});},
    POST:async()=>{flow.post++;return Response.json({ok:true});},
  }),
}));
vi.mock("~/server/auth",()=>({
  auth:{},runAuthMigrations:async()=>{flow.migrations++;},
}));
vi.mock("~/server/claim",()=>({userCount:()=>({known:true,count:0})}));
vi.mock("~/server/audit",()=>({audit:()=>{}}));
vi.mock("~/server/oauth-registration",()=>({normalizeClientRegistration:(x:unknown)=>x}));

import {GET,POST} from "./auth/[...all]";
import {inProcessDrWriterFence} from "~/server/backup/writer-fence";

const ev=(method:"GET"|"POST")=>({request:new Request(
  "https://fixture.example/api/auth/get-session",{method})});
beforeEach(()=>{flow.get=0;flow.post=0;flow.migrations=0;flow.hold=null;});
afterEach(()=>{vi.restoreAllMocks();});
it("rejects all Better Auth endpoints before migrations or SQLite writes during freeze",async()=>{
  await inProcessDrWriterFence.withFrozenWriters(async()=>{
    await expect(GET(ev("GET"))).rejects.toThrow("backup_writer_freeze_active");
    await expect(POST(ev("POST"))).rejects.toThrow("backup_writer_freeze_active");
    expect(flow).toMatchObject({get:0,post:0,migrations:0});
  });
  expect((await GET(ev("GET"))).status).toBe(200);
  expect((await POST(ev("POST"))).status).toBe(200);
  expect(flow).toMatchObject({get:1,post:1,migrations:2});
});
it("holds writer ticket until the asynchronous Better Auth operation completes",async()=>{
  let release!:()=>void;
  flow.hold=new Promise<void>(resolve=>{release=resolve;});
  const existing=GET(ev("GET"));
  await vi.waitFor(()=>expect(flow.get).toBe(1));
  expect(inProcessDrWriterFence.status.activeWriters).toBe(1);
  expect(inProcessDrWriterFence.getAdmissionEvidence().activeByClass.better_auth_adapter).toBe(1);
  expect(inProcessDrWriterFence.getAdmissionEvidence().productionSnapshotReady).toBe(false);
  let cutStarted=false;
  const cut=inProcessDrWriterFence.withFrozenWriters(()=>{cutStarted=true;return "snapshot";});
  expect(inProcessDrWriterFence.status.frozen).toBe(true);
  expect(cutStarted).toBe(false);
  await expect(POST(ev("POST"))).rejects.toThrow("backup_writer_freeze_active");
  expect(flow.post).toBe(0);
  release();await existing;
  await expect(cut).resolves.toBe("snapshot");
  expect(inProcessDrWriterFence.status).toEqual({frozen:false,activeWriters:0});
  expect(inProcessDrWriterFence.getAdmissionEvidence().activeByClass).toEqual({});
});

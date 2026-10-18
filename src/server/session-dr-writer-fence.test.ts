import {beforeEach,expect,it,vi} from "vitest";
const calls=vi.hoisted(()=>({sessions:0,migrations:0}));
vi.mock("solid-js/web",()=>({
  getRequestEvent:()=>({request:new Request("https://fixture.example/dashboard")}),
}));
vi.mock("./auth",()=>({
  runAuthMigrations:async()=>{calls.migrations++;},
  isSetupComplete:async()=>true,
  auth:{api:{getSession:async()=>{calls.sessions++;return {user:{id:"synthetic-admin"}};}}},
}));
import {getSessionOrNull,requireAdmin} from "./session";
import {inProcessDrWriterFence as fence} from "./backup/writer-fence";
beforeEach(()=>{calls.sessions=0;calls.migrations=0;});

it("DR P2.8 prevents Better Auth session adapter calls during fixture freeze",async()=>{
  await fence.withFrozenWriters(async()=>{
    await expect(getSessionOrNull()).rejects.toThrow("backup_writer_freeze_active");
    await expect(requireAdmin()).rejects.toThrow("backup_writer_freeze_active");
    expect(calls.sessions).toBe(0);
    expect(fence.status.activeWriters).toBe(0);
  });
  expect(await getSessionOrNull()).toMatchObject({user:{id:"synthetic-admin"}});
  expect(await requireAdmin()).toMatchObject({user:{id:"synthetic-admin"}});
  expect(calls.sessions).toBe(2);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

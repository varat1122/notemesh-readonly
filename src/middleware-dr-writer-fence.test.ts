import {beforeEach,expect,it,vi} from "vitest";

const state=vi.hoisted(()=>({
  calls:0, migrations:0, meta:0,
  hold:null as Promise<void>|null,
  path:"protected" as "protected"|"public"|"not-a-page",
}));
vi.mock("@solidjs/start/middleware",()=>({
  createMiddleware:(x:unknown)=>x,
}));
vi.mock("./server/sync",()=>({ensureSyncStarted:()=>{}}));
vi.mock("./server/vault/indexer",()=>({ensureIndexerStarted:()=>{}}));
vi.mock("./server/discovery",()=>({
  discoveryEndpoint:(path:string)=>
    path==="/.well-known/openid-configuration"?"openid":null,
}));
vi.mock("./server/pages",()=>({pageAccess:()=>state.path}));
vi.mock("./server/reset",()=>({announceResetFlow:()=>{}}));
vi.mock("./server/headers",()=>({applySecurityHeaders:()=>{}}));
vi.mock("./server/mcp/endpoint",()=>({protectedResourceMetadata:()=>({})}));
vi.mock("./server/cloud-intake",()=>({ensureCloudIntakeStarted:()=>{}}));
vi.mock("./server/market-prices/collector",()=>({ensurePriceCollectorStarted:()=>{}}));
vi.mock("./server/api-paths",()=>({isKnownApiPath:()=>true}));
vi.mock("./server/db",()=>({getSetting:()=> "true"}));
vi.mock("./server/auth",()=>({
  runAuthMigrations:async()=>{state.migrations++;},
  isSetupComplete:async()=>true,
  auth:{api:{getSession:async()=>{
    state.calls++;
    if(state.hold)await state.hold;
    return {user:{id:"fixture-admin"}};
  }}},
}));
vi.mock("@better-auth/oauth-provider",()=>({
  oauthProviderAuthServerMetadata:()=>async()=>Response.json({ok:true}),
  oauthProviderOpenIdConfigMetadata:()=>async()=>{
    state.meta++;
    if(state.hold)await state.hold;
    return Response.json({issuer:"fixture",authorization_response_iss_parameter_supported:true});
  },
}));
import middleware from "./middleware";
import {inProcessDrWriterFence as fence} from "./server/backup/writer-fence";

type Hook=(event:{request:Request})=>Promise<Response|undefined>;
const handler=(middleware as unknown as {onRequest:Hook[]}).onRequest[0];
const ev=(url:string)=>({request:new Request("https://fixture.example"+url)});
beforeEach(()=>{
  state.calls=0;state.migrations=0;state.meta=0;state.hold=null;state.path="protected";
});

it("protects Better Auth dashboard session adapter in real middleware request hook",async()=>{
  await fence.withFrozenWriters(async()=>{
    await expect(handler(ev("/keys"))).rejects.toThrow("backup_writer_freeze_active");
    expect(state.calls).toBe(0);
    expect(fence.status.activeWriters).toBe(0);
  });
  await expect(handler(ev("/keys"))).resolves.toBeUndefined();
  expect(state.calls).toBe(1);
});

it("middleware session remains admitted until async Better Auth adapter resolves",async()=>{
  let release!:()=>void;
  state.hold=new Promise<void>(r=>{release=r;});
  const pending=handler(ev("/keys"));
  await vi.waitFor(()=>expect(state.calls).toBe(1));
  expect(fence.getAdmissionEvidence().activeByClass.better_auth_adapter).toBe(1);
  let captured=false;
  const cut=fence.withFrozenWriters(()=>{captured=true;return true;});
  expect(captured).toBe(false);
  await expect(handler(ev("/keys"))).rejects.toThrow("backup_writer_freeze_active");
  expect(state.calls).toBe(1);
  release();await pending;
  await expect(cut).resolves.toBe(true);
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("protects Better Auth OIDC metadata adapter as an explicit async writer candidate",async()=>{
  state.path="public";
  await fence.withFrozenWriters(async()=>{
    await expect(handler(ev("/.well-known/openid-configuration")))
      .rejects.toThrow("backup_writer_freeze_active");
    expect(state.meta).toBe(0);
  });
  const response=await handler(ev("/.well-known/openid-configuration"));
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({issuer:"fixture"});
  expect(state.meta).toBe(1);
});

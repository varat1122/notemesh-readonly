import { expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({valid:false,name:"",reads:0,verifications:0}));
vi.mock('~/server/auth',()=>({runAuthMigrations:async()=>{},auth:{api:{verifyApiKey:async()=>{state.verifications++;return {valid:state.valid,key:{name:state.name}};}}}}));
vi.mock('~/server/mcp/auth',()=>({bearerToken:(r:Request)=>r.headers.get('authorization')?.slice(7)}));
vi.mock('~/server/mcp/http',()=>({readCappedJson:(r:Request)=>r.json()}));
vi.mock('~/server/intake',()=>({nextIntake:()=>{state.reads++;return null;},acknowledge:()=>({status:'imported'})}));
import {GET, POST} from './intake-worker';
const event=(key?:string)=>({request:new Request('https://fixture.test/api/intake-worker',{headers:key?{Authorization:'Bearer '+key}:{}})}) as Parameters<typeof GET>[0];
it('rejects absent/invalid credentials without reading queue',async()=>{expect((await GET(event())).status).toBe(401);expect((await GET(event('bad'))).status).toBe(401);expect(state.reads).toBe(0);});
it('rejects an ordinary valid research API key',async()=>{state.valid=true;state.name='research';expect((await GET(event('valid'))).status).toBe(401);expect(state.reads).toBe(0);});
it('accepts only the named receiver credential',async()=>{state.name='Investment OS Intake Worker';expect((await GET(event('worker'))).status).toBe(200);expect(state.reads).toBe(1);});
it('disables desktop polling and acknowledgements in cloud mode',async()=>{process.env.CLOUD_INTAKE='1';try{const before=state.reads;const res=await GET(event('worker'));expect(await res.json()).toMatchObject({item:null,desktopReceiverDisabled:true});expect(state.reads).toBe(before);expect((await POST(event('worker'))).status).toBe(409);}finally{delete process.env.CLOUD_INTAKE;}});

it("DR P2.8 refuses intake Better Auth verification before adapter invocation during freeze",async()=>{
  const {inProcessDrWriterFence:fence}=await import("~/server/backup/writer-fence");
  const verifications=state.verifications,reads=state.reads;
  await fence.withFrozenWriters(async()=>{
    expect((await GET(event("worker"))).status).toBe(401);
    expect((await POST(event("worker"))).status).toBe(401);
    expect(state.verifications).toBe(verifications);
    expect(state.reads).toBe(reads);
    expect(fence.status.activeWriters).toBe(0);
  });
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

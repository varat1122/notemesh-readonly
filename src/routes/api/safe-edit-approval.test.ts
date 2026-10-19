import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({
  signedIn:true,
  approvals:[] as unknown[],
  sessionCalls:0,
  sessionHold:null as Promise<void>|null,
  sessionFails:false,
}));
vi.mock("~/server/auth",()=>({
  runAuthMigrations:async()=>{},
  auth:{api:{getSession:async()=>{
    state.sessionCalls++;
    if(state.sessionHold)await state.sessionHold;
    if(state.sessionFails)throw Error("synthetic_auth_adapter_failed");
    return state.signedIn?{user:{id:"synthetic-human"}}:null;
  }}},
}));
vi.mock("~/server/env",()=>({env:{baseUrl:"https://approval-fixture.test"}}));
vi.mock("~/server/safe-edit/engine",()=>({adminPreview:()=>({afterHash:"a".repeat(64),diff:{added:["<script>grant edit</script>"]}}),approve:(...args:unknown[])=>state.approvals.push(args)}));
import { GET, POST } from "./safe-edit-approval";
import { inProcessDrWriterFence as fence } from "~/server/backup/writer-fence";
const event=(request:Request)=>({request}) as Parameters<typeof GET>[0];
beforeEach(()=>{state.signedIn=true;state.approvals=[];state.sessionCalls=0;state.sessionHold=null;state.sessionFails=false;});
it("rejects unauthenticated viewing and approval",async()=>{state.signedIn=false;expect((await GET(event(new Request("https://approval-fixture.test/api/safe-edit-approval?id=example")))).status).toBe(401);expect((await POST(event(new Request("https://approval-fixture.test/api/safe-edit-approval",{method:"POST",headers:{Origin:"https://approval-fixture.test"},body:"id=synthetic&hash=x"})))).status).toBe(401);expect(state.approvals).toEqual([]);});
it("escapes hostile note text and blocks script/framing through CSP",async()=>{const r=await GET(event(new Request("https://approval-fixture.test/api/safe-edit-approval?id=synthetic")));const html=await r.text();expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'none'");expect(r.headers.get("Cache-Control")).toBe("no-store");});
it.each([undefined,"https://attacker.test"])("requires exact same origin for approval: %s",async origin=>{const r=await POST(event(new Request("https://approval-fixture.test/api/safe-edit-approval",{method:"POST",headers:origin?{Origin:origin}:{},body:"id=synthetic&hash=x"})));expect(r.status).toBe(403);expect(state.approvals).toEqual([]);});
it("stores exact hash approval only from the authenticated user",async()=>{const r=await POST(event(new Request("https://approval-fixture.test/api/safe-edit-approval",{method:"POST",headers:{Origin:"https://approval-fixture.test","Content-Type":"application/x-www-form-urlencoded"},body:`id=synthetic&hash=${"a".repeat(64)}`})));expect(r.status).toBe(200);expect(state.approvals).toEqual([["synthetic","synthetic-human","a".repeat(64)]]);});
it("caps chunked approval requests before parsing",async()=>{const r=await POST(event(new Request("https://approval-fixture.test/api/safe-edit-approval",{method:"POST",headers:{Origin:"https://approval-fixture.test","Content-Type":"application/json"},body:"x".repeat(2001)})));expect(r.status).toBe(400);expect(state.approvals).toEqual([]);});

const approvalGet=()=>GET(event(new Request("https://approval-fixture.test/api/safe-edit-approval?id=fixture")));
const approvalPost=()=>POST(event(new Request("https://approval-fixture.test/api/safe-edit-approval",{
  method:"POST",
  headers:{Origin:"https://approval-fixture.test","Content-Type":"application/x-www-form-urlencoded"},
  body:`id=fixture&hash=${"a".repeat(64)}`,
})));

it("rejects both approval session adapters while frozen, before adapter side effects",async()=>{
  await fence.withFrozenWriters(async()=>{
    await expect(approvalGet()).rejects.toThrow("backup_writer_freeze_active");
    await expect(approvalPost()).rejects.toThrow("backup_writer_freeze_active");
    expect(state.sessionCalls).toBe(0);
    expect(state.approvals).toEqual([]);
    expect(fence.status).toEqual({frozen:true,activeWriters:0});
  });
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it.each(["GET","POST"] as const)(
  "holds %s approval session ticket for its entire awaited Better Auth adapter lifetime",
  async method=>{
    let resume!:()=>void;
    state.sessionHold=new Promise<void>(resolve=>{resume=resolve;});
    const request=method==="GET"?approvalGet:approvalPost;
    const pending=request();
    await vi.waitFor(()=>expect(state.sessionCalls).toBe(1));
    expect(fence.getAdmissionEvidence().activeByClass.better_auth_adapter).toBe(1);
    let captured=false;
    const snapshot=fence.withFrozenWriters(()=>{captured=true;return "after_adapter";},{drainTimeoutMs:5000});
    expect(fence.status.frozen).toBe(true);
    expect(captured).toBe(false);
    await expect(request()).rejects.toThrow("backup_writer_freeze_active");
    expect(state.sessionCalls).toBe(1);
    resume();
    const response=await pending;
    expect(response.status).toBe(200);
    await expect(snapshot).resolves.toBe("after_adapter");
    expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
    if(method==="POST")expect(state.approvals).toEqual([["fixture","synthetic-human","a".repeat(64)]]);
  },
);

it("cleans up the async approval session ticket on adapter rejection so freeze can finish",async()=>{
  state.sessionFails=true;
  let resume!:()=>void;
  state.sessionHold=new Promise<void>(resolve=>{resume=resolve;});
  const pending=approvalGet();
  await vi.waitFor(()=>expect(state.sessionCalls).toBe(1));
  let captured=false;
  const snapshot=fence.withFrozenWriters(()=>{captured=true;return "after_failed_adapter";},{drainTimeoutMs:5000});
  expect(captured).toBe(false);
  resume();
  await expect(pending).rejects.toThrow("synthetic_auth_adapter_failed");
  await expect(snapshot).resolves.toBe("after_failed_adapter");
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
});

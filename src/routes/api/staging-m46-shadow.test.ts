import {vi,it,expect,beforeEach} from "vitest";
const state=vi.hoisted(()=>({signedIn:true,scope:true}));
vi.mock("~/server/auth",()=>({
 runAuthMigrations:async()=>{},
 auth:{api:{getSession:async()=>state.signedIn?{user:{id:"m46-fixture-owner"}}:null}}
}));
vi.mock("~/server/safe-edit/git-pilot-policy",()=>({
 assertGitPilot:()=>{if(!state.scope)throw Error("not staging")},
}));
vi.mock("~/server/backup/writer-fence",()=>({
 inProcessDrWriterFence:{withWrite:async(fn:()=>unknown)=>fn()},
}));
import {GET,POST} from "./staging-m46-shadow";
const event=(request:Request)=>({request}) as Parameters<typeof GET>[0];
beforeEach(()=>{state.signedIn=true;state.scope=true});
it("does not expose M4.6 shadow to unsigned or off-scope callers",async()=>{
 state.signedIn=false;expect((await GET(event(new Request("https://staging.test/api/staging-m46-shadow")))).status).toBe(401);
 state.signedIn=true;state.scope=false;expect((await GET(event(new Request("https://staging.test/api/staging-m46-shadow")))).status).toBe(403);
});
it("GET shows exact immutable shadow manifest with no writable control",async()=>{
 const r=await GET(event(new Request("https://staging.test/api/staging-m46-shadow")));
 const h=await r.text();
 expect(r.status).toBe(200);
 expect(h).toContain("NO AUTOMATIC WRITE");
 expect(h).toContain("M4.6 NVDA real-news");
 expect(h).toContain("KYEC");
 expect(h).not.toContain('method="post"');
 expect(h).not.toContain('value="apply"');
 expect(r.headers.get("Cache-Control")).toBe("no-store");
 expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
});
it("POST is fail-closed by default; Origin, session and feature gate block writes",async()=>{
 const r=await POST(event(new Request("https://staging.test/api/staging-m46-shadow",{method:"POST",body:"apply=true"})));
 expect([403,405]).toContain(r.status);
});

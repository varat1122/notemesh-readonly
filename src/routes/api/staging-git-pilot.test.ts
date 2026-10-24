import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({
  signedIn:true, pilotEnabled:true, approved:false, expired:false, receiptStatus:"preview",
  previewCalls:[] as unknown[], applyCalls:[] as unknown[],
}));
vi.mock("~/server/auth",()=>({
  runAuthMigrations:async()=>{},
  auth:{api:{getSession:async()=>state.signedIn?{user:{id:"fixture-admin"}}:null}},
}));
vi.mock("~/server/env",()=>({env:{baseUrl:"https://staging-fixture.test"}}));
vi.mock("~/server/safe-edit/git-pilot-policy",()=>({
  note:"PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md",
  assertGitPilot:()=>{if(!state.pilotEnabled) throw Error("not staging");},
}));
vi.mock("~/server/safe-edit/git-pilot",()=>({
  previewGitPilot:async(p:unknown,actor:string)=>{
    state.previewCalls.push({p,actor});
    return {
      operationId:(p as {operationId:string}).operationId,
      path:"PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md",
      status:"preview",
      beforeHash:"e".repeat(64), afterHash:"a".repeat(64),
      previewToken:"d".repeat(64), requiresAdminApproval:true,
      approvalUrl:"https://staging-fixture.test/api/safe-edit-approval?id=fixture",
      expiresAt:"2099-01-01T00:00:00.000Z",
      diff:{added:["<script>untrusted note</script>"],removed:[]},warnings:[],
    };
  },
  applyGitPilot:async(p:unknown,actor:string)=>{
    state.applyCalls.push({p,actor});
    return {operationId:(p as {operationId:string}).operationId,
      status:"written",path:"PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md",
      beforeHash:"e".repeat(64),afterHash:"a".repeat(64),
      receipt:{gitPilot:{state:"verified",commit:"f".repeat(40)}}};
  },
}));
vi.mock("~/server/safe-edit/engine",()=>({
  adminPreview:()=>({path:"PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md",approved:state.approved,requiresAdminApproval:true,expiresAt:state.expired?"2000-01-01T00:00:00.000Z":"2099-01-01T00:00:00.000Z",beforeHash:"e".repeat(64),afterHash:"a".repeat(64)}),
  status:(id:string,actor:string)=>({
    operationId:id,path:"PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md",
    status:state.receiptStatus, approved:state.approved,
    requiresAdminApproval:true,
    expiresAt:"2099-01-01T00:00:00.000Z",
    beforeHash:"e".repeat(64),afterHash:"a".repeat(64),
    actor
  }),
}));
import {GET,POST} from "./staging-git-pilot";
const url="https://staging-fixture.test/api/staging-git-pilot";
const event=(request:Request)=>({request}) as Parameters<typeof GET>[0];
const get=()=>GET(event(new Request(url)));
const post=(data:URLSearchParams, origin:string|null="https://staging-fixture.test")=>
  POST(event(new Request(url,{method:"POST",
    headers:origin===null?{}:{Origin:origin},
    body:data
  })));
const start=()=>post(new URLSearchParams({action:"preview"}));
const applyForm=(id="pilot001-owner-0123456789abcdef0123")=>
  new URLSearchParams({action:"apply",operationId:id,previewToken:"d".repeat(64),expectedHash:"e".repeat(64)});
const checkForm=()=>new URLSearchParams({...Object.fromEntries(applyForm()),action:"check"});
beforeEach(()=>{state.signedIn=true;state.pilotEnabled=true;state.approved=false;state.expired=false;
  state.receiptStatus="preview";state.previewCalls=[];state.applyCalls=[];});
it("GET never creates preview, requires login and the exact staging policy",async()=>{
  state.signedIn=false;expect((await get()).status).toBe(401);
  state.signedIn=true;state.pilotEnabled=false;expect((await get()).status).toBe(403);
  state.pilotEnabled=true;const r=await get();expect(r.status).toBe(200);
  expect(await r.text()).toContain("Prepare preview");
  expect(state.previewCalls).toHaveLength(0);
  expect(state.applyCalls).toHaveLength(0);
  expect(r.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(r.headers.get("Cache-Control")).toBe("no-store");
  expect(r.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
});
it("rejects POST without same Origin and rejects unauthenticated or off-scope POST",async()=>{
  expect((await post(new URLSearchParams({action:"preview"}),null)).status).toBe(403);
  expect((await post(new URLSearchParams({action:"preview"}),"https://evil.test")).status).toBe(403);
  state.signedIn=false;expect((await start()).status).toBe(401);
  state.signedIn=true;state.pilotEnabled=false;expect((await start()).status).toBe(403);
  expect(state.previewCalls).toHaveLength(0);
  expect(state.applyCalls).toHaveLength(0);
});
it("owner explicitly starts preview, never writes and never executes untrusted HTML",async()=>{
  const r=await start();expect(r.status).toBe(200);
  const h=await r.text();
  expect(h).toContain("Staging one-note Git Pilot — Review");
  expect(h).toContain("&lt;script&gt;untrusted note&lt;/script&gt;");
  expect(h).not.toContain("<script>");
  expect(h).toContain("Admin Approval: NOT YET VERIFIED");
  expect(h).toContain('name="action" value="check"');
  expect(h).not.toContain('name="action" value="apply"');
  expect(h).toContain('name="previewToken"');
  expect(h).toContain('name="expectedHash"');
  expect(h).toContain('name="operationId"');
  expect(h).toContain('target="_blank" rel="noopener noreferrer"');
  expect(state.previewCalls).toHaveLength(1);
  expect(state.applyCalls).toHaveLength(0);
  const {p,actor}=state.previewCalls[0] as {p:{operationId:string;path:string;change:{kind:string;content:string}},actor:string};
  expect(actor).toBe("staging-owner-pilot:fixture-admin");
  expect(p.path).toBe("PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md");
  expect(p.change.kind).toBe("create");
  expect(p.operationId).toMatch(/^pilot001-owner-[a-f0-9]{20}$/);
  expect(p.change.content).toContain("Synthetic operational test");
});
it("checks approval without write; only reveals Apply for this exact operation after admin approval",async()=>{
  const initial=await start();expect(initial.status).toBe(200);
  const early=await post(checkForm());expect(early.status).toBe(200);
  expect(await early.text()).toContain("NOT YET VERIFIED");
  const unapproved=await post(applyForm());expect(unapproved.status).toBe(200);
  expect(await unapproved.text()).not.toContain('name="action" value="apply"');
  expect(state.applyCalls).toHaveLength(0);
  state.approved=true;
  const checked=await post(checkForm());expect(checked.status).toBe(200);
  const approvedHtml=await checked.text();
  expect(approvedHtml).toContain("VERIFIED for this exact preview");
  expect(approvedHtml).toContain('name="action" value="apply"');
  expect(state.previewCalls).toHaveLength(1); // never generates new preview on check
  expect(state.applyCalls).toHaveLength(0); // no auto-apply
});
it("with exact approved preview an explicit owner POST can invoke existing Git Pilot gates",async()=>{
  state.approved=true;
  const r=await post(applyForm());expect(r.status).toBe(200);
  const html=await r.text();
  expect(html).toContain("verified");
  expect(state.applyCalls).toHaveLength(1);
  const x=state.applyCalls[0] as {p:{operationId:string;previewToken:string;expectedHash:string},actor:string};
  expect(x.p.operationId).toBe("pilot001-owner-0123456789abcdef0123");
  expect(x.p.expectedHash).toBe("e".repeat(64));
  expect(x.actor).toBe("staging-owner-pilot:fixture-admin");
});
it("refuses invalid operation IDs, missing token, duplicate terminal or unrecognized actions",async()=>{
  state.approved=true;
  expect((await post(applyForm("pilot001-git-20261024-002"))).status).toBe(400);
  const noToken=applyForm();noToken.delete("previewToken");
  expect((await post(noToken)).status).toBe(400);
  state.receiptStatus="written";
  expect((await post(applyForm())).status).toBe(409);
  state.receiptStatus="preview";state.expired=true;
  expect((await post(checkForm())).status).toBe(409);
  expect((await post(new URLSearchParams({action:"other"}))).status).toBe(400);
  expect(state.applyCalls).toHaveLength(0);
});
it("rejects oversized POST bodies before making a preview",async()=>{
  const r=await post(new URLSearchParams({action:"preview",junk:"x".repeat(3000)}));
  expect(r.status).toBe(400);
  expect(state.previewCalls).toHaveLength(0);
});

const research=vi.hoisted(()=>({calls:[] as {action:string;actor:string}[],approved:false}));
vi.mock("~/server/safe-edit/owner-research",()=>{
 const view=()=>({analysis:{beforeHash:"e".repeat(64)},timeline:{beforeHash:"e".repeat(64)},reviewHash:"a".repeat(64),previews:["analysis","timeline"].map(kind=>({path:kind,approved:research.approved,status:"preview",expiresAt:"2099-01-01",approvalUrl:"https://staging-fixture.test/api/safe-edit-approval?id="+kind,diff:{added:["<script>untrusted</script>"]}}))});
 return {
  assertOwnerResearch:()=>{if(!state.pilotEnabled)throw Error("off");},
  ownerResearchStatus:(_root:string,actor:string)=>{research.calls.push({action:"status",actor});return view();},
  previewOwnerResearch:async(_input:unknown,actor:string)=>{research.calls.push({action:"preview",actor});return {analysis:{operationId:"m4-fixture-analysis",previewToken:"a".repeat(64)},timeline:{previewToken:"b".repeat(64)},context:{synthetic:true}};},
  applyOwnerResearch:async(_input:unknown,actor:string)=>{research.calls.push({action:"apply",actor});return {status:"owner_research_git_and_graph_verified"};},
 };
});
import {GET as researchGet,POST as researchPost} from "./staging-research-review";
const researchURL="https://staging-fixture.test/api/staging-research-review";
const researchForm=(action:string)=>new URLSearchParams({action,package:'{}',operationRoot:"m4-fixture",token0:"a".repeat(64),token1:"b".repeat(64)});
const researchRequest=(action:string,origin="https://staging-fixture.test")=>researchPost(event(new Request(researchURL,{method:"POST",headers:{Origin:origin},body:researchForm(action)})));
it("M4 transport enforces session, gate, exact Origin and bounded import before invoking any preview",async()=>{
 research.calls=[];research.approved=false;
 state.signedIn=false;expect((await researchGet(event(new Request(researchURL)))).status).toBe(401);
 expect((await researchRequest("import")).status).toBe(401);
 state.signedIn=true;expect((await researchRequest("import","https://attacker.test")).status).toBe(403);
 state.pilotEnabled=false;expect((await researchRequest("import")).status).toBe(403);
 state.pilotEnabled=true;
 expect((await researchPost(event(new Request(researchURL,{method:"POST",headers:{Origin:"https://staging-fixture.test"},body:new URLSearchParams({action:"import",package:"x".repeat(512001)})})))).status).toBe(400);
 expect(research.calls).toEqual([]);
});
it("M4 import escapes the full diff, never approves/applies automatically and never fabricates an OAuth actor",async()=>{
 research.calls=[];research.approved=false;
 const r=await researchRequest("import"),body=await r.text();expect(r.status).toBe(200);
 expect(body).toContain("&lt;script&gt;untrusted&lt;/script&gt;");expect(body).not.toContain('<script>');
 expect(body).not.toContain('value="apply"');expect(body).toContain('value="check"');
 expect(research.calls[0]).toEqual({action:"preview",actor:"staging-owner-research:fixture-admin"});
 expect(research.calls.some(c=>c.action==="apply")).toBe(false);
 research.approved=true;
 const check=await researchRequest("check");expect(await check.text()).toContain('value="apply"');
 expect(research.calls.some(c=>c.action==="apply")).toBe(false);
 expect((await researchRequest("apply")).status).toBe(200);
 expect(research.calls.filter(c=>c.action==="apply")).toHaveLength(1);
});

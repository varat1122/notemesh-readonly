import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpAccess } from "./server";
// Only the daemon control is stubbed; transport, filesystem, database, OAuth
// handler enforcement and engine are real. The production daemon is not run.
vi.mock("../safe-edit/sync",()=>({withPausedSync:async(run:()=>unknown)=>run()}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"safe-edit-mcp-"));
process.env.DATA_DIR=root;process.env.BASE_URL="https://safe-fixture.test";
process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
const access:McpAccess={read:true,write:false,label:"oauth:edit-fixture",scopes:["vault:read","vault:edit"]};
const toolsList=["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","rollback_edit","archive_original_source","store_user_attachment","inspect_user_attachment","inspect_coordinated_writeback","preview_investment_intake_stage"];
const args={operationId:"mcp-synthetic-01",path:"Synthetic.md",reason:"Synthetic MCP test",change:{kind:"replace",oldText:"Old data",newText:"New data"}};
beforeEach(()=>{fs.mkdirSync(path.join(root,"vault"),{recursive:true});fs.writeFileSync(path.join(root,"vault","Synthetic.md"),"# Synthetic\nOld data\n");});
afterAll(async()=>{(await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function connected(a:McpAccess) {
 const {createSafeEditMcpServer}=await import("./safe-edit-server");const server=createSafeEditMcpServer(a),client=new Client({name:"test",version:"1"});const [l,r]=InMemoryTransport.createLinkedPair();await server.connect(r);await client.connect(l);return {client,close:async()=>{await client.close();await server.close();}};
}
function unpack(result:any){const b=JSON.parse(result.content[0].text);return JSON.parse(b.result.split("\n").slice(1,-1).join("\n"));}
it("discovers exactly twelve scoped tools with accurate write annotations",async()=>{
 const c=await connected(access);try{const {tools}=await c.client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());for(const t of tools){expect(t._meta?.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);expect(t.annotations?.readOnlyHint).toBe(t.name!=="apply_edit"&&t.name!=="archive_original_source"&&t.name!=="store_user_attachment");}}finally{await c.close();}
});
it.each([
 {...access,scopes:["vault:read"]},{...access,scopes:["vault:read","inbox:submit"]},
 {...access,scopes:["vault:write"]},{...access,label:"api-key:general"},{...access,scopes:undefined},
])("enforces OAuth scopes again inside handlers: %j",async a=>{
 const c=await connected(a);try{for(const name of ["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","rollback_edit","archive_original_source","store_user_attachment","inspect_user_attachment","inspect_coordinated_writeback","preview_investment_intake_stage"]){
 const params:Record<string,unknown>=name==="preview_edit"?{...args}:name==="apply_edit"?{operationId:args.operationId,previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}:name==="get_edit_status"?{operationId:args.operationId}:name==="archive_original_source"?{url:"https://www.sec.gov/Archives/sample"}:name==="store_user_attachment"?{base64:"AAAA".repeat(8),contentType:"image/png"}:name==="inspect_user_attachment"?{sha256:"a".repeat(64),contentType:"image/png"}:name==="inspect_coordinated_writeback"?{planId:"IN-0123456789ABCDEF"}:name==="preview_investment_intake_stage"?{stage:"raw_input",domain:"company",entities:["MDB"],topic:"test",inputFormat:"text",sourceKind:"user_commentary",extractedText:"Test raw source"}:name==="append_section"?{...args,change:undefined,heading:"Synthetic",content:"x",date:"2026-10-16"}:name==="create_note"?{...args,change:undefined,content:"new"}:name==="update_frontmatter"?{...args,change:undefined,properties:{updated:null}}:{...args,change:undefined,rollbackOperationId:args.operationId};delete params.change;
 if(name==="preview_edit")params.change=args.change;
 const result=await c.client.callTool({name,arguments:params});expect(result.isError,name).toBe(true);expect(JSON.stringify(result._meta),name).toContain("insufficient_scope");
 }expect(fs.readFileSync(path.join(root,"vault","Synthetic.md"),"utf8")).toContain("Old data");}finally{await c.close();}
});
it("enforces HTTP 403 and exact metadata challenge for research, inbox, legacy write and API keys",async()=>{
 const {serveMcp}=await import("./http");for(const a of [{...access,scopes:["vault:read"]},{...access,scopes:["vault:read","inbox:submit"]},{...access,scopes:["vault:write"]},{...access,label:"api-key:general"}]){const r=await serveMcp(new Request("https://safe-fixture.test/api/safe-edit",{method:"POST"}),a,"safe-edit");expect(r.status).toBe(403);expect(r.headers.get("WWW-Authenticate")).toContain('scope="vault:read vault:edit"');}
});
it("real HTTP MCP preview/apply/readback/status succeeds on a synthetic note",async()=>{
 const {serveMcp}=await import("./http");
 async function call(method:string,params:unknown){const r=await serveMcp(new Request("https://safe-fixture.test/api/safe-edit",{method:"POST",headers:{Host:"safe-fixture.test","Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})}),access,"safe-edit");const text=await r.text();expect(r.status,text).toBe(200);return JSON.parse(text.split("\n").find(l=>l.startsWith("data: "))?.slice(6)??text).result;}
 const listed=await call("tools/list",{});for(const t of listed.tools)expect(t.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);
 const result=await call("tools/call",{name:"preview_edit",arguments:args});expect(result.isError).not.toBe(true);const p=unpack(result);
 const applied=await call("tools/call",{name:"apply_edit",arguments:{operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash}});expect(applied.isError).not.toBe(true);expect(unpack(applied).receipt.readback).toBe("verified");
 expect(fs.readFileSync(path.join(root,"vault","Synthetic.md"),"utf8")).toContain("New data");
 const receipt=await call("tools/call",{name:"get_edit_status",arguments:{operationId:p.operationId}});expect(unpack(receipt).status).toBe("written");
});

it("reads only the actor-scoped coordinated writeback journal; absence never means write succeeded",async()=>{
 const c=await connected(access);
 try{
   const call=await c.client.callTool({name:"inspect_coordinated_writeback",
     arguments:{planId:"IN-0123456789ABCDEF"}});
   expect(call.isError).not.toBe(true);
   const result=unpack(call);
   expect(result.status).toBe("actor_scoped_safe_edit_journal_inspection_only");
   expect(result.stages.map((x:{state:string})=>x.state)).toEqual([
     "not_found_or_not_owned","not_found_or_not_owned","not_found_or_not_owned"
   ]);
   expect(result.gates.canAutoWrite).toBe(false);
   expect(result.gates.canAutoUpdateThesis).toBe(false);
   expect(result.warnings.join(" ")).toContain("remote/mobile Sync remains unverified");
 }finally{await c.close();}
});
it("reads actual coordinated raw Safe Edit preview/apply receipt and isolates a different OAuth actor",async()=>{
 const planId="IN-0123456789ABCDEF";
 const operationId="ios_in-0123456789abcdef_raw_v1";
 const destination="00_Inbox/ChatGPT/Investment Intake - "+planId+".md";
 fs.mkdirSync(path.join(root,"vault","00_Inbox","ChatGPT"),{recursive:true});
 const c=await connected(access);
 try {
  const p=await c.client.callTool({name:"create_note",arguments:{
    operationId,path:destination,reason:"Synthetic coordinate receipt test",
    content:"# Synthetic source; no external fact verification\\n"
  }});
  expect(p.isError).not.toBe(true);
  const preview=unpack(p);
  const before=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",arguments:{planId}}));
  expect(before.stages[0].state).toBe("preview_pending");
  expect(before.stages[1].state).toBe("not_found_or_not_owned");
  const result=await c.client.callTool({name:"apply_edit",arguments:{
    operationId,previewToken:preview.previewToken,expectedHash:preview.beforeHash
  }});
  expect(result.isError).not.toBe(true);
  const after=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",arguments:{planId}}));
  expect(after.stages[0].state).toBe("locally_verified");
  expect(after.stages[0].receipt.readback).toBe("verified");
  expect(after.stages[0].receipt.reindex).toBe("verified");
  expect(after.stages[0].receipt.mobileSync).toBe("unverified");
  expect(after.stages[1].state).toBe("not_found_or_not_owned");
  const different=await connected({...access,label:"oauth:other-client"});
  try{
   const other=unpack(await different.client.callTool({name:"inspect_coordinated_writeback",arguments:{planId}}));
   expect(other.stages[0].state).toBe("not_found_or_not_owned");
   expect(other.stages[0].path).toBeNull();
  }finally{await different.close();}
 }finally{await c.close();}
});
it("gates text intake source→AI review on real same-actor readback and exact source hash",async()=>{
 fs.mkdirSync(path.join(root,"vault","00_Inbox","ChatGPT"),{recursive:true});
 fs.mkdirSync(path.join(root,"vault","10_Knowledge","Company Research"),{recursive:true});
 const c=await connected(access);
 const args={domain:"company",entities:["MDB"],topic:"Synthetic broker text",
   inputFormat:"text",sourceKind:"archived_chat",
   extractedText:"BofA reiterates Buy $540 — UNVERIFIED source text",
   analysisText:"Need original dated report and old PT; no automatic thesis change.",
   sourceLanguage:"en",publisher:"User-provided snippet"};
 try {
   const before=await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...args,stage:"research_review"}});
   expect(before.isError).toBe(true);
   expect(JSON.stringify(before)).toContain("raw source write/readback/reindex");
   const drafted=await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...args,stage:"raw_input"}});
   expect(drafted.isError).not.toBe(true);
   const raw=unpack(drafted);
   expect(raw.status).toBe("safe_edit_preview_only_not_applied");
   expect(raw.preview.diff.added.join("\n")).toContain(args.extractedText);
   expect(raw.prerequisites.originalPublisherVerified).toBe(false);
   const status=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",
     arguments:{planId:raw.planId}}));
   expect(status.stages[0].state).toBe("preview_pending");
   const applied=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:raw.operationId,previewToken:raw.preview.previewToken,
     expectedHash:raw.preview.beforeHash
   }});
   expect(applied.isError).not.toBe(true);
   const next=await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...args,stage:"research_review"}});
   expect(next.isError).not.toBe(true);
   const research=unpack(next);
   expect(research.status).toBe("safe_edit_preview_only_not_applied");
   expect(research.preview.diff.added.join("\n")).toContain(args.analysisText);
   expect(research.prerequisites.sourceSavedAndIndexed).toBe(true);
   const rechecked=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",
     arguments:{planId:raw.planId}}));
   expect(rechecked.stages[0].state).toBe("locally_verified");
   expect(rechecked.stages[1].state).toBe("preview_pending");
   const originalPath=path.join(root,"vault",raw.preview.path);
   const oldSourceStat=fs.statSync(originalPath);
   fs.utimesSync(originalPath,oldSourceStat.atime,new Date(oldSourceStat.mtimeMs+60_000));
   const indexBlocked=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:research.operationId,previewToken:research.preview.previewToken,
     expectedHash:research.preview.beforeHash
   }});
   expect(indexBlocked.isError).toBe(true);
   expect(JSON.stringify(indexBlocked)).toContain("Coordinated review source index is stale");
   expect(fs.existsSync(path.join(root,"vault",research.preview.path))).toBe(false);
   fs.utimesSync(originalPath,oldSourceStat.atime,oldSourceStat.mtime);
   const altered=await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...args,sourceLanguage:"th",stage:"research_review"}});
   expect(altered.isError).toBe(true);
   expect(JSON.stringify(altered)).toContain("raw source write/readback/reindex");
   const another=await connected({...access,label:"oauth:other-client"});
   try {
     const unauthorized=await another.client.callTool({name:"preview_investment_intake_stage",
       arguments:{...args,stage:"research_review"}});
     expect(unauthorized.isError).toBe(true);
   }finally{await another.close();}
   const analysisPath=research.preview.path;
   expect(fs.existsSync(path.join(root,"vault",analysisPath))).toBe(false);
   fs.appendFileSync(path.join(root,"vault",raw.preview.path),"\nChanged after the original readback.");
   const staleJournal=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",
     arguments:{planId:raw.planId}}));
   expect(staleJournal.stages[0].state).toBe("stale_local_bytes");
   expect(staleJournal.stages[0].receipt.readback).toBe("verified");
   expect(staleJournal.stages[1].state).toBe("preview_pending");
   const stale=await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...args,stage:"research_review"}});
   expect(stale.isError).toBe(true);
   expect(JSON.stringify(stale)).toContain("Raw source changed after last Safe Edit receipt");
   const staleApply=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:research.operationId,previewToken:research.preview.previewToken,
     expectedHash:research.preview.beforeHash
   }});
   expect(staleApply.isError).toBe(true);
   expect(JSON.stringify(staleApply)).toContain("Coordinated review source changed since its verified write");
   expect(fs.existsSync(path.join(root,"vault",analysisPath))).toBe(false);
 }finally{await c.close();}
});
it("full local text source and separately attributed AI review write both verify and remain distinct",async()=>{
 fs.mkdirSync(path.join(root,"vault","00_Inbox","ChatGPT"),{recursive:true});
 fs.mkdirSync(path.join(root,"vault","10_Knowledge","Company Research"),{recursive:true});
 const c=await connected(access);
 const input={domain:"company",entities:["AMD"],topic:"Synthetic source/review local end-to-end",
   inputFormat:"text",sourceKind:"user_commentary",
   extractedText:"ต้นฉบับผู้ใช้: synthetic data only. No independent issuer evidence.",
   analysisText:"AI Interpretation: ไม่มีข้อมูล primary; ไม่สรุปกำไรหรือ Thesis.",
   sourceLanguage:"th",publisher:"User supplied, not independently verified"};
 try{
   const raw=unpack(await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...input,stage:"raw_input"}}));
   const created=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:raw.operationId,previewToken:raw.preview.previewToken,expectedHash:raw.preview.beforeHash
   }});
   expect(created.isError).not.toBe(true);
   const reviewed=unpack(await c.client.callTool({name:"preview_investment_intake_stage",
     arguments:{...input,stage:"research_review"}}));
   const saved=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:reviewed.operationId,previewToken:reviewed.preview.previewToken,
     expectedHash:reviewed.preview.beforeHash
   }});
   expect(saved.isError).not.toBe(true);
   const applied=unpack(saved);
   expect(applied.receipt.readback).toBe("verified");
   expect(applied.receipt.reindex).toBe("verified");
   const result=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",
     arguments:{planId:raw.planId}}));
   expect(result.stages.map((x:{state:string})=>x.state))
     .toEqual(["locally_verified","locally_verified","not_found_or_not_owned"]);
   const rawBody=fs.readFileSync(path.join(root,"vault",raw.preview.path),"utf8");
   const analysisBody=fs.readFileSync(path.join(root,"vault",reviewed.preview.path),"utf8");
   expect(rawBody).toContain(input.extractedText);
   expect(rawBody).not.toContain(input.analysisText);
   expect(analysisBody).toContain(input.analysisText);
   expect(analysisBody).not.toContain(input.extractedText);
   expect(analysisBody).toContain("original_intake_sha256:");
   expect(analysisBody).toContain("original_source_verified: false");
   expect(analysisBody).toContain("owner_approved_thesis: false");
   expect(result.stages[0].receipt.mobileSync).toBe("unverified");
   // Same bytes but a changed inode mtime can indicate a peer write; the
   // stale index must not be reported as currently verified.
   const srcPath=path.join(root,"vault",raw.preview.path);
   const oldStat=fs.statSync(srcPath);
   fs.utimesSync(srcPath,oldStat.atime,new Date(oldStat.mtimeMs+60_000));
   const drift=unpack(await c.client.callTool({name:"inspect_coordinated_writeback",
     arguments:{planId:raw.planId}}));
   expect(drift.stages[0].state).toBe("stale_local_index");
   expect(drift.stages[1].state).toBe("locally_verified");
 }finally{await c.close();}
});
it("generic create_note/apply cannot bypass coordinated review source identity or actor gates",async()=>{
 fs.mkdirSync(path.join(root,"vault","10_Knowledge","Company Research"),{recursive:true});
 const c=await connected(access);
 try{
   const forged=await c.client.callTool({name:"create_note",arguments:{
     operationId:"ios_in-ffffffffffffffff_review_v1",
     path:"10_Knowledge/Company Research/Investment Review - MDB - IN-FFFFFFFFFFFFFFFF.md",
     reason:"Synthetic guard bypass test",
     content:"# Unsourced research preview with no corresponding original\\n"
   }});
   expect(forged.isError).not.toBe(true);
   const p=unpack(forged);
   const forbidden=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash
   }});
   expect(forbidden.isError).toBe(true);
   expect(JSON.stringify(forbidden)).toContain("Unknown operation");
   expect(fs.existsSync(path.join(root,"vault",p.path))).toBe(false);
 }finally{await c.close();}
});
it("authorized Safe Edit MCP captures exact user PNG binary, inspects hash and cannot overwrite it",async()=>{
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from("user source screenshot exact bytes via authenticated MCP")]);
 const c=await connected(access);
 try{
  const wrote=await c.client.callTool({name:"store_user_attachment",arguments:{base64:bytes.toString("base64"),contentType:"image/png"}});
  expect(wrote.isError).not.toBe(true);
  const asset=unpack(wrote);
  expect(asset.path).toMatch(/^07_Sources\/ChatGPT\/Attachments\/[a-f0-9]{64}\.png$/);
  expect(asset.byteReadbackVerified).toBe(true);
  expect(asset.publisherVerified).toBe(false);
  expect(asset.mobileSyncVerified).toBe(false);
  expect(fs.readFileSync(path.join(root,"vault",asset.path)).equals(bytes)).toBe(true);
  const check=await c.client.callTool({name:"inspect_user_attachment",arguments:{sha256:asset.sha256,contentType:"image/png"}});
  expect(check.isError).not.toBe(true);
  expect(unpack(check).status).toBe("stored_and_readback_verified");
  const again=await c.client.callTool({name:"store_user_attachment",arguments:{base64:bytes.toString("base64"),contentType:"image/png"}});
  expect(unpack(again).duplicate).toBe(true);
 }finally{await c.close();}
});
it("authorized Safe Edit MCP raw archive fetch returns SHA and leaves Obsidian Vault unchanged",async()=>{
 const original=fs.readFileSync(path.join(root,"vault","Synthetic.md"),"utf8");
 const fetchOriginal=globalThis.fetch;
 process.env.SOURCE_ARCHIVE_USER_AGENT="InvestmentOS-Tests/1.0 (authorized test contact@example.org)";
 const sample="<!DOCTYPE html><html><body>Original source bytes from SEC Form 10-Q in a test fixture.</body></html>";
 globalThis.fetch=vi.fn(async()=>new Response(sample,{status:200,headers:{"content-type":"text/html"}})) as unknown as typeof fetch;
 const c=await connected(access);
 try {
   const result=await c.client.callTool({name:"archive_original_source",arguments:{
     url:"https://www.sec.gov/Archives/test-fixture-2026.htm"
   }});
   expect(result.isError).not.toBe(true);
   const out=unpack(result);
   expect(out.status).toBe("archived_fetched_bytes_unverified_publisher");
   expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
   expect(out.byteLength).toBe(Buffer.byteLength(sample));
   expect(out.publisherAuthenticityVerified).toBe(false);
   expect(out.vaultModified).toBe(false);
   expect(fs.readFileSync(path.join(root,"vault","Synthetic.md"),"utf8")).toBe(original);
 }finally{
   await c.close();
   globalThis.fetch=fetchOriginal;
   delete process.env.SOURCE_ARCHIVE_USER_AGENT;
 }
});

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
const toolsList=["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","rollback_edit","archive_original_source","store_user_attachment","inspect_user_attachment"];
const args={operationId:"mcp-synthetic-01",path:"Synthetic.md",reason:"Synthetic MCP test",change:{kind:"replace",oldText:"Old data",newText:"New data"}};
beforeEach(()=>{fs.mkdirSync(path.join(root,"vault"),{recursive:true});fs.writeFileSync(path.join(root,"vault","Synthetic.md"),"# Synthetic\nOld data\n");});
afterAll(async()=>{(await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function connected(a:McpAccess) {
 const {createSafeEditMcpServer}=await import("./safe-edit-server");const server=createSafeEditMcpServer(a),client=new Client({name:"test",version:"1"});const [l,r]=InMemoryTransport.createLinkedPair();await server.connect(r);await client.connect(l);return {client,close:async()=>{await client.close();await server.close();}};
}
function unpack(result:any){const b=JSON.parse(result.content[0].text);return JSON.parse(b.result.split("\n").slice(1,-1).join("\n"));}
it("discovers exactly ten scoped tools with accurate write annotations",async()=>{
 const c=await connected(access);try{const {tools}=await c.client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());for(const t of tools){expect(t._meta?.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);expect(t.annotations?.readOnlyHint).toBe(t.name!=="apply_edit"&&t.name!=="archive_original_source"&&t.name!=="store_user_attachment");}}finally{await c.close();}
});
it.each([
 {...access,scopes:["vault:read"]},{...access,scopes:["vault:read","inbox:submit"]},
 {...access,scopes:["vault:write"]},{...access,label:"api-key:general"},{...access,scopes:undefined},
])("enforces OAuth scopes again inside handlers: %j",async a=>{
 const c=await connected(a);try{for(const name of ["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","rollback_edit","archive_original_source","store_user_attachment","inspect_user_attachment"]){
 const params:Record<string,unknown>=name==="preview_edit"?{...args}:name==="apply_edit"?{operationId:args.operationId,previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}:name==="get_edit_status"?{operationId:args.operationId}:name==="archive_original_source"?{url:"https://www.sec.gov/Archives/sample"}:name==="store_user_attachment"?{base64:"AAAA",contentType:"image/png"}:name==="inspect_user_attachment"?{sha256:"a".repeat(64),contentType:"image/png"}:name==="append_section"?{...args,change:undefined,heading:"Synthetic",content:"x",date:"2026-10-16"}:name==="create_note"?{...args,change:undefined,content:"new"}:name==="update_frontmatter"?{...args,change:undefined,properties:{updated:null}}:{...args,change:undefined,rollbackOperationId:args.operationId};delete params.change;
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

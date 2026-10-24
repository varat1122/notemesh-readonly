import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpAccess } from "./server";
import {evaluatePreparedSyntheticGraphWithTransport}
 from "../vault/offline-synthetic-openai-eval";
// Only the daemon control is stubbed; transport, filesystem, database, OAuth
// handler enforcement and engine are real. The production daemon is not run.
vi.mock("../safe-edit/sync",()=>({withPausedSync:async(run:()=>unknown)=>run()}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"safe-edit-mcp-"));
process.env.DATA_DIR=root;process.env.BASE_URL="https://safe-fixture.test";
process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
const access:McpAccess={read:true,write:false,label:"oauth:edit-fixture",scopes:["vault:read","vault:edit"]};
const digest=(raw:string)=>createHash("sha256").update(raw).digest("hex");
const toolsList=["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","verify_investment_graph_writeback","prepare_investment_graph_review","write_investment_graph_bundle","rollback_edit","archive_original_source","inspect_original_source_archive","get_sync_delivery_evidence","store_user_attachment","inspect_user_attachment"];
const args={operationId:"mcp-synthetic-01",path:"Synthetic.md",reason:"Synthetic MCP test",change:{kind:"replace",oldText:"Old data",newText:"New data"}};
beforeEach(()=>{fs.mkdirSync(path.join(root,"vault"),{recursive:true});fs.writeFileSync(path.join(root,"vault","Synthetic.md"),"# Synthetic\nOld data\n");});
afterAll(async()=>{(await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function connected(a:McpAccess) {
 const {createSafeEditMcpServer}=await import("./safe-edit-server");const server=createSafeEditMcpServer(a),client=new Client({name:"test",version:"1"});const [l,r]=InMemoryTransport.createLinkedPair();await server.connect(r);await client.connect(l);return {client,close:async()=>{await client.close();await server.close();}};
}
function unpack(result:any){const b=JSON.parse(result.content[0].text);return JSON.parse(b.result.split("\n").slice(1,-1).join("\n"));}
async function seedGraphEvent(issuer:string,event:string,op:string){
 const company="01_Companies/"+issuer+".md";
 const source="10_Knowledge/Company Research/"+issuer+" - "+event+".md";
 const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - "+issuer+".md";
 const analysis="08_Daily_Weekly/Research Indexes/Investment Review - "+issuer+" - "+event+".md";
 const sourceText="---\nentity: "+issuer+"\nevent_key: "+event+"\nperiod: FY26Q4\nsource_type: user_supplied\nverification: unverified\n---\n# Source\nSynthetic supplied statement.\n";
 const {reindexPath}=await import("../vault/indexer");
 for(const [p,text] of [[company,"---\nentity: "+issuer+"\n---\n# Company\n"],
  [source,sourceText],[timeline,"---\ncompany: "+issuer+"\n---\n# Evolution\nExisting history.\n"]]){
  const abs=path.join(root,"vault",p);fs.mkdirSync(path.dirname(abs),{recursive:true});
  if(!fs.existsSync(abs))fs.writeFileSync(abs,text);
  reindexPath(p);
 }
 return {operationRoot:op,issuer,eventKey:event,period:"FY26Q4",
  timelineDate:"2026-10-21",timelineHeading:"Evolution",analysisPath:analysis,
  timelinePath:timeline,sourcePath:source,expectedSourceSha256:digest(sourceText),
  analysisMarkdown:["---","type: investment_review","entity: "+issuer,
   "event_key: "+event,"operation_id: "+op,"source_type: archived_ai",
   "independent_evidence: false","verification: not_reverified","status: draft",
   "analysis_origin: synthetic_fixture","source_path: "+source,
   "source_sha256: "+digest(sourceText),"---","# Review",
   "<!-- investment-os-operation:"+op+" -->","<!-- investment-os-event:"+event+" -->",
   "Synthetic hypothesis; actual issuer facts remain unverified.",
   ...[source,company,timeline].map(p=>"[["+p.slice(0,-3)+"]]"),""].join("\n"),
 };
}
it.each(["body","frontmatter","size","missing-fts"])("rejects inconsistent Source %s before either graph operation",async field=>{
 const payload=await seedGraphEvent("PFTEST","PF-"+field,"ios-preflight-"+field);
 const database=(await import("../db")).db();
 const before=fs.readFileSync(path.join(root,"vault",payload.timelinePath),"utf8");
 if(field==="body")database.prepare("UPDATE notes_fts SET body='stale source body' WHERE rowid=(SELECT rowid FROM notes WHERE path=?)").run(payload.sourcePath);
 if(field==="frontmatter")database.prepare("UPDATE notes SET frontmatter='{}' WHERE path=?").run(payload.sourcePath);
 if(field==="size")database.prepare("UPDATE notes SET size=size+1 WHERE path=?").run(payload.sourcePath);
 if(field==="missing-fts")database.prepare("DELETE FROM notes_fts WHERE rowid=(SELECT rowid FROM notes WHERE path=?)").run(payload.sourcePath);
 const c=await connected(access);process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED="1";
 try{
  const result=await c.client.callTool({name:"write_investment_graph_bundle",arguments:payload});
  expect(result.isError,JSON.stringify(result)).toBe(true);
  expect(JSON.stringify(result)).toContain("source_physical_index_mismatch_hold");
  expect(fs.existsSync(path.join(root,"vault",payload.analysisPath))).toBe(false);
  expect(fs.readFileSync(path.join(root,"vault",payload.timelinePath),"utf8")).toBe(before);
  expect(database.prepare("SELECT count(*) AS n FROM safe_edit_operations WHERE id IN (?,?)")
   .get(payload.operationRoot+"-analysis",payload.operationRoot+"-timeline")).toEqual({n:0});
  const prepared=await c.client.callTool({name:"prepare_investment_graph_review",arguments:{
   issuer:payload.issuer,eventKey:payload.eventKey,period:payload.period,
   sourcePath:payload.sourcePath,question:"Review original source before writing"}});
  expect(prepared.isError,JSON.stringify(prepared)).toBe(true);
  expect(JSON.stringify(prepared)).toContain("source_physical_index_mismatch_hold");
 }finally{delete process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED;await c.close();}
});
it("verifies Event A after an authenticated Event B append without accepting unreceipted Timeline changes",async()=>{
 const first=await seedGraphEvent("HISTORY","HISTORY-A","ios-history-a-20261021");
 const c=await connected(access);process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED="1";
 try{
  const a=await c.client.callTool({name:"write_investment_graph_bundle",arguments:first});
  expect(a.isError,JSON.stringify(a)).not.toBe(true);
  expect(unpack(a).status).toBe("authorized_two_note_graph_written_and_readback_verified");
  const second=await seedGraphEvent("HISTORY","HISTORY-B","ios-history-b-20261021");
  const b=await c.client.callTool({name:"write_investment_graph_bundle",arguments:second});
  expect(b.isError,JSON.stringify(b)).not.toBe(true);
  expect(unpack(b).status).toBe("authorized_two_note_graph_written_and_readback_verified");
  const args={analysisOperationId:first.operationRoot+"-analysis",timelineOperationId:first.operationRoot+"-timeline",
   analysisPath:first.analysisPath,timelinePath:first.timelinePath,sourcePath:first.sourcePath};
  const verify=()=>c.client.callTool({name:"verify_investment_graph_writeback",arguments:args});
  const current=fs.readFileSync(path.join(root,"vault",first.timelinePath),"utf8");
  const verified=await verify();
  expect(verified.isError,JSON.stringify(verified)).not.toBe(true);
  expect(unpack(verified).historicalWriteReceiptsVerified).toBe(true);
  expect(unpack(verified).currentGraphIntegrityVerified).toBe(true);
  expect(unpack(verified).exactOperationAfterHashesVerified).toBe(false);
  expect(unpack(verified).subsequentAuthenticatedAppendCount).toBe(1);
  const replay=await c.client.callTool({name:"write_investment_graph_bundle",arguments:first});
  expect(replay.isError,JSON.stringify(replay)).not.toBe(true);
  expect(unpack(replay).replayDidNotWrite).toBe(true);
  expect(fs.readFileSync(path.join(root,"vault",first.timelinePath),"utf8")).toBe(current);
  const {reindexPath}=await import("../vault/indexer");
  fs.appendFileSync(path.join(root,"vault",first.timelinePath),"\nUnreceipted edit.\n");reindexPath(first.timelinePath);
  expect((await verify()).isError).toBe(true);
  fs.writeFileSync(path.join(root,"vault",first.timelinePath),current);reindexPath(first.timelinePath);
  const database=(await import("../db")).db();
  database.prepare("UPDATE safe_edit_operations SET actor='oauth:another-client' WHERE id=?").run(second.operationRoot+"-timeline");
  expect((await verify()).isError).toBe(true);
  database.prepare("UPDATE safe_edit_operations SET actor=? WHERE id=?").run(access.label,second.operationRoot+"-timeline");
  expect((await verify()).isError).not.toBe(true);
  const snapshot=database.prepare("SELECT after_text FROM safe_edit_operations WHERE id=?")
   .get(second.operationRoot+"-timeline") as {after_text:string};
  database.prepare("UPDATE safe_edit_operations SET after_text=after_text||'corrupted snapshot' WHERE id=?")
   .run(second.operationRoot+"-timeline");
  expect((await verify()).isError).toBe(true);
  database.prepare("UPDATE safe_edit_operations SET after_text=? WHERE id=?")
   .run(snapshot.after_text,second.operationRoot+"-timeline");
  database.prepare("UPDATE safe_edit_operations SET status='writing' WHERE id=?")
   .run(second.operationRoot+"-timeline");
  expect((await verify()).isError).toBe(true);
  database.prepare("UPDATE safe_edit_operations SET status='written' WHERE id=?")
   .run(second.operationRoot+"-timeline");
  // Even a valid receipt chain cannot excuse a stale current graph index.
  database.prepare("UPDATE notes_fts SET body='stale Timeline' WHERE rowid=(SELECT rowid FROM notes WHERE path=?)")
   .run(first.timelinePath);
  expect((await verify()).isError).toBe(true);
  reindexPath(first.timelinePath);
  // Replacing the old backlink through a legitimate generic Safe Edit is
  // still not an append-only evolution and must hold historical verification.
  const edit=await c.client.callTool({name:"preview_edit",arguments:{
   operationId:"ios-history-replace-20261021",path:first.timelinePath,
   reason:"Synthetic non-append history change",change:{kind:"replace",
    oldText:"Existing history.",newText:"Rewritten history."}}});
  expect(edit.isError,JSON.stringify(edit)).not.toBe(true);
  const ep=unpack(edit);
  const changed=await c.client.callTool({name:"apply_edit",arguments:{
   operationId:ep.operationId,previewToken:ep.previewToken,expectedHash:ep.beforeHash}});
  expect(changed.isError,JSON.stringify(changed)).not.toBe(true);
  expect((await verify()).isError).toBe(true);
 }finally{delete process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED;await c.close();}
});
it("discovers exactly fifteen scoped tools with accurate write annotations",async()=>{
 const c=await connected(access);try{const {tools}=await c.client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());expect(tools.find(t=>t.name==="write_investment_graph_bundle")?.inputSchema.required).toContain("expectedSourceSha256");for(const t of tools){expect(t._meta?.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);expect(t.annotations?.readOnlyHint).toBe(t.name!=="apply_edit"&&t.name!=="write_investment_graph_bundle"&&t.name!=="archive_original_source"&&t.name!=="store_user_attachment");}}finally{await c.close();}
});
it.each([
 {...access,scopes:["vault:read"]},{...access,scopes:["vault:read","inbox:submit"]},
 {...access,scopes:["vault:write"]},{...access,label:"api-key:general"},{...access,scopes:undefined},
])("enforces OAuth scopes again inside handlers: %j",async a=>{
 const c=await connected(a);try{for(const name of ["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","verify_investment_graph_writeback","prepare_investment_graph_review","write_investment_graph_bundle","rollback_edit","archive_original_source","inspect_original_source_archive","get_sync_delivery_evidence","store_user_attachment","inspect_user_attachment"]){
 const params:Record<string,unknown>=name==="preview_edit"?{...args}:name==="apply_edit"?{operationId:args.operationId,previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}:name==="get_edit_status"?{operationId:args.operationId}:name==="prepare_investment_graph_review"?{issuer:"SYNTH",eventKey:"SYNTH-Q3-2026",period:"FY26Q3",sourcePath:"07_Sources/ChatGPT/SYNTH Primary Event.md",question:"Review SYNTH historical evidence"}:name==="write_investment_graph_bundle"?{operationRoot:"ios-bundle-test-guard",issuer:"SYNTH",eventKey:"SYNTH-Q3-2026",period:"FY26Q3",timelineDate:"2026-10-21",timelineHeading:"Evolution",analysisPath:"08_Daily_Weekly/Research Indexes/Investment Review - SYNTH - SYNTH-Q3-2026.md",timelinePath:"08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md",sourcePath:"07_Sources/ChatGPT/SYNTH Primary Event.md",analysisMarkdown:"synthetic sample".repeat(20),expectedSourceSha256:"a".repeat(64)}:name==="verify_investment_graph_writeback"?{analysisOperationId:"ios-test-fy26-analysis",timelineOperationId:"ios-test-fy26-timeline",analysisPath:"08_Daily_Weekly/Research Indexes/Investment Review - SYNTH.md",timelinePath:"08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md",sourcePath:"07_Sources/ChatGPT/SYNTH.md"}:name==="archive_original_source"?{url:"https://www.sec.gov/Archives/sample"}:name==="inspect_original_source_archive"?{url:"https://www.sec.gov/Archives/sample"}:name==="get_sync_delivery_evidence"?{}:name==="store_user_attachment"?{base64:"AAAA".repeat(8),contentType:"image/png"}:name==="inspect_user_attachment"?{sha256:"a".repeat(64),contentType:"image/png"}:name==="append_section"?{...args,change:undefined,heading:"Synthetic",content:"x",date:"2026-10-16"}:name==="create_note"?{...args,change:undefined,content:"new"}:name==="update_frontmatter"?{...args,change:undefined,properties:{updated:null}}:{...args,change:undefined,rollbackOperationId:args.operationId};delete params.change;
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

it("real OAuth Safe Edit two-note apply then independent Obsidian graph readback",async()=>{
 const prefix="08_Daily_Weekly/Research Indexes/";
 const analysis=prefix+"Investment Review - SYNTH - FY26Q3.md";
 const evolution=prefix+"Company Evolution - SYNTH.md";
 const source="07_Sources/ChatGPT/SYNTH Primary Event.md";
 const company="01_Companies/SYNTH.md";
 const op="ios-synth-graph-20261021";
 const e="SYNTH-FY26Q3-NEW";
 const mk="<!-- investment-os-operation:"+op+" -->";
 const evt="<!-- investment-os-event:"+e+" -->";
 const vaultRoot=path.join(root,"vault");
 for(const rel of [evolution,source,company]){
   fs.mkdirSync(path.dirname(path.join(vaultRoot,rel)),{recursive:true});
 }
 fs.writeFileSync(path.join(vaultRoot,source),[
   "---","entity: SYNTH","event_key: "+e,
   "type: research_note","source_type: user_supplied",
   "verification: unverified","---",
   "# User source record","Unverified user supplied source.","",
 ].join("\n"));
 fs.writeFileSync(path.join(vaultRoot,company),
   "---\nentity: SYNTH\ntype: company\n---\n# SYNTH\n");
 fs.writeFileSync(path.join(vaultRoot,evolution),
   "---\nentity: SYNTH\ntype: company_evolution\n---\n# Evolution\nPrior history preserved.\n");
 const {reindexPath}=await import("../vault/indexer");
 for(const p of [source,company,evolution])reindexPath(p);
 const analysisMarkdown=[
   "---","type: investment_review","entity: SYNTH",
   "event_key: "+e,"verification: not_reverified",
   "source_type: archived_ai","analysis_origin: synthetic_ai_draft",
   "independent_evidence: false","status: draft",
   "source_path: "+source,
   "source_sha256: "+digest(fs.readFileSync(path.join(vaultRoot,source),"utf8")),"---",
   "# Review",mk,evt,
   "AI proposal only, not independently verified.",
   "[["+source.slice(0,-3)+"]]",
   "[["+evolution.slice(0,-3)+"]]",
   "[["+company.slice(0,-3)+"]]","",
 ].join("\n");
 const c=await connected(access);
 try{
   const make=await c.client.callTool({name:"create_note",arguments:{
     operationId:op+"-analysis",path:analysis,
     reason:"Verify synthetic closed-loop Analysis create",
     content:analysisMarkdown,
   }});
   expect(make.isError,JSON.stringify(make)).not.toBe(true);
   const planned=unpack(make);
   expect(planned.status).toBe("preview");
   const applyOne=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:planned.operationId,
     previewToken:planned.previewToken,expectedHash:planned.beforeHash,
   }});
   expect(applyOne.isError,JSON.stringify(applyOne)).not.toBe(true);
   expect(unpack(applyOne).receipt.readback).toBe("verified");
   const append=await c.client.callTool({name:"append_section",arguments:{
     operationId:op+"-timeline",path:evolution,
     reason:"Link already saved unverified research into living Company Timeline",
     heading:"Evolution",date:"2026-10-21",
     content:mk+"\n"+evt+"\n- [["+
       analysis.slice(0,-3)+"]] — unverified analysis.",
   }});
   expect(append.isError,JSON.stringify(append)).not.toBe(true);
   const second=unpack(append);
   const applyTwo=await c.client.callTool({name:"apply_edit",arguments:{
     operationId:second.operationId,
     previewToken:second.previewToken,expectedHash:second.beforeHash,
   }});
   expect(applyTwo.isError,JSON.stringify(applyTwo)).not.toBe(true);
   expect(unpack(applyTwo).receipt.reindex).toBe("verified");
   const verified=await c.client.callTool({
     name:"verify_investment_graph_writeback",arguments:{
       analysisOperationId:op+"-analysis",
       timelineOperationId:op+"-timeline",
       analysisPath:analysis,timelinePath:evolution,sourcePath:source,
     },
   });
   expect(verified.isError,JSON.stringify(verified)).not.toBe(true);
   const result=unpack(verified);
   expect(result.status).toBe(
     "authorized_safe_edit_server_graph_readback_verified");
   expect(result.exactOperationAfterHashesVerified).toBe(true);
   expect(result.livingTimelineBacklinkVerified).toBe(true);
   expect(result.fullPathOutgoingWikilinksResolved).toBe(3);
   expect(result.mobileDeviceSyncVerified).toBe(false);
   expect(result.vaultWrittenByVerifier).toBe(false);
   expect(result.originalSourceIndependentlyAuthenticated).toBe(false);
   expect(fs.readFileSync(path.join(vaultRoot,evolution),"utf8"))
     .toContain("Prior history preserved.");
 }finally{await c.close();}
});

it("single host-authorized Investment Graph bundle uses two existing Safe Edit writes, reads back and never repeats",async()=>{
 const company="01_Companies/SYNTH.md";
 const source="10_Knowledge/Company Research/SYNTH Bundle Evidence.md";
 const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md";
 const event="SYNTH-BUNDLE-FY26Q4";
 const rootId="ios-syn-bundle-20261021-a";
 const analysis="08_Daily_Weekly/Research Indexes/Investment Review - SYNTH - "+event+".md";
 const marker="<!-- investment-os-operation:"+rootId+" -->";
 const evt="<!-- investment-os-event:"+event+" -->";
 const vaultRoot=path.join(root,"vault");
 const thesis="05_Thesis/SYNTH - Current Thesis.md";
 const register="05_Thesis/SYNTH - Evidence Register.md";
 const historicalSource="07_Sources/Company Filings/SYNTH Historical Fixture.md";
 const docs=[
  [company,"---\nentity: SYNTH\ntype: company\n---\n# SYNTH\n"],
  [timeline,[
    "---","company: SYNTH","type: company_evolution_timeline","---",
    "# Evolution","Preexisting historical context retained.","",
  ].join("\n")],
  [thesis,"---\nentity: SYNTH\ntype: current_thesis\nverification: not_reverified\n---\n# Current Thesis\nSynthetic prior thesis: delivery conversion remains uncertain.\n"],
  [register,"---\nentity: SYNTH\ntype: evidence_register\nverification: not_reverified\n---\n# Evidence Register\nSynthetic historical evidence and contrary delivery timing.\n"],
  [historicalSource,"---\nentity: SYNTH\nevent_key: SYNTH-HISTORY-FY26Q3\nperiod: FY26Q3\nsource_type: primary\nverification: verified_against_primary\n---\n# Synthetic prior filing fixture\nDeclared primary metadata is test data, not real issuer authentication.\n"],
 ];
 for(const [p,content] of docs){
  fs.mkdirSync(path.dirname(path.join(vaultRoot,p)),{recursive:true});
  fs.writeFileSync(path.join(vaultRoot,p),content);
 }
 const {reindexPath}=await import("../vault/indexer");
 for(const [p] of docs)reindexPath(p);
 const protectedBefore=[thesis,register].map(p=>({path:p,
   hash:digest(fs.readFileSync(path.join(vaultRoot,p),"utf8"))}));
 fs.mkdirSync(path.dirname(path.join(vaultRoot,source)),{recursive:true});
 const markdown=[
  "---","type: investment_review","entity: SYNTH",
  "event_key: "+event,"verification: not_reverified",
  "source_type: archived_ai","analysis_origin: synthetic_ai_draft",
  "independent_evidence: false","status: draft",
  "operation_id: "+rootId,"---",
  "# SYNTH Investment Review",marker,evt,
  "## Causal hypothesis — unverified",
  "Demand may not convert to margin; no verified issuer causality.",
  "## Counter-evidence","Alternative: delivery timing rather than demand.",
  "## Canonical References",
  "[["+source.slice(0,-3)+"]]",
  "[["+timeline.slice(0,-3)+"]]",
  "[["+company.slice(0,-3)+"]]","",
 ].join("\n");
 const payload={operationRoot:rootId,issuer:"SYNTH",eventKey:event,
   period:"FY26Q4",timelineDate:"2026-10-21",
   timelineHeading:"Evolution",analysisPath:analysis,
   timelinePath:timeline,sourcePath:source,analysisMarkdown:markdown};
 const c=await connected(access);
 const network=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{
   throw Error("offline_closed_loop_must_not_call_external_network");
 });
 try{
  // First leg uses ACTUAL Safe Edit preview + host-authorized apply to
  // capture a new source note, NOT direct test filesystem insertion.
  const originalSource=[
    "---","entity: SYNTH","event_key: "+event,"period: FY26Q4",
    "type: research_note","verification: unverified",
    "source_type: user_supplied","event_date: 2026-10-20",
    "published_at: null","received_at: 2026-10-21T09:00:00Z",
    "original_source: synthetic://controlled-source-a","---",
    "# User-supplied source, unverified issuer provenance",
    "Original user statement kept separately from AI analysis.","",
  ].join("\n");
  expect(fs.existsSync(path.join(vaultRoot,source))).toBe(false);
  const capture=await c.client.callTool({name:"create_note",arguments:{
    operationId:"ios-synth-capture-20261021-b",path:source,
    reason:"Source-first capture into existing allowed Company Research folder",
    content:originalSource,
  }});
  expect(capture.isError,JSON.stringify(capture)).not.toBe(true);
  const srcPreview=unpack(capture);
  expect(fs.existsSync(path.join(vaultRoot,source))).toBe(false);
  const captured=await c.client.callTool({name:"apply_edit",arguments:{
    operationId:srcPreview.operationId,previewToken:srcPreview.previewToken,
    expectedHash:srcPreview.beforeHash,
  }});
  expect(captured.isError,JSON.stringify(captured)).not.toBe(true);
  expect(unpack(captured).receipt.reindex).toBe("verified");
  expect(fs.readFileSync(path.join(vaultRoot,source),"utf8"))
    .toBe(originalSource);
  // Existing production timelines can use company: NVDA without entity.
  // Never allow a conflicting extra entity field to masquerade as another issuer.
  const originalTimeline=fs.readFileSync(path.join(vaultRoot,timeline),"utf8");
  fs.writeFileSync(path.join(vaultRoot,timeline),
    originalTimeline.replace("company: SYNTH","company: SYNTH\nentity: OTHER"));
  reindexPath(timeline);
  const conflicted=await c.client.callTool({
   name:"prepare_investment_graph_review",arguments:{
    issuer:"SYNTH",eventKey:event,period:"FY26Q4",sourcePath:source,
    question:"Check canonical issuer scope before writing",
   },
  });
  expect(conflicted.isError).toBe(true);
  expect(JSON.stringify(conflicted)).toContain("review_handoff_living_timeline_wrong_issuer_hold");
  fs.writeFileSync(path.join(vaultRoot,timeline),originalTimeline);
  reindexPath(timeline);
  // Real-Vault indexed source/context preparation runs with WRITE gate disabled.
  const prepared=await c.client.callTool({
   name:"prepare_investment_graph_review",arguments:{
    issuer:"SYNTH",eventKey:event,period:"FY26Q4",sourcePath:source,
    question:"Review synthetic demand conversion, counter-evidence and historical Thesis",focus:"earnings",
   },
  });
  expect(prepared.isError,JSON.stringify(prepared)).not.toBe(true);
  const handoff=unpack(prepared);
  expect(handoff.status).toBe("real_vault_review_context_prepared_no_write");
  expect(handoff.writeAllowedByPreparation).toBe(false);
  expect(handoff.modelAnalysisPerformedByThisTool).toBe(false);
  expect(handoff.vaultModified).toBe(false);
  expect(handoff.canonical.analysisPath).toBe(analysis);
  expect(handoff.canonical.timelinePath).toBe(timeline);
  expect(handoff.canonical.existingTimelineHeadings).toContainEqual({text:"Evolution",level:1});
  expect(handoff.originalSource.declaredSourceType).toBe("user_supplied");
  expect(handoff.originalSource.independentlyAuthenticated).toBe(false);
  expect(handoff.originalSource.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(handoff.historicalContext.status).toBe("retrieval_only_not_verified");
  expect(handoff.historicalContext.items.some((x:any)=>x.path===company)).toBe(true);
  expect(handoff.historicalContext.items).toEqual(expect.arrayContaining([
    expect.objectContaining({path:thesis,role:"thesis"}),
    expect.objectContaining({path:register,role:"evidence_register"}),
    expect.objectContaining({path:historicalSource,role:"source",declaredSourceType:"primary"}),
  ]));
  expect(handoff.canonical.requiredAnalysisSourceMetadata).toEqual({
    source_path:source,source_sha256:handoff.originalSource.sha256,
  });
  // A controlled analysis fixture consumes the actual indexed handoff.
  // No provider runtime, evaluation campaign, budget ledger or key is needed.
  // The existing paid adapter/budget retain their separate opt-in tests.
  let modelCalls=0;
  const fixtureModel="offline-controlled-analysis-fixture";
  // Exercise the user-delivered Markdown through the EXISTING complete
  // Source A/write/readback/Source B case, rather than another pipeline.
  const reviewTemplate=fs.readFileSync(path.resolve(
    "integrations/investment-os-safe-edit/INVESTMENT_REVIEW_TEMPLATE.md"),"utf8");
  const modelTransport=async(_url:string,init:RequestInit)=>{
      modelCalls++;
      const request=JSON.parse(String(init.body));
      const modelInput=JSON.parse(request.input[1].content);
      const pack=modelInput.handoff;
      expect(pack.originalSource.excerpt).toBeTruthy();
      expect(pack.historicalContext.items.length).toBeGreaterThan(0);
      expect(request.tools).toBeUndefined();
      const links=[pack.canonical.sourcePath,pack.canonical.companyPath,pack.canonical.timelinePath];
      const fields:Record<string,string>={
        ISSUER:"SYNTH",EVENT_KEY:pack.eventKey,PERIOD:pack.canonical.proposedWriteFields.period,
        OPERATION_ROOT:modelInput.operationRoot,
        ANALYSIS_ORIGIN:"controlled_offline_fixture",
        SOURCE_PATH:pack.originalSource.path,SOURCE_SHA256:pack.originalSource.sha256,
        EVENT_DATE_YAML:JSON.stringify(pack.originalSource.declaredEventDate),
        PUBLICATION_DATE_YAML:JSON.stringify(pack.originalSource.declaredPublishedAt),
        PROVENANCE:"Controlled user-supplied Source; publication and verification unknown. Not an issuer filing.",
        RESEARCH_SCOPE:"Fundamental / Thesis: delivery conversion over the next reporting period. Fictional SYNTH only.",
        EVIDENCE_ROWS:"| E1 | Original user statement retained separately | Unverified source statement | "+pack.originalSource.path+"; see supplied excerpt |",
        HISTORICAL_CONTEXT:"Prior protected Thesis: delivery conversion uncertain. Historical notes read: "+
          pack.historicalContext.items.map((i:any)=>i.path).join("; ")+
          ". Historical AI remains non-independent; declared primary fixtures are not authenticated filings.",
        EVIDENCE_DELTA:"Unresolved substance; this is a distinct controlled event, not independent confirmation of prior AI.",
        MECHANISMS:"[E1] Demand → delivery conversion is an unverified hypothesis. Shipment, margin and working capital bridge missing; valuation not assessed.",
        COUNTER_EVIDENCE:"Alternative: delivery timing rather than demand. Contrary historical timing remains unresolved.",
        BOTTLENECK_RISKS:"Conversion is a candidate bottleneck only; execution, economic and balance-sheet effects unknown.",
        THESIS_IMPACT:"Unresolved; low confidence because issuer provenance and economics are missing. No protected Thesis change.",
        REQUIRED_EVIDENCE:"Independent issuer original, shipments, cash flow and dated expectation data. Price-in not determined.",
        RELATIONSHIP_ROWS:"| Analysis → Source | cites | E1 provides the input | Current controlled event | proposed citation; no supplier/customer exposure verified |",
        SOURCE_LINK:pack.originalSource.path.slice(0,-3),
        COMPANY_LINK:pack.canonical.companyPath.slice(0,-3),
        TIMELINE_LINK:pack.canonical.timelinePath.slice(0,-3),
        VAULT_ACTIONS:"Create this unverified Analysis and append its link to the existing Timeline only after concrete host authorization. No protected writes.",
      };
      const templateMarkdown=reviewTemplate.replace(/\{\{([A-Z0-9_]+)\}\}/g,(_token,key:string)=>{
        expect(fields[key],"unfilled review template field: "+key).toBeDefined();
        return fields[key];
      });
      expect(templateMarkdown).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
      const review={sourceSha256:pack.originalSource.sha256,classification:"new_event",
        factVersusHypothesis:[{statement:"User supplied an unverified source, not an authenticated issuer filing.",
          status:"source_statement_unverified",citedPaths:[pack.originalSource.path]}],
        causalChain:[{from:"demand",to:"revenue_conversion",
          mechanism:"Demand may fail to become deliveries; no quantified earnings or FCF bridge.",
          evidenceOrMissingBridge:"Shipment, margin, capex and working capital evidence is missing.",
          citedPaths:[pack.originalSource.path]}],
        bottleneckAndThesisImpact:"Conversion is an unverified hypothesis; protected thesis remains unchanged.",
        counterEvidenceAndAlternatives:["Timing rather than demand could explain an apparent change."],
        unsupportedClaimsAndEvidenceNeeded:["Independent original issuer and cash flow evidence required."],
        selectedLinks:links.map(p=>({path:p,relevance:"Required canonical event/source/company context"})),
        historicalAIReused:pack.historicalContext.items.filter((i:any)=>i.role==="analysis").map((i:any)=>i.path),
        historicalAIIsIndependentEvidence:false,marketPriceIn:"not_determined",writeAuthorized:false,
        analysisMarkdown:templateMarkdown,
      };
      return Response.json({id:"resp_graph_"+modelCalls,model:fixtureModel,status:"completed",service_tier:"default",
        usage:{input_tokens:2000,output_tokens:4000,total_tokens:6000,
          input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:2000}},
        output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(review)}]}]});
    };
  const evaluated=await evaluatePreparedSyntheticGraphWithTransport(handoff,rootId,
    "sk-fixture-never-a-real-key",modelTransport,{model:fixtureModel,
      maxOutputTokens:16_384,reasoningEffort:"medium"});
  expect(evaluated.writeAuthorized).toBe(false);
  for(const review of [
    {...evaluated.review,sourceSha256:"0".repeat(64)},
    {...evaluated.review,analysisMarkdown:evaluated.review.analysisMarkdown.replace("independent_evidence: false","independent_evidence: true")},
    {...evaluated.review,analysisMarkdown:evaluated.review.analysisMarkdown+"\n[[01_Companies/INVENTED]]\n"},
  ]){
    await expect(evaluatePreparedSyntheticGraphWithTransport(handoff,rootId,"fake",
      async()=>Response.json({status:"completed",output:[{type:"message",content:[
        {type:"output_text",text:JSON.stringify(review)}]}]})))
      .rejects.toThrow("synthetic_graph_evaluation_");
  }
  const boundPayload={...payload,expectedSourceSha256:handoff.originalSource.sha256,
    analysisMarkdown:evaluated.review.analysisMarkdown,
  };
  const disabled=await c.client.callTool({
   name:"write_investment_graph_bundle",arguments:boundPayload});
  expect(disabled.isError).toBe(true);
  expect(JSON.stringify(disabled)).toContain("admin_explicit_opt_in_required");
  expect(fs.existsSync(path.join(vaultRoot,analysis))).toBe(false);
  process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED="1";
  const missingHash=await c.client.callTool({name:"write_investment_graph_bundle",
    arguments:{...boundPayload,expectedSourceSha256:undefined}});
  expect(missingHash.isError).toBe(true);
  const unbound=await c.client.callTool({name:"write_investment_graph_bundle",
    arguments:{...boundPayload,analysisMarkdown:markdown}});
  expect(unbound.isError).toBe(true);
  expect(JSON.stringify(unbound)).toContain("reviewed_source_binding_missing_or_mismatched_hold");
  expect(fs.existsSync(path.join(vaultRoot,analysis))).toBe(false);
  // Simulate a device/source edit AFTER the model received the source hash.
  // Never allow writing its old analysis based on changed underlying bytes.
  fs.appendFileSync(path.join(vaultRoot,source),"\nUpdated out-of-band source content.\n");
  reindexPath(source);
  const stale=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:boundPayload});
  expect(stale.isError,JSON.stringify(stale)).toBe(true);
  expect(JSON.stringify(stale)).toContain("source_changed_since_context_review_hold");
  expect(fs.existsSync(path.join(vaultRoot,analysis))).toBe(false);
  fs.writeFileSync(path.join(vaultRoot,source),originalSource);
  reindexPath(source);
  const wrote=await c.client.callTool({
   name:"write_investment_graph_bundle",arguments:boundPayload});
  expect(wrote.isError,JSON.stringify(wrote)).not.toBe(true);
  const v=unpack(wrote);
  expect(v.status).toBe(
   "authorized_two_note_graph_written_and_readback_verified");
  expect(v.graph.fullPathOutgoingWikilinksResolved).toBe(3);
  expect(v.graph.livingTimelineBacklinkVerified).toBe(true);
  expect(v.graph.mobileDeviceSyncVerified).toBe(false);
  expect(v.multiNoteAtomicityGuaranteed).toBe(false);
  // Reopen persisted bytes + SQLite/FTS in a fresh process with no provider
  // credentials. This must not rely on the writer's in-memory state.
  const reopened=spawnSync(process.execPath,["--input-type=module","-e",`
    import Database from 'better-sqlite3';
    import fs from 'node:fs';
    import path from 'node:path';
    import {createHash} from 'node:crypto';
    const root=process.argv[1], paths=process.argv.slice(2);
    const db=new Database(path.join(root,'app.sqlite'),{readonly:true,fileMustExist:true});
    const notes=paths.map(p=>{
      const row=db.prepare('SELECT n.path,f.body FROM notes AS n JOIN notes_fts AS f ON f.rowid=n.rowid WHERE n.path=?').get(p);
      if(!row)throw Error('persisted_note_missing');
      const raw=fs.readFileSync(path.join(root,'vault',p));
      return {...row,sha256:createHash('sha256').update(raw).digest('hex')};
    });
    const links=db.prepare('SELECT source_path,resolved_path FROM links WHERE source_path IN (?,?)').all(paths[1],paths[2]);
    console.log(JSON.stringify({integrity:db.pragma('integrity_check',{simple:true}),notes,links}));
    db.close();
  `,root,source,analysis,timeline],{
    cwd:process.cwd(),env:{PATH:process.env.PATH??""},encoding:"utf8",
    timeout:10000,
  });
  expect(reopened.status,reopened.stderr).toBe(0);
  const persisted=JSON.parse(reopened.stdout);
  expect(persisted.integrity).toBe("ok");
  expect(persisted.notes).toEqual(expect.arrayContaining([
    expect.objectContaining({path:source,sha256:handoff.originalSource.sha256}),
    expect.objectContaining({path:analysis,sha256:digest(boundPayload.analysisMarkdown)}),
    expect.objectContaining({path:timeline,sha256:digest(fs.readFileSync(path.join(vaultRoot,timeline),"utf8"))}),
  ]));
  expect(persisted.links).toEqual(expect.arrayContaining([
    expect.objectContaining({source_path:analysis,resolved_path:source}),
    expect.objectContaining({source_path:analysis,resolved_path:timeline}),
    expect.objectContaining({source_path:timeline,resolved_path:analysis}),
  ]));
  const oldTimeline=fs.readFileSync(path.join(vaultRoot,timeline),"utf8");
  expect(oldTimeline).toContain("Preexisting historical context retained.");
  expect(oldTimeline.split(marker)).toHaveLength(2);
  const repeat=await c.client.callTool({
   name:"write_investment_graph_bundle",arguments:boundPayload});
  expect(repeat.isError,JSON.stringify(repeat)).not.toBe(true);
  expect(unpack(repeat).status).toBe(
   "previously_written_both_receipts_graph_reverified");
  expect(fs.readFileSync(path.join(vaultRoot,timeline),"utf8"))
   .toBe(oldTimeline);
  const savedAnalysis=fs.readFileSync(path.join(vaultRoot,analysis),"utf8");
  const verifyArgs={analysisOperationId:v.analysisOperationId,
    timelineOperationId:v.timelineOperationId,analysisPath:analysis,
    timelinePath:timeline,sourcePath:source};
  // A replay must not replace the reviewed version with the new Source hash.
  const revisedSource=originalSource.replace("Original user statement","Modified user statement");
  fs.writeFileSync(path.join(vaultRoot,source),revisedSource);
  const changedSource=await c.client.callTool({name:"verify_investment_graph_writeback",
    arguments:verifyArgs});
  expect(changedSource.isError).toBe(true);
  expect(JSON.stringify(changedSource)).toContain("source_changed_since_review_hold");
  reindexPath(source);
  for(const expectedSourceSha256 of [boundPayload.expectedSourceSha256,digest(revisedSource)]){
    const replay=await c.client.callTool({name:"write_investment_graph_bundle",
      arguments:{...boundPayload,expectedSourceSha256}});
    expect(replay.isError).toBe(true);
  }
  // Restoring bytes alone leaves the changed FTS behind; verification must hold.
  fs.writeFileSync(path.join(vaultRoot,source),originalSource);
  const staleIndex=await c.client.callTool({name:"verify_investment_graph_writeback",
    arguments:verifyArgs});
  expect(staleIndex.isError).toBe(true);
  expect(JSON.stringify(staleIndex)).toContain("physical_markdown_fts_mismatch_hold");
  expect(fs.readFileSync(path.join(vaultRoot,analysis),"utf8")).toBe(savedAnalysis);
  expect(fs.readFileSync(path.join(vaultRoot,timeline),"utf8")).toBe(oldTimeline);
  reindexPath(source);
  const verifiedAgain=await c.client.callTool({name:"verify_investment_graph_writeback",
    arguments:verifyArgs});
  expect(verifiedAgain.isError,JSON.stringify(verifiedAgain)).not.toBe(true);
  expect(unpack(verifiedAgain).reviewedSourceVersionVerified).toBe(true);
  // New event, NO lexical overlap with the prior causal draft: previously
  // saved AI analysis must be retrieved, never promoted to primary evidence.
  const nextEvent="SYNTH-BUNDLE-FY26Q5";
  const nextSource="10_Knowledge/Company Research/SYNTH Next Event.md";
  const nextSourceText=[
    "---","entity: SYNTH","event_key: "+nextEvent,"period: FY26Q5",
    "type: research_note","source_type: user_supplied",
    "verification: unverified","---",
    "# Independent user submission (NOT a verified issuer release)",
    "New unrelated question about warranty provisions.","",
  ].join("\n");
  const nextPreview=await c.client.callTool({name:"create_note",arguments:{
    operationId:"ios-synth-capture-next-20261021-b",
    path:nextSource,reason:"Capture next event separately before retrieving history",
    content:nextSourceText,
  }});
  expect(nextPreview.isError,JSON.stringify(nextPreview)).not.toBe(true);
  const np=unpack(nextPreview);
  const nextApplied=await c.client.callTool({name:"apply_edit",arguments:{
    operationId:np.operationId,previewToken:np.previewToken,
    expectedHash:np.beforeHash,
  }});
  expect(nextApplied.isError,JSON.stringify(nextApplied)).not.toBe(true);
  expect(unpack(nextApplied).receipt.reindex).toBe("verified");
  const next=await c.client.callTool({name:"prepare_investment_graph_review",
   arguments:{issuer:"SYNTH",eventKey:nextEvent,period:"FY26Q5",
    sourcePath:nextSource,question:"Warranty replacement provisions for new contracts",
    focus:"general"}});
  expect(next.isError,JSON.stringify(next)).not.toBe(true);
  const nextPack=unpack(next);
  expect(nextPack.status).toBe("real_vault_review_context_prepared_no_write");
  const historical=nextPack.historicalContext.items.find(
   (x:any)=>x.path===analysis);
  expect(historical?.role).toBe("analysis");
  expect(historical?.declaredSourceType).toBe("archived_ai");
  expect(historical?.declaredIndependentEvidence).toBe(false);
  const nextEvaluated=await evaluatePreparedSyntheticGraphWithTransport(nextPack,
    "ios-next-model-evaluation-20261021","sk-fixture-never-a-real-key",modelTransport,
    {model:fixtureModel,maxOutputTokens:32_768,reasoningEffort:"high"});
  expect(nextEvaluated.review.historicalAIReused).toContain(analysis);
  expect(nextEvaluated.review.historicalAIIsIndependentEvidence).toBe(false);
  expect(modelCalls).toBe(2);
  const recalledPrimary=nextPack.historicalContext.items.find(
    (x:any)=>x.path===historicalSource);
  expect(recalledPrimary?.role).toBe("source");
  expect(recalledPrimary?.declaredSourceType).toBe("primary");
  for(const saved of protectedBefore)
    expect(digest(fs.readFileSync(path.join(vaultRoot,saved.path),"utf8")))
      .toBe(saved.hash);
  expect(network).not.toHaveBeenCalled();
  const same=await c.client.callTool({name:"prepare_investment_graph_review",
   arguments:{issuer:"SYNTH",eventKey:event,period:"FY26Q4",
    sourcePath:source,question:"Review existing event history"}});
  expect(unpack(same).status).toBe("existing_event_or_analysis_requires_duplicate_review_no_write");
 }finally{
  network.mockRestore();
  delete process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED;
  await c.close();
 }
});
it("explicitly authorized partial-graph recovery repairs only an unstarted Timeline write; checks receipts, bytes and duplicates",async()=>{
 const entity="SYNTH",event="SYNTH-RECOVER-FY26Q4",op="ios-synth-recover-20261021-b";
 const base="08_Daily_Weekly/Research Indexes/";
 const company="01_Companies/SYNTH.md";
 const source="07_Sources/ChatGPT/SYNTH Recovery Evidence.md";
 const timeline=base+"Company Evolution - SYNTH.md";
 const analysis=base+"Investment Review - SYNTH - "+event+".md";
 const marker="<!-- investment-os-operation:"+op+" -->";
 const eventMarker="<!-- investment-os-event:"+event+" -->";
 const vaultRoot=path.join(root,"vault");
 const docs=[
  [company,"---\nentity: SYNTH\ntype: company\n---\n# SYNTH\n"],
  [source,[
   "---","entity: SYNTH","event_key: "+event,"period: FY26Q4",
   "type: research_note","source_type: user_supplied",
   "verification: unverified","---","# User-supplied source",
   "Historical data is not independently verified.",""
  ].join("\n")],
  [timeline,"---\nentity: SYNTH\ntype: company_evolution\n---\n# Evolution\nPrevious dated history remains.\n"],
 ];
 const {reindexPath}=await import("../vault/indexer");
 for(const [rel,content] of docs){
  fs.mkdirSync(path.dirname(path.join(vaultRoot,rel)),{recursive:true});
  fs.writeFileSync(path.join(vaultRoot,rel),content);
  reindexPath(rel);
 }
 const markdown=[
  "---","type: investment_review","entity: SYNTH","event_key: "+event,
  "verification: not_reverified","source_type: archived_ai",
  "analysis_origin: synthetic_ai_draft","independent_evidence: false",
  "status: draft","operation_id: "+op,
  "source_path: "+source,
  "source_sha256: "+digest(fs.readFileSync(path.join(vaultRoot,source),"utf8")),"---",
  "# Unverified review",marker,eventMarker,
  "## Causal chain","Demand conversion and revenue remain hypotheses.",
  "## Counter-evidence","Alternative: delivery timing, not demand.",
  "## Exact canonical links",
  "[["+source.slice(0,-3)+"]]",
  "[["+company.slice(0,-3)+"]]",
  "[["+timeline.slice(0,-3)+"]]","",
 ].join("\n");
 const payload={
  operationRoot:op,issuer:entity,eventKey:event,period:"FY26Q4",
  timelineDate:"2026-10-21",timelineHeading:"Evolution",
  analysisPath:analysis,timelinePath:timeline,sourcePath:source,
  analysisMarkdown:markdown,
  expectedSourceSha256:digest(fs.readFileSync(path.join(vaultRoot,source),"utf8")),
 };
 const c=await connected(access);
 process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED="1";
 try{
  // Repair request must not create a first analysis note on its own.
  const early=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:{...payload,recoverTimelineOnly:true}});
  expect(early.isError).toBe(true);
  expect(fs.existsSync(path.join(vaultRoot,analysis))).toBe(false);
  // Reproduce a real persisted first Safe Edit write, with NO Timeline operation.
  const prepared=await c.client.callTool({name:"create_note",arguments:{
   operationId:op+"-analysis",path:analysis,reason:"SYNTH partial-first-write fixture",
   content:markdown,
  }});
  expect(prepared.isError).not.toBe(true);
  const p=unpack(prepared);
  const applied=await c.client.callTool({name:"apply_edit",arguments:{
   operationId:p.operationId,previewToken:p.previewToken,
   expectedHash:p.beforeHash,
  }});
  expect(applied.isError).not.toBe(true);
  expect(unpack(applied).receipt.reindex).toBe("verified");
  const beforeRepair=fs.readFileSync(path.join(vaultRoot,timeline),"utf8");
  const beforeAnalysis=fs.readFileSync(path.join(vaultRoot,analysis),"utf8");
  const beforeSource=fs.readFileSync(path.join(vaultRoot,source),"utf8");
  fs.appendFileSync(path.join(vaultRoot,source),"\nSource changed before recovery.\n");
  reindexPath(source);
  const staleRecovery=await c.client.callTool({name:"write_investment_graph_bundle",
    arguments:{...payload,recoverTimelineOnly:true}});
  expect(staleRecovery.isError).toBe(true);
  expect(JSON.stringify(staleRecovery)).toContain("source_changed_since_context_review_hold");
  const reboundRecovery=await c.client.callTool({name:"write_investment_graph_bundle",
    arguments:{...payload,recoverTimelineOnly:true,
      expectedSourceSha256:digest(fs.readFileSync(path.join(vaultRoot,source),"utf8"))}});
  expect(reboundRecovery.isError).toBe(true);
  expect(JSON.stringify(reboundRecovery)).toContain("reviewed_source_binding_missing_or_mismatched_hold");
  expect(fs.readFileSync(path.join(vaultRoot,timeline),"utf8")).toBe(beforeRepair);
  expect(fs.readFileSync(path.join(vaultRoot,analysis),"utf8")).toBe(beforeAnalysis);
  fs.writeFileSync(path.join(vaultRoot,source),beforeSource);
  reindexPath(source);
  const unapproved=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:payload});
  expect(unapproved.isError).not.toBe(true);
  expect(unpack(unapproved).status)
   .toBe("existing_partial_or_preview_operations_manual_review");
  expect(fs.readFileSync(path.join(vaultRoot,timeline),"utf8")).toBe(beforeRepair);
  // Do not trust new caller-supplied prose if it differs from the written bytes.
  const changed=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:{...payload,recoverTimelineOnly:true,
    analysisMarkdown:markdown.replace("Demand conversion","Changed conversion")}});
  expect(changed.isError).toBe(true);
  expect(fs.readFileSync(path.join(vaultRoot,timeline),"utf8")).toBe(beforeRepair);
  // An out-of-band same-event Timeline update must fail closed, not duplicate.
  fs.appendFileSync(path.join(vaultRoot,timeline),eventMarker+"\n");
  reindexPath(timeline);
  const duplicate=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:{...payload,recoverTimelineOnly:true}});
  expect(duplicate.isError).toBe(true);
  fs.writeFileSync(path.join(vaultRoot,timeline),beforeRepair);
  reindexPath(timeline);
  // Only the separately host-authorized recovery call may append the backlink.
  const fixed=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:{...payload,recoverTimelineOnly:true}});
  expect(fixed.isError,JSON.stringify(fixed)).not.toBe(true);
  const v=unpack(fixed);
  expect(v.status).toBe("authorized_timeline_recovery_written_and_graph_readback_verified");
  expect(v.recoveryOnly).toBe(true);
  expect(v.graph.livingTimelineBacklinkVerified).toBe(true);
  expect(v.graph.exactOperationAfterHashesVerified).toBe(true);
  expect(fs.readFileSync(path.join(vaultRoot,analysis),"utf8")).toBe(beforeAnalysis);
  const recovered=fs.readFileSync(path.join(vaultRoot,timeline),"utf8");
  expect(recovered.split(marker)).toHaveLength(2);
  expect(recovered).toContain("Previous dated history remains.");
  const replay=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:{...payload,recoverTimelineOnly:true}});
  expect(replay.isError).not.toBe(true);
  expect(unpack(replay).status)
   .toBe("previously_written_both_receipts_graph_reverified");
  expect(fs.readFileSync(path.join(vaultRoot,timeline),"utf8")).toBe(recovered);
  // Fault the real second write, after the real Analysis commit, rather than
  // equating an independently seeded partial fixture with bundle failure.
  const interrupted=await seedGraphEvent("FAILTEST","FAIL-TIMELINE-FY26Q4",
    "ios-synthetic-failed-timeline");
  const interruptedTimeline=path.join(vaultRoot,interrupted.timelinePath);
  const originalBytes=fs.readFileSync(interruptedTimeline,"utf8");
  const renameImpl=fs.renameSync;
  let injectedFailures=0;
  const failedRename=vi.spyOn(fs,"renameSync").mockImplementation((from,to)=>{
    // The existing writer intentionally renames through an open-directory FD,
    // not the caller's absolute path. Match the synthetic basename only.
    if(path.basename(String(to))===path.basename(interruptedTimeline)){
      injectedFailures++;
      throw Error("synthetic second-note I/O failure");
    }
    renameImpl(from,to);
  });
  let partial:any;
  try{
    partial=await c.client.callTool({name:"write_investment_graph_bundle",
      arguments:interrupted});
  }finally{failedRename.mockRestore();}
  expect(injectedFailures).toBe(1);
  expect(partial.isError,JSON.stringify(partial)).not.toBe(true);
  const interruptedReceipt=unpack(partial);
  expect(interruptedReceipt).toMatchObject({
    status:"analysis_written_timeline_or_graph_needs_manual_reconciliation",
    firstNoteSaveReceiptVerified:true,entireKnowledgeGraphVerified:false,
    actionNotAutomaticallyRetried:true,
  });
  const persistedFirst=fs.readFileSync(path.join(vaultRoot,interrupted.analysisPath),"utf8");
  expect(persistedFirst).toBe(interrupted.analysisMarkdown);
  expect(fs.readFileSync(interruptedTimeline,"utf8")).toBe(originalBytes);
  const failedStage=await c.client.callTool({name:"get_edit_status",
    arguments:{operationId:interruptedReceipt.timelineOperationId}});
  expect(unpack(failedStage)).toMatchObject({status:"writing",
    receipt:{write:"pending",readback:"pending"}});
  const noRetry=await c.client.callTool({name:"write_investment_graph_bundle",
    arguments:{...interrupted,recoverTimelineOnly:true}});
  expect(unpack(noRetry)).toMatchObject({
    status:"existing_partial_or_preview_operations_manual_review",
    newWriteExecuted:false,
  });
  expect(fs.readFileSync(path.join(vaultRoot,interrupted.analysisPath),"utf8")).toBe(persistedFirst);
  expect(fs.readFileSync(interruptedTimeline,"utf8")).toBe(originalBytes);
 }finally{
  delete process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED;
  await c.close();
 }
});

it("Graph bundle rejects fake-primary AI Analysis, nonexistent links and event replay without creating a file",async()=>{
 const {applyAuthorizedInvestmentGraphBundle}=await import("../safe-edit/investment-graph-bundle");
 process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED="1";
 try{
  const op="ios-syn-block-invalid",ev="SYNTH-BLOCK-2026";
  const p="08_Daily_Weekly/Research Indexes/Investment Review - SYNTH - "+ev+".md";
  const data={
   operationRoot:op,issuer:"SYNTH",eventKey:ev,period:"FY26Q4",
   timelineDate:"2026-10-21",timelineHeading:"Evolution",
   analysisPath:p,
   timelinePath:"08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md",
   sourcePath:"07_Sources/ChatGPT/SYNTH Bundle Evidence.md",
   analysisMarkdown:[
    "---","type: investment_review","entity: SYNTH",
    "event_key: "+ev,"source_type: primary","verification: verified_against_primary",
    "independent_evidence: true","status: draft",
    "analysis_origin: synthetic_ai_draft","operation_id: "+op,"---",
    "# Unsafe claim","<!-- investment-os-operation:"+op+" -->",
    "<!-- investment-os-event:"+ev+" -->",
    "[[01_Companies/SYNTH]]","",
   ].join("\n"),
  };
  await expect(applyAuthorizedInvestmentGraphBundle(data,"oauth:edit-fixture"))
   .rejects.toThrow();
  expect(fs.existsSync(path.join(root,"vault",p))).toBe(false);
  await expect(applyAuthorizedInvestmentGraphBundle({
   ...data,analysisPath:"05_Thesis/SYNTH - Current Thesis.md",
  },"oauth:edit-fixture")).rejects.toThrow();
 }finally{
  delete process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED;
 }
});

it("read-only archive inspection verifies exact persisted SEC bytes without claiming issuer authenticity or device delivery",async()=>{
 const url="https://www.sec.gov/Archives/synthetic-source-inspection-2026.htm";
 const source="<html><body>Exact byte capture from synthetic primary research fixture.</body></html>";
 process.env.SOURCE_ARCHIVE_USER_AGENT="InvestmentOS-Tests/1.0 (authorized QA qa@example.org)";
 const originalFetch=globalThis.fetch;
 globalThis.fetch=vi.fn(async()=>new Response(source,{status:200,headers:{"content-type":"text/html"}})) as unknown as typeof fetch;
 const c=await connected(access);
 try{
   const empty=await c.client.callTool({name:"inspect_original_source_archive",arguments:{url}});
   expect(empty.isError).not.toBe(true);
   expect(unpack(empty)).toMatchObject({revisionCount:0,changesObserved:false,publisherAuthenticityVerified:false});
   const original=await c.client.callTool({name:"archive_original_source",arguments:{url}});
   expect(original.isError).not.toBe(true);
   const captured=unpack(original);
   const check=await c.client.callTool({name:"inspect_original_source_archive",arguments:{url}});
   expect(check.isError).not.toBe(true);
   const record=unpack(check);
   expect(record.snapshots).toHaveLength(1);
   expect(record.snapshots[0]).toMatchObject({
     sha256:captured.sha256,byteLength:Buffer.byteLength(source),
     archiveStatus:"intact_stored_bytes",
     originalDocumentSignatureVerified:false,publisherAuthenticityVerified:false
   });
   const status=await c.client.callTool({name:"get_sync_delivery_evidence",arguments:{}});
   expect(status.isError).not.toBe(true);
   const sync=unpack(status);
   expect(sync.status).toBe("server_sync_observation_only");
   expect(sync.crossDeviceSyncVerified).toBe(false);
   expect(sync.desktopReadback).toBe("not_verified");
   expect(sync.mobileReadback).toBe("not_verified");
   expect(sync.noteSpecificRemoteAck).toBe("not_verified");
 }finally{
  await c.close();
  globalThis.fetch=originalFetch;
  delete process.env.SOURCE_ARCHIVE_USER_AGENT;
 }
});

it("Git pilot registers only scoped preview/create/apply/status and fails closed without staging attestation",async()=>{
 const {setSetting}=await import("../db");setSetting("sync_backend","git");
 const c=await connected(access);
 try {
  expect((await c.client.listTools()).tools.map(t=>t.name).sort()).toEqual(["preview_edit","create_note","apply_edit","get_edit_status"].sort());
  const result=await c.client.callTool({name:"create_note",arguments:{operationId:"git-mcp-pilot-001",path:"PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md",reason:"Gate test",content:"Synthetic only"}});
  expect(result.isError).toBe(true);
 } finally {await c.close();setSetting("sync_backend","obsidian");}
});

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
const toolsList=["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","verify_investment_graph_writeback","prepare_investment_graph_review","write_investment_graph_bundle","rollback_edit","archive_original_source","store_user_attachment","inspect_user_attachment"];
const args={operationId:"mcp-synthetic-01",path:"Synthetic.md",reason:"Synthetic MCP test",change:{kind:"replace",oldText:"Old data",newText:"New data"}};
beforeEach(()=>{fs.mkdirSync(path.join(root,"vault"),{recursive:true});fs.writeFileSync(path.join(root,"vault","Synthetic.md"),"# Synthetic\nOld data\n");});
afterAll(async()=>{(await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function connected(a:McpAccess) {
 const {createSafeEditMcpServer}=await import("./safe-edit-server");const server=createSafeEditMcpServer(a),client=new Client({name:"test",version:"1"});const [l,r]=InMemoryTransport.createLinkedPair();await server.connect(r);await client.connect(l);return {client,close:async()=>{await client.close();await server.close();}};
}
function unpack(result:any){const b=JSON.parse(result.content[0].text);return JSON.parse(b.result.split("\n").slice(1,-1).join("\n"));}
it("discovers exactly thirteen scoped tools with accurate write annotations",async()=>{
 const c=await connected(access);try{const {tools}=await c.client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());for(const t of tools){expect(t._meta?.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);expect(t.annotations?.readOnlyHint).toBe(t.name!=="apply_edit"&&t.name!=="write_investment_graph_bundle"&&t.name!=="archive_original_source"&&t.name!=="store_user_attachment");}}finally{await c.close();}
});
it.each([
 {...access,scopes:["vault:read"]},{...access,scopes:["vault:read","inbox:submit"]},
 {...access,scopes:["vault:write"]},{...access,label:"api-key:general"},{...access,scopes:undefined},
])("enforces OAuth scopes again inside handlers: %j",async a=>{
 const c=await connected(a);try{for(const name of ["preview_edit","apply_edit","append_section","update_frontmatter","create_note","get_edit_status","verify_investment_graph_writeback","prepare_investment_graph_review","write_investment_graph_bundle","rollback_edit","archive_original_source","store_user_attachment","inspect_user_attachment"]){
 const params:Record<string,unknown>=name==="preview_edit"?{...args}:name==="apply_edit"?{operationId:args.operationId,previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}:name==="get_edit_status"?{operationId:args.operationId}:name==="prepare_investment_graph_review"?{issuer:"SYNTH",eventKey:"SYNTH-Q3-2026",period:"FY26Q3",sourcePath:"07_Sources/ChatGPT/SYNTH Primary Event.md",question:"Review SYNTH historical evidence"}:name==="write_investment_graph_bundle"?{operationRoot:"ios-bundle-test-guard",issuer:"SYNTH",eventKey:"SYNTH-Q3-2026",period:"FY26Q3",timelineDate:"2026-10-21",timelineHeading:"Evolution",analysisPath:"08_Daily_Weekly/Research Indexes/Investment Review - SYNTH - SYNTH-Q3-2026.md",timelinePath:"08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md",sourcePath:"07_Sources/ChatGPT/SYNTH Primary Event.md",analysisMarkdown:"synthetic sample".repeat(20)}:name==="verify_investment_graph_writeback"?{analysisOperationId:"ios-test-fy26-analysis",timelineOperationId:"ios-test-fy26-timeline",analysisPath:"08_Daily_Weekly/Research Indexes/Investment Review - SYNTH.md",timelinePath:"08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md",sourcePath:"07_Sources/ChatGPT/SYNTH.md"}:name==="archive_original_source"?{url:"https://www.sec.gov/Archives/sample"}:name==="store_user_attachment"?{base64:"AAAA".repeat(8),contentType:"image/png"}:name==="inspect_user_attachment"?{sha256:"a".repeat(64),contentType:"image/png"}:name==="append_section"?{...args,change:undefined,heading:"Synthetic",content:"x",date:"2026-10-16"}:name==="create_note"?{...args,change:undefined,content:"new"}:name==="update_frontmatter"?{...args,change:undefined,properties:{updated:null}}:{...args,change:undefined,rollbackOperationId:args.operationId};delete params.change;
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
   "independent_evidence: false","status: draft","---",
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
 const source="07_Sources/ChatGPT/SYNTH Bundle Evidence.md";
 const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - SYNTH.md";
 const event="SYNTH-BUNDLE-FY26Q4";
 const rootId="ios-syn-bundle-20261021-a";
 const analysis="08_Daily_Weekly/Research Indexes/Investment Review - SYNTH - "+event+".md";
 const marker="<!-- investment-os-operation:"+rootId+" -->";
 const evt="<!-- investment-os-event:"+event+" -->";
 const vaultRoot=path.join(root,"vault");
 const docs=[
  [company,"---\nentity: SYNTH\ntype: company\n---\n# SYNTH\n"],
  [source,[
    "---","entity: SYNTH","event_key: "+event,"period: FY26Q4",
    "type: research_note","verification: unverified",
    "source_type: user_supplied","---",
    "# Captured Source","User-supplied only, issuer not verified.","",
  ].join("\n")],
  [timeline,[
    "---","entity: SYNTH","type: company_evolution","---",
    "# Evolution","Preexisting historical context retained.","",
  ].join("\n")],
 ];
 for(const [p,content] of docs){
  fs.mkdirSync(path.dirname(path.join(vaultRoot,p)),{recursive:true});
  fs.writeFileSync(path.join(vaultRoot,p),content);
 }
 const {reindexPath}=await import("../vault/indexer");
 for(const [p] of docs)reindexPath(p);
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
 try{
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
  const boundPayload={...payload,expectedSourceSha256:handoff.originalSource.sha256};
  const disabled=await c.client.callTool({
   name:"write_investment_graph_bundle",arguments:boundPayload});
  expect(disabled.isError).toBe(true);
  expect(JSON.stringify(disabled)).toContain("admin_explicit_opt_in_required");
  expect(fs.existsSync(path.join(vaultRoot,analysis))).toBe(false);
  process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED="1";
  const stale=await c.client.callTool({name:"write_investment_graph_bundle",
   arguments:{...boundPayload,expectedSourceSha256:"0".repeat(64)}});
  expect(stale.isError,JSON.stringify(stale)).toBe(true);
  expect(JSON.stringify(stale)).toContain("source_changed_since_context_review_hold");
  expect(fs.existsSync(path.join(vaultRoot,analysis))).toBe(false);
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
  // New event, NO lexical overlap with the prior causal draft: previously
  // saved AI analysis must be retrieved, never promoted to primary evidence.
  const nextEvent="SYNTH-BUNDLE-FY26Q5";
  const nextSource="07_Sources/ChatGPT/SYNTH Next Event.md";
  fs.writeFileSync(path.join(vaultRoot,nextSource),[
    "---","entity: SYNTH","event_key: "+nextEvent,"period: FY26Q5",
    "type: research_note","source_type: user_supplied",
    "verification: unverified","---",
    "# Independent user submission (NOT a verified issuer release)",
    "New unrelated question about warranty provisions.","",
  ].join("\n"));
  reindexPath(nextSource);
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
  const same=await c.client.callTool({name:"prepare_investment_graph_review",
   arguments:{issuer:"SYNTH",eventKey:event,period:"FY26Q4",
    sourcePath:source,question:"Review existing event history"}});
  expect(unpack(same).status).toBe("existing_event_or_analysis_requires_duplicate_review_no_write");
 }finally{
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
  "status: draft","operation_id: "+op,"---",
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

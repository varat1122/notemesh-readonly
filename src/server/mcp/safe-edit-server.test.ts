import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
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
const toolsList=["preview_edit","apply_edit","append_section","update_frontmatter","create_note","prepare_canonical_writeback","apply_canonical_writeback","preflight_research_decision_v2","get_edit_status","rollback_edit","archive_original_source","inspect_original_source_archive","get_sync_delivery_evidence","store_user_attachment","inspect_user_attachment"];
const args={operationId:"mcp-synthetic-01",path:"Synthetic.md",reason:"Synthetic MCP test",change:{kind:"replace",oldText:"Old data",newText:"New data"}};

const digest=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const m2Intake="IN-AABBCCDDEEFF0011";
const m2Path=`00_Inbox/ChatGPT/Investment Intake - ${m2Intake}.md`;
const m2Original="Fictional MU FY2027 revenue guidance +20% is an unverified user claim.";
function m2Fixture(sourceNoteSha256="0".repeat(64)){
 return {schemaVersion:"2.0.0-shadow",policyVersion:"1.0.0",
   policySha256:"1abcc97f74181398deb0772c6ddee65a8f46d8ed6dd4bc15f1568bfce9c5b3c0",
   intakeId:m2Intake,domain:"company",subject:"MU",
   event:{classification:"unresolved",eventDate:null,publicationDate:null,
     relatedNotes:[],comparisonBasis:"Fictional user excerpt has no primary original."},
   claims:[{localClaimKey:"claim_a",entity:"MU",metric:"revenue guidance",period:"FY2027",
     unit:"% YoY",denominator:null,forecastVintage:null,value:"+20%",
     sourceRefs:[{intakeId:m2Intake,sourcePath:m2Path,sourceNoteSha256,
       quote:"MU FY2027 revenue guidance +20%"}],competingEvidence:[],
     epistemicStatus:"unresolved",conclusion:"conditional",primaryEvidence:null,
     reasoningSummary:"User claim remains unverified and conditional.",
     requiredEvidence:"Official issuer release with matching period and metric."}],
   synthesis:{headlineTh:"ข่าวสมมติรายได้ MU ยังไม่ยืนยัน",
     whatChangedTh:"ผู้ใช้ส่งข้ออ้างที่ยังไม่มีเอกสารทางการ",
     mechanismTh:"ยังไม่สามารถเชื่อมไป EPS หรือ FCF ได้",
     thesisImplicationTh:"ไม่เปลี่ยน Thesis จากข่าวสมมติ",
     counterEvidenceTh:"ยังไม่พบต้นฉบับที่ตรวจได้",
     requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและงวดที่ตรงกัน"}};
}

beforeEach(()=>{fs.mkdirSync(path.join(root,"vault"),{recursive:true});fs.writeFileSync(path.join(root,"vault","Synthetic.md"),"# Synthetic\nOld data\n");});
afterAll(async()=>{(await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function connected(a:McpAccess) {
 const {createSafeEditMcpServer}=await import("./safe-edit-server");const server=createSafeEditMcpServer(a),client=new Client({name:"test",version:"1"});const [l,r]=InMemoryTransport.createLinkedPair();await server.connect(r);await client.connect(l);return {client,close:async()=>{await client.close();await server.close();}};
}
function unpack(result:any){const b=JSON.parse(result.content[0].text);return JSON.parse(b.result.split("\n").slice(1,-1).join("\n"));}
it("discovers fifteen scoped tools with accurate write annotations",async()=>{
 const c=await connected(access);try{const {tools}=await c.client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());for(const t of tools){expect(t._meta?.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);expect(t.annotations?.readOnlyHint).toBe(t.name!=="apply_edit"&&t.name!=="apply_canonical_writeback"&&t.name!=="archive_original_source"&&t.name!=="store_user_attachment");}}finally{await c.close();}
});
it("M3d MCP preflight binds existing indexed original quotes but neither verifies issuer truth nor writes notes",async()=>{
 const rel=m2Path,original=m2Original;
 const source=["---","type: investment_source_intake",`intake_id: ${m2Intake}`,
   `source_text_sha256: ${digest(original)}`,"input_format: text",
   "verification: not_reverified","---","",`# Fixture Source — ${m2Intake}`,"",
   "## User-supplied original language text","","\`\`\`text",original,"\`\`\`",
   "## Evidence boundary","","No publisher verification.",""].join("\n");
 const full=path.join(root,"vault",rel);
 fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,source,"utf8");
 (await import("../vault/indexer")).reindexPath(rel);
 const c=await connected(access);
 try{
   const {tools}=await c.client.listTools(),descriptor=tools.find(t=>t.name==="preflight_research_decision_v2");
   expect(descriptor?.annotations?.readOnlyHint).toBe(true);
   expect(descriptor?.inputSchema.properties).toHaveProperty("claims");
   expect(descriptor?.inputSchema.properties).toHaveProperty("policySha256");
   const valid=await c.client.callTool({name:"preflight_research_decision_v2",arguments:m2Fixture(digest(source))});
   expect(valid.isError,JSON.stringify(valid.content)).not.toBe(true);
   expect(unpack(valid)).toMatchObject({status:"structurally_grounded_shadow_only",
     policyStampMatched:true,sourceAuthenticityVerified:false,investmentTruthVerified:false,
     canWriteProtectedNotes:false,writesPerformed:false,serverVerifiedClaimKeys:[]});
   const stale=await c.client.callTool({name:"preflight_research_decision_v2",arguments:m2Fixture()});
   expect(unpack(stale).errors).toContain("claim_a:source_note_sha256_mismatch");
   expect(unpack(stale).status).toBe("hold_references_or_authority");
   const forged=m2Fixture(digest(source));
   forged.claims[0].epistemicStatus="attributed";
   forged.claims[0].conclusion="confirmed";
   forged.claims[0].primaryEvidence={receiptId:"PEV-"+"F".repeat(32),
     primarySourceUrl:"https://www.sec.gov/Archives/fictional-mu-source.htm",
     verifiedValue:"+20%"};
   const forgedResult=await c.client.callTool({name:"preflight_research_decision_v2",arguments:forged});
   expect(unpack(forgedResult).status).toBe("hold_references_or_authority");
   expect(unpack(forgedResult).errors).toContain("claim_a:primary_receipt_not_server_validated");
   expect(fs.readFileSync(full,"utf8")).toBe(source);
 }finally{await c.close();}
});

it("M5.5.1 exposes optional claim assessment and exact primary receipt scope in the live MCP descriptor",async()=>{
 const c=await connected(access);
 try{
  const {tools}=await c.client.listTools();
  const prepare=tools.find(t=>t.name==="prepare_canonical_writeback");
  const apply=tools.find(t=>t.name==="apply_canonical_writeback");
  const nested=(prepare?.inputSchema.properties?.researchReview as any)?.properties?.claimAssessments;
  expect(nested?.type).toBe("array");
  for(const field of ["entity","metric","period","unit","competingValues","resolution",
    "conclusion","primaryEvidenceReceipt","primarySourceUrl","verifiedValue"])
    expect(nested.items.properties).toHaveProperty(field);
  const applyNested=(apply?.inputSchema.properties?.input as any)?.properties?.researchReview?.properties?.claimAssessments;
  expect(applyNested).toEqual(nested);
  expect((prepare?.inputSchema.required??[])).not.toContain("researchReview");
 }finally{await c.close();}
});
it.each([
 {...access,scopes:["vault:read"]},{...access,scopes:["vault:read","inbox:submit"]},
 {...access,scopes:["vault:write"]},{...access,label:"api-key:general"},{...access,scopes:undefined},
])("enforces OAuth scopes again inside handlers: %j",async a=>{
 const c=await connected(a);try{for(const name of toolsList){
 const canonical={domain:"company",entities:["NVDA"],topic:"Synthetic",inputFormat:"text",sourceKind:"archived_chat",extractedText:"Synthetic",sourceChat:"test",completedAnalysis:"Synthetic analysis"};
 const params:Record<string,unknown>=name==="preview_edit"?{...args}:name==="apply_edit"?{operationId:args.operationId,previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}:name==="prepare_canonical_writeback"?canonical:name==="preflight_research_decision_v2"?m2Fixture():name==="apply_canonical_writeback"?{input:canonical,planId:"IN-0000000000000000",authorizations:[]}:name==="get_edit_status"?{operationId:args.operationId}:name==="archive_original_source"?{url:"https://www.sec.gov/Archives/sample"}:name==="inspect_original_source_archive"?{url:"https://www.sec.gov/Archives/sample"}:name==="get_sync_delivery_evidence"?{}:name==="store_user_attachment"?{base64:"AAAA".repeat(8),contentType:"image/png"}:name==="inspect_user_attachment"?{sha256:"a".repeat(64),contentType:"image/png"}:name==="append_section"?{...args,change:undefined,heading:"Synthetic",content:"x",date:"2026-10-16"}:name==="create_note"?{...args,change:undefined,content:"new"}:name==="update_frontmatter"?{...args,change:undefined,properties:{updated:null}}:{...args,change:undefined,rollbackOperationId:args.operationId};delete params.change;
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

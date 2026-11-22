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
const toolsList=["prepare_source_event_packet","source_event_result_contract","preview_edit","apply_edit","append_section","update_frontmatter","create_note","prepare_canonical_writeback","apply_canonical_writeback","prepare_research_judge_packet","research_judge_result_contract","preflight_research_decision_v2","get_edit_status","rollback_edit","archive_original_source","inspect_original_source_archive","get_sync_delivery_evidence","store_user_attachment","inspect_user_attachment","prepare_canonical_review_revision","apply_canonical_review_revision","inspect_canonical_review_revision"];
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
it("generic MCP routes reject fully populated caller primary declarations before issuing tokens",async()=>{
 const c=await connected(access),before=fs.readFileSync(path.join(root,"vault","Synthetic.md"));
 const evidence={entity:"SYNTH",event:"Revenue",period:"FY2026",originalSource:"https://example.org/issuer",
   classification:"new_event",delta:"Caller assertion",independent:false,verification:"verified_against_primary",
   sourceType:"primary",primaryUrl:"https://example.org/issuer",event_date:null,published_at:null,received_at:null,
   imported_at:null,verified_at:"2026-11-01",relatedPaths:[]};
 const base={operationId:"D2-MCP-forgery",path:"Synthetic.md",reason:"Isolated authority regression",evidence};
 try{
  for(const request of [
   {name:"preview_edit",arguments:{...base,change:args.change}},
   {name:"update_frontmatter",arguments:{...base,properties:{verification:"verified_against_primary"}}},
   {name:"create_note",arguments:{...base,path:"Forged.md",content:"---\nverification: verified_against_primary\n---\n# Forged"}},
   {name:"append_section",arguments:{...base,heading:"Synthetic",content:"Forged authority",date:"2026-11-01"}}
  ]){
   const r=await c.client.callTool(request);expect(r.isError).toBe(true);
   expect(JSON.stringify(r.content)).toContain("generic Safe Edit cannot grant primary authority");
  }
  expect(fs.readFileSync(path.join(root,"vault","Synthetic.md"))).toEqual(before);
  expect(fs.existsSync(path.join(root,"vault","Forged.md"))).toBe(false);
 }finally{await c.close();}
});
it("discovers twenty scoped tools with accurate write annotations",async()=>{
 const c=await connected(access);try{const {tools}=await c.client.listTools();expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());for(const t of tools){expect(t._meta?.securitySchemes).toEqual([{type:"oauth2",scopes:["vault:read","vault:edit"]}]);expect(t.annotations?.readOnlyHint).toBe(t.name!=="apply_edit"&&t.name!=="apply_canonical_writeback"&&t.name!=="archive_original_source"&&t.name!=="store_user_attachment"&&t.name!=="apply_canonical_review_revision");}}finally{await c.close();}
});
it("OD-10 F-2: ICR descriptors disclose the live OFF-mode capability and its gates truthfully; annotations unchanged",async()=>{
 const c=await connected(access);try{
  const {tools}=await c.client.listTools(),d=(n:string)=>tools.find(t=>t.name===n)!;
  const prep=d("prepare_canonical_review_revision"),apply=d("apply_canonical_review_revision"),inspect=d("inspect_canonical_review_revision");
  for(const t of [prep,apply,inspect])for(const stale of ["isolated pilot ONLY","Disabled without","No live Vault authorization","isolated canonical revision"])
   expect(t.description,t.name+": "+stale).not.toContain(stale);
  for(const must of ["ENABLED in OFF mode","live Vault","refused in C1","vault:edit OAuth","existing Company Research Review (V1","Industry-IN/Macro-IN Draft Review (V2","no issuer is created","sealed source event bound to this actor",
   "duplicate/duplicate_link_only","added_detail/append_revision","single-use server witness","CAS preview","Writes no Vault note","Never an independent-evidence increment"])
   expect(prep.description,must).toContain(must);
  for(const must of ["In OFF mode this WRITES","Company Research Review (V1) or Industry-IN/Macro-IN Draft Review (V2","live one","refused in C1","vault:edit OAuth","authenticated dashboard-session approval","not proof of human presence",
   "same actor","source-event/Source/Review/hash binding","single-use server witness","Safe Edit CAS","receipt","duplicate/duplicate_link_only","added_detail/append_revision","no independent-evidence promotion"])
   expect(apply.description,must).toContain(must);
  for(const must of ["Read-only","same actor","refused in C1","not publisher verification, independent evidence"])expect(inspect.description,must).toContain(must);
  expect([prep.annotations,apply.annotations,inspect.annotations]).toEqual([{readOnlyHint:true,openWorldHint:false},
   {readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},{readOnlyHint:true,openWorldHint:false}]);
 }finally{await c.close();}
});
it("M56-P1 T07: V2 is a versioned input on the SAME dedicated tools (no new public tool or write); V1 required set kept; strict per-version parsing; V2 contract served",async()=>{
 const c=await connected(access);try{
  const {tools}=await c.client.listTools(),d=(n:string)=>tools.find(t=>t.name===n)!;
  expect(tools.map(t=>t.name).sort()).toEqual(toolsList.sort());
  const prep=d("prepare_canonical_review_revision").inputSchema as {properties:Record<string,unknown>;required:string[]};
  expect(Object.keys(prep.properties).sort()).toEqual(["additionalSources","analystAssessment","entity","existingReview","methodVersion","reviewDate","revisionText","selectorVersion","sourceEvent","subject"]);
  expect(prep.required.sort()).toEqual(["additionalSources","analystAssessment","entity","existingReview","methodVersion","reviewDate","revisionText"]);
  expect(JSON.stringify(prep.properties.selectorVersion)).toContain("M56-REVIEW-SELECTOR-2");
  const applyShape=d("apply_canonical_review_revision").inputSchema as {required:string[]};
  expect(applyShape.required.sort()).toEqual(["authorization","input","operationId"]);
  expect(d("source_event_result_contract").annotations?.readOnlyHint).toBe(true);
  const v1=unpack(await c.client.callTool({name:"source_event_result_contract",arguments:{}}));
  const v2=unpack(await c.client.callTool({name:"source_event_result_contract",arguments:{contract:"subject_v2"}}));
  expect(JSON.stringify(v1)).toContain("IOS-RI001-SOURCE-EVENT-SEMANTIC-1.0.0");expect(JSON.stringify(v1)).not.toContain("SUBJECT");
  expect(JSON.stringify(v2)).toContain("IOS-RI001-SUBJECT-SOURCE-EVENT-SEMANTIC-2.0.0");expect(JSON.stringify(v2)).not.toContain("effectiveIssuerId");
  // Unversioned payload carrying V2 fields is parsed strictly as Company V1 and refused; V2 payload
  // without a valid Industry/Macro Review is refused. Neither writes anything.
  const before=fs.readdirSync(path.join(root,"vault"),{recursive:true}).sort();
  const v1Probe=await c.client.callTool({name:"prepare_canonical_review_revision",arguments:{existingReview:{path:"10_Knowledge/Company Research/Investment Review - TESTA - IN-0123456789ABCDEF.md",
   expectedSha256:"0".repeat(64),receiptId:"ICW-"+"0".repeat(32),relationship:"duplicate",comparisonBasis:"Synthetic probe comparison basis with at least forty characters."},
   subject:{domain:"industry",hubPath:"02_Industries_Themes/X.md",topic:"t",period:null,evidence:[{key:"original_source",quote:"q",locator:"utf16:0:1",sourceSha256:"0".repeat(64)}]},
   additionalSources:[{path:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDEF.md",sha256:"0".repeat(64),receiptId:"ICW-"+"0".repeat(32)}],reviewDate:"2026-11-14",methodVersion:"T",
   analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"x",counterEvidence:"x",requiredEvidence:"x",criticIndependence:"not_verified",independentEvidenceIncrement:0},revisionText:"x"}});
  expect(v1Probe.isError).toBe(true);
  const v2Probe=await c.client.callTool({name:"prepare_canonical_review_revision",arguments:{selectorVersion:"M56-REVIEW-SELECTOR-2",entity:"industry",
   existingReview:{path:"10_Knowledge/Industry and Concepts/Investment Review - X - IN-0123456789ABCDEF.md",intakeId:"IN-0123456789ABCDEF",expectedSha256:"0".repeat(64),
    receiptId:"ICW-"+"0".repeat(32),reviewScope:"industry",originalSourcePath:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDEF.md",relationship:"duplicate",
    comparisonBasis:"Synthetic probe comparison basis with at least forty characters."},
   subject:{domain:"industry",hubPath:"02_Industries_Themes/X.md",topic:"t",period:null,evidence:[{key:"original_source",quote:"q",locator:"utf16:0:1",sourceSha256:"0".repeat(64)}]},
   additionalSources:[{path:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDE0.md",sha256:"0".repeat(64),receiptId:"ICW-"+"0".repeat(32)}],reviewDate:"2026-11-14",methodVersion:"T",
   analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"x",counterEvidence:"x",requiredEvidence:"x",criticIndependence:"not_verified",independentEvidenceIncrement:0},revisionText:"x"}});
  expect(v2Probe.isError).toBe(true);expect(JSON.stringify(v2Probe)).toMatch(/index_missing|revision_/);
  expect(fs.readdirSync(path.join(root,"vault"),{recursive:true}).sort()).toEqual(before);
 }finally{await c.close();}
});
it("M3d MCP preflight binds existing indexed original quotes but neither verifies issuer truth nor writes notes",async()=>{
 const rel=m2Path,original=m2Original;
 const source=["---","type: investment_source_intake",`intake_id: ${m2Intake}`,
   `source_text_sha256: ${digest(original)}`,"input_format: text",
   "verification: not_reverified","---","",`# Fixture Source — ${m2Intake}`,"",
   "## User-supplied original language text","","```text",original,"```",
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
   const baseDecision=m2Fixture(digest(source));
   const forged={...baseDecision,claims:[{...baseDecision.claims[0],
     epistemicStatus:"attributed",conclusion:"confirmed",
     primaryEvidence:{receiptId:"PEV-"+"F".repeat(32),
       primarySourceUrl:"https://www.sec.gov/Archives/fictional-mu-source.htm",
       verifiedValue:"+20%"}}]};
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
 let params:Record<string,unknown>=name==="preview_edit"?{...args}:name==="apply_edit"?{operationId:args.operationId,previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}:name==="prepare_canonical_writeback"?canonical:name==="preflight_research_decision_v2"?m2Fixture():name==="apply_canonical_writeback"?{input:canonical,planId:"IN-0000000000000000",authorizations:[]}:name==="get_edit_status"?{operationId:args.operationId}:name==="archive_original_source"?{url:"https://www.sec.gov/Archives/sample"}:name==="inspect_original_source_archive"?{url:"https://www.sec.gov/Archives/sample"}:name==="get_sync_delivery_evidence"?{}:name==="store_user_attachment"?{base64:"AAAA".repeat(8),contentType:"image/png"}:name==="inspect_user_attachment"?{sha256:"a".repeat(64),contentType:"image/png"}:name==="append_section"?{...args,change:undefined,heading:"Synthetic",content:"x",date:"2026-10-16"}:name==="create_note"?{...args,change:undefined,content:"new"}:name==="update_frontmatter"?{...args,change:undefined,properties:{updated:null}}:{...args,change:undefined,rollbackOperationId:args.operationId};delete params.change;
 if(name==="prepare_source_event_packet")params={kind:"create",input:canonical};
 if(name==="source_event_result_contract")params={};
 if(name==="prepare_research_judge_packet")params={input:canonical};
 if(name==="research_judge_result_contract"){
   const decision=(key:string)=>({key,verdict:"PASS",rationale:"Simulated result for authorization test",references:[{key:"received_source",quote:"Synthetic",locator:"line 1"}],
     checks:{entailment:"PASS",numbersUnits:"PASS",periodRoleAttributionVintage:"PASS",identityRelationships:"PASS",pointInTime:"PASS",independenceCounterEvidence:"PASS",injectionCoverage:"PASS"}});
   params={packetId:"RJP-"+"A".repeat(32),packetDigest:"0".repeat(64),reviewDigest:"0".repeat(64),claims:[],relationships:[],event:{...decision("event"),classification:"new_event"},review:decision("review"),materialRisk:false};
 }
 if(["prepare_canonical_review_revision","apply_canonical_review_revision","inspect_canonical_review_revision"].includes(name)){
   const operationId="ICR-"+"a".repeat(32);
   const fakeRevision={existingReview:{path:"10_Knowledge/Company Research/Investment Review - NVDA - IN-AABBCCDDEEFF0011.md",expectedSha256:"a".repeat(64),receiptId:"ICW-"+"a".repeat(32),relationship:"added_detail",comparisonBasis:"Synthetic comparison for scoped OAuth-negative testing, without fact claims."},
    entity:"NVDA",additionalSources:[{path:"00_Inbox/ChatGPT/Investment Intake - IN-AABBCCDDEEFF0011.md",sha256:"a".repeat(64),receiptId:"ICW-"+"a".repeat(32)}],
    reviewDate:"2026-11-12",methodVersion:"synthetic-auth-test",
    analystAssessment:{disposition:"PASS",eventRelation:"added_detail",materiality:"low",assessment:"Synthetic only",counterEvidence:"Not original proof",requiredEvidence:"Check source",criticIndependence:"not_verified",independentEvidenceIncrement:0},
    revisionText:"Synthetic low-risk addendum"};
   params=name==="prepare_canonical_review_revision"?fakeRevision:name==="inspect_canonical_review_revision"?{operationId}:{input:fakeRevision,operationId,authorization:{operationId,previewToken:"a".repeat(64),expectedHash:"a".repeat(64)}};
  }
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

it("M56-P1 Company V1 public ABI: descriptor V1-compatible vs a replica built from the unchanged V1 schemas; same validation stage for V1 payload variants; V1 positive through the live MCP tools",async()=>{
 const {McpServer}=await import("@modelcontextprotocol/sdk/server/mcp.js");
 const pilot=await import("../safe-edit/canonical-review-revision-pilot"),bridge=await import("./canonical-review-revision");
 // Replica of the pre-M56 registration: the UNCHANGED V1 schemas and the same V1 handlers.
 const replica=new McpServer({name:"v1-replica",version:"1"});
 const wrap=(run:()=>unknown)=>Promise.resolve().then(run).then(r=>({content:[{type:"text" as const,text:JSON.stringify(r)}]}),(e:Error)=>({isError:true,content:[{type:"text" as const,text:e.message}]}));
 replica.registerTool("prepare_canonical_review_revision",{inputSchema:pilot.canonicalRevisionInputSchema.shape},async input=>wrap(()=>bridge.prepareCanonicalReviewRevision(input,access.label)));
 replica.registerTool("apply_canonical_review_revision",{inputSchema:bridge.canonicalRevisionApplySchema.shape},async input=>wrap(()=>bridge.applyCanonicalReviewRevision(input,access.label)));
 const rc=new Client({name:"replica",version:"1"}),[l,r]=InMemoryTransport.createLinkedPair();await replica.connect(r);await rc.connect(l);
 const c=await connected(access);
 try{
  // 1) Descriptor: same required set; every V1 property schema kept (identical, or as one exact anyOf branch).
  const [oldTools,newTools]=[(await rc.listTools()).tools,(await c.client.listTools()).tools];
  for(const name of ["prepare_canonical_review_revision","apply_canonical_review_revision"]){
   const o=oldTools.find(t=>t.name===name)!.inputSchema as any,n=newTools.find(t=>t.name===name)!.inputSchema as any;
   expect(n.type,name).toBe("object");expect([...n.required].sort(),name).toEqual([...o.required].sort());
   for(const [k,v] of Object.entries(o.properties as Record<string,unknown>)){
    if(JSON.stringify(n.properties[k])===JSON.stringify(v))continue;
    expect(n.properties[k].anyOf,name+"."+k).toContainEqual(v);
   }
   expect(Object.keys(n.properties).filter(k=>!(k in o.properties)).sort(),name).toEqual(name.startsWith("prepare")?["selectorVersion","subject"]:[]);
  }
  // 2) Same validation stage (SDK InvalidParams vs handler refusal) for V1 payload variants.
  const stage=(res:any)=>!res.isError?"ok":/Input validation error/.test(JSON.stringify(res.content))?"sdk":"handler:"+res.content[0].text;
  const v1={existingReview:{path:"10_Knowledge/Company Research/Investment Review - ABIT - IN-0123456789ABCDEF.md",expectedSha256:"0".repeat(64),
   receiptId:"ICW-"+"0".repeat(32),relationship:"duplicate",comparisonBasis:"Synthetic ABI probe comparison basis with at least forty characters."},
   entity:"ABIT",additionalSources:[{path:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDE0.md",sha256:"0".repeat(64),receiptId:"ICW-"+"1".repeat(32)}],
   reviewDate:"2026-11-14",methodVersion:"ABI-1",revisionText:"Synthetic probe.",
   analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"x",counterEvidence:"x",requiredEvidence:"x",criticIndependence:"not_verified",independentEvidenceIncrement:0}};
  const {entity:_e,...noEntity}=v1;void _e;
  const v2Review={path:"10_Knowledge/Industry and Concepts/Investment Review - X - IN-0123456789ABCDEF.md",intakeId:"IN-0123456789ABCDEF",expectedSha256:"0".repeat(64),
   receiptId:"ICW-"+"0".repeat(32),reviewScope:"industry",originalSourcePath:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDEF.md",relationship:"duplicate",
   comparisonBasis:"Synthetic ABI probe comparison basis with at least forty characters."};
  const v2Subject={domain:"industry",hubPath:"02_Industries_Themes/X.md",topic:"t",period:null,evidence:[{key:"original_source",quote:"q",locator:"utf16:0:1",sourceSha256:"0".repeat(64)}]};
  const fakeEnvelope={body:"x",digest:"0".repeat(64),packetId:"SEP-"+"0".repeat(32),actorLabelSha256:"0".repeat(64),issuedAt:1,expiresAt:2,seal:"0".repeat(64)};
  const variants:[string,Record<string,unknown>][]=[["valid shape, unknown review",v1],["missing entity",noEntity],["empty entity",{...v1,entity:""}],
   ["industry path in V1",{...v1,existingReview:{...v1.existingReview,path:v2Review.path}}],["unknown top-level key",{...v1,foo:"bar"}],
   ["V2-only subject key",{...v1,subject:v2Subject}],["V2-shaped existingReview",{...v1,existingReview:v2Review}],
   ["V2-shaped sourceEvent",{...v1,sourceEvent:{packet:fakeEnvelope,result:{contractVersion:"IOS-RI001-SUBJECT-SOURCE-EVENT-SEMANTIC-2.0.0"}}}]];
  for(const [name,args] of variants){
   const [o,n]=[await rc.callTool({name:"prepare_canonical_review_revision",arguments:args}),await c.client.callTool({name:"prepare_canonical_review_revision",arguments:args})];
   expect(stage(n),name).toBe(stage(o));
  }
  const auth={operationId:"ICR-"+"0".repeat(32),previewToken:"a".repeat(64),expectedHash:"0".repeat(64)};
  for(const [name,input] of [["apply: missing entity",noEntity],["apply: V2-shaped unversioned",{...v1,existingReview:v2Review,subject:v2Subject}],["apply: valid shape",v1]] as const){
   const args={input,operationId:"ICR-"+"0".repeat(32),authorization:auth};
   expect(stage(await c.client.callTool({name:"apply_canonical_review_revision",arguments:args})),name).toBe(stage(await rc.callTool({name:"apply_canonical_review_revision",arguments:args})));
  }
  // 3) Company V1 positive through the live MCP tools (prepare → dashboard approval → apply).
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,41).toString("base64"); // synthetic sealing key for this isolated DATA_DIR
  for(const d of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies"])fs.mkdirSync(path.join(root,"vault",d),{recursive:true});
  fs.writeFileSync(path.join(root,"vault","01_Companies/ABIT.md"),"# ABIT\n");(await import("../vault/indexer")).reindexPath("01_Companies/ABIT.md");
  const researchReview={headlineTh:"ABIT ออกคู่มือสมมติที่ยังต้องตรวจต้นฉบับ",translationTh:"ABIT ออกคำชี้แจงเกี่ยวกับคู่มือสำหรับระบบสมมติ",
   whatChangedTh:"เป็นการกล่าวอ้างด้านเอกสาร ไม่ใช่รายได้หรือกำไรจริง",mechanismTh:"ยังไม่มีหลักฐานว่ารายละเอียดเอกสารมีผลต่อกำไร",
   thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากเอกสารนี้",counterEvidenceTh:"ข้อความอาจอ้างรายละเอียดที่ไม่มีในเอกสารจริง",
   requiredEvidenceTh:"ตรวจเอกสารที่ออกโดยผู้ผลิตก่อนยกระดับข้อกล่าวอ้าง"};
  const original={domain:"company" as const,entities:["ABIT"],topic:"Synthetic ABIT manual",inputFormat:"text" as const,sourceKind:"news_media" as const,sourceLanguage:"en",
   sourceChannel:"synthetic",contentTypes:["other" as const],sourceChat:"M56-P1 ABI",sourceUrl:"https://example.org/abit/manual",eventDate:"2026-10-01",publicationDate:"2026-10-01",
   originalDocumentAccess:"not_obtained" as const,extractedText:"SYNTHETIC: ABIT issued an ordinary product manual on October 1.",researchReview};
  const w=await import("./canonical-writeback");
  const save=async(input:Record<string,unknown>)=>{const p=w.prepareCanonicalWriteback(input as never,access.label);
   return w.applyCanonicalWriteback({input:input as never,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken!,expectedHash:t.beforeHash}))},access.label);};
  const first=await save(original),rev=first.steps.find(s=>s.kind==="canonical_review")!;
  const extra=await save({...original,captureOnly:true,researchReview:undefined,sourceKind:"social_repost",sourceUrl:null,eventDate:null,publicationDate:null,
   extractedText:"SYNTHETIC forwarded detail: the ABIT manual appendix adds an installation note."});
  const sha=(s:string)=>createHash("sha256").update(s).digest("hex"),raw=(p:string)=>fs.readFileSync(path.join(root,"vault",p),"utf8");
  const input:Record<string,unknown>={existingReview:{path:rev.path,expectedSha256:sha(raw(rev.path)),receiptId:rev.receiptKey,relationship:"added_detail",
   comparisonBasis:"Synthetic analyst comparison: a low-risk detail to the same manual, without independent issuer verification."},
   entity:"ABIT",reviewDate:"2026-11-14",methodVersion:"ABI-V1-POSITIVE",additionalSources:[{path:extra.steps[0].path,sha256:sha(raw(extra.steps[0].path)),receiptId:extra.steps[0].receiptKey}],
   analystAssessment:{disposition:"PASS",eventRelation:"added_detail",materiality:"low",assessment:"The forwarded appendix detail is a historical Draft annotation only.",
    counterEvidence:"The original publisher document was not independently read.",requiredEvidence:"Read the original before any decision.",criticIndependence:"not_verified",independentEvidenceIncrement:0},
   revisionText:"Synthetic V1 public-boundary added detail."};
  const {assessed}=await import("../../../tests/source-event-fixture"),sea=await import("../safe-edit/source-event-admission");
  input.sourceEvent=await assessed(sea.revisionEventProposal(input as never),access.label);
  const prepared=unpack(await c.client.callTool({name:"prepare_canonical_review_revision",arguments:input}));
  expect(prepared).toMatchObject({phase:"revision_preview_only",issuerBinding:"not_verified",independentEvidenceIncrement:0});
  const engine=await import("../safe-edit/engine"),view=engine.adminPreview(prepared.operationId) as {afterHash:string;reviewedEvidenceDigest?:string};
  engine.approve(prepared.operationId,"synthetic-dashboard-reviewer",view.afterHash,view.reviewedEvidenceDigest);
  const applied=unpack(await c.client.callTool({name:"apply_canonical_review_revision",arguments:{input,operationId:prepared.operationId,
   authorization:{operationId:prepared.operationId,previewToken:prepared.preview.previewToken,expectedHash:prepared.preview.beforeHash}}}));
  expect(applied).toMatchObject({status:"revision_saved_verified",issuerBinding:"analyst_attested_not_independently_verified",independentEvidenceIncrement:0});
  expect(applied).not.toHaveProperty("subjectBinding");
  expect(raw(rev.path)).toContain("### Source-linked evidence addendum (Draft, not endorsed)");
 }finally{await c.close();await rc.close();await replica.close();delete process.env.ENCRYPTION_KEY;}
},60_000);
it("OD-10 client-plan guidance parity: public V1/V2 planner guidance and the P10 descriptor name only the exact registered Safe Edit tools; no _v2 / prepare_subject_ tool; subject_v2 and selectorVersion are input values; 22 tools and V1 entity/strict/authorization kept",async()=>{
 process.env.ENCRYPTION_KEY??=Buffer.alloc(32,43).toString("base64"); // synthetic sealing key for this isolated DATA_DIR
 const vault=path.join(root,"vault"),sha=(s:string)=>createHash("sha256").update(s).digest("hex"),raw=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
 for(const d of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","10_Knowledge/Industry and Concepts","01_Companies","02_Industries_Themes"])fs.mkdirSync(path.join(vault,d),{recursive:true});
 const researchReview={headlineTh:"ข่าวสมมติระบุการเปลี่ยนแปลงในเดือนตุลาคม 2026",translationTh:"ข่าวสมมติระบุเหตุการณ์ในเดือนตุลาคม 2026 และยังไม่ได้ตรวจกับต้นฉบับ",
  whatChangedTh:"เป็นข้อความใหม่ที่ยังไม่ได้ตรวจต้นฉบับและเทียบกับข้อมูลเก่า",mechanismTh:"ยังไม่มีหลักฐานว่าข้อความนี้มีผลต่อกำไรหรือกระแสเงินสด",
  thesisImplicationTh:"ยังไม่เปลี่ยน Thesis ราคาเป้าหมาย หรือประมาณการกำไรจากข้อความนี้",counterEvidenceTh:"ข้อความอาจอ้างรายละเอียดที่ไม่มีในเอกสารจริง",
  requiredEvidenceTh:"ต้องตรวจเอกสารต้นฉบับและวันที่เผยแพร่ก่อนใช้ข้อมูล"};
 const company={domain:"company" as const,entities:["GPAR"],topic:"Synthetic GPAR manual",inputFormat:"text" as const,sourceKind:"news_media" as const,sourceLanguage:"en",
  sourceChannel:"synthetic",contentTypes:["other" as const],sourceChat:"OD-10 T07 parity",sourceUrl:"https://example.org/gpar/manual",eventDate:"2026-10-01",publicationDate:"2026-10-01",
  originalDocumentAccess:"not_obtained" as const,extractedText:"SYNTHETIC: GPAR issued an ordinary product manual on October 1.",researchReview};
 // Company V1 base: historical English-format Review (+ Source) as synthetic pre-WP2 history (the V1 planner route).
 fs.writeFileSync(path.join(vault,"01_Companies/GPAR.md"),"# GPAR\n");fs.writeFileSync(path.join(vault,"02_Industries_Themes/Memory Semiconductors.md"),"# Memory Semiconductors\n");
 const ix=await import("../vault/indexer");ix.reindexPath("01_Companies/GPAR.md");ix.reindexPath("02_Industries_Themes/Memory Semiconductors.md");
 const {kernelCanonicalCreate}=await import("../../../tests/source-event-fixture");
 const steps=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(company as never).safeEditWorkflow!.steps;
 const src=steps.find(s=>s.kind==="source_intake")!,rev=steps.find(s=>s.kind==="canonical_review")!;
 let reviewText=(rev.safeEditRequest!.change as {content:string}).content;
 for(const [th,en] of [["## ที่มาของต้นฉบับ","## Source provenance"],["## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)","## Research analysis (AI interpretation; not approved Thesis)"]])reviewText=reviewText.replace(th,en);
 await kernelCanonicalCreate([{kind:"source_intake",path:src.path,content:(src.safeEditRequest!.change as {content:string}).content},{kind:"canonical_review",path:rev.path,content:reviewText}],access.label,{legacy:true});
 const w=await import("./canonical-writeback");
 const save=async(input:Record<string,unknown>)=>{const p=w.prepareCanonicalWriteback(input as never,access.label);
  return w.applyCanonicalWriteback({input:input as never,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken!,expectedHash:t.beforeHash}))},access.label);};
 const v1Dup=(await save({...company,captureOnly:true,researchReview:undefined,sourceLanguage:"th",sourceUrl:"https://th.example.org/gpar/manual-th",
  extractedText:"SYNTHETIC (Thai edition): GPAR issued an ordinary product manual on October 1."})).steps[0].path;
 // Industry-IN V2 base: server-receipted Draft Review + a same-event capture-only Source.
 const industry={...company,domain:"industry" as const,entities:["Memory Semiconductors"],topic:"Synthetic memory price",sourceKind:"news_media" as const,sourceUrl:"https://example.org/memory/tracker-a",
  eventDate:"2026-10-20",publicationDate:"2026-10-20",extractedText:"SYNTHETIC: Memory Semiconductors contract prices rose in October 2026, a synthetic tracker reported."};
 const saved=await save(industry);expect(saved.status).toBe("saved_verified");
 const v2Rev=saved.steps.find(s=>s.kind==="canonical_review")!.path;
 const v2Dup=(await save({...industry,captureOnly:true,researchReview:undefined,sourceUrl:"https://www.example.org/memory/tracker-b",
  extractedText:"SYNTHETIC (second edition): Memory Semiconductors contract prices rose in October 2026, the tracker repeated."})).steps[0].path;
 const {createMcpServer}=await import("./server"),research=createMcpServer({label:"t07-read-only-research",read:true,write:false}),rc=new Client({name:"t07-research",version:"1"});
 const [rl,rr]=InMemoryTransport.createLinkedPair();await research.connect(rr);await rc.connect(rl);
 const c=await connected(access);
 try{
  const basis="Both synthetic editions report the same dated event from one publisher family; not a second economic event.";
  const plan=async(reviewPath:string,additionalSourcePath:string)=>JSON.parse(((await rc.callTool({name:"plan_duplicate_source_link",
   arguments:{reviewPath,additionalSourcePath,eventAnchor:"t07-parity-event-2026",comparisonBasis:basis,linkedOnDate:"2026-11-14"}})) as any).content[0].text);
  const before=fs.readdirSync(vault,{recursive:true}).sort(),v1=await plan(rev.path,v1Dup),v2=await plan(v2Rev,v2Dup);
  expect(v1).toMatchObject({status:"requires_dedicated_review_revision",writePerformed:false});
  expect(v2).toMatchObject({status:"requires_dedicated_review_revision_v2",routeVersion:"M56-REVIEW-SELECTOR-2",writePerformed:false});
  const {tools}=await c.client.listTools(),names=new Set(tools.map(t=>t.name)),d=(n:string)=>tools.find(t=>t.name===n)!.inputSchema as any;
  expect(tools).toHaveLength(22);expect([...names].sort()).toEqual([...toolsList].sort());
  const desc=(await rc.listTools()).tools.find(t=>t.name==="plan_duplicate_source_link")!.description!;
  const ids=(s:string)=>[...new Set(s.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)??[])],tool=(s:string)=>ids(s).filter(id=>names.has(id));
  const v1Text=v1.requiredCompletion.sourceEvent+" "+v1.next,v2Text=v2.requiredCompletion.sourceEvent+" "+v2.next;
  // Positive exact registered names (a silently emptied guidance fails here).
  expect(tool(v2Text)).toEqual(["prepare_source_event_packet","source_event_result_contract","prepare_canonical_review_revision","apply_canonical_review_revision","preview_edit","apply_edit"]);
  expect(tool(v1Text)).toEqual(["prepare_source_event_packet","prepare_canonical_review_revision","apply_canonical_review_revision","preview_edit","apply_edit"]);
  expect(tool(desc)).toEqual(["prepare_canonical_review_revision","apply_canonical_review_revision"]);
  expect(v2Text).toContain('call prepare_source_event_packet with {kind:"revise",input:');expect(v2Text).toContain('source_event_result_contract {contract:"subject_v2"}');
  expect(v2Text).toContain("call prepare_canonical_review_revision with that same V2 input (unchanged selectorVersion M56-REVIEW-SELECTOR-2");
  expect(v2Text).toContain("call apply_canonical_review_revision with {input:<the same V2 input>,operationId,authorization:{operationId,previewToken,expectedHash}}");
  // Parity: V2 uses the SAME dedicated tools as V1, plus only the result-contract handoff.
  expect(tool(v2Text).filter(n=>!tool(v1Text).includes(n))).toEqual(["source_event_result_contract"]);expect(tool(v1Text).filter(n=>!tool(v2Text).includes(n))).toEqual([]);
  // Nonexistent names absent; every remaining snake_case token is a served input value, never a tool.
  for(const t of [v1Text,v2Text,desc])expect(t).not.toMatch(/_v2\b(?<!subject_v2)/);
  // Whole planner payloads: the V2 status string is a status, not a tool; no V2 tool alias anywhere.
  for(const t of [JSON.stringify(v1),JSON.stringify(v2),desc]){expect(t).not.toMatch(/prepare_subject_/);expect(t).not.toMatch(/\b(?:prepare|apply|inspect)_canonical_review_revision_v2\b/);}
  expect(names.has(v2.status)).toBe(false);
  for(const ghost of ["prepare_subject_source_event_packet","prepare_canonical_review_revision_v2","apply_canonical_review_revision_v2"])expect(names.has(ghost)).toBe(false);
  expect(ids(v2Text).filter(id=>!names.has(id)).sort()).toEqual(["duplicate_link_only","subject_v2"]);expect(ids(v1Text).filter(id=>!names.has(id))).toEqual(["duplicate_link_only"]);
  expect(d("source_event_result_contract").properties.contract.enum).toContain("subject_v2");expect(names.has("subject_v2")).toBe(false);
  expect(v2.canonicalReviewRevision.selectorVersion).toBe("M56-REVIEW-SELECTOR-2");expect(JSON.stringify(d("prepare_canonical_review_revision").properties.selectorVersion)).toContain("M56-REVIEW-SELECTOR-2");
  expect(names.has("M56-REVIEW-SELECTOR-2")).toBe(false);expect(v1.canonicalReviewRevision).not.toHaveProperty("selectorVersion");
  // No pre-filled judgement in either client plan.
  expect(v1Text+v2Text).not.toMatch(/\bPASS\b/);
  for(const p of [v1,v2])for(const k of ["disposition","eventRelation","materiality"])expect(p.requiredCompletion.analystAssessment[k]).toMatch(/^<analyst-selected: /);
  // Company V1 entity required + strict per-version parsing + authorization behaviour unchanged; refusals have no effect.
  expect(d("prepare_canonical_review_revision").required).toContain("entity");expect(d("apply_canonical_review_revision").required.sort()).toEqual(["authorization","input","operationId"]);
  const {entity:_e,...noEntity}=v1.canonicalReviewRevision;void _e;
  for(const args of [noEntity,{...v1.canonicalReviewRevision,subject:{domain:"industry"}}]){const r=await c.client.callTool({name:"prepare_canonical_review_revision",arguments:args});expect(r.isError).toBe(true);}
  const forged=await c.client.callTool({name:"apply_canonical_review_revision",arguments:{input:v2.canonicalReviewRevision,operationId:"ICR-"+"0".repeat(32),
   authorization:{operationId:"ICR-"+"0".repeat(32),previewToken:"a".repeat(64),expectedHash:"0".repeat(64)}}});
  expect(forged.isError).toBe(true);
  expect(fs.readdirSync(vault,{recursive:true}).sort()).toEqual(before);expect(raw(v2Rev)).not.toContain(v2Dup.slice(0,-3));expect(sha(raw(rev.path))).toBe(v1.canonicalReviewRevision.existingReview.expectedSha256);
 }finally{await c.close();await rc.close();await research.close();delete process.env.ENCRYPTION_KEY;}
},60_000);

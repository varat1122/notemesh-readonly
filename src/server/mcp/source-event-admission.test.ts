/** SE01–12 NEW synthetic mechanical tests, NOT actual semantic acceptance. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {assessed,approveFixture} from "../../../tests/source-event-fixture";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {SourceEventSubmission} from "../vault/source-event-contract";
const pause=vi.hoisted(()=>({run:null as (()=>Promise<void>)|null}));
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>{await pause.run?.();return run();}}));
const actor="oauth:source-event-fixture",hash=(s:string)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const review={headlineTh:"TESTA ชี้แจงรายละเอียดคู่มือสมมติ",translationTh:"TESTA เผยแพร่คู่มือสมมติสำหรับการใช้งานและมีคำอธิบายประกอบเพิ่มเติม",
 whatChangedTh:"รายละเอียดคู่มือเป็นข้อความที่ได้รับ ยังไม่ได้ยืนยันว่ามีผลต่อการลงทุน",
 mechanismTh:"ยังไม่มีหลักฐานแสดงผลต่อรายได้ กำไร หรือความสัมพันธ์ระหว่างบริษัท",
 thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข้อความดังกล่าว ต้องตรวจหลักฐานเพิ่มเติม",
 counterEvidenceTh:"ข้อมูลอาจซ้ำกับคู่มือเดิม และยังไม่มีการตรวจสอบต้นฉบับอย่างเป็นอิสระ",
 requiredEvidenceTh:"ต้องอ่านเอกสารต้นฉบับและเปรียบเทียบกับประวัติก่อนยกระดับข้อกล่าวอ้าง"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",
 sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"SE synthetic mechanics",sourceUrl:"https://example.org/se/manual",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",researchReview:review};
type Input=WritebackInput&{sourceEvent?:SourceEventSubmission};
beforeEach(async()=>{vi.resetModules();pause.run=null;root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-revision-pilot-")));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,21).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",IOS_C1_REVISION_PILOT:"synthetic"});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","misc"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"05_Thesis/protected.md"),"# Protected unchanged\n");
 await note("01_Companies/TESTA.md","# TESTA\n");await note("01_Companies/TESTB.md","# TESTB\n");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});vi.useRealTimers();vi.restoreAllMocks();
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","IOS_C1_REVISION_PILOT"])delete process.env[k];
});
async function note(p:string,text:string){fs.writeFileSync(path.join(vault,p),text);(await import("../vault/indexer")).reindexPath(p);}
async function capture(input:Input=base){const c=await import("./canonical-writeback");const clean={...input,captureOnly:true,researchReview:undefined,sourceEvent:undefined,claims:undefined};
 const p=c.prepareCanonicalWriteback(clean,actor);const out=await c.applyCanonicalWriteback({input:clean,planId:p.planId,authorizations:p.previews.map(auth)},actor);
 expect(out.steps[0]).toMatchObject({readbackVerified:true,indexed:true,searchable:true});return out.steps[0];}
function auth(p:{operationId:string;previewToken?:string|null;beforeHash:string}){return {operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash};}
async function bound(input:Input=base){await capture(input);const c=await import("./canonical-writeback"),gate=await import("../safe-edit/source-event-admission");
 const clean=c.canonicalInputSchema.parse(input);
 return {...clean,sourceEvent:await assessed(gate.canonicalEventProposal(clean),actor)};}
async function ready(input:Input){const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);
 expect(p.sourceEvent).toMatchObject({decision:"PASS",reasons:[]});for(const v of p.previews)await approveFixture(v.operationId);return p;}
async function apply(input:Input,p:Awaited<ReturnType<typeof ready>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(auth)},actor);}
function reviews(){return fs.readdirSync(path.join(vault,"10_Knowledge/Company Research")).filter(p=>p.startsWith("Investment Review"));}
async function mcp(){const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"NEW-SYNTHETIC-SE",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);return {server,client};}
it("SE01: authenticated OTHERCO/not_related cannot attach to TESTA; exact Source receipt survives",async()=>{
 const input=await bound({...base,extractedText:"SYNTHETIC OTHERCO: unrelated manual. No TESTA association established."});
 input.sourceEvent.result.sourceBindings[0].relation="not_related";
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);
 expect(p.sourceEvent?.reasons).toContain("source_event_issuer_slice_hold");expect(p.previews).toHaveLength(0);
 expect((await apply(input,p)).sourceEvent?.decision).toBe("HOLD");expect(reviews()).toHaveLength(0);await capture(input);
});
it.each(["mentioned_only","unknown","related_issuer"] as const)("unqualified %s association is not company Review authority",async relation=>{
 const input=await bound();input.sourceEvent.result.sourceBindings[0].relation=relation;
 expect((await import("./canonical-writeback")).prepareCanonicalWriteback(input,actor).sourceEvent?.decision).toBe("HOLD");expect(reviews()).toHaveLength(0);
});
it("SE03/11: duplicate/missing existingReview cannot silently create; same-source capture reuses receipt",async()=>{
 const first=await bound();expect((await apply(first,await ready(first))).status).toBe("saved_verified");
 const incoming=await bound({...base,sourceUrl:null,publicationDate:null,eventDate:null,extractedText:"SYNTHETIC forwarded: same TESTA manual described again."});
 const body=JSON.parse(incoming.sourceEvent.packet.body);expect(body.sources[0].declaredMetadata.sourceKind).toBe("news_media");expect(body.sources[0].declaredMetadata.receivedAt).toBeNull();expect(body.context.history.some((h:{path:string})=>h.path.includes("Investment Review"))).toBe(true);
 incoming.sourceEvent.result.event.relation="duplicate";incoming.sourceEvent.result.event.action="duplicate_link_only";
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(incoming,actor);
 expect(p.previews).toHaveLength(0);expect(p.sourceEvent?.reasons).toContain("source_event_create_requires_new_event");
 expect((await apply(incoming,p)).sourceEvent?.decision).toBe("HOLD");
 const a=await capture(incoming),b=await capture(incoming);expect(a.receiptKey).toBe(b.receiptKey);expect(reviews()).toHaveLength(1);
 const missing={...incoming,sourceEvent:undefined};expect(c.prepareCanonicalWriteback(missing,actor).sourceEvent?.decision).toBe("HOLD");
});
it.each(["acquisition versus prior earnings","new actual and guidance periods"])("SE04/05: %s may create with explicit fresh new_event; no issuer-wide HOLD",async scenario=>{
 const historical=scenario.startsWith("acquisition")?"SYNTHETIC TESTA reported Q2 earnings in an earlier release.":"SYNTHETIC TESTA earlier Q3 revenue guidance was USD 90 million.";
 const incoming=scenario.startsWith("acquisition")?"SYNTHETIC TESTA announced a separate proposed acquisition, not the prior Q2 earnings event.":"SYNTHETIC TESTA reported Q3 actual revenue of USD 100 million and Q4 management revenue guidance of USD 120 million.";
 const financialReview={...review,translationTh:"ข้อมูลสมมติ TESTA: แนวโน้ม Q3 เดิม 90 ล้านดอลลาร์ ต่อมารายงาน Actual Q3 100 ล้านดอลลาร์ และ Guidance Q4 120 ล้านดอลลาร์ ต้องแยกงวดและสถานะ ไม่ใช่ข้อเท็จจริงที่ตรวจสอบอิสระแล้ว",
 claimAssessments:[{entity:"TESTA",metric:"revenue",period:"Q3",unit:"USD million",competingValues:["90","100"],resolution:"unresolved" as const,conclusion:"conditional" as const},{entity:"TESTA",metric:"revenue",period:"Q4",unit:"USD million",competingValues:["120"],resolution:"unresolved" as const,conclusion:"conditional" as const}]};
 const first=await bound({...base,extractedText:historical,researchReview:financialReview});expect((await apply(first,await ready(first))).status).toBe("saved_verified");
 const next=await bound({...base,topic:scenario,sourceUrl:"https://example.org/se/new-event",extractedText:incoming,researchReview:financialReview});
 next.sourceEvent.result.event.comparison.period="different";next.sourceEvent.result.event.comparison.role="different";
 const p=await ready(next),out=await apply(next,p);expect(out.status).toBe("saved_verified");expect(reviews()).toHaveLength(2);
 const r=out.steps.find(s=>s.kind==="canonical_review")!;expect(r).toMatchObject({readbackVerified:true,indexed:true,searchable:true});
 const text=fs.readFileSync(path.join(vault,r.path),"utf8");expect(text).toContain("historical_analysis_only");expect(text).toContain("comparator_eligible: false");
 expect((await apply(next,await ready(next))).status).toBe("saved_verified");expect(reviews()).toHaveLength(2);
});
it.each(["correction","contradiction","unresolved"] as const)("SE06/07: %s preserves Source and cannot use a create PASS",async relation=>{
 const oldText=relation==="correction"?"SYNTHETIC TESTA said the contract was USD 8 billion.":"SYNTHETIC TESTA forecast growth of 30%.";
 const newText=relation==="correction"?"SYNTHETIC TESTA explicitly corrects the contract to USD 800 million, not USD 8 billion.":"SYNTHETIC TESTA alternative attributed source forecasts only 10–15% growth; the conflict is unresolved.";
 const old=await capture({...base,extractedText:oldText});
 const input=await bound({...base,extractedText:newText,sourceUrl:"https://example.org/se/competing",researchReview:{...review,
 translationTh:relation==="correction"?"ข้อมูลสมมติ TESTA แก้มูลค่าสัญญาจาก 8 พันล้านดอลลาร์เป็น 800 ล้านดอลลาร์ ต้องตรวจเอกสารการแก้ไข":"แหล่งข้อมูลสมมติที่ขัดแย้งระบุการเติบโตเพียง 10–15% เทียบกับเดิม 30% ยังไม่ทราบว่าข้อใดถูกต้อง ห้ามเฉลี่ยตัวเลข",
 claimAssessments:[{entity:"TESTA",metric:"growth",period:"forecast",unit:"percent",competingValues:["30%","10–15%"],resolution:"unresolved",conclusion:"conditional"}]}});
 expect(JSON.parse(input.sourceEvent.packet.body).context.history.some((h:{path:string})=>h.path===old.path)).toBe(true);
 input.sourceEvent.result.event.relation=relation;input.sourceEvent.result.event.action="hold_for_reconciliation";
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);expect(p.sourceEvent?.decision).toBe("HOLD");
 await capture(input);expect(p.previews).toHaveLength(0);expect(reviews()).toHaveLength(0);
});
it("SE08 PARTIAL: exact issuer slice binds; second-issuer new Review stays HOLD at existing Source-scope boundary",async()=>{
 const input=await bound({...base,extractedText:"SYNTHETIC TESTA: manual A. TESTB: manual B."}),s=input.sourceEvent;
 const text=JSON.parse(s.packet.body).sources[0].text as string;const start=text.indexOf("TESTA:"),end=text.indexOf(" TESTB:");
 s.result.sourceBindings[0].documentRelation="multi_issuer";s.result.sourceBindings[0].references=[{key:"source_0",quote:text.slice(start,end),locator:`utf16:${start}:${end}`,sourceSha256:hash(text)}];
 expect((await apply(input,await ready(input))).status).toBe("saved_verified");
 const changed={...input,entities:["TESTB"]};const c=await import("./canonical-writeback");
 expect(c.prepareCanonicalWriteback(changed,actor).sourceEvent?.decision).toBe("HOLD");expect(reviews()).toHaveLength(1);
 // Existing Source metadata/receipt is immutable. The legacy canonical planner
 // cannot safely change its subject into another issuer's new Review. Report
 // this partial adapter boundary; never manufacture a second source identity.
 const other={...changed,sourceEvent:undefined,researchReview:{...review,headlineTh:"TESTB มีคู่มือสมมติที่ต้องตรวจสอบ",translationTh:"TESTB มีคู่มืออีกชุดในข้อความที่ได้รับ ยังไม่ได้ตรวจสอบต้นฉบับ"}};
 expect(c.prepareCanonicalWriteback(other,actor).sourceEvent?.decision).toBe("HOLD");
 expect(reviews()).toHaveLength(1);
});
it.each(["collision","missing_hub","read_failure"])("SE09: %s holds company authority, Source remains preservable",async fault=>{
 await capture();
 if(fault==="collision")await note("01_Companies/ALIAS.md","---\naliases: [TESTA]\n---\n# Alias collision\n");
 if(fault==="missing_hub"){fs.unlinkSync(path.join(vault,"01_Companies/TESTA.md"));(await import("../vault/indexer")).reindexPath("01_Companies/TESTA.md");}
 if(fault==="read_failure"){await note("10_Knowledge/Company Research/TESTA adverse.md","# TESTA adverse context\n");fs.unlinkSync(path.join(vault,"10_Knowledge/Company Research/TESTA adverse.md"));}
 const c=await import("./canonical-writeback");
 if(fault==="missing_hub")expect(c.prepareCanonicalWriteback(base,actor).sourceEvent?.decision).toBe("HOLD");
 else{const input=await bound();expect(c.prepareCanonicalWriteback(input,actor).sourceEvent?.decision).toBe("HOLD");}
 await capture();expect(reviews()).toHaveLength(0);
});
it("SE10: deliberate bounded omission is not operational failure; unrelated unselected changes stay allowed",async()=>{
 for(let i=0;i<12;i++)await note(`10_Knowledge/Company Research/TESTA archive ${i}.md`,`# TESTA ordinary historical analysis ${i}\n`);
 const input=await bound(),body=JSON.parse(input.sourceEvent.packet.body);
 expect(body.context.witness.selection.length).toBeLessThanOrEqual(8);expect(body.context.retrieval.status).toBe("operational_complete");expect(body.context.omitted.length).toBeGreaterThan(0);
 const p=await ready(input);await note("misc/unrelated.md","# Unrelated BETA note\n");
 expect((await apply(input,p)).status).toBe("saved_verified");
});
it.each(["source","issuer","history","new_selected"])("SE12: %s drift after approval holds at final write",async fault=>{
 await note("10_Knowledge/Company Research/TESTA context.md","# TESTA bounded history\n");
 const input=await bound(),p=await ready(input),body=JSON.parse(input.sourceEvent.packet.body);
 pause.run=async()=>{
 if(fault==="source")await note(body.sources[0].path,fs.readFileSync(path.join(vault,body.sources[0].path),"utf8")+"\nChanged bytes\n");
 if(fault==="issuer")await note("01_Companies/TESTA.md","# TESTA changed identity context\n");
 if(fault==="history")await note("10_Knowledge/Company Research/TESTA context.md","# TESTA changed history\n");
 if(fault==="new_selected")await note("10_Knowledge/Company Research/TESTA counterevidence.md","# TESTA adverse conflicting evidence\n");
 };
 const out=await apply(input,p);expect(out.receipts??[]).toHaveLength(0);expect(reviews()).toHaveLength(0);
});
it.each(["actor","seal","span","missing_history","review_bytes","expiry"])("exact %s binding cannot be forged",async fault=>{
 const input=await bound();
 if(fault==="actor")input.sourceEvent.packet.actorLabelSha256=hash("oauth:other");
 if(fault==="seal")input.sourceEvent.packet.seal="a".repeat(64);
 if(fault==="span")input.sourceEvent.result.sourceBindings[0].references[0].locator="utf16:9999:10000";
 if(fault==="missing_history")input.sourceEvent.result.event.consideredHistoryKeys=[];
 if(fault==="review_bytes")input.researchReview!.whatChangedTh="ข้อความเปลี่ยนหลังการประเมิน ต้องใช้การประเมินใหม่เท่านั้น";
 if(fault==="expiry")vi.setSystemTime(Date.now()+31*60000);
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);expect(p.sourceEvent?.decision).toBe("HOLD");expect(p.previews).toHaveLength(0);expect(reviews()).toHaveLength(0);
});
it("all routes: missing assessment, generic preview/apply, raw writer and importer cannot bypass",async()=>{
 const input=await bound(),c=await import("./canonical-writeback"),engine=await import("../safe-edit/engine");
 const no=c.prepareCanonicalWriteback({...input,sourceEvent:undefined},actor);expect(no.previews).toHaveLength(0);
 const p=await ready(input),v=p.previews[0],proposal=(await import("../safe-edit/source-event-admission")).canonicalEventProposal(c.canonicalInputSchema.parse(input));
 const request={operationId:"GENERIC-EVENT-BYPASS",path:v.path,reason:"synthetic generic bypass",change:proposal.targets[0].change};
 const {server,client}=await mcp();try{
 expect((await client.callTool({name:"preview_edit",arguments:request})).isError).toBe(true);
 expect((await client.callTool({name:"apply_edit",arguments:auth(v)})).isError).toBe(true);
 expect(()=>engine.preview({...request,operationId:v.operationId},actor)).toThrow();
 expect(()=>engine.apply(auth(v),actor)).toThrow(/dedicated/);
 const {denyPilotRawWriter}=await import("../c1-pilot");expect(denyPilotRawWriter).toThrow(/source_event/);
 const notes=await import("../vault/notes"),disk=await import("../vault/disk");
 expect(()=>notes.createNote("misc/raw.md","# unreviewed company analysis")).toThrow(/source_event/);
 expect(()=>disk.writeVaultFile(path.join(vault,"misc/raw.md"),"raw bypass")).toThrow(/source_event/);
 const {createRequire}=await import("node:module"),require=createRequire(import.meta.url);
 expect(()=>require("../../../scripts/intake-importer.cjs").importItem({},vault)).toThrow(/source_event/);
 delete process.env.IOS_C1_REVISION_PILOT;expect(denyPilotRawWriter).toThrow(/source_event/);
 }finally{await client.close();await server.close();}
 expect(reviews()).toHaveLength(0);
});
it.each(["HOLD","FAIL"] as const)("MCP pre-schema %s withdraws exact enrolled authority; replay cannot write",async decision=>{
 const input=await bound(),p=await ready(input),revoked=structuredClone(input);revoked.sourceEvent.result.disposition=decision;
 const {server,client}=await mcp();try{
 const out=await client.callTool({name:"apply_canonical_writeback",arguments:{input:revoked,planId:p.planId,authorizations:"SDK-invalid"}});expect(out.isError).toBe(true);
 const engine=await import("../safe-edit/engine");expect(()=>engine.applyCanonicalAssessed(auth(p.previews[0]),actor)).toThrow();
 expect(()=>(engine.adminPreview(p.previews[0].operationId))).toThrow();
 }finally{await client.close();await server.close();}
 const c=await import("./canonical-writeback");expect(()=>c.prepareCanonicalWriteback(input,actor)).toThrow(/revoked_envelope/);
 expect(reviews()).toHaveLength(0);await capture(input);
});
it("withdrawal recovery needs a fresh sealed envelope; obsolete/cross-actor restriction cannot revoke it",async()=>{
 const a=await bound(),pa=await ready(a),c=await import("./canonical-writeback"),gate=await import("../safe-edit/source-event-admission");
 const hold=structuredClone(a.sourceEvent);hold.result.disposition="HOLD";gate.withdrawSourceEvent(hold,actor);
 expect(()=>c.prepareCanonicalWriteback(a,actor)).toThrow(/revoked_envelope/);
 vi.setSystemTime(Date.now()+10);
 const b={...a,sourceEvent:await assessed(gate.canonicalEventProposal(c.canonicalInputSchema.parse(a)),actor)};
 const pb=await ready(b);gate.withdrawSourceEvent(hold,actor);
 const wrong=structuredClone(b.sourceEvent);wrong.result.disposition="FAIL";gate.withdrawSourceEvent(wrong,"oauth:other");
 const recovered=await apply(b,pb);expect(c.prepareCanonicalWriteback(b,actor).sourceEvent).toMatchObject({decision:"PASS",reasons:[]});expect(recovered).toMatchObject({status:"saved_verified",interrupted:null});expect(reviews()).toHaveLength(1);
 expect(pa.previews[0].operationId).toBe(pb.previews[0].operationId); // fresh approved token, never another economic identity
});
it("all non-Source targets require approval; exact self-writes do not cause stale-history false HOLD",async()=>{
 const text="SYNTHETIC TESTA manual describes 20 pages and 3 sections.";
 const input=await bound({...base,extractedText:text,claims:[
 {entity:"TESTA",metric:"manual pages",value:"20",unit:"pages",period:"manual edition",evidenceClass:"reported_actual",statement:"Synthetic attributed count, unverified",sourceLocator:"received text",sourceExcerpt:text,verification:"unverified"},
 {entity:"TESTA",metric:"manual sections",value:"3",unit:"sections",period:"manual edition",evidenceClass:"reported_actual",statement:"Synthetic attributed count, unverified",sourceLocator:"received text",sourceExcerpt:text,verification:"unverified"}
 ]});
 const c=await import("./canonical-writeback"),engine=await import("../safe-edit/engine"),p=c.prepareCanonicalWriteback(input,actor);
 expect(p.sourceEvent).toMatchObject({decision:"PASS",reasons:[]});expect(p.previews).toHaveLength(3);
 await approveFixture(p.previews[0].operationId);
 const refused=await apply(input,p);expect(refused.completedWriteReceipts).toBe(0);expect(reviews()).toHaveLength(0);
 for(const v of p.previews)await approveFixture(v.operationId);
 const q=p.previews[0],row=(await import("../db")).db().prepare("SELECT payload FROM safe_edit_operations WHERE id=?").get(q.operationId) as {payload:string};
 expect(()=>engine.preview({...JSON.parse(row.payload),operationId:"ALIAS-SEMANTIC-BYTES"},actor)).toThrow();
 const out=await apply(input,p);expect(out.status).toBe("saved_verified");expect(out.completedWriteReceipts).toBe(3);
 expect(out.steps.every(s=>s.readbackVerified&&s.indexed&&s.searchable)).toBe(true);
});
it("MCP descriptors expose exact typed Source/Event contract without widening OAuth or invoking a model",async()=>{
 await capture();const {server,client}=await mcp();try{
 const list=await client.listTools();expect(list.tools.map(t=>t.name)).toEqual(expect.arrayContaining(["prepare_source_event_packet","source_event_result_contract"]));
 const built=await client.callTool({name:"prepare_source_event_packet",arguments:{kind:"create",input:base}});expect(built.isError).not.toBe(true);
 const contract=await client.callTool({name:"source_event_result_contract",arguments:{}});expect(contract.isError).not.toBe(true);
 const text=JSON.stringify(built);expect(text).toContain("analyst_attested_unverified");expect(text).toContain("packetEnvelopeDigest");
 const descriptor=list.tools.find(t=>t.name==="prepare_canonical_writeback")!;expect(JSON.stringify(descriptor.inputSchema)).toContain("sourceEvent");
 }finally{await client.close();await server.close();}
});

it.each(["hash","time"])("receipt reader rejects final approval %s corruption after legitimate fresh reassessment",async fault=>{
 const a=await bound(),pa=await ready(a),c=await import("./canonical-writeback"),gate=await import("../safe-edit/source-event-admission");
 const hold=structuredClone(a.sourceEvent);hold.result.disposition="HOLD";gate.withdrawSourceEvent(hold,actor);
 vi.setSystemTime(Date.now()+10);
 const b={...a,sourceEvent:await assessed(gate.canonicalEventProposal(c.canonicalInputSchema.parse(a)),actor)};
 const pb=await ready(b),out=await apply(b,pb);expect(out.status).toBe("saved_verified");
 const p=pa.previews[0].path,raw=fs.readFileSync(path.join(vault,p),"utf8"),reader=await import("../vault/investment-research-context"),d=(await import("../db")).db();
 expect(reader.createReceipt("canonical_review",p,raw)).toBe(pa.previews[0].operationId);
 const latest=d.prepare("SELECT rowid FROM safe_edit_events WHERE operation_id=? AND event='approved' ORDER BY rowid DESC LIMIT 1").get(pa.previews[0].operationId) as {rowid:number};
 // Fault an existing real approval only; never create a substitute receipt.
 if(fault==="hash")d.prepare("UPDATE safe_edit_events SET detail=json_set(detail,'$.afterHash',?) WHERE rowid=?").run("0".repeat(64),latest.rowid);
 else d.prepare("UPDATE safe_edit_events SET at='2000-01-01T00:00:00.000Z' WHERE rowid=?").run(latest.rowid);
 expect(()=>reader.createReceipt("canonical_review",p,raw)).toThrow(/create_receipt_unverified/);
 expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe(raw);
});

it("delayed semantic review keeps real Preview chronology and exact receipt binding",async()=>{
 const input=await bound({...base,researchLineage:{knowledgeCutoffAsOf:null}});
 vi.setSystemTime(Date.now()+120000); // review-time wait, not backdating analysis
 const p=await ready(input);vi.setSystemTime(Date.now()+120000);
 expect((await apply(input,p)).status).toBe("saved_verified");
});
it("legacy unreceipted Review remains unverified historical context, not a canonical receipt",async()=>{
 const p="10_Knowledge/Company Research/Investment Review - TESTA - IN-AAAAAAAAAAAAAAAA.md";
 await note(p,"---\ntype: investment_research_review\nintake_id: IN-AAAAAAAAAAAAAAAA\n---\n# TESTA historical unverified legacy analysis\n");
 const input=await bound(),body=JSON.parse(input.sourceEvent.packet.body),h=body.context.history.find((x:{path:string})=>x.path===p);
 expect(h).toMatchObject({receiptId:null,source:null,receiptBinding:"legacy_historical_unverified"});
 expect((await apply(input,await ready(input))).status).toBe("saved_verified");
});

it("selected generated Claim cannot fall back to unverified legacy history when its binding is invalid",async()=>{
 const p="10_Knowledge/Company Research/Investment Claim - ICL-"+"A".repeat(32)+".md";
 await note(p,"---\ntype: investment_structured_claim_register\ncompany: TESTA\nentity: TESTA\ndomain: company\n---\n# TESTA adverse unbound generated claim\n");
 const input=await bound(),body=JSON.parse(input.sourceEvent.packet.body);
 expect(body.context.constraints).toContain("source_event_selected_history_readback_hold");
 expect((await import("./canonical-writeback")).prepareCanonicalWriteback(input,actor).sourceEvent?.decision).toBe("HOLD");
 expect(reviews()).toHaveLength(0);await capture(input);
});

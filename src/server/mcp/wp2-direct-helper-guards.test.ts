/** WP2 synthetic oracles N22/N24 (exact engine exports) and E03 (public MCP path).
 * OFF after the migration epoch; authority path only: SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
const actor="oauth:wp2-direct-helper-fixture",sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const review={headlineTh:"TESTA ชี้แจงรายละเอียดคู่มือสมมติ",translationTh:"TESTA เผยแพร่คู่มือสมมติสำหรับการใช้งานและมีคำอธิบายการติดตั้ง",
 whatChangedTh:"รายละเอียดคู่มือเป็นข้อความที่ได้รับ ยังไม่ได้ยืนยันว่ามีผลต่อการลงทุน",mechanismTh:"ยังไม่มีหลักฐานแสดงผลต่อรายได้ กำไร หรือความสัมพันธ์ระหว่างบริษัท",
 thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข้อความดังกล่าว ต้องตรวจหลักฐานเพิ่มเติม",counterEvidenceTh:"ข้อมูลอาจซ้ำกับคู่มือเดิม และยังไม่มีการตรวจสอบต้นฉบับอย่างเป็นอิสระ",
 requiredEvidenceTh:"ต้องอ่านเอกสารต้นฉบับและเปรียบเทียบกับประวัติก่อนยกระดับข้อกล่าวอ้าง"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",
 sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"WP2 direct helper mechanics",sourceUrl:"https://example.org/wp2/direct",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",researchReview:review};
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-direct-")));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,37).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","Notes"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 for(const [p,t] of [["05_Thesis/protected.md","# Protected unchanged\n"],["01_Companies/TESTA.md","# TESTA\n"],["Notes/Ordinary.md","# Ordinary\noriginal line\n"]])fs.writeFileSync(path.join(vault,p),t);
 const ix=await import("../vault/indexer");for(const p of ["01_Companies/TESTA.md","Notes/Ordinary.md"])ix.reindexPath(p);
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),ops:n("safe_edit_operations"),plan:n("canonical_plan"),witness:n("canonical_witness"),consumption:n("witness_consumption"),
  epoch:has("authority_epoch")?d.prepare("SELECT * FROM authority_epoch ORDER BY scope_kind,scope_id").all():[],receipt:n("safe_edit_operations","WHERE status='written'"),index:n("notes")};
}
const auth=(p:{operationId:string;previewToken?:string|null;beforeHash:string})=>({operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash});
/** MCP results fence vault data between boundary markers; return the fenced JSON object. */
function unwrap(r:unknown){const outer=JSON.parse((r as {content:{text:string}[]}).content[0].text) as {boundary:string;result:string};
 return JSON.parse(outer.result.split(outer.boundary).join("").trim());}
const ordinary=(id:string)=>({operationId:id,path:"Notes/Ordinary.md",reason:"WP2 ordinary edit",change:{kind:"replace",oldText:"original line",newText:"edited "+id}});

it("N22/N24: every direct engine export refuses cross-route use of canonical IDs/witnesses; legitimate dedicated and ordinary paths still succeed",async()=>{
 const admission=await import("../safe-edit/admission"),engine=await import("../safe-edit/engine"),c=await import("./canonical-writeback");
 // Synthetic pending PRE-WP2 authority (no witness; the WP2 generic route can no longer create one).
 const d=(await import("../db")).db();
 const pendingPreWp2=(text:string)=>{
  const p=c.prepareCanonicalWriteback({...base,captureOnly:true as const,researchReview:undefined,extractedText:text},actor).previews[0];
  const w=admission.witnessFor(p.operationId)!;d.prepare("DELETE FROM canonical_witness WHERE witness_id=?").run(w.witness_id);
  d.prepare("DELETE FROM canonical_plan WHERE plan_id=? AND NOT EXISTS(SELECT 1 FROM canonical_witness WHERE plan_id=?)").run(w.plan_id,w.plan_id);
  return p;
 };
 // OD-05 before the epoch: pending pre-WP2 authority completes only on the dedicated kernel route.
 const early=pendingPreWp2("SYNTHETIC TESTA: pre-epoch pending note completed before cutover.");
 expect(()=>engine.apply(auth(early),actor)).toThrow(/canonical_route_required/);
 expect(engine.applyCanonicalStep(auth(early),actor).status).toBe("written");
 expect(admission.operationProvenanceTier(early.operationId)).toBe("legacy_origin_unverified");
 const legacy=pendingPreWp2("SYNTHETIC TESTA: pre-epoch pending generic note.");
 admission.establishMigrationEpoch("wp2-fixture-admin");
 const prep=c.prepareCanonicalWriteback(base,actor),src=prep.previews.find(p=>p.kind==="source_intake")!,rev=prep.previews.find(p=>p.kind==="canonical_review")!;
 const o=engine.preview(ordinary("wp2-direct-ordinary-1"),actor);
 const before=await ledger();
 // apply (generic) cannot consume kernel witnesses or canonical IDs.
 for(const p of [src,rev])expect(()=>engine.apply(auth(p),actor)).toThrow(/canonical_route_required/);
 expect(()=>engine.apply(auth(legacy),actor)).toThrow(/authority_superseded_by_migration/);
 // applyCanonicalRevision is only for managed ICR revisions.
 for(const p of [src,rev])expect(()=>engine.applyCanonicalRevision(auth(p),actor)).toThrow(/canonical_review_revision_scope_hold/);
 // Kernel applies never accept an unwitnessed operation once the regime is active.
 for(const fn of [engine.applyCanonicalStep,engine.applyCanonicalAssessed,engine.applyCanonicalRevision])
  expect(()=>fn(auth(o),actor)).toThrow(/canonical_witness_required/);
 for(const fn of [engine.applyCanonicalStep,engine.applyCanonicalAssessed])expect(()=>fn(auth(legacy),actor)).toThrow(/authority_superseded_by_migration/);
 // Preview helpers: no handle, no witness; generic preview cannot reuse a canonical ID/path.
 const req=JSON.parse((await import("../db")).db().prepare("SELECT payload FROM safe_edit_operations WHERE id=?").pluck().get(src.operationId) as string);
 for(const fn of [engine.previewCanonicalSource,engine.previewCanonicalReview,engine.previewCanonicalAssessedClaim,engine.previewCanonicalClaim])
  expect(()=>fn({planId:prep.planId},req,actor)).toThrow(/canonical_plan_handle_required/);
 expect(()=>engine.previewCanonicalRevision({planId:prep.planId},req,actor)).toThrow(/canonical_review_revision_scope_hold/);
 expect(()=>engine.preview(req,actor)).toThrow(/canonical_operation_namespace_reserved/);
 expect(()=>engine.preview({...req,operationId:"ordinary-alias-1"},actor)).toThrow(/canonical_route_required/);
 // approve(): stale/unwitnessed canonical authority cannot be approved.
 expect(()=>engine.approve(legacy.operationId,"simulated-dashboard-reviewer",legacy.afterHash)).toThrow(/authority_superseded_by_migration/);
 // Judge/appearance journals are not witness or plan writers.
 expect(()=>engine.recordResearchJudgeGate("ICW-"+"9".repeat(32),actor,{} as never)).toThrow();
 expect(()=>engine.recordCanonicalAppearance({} as never,actor)).toThrow();
 expect(await ledger()).toEqual(before);
 // Adjacent positives: dedicated writeback and ordinary generic edit both succeed.
 const out=await c.applyCanonicalWriteback({input:base,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
 expect(out.status).toBe("saved_verified");
 for(const p of prep.previews)expect(admission.operationProvenanceTier(p.operationId)).toBe("server_witnessed");
 expect(engine.apply(auth(o),actor)).toMatchObject({status:"written"});
 // Generic rollback cannot target a canonical record; ordinary rollback preview remains available.
 expect(()=>engine.preview({operationId:"wp2-rollback-canonical",path:rev.path,reason:"rollback probe",change:{kind:"rollback",operationId:rev.operationId}},actor)).toThrow(/canonical_review_revision_dedicated_route_required/);
 expect(engine.preview({operationId:"wp2-rollback-ordinary",path:"Notes/Ordinary.md",reason:"ordinary rollback",change:{kind:"rollback",operationId:o.operationId}},actor).previewToken).toMatch(/^[a-f0-9]{64}$/);
});

it("E03/E04: public MCP surface — canonical forge refused with zero effects; legitimate MCP writeback and ordinary edit succeed; no epoch/witness tool exposed",async()=>{
 (await import("../safe-edit/admission")).establishMigrationEpoch("wp2-fixture-admin");
 const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"WP2-SYNTHETIC",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{
  const names=(await client.listTools()).tools.map(t=>t.name);
  expect(names).toEqual(expect.arrayContaining(["preview_edit","apply_edit","create_note","rollback_edit","prepare_canonical_writeback","apply_canonical_writeback","prepare_canonical_review_revision","apply_canonical_review_revision","store_user_attachment"]));
  expect(names.filter(n=>/epoch|migration|witness|capabilit|canonical_step|plan_handle/i.test(n))).toEqual([]);
  const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
  const step=planInvestmentWriteback({...base,captureOnly:true,researchReview:undefined}).safeEditWorkflow!.steps.find(s=>s.kind==="source_intake")!.safeEditRequest!;
  const before=await ledger();
  const text=(r:unknown)=>JSON.stringify(r);
  const forge=await client.callTool({name:"preview_edit",arguments:{...step,reason:"OFF-mode ICW forge"}});
  expect(forge.isError).toBe(true);expect(text(forge)).toContain("canonical_operation_namespace_reserved");
  const forge2=await client.callTool({name:"create_note",arguments:{operationId:"wp2-mcp-forge-2",path:step.path,reason:"forge",content:(step.change as {content:string}).content}});
  expect(forge2.isError).toBe(true);expect(text(forge2)).toContain("canonical_route_required");
  const forge3=await client.callTool({name:"apply_edit",arguments:{operationId:step.operationId,previewToken:"a".repeat(64),expectedHash:"b".repeat(64)}});
  expect(forge3.isError).toBe(true);
  expect(await ledger()).toEqual(before);
  const p=await client.callTool({name:"preview_edit",arguments:ordinary("wp2-mcp-ordinary-1")});expect(p.isError).not.toBe(true);
  const pv=unwrap(p) as {operationId:string;previewToken:string;beforeHash:string};
  const ap=await client.callTool({name:"apply_edit",arguments:auth(pv)});expect(ap.isError).not.toBe(true);
  const prep=await client.callTool({name:"prepare_canonical_writeback",arguments:base as never});expect(prep.isError).not.toBe(true);
  const pr=unwrap(prep) as {planId:string;previews:{operationId:string;previewToken:string;beforeHash:string}[]};
  const out=await client.callTool({name:"apply_canonical_writeback",arguments:{input:base,planId:pr.planId,authorizations:pr.previews.map(auth)} as never});
  expect(out.isError).not.toBe(true);expect(text(out)).toContain("saved_verified");
 }finally{await client.close();await server.close();}
});

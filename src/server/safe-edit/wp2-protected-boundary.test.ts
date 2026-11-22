/** WP2 synthetic oracles P01/N01 and P06/N19/N23 per mode.
 * OFF: REAL local persistence through the Git backend to a local bare remote (no network).
 * C1:  REAL local persistence through the C1 no-external-writer pause (no mock).
 * RP:  authority path only with SYNC_DOUBLE_NOT_PERSISTENCE_PROOF (not a real-Git proof). */
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import type {WritebackInput} from "../vault/investment-writeback-router";
const syncDouble=vi.hoisted(()=>({on:false}));
// RP/move tests only: SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. OFF/C1 resolve the REAL module at call time
// (current module registry), so no stale connection survives vi.resetModules().
vi.mock("./sync",()=>({withPausedSync:async<T>(run:()=>T)=>syncDouble.on?run():(await vi.importActual<typeof import("./sync")>("./sync")).withPausedSync(run)}));
const actor="oauth:wp2-boundary-fixture",sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const identityKey=Symbol.for("notemesh.c1-pilot.identity.v1");
let root:string,vault:string,remote:string;
const review={headlineTh:"TESTA ชี้แจงรายละเอียดคู่มือสมมติ",translationTh:"TESTA เผยแพร่คู่มือสมมติสำหรับการใช้งานและมีคำอธิบายการติดตั้ง",
 whatChangedTh:"รายละเอียดคู่มือเป็นข้อความที่ได้รับ ยังไม่ได้ยืนยันว่ามีผลต่อการลงทุน",mechanismTh:"ยังไม่มีหลักฐานแสดงผลต่อรายได้ กำไร หรือความสัมพันธ์ระหว่างบริษัท",
 thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข้อความดังกล่าว ต้องตรวจหลักฐานเพิ่มเติม",counterEvidenceTh:"ข้อมูลอาจซ้ำกับคู่มือเดิม และยังไม่มีการตรวจสอบต้นฉบับอย่างเป็นอิสระ",
 requiredEvidenceTh:"ต้องอ่านเอกสารต้นฉบับและเปรียบเทียบกับประวัติก่อนยกระดับข้อกล่าวอ้าง"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",
 sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"WP2 boundary synthetic mechanics",sourceUrl:"https://example.org/wp2/boundary",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",researchReview:review};
const capture=(i:WritebackInput)=>({...i,captureOnly:true,researchReview:undefined});
function git(cwd:string,...args:string[]){return execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{PATH:process.env.PATH??"",HOME:root,
 GIT_AUTHOR_NAME:"Synthetic",GIT_AUTHOR_EMAIL:"fixture@invalid",GIT_COMMITTER_NAME:"Synthetic",GIT_COMMITTER_EMAIL:"fixture@invalid",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"}}).trim();}
function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!==".git").flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
function dirs(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name!==".git").flatMap(e=>[b+e.name+"/",...dirs(path.join(dir,e.name),b+e.name+"/")]).sort();}
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),dirs:dirs(),ops:n("safe_edit_operations"),plan:n("canonical_plan"),witness:n("canonical_witness"),consumption:n("witness_consumption"),
  receipt:n("safe_edit_operations","WHERE status='written'"),index:n("notes"),protected:sha(fs.readFileSync(path.join(vault,"05_Thesis/protected.md")))};
}
function layout(){
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","06_Portfolio","07_Sources/ChatGPT","Notes"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 for(const [p,t] of [["05_Thesis/protected.md","# Protected unchanged\n"],["01_Companies/TESTA.md","# TESTA\n"],["Notes/Ordinary.md","# Ordinary\noriginal line\n"],["06_Portfolio/Positions.md","# Positions\n"]])
  if(!fs.existsSync(path.join(vault,p)))fs.writeFileSync(path.join(vault,p),t);
}
async function reindex(){const ix=await import("../vault/indexer");for(const p of ["01_Companies/TESTA.md","Notes/Ordinary.md","05_Thesis/protected.md"])ix.reindexPath(p);}
async function teardown(){
 expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 try{(await import("../db")).db().close();}catch{/* instance-held DB (C1 enrolled) cannot reopen in OFF */}
 delete (globalThis as Record<symbol,unknown>)[identityKey];
 fs.rmSync(root,{recursive:true,force:true});syncDouble.on=false;
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","IOS_C1_REVISION_PILOT","C1_RESEARCH_PILOT","CLOUD_INTAKE","OB_ALLOW_LOCAL_GIT","SAFE_EDIT_GIT_REMOTE","SAFE_EDIT_GIT_BRANCH"])delete process.env[k];
}
const ordinaryEdit=(id:string)=>({operationId:id,path:"Notes/Ordinary.md",reason:"WP2 ordinary noncanonical edit",change:{kind:"replace",oldText:"original line",newText:"edited line "+id}});
const auth=(p:{operationId:string;previewToken?:string|null;beforeHash:string})=>({operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash});
/** N19/N23 generic refusals with alias forms; zero side effects. */
async function genericCanonicalRefusals(sourcePath:string){
 const engine=await import("./engine"),before=await ledger();
 const name=path.posix.basename(sourcePath),dir=path.posix.dirname(sourcePath);
 // Same-folder case/NFD/format-character/./ aliases reach the PD-11 predicate.
 const aliases=[sourcePath,`${dir}/${name.toLowerCase()}`,`${dir}/${name.toUpperCase().replace(/\.MD$/,".md")}`,`${dir}/./${name}`,
  `${dir}/${name.replace("Intake","In\u200Dtake")}`,`${dir}/\uFEFF${name}`,`${dir}/${name.normalize("NFD")}`];
 for(const p of aliases)expect(()=>engine.preview({operationId:"wp2-alias-probe-1",path:p,reason:"alias probe",change:{kind:"create",content:"# forged\n"}},actor),JSON.stringify(p)).toThrow(/canonical_route_required/);
 // Whole-path case changes and trailing dot/space are refused earlier (missing parent / non-.md).
 for(const p of [sourcePath.toLowerCase(),sourcePath.toUpperCase(),`${dir}/${name}.`,`${dir}/${name} `])
  expect(()=>engine.preview({operationId:"wp2-alias-probe-2",path:p,reason:"alias probe",change:{kind:"create",content:"# forged\n"}},actor),p).toThrow();
 for(const id of ["ICW-"+"d".repeat(32),"icr-"+"e".repeat(32),"IPB-0001x","Irj-probe-1","IPL-"+"f".repeat(32)])
  expect(()=>engine.preview({...ordinaryEdit(id),operationId:id},actor),id).toThrow(/canonical_operation_namespace_reserved/);
 for(const p of ["07_Sources/ChatGPT/forged.md","06_Portfolio/Positions.md","07_sources/chatgpt/x.md"])
  expect(()=>engine.preview({operationId:"wp2-protected-probe",path:p,reason:"protected probe",change:{kind:"create",content:"# x\n"}},actor),p).toThrow();
 expect(await ledger()).toEqual(before);
}
/** Raw writers: canonical/protected targets (before and after paths) refused post-regime; ordinary raw writes still work. */
async function rawRefusals(sourcePath:string){
 const notes=await import("../vault/notes"),folders=await import("../vault/folders"),before=await ledger();
 expect(()=>notes.createNote(sourcePath.replace("IN-","in-").replace(/[A-F0-9]{16}/,"0123456789abcdef"),"# forged\n")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>notes.createNote("07_Sources/ChatGPT/raw.md","# raw\n")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>notes.moveNote("Notes/Ordinary.md",sourcePath.replace(/[A-F0-9]{16}/,"FEDCBA9876543210"))).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>notes.moveNote(sourcePath,"Notes/Moved.md")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>notes.deleteNote(sourcePath)).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>folders.moveFolder("00_Inbox","Archive")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>folders.moveFolder("Notes","10_Knowledge/Company Research/Notes")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>folders.deleteFolder("06_Portfolio")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(await ledger()).toEqual(before);
}

/** M56-P1-08: Industry-IN / Macro-IN canonical Reviews are reachable ONLY through the dedicated
 * versioned revision route: generic preview (append/create), raw writers and, in C1, the V2
 * dedicated route itself are refused in every mode with zero side effects. */
const subjectReviews=["10_Knowledge/Industry and Concepts/Investment Review - Memory - IN-1111111111111111.md","10_Knowledge/Macro and Markets/Investment Review - Thailand - IN-2222222222222222.md"];
async function subjectReviewRefusals(mode:"off"|"c1"|"rp"){
 for(const p of subjectReviews){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});
  fs.writeFileSync(path.join(vault,p),"---\ntype: investment_research_review\nreview_scope: \""+(p.includes("Macro")?"macro":"industry")+"\"\n---\n## Research analysis\nSynthetic.\n");}
 const ix=await import("../vault/indexer");for(const p of subjectReviews)ix.reindexPath(p);
 const engine=await import("./engine"),notes=await import("../vault/notes"),bridge=await import("../mcp/canonical-review-revision"),before=await ledger();
 for(const p of subjectReviews){
  expect(()=>engine.preview({operationId:"m56p1-generic-append",path:p,reason:"probe",change:{kind:"append",heading:"Research analysis",content:"forged",date:"2026-11-14"}},actor),p)
   .toThrow(/canonical_route_required|dedicated_route_required|c1_pilot/);
  expect(()=>engine.preview({operationId:"m56p1-generic-create",path:p.replace(/IN-\d{16}/,"IN-3333333333333333"),reason:"probe",change:{kind:"create",content:"# forged\n"}},actor),p)
   .toThrow(/canonical_route_required|c1_pilot/);
  expect(()=>notes.appendToNote(p,"forged\n"),p).toThrow(/canonical_or_protected_raw_write_refused|c1_pilot|source_event_canonical_writer_required/);
 }
 if(mode==="c1")expect(()=>bridge.prepareReviewRevision({selectorVersion:"M56-REVIEW-SELECTOR-2"},actor)).toThrow(/revision_pilot_isolated_scope_required/);
 expect(await ledger()).toEqual(before);
}

describe("OFF — real Git persistence to a local bare remote",()=>{
 let b:import("../sync/git").GitBackend;
 const idle=async()=>vi.waitFor(()=>expect(b.status().activity.active).toBe(false),{timeout:15_000,interval:10});
 beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-off-git-")));remote=path.join(root,"remote.git");const device=path.join(root,"device");vault=path.join(root,"data","vault");
  Object.assign(process.env,{DATA_DIR:path.join(root,"data"),ENCRYPTION_KEY:Buffer.alloc(32,29).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",
   CLOUD_INTAKE:"1",OB_ALLOW_LOCAL_GIT:"1",SAFE_EDIT_GIT_REMOTE:remote,SAFE_EDIT_GIT_BRANCH:"main"});
  git(root,"init","--bare","-b","main",remote);git(root,"clone",remote,device);
  const v=vault;vault=device;layout();vault=v;git(device,"add","-A");git(device,"commit","-m","synthetic seed");git(device,"push","origin","main");
  fs.mkdirSync(path.dirname(vault),{recursive:true});git(root,"clone",remote,vault);layout();
  const d=await import("../db");
  for(const [k,val] of Object.entries({sync_backend:"git",vault_configured:"true",git_remote:remote,git_branch:"main",git_pull_seconds:"3600"}))d.setSetting(k,val);
  await reindex();b=(await import("../sync/git")).gitBackend();b.start();await idle();
 });
 afterEach(async()=>{b.stop();await idle();delete (globalThis as Record<string,unknown>).__obSyncGitBackend;await teardown();});
 it("P06 positive + P01: ordinary generic edit and Source-only intake persist to the remote after the migration epoch",async()=>{
  const admission=await import("./admission"),engine=await import("./engine"),sync=await import("./sync");
  admission.establishMigrationEpoch("wp2-fixture-admin");
  const p=engine.preview(ordinaryEdit("wp2-off-ordinary-1"),actor);
  const r=await sync.withPausedSync(()=>engine.apply(auth(p),actor));expect(r).toMatchObject({status:"written"});
  const c=await import("../mcp/canonical-writeback"),inp=capture(base),prep=c.prepareCanonicalWriteback(inp,actor);
  expect(prep.previews.map(x=>x.kind)).toEqual(["source_intake"]);
  const out=await c.applyCanonicalWriteback({input:inp,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
  expect(out.status).toBe("source_saved_analysis_pending");expect(admission.operationProvenanceTier(prep.previews[0].operationId)).toBe("server_witnessed");
  await idle();
  expect(git(remote,"rev-parse","refs/heads/main")).toBe(git(vault,"rev-parse","HEAD"));
  expect(sha(execFileSync("git",["show","refs/heads/main:Notes/Ordinary.md"],{cwd:remote}))).toBe(p.afterHash);
  const src=out.steps[0].path;
  expect(sha(execFileSync("git",["show","refs/heads/main:"+src],{cwd:remote}))).toBe(sha(fs.readFileSync(path.join(vault,src))));
  expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toEqual([]);
  await genericCanonicalRefusals(src);await rawRefusals(src);
  // Adjacent positive after refusals: ordinary raw write still works.
  (await import("../vault/notes")).createNote("Notes/Raw ordinary.md","# raw ordinary\n");
  expect(fs.existsSync(path.join(vault,"Notes/Raw ordinary.md"))).toBe(true);
 },60_000);
 it("A01: with NO migration epoch, OFF refuses generic/raw canonical forgery with zero effects; ordinary edit and Source-only still persist to the remote",async()=>{
  const admission=await import("./admission"),engine=await import("./engine"),sync=await import("./sync");
  expect(admission.migrationEpoch()).toBeNull();
  const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
  const step=planInvestmentWriteback(capture(base)).safeEditWorkflow!.steps.find(s=>s.kind==="source_intake")!.safeEditRequest!;
  const before=await ledger();
  expect(()=>engine.preview({...step,reason:"pre-epoch OFF ICW forge"},actor)).toThrow(/canonical_operation_namespace_reserved/);
  expect(()=>engine.preview({...step,operationId:"pre-epoch-alias-1",reason:"pre-epoch canonical path"},actor)).toThrow(/canonical_route_required/);
  expect(await ledger()).toEqual(before);
  const p=engine.preview(ordinaryEdit("wp2-off-pre-epoch-1"),actor);
  expect(await sync.withPausedSync(()=>engine.apply(auth(p),actor))).toMatchObject({status:"written"});
  const c=await import("../mcp/canonical-writeback"),inp=capture(base),prep=c.prepareCanonicalWriteback(inp,actor);
  // A02 before any epoch: the generic route never consumes the kernel witness.
  expect(()=>engine.apply(auth(prep.previews[0]),actor)).toThrow(/canonical_route_required/);
  const out=await c.applyCanonicalWriteback({input:inp,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
  expect(out.status).toBe("source_saved_analysis_pending");
  await idle();
  expect(sha(execFileSync("git",["show","refs/heads/main:Notes/Ordinary.md"],{cwd:remote}))).toBe(p.afterHash);
  expect(sha(execFileSync("git",["show","refs/heads/main:"+out.steps[0].path],{cwd:remote}))).toBe(sha(fs.readFileSync(path.join(vault,out.steps[0].path))));
  await genericCanonicalRefusals(out.steps[0].path);await rawRefusals(out.steps[0].path);
 },60_000);
});

describe("C1 — real local persistence (no sync double)",()=>{
 beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-c1-pilot-")));vault=path.join(root,"vault");
  Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,33).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",C1_RESEARCH_PILOT:"disposable"});
  layout();await reindex();
 });
 afterEach(teardown);
 it("P01: Review HOLD (no Judge) preserves exactly one Source receipt and zero Review (real local bytes); P06-C1/A04-B ordinary generic edit persists; N19 refusals post-epoch",async()=>{
  const admission=await import("./admission"),engine=await import("./engine"),sync=await import("./sync"),c=await import("../mcp/canonical-writeback");
  expect(admission.currentAuthorityMode()).toBe("c1");
  const prep=c.prepareCanonicalWriteback(base,actor);
  expect(prep.workflowStatus).toBe("hold_research_judge");expect(prep.previews.map(x=>x.kind)).toEqual(["source_intake"]);
  const out=await c.applyCanonicalWriteback({input:base,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
  expect(out.completedWriteReceipts).toBe(1);expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toEqual([]);
  const src=out.steps.find(s=>s.kind==="source_intake")!;
  expect(sha(fs.readFileSync(path.join(vault,src.path)))).toBe(prep.steps.find(s=>s.kind==="source_intake")!.expectedSha256);
  expect(admission.witnessFor(src.receiptKey)).toMatchObject({mode:"c1",kind:"source_intake"});
  admission.establishMigrationEpoch("wp2-fixture-admin");
  // P06-C1 / A04-B (Owner Scope Amendment A1): an authenticated generic Safe Edit of an
  // ORDINARY note persists in C1 (real local bytes, real C1 pause; no sync double).
  const p=engine.preview(ordinaryEdit("wp2-c1-ordinary-1"),actor);
  expect(p).toMatchObject({pilotReviewRequired:false});
  expect(await sync.withPausedSync(()=>engine.apply(auth(p),actor))).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified"}});
  expect(sha(fs.readFileSync(path.join(vault,"Notes/Ordinary.md")))).toBe(p.afterHash);
  const created=engine.preview({operationId:"wp2-c1-create-1",path:"Notes/New.md",reason:"ordinary create",change:{kind:"create",content:"# new\n"}},actor);
  expect((await sync.withPausedSync(()=>engine.apply(auth(created),actor))).status).toBe("written");
  expect(fs.readFileSync(path.join(vault,"Notes/New.md"),"utf8")).toBe("# new\n");
  expect(admission.witnessFor(p.operationId)).toBeNull();
  await genericCanonicalRefusals(src.path);
  // OD-06: the dedicated ICR revision route is never available in C1.
  const pilot=await import("./canonical-review-revision-pilot");
  expect(()=>pilot.assertRevisionPilot()).toThrow(/revision_pilot_isolated_scope_required/);
 });
 it("M56-P1-08 C1: Industry-IN/Macro-IN Reviews refuse generic, raw and dedicated V2 routes with zero side effects",async()=>{await subjectReviewRefusals("c1");});
 it("A04-B negatives: C1 generic edit refuses protected/canonical-root/alias targets, wrong actor, invalid CAS, stale bytes and raw writes with zero side effects",async()=>{
  const engine=await import("./engine"),sync=await import("./sync"),notes=await import("../vault/notes");
  let before=await ledger();
  const refused:[string,{operationId:string;path:string;reason:string;change:unknown},RegExp][]=[
   ["protected thesis edit",{operationId:"wp2-c1-neg-thesis",path:"05_Thesis/protected.md",reason:"probe",change:{kind:"replace",oldText:"Protected unchanged",newText:"forged"}},/c1_pilot|protected|Thesis edits require/],
   ["protected thesis create",{operationId:"wp2-c1-neg-thesis-new",path:"05_Thesis/New.md",reason:"probe",change:{kind:"create",content:"# x\n"}},/c1_pilot|protected|Thesis edits require/],
   ["protected record name",{operationId:"wp2-c1-neg-ledger",path:"Notes/TESTA - Decision Ledger.md",reason:"probe",change:{kind:"create",content:"# x\n"}},/c1_pilot|protected_record/],
   ["canonical research root",{operationId:"wp2-c1-neg-research",path:"10_Knowledge/Company Research/TESTA notes.md",reason:"probe",change:{kind:"create",content:"# x\n"}},/c1_pilot/],
   ["intake root",{operationId:"wp2-c1-neg-inbox",path:"00_Inbox/ChatGPT/Ordinary.md",reason:"probe",change:{kind:"create",content:"# x\n"}},/c1_pilot/],
   ["portfolio",{operationId:"wp2-c1-neg-portfolio",path:"06_Portfolio/Positions.md",reason:"probe",change:{kind:"replace",oldText:"Positions",newText:"forged"}},/protected/],
   ["reserved id on ordinary path",{operationId:"ICW-"+"7".repeat(32),path:"Notes/Ordinary.md",reason:"probe",change:{kind:"replace",oldText:"original line",newText:"x"}},/canonical_operation_namespace_reserved/],
  ];
  for(const [label,req,code] of refused)expect(()=>engine.preview(req,actor),label).toThrow(code);
  expect(()=>notes.createNote("Notes/Raw.md","# raw\n")).toThrow(/c1_pilot_canonical_reviewed_writer_required/);
  expect(await ledger()).toEqual(before);
  const p=engine.preview(ordinaryEdit("wp2-c1-neg-cas"),actor);before=await ledger();
  await expect(sync.withPausedSync(()=>engine.apply(auth(p),"oauth:other-client"))).rejects.toThrow(/another OAuth/);
  await expect(sync.withPausedSync(()=>engine.apply({...auth(p),expectedHash:"0".repeat(64)},actor))).rejects.toThrow(/Invalid preview token or expected hash/);
  await expect(sync.withPausedSync(()=>engine.apply({...auth(p),previewToken:"1".repeat(64)},actor))).rejects.toThrow(/Invalid preview token or expected hash/);
  expect(await ledger()).toEqual(before);
  fs.appendFileSync(path.join(vault,"Notes/Ordinary.md"),"external change\n");const stale=await ledger();
  await expect(sync.withPausedSync(()=>engine.apply(auth(p),actor))).rejects.toThrow(/Version conflict/);
  expect(await ledger()).toEqual(stale);
 });
 it("mode transition C1 -> OFF across restart: the enrolled C1 instance refuses OFF; the C1 witness can never be consumed",async()=>{
  const admission=await import("./admission"),c=await import("../mcp/canonical-writeback");
  const prep=c.prepareCanonicalWriteback(capture(base),actor);expect(admission.witnessFor(prep.previews[0].operationId)).toMatchObject({mode:"c1"});
  (await import("../db")).db().close();delete (globalThis as Record<symbol,unknown>)[identityKey];delete process.env.C1_RESEARCH_PILOT;
  const next=root.replace("ios-c1-pilot-","wp2-after-c1-");fs.renameSync(root,next);root=next;vault=path.join(root,"vault");process.env.DATA_DIR=root;vi.resetModules();
  const admission2=await import("./admission"),engine2=await import("./engine");
  expect(()=>admission2.currentAuthorityMode()).toThrow(/c1_pilot_enrolled_instance_requires_mode_hold/);
  expect(()=>engine2.applyCanonicalStep(auth(prep.previews[0]),actor)).toThrow(/c1_pilot_enrolled_instance_requires_mode_hold/);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
 });
});

describe("RP — authority path only, SYNC_DOUBLE_NOT_PERSISTENCE_PROOF",()=>{
 beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];syncDouble.on=true;
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-revision-pilot-")));vault=path.join(root,"vault");
  Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,35).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",IOS_C1_REVISION_PILOT:"synthetic"});
  layout();await reindex();
 });
 afterEach(teardown);
 it("M56-P1-08 RP: Industry-IN/Macro-IN Reviews refuse generic and raw routes with zero side effects",async()=>{await subjectReviewRefusals("rp");});
 it("P01: missing Source-event assessment holds Review; Source-only preserved; P06 ordinary generic edit admitted; N19 refusals (regime always active)",async()=>{
  const admission=await import("./admission"),engine=await import("./engine"),sync=await import("./sync"),c=await import("../mcp/canonical-writeback");
  expect(admission.authorityRegimeActive()).toBe(true);
  const prep=c.prepareCanonicalWriteback(base,actor);
  expect(prep.sourceEvent?.decision).toBe("HOLD");expect(prep.previews.map(x=>x.kind)).toEqual(["source_intake"]);
  const out=await c.applyCanonicalWriteback({input:base,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
  expect(out.completedWriteReceipts).toBe(1);expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toEqual([]);
  const src=out.steps.find(s=>s.kind==="source_intake")!;
  expect(admission.operationProvenanceTier(src.receiptKey)).toBe("server_witnessed");
  const p=engine.preview(ordinaryEdit("wp2-rp-ordinary-1"),actor);
  expect(await sync.withPausedSync(()=>engine.apply(auth(p),actor))).toMatchObject({status:"written"});
  await genericCanonicalRefusals(src.path);
 });
});

describe("OFF — A03 raw move preflight (no partial mutation)",()=>{
 beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];syncDouble.on=true;
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-off-move-")));vault=path.join(root,"vault");
  Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,47).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
  layout();await reindex();
 });
 afterEach(teardown);
 it("M56-P1-08 OFF: Industry-IN/Macro-IN Reviews refuse generic and raw routes with zero side effects",async()=>{await subjectReviewRefusals("off");});
 it("moves whose link rewrite would edit a canonical note are refused BEFORE any rename; ordinary moves still work",async()=>{
  const c=await import("../mcp/canonical-writeback"),prep=c.prepareCanonicalWriteback(base,actor); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
  const out=await c.applyCanonicalWriteback({input:base,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
  expect(out.status).toBe("saved_verified");
  const reviewPath=out.steps.find(s=>s.kind==="canonical_review")!.path;
  const d=(await import("../db")).db();
  expect(d.prepare("SELECT count(*) FROM links WHERE source_path=? AND resolved_path='01_Companies/TESTA.md'").pluck().get(reviewPath)).toBeGreaterThan(0);
  const notes=await import("../vault/notes"),folders=await import("../vault/folders"),before=await ledger();
  expect(()=>notes.moveNote("01_Companies/TESTA.md","01_Companies/TESTA renamed.md")).toThrow(/canonical_link_rewrite_refused/);
  expect(()=>folders.moveFolder("01_Companies","Companies")).toThrow(/canonical_link_rewrite_refused/);
  expect(await ledger()).toEqual(before);
  expect(fs.existsSync(path.join(vault,"01_Companies/TESTA.md"))).toBe(true);expect(fs.existsSync(path.join(vault,"Companies"))).toBe(false);
  // Adjacent positives: no canonical backlink -> the raw move proceeds (note and folder).
  expect(notes.moveNote("Notes/Ordinary.md","Notes/Ordinary moved.md")).toEqual({from:"Notes/Ordinary.md",to:"Notes/Ordinary moved.md"});
  expect(folders.moveFolder("Notes","Notes archive").to).toBe("Notes archive");
  expect(fs.existsSync(path.join(vault,"Notes archive/Ordinary moved.md"))).toBe(true);
 });
});

/** OD-10 F-1/F-3: raw writers enforce the path AND the before (on-disk) and
 * after (proposed) frontmatter, so a typed protected record under an ordinary
 * name is neither written, re-typed, moved, deleted nor link-rewritten, and a
 * refused create leaves no directory. Every refusal: ledger (files, dirs, ops,
 * plan, witness, consumption, receipt, index, protected) unchanged. */
describe("OFF — OD-10 F-1/F-3 metadata-aware raw writers",()=>{
 const P=/protected_record_separate_authorization_required/,T=/protected_record_outside_authorized_thesis_scope/,R=/canonical_or_protected_raw_write_refused/;
 const typed:Record<string,string>={
  "Notes/Ledger copy.md":"---\ntype: decision_ledger\n---\n# Copied ledger\nSee [[Projects/Target]].\n",
  "Notes/Timeline view.md":"---\ntype: Company-Evolution Timeline\n---\n# Timeline\n- [ ] task\n",
  "Notes/My thesis.md":"---\ntype: current_thesis\n---\n# Thesis outside 05_Thesis\n",
  "Notes/Listed.md":"---\ntype:\n  - note\n  - Decision_Ledger\n---\n# list-valued type\n",
  "Notes/Broken.md":"---\ntype: decision_ledger\ntitle: [unclosed\n---\n# malformed YAML\n",
  "Notes/Flow.md":"---\ntitle: x\ntype: [note, \"evidence register\"]\n---\n# flow list\n",
  "Notes/Hidden.md":"---\ntype: \"decision​_ledger\"\n---\n# format-char alias\n"};
 const ordinary:Record<string,string>={"Projects/Target.md":"# Target\n",
  "Misc/Plain.md":"---\ntype: thesis-notes\ntags: [decision_ledger]\n---\n# plain\nprose: type: decision_ledger\n- [ ] todo\n"};
 const bytes=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
 beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-off-od10-")));vault=path.join(root,"vault");
  Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,53).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
  layout();
  for(const [p,t] of Object.entries({...typed,...ordinary})){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),t);}
  await reindex();const ix=await import("../vault/indexer");for(const p of Object.keys({...typed,...ordinary}))ix.reindexPath(p);
 });
 afterEach(teardown);
 it("M03 predicate: malformed/ambiguous/aliased `type` (before or after bytes) is protected; look-alikes, tags and body prose are not",async()=>{
  const {assertRawContentAllowed}=await import("./protected-records");
  const fmx=(y:string)=>`---\n${y}\n---\n# x\n`;
  for(const y of ["type: decision_ledger","Type: Decision Ledger","\"type\": 'DECISION-LEDGER'","type: !!str decision_ledger","type: decision_ledger # comment",
   "type: note\ntype: decision_ledger","type: [note, decision_ledger]","type:\n- note\n- decision_ledger","base: &k decision_ledger\ntype: *k\nbad: [unclosed",
   "type: decision_ledger\nbad: [unclosed","type: company_evolution_timeline","type: Investment Evolution Master"]){
   expect(()=>assertRawContentAllowed("Notes/x.md",null,fmx(y)),"after "+y).toThrow(P);
   expect(()=>assertRawContentAllowed("Notes/x.md",fmx(y),"# type removed\n"),"before "+y).toThrow(P);
  }
  expect(()=>assertRawContentAllowed("Notes/x.md",null,"﻿---\r\ntype: decision_ledger\r\n---\r\n# x\r\n")).toThrow(P);
  for(const y of ["type: current_thesis","type: Thesis","type: evidence register"])expect(()=>assertRawContentAllowed("Notes/x.md",null,fmx(y)),y).toThrow(T);
  for(const ok of [fmx("type: thesis-notes"),fmx("type: decision_ledger_review"),fmx("tags: [decision_ledger]"),fmx("type: note\nrelated: decision_ledger"),"# x\ntype: decision_ledger\n"])
   expect(()=>assertRawContentAllowed("Notes/x.md",ok,ok),ok).not.toThrow();
  expect(()=>assertRawContentAllowed("07_Sources/x.md",null,"# x\n")).toThrow(R);
 });
 it("create/update/set-remove property/move/delete/folder move/A03 rewrite of typed protected notes are refused before any mutation; ordinary raw writes still work",async()=>{
  const notes=await import("../vault/notes"),folders=await import("../vault/folders"),fm=await import("../vault/frontmatter"),q=await import("../vault/queries");
  const d=(await import("../db")).db();
  expect(d.prepare("SELECT count(*) FROM links WHERE source_path='Notes/Ledger copy.md' AND resolved_path='Projects/Target.md'").pluck().get()).toBe(1);
  const before=await ledger();
  const refused:[string,()=>unknown,RegExp][]=[
   // F-3: refused creates under NEW directories leave none behind (dirs in the ledger).
   ["create typed",()=>notes.createNote("Notes/New dir/Typed.md","---\ntype: decision_ledger\n---\n# x\n"),P],
   ["create thesis-typed",()=>notes.createNote("Fresh/Deep/Mine.md","---\ntype: Current Thesis\n---\n# x\n"),T],
   ["create list-typed",()=>notes.createNote("Fresh/L/x.md","---\ntype: [Decision-Ledger]\n---\n"),P],
   ["create protected-name alias",()=>notes.createNote("Fresh/Sub/decision LEDGER - TESTA.md","# x\n"),P],
   ["create protected root new dir",()=>notes.createNote("07_Sources/New sub/raw.md","# raw\n"),R],
   ["create protected root case alias",()=>notes.createNote("07_sources/new/raw.md","# raw\n"),R],
   // Update / append / prepend / edit / task toggle of typed notes; removing the type is refused too.
   ["update keeps type",()=>notes.updateNote("Notes/Ledger copy.md","---\ntype: decision_ledger\n---\n# changed\n"),P],
   ["update removes type",()=>notes.updateNote("Notes/Ledger copy.md","# frontmatter removed\n"),P],
   ["append",()=>notes.appendToNote("Notes/My thesis.md","more\n"),T],
   ["prepend",()=>notes.prependToNote("Notes/Listed.md","more\n"),P],
   ["edit malformed",()=>notes.editNote("Notes/Broken.md","malformed YAML","changed"),P],
   ["edit format-char alias",()=>notes.editNote("Notes/Hidden.md","format-char alias","changed"),P],
   ["edit flow list",()=>notes.editNote("Notes/Flow.md","flow list","changed"),T],
   ["toggle task",()=>q.toggleTask("Notes/Timeline view.md",5),P],
   // Set/remove property: removal or rename of `type` cannot erase protection; adding one is refused.
   ["remove type",()=>fm.removeProperty("Notes/Ledger copy.md","type"),P],
   ["rename type",()=>fm.setProperty("Notes/Ledger copy.md","type","note"),P],
   ["set other property",()=>fm.setProperty("Notes/Timeline view.md","status","x"),P],
   ["add protected type",()=>fm.setProperty("Misc/Plain.md","type","decision_ledger"),P],
   ["add list protected type",()=>fm.setProperty("Misc/Plain.md","type",["note","Evidence Register"]),T],
   // Move / delete / folder move of typed notes.
   ["move typed",()=>notes.moveNote("Notes/Ledger copy.md","Misc/Renamed.md"),P],
   ["move malformed",()=>notes.moveNote("Notes/Broken.md","Misc/B.md"),P],
   ["delete typed",()=>notes.deleteNote("Notes/My thesis.md"),T],
   ["delete format-char alias",()=>notes.deleteNote("Notes/Hidden.md"),P],
   ["folder move with typed notes",()=>folders.moveFolder("Notes","Archive/Notes"),/protected_record_/],
   // A03: the link rewrite would edit a typed protected note -> refused before any rename.
   ["A03 note move",()=>notes.moveNote("Projects/Target.md","Projects/Target 2.md"),/canonical_link_rewrite_refused: Notes\/Ledger copy\.md links to Projects\/Target\.md/],
   ["A03 folder move",()=>folders.moveFolder("Projects","Projects 2"),/canonical_link_rewrite_refused: Notes\/Ledger copy\.md/]];
  for(const [name,run,code] of refused){expect(run,name).toThrow(code);expect(await ledger(),name).toEqual(before);}
  for(const [p,t] of Object.entries(typed))expect(bytes(p),p).toBe(t);
  // Adjacent positives: ordinary noncanonical raw writes are not over-blocked.
  expect(notes.createNote("Fresh/New dir/Plain.md","---\ntype: thesis-notes\ntags: [decision_ledger]\n---\n# fresh\n")).toBe("Fresh/New dir/Plain.md");
  notes.appendToNote("Misc/Plain.md","appended line\n");
  notes.editNote("Misc/Plain.md","# plain","# plain edited");
  expect(q.toggleTask("Misc/Plain.md",7).done).toBe(true);
  fm.setProperty("Misc/Plain.md","status","reviewed");fm.removeProperty("Misc/Plain.md","status");fm.setProperty("Misc/Plain.md","type","note");
  notes.updateNote("Notes/Ordinary.md","# Ordinary\nreplaced line\n");
  expect(notes.moveNote("Misc/Plain.md","Misc/Plain moved.md")).toEqual({from:"Misc/Plain.md",to:"Misc/Plain moved.md"});
  expect(folders.moveFolder("Misc","Misc 2").to).toBe("Misc 2");
  expect(bytes("Misc 2/Plain moved.md")).toContain("# plain edited");expect(bytes("Misc 2/Plain moved.md")).toContain("- [x] todo");
  expect(notes.deleteNote("Misc 2/Plain moved.md")).toBe("Misc 2/Plain moved.md");
  expect(fs.existsSync(path.join(vault,"Misc 2/Plain moved.md"))).toBe(false);
  for(const [p,t] of Object.entries(typed))expect(bytes(p),p).toBe(t);
  expect(bytes("Projects/Target.md")).toBe("# Target\n");
 });
});

/** OD-10 A03: the link rewrite that follows a move is projected BEFORE any
 * rename. A rewrite whose bytes would turn an ordinary linker into a protected
 * record (`type: "[[Foo]]"` with Foo -> decision_ledger) is refused with zero
 * side effects, including no partial rewrite of an earlier benign source.
 * The MCP move_note tool body is moveNote + rewriteLinksForMove (updateLinks
 * default); on this read-only replica build the tool is not registered
 * (mcp/server.ts `writable=false`), so the same composition is called here. */
describe("OFF — OD-10 A03 projected link-rewrite preflight (no post-rename partial mutation)",()=>{
 const seed:Record<string,string>={"Notes/A benign.md":"# Benign\nSee [[Foo]].\n","Notes/Foo.md":"# Foo\n",
  "Notes/Linker.md":"---\ntype: \"[[Foo]]\"\n---\nSee [[Foo]].\n","Notes/Self.md":"---\ntype: \"[[Self]]\"\n---\nSelf link [[Self]].\n",
  "Misc/Qux.md":"# Other Qux\n","Proj/One.md":"# One\nSee [[Proj/Two]].\n","Proj/Two.md":"# Two\n"};
 const bytes=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
 async function deep(){
  const d=(await import("../db")).db(),m=await import("../vault/modified");
  const has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  const md=files().map(f=>f.slice(0,f.lastIndexOf(":"))).filter(f=>f.endsWith(".md"));
  return {...await ledger(),contents:Object.fromEntries(md.map(f=>[f,bytes(f)])),
   links:d.prepare("SELECT source_path,target,resolved_path FROM links ORDER BY 1,2,3").all(),notes:d.prepare("SELECT * FROM notes ORDER BY path").all(),
   events:has("safe_edit_events")?d.prepare("SELECT count(*) FROM safe_edit_events").pluck().get():0,
   modified:md.map(f=>[f,m.modifiedFor(f,-1)])};
 }
 beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-off-a03p-")));vault=path.join(root,"vault");
  Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,59).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
  layout();
  for(const [p,t] of Object.entries(seed)){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),t);}
  await reindex();const ix=await import("../vault/indexer");for(const p of Object.keys(seed))ix.reindexPath(p);
 });
 afterEach(teardown);
 it("refuses before any move when the projected rewrite would retype a linker (multi-source and self-moving source); ordinary moves and rewrites still work",async()=>{
  const notes=await import("../vault/notes"),links=await import("../vault/links"),folders=await import("../vault/folders");
  const d=(await import("../db")).db();
  const moveWithLinks=(from:string,to:string)=>{const res=notes.moveNote(from,to);return links.rewriteLinksForMove(res.from,res.to);};
  expect(d.prepare("SELECT DISTINCT source_path FROM links WHERE resolved_path='Notes/Foo.md' ORDER BY 1").pluck().all()).toEqual(["Notes/A benign.md","Notes/Linker.md"]);
  // Negative 1 (reviewer reproduction, two sources: a benign one and the would-be protected one).
  let before=await deep();
  expect(()=>moveWithLinks("Notes/Foo.md","Notes/decision_ledger.md")).toThrow(/^canonical_link_rewrite_refused: Notes\/Linker\.md links to Notes\/Foo\.md$/);
  expect(await deep()).toEqual(before);
  expect(bytes("Notes/A benign.md")).toBe(seed["Notes/A benign.md"]);expect(fs.existsSync(path.join(vault,"Notes/decision_ledger.md"))).toBe(false);
  // Negative 2: the moving note links to itself; its own projected bytes would become protected.
  before=await deep();
  expect(()=>moveWithLinks("Notes/Self.md","Notes/decision_ledger.md")).toThrow(/^canonical_link_rewrite_refused: Notes\/Self\.md links to Notes\/Self\.md$/);
  expect(await deep()).toEqual(before);
  // Adjacent positive: ordinary move with link rewrite, including post-move basename ambiguity (Qux exists in Misc).
  expect(moveWithLinks("Notes/Foo.md","Archive/Qux.md")).toEqual({notes:["Notes/A benign.md","Notes/Linker.md"],links:3});
  expect(bytes("Notes/A benign.md")).toBe("# Benign\nSee [[Archive/Qux]].\n");
  expect(bytes("Notes/Linker.md")).toBe("---\ntype: \"[[Archive/Qux]]\"\n---\nSee [[Archive/Qux]].\n");
  expect(bytes("Archive/Qux.md")).toBe("# Foo\n");
  // Adjacent positive: folder move where the linking source moves too (read at its new path).
  expect(folders.moveFolder("Proj","Proj2").rewritten).toEqual({notes:["Proj2/One.md"],links:1});
  expect(bytes("Proj2/One.md")).toBe("# One\nSee [[Proj2/Two]].\n");
 });
});

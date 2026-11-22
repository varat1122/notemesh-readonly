/** WP2 synthetic oracles P05/E05, P11/N12/N15(part) and mode transition.
 * Authority-path proofs only: apply runs under SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. */
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {assessed,approveFixture} from "../../../tests/source-event-fixture";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {SourceEventSubmission} from "../vault/source-event-contract";
vi.mock("./sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
const actor="oauth:wp2-epoch-fixture",sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const review={headlineTh:"TESTA ชี้แจงรายละเอียดคู่มือสมมติ",translationTh:"TESTA เผยแพร่คู่มือสมมติสำหรับการใช้งานและมีคำอธิบายการติดตั้ง",
 whatChangedTh:"รายละเอียดคู่มือเป็นข้อความที่ได้รับ ยังไม่ได้ยืนยันว่ามีผลต่อการลงทุน",mechanismTh:"ยังไม่มีหลักฐานแสดงผลต่อรายได้ กำไร หรือความสัมพันธ์ระหว่างบริษัท",
 thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข้อความดังกล่าว ต้องตรวจหลักฐานเพิ่มเติม",counterEvidenceTh:"ข้อมูลอาจซ้ำกับคู่มือเดิม และยังไม่มีการตรวจสอบต้นฉบับอย่างเป็นอิสระ",
 requiredEvidenceTh:"ต้องอ่านเอกสารต้นฉบับและเปรียบเทียบกับประวัติก่อนยกระดับข้อกล่าวอ้าง"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",
 sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"WP2 epoch synthetic mechanics",sourceUrl:"https://example.org/wp2/manual",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",researchReview:review};
type Input=WritebackInput&{sourceEvent?:SourceEventSubmission};
const identityKey=Symbol.for("notemesh.c1-pilot.identity.v1");
function setup(prefix:string,extra:Record<string,string>){return async()=>{
 vi.resetModules();delete (globalThis as Record<symbol,unknown>)[identityKey];root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),prefix)));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,27).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",...extra});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"05_Thesis/protected.md"),"# Protected unchanged\n");
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");(await import("../vault/indexer")).reindexPath("01_Companies/TESTA.md");
};}
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 (await import("../db")).db().close();delete (globalThis as Record<symbol,unknown>)[identityKey];fs.rmSync(root,{recursive:true,force:true});vi.useRealTimers();
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","IOS_C1_REVISION_PILOT"])delete process.env[k];});
function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),ops:n("safe_edit_operations"),plan:n("canonical_plan"),witness:n("canonical_witness"),consumption:n("witness_consumption"),
  receipt:n("safe_edit_operations","WHERE status='written'"),index:n("notes")};
}
const auth=(p:{operationId:string;previewToken?:string|null;beforeHash:string})=>({operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash});
async function prepare(input:Input){return (await import("../mcp/canonical-writeback")).prepareCanonicalWriteback(input,actor);}
async function applyAll(input:Input,p:Awaited<ReturnType<typeof prepare>>){return (await import("../mcp/canonical-writeback")).applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(auth)},actor);}
const capture=(input:Input)=>({...input,captureOnly:true,researchReview:undefined,sourceEvent:undefined,claims:undefined});
function reviews(){return fs.readdirSync(path.join(vault,"10_Knowledge/Company Research")).filter(p=>p.startsWith("Investment Review"));}

describe("RP (revision pilot) — authority path only, SYNC_DOUBLE_NOT_PERSISTENCE_PROOF",()=>{
 beforeEach(setup("ios-revision-pilot-",{IOS_C1_REVISION_PILOT:"synthetic"}));
 it("P05/E05: HOLD withdrawal advances only this intake's epoch; stale witness refused at approve+apply; valid Source and unrelated intake unaffected; fresh PASS succeeds",async()=>{
  const admission=await import("./admission"),engine=await import("./engine"),gate=await import("./source-event-admission"),c=await import("../mcp/canonical-writeback");
  const srcA=capture(base),pSrcA=await prepare(srcA);expect((await applyAll(srcA,pSrcA)).status).toBe("source_saved_analysis_pending");
  const a={...c.canonicalInputSchema.parse(base),sourceEvent:await assessed(gate.canonicalEventProposal(c.canonicalInputSchema.parse(base)),actor)};
  const pa=await prepare(a);expect(pa.sourceEvent).toMatchObject({decision:"PASS"});for(const v of pa.previews)await approveFixture(v.operationId);
  // Unrelated intake B: Source preview pending (prepared, not applied).
  const other=capture({...base,extractedText:"SYNTHETIC TESTB unrelated: a separate ordinary brochure.",entities:["TESTA"],sourceUrl:"https://example.org/wp2/other"});
  const pOther=await prepare(other);expect(pOther.previews).toHaveLength(1);
  const intake=pa.planId,v0=admission.epochValue("intake",intake),reviewOp=pa.previews.find(p=>p.kind==="canonical_review")!;
  expect(JSON.parse(admission.witnessFor(reviewOp.operationId)!.epoch_snapshot)).toEqual({global:0,intake:v0});
  const srcWitness=admission.witnessFor(pSrcA.previews[0].operationId)!;
  expect(JSON.parse(srcWitness.epoch_snapshot).intake).toBeUndefined();
  const hold=structuredClone(a.sourceEvent);hold.result.disposition="HOLD";gate.withdrawSourceEvent(hold,actor);
  expect(admission.epochValue("intake",intake)).toBe(v0+1);
  expect(admission.epochValue("intake",pOther.planId)).toBe(0);
  const before=await ledger();
  expect(()=>admission.assertWitnessCurrent(admission.witnessFor(reviewOp.operationId)!,actor)).toThrow(/authority_epoch_changed/);
  expect(()=>engine.adminPreview(reviewOp.operationId)).toThrow(/source_event_assessment_hold/);
  expect(()=>engine.approve(reviewOp.operationId,"simulated-dashboard-reviewer",reviewOp.afterHash)).toThrow(/authority_epoch_changed/);
  expect(()=>engine.applyCanonicalAssessed(auth(reviewOp),actor)).toThrow();
  expect(()=>engine.applyCanonicalStep(auth(reviewOp),actor)).toThrow();
  const held=await applyAll(a,pa);expect(held).toMatchObject({status:"pending_safe_edit",completedWriteReceipts:0,interrupted:"source_event_exact_enrollment_required"});
  expect(await ledger()).toEqual(before);expect(reviews()).toHaveLength(0);
  // Valid Source (same intake) witness stays current; unrelated intake's pending Source still applies.
  expect(()=>admission.assertWitnessCurrent(srcWitness,actor)).not.toThrow();
  expect((await applyAll(other,pOther)).status).toBe("source_saved_analysis_pending");
  // Actor-scope mismatch never makes the old witness current.
  expect(()=>admission.assertWitnessCurrent(admission.witnessFor(pOther.previews[0].operationId)!,"oauth:other-client")).toThrow(/canonical_witness_actor_hold/);
  // Fresh reassessment after HOLD: new envelope, current epoch snapshot, saved.
  vi.setSystemTime(Date.now()+10);
  const b={...a,sourceEvent:await assessed(gate.canonicalEventProposal(c.canonicalInputSchema.parse(a)),actor)};
  const pb=await prepare(b);expect(pb.sourceEvent).toMatchObject({decision:"PASS"});for(const p of pb.previews)await approveFixture(p.operationId);
  expect(JSON.parse(admission.witnessFor(pb.previews.find(p=>p.kind==="canonical_review")!.operationId)!.epoch_snapshot)).toEqual({global:0,intake:v0+1});
  expect((await applyAll(b,pb)).status).toBe("saved_verified");expect(reviews()).toHaveLength(1);
 });
 it("mode transition RP -> OFF: a witness minted in RP is not current once the instance mode changes",async()=>{
  const admission=await import("./admission"),engine=await import("./engine");
  const p=await prepare(capture(base)),id=p.previews[0].operationId;
  expect(admission.witnessFor(id)).toMatchObject({mode:"revision_pilot"});
  // Mode changes only across a process restart (live transitions HOLD in c1-pilot identity).
  delete process.env.IOS_C1_REVISION_PILOT;(await import("../db")).db().close();delete (globalThis as Record<symbol,unknown>)[identityKey];fs.renameSync(root,root.replace("ios-revision-pilot-","wp2-off-"));
  root=root.replace("ios-revision-pilot-","wp2-off-");vault=path.join(root,"vault");process.env.DATA_DIR=root;
  vi.resetModules();const admission2=await import("./admission"),engine2=await import("./engine");
  expect(admission2.currentAuthorityMode()).toBe("off");
  expect(()=>engine2.applyCanonicalStep(auth(p.previews[0]),actor)).toThrow(/authority_mode_changed/);
  expect(admission2.witnessConsumed(admission2.witnessFor(id)!.witness_id)).toBe(false);
  void admission;void engine;
 });
});

describe("OFF — migration epoch (authority path only, SYNC_DOUBLE_NOT_PERSISTENCE_PROOF)",()=>{
 beforeEach(setup("wp2-epoch-off-",{}));
 it("P11/N12/N15(part): E_mig inventory counts the synthetic journal; history retained; pre-epoch pending denied; invalid witness receipt denied",async()=>{
  const admission=await import("./admission"),engine=await import("./engine"),reader=await import("../vault/investment-research-context");
  const d=(await import("../db")).db();
  // A: witnessed full writeback (Source + Review).
  const pA=await prepare(base),outA=await applyAll(base,pA);expect(outA.status).toBe("saved_verified");
  // B: synthetic pre-WP2 history fixture — same journal rows, kernel tables absent for them.
  const inB={...base,extractedText:"SYNTHETIC TESTA: a second ordinary manual errata note.",sourceUrl:"https://example.org/wp2/errata"};
  const pB=await prepare(inB),outB=await applyAll(inB,pB);expect(outB.status).toBe("saved_verified");
  for(const s of pB.previews){const w=admission.witnessFor(s.operationId)!;d.prepare("DELETE FROM witness_consumption WHERE witness_id=?").run(w.witness_id);d.prepare("DELETE FROM canonical_witness WHERE witness_id=?").run(w.witness_id);}
  // C: pending witnessed Source preview. D: synthetic pending PRE-WP2 authority (a pending
  // preview without a witness: the WP2 generic route can no longer create one, OD-04+OD-06).
  const inC=capture({...base,extractedText:"SYNTHETIC TESTA: third pending brochure.",sourceUrl:"https://example.org/wp2/pending"}),pC=await prepare(inC);
  const inD=capture({...base,extractedText:"SYNTHETIC TESTA: fourth pending generic note.",sourceUrl:"https://example.org/wp2/generic"});
  const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
  const stepD=planInvestmentWriteback(inD).safeEditWorkflow!.steps.find(s=>s.kind==="source_intake")!.safeEditRequest!;
  expect(()=>engine.preview({...stepD,reason:"generic canonical preview probe"},actor)).toThrow(/canonical_operation_namespace_reserved/);
  const pD=(await prepare(inD)).previews[0];
  {const w=admission.witnessFor(pD.operationId)!;d.prepare("DELETE FROM canonical_witness WHERE witness_id=?").run(w.witness_id);
   d.prepare("DELETE FROM canonical_plan WHERE plan_id=? AND NOT EXISTS(SELECT 1 FROM canonical_witness WHERE plan_id=?)").run(w.plan_id,w.plan_id);}
  expect(admission.witnessFor(pD.operationId)).toBeNull();
  const bytes=files();
  const epoch=admission.establishMigrationEpoch("wp2-fixture-admin");
  const kinds=(o:typeof outA)=>o.steps.map(s=>s.kind).sort();
  const expected=new Map<string,number>();
  for(const k of kinds(outA))expected.set(k+"|server_witnessed",(expected.get(k+"|server_witnessed")??0)+1);
  for(const k of kinds(outB))expected.set(k+"|legacy_origin_unverified",(expected.get(k+"|legacy_origin_unverified")??0)+1);
  expect(Object.fromEntries(epoch.inventory.map(r=>[r.kind+"|"+r.tier,r.n]))).toEqual(Object.fromEntries(expected));
  expect(admission.establishMigrationEpoch("again").created).toBe(false);
  expect(files()).toEqual(bytes); // inventory never rewrites history
  // Old completed history readable, labelled by tier.
  const rA=outA.steps.find(s=>s.kind==="canonical_review")!,rB=outB.steps.find(s=>s.kind==="canonical_review")!;
  const raw=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
  expect(reader.receiptProvenance("canonical_review",rA.path,raw(rA.path)).tier).toBe("server_witnessed");
  expect(reader.receiptProvenance("canonical_review",rB.path,raw(rB.path)).tier).toBe("legacy_origin_unverified");
  expect(reader.createReceipt("canonical_review",rB.path,raw(rB.path))).toBe(rB.receiptKey);
  // Pending pre-epoch authority must be prepared again.
  const before=await ledger();
  expect(()=>engine.applyCanonicalStep(auth(pC.previews[0]),actor)).toThrow(/authority_epoch_changed/);
  expect(()=>engine.apply(auth(pD),actor)).toThrow(/authority_superseded_by_migration/);
  expect(()=>engine.applyCanonicalStep(auth(pD),actor)).toThrow(/authority_superseded_by_migration/);
  expect(await ledger()).toEqual(before);
  const again=await prepare(inC);expect((await applyAll(inC,again)).status).toBe("source_saved_analysis_pending");
  // Receipt with an invalidated witness (consumption removed) is denied, not uplifted.
  const wA=admission.witnessFor(rA.receiptKey)!;d.prepare("DELETE FROM witness_consumption WHERE witness_id=?").run(wA.witness_id);
  expect(()=>reader.createReceipt("canonical_review",rA.path,raw(rA.path))).toThrow(/create_receipt_unverified/);
 });
 it("mode transition OFF -> RP: witness minted in OFF is refused once the revision pilot is required",async()=>{
  const admission=await import("./admission"),engine=await import("./engine");
  const p=await prepare(capture(base));expect(admission.witnessFor(p.previews[0].operationId)).toMatchObject({mode:"off"});
  process.env.IOS_C1_REVISION_PILOT="synthetic";
  expect(admission.currentAuthorityMode()).toBe("revision_pilot");
  expect(()=>engine.applyCanonicalStep(auth(p.previews[0]),actor)).toThrow(/authority_mode_changed/);
  const v=engine.adminPreview(p.previews[0].operationId);
  expect(()=>engine.approve(p.previews[0].operationId,"simulated-dashboard-reviewer",v.afterHash)).toThrow(/authority_mode_changed/);
 });
});

/** Cross-version authority regression: execute the ACTUAL immutable 6cd9c3cd
 * implementation in an isolated archive, then reopen its real DB/Vault/key.
 * No hand-built gates/receipts and no production-code edits in the old archive. */
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import type {canonicalInputSchema,prepareCanonicalWriteback} from "./canonical-writeback";
import type {z} from "zod";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const BASE="6cd9c3cd558dac3d67e9202d8652b406cfdc332a",KEY=Buffer.alloc(32,8).toString("base64");
const T=Date.parse("2026-11-08T00:00:00.000Z"),actor="oauth:ri001-claims-fixture";
type Input=z.infer<typeof canonicalInputSchema>;
type Prepared=ReturnType<typeof prepareCanonicalWriteback>;
interface Manifest {base:string;original:Input;heldInput:Input;preissued:Input;preview:Prepared;held:Prepared;protectedPaths:string[]}
let root:string,dataRoot:string,manifest:Manifest;
beforeAll(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-legacy-cross-version-")));
  const old=path.join(root,"old-code");fs.mkdirSync(old);
  // CI fetches only this exact base object explicitly. No network or fallback to
  // current implementation inside the test; missing provenance fails the test.
  expect(execFileSync("git",["rev-parse",BASE+"^{tree}"],{encoding:"utf8"}).trim()).toBe("6dc271490fdc659ccf847e9d058bb68e698a9ded");
  const archive=execFileSync("git",["archive",BASE],{maxBuffer:32*1024*1024});
  execFileSync("tar",["-x","-C",old],{input:archive});
  fs.symlinkSync(path.resolve("node_modules"),path.join(old,"node_modules"),"dir");
  const original=fs.readFileSync(path.join(old,"src/server/mcp/research-judge.test.ts"),"utf8");
  const prefix=original.slice(0,original.indexOf('\ndescribe("RI-001 opt-in Research Judge'));
  expect(prefix).toContain("async function judged(");
  // Reuse the old fixture/input/assessment helper and real Safe Edit engine.
  // Only the test harness is added. The runtime modules are byte-identical Git objects.
  const producer=prefix+`
it.each([['HOLD',false],['FAIL',false],['HOLD',true],['FAIL',true],['SAVED',true]] as const)('export actual legacy %s/source=%s',async(verdict,sourceWritten)=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(${T});
  const original=await judged(),preview=await prepare(original),engine=await import('../safe-edit/engine');
  const source=preview.previews.find(t=>t.kind==='source_intake')!;
  if(sourceWritten&&verdict!=='SAVED')engine.apply({operationId:source.operationId,previewToken:source.previewToken,expectedHash:source.beforeHash},actor);
  vi.setSystemTime(${T+1000});const preissued=await judged();
  vi.setSystemTime(${T+2000});const heldInput=structuredClone(original);
  let held=preview;
  if(verdict==='SAVED')expect((await apply(original,preview)).status).toBe('saved_verified');
  else {heldInput.researchJudge.result.review.verdict=verdict;held=await prepare(heldInput);
    const gate=(await import('../safe-edit/research-judge-gate')).currentJudgeGate(preview.planId)!;
    expect(gate.decision).toBe(verdict);expect(gate).not.toHaveProperty('packetEnvelopeDigest');}
  assertProtected();(await import('../db')).db().close();
  const out=path.join(process.env.RI001_LEGACY_EXPORT_DIR!,verdict+'-'+sourceWritten);
  fs.cpSync(root,out,{recursive:true});
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({base:'${BASE}',original,heldInput,preissued,preview,held,protectedPaths}));
});`;
  fs.writeFileSync(path.join(old,"src/server/mcp/legacy-producer.test.ts"),producer);
  const log=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/legacy-producer.test.ts","--maxWorkers=1"],{
    cwd:old,env:{...process.env,ENCRYPTION_KEY:KEY,RI001_LEGACY_EXPORT_DIR:path.join(root,"exports")},timeout:60000,maxBuffer:8*1024*1024,encoding:"utf8"});
  expect(log).toContain("5 passed");
},65000);
afterAll(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(T+5000);
  delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
  for(const key of ["NOTEMESH_MAINTENANCE","NOTEMESH_MAINTENANCE_RESUME","NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"])delete process.env[key];
});
async function openFixture(name="HOLD-false"){
  dataRoot=fs.mkdtempSync(path.join(root,"reader-"));fs.cpSync(path.join(root,"exports",name),dataRoot,{recursive:true});
  process.env.DATA_DIR=dataRoot;process.env.ENCRYPTION_KEY=KEY;process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
  manifest=JSON.parse(fs.readFileSync(path.join(dataRoot,"manifest.json"),"utf8"));expect(manifest.base).toBe(BASE);
  return await import("./canonical-writeback");
}
afterEach(async()=>{
  if(dataRoot){for(const file of manifest.protectedPaths)expect(fs.readFileSync(path.join(dataRoot,"vault",file),"utf8")).toBe("# Isolated protected fixture\n");
    (await import("../db")).db().close();fs.rmSync(dataRoot,{recursive:true,force:true});dataRoot="";}
  vi.useRealTimers();vi.restoreAllMocks();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});
const authorizations=(p:Prepared)=>p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}));
async function writtenNonSource(){return (await import("../db")).db().prepare("SELECT count(*) n FROM safe_edit_operations WHERE status='written' AND json_extract(payload,'$.path') NOT LIKE '00_Inbox/%'").get() as {n:number};}
it.each(["HOLD","FAIL"] as const)("P1-LEGACY baseline: actual 6cd %s cannot replay original PASS on the new reader",async verdict=>{
  const api=await openFixture(verdict+"-false");let rejected=false;
  try{const replay=api.prepareCanonicalWriteback(manifest.original,actor);
    await api.applyCanonicalWriteback({input:manifest.original,planId:replay.planId,authorizations:authorizations(replay)},actor);
  }catch{rejected=true;}
  expect(await writtenNonSource()).toEqual({n:0});expect(rejected).toBe(true);
  expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)?.decision).toBe(verdict);
});
async function freshInput(who=actor){
  const api=await import("./canonical-writeback"),clean=api.canonicalInputSchema.parse({...manifest.original,researchJudge:undefined});
  const {packet,packetEnvelopeDigest}=(await import("../vault/research-judge")).buildResearchJudgePacket(clean,who);
  const body=JSON.parse(packet.body),result={...structuredClone(manifest.original.researchJudge!.result!),packetId:packet.packetId,
    packetDigest:packet.digest,reviewDigest:body.reviewDigest,packetEnvelopeDigest};
  return {...clean,researchJudge:{packet,result}};
}
async function events(){return (await import("../db")).db().prepare("SELECT rowid,* FROM safe_edit_events ORDER BY rowid").all() as {rowid:number;event:string;at:string;detail:string}[];}
async function originalGateUnchanged(before:Awaited<ReturnType<typeof events>>){
  const after=await events();for(const row of before)expect(after).toContainEqual(row);
  // Refusal/Source preview audit entries are allowed, never a replacement grant.
  expect(after.filter(e=>e.event==="research_judge_gate")).toEqual(before.filter(e=>e.event==="research_judge_gate"));
}
async function denyGeneric(){
  const engine=await import("../safe-edit/engine"),sql=(await import("../db")).db();
  for(const t of manifest.preview.previews.filter(t=>t.kind!=="source_intake")){
    const payload=(sql.prepare("SELECT payload FROM safe_edit_operations WHERE id=?").get(t.operationId) as {payload:string}).payload;
    expect(()=>engine.preview(JSON.parse(payload),actor)).toThrow(/research_judge/);
    expect(()=>engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(/research_judge/);
    expect(fs.existsSync(path.join(dataRoot,"vault",t.path))).toBe(false);
  }
  expect(await writtenNonSource()).toEqual({n:0});
}
it.each(["HOLD","FAIL"] as const)("P1-LEGACY %s with saved Source: canonical/generic denial preserves real receipt",async verdict=>{
  const api=await openFixture(verdict+"-true"),before=await events(),engine=await import("../safe-edit/engine"),source=manifest.preview.steps[0];
  const receipt=engine.status(source.receiptKey,actor).receipt,bytes=fs.readFileSync(path.join(dataRoot,"vault",source.path));
  expect(()=>api.prepareCanonicalWriteback(manifest.original,actor)).toThrow(/research_judge/);
  await expect(api.applyCanonicalWriteback({input:manifest.original,planId:manifest.preview.planId,authorizations:authorizations(manifest.preview)},actor)).rejects.toThrow(/research_judge/);
  await denyGeneric();await originalGateUnchanged(before);
  expect(engine.status(source.receiptKey,actor).receipt).toEqual(receipt);expect(fs.readFileSync(path.join(dataRoot,"vault",source.path))).toEqual(bytes);
});
it("P1-LEGACY Source-only preservation remains allowed while legacy HOLD stays restrictive",async()=>{
  const api=await openFixture(),input={...manifest.original,researchJudge:undefined,claims:undefined,researchReview:undefined,captureOnly:true};
  const p=api.prepareCanonicalWriteback(input,actor);expect(p.previews.map(t=>t.kind)).toEqual(["source_intake"]);
  const saved=await api.applyCanonicalWriteback({input,planId:p.planId,authorizations:authorizations(p)},actor);
  expect(saved.receipts).toHaveLength(1);expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)?.decision).toBe("HOLD");
  await denyGeneric();
});
it.each(["HOLD","FAIL"] as const)("P1-LEGACY fresh bound reassessment recovers %s; obsolete old packet cannot revoke it",async verdict=>{
  const api=await openFixture(verdict+"-true"),source=manifest.preview.steps[0],engine=await import("../safe-edit/engine"),receipt=engine.status(source.receiptKey,actor).receipt;
  const oldEvents=await events(),fresh=await freshInput(),p=api.prepareCanonicalWriteback(fresh,actor);
  expect(p.researchJudge).toMatchObject({decision:"PASS",semanticTruthVerified:false,primaryAuthority:false});
  const gates=await import("../safe-edit/research-judge-gate"),gate=gates.currentJudgeGate(p.planId);
  api.prepareCanonicalWriteback(manifest.heldInput,actor);expect(gates.currentJudgeGate(p.planId)).toEqual(gate);
  const saved=await api.applyCanonicalWriteback({input:fresh,planId:p.planId,authorizations:authorizations(p)},actor);
  expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(3);
  expect(engine.status(source.receiptKey,actor).receipt).toEqual(receipt);
  for(const event of oldEvents)expect(await events()).toContainEqual(event);
});
it.each(["old","preissued","equal","clock reversal"])("P1-LEGACY %s packet cannot recover HOLD",async kind=>{
  const api=await openFixture();let input=kind==="old"?manifest.original:manifest.preissued;
  if(kind==="equal"||kind==="clock reversal"){vi.setSystemTime(T+(kind==="equal"?2000:1999));input=await freshInput();}
  const before=await events();expect(()=>api.prepareCanonicalWriteback(input,actor)).toThrow(/research_judge_reassessment_not_fresh_hold/);
  expect(await events()).toEqual(before);await denyGeneric();
});
it.each(["missing","wrong"])("P1-LEGACY fresh %s result-envelope binding never grants PASS",async kind=>{
  const api=await openFixture(),input=await freshInput();
  if(kind==="missing")delete (input.researchJudge.result as {packetEnvelopeDigest?:string}).packetEnvelopeDigest;
  else input.researchJudge.result.packetEnvelopeDigest="0".repeat(64);
  if(kind==="missing")expect(()=>api.prepareCanonicalWriteback(input,actor)).toThrow(/fresh_assessment_binding_hold/);
  else expect(api.prepareCanonicalWriteback(input,actor).researchJudge?.decision).toBe("HOLD");
  await denyGeneric();
});
it.each(["missing","corrupt","ambiguous","equal prior","reversed prior","future"])("P1-LEGACY %s withdrawal timestamp fails closed without journal repair",async fault=>{
  const api=await openFixture(),sql=(await import("../db")).db();
  const value={missing:"",corrupt:"not-a-date",ambiguous:"2026-11-08 00:00:02", "equal prior":new Date(T).toISOString(),
    "reversed prior":new Date(T-1).toISOString(),future:new Date(T+10000).toISOString()}[fault]!;
  // Fault injection only into the disposable real legacy gate event, never receipts.
  sql.prepare("UPDATE safe_edit_events SET at=? WHERE rowid=(SELECT max(rowid) FROM safe_edit_events WHERE event='research_judge_gate')").run(value);
  const before=await events(),fresh=await freshInput();
  expect(()=>api.prepareCanonicalWriteback(fresh,actor)).toThrow(/research_judge_(withdrawal_time|reassessment_not_fresh)_hold/);
  // A fresh HOLD must not wash an unknown/future withdrawal into a recoverable clock.
  fresh.researchJudge.result.review.verdict="HOLD";
  const held=api.prepareCanonicalWriteback(fresh,actor);expect(held.researchJudge?.decision).toBe("HOLD");
  await originalGateUnchanged(before);await denyGeneric();
});
it("P1-LEGACY cross-actor assessment cannot replace a valid legacy restriction",async()=>{
  const api=await openFixture(),before=await events(),other="oauth:unrelated-client",input=await freshInput(other);
  expect(()=>api.prepareCanonicalWriteback(input,other)).toThrow("Operation ID reused for different input or actor");
  expect(await events()).toEqual(before);await denyGeneric();
});
it("P1-LEGACY concurrent original PASS retries leave the withdrawal intact",async()=>{
  const api=await openFixture(),before=await events();
  const results=await Promise.allSettled([0,1,2].map(()=>Promise.resolve().then(()=>api.prepareCanonicalWriteback(manifest.original,actor))));
  expect(results.every(r=>r.status==="rejected")).toBe(true);expect(await events()).toEqual(before);await denyGeneric();
});
it("P1-LEGACY actual old Source + RI001-1 Claims + Review receipts remain cold-readable",async()=>{
  await openFixture("SAVED-true");const before=await events(),sql=(await import("../db")).db(),rows=sql.prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
  const {createReceipt}=await import("../vault/investment-research-context"),{readPersistedClaim}=await import("../vault/canonical-claims");
  for(const step of manifest.preview.steps){
    const bytes=fs.readFileSync(path.join(dataRoot,"vault",step.path),"utf8");expect(createReceipt(step.kind,step.path,bytes)).toBe(step.receiptKey);
    if(step.kind==="structured_claim"){expect(bytes).toContain('claim_persistence_version: "RI001-1"');expect(readPersistedClaim(step.path).receiptKey).toBe(step.receiptKey);}
  }
  expect(sql.prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(rows);expect(await events()).toEqual(before);
});

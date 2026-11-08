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
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";

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
it.each([['HOLD',false],['FAIL',false],['HOLD',true],['FAIL',true],['SAVED',true],['PASS',false],['PASS',true]] as const)('export actual legacy %s/source=%s',async(verdict,sourceWritten)=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(${T});
  const original=await judged(),preview=await prepare(original),engine=await import('../safe-edit/engine');
  const source=preview.previews.find(t=>t.kind==='source_intake')!;
  if(sourceWritten&&verdict!=='SAVED')engine.apply({operationId:source.operationId,previewToken:source.previewToken,expectedHash:source.beforeHash},actor);
  vi.setSystemTime(${T+1000});const preissued=await judged();
  vi.setSystemTime(${T+2000});const heldInput=structuredClone(original);
  let held=preview;
  if(verdict==='SAVED')expect((await apply(original,preview)).status).toBe('saved_verified');
  else if(verdict!=='PASS') {heldInput.researchJudge.result.review.verdict=verdict;held=await prepare(heldInput);
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
  expect(log).toContain("7 passed");
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
async function denyGeneric(applyFailure=/research_judge/){
  const engine=await import("../safe-edit/engine"),sql=(await import("../db")).db();
  for(const t of manifest.preview.previews.filter(t=>t.kind!=="source_intake")){
    const payload=(sql.prepare("SELECT payload FROM safe_edit_operations WHERE id=?").get(t.operationId) as {payload:string}).payload;
    expect(()=>engine.preview(JSON.parse(payload),actor)).toThrow(/research_judge/);
    expect(()=>engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(applyFailure);
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

// L2 fixtures are PASS-only journals produced by the immutable legacy runtime.
function withdrawal(verdict:"HOLD"|"FAIL") {
  const input=structuredClone(manifest.original);input.researchJudge!.result!.review.verdict=verdict;return input;
}
it.each(["HOLD","FAIL"] as const)("L2 baseline: legacy PASS withdrawal via new Apply (%s) survives appearance rejection",async verdict=>{
  const api=await openFixture("PASS-false"),input=withdrawal(verdict);
  input.appearance={key:"not-recorded",channel:"chat",locator:"chat:isolated/L2",receivedAt:null};
  await expect(api.applyCanonicalWriteback({input,planId:manifest.preview.planId,authorizations:[]},actor)).rejects.toThrow();
  // Exercise the harmful replay before asserting state: the parent writes 3 non-Source files.
  try{const replay=api.prepareCanonicalWriteback(manifest.original,actor);
    await api.applyCanonicalWriteback({input:manifest.original,planId:replay.planId,authorizations:authorizations(replay)},actor);
  }catch{/* Expected only after fix. */}
  expect(await writtenNonSource()).toEqual({n:0});
  expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)?.decision).toBe(verdict);
  await denyGeneric();
});
it.each([false,true])("L2-A legacy withdrawal precedes invalid tokens/sourceWritten=%s",async saved=>{
  const api=await openFixture("PASS-"+saved),before=await events(),input=withdrawal("HOLD");
  await expect(api.applyCanonicalWriteback({input,planId:manifest.preview.planId,authorizations:"invalid"},actor)).rejects.toThrow();
  expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)).toMatchObject({decision:"HOLD",expiresAt:0,revokedAt:T+5000});
  for(const row of before)expect(await events()).toContainEqual(row);
  expect(()=>api.prepareCanonicalWriteback(manifest.original,actor)).toThrow(/research_judge/);await denyGeneric();
});
async function withMcp(run:(client:Client)=>Promise<void>,label=actor){
  const server=(await import("./maintenance-tools")).trackToolExecution((await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label,scopes:["vault:read","vault:edit"]}));
  const client=new Client({name:"legacy-withdrawal-probe",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  try{await run(client);}finally{await client.close();await server.close();}
}
it.each([["HOLD","appearance"],["FAIL","appearance"],["HOLD","tokens"],["FAIL","tokens"],["HOLD","missing planId"],["FAIL","missing planId"]] as const)("L2-C actual MCP %s withdrawal before SDK-invalid %s",async(verdict,fault)=>{
  await openFixture("PASS-false");const input=withdrawal(verdict);
  const args:Record<string,unknown>={input,planId:manifest.preview.planId,authorizations:[]};
  if(fault==="appearance")Object.assign(input,{appearance:{key:"invalid"}});else if(fault==="missing planId")delete args.planId;else args.authorizations="invalid";
  await withMcp(async client=>{
    expect((await client.callTool({name:"apply_canonical_writeback",arguments:args})).isError).toBe(true);
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)?.decision).toBe(verdict);
    expect((await client.callTool({name:"prepare_canonical_writeback",arguments:manifest.original})).isError).toBe(true);
    for(const t of manifest.preview.previews.filter(t=>t.kind!=="source_intake"))expect((await client.callTool({name:"apply_edit",arguments:{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}})).isError).toBe(true);
  });await denyGeneric();
});
it.each(["HOLD","FAIL"] as const)("L2-D/F new Prepare retains %s withdrawal and later fresh recovery",async verdict=>{
  const api=await openFixture("PASS-true"),engine=await import("../safe-edit/engine"),source=manifest.preview.steps[0];
  const receipt=engine.status(source.receiptKey,actor).receipt,bytes=fs.readFileSync(path.join(dataRoot,"vault",source.path)),before=await events();
  expect(api.prepareCanonicalWriteback(withdrawal(verdict),actor).researchJudge?.decision).toBe(verdict);
  await denyGeneric();expect(()=>api.prepareCanonicalWriteback(manifest.original,actor)).toThrow(/research_judge/);
  vi.setSystemTime(T+6000);const fresh=await freshInput(),p=api.prepareCanonicalWriteback(fresh,actor);
  expect(p.researchJudge).toMatchObject({decision:"PASS",semanticTruthVerified:false,primaryAuthority:false});
  const saved=await api.applyCanonicalWriteback({input:fresh,planId:p.planId,authorizations:authorizations(p)},actor);
  expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(3);
  expect(engine.status(source.receiptKey,actor).receipt).toEqual(receipt);expect(fs.readFileSync(path.join(dataRoot,"vault",source.path))).toEqual(bytes);
  for(const row of before)expect(await events()).toContainEqual(row);
});
it("L2-F fresh assessment after new Apply withdrawal succeeds; obsolete withdrawal cannot affect it",async()=>{
  const api=await openFixture("PASS-false"),held=withdrawal("HOLD");
  await expect(api.applyCanonicalWriteback({input:held,planId:manifest.preview.planId,authorizations:"invalid"},actor)).rejects.toThrow();
  vi.setSystemTime(T+6000);const fresh=await freshInput(),p=api.prepareCanonicalWriteback(fresh,actor);
  const gates=await import("../safe-edit/research-judge-gate"),before=gates.currentJudgeGate(p.planId);
  await expect(api.applyCanonicalWriteback({input:held,planId:p.planId,authorizations:"invalid"},actor)).rejects.toThrow();
  expect(gates.currentJudgeGate(p.planId)).toEqual(before);
  const saved=await api.applyCanonicalWriteback({input:fresh,planId:p.planId,authorizations:authorizations(p)},actor);
  expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(4);
});
it.each(["forged seal","missing seal","wrong actor","wrong intake","wrong source","wrong packet digest","wrong packet id","wrong result digest","wrong result id","wrong review","wrong result envelope","missing result","wrong policy","expired","future","rotated key","missing key"])("L2-G/J unauthenticated %s cannot withdraw legacy authority",async fault=>{
  await openFixture("PASS-false");const before=await events(),input=withdrawal("HOLD"),packet=input.researchJudge!.packet,result=input.researchJudge!.result!;
  let label=actor,planId=manifest.preview.planId;
  if(fault==="forged seal")packet.seal="0".repeat(64);
  if(fault==="missing seal")delete (packet as {seal?:string}).seal;
  if(fault==="wrong actor")label="oauth:unrelated";
  if(fault==="wrong intake")planId="IN-0000000000000000";
  if(fault==="wrong source"){const body=JSON.parse(packet.body);body.source.text+="different source";packet.body=JSON.stringify(body);}
  if(fault==="wrong policy"){const body=JSON.parse(packet.body);body.researchStatePolicy="untrusted";packet.body=JSON.stringify(body);}
  if(fault==="wrong packet digest")packet.digest="0".repeat(64);
  if(fault==="wrong packet id")packet.packetId="RJP-"+"0".repeat(32);
  if(fault==="wrong result digest")result.packetDigest="0".repeat(64);
  if(fault==="wrong result id")result.packetId="RJP-"+"0".repeat(32);
  if(fault==="wrong review")result.reviewDigest="0".repeat(64);
  if(fault==="wrong result envelope")result.packetEnvelopeDigest="0".repeat(64);
  if(fault==="missing result")delete input.researchJudge!.result;
  if(fault==="expired")vi.setSystemTime(packet.expiresAt+1);
  if(fault==="future")vi.setSystemTime(packet.issuedAt-1);
  if(fault==="rotated key")process.env.ENCRYPTION_KEY=Buffer.alloc(32,9).toString("base64");
  if(fault==="missing key")delete process.env.ENCRYPTION_KEY;
  try{
    await withMcp(async client=>expect((await client.callTool({name:"apply_canonical_writeback",arguments:{input,planId,authorizations:"invalid"}})).isError).toBe(true),label);
    expect(await events()).toEqual(before);expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)?.decision).toBe("PASS");
    await denyGeneric(fault==="expired"?/Preview expired/:/research_judge/);
  }finally{process.env.ENCRYPTION_KEY=KEY;}
});
it("L2-I Source-only preservation remains eligible after authenticated Apply withdrawal",async()=>{
  const api=await openFixture("PASS-false"),held=withdrawal("HOLD"),before=await events();
  await expect(api.applyCanonicalWriteback({input:held,planId:manifest.preview.planId,authorizations:"invalid"},actor)).rejects.toThrow();
  const input={...manifest.original,researchJudge:undefined,claims:undefined,researchReview:undefined,captureOnly:true};
  const p=api.prepareCanonicalWriteback(input,actor),saved=await api.applyCanonicalWriteback({input,planId:p.planId,authorizations:authorizations(p)},actor);
  expect(saved.receipts).toHaveLength(1);expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)?.decision).toBe("HOLD");
  for(const row of before)expect(await events()).toContainEqual(row);await denyGeneric();
});
it("L2-H concurrent matching legacy withdrawals and PASS retries cannot leave PASS",async()=>{
  const api=await openFixture("PASS-false"),input=withdrawal("HOLD");
  await Promise.allSettled([api.applyCanonicalWriteback({input,planId:manifest.preview.planId,authorizations:"invalid"},actor),
    Promise.resolve().then(()=>api.prepareCanonicalWriteback(manifest.original,actor)),
    api.applyCanonicalWriteback({input,planId:manifest.preview.planId,authorizations:"invalid"},actor)]);
  expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)?.decision).toBe("HOLD");await denyGeneric();
});
it("L2-H authoritative transactional recheck rejects a withdrawal against superseded legacy snapshot",async()=>{
  const api=await openFixture("PASS-false"),gates=await import("../safe-edit/research-judge-gate"),old=gates.currentJudgeGate(manifest.preview.planId)!;
  const fresh=await freshInput();api.prepareCanonicalWriteback(fresh,actor);const current=gates.currentJudgeGate(manifest.preview.planId),before=await events();
  const engine=await import("../safe-edit/engine"),sql=(await import("../db")).db(),prepare=sql.prepare.bind(sql),Database=(await import("better-sqlite3")).default;
  const other=new Database((await import("../env")).env.dbPath,{timeout:0});let checked=0;
  const spy=vi.spyOn(sql,"prepare").mockImplementation((query:string)=>{
    if(query.includes("SELECT detail,at,rowid FROM safe_edit_events WHERE event='research_judge_gate'")){
      checked++;expect(sql.inTransaction).toBe(true);expect(()=>other.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
    }return prepare(query);
  });
  try{expect(()=>engine.recordResearchJudgeGate(old.targets[0].operationId,actor,{...old,decision:"HOLD",expiresAt:0},{current:old})).toThrow("research_judge_withdrawal_superseded_hold");}
  finally{spy.mockRestore();if(other.inTransaction)other.exec("ROLLBACK");other.close();}
  expect(checked).toBe(1);expect(gates.currentJudgeGate(manifest.preview.planId)).toEqual(current);expect(await events()).toEqual(before);
});

it("L2-H same-clock HOLD then FAIL is restrictive, idempotent, and recoverable only by fresh assessment",async()=>{
  const api=await openFixture("PASS-false"),old=await events();
  for(const verdict of ["HOLD","FAIL","HOLD"] as const){
    await expect(api.applyCanonicalWriteback({input:withdrawal(verdict),planId:manifest.preview.planId,authorizations:"invalid"},actor)).rejects.toThrow();
  }
  const gate=(await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.preview.planId)!;
  expect(gate).toMatchObject({decision:"FAIL",revokedAt:T+5000,packetIssuedAt:T});
  expect(gate.packetEnvelopeDigest).toBe((await import("../vault/research-judge")).judgeEnvelopeDigest(manifest.original.researchJudge!.packet));
  await denyGeneric();expect(()=>api.prepareCanonicalWriteback(manifest.original,actor)).toThrow(/research_judge_revoked_envelope_hold/);
  vi.setSystemTime(T+6000);const fresh=await freshInput();expect(api.prepareCanonicalWriteback(fresh,actor).researchJudge?.decision).toBe("PASS");
  for(const row of old)expect(await events()).toContainEqual(row);
});

it.each(["source", "actor"])("L2-G independently sealed other %s packet cannot withdraw enrolled legacy PASS",async fault=>{
  const api=await openFixture("PASS-false"),before=await events(),clean=api.canonicalInputSchema.parse({...manifest.original,researchJudge:undefined});
  if(fault==="source")clean.sourceUrl="https://example.org/different-source";
  const judge=await import("../vault/research-judge"),built=judge.buildResearchJudgePacket(clean,fault==="actor"?"oauth:other":actor),body=JSON.parse(built.packet.body);
  const result={...withdrawal("HOLD").researchJudge!.result!,packetId:built.packet.packetId,packetDigest:built.packet.digest,reviewDigest:body.reviewDigest,packetEnvelopeDigest:built.packetEnvelopeDigest};
  await expect(api.applyCanonicalWriteback({input:{...clean,researchJudge:{packet:built.packet,result}},planId:manifest.preview.planId,authorizations:"invalid"},actor)).rejects.toThrow();
  expect(await events()).toEqual(before);await denyGeneric();
});
it("L2 normal authentic legacy PASS without withdrawal remains eligible and idempotent",async()=>{
  const api=await openFixture("PASS-false"),before=await events(),p=api.prepareCanonicalWriteback(manifest.original,actor);
  expect(p.researchJudge).toMatchObject({decision:"PASS",semanticTruthVerified:false,primaryAuthority:false});
  const saved=await api.applyCanonicalWriteback({input:manifest.original,planId:p.planId,authorizations:authorizations(p)},actor);
  expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(4);
  const retry=api.prepareCanonicalWriteback(manifest.original,actor);
  expect((await api.applyCanonicalWriteback({input:manifest.original,planId:retry.planId,authorizations:authorizations(retry)},actor)).receipts).toEqual([]);
  for(const row of before)expect(await events()).toContainEqual(row);
});

/** D1 upgrade: real pre-fix RISK-1 gates/receipts from immutable 44efef94.
 * Only disposable test harnesses are added to that archive; no fake journal,
 * receipt or seal. Semantic results remain explicitly simulated. */
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {execFileSync} from "node:child_process";
import type {canonicalInputSchema,prepareCanonicalWriteback} from "./canonical-writeback";
import type {z} from "zod";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const BASE="44efef941f0b586ccd1f1cf84dc608c4f77eb6b2",actor="oauth:risk-draft-fixture";
let root:string,dataRoot:string;
let manifest:{input:z.infer<typeof canonicalInputSchema>;prepared:ReturnType<typeof prepareCanonicalWriteback>;protectedPaths:string[]};
beforeAll(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"risk-broker-upgrade-")));
 const old=path.join(root,"old");fs.mkdirSync(old);
 expect(execFileSync("git",["rev-parse",BASE+"^{tree}"],{encoding:"utf8"}).trim()).toBe("cb24f95392972f7d6692ae054587f8285bf3653a");
 execFileSync("tar",["-x","-C",old],{input:execFileSync("git",["archive",BASE],{maxBuffer:32*1024*1024})});
 fs.symlinkSync(path.resolve("node_modules"),path.join(old,"node_modules"),"dir");
 const original=fs.readFileSync(path.join(old,"src/server/mcp/risk-draft-admission.test.ts"),"utf8");
 const prefix=original.slice(0,original.indexOf('\nit("routine added detail'));
 expect(prefix).toContain("async function judged(");
 fs.writeFileSync(path.join(old,"src/server/mcp/risk-producer.test.ts"),prefix+`
it.each([
 ['numeric',{brokerUpdate:{bank:'Fixture Broker',priorTargetPrice:'100',targetPrice:'150',estimateChanges:[{metric:'EPS',period:'FY forward',oldValue:'1.0',newValue:'2.0',unit:'USD'}]}}],
 ['rating',{brokerUpdate:{bank:'Fixture Broker',priorRating:'Sell',rating:'Buy'}}],
 ['kind',{sourceKind:'broker_research'}],['routine',{}]
] as const)('export pre-fix %s PASS',async(name,extra)=>{
 const input=await judged({...base,...extra,contentTypes:['other']}),prepared=await prepare(input);
 expect(prepared.researchJudge?.decision).toBe('PASS');
 expect(prepared.previews.some(t=>t.kind==='canonical_review')).toBe(true);
 (await import('../db')).db().close();
 const out=path.join(process.env.RI001_BROKER_EXPORT!,name);fs.cpSync(root,out,{recursive:true});
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({input,prepared,protectedPaths}));
});`);
 const log=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/risk-producer.test.ts","--maxWorkers=1"],
  {cwd:old,env:{...process.env,RI001_BROKER_EXPORT:path.join(root,"exports")},timeout:60000,maxBuffer:8*1024*1024,encoding:"utf8"});
 expect(log).toContain("4 passed");
},65000);
afterAll(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});
beforeEach(()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];});
afterEach(async()=>{
 if(dataRoot){for(const p of manifest.protectedPaths)expect(fs.readFileSync(path.join(dataRoot,"vault",p),"utf8")).toBe("# TESTA disposable fixture\n");
  (await import("../db")).db().close();fs.rmSync(dataRoot,{recursive:true,force:true});dataRoot="";}
 vi.restoreAllMocks();for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});
it.each(["numeric","rating","kind","routine"])("D1 actual RISK-1 %s pending authority cannot survive scope revision",async name=>{
 dataRoot=fs.mkdtempSync(path.join(root,"reader-"));fs.cpSync(path.join(root,"exports",name),dataRoot,{recursive:true});
 process.env.DATA_DIR=dataRoot;process.env.ENCRYPTION_KEY=Buffer.alloc(32,8).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
 manifest=JSON.parse(fs.readFileSync(path.join(dataRoot,"manifest.json"),"utf8"));
 const engine=await import("../safe-edit/engine"),api=await import("./canonical-writeback"),j=await import("../vault/research-judge"),sql=(await import("../db")).db();
 const originalJournal=sql.prepare("SELECT * FROM safe_edit_events ORDER BY rowid").all();
 const source=manifest.prepared.previews.find(t=>t.kind==="source_intake")!,review=manifest.prepared.previews.find(t=>t.kind==="canonical_review")!;
 const authorization=(t:typeof source)=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash});
 engine.apply(authorization(source),actor); // Source remains independently eligible.
 const sourceBytes=fs.readFileSync(path.join(dataRoot,"vault",source.path));
 const sourceReceipt=engine.status(source.operationId,actor).receipt;
 expect(()=>engine.apply(authorization(review),actor)).toThrow("research_judge_risk_policy_hold");
 expect(()=>api.prepareCanonicalWriteback(manifest.input,actor)).toThrow("RI001-DRAFT-RISK-1.1");
 await expect(api.applyCanonicalWriteback({input:manifest.input,planId:manifest.prepared.planId,authorizations:[]},actor)).rejects.toThrow("RI001-DRAFT-RISK-1.1");
 expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(manifest.prepared.planId)?.decision).toBe("HOLD");
 expect(sql.prepare("SELECT count(*) n FROM safe_edit_operations WHERE status='written' AND json_extract(payload,'$.path') NOT LIKE '00_Inbox/%'").get()).toEqual({n:0});
 expect(fs.existsSync(path.join(dataRoot,"vault",review.path))).toBe(false);
 // Fresh issuance and assessment of the new scope, never a modified old seal.
 const clean=api.canonicalInputSchema.parse({...manifest.input,researchJudge:undefined});
 const packet=j.buildResearchJudgePacket(clean,actor),body=JSON.parse(packet.packet.body);
 const result={...manifest.input.researchJudge!.result!,packetId:packet.packet.packetId,packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,reviewDigest:body.reviewDigest,
  riskAssessment:{...manifest.input.researchJudge!.result!.riskAssessment!,policy:j.DRAFT_RISK_POLICY,scopeDigest:body.riskScope.digest,coveredKeys:body.riskScope.items.map((x:{key:string})=>x.key)}};
 const input={...clean,researchJudge:{packet:packet.packet,result}},fresh=api.prepareCanonicalWriteback(input,actor);
 expect(fresh.researchJudge?.decision).toBe(name==="routine"?"PASS":"HOLD");
 if(name==="routine")expect((await api.applyCanonicalWriteback({input,planId:fresh.planId,authorizations:fresh.previews.map(authorization)},actor)).status).toBe("saved_verified");
 else expect(fresh.previews).toEqual([]);
 expect(fs.readFileSync(path.join(dataRoot,"vault",source.path))).toEqual(sourceBytes);
 expect(engine.status(source.operationId,actor).receipt).toEqual(sourceReceipt);
 for(const event of originalJournal)expect(sql.prepare("SELECT * FROM safe_edit_events ORDER BY rowid").all()).toContainEqual(event);
});

/** Actual PR169 baseline produces the reviewed bundle and alias preview.
 * No synthetic receipt/journal mutation. Simulated review proves mechanisms only. */
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
const BASE="1294bc8ae7e379ff1188e705ee74ad1c7fde2053",actor="oauth:risk-draft-fixture";
let scratch:string,root:string,manifest:any,connection:{close:()=>void}|undefined;
beforeAll(()=>{
 scratch=fs.mkdtempSync(path.join(os.tmpdir(),"c1-hardening-code-"));const old=path.join(scratch,"old");fs.mkdirSync(old);
 expect(execFileSync("git",["rev-parse",BASE+"^{tree}"],{encoding:"utf8"}).trim()).toBe("897e6e43f939ace8e342f252bd8591f4375012be");
 execFileSync("tar",["-x","-C",old],{input:execFileSync("git",["archive",BASE],{maxBuffer:32*1024*1024})});
 fs.symlinkSync(path.resolve("node_modules"),path.join(old,"node_modules"),"dir");
 const original=fs.readFileSync(path.join(old,"src/server/mcp/c1-pilot-admission.test.ts"),"utf8");
 const prefix=original.slice(0,original.indexOf('\nit("requires explicit dashboard')).replace('fs.rmSync(root,{recursive:true,force:true})','void root');
 expect(prefix).toContain("async function reviewDecision(");
 fs.writeFileSync(path.join(old,"src/server/mcp/c1-hardening-producer.test.ts"),prefix+`
it('export actual baseline alias preview and reproduce write',async()=>{
 const data=await judged(),p=await prepare(data);expect((await reviewDecision(p)).status).toBe(200);
 const engine=await import('../safe-edit/engine'),{db}=await import('../db');
 const t=p.previews.find(t=>t.kind==='canonical_review')!,s=p.previews.find(t=>t.kind==='source_intake')!;
 const original=db().prepare('SELECT payload FROM safe_edit_operations WHERE id=?').get(t.operationId) as {payload:string};
 const alias=engine.preview({...JSON.parse(original.payload),operationId:'C1-UNREVIEWED-ALIAS'},actor);
 engine.apply({operationId:s.operationId,previewToken:s.previewToken,expectedHash:s.beforeHash},actor);
 db().pragma('wal_checkpoint(TRUNCATE)');
 fs.cpSync(root,path.join(process.env.C1_HARDENING_EXPORT!,'pending'),{recursive:true});
 const journal=db().prepare('SELECT * FROM safe_edit_events ORDER BY rowid').all();
 const sourceReceipt=engine.status(s.operationId,actor).receipt;
 expect(engine.apply({operationId:alias.operationId,previewToken:alias.previewToken,expectedHash:alias.beforeHash},actor).status).toBe('written');
 expect(fs.existsSync(path.join(vault,t.path))).toBe(true);
 fs.writeFileSync(path.join(process.env.C1_HARDENING_EXPORT!,'manifest.json'),JSON.stringify({root,data,p,alias,journal,sourceReceipt,protectedPaths}));
});`);
 const log=execFileSync(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","src/server/mcp/c1-hardening-producer.test.ts","--maxWorkers=1"],
  {cwd:old,env:{...process.env,C1_HARDENING_EXPORT:scratch},encoding:"utf8",timeout:45000,maxBuffer:4*1024*1024});
 expect(log).toContain("1 passed");manifest=JSON.parse(fs.readFileSync(path.join(scratch,"manifest.json"),"utf8"));root=manifest.root;
},50000);
beforeEach(()=>{
 vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
 fs.rmSync(root,{recursive:true,force:true});fs.cpSync(path.join(scratch,"pending"),root,{recursive:true});
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,8).toString("base64"),C1_RESEARCH_PILOT:"disposable",SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
});
afterEach(()=>{
 for(const p of manifest.protectedPaths)expect(fs.readFileSync(path.join(root,"vault",p),"utf8")).toBe("# TESTA disposable fixture\n");
 connection?.close();connection=undefined;
 for(const key of ["DATA_DIR","C1_RESEARCH_PILOT","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[key];
});
afterAll(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
const auth=(p:any)=>({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash});
async function opened(){const db=(await import("../db")).db();connection=db;return db;}
async function preserved(){
 const sql=await opened(),engine=await import("../safe-edit/engine"),s=manifest.p.previews.find((t:any)=>t.kind==="source_intake");
 expect(engine.status(s.operationId,actor).receipt).toEqual(manifest.sourceReceipt);
 const now=sql.prepare("SELECT * FROM safe_edit_events ORDER BY rowid").all();for(const e of manifest.journal)expect(now).toContainEqual(e);
 const {createReceipt}=await import("../vault/investment-research-context");
 expect(createReceipt("source_intake",s.path,fs.readFileSync(path.join(root,"vault",s.path),"utf8"))).toBe(s.operationId);
}
it("F1 old generic alias token is refused at real MCP apply; exact canonical IDs still save and retry",async()=>{
 const sql=await opened(),{createSafeEditMcpServer}=await import("./safe-edit-server");
 const server=createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"C1-HARDENING-MECHANISM",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{
  const denied=await client.callTool({name:"apply_edit",arguments:auth(manifest.alias)});expect(denied.isError).toBe(true);expect(JSON.stringify(denied)).toContain("c1_pilot");
  expect(sql.prepare("SELECT count(*) n FROM safe_edit_operations WHERE status='written' AND json_extract(payload,'$.path') NOT LIKE '00_Inbox/%'").get()).toEqual({n:0});
  const api=await import("./canonical-writeback");
  await expect(api.applyCanonicalWriteback({input:manifest.data,planId:manifest.p.planId,authorizations:manifest.p.previews.map((t:any)=>auth(t.kind==="canonical_review"?manifest.alias:t))},actor)).rejects.toThrow();
  const input={input:manifest.data,planId:manifest.p.planId,authorizations:manifest.p.previews.filter((t:any)=>t.kind!=="source_intake").map(auth)};
  expect((await api.applyCanonicalWriteback(input,actor)).status).toBe("saved_verified");
  const retry=await api.applyCanonicalWriteback({...input,authorizations:[]},actor);expect(retry.status).toBe("saved_verified");
  const t=manifest.p.previews.find((t:any)=>t.kind==="canonical_review"),engine=await import("../safe-edit/engine");
  expect(engine.apply(auth(t),actor).receipt).toEqual(engine.status(t.operationId,actor).receipt);
  expect(sql.prepare("SELECT count(*) n FROM safe_edit_operations WHERE status='written' AND json_extract(payload,'$.path') NOT LIKE '00_Inbox/%'").get()).toEqual({n:1});
  await preserved();
 }finally{await client.close();await server.close();}
});
it("F1 exact reviewed operation ID works through generic apply with valid receipt and idempotent retry",async()=>{
 await opened();const engine=await import("../safe-edit/engine");
 const t=manifest.p.previews.find((t:any)=>t.kind==="canonical_review");
 const first=engine.apply(auth(t),actor);expect(first.status).toBe("written");
 expect(engine.apply(auth(t),actor)).toEqual(first);
 const {createReceipt}=await import("../vault/investment-research-context");
 expect(createReceipt("canonical_review",t.path,fs.readFileSync(path.join(root,"vault",t.path),"utf8"))).toBe(t.operationId);
 await preserved();
});
it("F2 fresh process without the flag refuses reserved roots AND existing pre-hardening journal enrollment",async()=>{
 delete process.env.C1_RESEARCH_PILOT;
 const run=(dir:string)=>spawnSync(process.execPath,["-e","require(process.argv[1]).assertPilotIdentity(process.env.DATA_DIR)",path.resolve("scripts/c1-pilot-identity.cjs")],{env:{...process.env,DATA_DIR:dir},encoding:"utf8"});
 expect(run(root).status).not.toBe(0);expect(run(root).stderr).toContain("c1_pilot_mode_required_hold");
 // Removing the reserved basename is insufficient: actual baseline journal
 // enrollment survives relocation. No manufactured marker or receipt.
 const moved=path.join(scratch,"renamed-data");fs.renameSync(root,moved);
 try{
  const before=fs.readFileSync(path.join(moved,"app.sqlite")),result=run(moved);
  expect(result.status).not.toBe(0);expect(result.stderr).toContain("c1_pilot_enrolled_instance_requires_mode_hold");
  expect(fs.readFileSync(path.join(moved,"app.sqlite"))).toEqual(before);
 }finally{fs.renameSync(moved,root);process.env.C1_RESEARCH_PILOT="disposable";}
 await preserved();
});

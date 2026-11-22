import {it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
const counts=vi.hoisted(()=>({opens:0,identityQueries:0}));
vi.mock("better-sqlite3",async importOriginal=>{
 const Original=(await importOriginal<{default:typeof import("better-sqlite3")}>()).default;
 return {default:class extends Original{
  constructor(...args:ConstructorParameters<typeof Original>){super(...args);counts.opens++;}
  prepare(sql:string):any{
   const stmt=super.prepare(sql);
   if(sql.includes("event GLOB 'c1_pilot_*'")||sql==="SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'"){
    const get=stmt.get.bind(stmt);stmt.get=(...args:any[])=>{counts.identityQueries++;return get(...args);};
   }
   return stmt;
  }
 }};
});
it.each([0,20000,100000])("R1 repeated db() has no hot identity scan/open: %i events",async n=>{
 vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"c1-r1-db-"));process.env.DATA_DIR=root;delete process.env.C1_RESEARCH_PILOT;
 let opened:{close:()=>void}|undefined;
 try{
  const Database=(await import("better-sqlite3")).default,d=new Database(path.join(root,"app.sqlite"));
  d.exec("CREATE TABLE safe_edit_events (at TEXT,operation_id TEXT,actor TEXT,event TEXT,detail TEXT)");
  const insert=d.prepare("INSERT INTO safe_edit_events VALUES('2026-11-10',?,'fixture','performance_fixture','{}')");
  d.transaction(()=>{for(let i=0;i<n;i++)insert.run(`PERF-${i}`);})();d.close();
  counts.opens=0;counts.identityQueries=0;
  const {db}=await import("./db");opened=db();const before={...counts},t=performance.now();
  for(let i=0;i<1000;i++)expect(db()).toBe(opened);
  const report={baseline:process.env.C1_R1_BASELINE_MEASURE==="1",journalEvents:n,db1000Ms:+(performance.now()-t).toFixed(2),hotIdentityQueries:counts.identityQueries-before.identityQueries,hotConnections:counts.opens-before.opens,bootstrap:before};
  console.log("C1_R1_DB "+JSON.stringify(report));
  if(!report.baseline){expect(report.hotIdentityQueries).toBe(0);expect(report.hotConnections).toBe(0);expect(before.identityQueries).toBe(4);expect(before.opens).toBe(2);}
 }finally{opened?.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;}
},60000);

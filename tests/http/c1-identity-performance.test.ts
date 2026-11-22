/** Wall time is descriptive only. Zero hot-path scans/connections is the CI
 * invariant. Seed rows are ordinary test events, never receipts/approvals. */
import {it,expect} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import Database from "better-sqlite3";
import {startServer,claimAdmin,markConfigured,rpc,type Server} from "./harness";
const baseline=process.env.C1_R1_BASELINE_MEASURE==="1";
type Counts={connections:number;identityQueries:number};
async function counts(s:Server,file:string):Promise<Counts>{
 fs.rmSync(file,{force:true});process.kill(s.pid,"SIGUSR2");
 const end=Date.now()+3000;while(!fs.existsSync(file)){if(Date.now()>end)throw Error("probe timeout");await new Promise(r=>setTimeout(r,10));}
 return JSON.parse(fs.readFileSync(file,"utf8"));
}
async function median(run:()=>Promise<void>,n=15){const times:number[]=[];for(let i=0;i<n;i++){const t=performance.now();await run();times.push(performance.now()-t);}return +times.sort((a,b)=>a-b)[Math.floor(n/2)].toFixed(2);}
it.each([0,20000,100000])("R1 emitted legacy HTTP/reindex: %i journal events",async n=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"c1-r1-http-")),file=path.join(root,"probe.json");let server:Server|undefined;
 try{
  fs.mkdirSync(path.join(root,"vault"));
  for(let i=0;i<300;i++)fs.writeFileSync(path.join(root,"vault",`Fixture-${i}.md`),`# Synthetic legacy fixture ${i}\nOrdinary historical text.\n`);
  const d=new Database(path.join(root,"app.sqlite"));
  d.exec("CREATE TABLE safe_edit_events (at TEXT,operation_id TEXT,actor TEXT,event TEXT,detail TEXT)");
  const insert=d.prepare("INSERT INTO safe_edit_events VALUES('2026-11-10',?,'fixture','performance_fixture','{}')");
  d.transaction(()=>{for(let i=0;i<n;i++)insert.run(`PERF-${i}`);})();d.close();
  server=await startServer({NODE_OPTIONS:`--require ${path.resolve("scripts/fixtures/c1-identity-probe.cjs")}`,C1_IDENTITY_PROBE_FILE:file,CLOUD_INTAKE:"0"},{dataDir:root,keepDataDir:true});
  const s=server,cookie=await claimAdmin(s);await markConfigured(s,{sync_backend:"git"});
  const health=async()=>{expect((await fetch(s.url+"/api/health")).status).toBe(200);};
  const home=async()=>{expect((await fetch(s.url+"/",{headers:{cookie}})).status).toBe(200);};
  const reindex=async()=>{expect((await rpc(s,"rebuildIndex",[],cookie)).status).toBe(200);};
  await health();await home();await reindex();
  const before=await counts(s,file);
  const healthMs=await median(health),homeMs=await median(home),reindex300Ms=await median(reindex,3);
  const after=await counts(s,file);
  const report={baseline,journalEvents:n,healthMs,homeMs,reindex300Ms,hotIdentityQueries:after.identityQueries-before.identityQueries,hotConnections:after.connections-before.connections,bootstrapAndWarmup:before};
  console.log("C1_R1_HTTP "+JSON.stringify(report));
  expect(before.connections).toBeGreaterThan(0); // The probe must observe actual constructors.
  if(!baseline){expect(report.hotIdentityQueries).toBe(0);expect(report.hotConnections).toBe(0);expect(before.identityQueries).toBeLessThanOrEqual(6);expect(before.identityQueries).toBeGreaterThan(0);}
 }finally{await server?.stop();fs.rmSync(root,{recursive:true,force:true});}
},60000);

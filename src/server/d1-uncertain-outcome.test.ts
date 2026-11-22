import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getAdapter } from "better-auth/db/adapter";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "d1-g06-unknown-"));
  process.env.DATA_DIR = root;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("notemesh.d1.native-interlock.v1")];
  vi.resetModules();
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.DATA_DIR; fs.rmSync(root, { recursive: true, force: true }); });

it("real Better Auth/Kysely COMMIT_UNKNOWN survives its subsequent failed ROLLBACK", async () => {
  const { db, withAuthDatabaseOwner, d1DatabaseStatus } = await import("./db");
  db();
  const observer = new Database(path.join(root, "app.sqlite"), { readonly: true, fileMustExist: true });
  const sync = fs.fsyncSync, injected = new Error("synthetic-post-COMMIT-release-EIO");
  let fired = false, caught: unknown;
  try {
    // The independent native reader only sees this row AFTER the real COMMIT.
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (!fired && observer.prepare("SELECT value FROM settings WHERE key='unknown-commit'").get()) {
        fired = true; throw injected;
      }
      sync(fd);
    });
    try {
      await withAuthDatabaseOwner(async connection => {
        const adapter = await getAdapter({ database: connection });
        return adapter.transaction(async () => {
          connection.prepare("INSERT INTO settings(key,value) VALUES('unknown-commit','persisted')").run();
        });
      });
    } catch (error) { caught = error; }
    vi.restoreAllMocks();
    expect(fired).toBe(true);
    expect(observer.prepare("SELECT value FROM settings WHERE key='unknown-commit'").get()).toEqual({ value: "persisted" });
    expect(caught).toMatchObject({ message: "COMMIT_UNKNOWN", code: "COMMIT_UNKNOWN", cause: injected });
    expect((caught as Error & { rollbackError?: unknown }).rollbackError).toBeDefined();
    expect(d1DatabaseStatus()).toMatchObject({ ownerActive: false, quarantine: "commit_outcome_unknown" });
    await expect(withAuthDatabaseOwner(async connection => connection.prepare("INSERT INTO settings(key,value) VALUES('late','no')").run())).rejects.toThrow();
    expect(observer.prepare("SELECT value FROM settings WHERE key='late'").get()).toBeUndefined();
  } finally { observer.close(); }
});

it("real adapter rollback retains the ordinary original error and permits a later normal transaction", async () => {
  const { db, withAuthDatabaseOwner } = await import("./db"); db();
  const primary = new Error("synthetic-business-failure");
  await expect(withAuthDatabaseOwner(async connection => {
    const adapter = await getAdapter({ database: connection });
    return adapter.transaction(async () => {
      connection.prepare("INSERT INTO settings(key,value) VALUES('rolled-back','no')").run();
      throw primary;
    });
  })).rejects.toBe(primary);
  expect(db().prepare("SELECT value FROM settings WHERE key='rolled-back'").get()).toBeUndefined();
  await withAuthDatabaseOwner(async connection => {
    const adapter = await getAdapter({ database: connection });
    await adapter.transaction(async () => connection.prepare("INSERT INTO settings(key,value) VALUES('retry','yes')").run());
  });
  expect(db().prepare("SELECT value FROM settings WHERE key='retry'").get()).toEqual({ value: "yes" });
});

function freshNativeDenial() {
 const module = pathToFileURL(path.resolve("src/server/maintenance.ts")).href;
 const child = spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",`
 const m=await import(${JSON.stringify(module)});try{m.withD1NativeInterlock('business',()=>{throw Error('UNAUTHORIZED');});process.exitCode=9;}
 catch(e){console.log(JSON.stringify({code:e.code}));process.exitCode=17;}`],{env:{PATH:process.env.PATH,DATA_DIR:root},encoding:"utf8",timeout:5000});
 expect(child.signal).toBeNull();expect(child.status).toBe(17);expect(JSON.parse(child.stdout.trim())).toEqual({code:"d1_native_outcome_recovery_hold"});
}
it("G06E native COMMIT then IOERR before release retains durable outcome and exact descriptor",async()=>{
 const {db,withAuthDatabaseOwner}=await import("./db");db();
 const prepare=Database.prototype.prepare;
 const injected=Object.assign(Error("synthetic-native-COMMIT-return-IOERR"),{code:"SQLITE_IOERR"});
 vi.spyOn(Database.prototype,"prepare").mockImplementation(function(this:Database.Database,sql:string){
  const q=prepare.call(this,sql);
  if(!/^\s*commit\s*;?\s*$/i.test(sql))return q;
  return new Proxy(q,{get(target,key){const value=Reflect.get(target,key,target);
   if(key==="run"||key==="all"||key==="get")return (...args:unknown[])=>{Reflect.apply(value,target,args);throw injected;};
   return typeof value==="function"?value.bind(target):value;
  }});
 });
 await expect(withAuthDatabaseOwner(async connection=>{
  const adapter=await getAdapter({database:connection});await adapter.transaction(async()=>{
   connection.prepare("INSERT INTO settings(key,value) VALUES('native-unknown','persisted')").run();
  });
 })).rejects.toMatchObject({code:"COMMIT_UNKNOWN",cause:injected});
 vi.restoreAllMocks();
 const witness=JSON.parse(fs.readFileSync(path.join(root,".d1-native-outcome.pending"),"utf8"));
 expect(witness).toMatchObject({version:2,operation:"sqlite.commit",phase:"outcome_unknown"});
 const reader=new Database(path.join(root,"app.sqlite"),{readonly:true,fileMustExist:true});
 try{expect(reader.prepare("SELECT value FROM settings WHERE key='native-unknown'").get()).toEqual({value:"persisted"});}finally{reader.close();}
 freshNativeDenial();
});
it("G06E both owned handles configure FULL with WAL and zero native wait",async()=>{
 const {db,withAuthDatabaseOwner}=await import("./db");
 const check=(d:Database.Database)=>{
  expect(d.pragma("journal_mode",{simple:true})).toBe("wal");
  expect(d.pragma("synchronous",{simple:true})).toBe(2);
  expect(d.pragma("busy_timeout",{simple:true})).toBe(0);
 };
 check(db());await withAuthDatabaseOwner(async d=>check(d));
});
it("G06E disposable NORMAL/FULL comparison records configuration, never power-loss certification",()=>{
 const evidence:unknown[]=[];
 for(const mode of ["NORMAL","FULL"]){
  const d=new Database(path.join(root,mode+".sqlite"));
  try{
   d.pragma("journal_mode=WAL");d.pragma("synchronous="+mode);d.pragma("wal_autocheckpoint=0");
   d.exec("CREATE TABLE t(v); BEGIN IMMEDIATE; INSERT INTO t VALUES(1); COMMIT");
   const checkpoint=d.pragma("wal_checkpoint(PASSIVE)");
   expect(d.prepare("SELECT * FROM t").all()).toEqual([{v:1}]);
   const synchronous=d.pragma("synchronous",{simple:true});expect(synchronous).toBe(mode==="FULL"?2:1);
   evidence.push({mode,synchronous,journal:d.pragma("journal_mode",{simple:true}),checkpoint,powerLossTested:false});
  }finally{d.close();}
 }
 console.log("G06E_DURABILITY_CONFIG",JSON.stringify(evidence));
});

function coldDatabase(script:string){
 const resolver=`import{registerHooks}from'node:module';registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if((s.startsWith('./')||s.startsWith('../'))&&e.code==='ERR_MODULE_NOT_FOUND')return n(s+'.ts',c);throw e;}}});`;
 const module=pathToFileURL(path.resolve("src/server/db.ts")).href;
 return spawnSync(process.execPath,["--experimental-strip-types","--import","data:text/javascript,"+encodeURIComponent(resolver),"--input-type=module","-e",`
 const mod=await import(${JSON.stringify(module)});try{${script};console.log('G06E_COLD_NORMAL');}
 catch(e){console.log(JSON.stringify({probe:'g06e-cold-db',code:e.code,message:e.message}));process.exitCode=17;}`],
 {env:{PATH:process.env.PATH,DATA_DIR:root},encoding:"utf8",timeout:5000});
}
it("G06E fresh actual DB boot cannot reopen a completed-but-unacknowledged commit",async()=>{
 const {db}=await import("./db");const d=db(),sync=fs.fsyncSync;
 const reader=new Database(path.join(root,"app.sqlite"),{readonly:true,fileMustExist:true});let fired=false;
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{
  if(!fired&&reader.prepare("SELECT value FROM settings WHERE key='cold-unknown'").get()){fired=true;throw Error("post-autocommit-EIO");}sync(fd);
 });
 try{
  expect(()=>d.prepare("INSERT INTO settings(key,value) VALUES('cold-unknown','yes')").run()).toThrow("post-autocommit-EIO");
  expect(reader.prepare("SELECT value FROM settings WHERE key='cold-unknown'").get()).toEqual({value:"yes"});
 }finally{vi.restoreAllMocks();reader.close();}
 const r=coldDatabase(`mod.db().prepare("INSERT INTO settings(key,value) VALUES('late-cold','no')").run();`);
 expect(r.status).toBe(17);expect(JSON.parse(r.stdout.trim())).toMatchObject({probe:"g06e-cold-db",code:"d1_native_outcome_recovery_hold"});
});
it("G06E actual guarded DB process crash retains committed row and rolls back open transaction",()=>{
 const r=coldDatabase(`const d=mod.db();d.pragma('wal_autocheckpoint=0');d.prepare("INSERT INTO settings(key,value) VALUES('committed','yes')").run();
 d.transaction(()=>{d.prepare("INSERT INTO settings(key,value) VALUES('uncommitted','no')").run();process.kill(process.pid,'SIGKILL');})();`);
 expect(r.signal).toBe("SIGKILL");
 const reader=new Database(path.join(root,"app.sqlite"),{readonly:true,fileMustExist:true});
 try{expect(reader.prepare("SELECT key,value FROM settings WHERE key IN ('committed','uncommitted')").all()).toEqual([{key:"committed",value:"yes"}]);}finally{reader.close();}
 // Crash occurred between primitives in the open transaction. SQLite owns
 // rollback recovery; no manual deletion of witness/lock or DB repair.
 const fresh=coldDatabase(`const d=mod.db();d.prepare("INSERT INTO settings(key,value) VALUES('fresh-normal','yes')").run();`);
 expect(fresh.status).toBe(0);expect(fresh.stdout).toContain("G06E_COLD_NORMAL");
});

it("G06E Research callback ending its transaction cannot lose the uncertain witness",async()=>{
 const {db}=await import("./db");const d=db();
 expect(()=>d.transaction(()=>{
  d.prepare("INSERT INTO settings(key,value) VALUES('manual-end','persisted')").run();
  d.prepare("COMMIT").run();
 })()).toThrow("COMMIT_UNKNOWN");
 const w=JSON.parse(fs.readFileSync(path.join(root,".d1-native-outcome.pending"),"utf8"));
 expect(w).toMatchObject({operation:"sqlite.manual_end",phase:"outcome_unknown"});freshNativeDenial();
});


it("G06E failed Auth durability bootstrap cannot publish a partially configured handle",async()=>{
 const {db,withAuthDatabaseOwner,d1DatabaseStatus}=await import("./db");db();
 const pragma=Database.prototype.pragma;
 const primary=Object.assign(Error("synthetic-auth-FULL-busy"),{code:"SQLITE_BUSY"});let fired=false;
 vi.spyOn(Database.prototype,"pragma").mockImplementation(function(this:Database.Database,sql:string,options?:Database.PragmaOptions){
  if(!fired&&sql==="synchronous = FULL"){fired=true;throw primary;}
  return pragma.call(this,sql,options);
 });
 const work=vi.fn(async()=>undefined);
 await expect(withAuthDatabaseOwner(work)).rejects.toBe(primary);
 expect(fired).toBe(true);expect(work).not.toHaveBeenCalled();vi.restoreAllMocks();
 expect(d1DatabaseStatus()).toMatchObject({ownerActive:false,quarantine:null});
 await withAuthDatabaseOwner(async d=>{
  expect(d.pragma("synchronous",{simple:true})).toBe(2);
  expect(d.pragma("foreign_keys",{simple:true})).toBe(1);
  const adapter=await getAdapter({database:d});
  await adapter.transaction(async()=>d.prepare("INSERT INTO settings(key,value) VALUES('auth-bootstrap-retry','yes')").run());
 });
 expect(db().prepare("SELECT value FROM settings WHERE key='auth-bootstrap-retry'").get()).toEqual({value:"yes"});
});

it("G06E uncertain Auth bootstrap cleanup retains original error and denies retry",async()=>{
 const {db,withAuthDatabaseOwner,d1DatabaseStatus}=await import("./db");db();
 const pragma=Database.prototype.pragma;
 const primary=Object.assign(Error("synthetic-auth-bootstrap-busy"),{code:"SQLITE_BUSY"});
 const closeError=Object.assign(Error("synthetic-auth-close-EIO"),{code:"EIO"});
 vi.spyOn(Database.prototype,"pragma").mockImplementation(function(this:Database.Database,sql:string,options?:Database.PragmaOptions){
  if(sql==="synchronous = FULL")throw primary;
  return pragma.call(this,sql,options);
 });
 vi.spyOn(Database.prototype,"close").mockImplementation(()=>{throw closeError;});
 const work=vi.fn(async()=>undefined);
 await expect(withAuthDatabaseOwner(work)).rejects.toBe(primary);vi.restoreAllMocks();
 expect(work).not.toHaveBeenCalled();expect(primary).toMatchObject({rollbackError:closeError});
 expect(d1DatabaseStatus()).toMatchObject({ownerActive:false,quarantine:"auth_bootstrap_close_unsettled"});
 await expect(withAuthDatabaseOwner(work)).rejects.toThrow("d1_auth_admission_hold");
 freshNativeDenial();expect(work).not.toHaveBeenCalled();
});

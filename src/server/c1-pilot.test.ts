import {afterEach,beforeEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {spawnSync} from "node:child_process";
import {assertPilotIdentity,enrollPilotIdentity} from "../../scripts/c1-pilot-identity.cjs";
import Database from "better-sqlite3";
let root:string,connection:{close:()=>void}|undefined;
beforeEach(()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];delete process.env.C1_RESEARCH_PILOT;
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"c1-hardening-legacy-")));process.env.DATA_DIR=root;fs.mkdirSync(path.join(root,"vault"));});
afterEach(()=>{connection?.close();connection=undefined;fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;delete process.env.C1_RESEARCH_PILOT;});
it("normal never-enrolled legacy instance can still initialize and use the raw writer",async()=>{
 const {db}=await import("./db");connection=db();
 (await import("./vault/notes")).createNote("Legacy.md","# Legacy\n");
 expect(fs.readFileSync(path.join(root,"vault/Legacy.md"),"utf8")).toContain("# Legacy");
 expect((await import("./c1-pilot")).c1Pilot()).toBe(false);
 expect(()=>assertPilotIdentity(root)).not.toThrow();
});
it("reserved empty DATA_DIR without mode fails before any DB or directory creation",async()=>{
 const reserved=path.join(root,"ios-c1-pilot-uninitialized");process.env.DATA_DIR=reserved;
 expect(()=>assertPilotIdentity(reserved)).toThrow(/c1_pilot_mode_required/);
 const {db}=await import("./db");expect(()=>db()).toThrow(/c1_pilot_mode_required/);
 expect(fs.existsSync(reserved)).toBe(false);
});
it("connection reuse reads fresh enrollment, retains caller connection and rejects an unrelated DB handle",async()=>{
 const d=(await import("./db")).db();connection=d;
 expect(()=>assertPilotIdentity(root,undefined,undefined,d)).not.toThrow();
 // Actual server enrollment helper, not a fabricated receipt or raw SQL row.
 enrollPilotIdentity(d);
 expect(()=>assertPilotIdentity(root,undefined,undefined,d)).toThrow(/enrolled_instance_requires_mode/);
 expect(d.open).toBe(true);
 const unrelated=new Database(":memory:");
 try{expect(()=>assertPilotIdentity(root,undefined,undefined,unrelated)).toThrow(/enrolled_instance_requires_mode/);}
 finally{unrelated.close();}
});
it("enrollment precedes app initialization; removing mode blocks cached DB and worker entrypoints",async()=>{
 const pilot=path.join(root,"ios-c1-pilot-enrolled");fs.mkdirSync(path.join(pilot,"vault"),{recursive:true});process.env.DATA_DIR=pilot;process.env.C1_RESEARCH_PILOT="disposable";
 const {db}=await import("./db"),d=db();connection=d;
 expect(d.prepare("SELECT count(*) n FROM safe_edit_events WHERE event='c1_pilot_instance'").get()).toEqual({n:1});
 db();expect(d.prepare("SELECT count(*) n FROM safe_edit_events WHERE event='c1_pilot_instance'").get()).toEqual({n:1});
 delete process.env.C1_RESEARCH_PILOT;
 expect(()=>db()).toThrow(/c1_pilot_mode_required/);
 const {ensureSyncStarted}=await import("./sync"),{ensureCloudIntakeStarted}=await import("./cloud-intake");
 expect(()=>ensureSyncStarted()).toThrow(/c1_pilot_mode_required/);expect(()=>ensureCloudIntakeStarted()).toThrow(/c1_pilot_mode_required/);
 d.close();connection=undefined;
 const renamed=path.join(root,"renamed");fs.renameSync(pilot,renamed);
 const result=spawnSync(process.execPath,["-e","require(process.argv[1]).assertPilotIdentity(process.env.DATA_DIR)",path.resolve("scripts/c1-pilot-identity.cjs")],{env:{...process.env,DATA_DIR:renamed},encoding:"utf8"});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain("c1_pilot_enrolled_instance_requires_mode_hold");
});
it("unreadable/corrupted identity state is restrictive, never interpreted as an unenrolled instance",()=>{
 fs.writeFileSync(path.join(root,"app.sqlite"),"Not SQLite");
 expect(()=>assertPilotIdentity(root)).toThrow(/c1_pilot_identity_unreadable_hold/);
 expect(fs.readFileSync(path.join(root,"app.sqlite"),"utf8")).toBe("Not SQLite");
});

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
it("legacy cannot enroll during its lifetime; refusal is sticky without writing an enrollment event",async()=>{
 const d=(await import("./db")).db();connection=d;
 expect(()=>assertPilotIdentity(root,undefined,undefined,d)).not.toThrow();
 expect(()=>enrollPilotIdentity(d)).toThrow(/live_enrollment_hold/);
 expect(()=>assertPilotIdentity(root,undefined,undefined,d)).toThrow(/live_enrollment_hold/);
 expect(d.prepare("SELECT name FROM sqlite_master WHERE name='safe_edit_events'").get()).toBeUndefined();
 expect(d.open).toBe(true);
 const unrelated=new Database(":memory:");
 try{expect(()=>assertPilotIdentity(root,undefined,undefined,unrelated)).toThrow(/live_enrollment_hold/);}
 finally{unrelated.close();}
});
it("enrollment precedes app initialization; removing mode blocks cached DB and worker entrypoints",async()=>{
 const pilot=path.join(root,"ios-c1-pilot-enrolled");fs.mkdirSync(path.join(pilot,"vault"),{recursive:true});process.env.DATA_DIR=pilot;process.env.C1_RESEARCH_PILOT="disposable";
 const {db}=await import("./db"),d=db();connection=d;
 expect(d.prepare("SELECT count(*) n FROM safe_edit_events WHERE event='c1_pilot_instance'").get()).toEqual({n:1});
 db();expect(d.prepare("SELECT count(*) n FROM safe_edit_events WHERE event='c1_pilot_instance'").get()).toEqual({n:1});
 delete process.env.C1_RESEARCH_PILOT;
 expect(()=>db()).toThrow(/c1_pilot_live_transition_hold/);
 const {ensureSyncStarted}=await import("./sync"),{ensureCloudIntakeStarted}=await import("./cloud-intake");
 expect(()=>ensureSyncStarted()).toThrow(/c1_pilot_live_transition_hold/);expect(()=>ensureCloudIntakeStarted()).toThrow(/c1_pilot_live_transition_hold/);
 process.env.C1_RESEARCH_PILOT="disposable";expect(()=>db()).toThrow(/c1_pilot_live_transition_hold/);delete process.env.C1_RESEARCH_PILOT;
 d.close();connection=undefined;
 const renamed=path.join(root,"renamed");fs.renameSync(pilot,renamed);
 const result=spawnSync(process.execPath,["-e","require(process.argv[1]).assertPilotIdentity(process.env.DATA_DIR)",path.resolve("scripts/c1-pilot-identity.cjs")],{env:{...process.env,DATA_DIR:renamed},encoding:"utf8"});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain("c1_pilot_enrolled_instance_requires_mode_hold");
});
it("unreadable/corrupted identity state is restrictive, never interpreted as an unenrolled instance",()=>{
 fs.writeFileSync(path.join(root,"app.sqlite"),"Not SQLite");
 expect(()=>assertPilotIdentity(root)).toThrow(/c1_pilot_identity_unreadable_hold/);
 expect(fs.readFileSync(path.join(root,"app.sqlite"),"utf8")).toBe("Not SQLite");
 fs.rmSync(path.join(root,"app.sqlite"));
 expect(()=>assertPilotIdentity(root)).toThrow(/c1_pilot_identity_unreadable_hold/);
});
it("legacy to pilot mode is a terminal live transition even if the flag is restored",async()=>{
 const {db}=await import("./db");connection=db();process.env.C1_RESEARCH_PILOT="disposable";
 expect(()=>db()).toThrow(/live_transition_hold/);
 delete process.env.C1_RESEARCH_PILOT;expect(()=>db()).toThrow(/live_transition_hold/);
 expect(()=>assertPilotIdentity(path.join(root,"another"))).toThrow(/live_transition_hold/);
});
it("a different DATA_DIR cannot select a fresh unrestricted latch",()=>{
 assertPilotIdentity(root);
 expect(()=>assertPilotIdentity(path.join(root,"another"))).toThrow(/live_transition_hold/);
 expect(()=>assertPilotIdentity(root)).toThrow(/live_transition_hold/);
});
it("database absence is not cached: a later enrolled DB is checked before use",()=>{
 assertPilotIdentity(root);
 const pilot=path.join(root,"ios-c1-pilot-later");fs.mkdirSync(path.join(pilot,"vault"),{recursive:true});
 const enrolled=spawnSync(process.execPath,["-e",`const Database=require('better-sqlite3'),h=require(process.argv[1]);const d=new Database(process.env.DATA_DIR+'/app.sqlite');h.enrollPilotIdentity(d);d.close();`,path.resolve("scripts/c1-pilot-identity.cjs")],{env:{...process.env,DATA_DIR:pilot,C1_RESEARCH_PILOT:"disposable"},encoding:"utf8"});
 expect(enrolled.status,enrolled.stderr).toBe(0);
 fs.renameSync(path.join(pilot,"app.sqlite"),path.join(root,"app.sqlite"));
 expect(()=>assertPilotIdentity(root)).toThrow(/enrolled_instance_requires_mode_hold/);
});
it("replacement or deletion of the inspected DB is a sticky HOLD",async()=>{
 const {db}=await import("./db");const d=db();connection=d;
 fs.renameSync(path.join(root,"app.sqlite"),path.join(root,"retained.sqlite"));
 expect(()=>db()).toThrow(/database_changed_hold/);
 fs.renameSync(path.join(root,"retained.sqlite"),path.join(root,"app.sqlite"));
 expect(()=>db()).toThrow(/database_changed_hold/);
});
it("a new app connection rechecks enrollment even after a negative bootstrap inspection",()=>{
 const pilot=path.join(root,"ios-c1-pilot-open-race");fs.mkdirSync(path.join(pilot,"vault"),{recursive:true});
 const legacy=new Database(path.join(root,"app.sqlite"));legacy.exec("CREATE TABLE legacy_fixture(x)");legacy.close();
 assertPilotIdentity(root); // Bootstrap's read-only connection has closed.
 const enrolled=spawnSync(process.execPath,["-e",`const Database=require('better-sqlite3'),h=require(process.argv[1]);const d=new Database(process.env.DATA_DIR+'/app.sqlite');h.enrollPilotIdentity(d);d.close();`,path.resolve("scripts/c1-pilot-identity.cjs")],{env:{...process.env,DATA_DIR:pilot,C1_RESEARCH_PILOT:"disposable"},encoding:"utf8"});
 expect(enrolled.status,enrolled.stderr).toBe(0);
 const inode=fs.statSync(path.join(root,"app.sqlite")).ino;
 fs.copyFileSync(path.join(pilot,"app.sqlite"),path.join(root,"app.sqlite"));
 expect(fs.statSync(path.join(root,"app.sqlite")).ino).toBe(inode);
 const d=new Database(path.join(root,"app.sqlite"));connection=d;
 expect(()=>assertPilotIdentity(root,undefined,undefined,d)).toThrow(/enrolled_instance_requires_mode_hold/);
});
it("an unrelated connection cannot substitute for identity inspection",()=>{
 const d=new Database(":memory:");connection=d;
 expect(()=>assertPilotIdentity(root,undefined,undefined,d)).toThrow(/connection_scope_hold/);
 expect(()=>assertPilotIdentity(root)).toThrow(/connection_scope_hold/);
});
it("initial pilot vault symlink fails isolation before app DB creation",()=>{
 const pilot=path.join(root,"ios-c1-pilot-symlink");fs.mkdirSync(pilot);
 fs.symlinkSync(path.join(root,"vault"),path.join(pilot,"vault"));process.env.C1_RESEARCH_PILOT="disposable";
 expect(()=>assertPilotIdentity(pilot)).toThrow(/disposable_isolation_required/);
 expect(fs.existsSync(path.join(pilot,"app.sqlite"))).toBe(false);
});
it("WAL-only server enrollment remains restrictive after directory rename in a fresh process",()=>{
 const pilot=path.join(root,"ios-c1-pilot-wal");fs.mkdirSync(path.join(pilot,"vault"),{recursive:true});
 process.env.DATA_DIR=pilot;process.env.C1_RESEARCH_PILOT="disposable";
 const d=new Database(path.join(pilot,"app.sqlite"));connection=d;
 d.pragma("journal_mode=WAL");d.pragma("wal_autocheckpoint=0");
 // Checkpoint the empty journal, then enroll using the real server function.
 d.exec("CREATE TABLE safe_edit_events (at TEXT NOT NULL,operation_id TEXT NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL)");
 d.pragma("wal_checkpoint(TRUNCATE)");enrollPilotIdentity(d);
 expect(fs.statSync(path.join(pilot,"app.sqlite-wal")).size).toBeGreaterThan(0);
 const mainOnly=path.join(root,"main-only.sqlite");fs.copyFileSync(path.join(pilot,"app.sqlite"),mainOnly);
 const main=new Database(mainOnly,{readonly:true});
 try{expect(main.prepare("SELECT count(*) n FROM safe_edit_events").get()).toEqual({n:0});}finally{main.close();}
 const renamed=path.join(root,"renamed-wal");fs.renameSync(pilot,renamed);
 const before=fs.readFileSync(path.join(renamed,"app.sqlite-wal"));
 const child=spawnSync(process.execPath,["-e","require(process.argv[1]).assertPilotIdentity(process.env.DATA_DIR)",path.resolve("scripts/c1-pilot-identity.cjs")],{env:{...process.env,DATA_DIR:renamed,C1_RESEARCH_PILOT:""},encoding:"utf8"});
 // Remove the variable rather than pass an invalid flag; the journal is the evidence.
 const childEnv:NodeJS.ProcessEnv={...process.env,DATA_DIR:renamed};delete childEnv.C1_RESEARCH_PILOT;
 const absent=spawnSync(process.execPath,["-e","require(process.argv[1]).assertPilotIdentity(process.env.DATA_DIR)",path.resolve("scripts/c1-pilot-identity.cjs")],{env:childEnv,encoding:"utf8"});
 expect(child.status).not.toBe(0);expect(child.stderr).toContain("invalid_mode_hold");
 expect(absent.status).not.toBe(0);expect(absent.stderr).toContain("enrolled_instance_requires_mode_hold");
 expect(fs.readFileSync(path.join(renamed,"app.sqlite-wal"))).toEqual(before);
});

import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {spawn,spawnSync} from "node:child_process";import {pathToFileURL} from "node:url";
import Database from "better-sqlite3";
let root:string;
beforeEach(()=>{delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.d1.native-interlock.v1")];delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];root=fs.mkdtempSync(path.join(os.tmpdir(),"d1-recovery-g04-"));process.env.DATA_DIR=root;vi.resetModules();});
afterEach(()=>{vi.restoreAllMocks();delete process.env.DATA_DIR;fs.rmSync(root,{recursive:true,force:true});});
function native(script:string){return spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",`const m=await import(${JSON.stringify(pathToFileURL(path.resolve("src/server/maintenance.ts")).href)});try{${script};console.log(JSON.stringify({probe:"g06e",result:"success"}));}catch(e){console.log(JSON.stringify({probe:"g06e",result:"denied",code:e.code,message:e.message}));process.exitCode=17;}`],{env:{PATH:process.env.PATH,DATA_DIR:root},encoding:"utf8",timeout:5000});}
function denied(result:ReturnType<typeof native>,code:string){
 expect(result.signal).toBeNull();expect(result.status).toBe(17);
 expect(JSON.parse(result.stdout.trim())).toMatchObject({probe:"g06e",result:"denied",code});
}
it("own child crash leaves the native interlock and blocks a fresh-process launch",()=>{
 expect(native('m.withD1NativeInterlock("business",()=>process.kill(process.pid,"SIGKILL"));').signal).toBe("SIGKILL");
 expect(fs.existsSync(path.join(root,".d1-native-launch.lock"))).toBe(true);
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_stale_witness_recovery_hold");
});
it("raw SQLite WAL process-crash control only: not D1 or power-loss proof",()=>{
 const file=path.join(root,"fixture.sqlite");
 const code=`const D=require('better-sqlite3');const d=new D(process.argv[1]);d.pragma('journal_mode=WAL');d.exec('CREATE TABLE t(v); INSERT INTO t VALUES(1); BEGIN IMMEDIATE; INSERT INTO t VALUES(2)');process.kill(process.pid,'SIGKILL');`;
 const child=spawnSync(process.execPath,["-e",code,file],{env:{PATH:process.env.PATH},timeout:5000});expect(child.signal).toBe("SIGKILL");
 expect(fs.existsSync(file+"-wal")).toBe(true);
 const reader=new Database(file,{readonly:true,fileMustExist:true});try{expect(reader.prepare("SELECT v FROM t").all()).toEqual([{v:1}]);}finally{reader.close();}
});
it("strict oracle: failed release fsync must remain restrictive after restart",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const sync=fs.fsyncSync,remove=fs.rmdirSync;let released=false,ran=false,injected=false;
 vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike,...args:unknown[])=>{(remove as any)(p,...args);if(String(p).endsWith(".d1-native-launch.lock"))released=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(released&&!injected){injected=true;throw Error("synthetic-release-fsync-EIO");}sync(fd);});
 expect(()=>withD1NativeInterlock("business",()=>{ran=true;})).toThrow("synthetic-release-fsync-EIO");expect(ran).toBe(true);expect(released).toBe(true);vi.restoreAllMocks();
 expect(()=>withD1NativeInterlock("business",()=>{})).toThrow(/recovery_hold/);
 // Current-process latch alone does not prove physical restart quarantine.
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("strict oracle: release-fsync plus physical-restoration failure cannot reopen after restart",async()=>{
 const {withD1NativeInterlock,registry}=await import("./maintenance");
 const sync=fs.fsyncSync,mkdir=fs.mkdirSync,remove=fs.rmdirSync;let released=false,creates=0,ran=false;
 vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike,...args:unknown[])=>{(remove as any)(p,...args);if(String(p).endsWith(".d1-native-launch.lock"))released=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(released)throw Error("synthetic-release-EIO");sync(fd);});
 vi.spyOn(fs,"mkdirSync").mockImplementation(((p:fs.PathLike,...args:unknown[])=>{
  if(String(p).endsWith(".d1-native-launch.lock")&&++creates>1)throw Error("synthetic-restore-EACCES");
  return (mkdir as any)(p,...args);
 }) as typeof fs.mkdirSync);
 expect(()=>withD1NativeInterlock("business",()=>{ran=true;})).toThrow("synthetic-release-EIO");
 expect(ran).toBe(true);expect(released).toBe(true);expect(registry().persistUncertain).toBe(true);vi.restoreAllMocks();
 expect(fs.existsSync(path.join(root,".d1-native-launch.lock"))).toBe(false);
 expect(fs.existsSync(path.join(root,".d1-native-outcome.pending"))).toBe(true);
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("fresh process cannot enter the release/restoration gap even before the fsync error is known",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const sync=fs.fsyncSync,remove=fs.rmdirSync;let released=false,observed:ReturnType<typeof native>|null=null;
 vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike,...args:unknown[])=>{(remove as any)(p,...args);if(String(p).endsWith(".d1-native-launch.lock"))released=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(released&&observed===null){observed=native('m.withD1NativeInterlock("business",()=>{});');throw Error("release-gap-EIO");}sync(fd);});
 expect(()=>withD1NativeInterlock("business",()=>{})).toThrow("release-gap-EIO");expect(observed).not.toBe(null);denied(observed!,"d1_native_contention");
});
it("successful native settlement permits normal successive and fresh-process operations",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");let calls=0;
 withD1NativeInterlock("business",()=>{calls++;});withD1NativeInterlock("business",()=>{calls++;});
 expect(calls).toBe(2);expect(fs.existsSync(path.join(root,".d1-native-outcome.pending"))).toBe(false);
 expect(native('m.withD1NativeInterlock("business",()=>{});').status).toBe(0);
});
it("failed witness publication precedes business effects and requires recovery",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");let calls=0;
 vi.spyOn(fs,"fsyncSync").mockImplementation(()=>{throw Error("witness-fsync-EIO");});
 expect(()=>withD1NativeInterlock("business",()=>{calls++;})).toThrow("witness-fsync-EIO");expect(calls).toBe(0);vi.restoreAllMocks();
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("cleanup failure retains the witness instead of reporting successful release",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const unlink=fs.unlinkSync;
 vi.spyOn(fs,"unlinkSync").mockImplementation(p=>{if(String(p).endsWith(".d1-native-outcome.pending"))throw Error("witness-unlink-EACCES");unlink(p);});
 expect(()=>withD1NativeInterlock("business",()=>{})).toThrow("witness-unlink-EACCES");vi.restoreAllMocks();
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("a malformed or resurrected witness alone denies a fresh process without a launch lock",()=>{
 fs.writeFileSync(path.join(root,".d1-native-outcome.pending"),"not-json");
 expect(fs.existsSync(path.join(root,".d1-native-launch.lock"))).toBe(false);
 const result=native('m.withD1NativeInterlock("business",()=>{});');
 denied(result,"d1_native_witness_integrity_hold");
});
it("crash after lock removal leaves the pre-effect witness restrictive across restart",()=>{
 const result=native('const fs=(await import("node:fs")).default;const rm=fs.rmdirSync;fs.rmdirSync=(p,...args)=>{rm(p,...args);if(String(p).endsWith(".d1-native-launch.lock"))process.kill(process.pid,"SIGKILL");};m.withD1NativeInterlock("business",()=>{});');
 expect(result.signal).toBe("SIGKILL");expect(fs.existsSync(path.join(root,".d1-native-launch.lock"))).toBe(false);
 expect(fs.existsSync(path.join(root,".d1-native-outcome.pending"))).toBe(true);
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_stale_witness_recovery_hold");
});
it("primary native error survives release failure with secondary uncertainty attached",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const sync=fs.fsyncSync,remove=fs.rmdirSync;let released=false;
 vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike,...args:unknown[])=>{(remove as any)(p,...args);if(String(p).endsWith(".d1-native-launch.lock"))released=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(released)throw Error("secondary-release");sync(fd);});
 const original=new Error("native-outcome-unknown");let caught:unknown;
 try{withD1NativeInterlock("business",()=>{throw original;});}catch(e){caught=e;}
 expect(caught).toBe(original);expect((caught as Error & {d1ReleaseError?:Error}).d1ReleaseError?.message).toBe("secondary-release");vi.restoreAllMocks();
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("another process publishes DRAINING before subsequent native business admission",()=>{
 expect(native('m.beginMaintenance();').status).toBe(0);
 const result=native('m.withD1NativeInterlock("business",()=>{throw Error("BUSINESS_CALLBACK_RAN");});');
 denied(result,"maintenance_active");expect(result.stdout).not.toContain("BUSINESS_CALLBACK_RAN");
 expect(fs.existsSync(path.join(root,".d1-native-outcome.pending"))).toBe(false);
});

it("G06E two live disposable processes: typed contention, no steal, then normal retry",async()=>{
 const module=pathToFileURL(path.resolve("src/server/maintenance.ts")).href;
 const release=path.join(root,"release-fixture");let output="";
 const child=spawn(process.execPath,["--experimental-strip-types","--input-type=module","-e",`
 const fs=(await import('node:fs')).default;const m=await import(${JSON.stringify(module)});
 m.withD1NativeInterlock('business',()=>{console.log('OWNED_READY');const until=Date.now()+4000;
 while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>until)throw Error('fixture-timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}});
 console.log('OWNED_SETTLED');`],{env:{PATH:process.env.PATH,DATA_DIR:root},stdio:["ignore","pipe","pipe"]});
 child.stdout.on("data",d=>{output+=d;});let stderr="";child.stderr.on("data",d=>{stderr+=d;});
 const done=new Promise<number|null>(resolve=>child.on("close",resolve));
 try{
  await vi.waitFor(()=>expect(output).toContain("OWNED_READY"),{timeout:2000});
  const before=fs.readFileSync(path.join(root,".d1-native-outcome.pending"));
  denied(native('m.withD1NativeInterlock("business",()=>{throw Error("UNAUTHORIZED");});'),"d1_native_contention");
  expect(fs.readFileSync(path.join(root,".d1-native-outcome.pending"))).toEqual(before);
 }finally{fs.writeFileSync(release,"release");}
 expect(await done).toBe(0);expect(stderr).not.toContain("Error:");expect(output).toContain("OWNED_SETTLED");
 expect(native('m.withD1NativeInterlock("business",()=>{});').status).toBe(0);
});
it("G06E lock without trustworthy witness is typed physical HOLD, never stolen",()=>{
 fs.mkdirSync(path.join(root,".d1-native-launch.lock"));
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_lock_recovery_hold");
 expect(fs.existsSync(path.join(root,".d1-native-launch.lock"))).toBe(true);
});
it("G06E declared COMMIT_UNKNOWN stays durable before release or receipt",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const original=Object.assign(Error("COMMIT_UNKNOWN"),{code:"COMMIT_UNKNOWN"});
 expect(()=>withD1NativeInterlock("business",()=>{throw original;},{operation:"sqlite.commit"})).toThrow(original);
 const w=JSON.parse(fs.readFileSync(path.join(root,".d1-native-outcome.pending"),"utf8"));
 expect(w).toMatchObject({version:2,operation:"sqlite.commit",phase:"outcome_unknown"});
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("G06E success then release error reports nativeCompleted and original cause, not zero",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const remove=fs.rmdirSync,sync=fs.fsyncSync;
 let released=false,injected=false;vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike)=>{remove(p);released=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(released&&!injected){injected=true;throw Error("one-release-EIO");}sync(fd);});
 let error:unknown;try{withD1NativeInterlock("business",()=>42,{operation:"fixture.effect"});}catch(e){error=e;}
 expect(error).toMatchObject({message:"one-release-EIO",d1Outcome:{nativeStarted:true,nativeCompleted:true,outcome:"unknown",operation:"fixture.effect"}});
 vi.restoreAllMocks();denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("G06E frozen primary error cannot break cleanup or conceal release quarantine",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const rm=fs.rmdirSync,sync=fs.fsyncSync;let released=false;
 vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike)=>{rm(p);released=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(released)throw Object.freeze(Error("frozen-release"));sync(fd);});
 const original=Object.freeze(Error("frozen-original"));let caught:unknown;
 try{withD1NativeInterlock("business",()=>{throw original;});}catch(e){caught=e;}
 expect(caught).toMatchObject({message:"frozen-original",cause:original,d1Outcome:{nativeStarted:true,outcome:"unknown"}});
 vi.restoreAllMocks();denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});
it("G06E records actual lock-only legacy writer incompatibility; mixed-version remains HOLD",async()=>{
 const legacy=process.env.G06E_LEGACY_MODULE;
 expect(legacy,"Supply exact frozen b1c2a416 maintenance.ts + env.ts from evidence").toBeTruthy();
 const {withD1NativeInterlock}=await import("./maintenance");
 const rm=fs.rmdirSync,mkdir=fs.mkdirSync,sync=fs.fsyncSync;let removed=false,created=0;
 vi.spyOn(fs,"rmdirSync").mockImplementation(((p:fs.PathLike)=>{rm(p);removed=true;}) as typeof fs.rmdirSync);
 vi.spyOn(fs,"fsyncSync").mockImplementation(fd=>{if(removed)throw Error("release-EIO");sync(fd);});
 vi.spyOn(fs,"mkdirSync").mockImplementation(((p:fs.PathLike,...args:unknown[])=>{
  if(String(p).endsWith(".d1-native-launch.lock")&&++created>1)throw Error("restore-EACCES");return (mkdir as any)(p,...args);
 }) as typeof fs.mkdirSync);
 expect(()=>withD1NativeInterlock("business",()=>{})).toThrow("release-EIO");vi.restoreAllMocks();
 expect(fs.existsSync(path.join(root,".d1-native-outcome.pending"))).toBe(true);
 expect(fs.existsSync(path.join(root,".d1-native-launch.lock"))).toBe(false);
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
 const old=spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",`
 const m=await import(${JSON.stringify(pathToFileURL(legacy!).href)});const fs=(await import('node:fs')).default;
 m.withD1NativeInterlock('business',()=>fs.writeFileSync(${JSON.stringify(path.join(root,"legacy-marker"))},'synthetic'));
 console.log('LEGACY_BYPASS_OBSERVED');`],{env:{PATH:process.env.PATH,DATA_DIR:root},encoding:"utf8",timeout:5000});
 expect(old.status).toBe(0);expect(old.stdout).toContain("LEGACY_BYPASS_OBSERVED");
 expect(fs.readFileSync(path.join(root,"legacy-marker"),"utf8")).toBe("synthetic");
 console.log("G06E_MIXED_VERSION_RELEASE_BLOCKER: actual b1c2a416 ignores witness-only HOLD; no compatibility GO");
});

it("G06E native EIO after an actual fixture effect retains partial outcome across restart",async()=>{
 const {withD1NativeInterlock}=await import("./maintenance");const partial=path.join(root,"partial-effect");
 const error=Object.assign(Error("synthetic-after-effect-EIO"),{code:"EIO"});let caught:unknown;
 try{withD1NativeInterlock("business",()=>{fs.writeFileSync(partial,"persisted-before-error");throw error;},{operation:"fixture.fs.write"});}catch(e){caught=e;}
 expect(caught).toBe(error);expect(caught).toMatchObject({d1Outcome:{nativeStarted:true,nativeCompleted:false,outcome:"unknown"}});
 expect(fs.readFileSync(partial,"utf8")).toBe("persisted-before-error");
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_outcome_recovery_hold");
});

it("G06E actual G05 legacy pending witness is preserved, never auto-migrated or cleared",()=>{
 const legacy=process.env.G06E_WITNESS_V1_MODULE;expect(legacy).toBeTruthy();
 const old=spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",`
 const m=await import(${JSON.stringify(pathToFileURL(legacy!).href)});m.withD1NativeInterlock('business',()=>process.kill(process.pid,'SIGKILL'));`],
 {env:{PATH:process.env.PATH,DATA_DIR:root},encoding:"utf8",timeout:5000});
 expect(old.signal).toBe("SIGKILL");const witness=path.join(root,".d1-native-outcome.pending"),before=fs.readFileSync(witness);
 expect(JSON.parse(before.toString()).version).toBe(1);
 denied(native('m.withD1NativeInterlock("business",()=>{});'),"d1_native_legacy_witness_recovery_hold");
 expect(fs.readFileSync(witness)).toEqual(before);
});

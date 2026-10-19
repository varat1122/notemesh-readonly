import {beforeEach,afterEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import Database from "better-sqlite3";
import {SnapshotWriterFence} from "./writer-fence";
import {withCoordinatedOfflineFixtureCut} from "./offline-snapshot-cut";

const railwayVars=[
  "RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID","RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME","RAILWAY_PROJECT_NAME","RAILWAY_SERVICE_NAME",
];
const lockModule=new URL("../../../scripts/backup/nm-interprocess-fixture-gate.mjs",import.meta.url).href;
let source:string,gate:string;
const lockDirectory=()=>path.join(gate,".notemesh-fixture-exclusive");
function syncStub(events:string[]) {
  let paused=false;
  return {
    get paused(){return paused;},
    async withPausedForEdit<T>(execute:()=>Promise<T>|T):Promise<T>{
      events.push("pause");
      paused=true;
      try{return await execute();}
      finally {paused=false;events.push("resume");}
    },
  };
}
async function holdSqliteWriter() {
  const program=[
    'const Database=require("better-sqlite3");',
    '(async()=>{',
    '  const {withFixtureInterprocessExclusion}=await import(process.argv[1]);',
    '  await withFixtureInterprocessExclusion(process.argv[2],"writer",async()=>{',
    '    const db=new Database(process.argv[3]);',
    '    try{',
    '      db.pragma("journal_mode = WAL");',
    '      db.exec("CREATE TABLE IF NOT EXISTS records (value TEXT)");',
    '      db.prepare("INSERT INTO records(value) VALUES(?)").run("before");',
    '      process.stdout.write("WRITER_LOCKED\\n");',
    '      await new Promise(resolve=>process.stdin.once("data",resolve));',
    '      db.prepare("INSERT INTO records(value) VALUES(?)").run("after");',
    '    }finally{db.close();}',
    '  });',
    '})().catch(error=>{process.stderr.write(String(error));process.exitCode=4;});',
  ].join("\n");
  const child=spawn(process.execPath,["-e",program,lockModule,gate,path.join(source,"app.sqlite")],{
    cwd:process.cwd(),stdio:["pipe","pipe","pipe"],
    env:{...process.env,...Object.fromEntries(railwayVars.map(k=>[k,""]))},
  });
  const stderr:string[]=[];
  child.stderr.on("data",(data:Buffer)=>stderr.push(data.toString()));
  try {
    const output=await Promise.race([
      once(child.stdout!,"data").then(([buf])=>buf.toString()),
      once(child,"exit").then(([code])=>{throw Error("writer_exited_early:"+code+stderr.join(""));}),
      new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("writer_ready_timeout")),6000)),
    ]);
    expect(output).toContain("WRITER_LOCKED");
    return child;
  }catch(error){child.kill("SIGKILL");throw error;}
}
async function endChild(child:ReturnType<typeof spawn>,crash=false){
  const exited=once(child,"exit");
  if(crash)child.kill("SIGKILL");
  else child.stdin!.write("release\n");
  const [code,signal]=await exited;
  if(crash)expect(signal).toBe("SIGKILL");
  else expect(code).toBe(0);
}

beforeEach(()=>{
  source=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-snapshot-fixture-")));
  const suffix=path.basename(source).slice("nm-dr-snapshot-fixture-".length);
  gate=path.join(os.tmpdir(),"nm-dr-ipc-fixture-"+suffix);
  fs.mkdirSync(gate,{mode:0o700});
  vi.stubEnv("DATA_DIR",source);
  for(const key of railwayVars)vi.stubEnv(key,"");
});
afterEach(()=>{
  vi.unstubAllEnvs();
  fs.rmSync(source,{recursive:true,force:true});
  fs.rmSync(gate,{recursive:true,force:true});
});

it("live second-process SQLite WAL writer blocks snapshot despite TRUE boolean",async()=>{
  const fence=new SnapshotWriterFence(),events:string[]=[],sync=syncStub(events);
  const capture=vi.fn(()=>{throw Error("capture_must_never_run");});
  const child=await holdSqliteWriter();
  try{
    expect(fs.existsSync(lockDirectory())).toBe(true);
    await expect(withCoordinatedOfflineFixtureCut({
      fence,sync,assertNoExternalWriters:()=>true,capture,
    })).rejects.toThrow("dr_ipc_gate_occupied_fail_closed");
    expect(capture).not.toHaveBeenCalled();
    expect(events).toEqual(["pause","resume"]);
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
    await endChild(child);
    expect(fs.existsSync(lockDirectory())).toBe(false);
    const accepted=await withCoordinatedOfflineFixtureCut({
      fence,sync,assertNoExternalWriters:()=>true,
      capture:()=>{
        expect(sync.paused).toBe(true);
        expect(fence.status).toEqual({frozen:true,activeWriters:0});
        expect(fs.existsSync(lockDirectory())).toBe(true);
        expect(fs.readdirSync(source)).not.toContain(".notemesh-fixture-exclusive");
        return fs.readFileSync(path.join(source,"app.sqlite")).length;
      },
    });
    expect(accepted).toBeGreaterThan(100);
    expect(fs.existsSync(lockDirectory())).toBe(false);
    const d=new Database(path.join(source,"app.sqlite"),{readonly:true});
    try{
      expect(d.prepare("SELECT value FROM records ORDER BY rowid").all())
        .toEqual([{value:"before"},{value:"after"}]);
      expect(d.pragma("integrity_check",{simple:true})).toBe("ok");
    }finally{d.close();}
  }finally{
    if(child.exitCode===null && child.signalCode===null){
      const exit=once(child,"exit");child.kill("SIGKILL");await exit.catch(()=>{});
    }
  }
});

it("crashed SQLite writer retains sticky lock; no automatic snapshot retry",async()=>{
  const child=await holdSqliteWriter();
  await endChild(child,true);
  expect(fs.existsSync(lockDirectory())).toBe(true);
  const events:string[]=[],sync=syncStub(events),capture=vi.fn();
  await expect(withCoordinatedOfflineFixtureCut({
    fence:new SnapshotWriterFence(),sync,assertNoExternalWriters:()=>true,capture,
  })).rejects.toThrow("dr_ipc_gate_occupied_fail_closed");
  expect(capture).not.toHaveBeenCalled();
  expect(fs.existsSync(lockDirectory())).toBe(true);
  expect(events).toEqual(["pause","resume"]);
});

it("missing sibling lock root refuses cut; never creates lock storage implicitly",async()=>{
  fs.rmSync(gate,{recursive:true,force:true});
  const events:string[]=[],sync=syncStub(events),capture=vi.fn();
  await expect(withCoordinatedOfflineFixtureCut({
    fence:new SnapshotWriterFence(),sync,assertNoExternalWriters:()=>true,capture,
  })).rejects.toThrow();
  expect(fs.existsSync(gate)).toBe(false);
  expect(capture).not.toHaveBeenCalled();
});

it("Railway runtime refuses BEFORE touching gate, pausing Sync or calling capture",async()=>{
  const events:string[]=[],sync=syncStub(events),capture=vi.fn();
  vi.stubEnv("RAILWAY_SERVICE_ID","synthetic-railway");
  await expect(withCoordinatedOfflineFixtureCut({
    fence:new SnapshotWriterFence(),sync,assertNoExternalWriters:()=>true,capture,
  })).rejects.toThrow("dr_offline_fixture_only_no_railway");
  expect(events).toEqual([]);
  expect(capture).not.toHaveBeenCalled();
  expect(fs.existsSync(lockDirectory())).toBe(false);
});

it("unfenced child changes source; fingerprint rejects despite sibling gate",async()=>{
  const file=path.join(source,"note.md");
  fs.writeFileSync(file,"before");
  const events:string[]=[],sync=syncStub(events);
  await expect(withCoordinatedOfflineFixtureCut({
    fence:new SnapshotWriterFence(),sync,assertNoExternalWriters:()=>true,
    capture:()=>{
      execFileSync(process.execPath,["-e",
        'require("node:fs").writeFileSync(process.argv[1],"after")',file],
        {encoding:"utf8",timeout:3000});
      return "this-must-not-be-accepted";
    },
  })).rejects.toThrow("dr_fixture_source_changed_during_cut");
  expect(fs.readFileSync(file,"utf8")).toBe("after");
  expect(events).toEqual(["pause","resume"]);
});

it("coordinated fixture creates, verifies and restores encrypted SQLite and Vault bytes",async()=>{
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-coordinated-output-"));
  const file=path.join(source,"vault","Research","fixture.md");
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,"# Synthetic isolated research fixture\n");
  const db=new Database(path.join(source,"app.sqlite"));
  try{
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE research(id INTEGER PRIMARY KEY,note TEXT)");
    db.prepare("INSERT INTO research(note) VALUES(?)").run("test only");
  }finally{db.close();}
  const cli=path.resolve("scripts/backup/nm-backup.mjs");
  const env:NodeJS.ProcessEnv={...process.env,
    NOTEMESH_BACKUP_PASSPHRASE:"coordinated-synthetic-only-password-123456789",
    ...Object.fromEntries(railwayVars.map(k=>[k,""])),
  };
  delete env.DATA_DIR;
  const execute=(args:string[])=>JSON.parse(execFileSync(process.execPath,[cli,...args],{
    env,encoding:"utf8",timeout:60_000,maxBuffer:1024*1024,
  }).trim()) as Record<string,unknown>;
  try{
    const fence=new SnapshotWriterFence(),events:string[]=[],sync=syncStub(events);
    const receipt=await withCoordinatedOfflineFixtureCut({
      fence,sync,assertNoExternalWriters:()=>true,
      capture:()=>execute(["create","--fixture-only","--kind","fixture",
        "--data-dir",source,"--out",path.join(outside,"bundle")]),
    });
    const bundle=receipt.bundle as string;
    expect(bundle).toMatch(/\.nmb$/);
    expect(execute(["verify","--bundle",bundle]).verified).toBe(true);
    const restored=path.join(outside,"restore");
    expect(execute(["restore","--bundle",bundle,"--dest",restored]).verified).toBe(true);
    expect(fs.readFileSync(path.join(restored,"vault","Research","fixture.md"),"utf8"))
      .toBe("# Synthetic isolated research fixture\n");
    expect(fs.existsSync(path.join(restored,".notemesh-fixture-exclusive"))).toBe(false);
    const verified=new Database(path.join(restored,"app.sqlite"),{readonly:true});
    try{
      expect(verified.prepare("SELECT note FROM research").all()).toEqual([{note:"test only"}]);
      expect(verified.pragma("integrity_check",{simple:true})).toBe("ok");
    }finally{verified.close();}
    expect(events).toEqual(["pause","resume"]);
    expect(fence.status).toEqual({frozen:false,activeWriters:0});
    expect(fs.existsSync(lockDirectory())).toBe(false);
  }finally{fs.rmSync(outside,{recursive:true,force:true});}
});

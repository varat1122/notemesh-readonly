import {beforeEach,afterEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const history=vi.hoisted(()=>({
  calls:0,
  finish:null as null|((result:{
    ok:boolean;stdout:string;stderr:string;combined:string;
  })=>void),
}));
vi.mock("../sync/git-exec",()=>({
  runGit:async()=>{
    history.calls++;
    return new Promise(resolve=>{history.finish=resolve;});
  },
}));

let root:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-git-refresh-")));
  fs.mkdirSync(path.join(root,"vault"),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,6).toString("base64");
  history.calls=0;history.finish=null;
  vi.resetModules();
});
afterEach(async()=>{
  const {db}=await import("../db");
  if(db().open)db().close();
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});

const gitResult=(body:string,ok=true)=>({
  ok,stdout:body,stderr:"",combined:body,
});

it("holds a Git Sync admission from async history-process start through SQLite/cache update",async()=>{
  const {db}=await import("../db");
  const {refreshGitTimes,modifiedFor}=await import("./modified");
  const {inProcessDrWriterFence:fence}=await import("../backup/writer-fence");
  db().prepare("INSERT INTO notes(path,title,mtime,size,modified,created) VALUES(?,?,?,?,?,?)")
    .run("fixture.md","Fixture",1,1,1,1);
  const run=refreshGitTimes(root);
  expect(history.calls).toBe(1);
  expect(fence.getAdmissionEvidence().activeByClass.git_sync).toBe(1);
  expect(fence.status.activeWriters).toBe(1);

  let captured=false;
  const cut=fence.withFrozenWriters(()=>{
    captured=true;
    expect(db().prepare("SELECT modified,created FROM notes WHERE path=?").get("fixture.md"))
      .toEqual({modified:1700000000000,created:1600000000000});
    expect(modifiedFor("fixture.md",1)).toBe(1700000000000);
    return "safe-after-Git-refresh";
  },{drainTimeoutMs:5000});
  expect(fence.status.frozen).toBe(true);
  expect(captured).toBe(false);
  await expect(refreshGitTimes(root)).rejects.toThrow("backup_writer_freeze_active");
  expect(history.calls).toBe(1);
  expect(history.finish).not.toBeNull();
  history.finish!(gitResult("\0"+"1700000000\nfixture.md\n\n\0"+"1600000000\nfixture.md\n"));
  await expect(run).resolves.toBe(2);
  await expect(cut).resolves.toBe("safe-after-Git-refresh");
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

it("releases the entire admission after Git history fails, without applying SQLite changes",async()=>{
  const {db}=await import("../db");
  const {refreshGitTimes}=await import("./modified");
  const {inProcessDrWriterFence:fence}=await import("../backup/writer-fence");
  db().prepare("INSERT INTO notes(path,title,mtime,size,modified,created) VALUES(?,?,?,?,?,?)")
    .run("fixture.md","Fixture",1,1,1,1);
  const pending=refreshGitTimes(root);
  expect(fence.getAdmissionEvidence().activeByClass.git_sync).toBe(1);
  history.finish!(gitResult("synthetic Git error",false));
  await expect(pending).resolves.toBeNull();
  expect(fence.getAdmissionEvidence().activeByClass).toEqual({});
  await expect(fence.withFrozenWriters(()=>db().prepare("SELECT modified,created FROM notes WHERE path='fixture.md'").get()))
    .resolves.toEqual({modified:1,created:1});
});

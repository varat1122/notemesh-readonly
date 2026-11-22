import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {execFileSync} from "node:child_process";
let root:string;
beforeEach(()=>{delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];root=fs.mkdtempSync(path.join(os.tmpdir(),"d1-git-g04-"));process.env.DATA_DIR=root;vi.resetModules();});
afterEach(()=>{delete process.env.DATA_DIR;fs.rmSync(root,{recursive:true,force:true});});
function git(...args:string[]){return execFileSync("git",args,{cwd:root,env:{PATH:process.env.PATH,HOME:root,GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"},encoding:"utf8"}).trim();}
async function api(){return import("./git-exec");}
it("normal actual git launch and binary readback preserve every byte",async()=>{
 git("init","-q");const bytes=Buffer.from([0,255,13,10,128,0,10]);fs.writeFileSync(path.join(root,"blob"),bytes);
 const oid=git("hash-object","-w","blob");const {runGit,runGitBuffer}=await api();
 expect((await runGit(["--version"],{cwd:root})).ok).toBe(true);
 const r=await runGitBuffer(["cat-file","blob",oid],{cwd:root});expect(r.ok).toBe(true);expect(r.stdout).toEqual(bytes);
 const {pendingWork}=await import("../maintenance");expect(pendingWork().count).toBe(0);
});
it("normal missing ref and blob probes keep their exit status without fencing the next write",async()=>{
 git("init","-q");const {runGit,runGitBuffer}=await api();
 const missing=await runGit(["rev-parse","--verify","absent-ref"],{cwd:root});
 expect(missing).toMatchObject({ok:false,code:128,outcome:"child_exited"});
 expect(missing.stderr).toContain("fatal");
 const blob=await runGitBuffer(["show","HEAD:absent"],{cwd:root});
 expect(blob).toMatchObject({ok:false,outcome:"child_exited"});
 const {maintenanceActive,pendingWork}=await import("../maintenance");
 expect(maintenanceActive()).toBe(false);expect(pendingWork().count).toBe(0);
 expect(fs.existsSync(path.join(root,"maintenance.json"))).toBe(false);
 expect((await runGit(["config","user.name","Synthetic"],{cwd:root})).ok).toBe(true);
 expect(git("config","user.name")).toBe("Synthetic");
});
it("an unclassified nonzero alias retains unknown mutation and writer evidence",async()=>{
 const {runGit}=await api();
 const result=await runGit(["-c","alias.fixture=!printf partial > partial-business; exit 1","fixture"],{cwd:root});
 expect(result).toMatchObject({ok:false,outcome:"partial_or_unknown"});
 expect(fs.readFileSync(path.join(root,"partial-business"),"utf8")).toBe("partial");
 expect(fs.existsSync(path.join(root,"maintenance.json"))).toBe(true);
 expect(fs.readdirSync(path.join(root,"maintenance-writers")).some(n=>n.startsWith("writer."))).toBe(true);
 expect((await runGit(["--version"],{cwd:root})).ok).toBe(false);
});
it("both text and binary launch paths refuse a durable DRAINING barrier",async()=>{
 const {beginMaintenance}=await import("../maintenance");beginMaintenance();const {runGit,runGitBuffer}=await api();
 const args=["-c","alias.fixture=!touch should-not-exist","fixture"];
 expect((await runGit(args,{cwd:root})).ok).toBe(false);expect((await runGitBuffer(args,{cwd:root})).ok).toBe(false);
 expect(fs.existsSync(path.join(root,"should-not-exist"))).toBe(false);
});
it("timeout retains uncertain effects and durable writer evidence rather than claiming zero",async()=>{
 const {runGit}=await api();const r=await runGit(["-c","alias.fixture=!touch started; sleep 2","fixture"],{cwd:root,timeoutMs:100});
 expect(r.ok).toBe(false);expect(r.outcome).toBe("partial_or_unknown");
 expect(fs.existsSync(path.join(root,"maintenance.json"))).toBe(true);
 expect(fs.readdirSync(path.join(root,"maintenance-writers")).some(n=>n.startsWith("writer."))).toBe(true);
});
it("strict oracle: a pre-launched Git child cannot write a business file after DRAINING",async()=>{
 const {runGit}=await api();const {beginMaintenance}=await import("../maintenance");
 const pending=runGit(["-c","alias.fixture=!touch started; while test ! -f release; do sleep 0.01; done; printf late > late-business","fixture"],{cwd:root,timeoutMs:2000});
 for(let i=0;i<100&&!fs.existsSync(path.join(root,"started"));i++)await new Promise(r=>setTimeout(r,10));
 expect(fs.existsSync(path.join(root,"started"))).toBe(true);beginMaintenance();fs.writeFileSync(path.join(root,"release"),"");
 const result=await pending;expect(result.ok).toBe(false);
 // This is a contract assertion, not a demonstration relabelled PASS.
 expect(fs.existsSync(path.join(root,"late-business"))).toBe(false);
});
it("strict oracle: root exit cannot release a still-running descendant as settled",async()=>{
 const {runGit}=await api();const {beginMaintenance}=await import("../maintenance");
 // Benign local descendant closes inherited output; no network or real data.
 const r=await runGit(["-c","alias.fixture=!(sleep 0.2; printf late > descendant-business) >/dev/null 2>&1 &","fixture"],{cwd:root,timeoutMs:2000});
 beginMaintenance();await new Promise(resolve=>setTimeout(resolve,400));
 expect({apiSuccess:r.ok,lateBusiness:fs.existsSync(path.join(root,"descendant-business"))}).not.toEqual({apiSuccess:true,lateBusiness:true});
});

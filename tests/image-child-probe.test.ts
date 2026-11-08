import {it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {parse} from "yaml";

// Execute the actual CI child-enumeration shell against a disposable proc-shaped
// fixture. A final non-child must not fail enumeration; absent node still fails
// the unchanged explicit child assertion. No real container/process mutation.
it.each([true,false])("image CI enumeration: direct Node child present=%s",present=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"image-child-probe-"));
  try{
    for(const [pid,ppid,cmd] of [["1",0,"tini"],["2",present?1:7,"node .output/server/index.mjs"],["9",2,"sh probe"]] as const){
      fs.mkdirSync(path.join(root,pid));fs.writeFileSync(path.join(root,pid,"status"),`PPid:\t${ppid}\n`);
      fs.writeFileSync(path.join(root,pid,"cmdline"),cmd.replaceAll(" ","\0")+"\0");
    }
    const workflow=parse(fs.readFileSync(".github/workflows/ci.yml","utf8"));
    const run=workflow.jobs.image.steps.find((s:{name?:string})=>s.name==="tini is PID 1 and node is its child").run as string;
    expect(run).toContain('test "$pid1" = "tini"');expect(run).toContain('echo "$children" | grep -q "^node "');
    const command=/children=\$\(docker exec nm sh -c '([^']+)'\)/.exec(run)![1].replaceAll("/proc/","./");
    const scan=spawnSync("sh",["-c",command],{cwd:root,encoding:"utf8"});expect(scan.status).toBe(0);
    const assertion=spawnSync("grep",["-q","^node "],{input:scan.stdout,encoding:"utf8"});
    expect(assertion.status).toBe(present?0:1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

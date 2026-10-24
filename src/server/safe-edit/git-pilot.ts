/** Single-note staging pilot. No general Git writer or automatic recovery. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { env } from "../env";
import { gitBackend } from "../sync/git";
import { runGit, runGitBuffer } from "../sync/git-exec";
import { inProcessDrWriterFence } from "../backup/writer-fence";
import { apply, preview, status, recordGitPilot, gitPilotContext, sha256 } from "./engine";
import { applySchema, previewSchema } from "./schema";

import { assertGitPilot, note, remote } from "./git-pilot-policy";
export async function git(...args:string[]) {
  const r=await runGit(["-c","core.hooksPath=/dev/null","-c","commit.gpgSign=false","-c","http.followRedirects=false",...args],{authenticated:true});
  if(!r.ok) throw Error("Git pilot command failed; manual review required");
  return r.stdout.trim();
}
export async function remoteHead() {
  const out=await git("ls-remote","--refs",remote,"refs/heads/main");
  if(!/^[a-f0-9]{40}\s+refs\/heads\/main$/.test(out)) throw Error("Unexpected remote HEAD");
  return out.split(/\s/)[0];
}
export async function cleanBase(paths:string[]=[note],requireNew=true) {
  if(await git("status","--porcelain","--untracked-files=all")) throw Error("Dirty Git worktree/index");
  if(await git("symbolic-ref","--short","HEAD")!=="main" ||
    await git("rev-parse","--show-toplevel")!==env.vaultDir ||
    await git("rev-parse","--absolute-git-dir")!==path.join(env.vaultDir,".git") ||
    await git("remote","get-url","origin")!==remote ||
    await git("remote","get-url","--push","origin")!==remote)
    throw Error("Git repository scope refused");
  const base=await git("rev-parse","HEAD");
  if(base!==await remoteHead()) throw Error("Stale remote HEAD");
  if(requireNew&&paths.some(p=>fs.existsSync(path.join(env.vaultDir,p)))) throw Error("Pilot note already exists");
  // Reject configured transformations rather than trusting rewritten bytes.
  const attrs=await git("check-attr","filter","text","working-tree-encoding","--",...paths);
  if(attrs.split("\n").some(line=>!line.endsWith(": unspecified"))) throw Error("Git attributes require manual review");
  return base;
}
export async function exclusive<T>(run:()=>Promise<T>) {
  assertGitPilot();
  return inProcessDrWriterFence.withWrite(async()=>{
    const hold=path.join(env.dataDir,"git-pilot-hold");
    if(!fs.existsSync(hold)) {
      fs.mkdirSync(hold,{mode:0o700});
      const parent=fs.openSync(env.dataDir,"r");try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
    }
    if(fs.lstatSync(hold).isSymbolicLink()) throw Error("Unsafe Git hold directory");
    // Deliberately never auto-remove stale locks after a crash.
    const lock=path.join(hold,"transaction.lock");
    fs.mkdirSync(lock,{mode:0o700});
    const d=fs.openSync(hold,"r");try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
    try {
      await gitBackend().holdForPilot();
      assertGitPilot();
      return await run();
    } finally {fs.rmdirSync(lock);}
  },"protected_safe_edits");
}
export async function previewGitPilot(input:unknown,actor:string) {
  const p=previewSchema.parse(input);
  if(p.path!==note||p.change.kind!=="create") throw Error("Only the approved pilot create is permitted");
  return exclusive(async()=>{
    const base=await cleanBase();
    const result=gitPilotContext.run({base},()=>preview(p,actor));
    const old=status(result.operationId,actor).receipt?.gitPilot;
    if(old && old.base!==base) throw Error("Preview base changed; manual review required");
    recordGitPilot(result.operationId,actor,{base,state:"preview",remote,branch:"main"});
    return {...result,gitBase:base};
  });
}
export async function applyGitPilot(input:unknown,actor:string) {
  const args=applySchema.parse(input);
  return exclusive(async()=>{
    const old=status(args.operationId,actor),binding=old.receipt?.gitPilot;
    if(old.path!==note || !binding?.base) throw Error("Missing Git preview binding");
    // No writes, commits or pushes on replay, including unknown outcomes.
    if(binding.state!=="preview") {
      // Preserve the original token/hash checks even for a terminal replay.
      if(old.status==="written") gitPilotContext.run({base:binding.base},()=>apply(args,actor));
      return {...old,manualReviewRequired:binding.state!=="verified"};
    }
    const base=await cleanBase();
    if(base!==binding.base) throw Error("Approved remote HEAD changed");
    // Validate ownership/token/hash/approval inside the original engine before
    // starting any Git write. Engine persists its own interrupted write stages.
    let started=false;
    try {
      const local=gitPilotContext.run({base},()=>apply(args,actor));
      started=true;
      recordGitPilot(args.operationId,actor,{state:"local_written"});
      if(local.receipt?.readback!=="verified" || local.receipt?.reindex!=="verified") throw Error("Local readback incomplete");
      const bytes=fs.readFileSync(path.join(env.vaultDir,note));
      if(sha256(bytes)!==local.afterHash) throw Error("Local content changed");
      await commitApprovedEdits(base,args.operationId,[{path:note,kind:"A",afterHash:local.afterHash}],
        detail=>recordGitPilot(args.operationId,actor,detail));
      return status(args.operationId,actor);
    } catch(e) {
      // Never overwrite push_unknown/pushed evidence or undo committed files.
      const current=status(args.operationId,actor);
      if(started && current.receipt?.gitPilot?.state==="local_written")
        recordGitPilot(args.operationId,actor,{state:"partial_hold"});
      throw e;
    }
  });
}

/** Internal Git transaction shared by the fixed pilot and owner-reviewed M4. */
export async function commitApprovedEdits(base:string,operationId:string,
  edits:{path:string;kind:"A"|"M";afterHash:string}[],record:(d:Record<string,unknown>)=>void) {
  if(edits.length<1||edits.length>2||new Set(edits.map(e=>e.path)).size!==edits.length) throw Error("Invalid Git edit scope");
  const changed=(await git("status","--porcelain","-z","--untracked-files=all")).split("\0").filter(Boolean).map(s=>s.trimStart()).sort();
  const expected=edits.map(e=>(e.kind==="A"?"??":"M")+" "+e.path).sort();
  if(JSON.stringify(changed)!==JSON.stringify(expected)) throw Error("Unexpected commit scope");
  await git("add","--",...edits.map(e=>e.path));
  const scope=(await git("diff","--cached","--name-status","-z","--no-renames")).split("\0").filter(Boolean);
  const tuples=edits.flatMap(e=>[e.kind,e.path]);
  const pairs=(a:string[])=>{const p=[];for(let n=0;n<a.length;n+=2)p.push(a[n]+"\0"+a[n+1]);return p.sort();};
  if(JSON.stringify(pairs(scope))!==JSON.stringify(pairs(tuples))) throw Error("Unexpected staged scope");
  for(const e of edits){
    const blob=await runGitBuffer(["show",`:${e.path}`]);
    if(!blob.ok||sha256(blob.stdout)!==e.afterHash) throw Error("Staged blob hash mismatch");
  }
  await git("-c","user.name=notemesh","-c","user.email=notemesh@localhost","commit","-m",`owner-reviewed: ${operationId}`);
  const commit=await git("rev-parse","HEAD");
  const committed=(await git("diff-tree","--no-commit-id","--name-status","-z","-r","--no-renames","HEAD")).split("\0").filter(Boolean);
  if(await git("rev-parse","HEAD^")!==base||JSON.stringify(pairs(committed))!==JSON.stringify(pairs(tuples))||await git("status","--porcelain")) throw Error("Commit verification failed");
  record({state:"push_unknown",commit});
      if(!/^[a-f0-9]{40}$/.test(base)||!/^[a-f0-9]{40}$/.test(commit)) throw Error("Invalid Git OID");
      const hooks=fs.mkdtempSync(path.join(os.tmpdir(),"notemesh-pilot-push-"));
      try {
        fs.writeFileSync(path.join(hooks,"pre-push"),`#!/bin/sh
IFS=' ' read -r local_ref local_sha remote_ref remote_sha || exit 1
[ "$local_sha" = "${commit}" ] && [ "$remote_ref" = "refs/heads/main" ] && [ "$remote_sha" = "${base}" ] || exit 1
if IFS=' ' read -r extra; then exit 1; fi
exit 0
`,{mode:0o700,flag:"wx"});
        await git("-c",`core.hooksPath=${hooks}`,"push","--porcelain",remote,`${commit}:refs/heads/main`);
      } finally {fs.rmSync(hooks,{recursive:true,force:true});}
  record({state:"pushed",commit});
  if(await remoteHead()!==commit) throw Error("Remote ref changed");
  await git("fetch","--no-tags",remote,"refs/heads/main");
  if(await git("rev-parse","FETCH_HEAD")!==commit) throw Error("Remote fetch mismatch");
  for(const e of edits){
    const blob=await runGitBuffer(["show",`FETCH_HEAD:${e.path}`]);
    if(!blob.ok||sha256(blob.stdout)!==e.afterHash||sha256(fs.readFileSync(path.join(env.vaultDir,e.path)))!==e.afterHash) throw Error("Remote/physical readback hash mismatch");
  }
  record({state:"verified",commit,remoteHashes:Object.fromEntries(edits.map(e=>[e.path,e.afterHash])),...(edits.length===1?{remoteSha256:edits[0].afterHash}:{})});
  return commit;
}

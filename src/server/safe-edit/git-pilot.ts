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
async function git(...args:string[]) {
  const r=await runGit(["-c","core.hooksPath=/dev/null","-c","commit.gpgSign=false","-c","http.followRedirects=false",...args],{authenticated:true});
  if(!r.ok) throw Error("Git pilot command failed; manual review required");
  return r.stdout.trim();
}
async function remoteHead() {
  const out=await git("ls-remote","--refs",remote,"refs/heads/main");
  if(!/^[a-f0-9]{40}\s+refs\/heads\/main$/.test(out)) throw Error("Unexpected remote HEAD");
  return out.split(/\s/)[0];
}
async function cleanBase() {
  if(await git("status","--porcelain","--untracked-files=all")) throw Error("Dirty Git worktree/index");
  if(await git("symbolic-ref","--short","HEAD")!=="main" ||
    await git("rev-parse","--show-toplevel")!==env.vaultDir ||
    await git("rev-parse","--absolute-git-dir")!==path.join(env.vaultDir,".git") ||
    await git("remote","get-url","origin")!==remote ||
    await git("remote","get-url","--push","origin")!==remote)
    throw Error("Git repository scope refused");
  const base=await git("rev-parse","HEAD");
  if(base!==await remoteHead()) throw Error("Stale remote HEAD");
  if(fs.existsSync(path.join(env.vaultDir,note))) throw Error("Pilot note already exists");
  // Reject configured transformations rather than trusting rewritten bytes.
  const attrs=await git("check-attr","filter","text","working-tree-encoding","--",note);
  if(attrs.split("\n").some(line=>!line.endsWith(": unspecified"))) throw Error("Git attributes require manual review");
  return base;
}
async function exclusive<T>(run:()=>Promise<T>) {
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
      // All other changes, including staged modifications, are refused.
      const changed=await git("status","--porcelain","--untracked-files=all");
      if(changed!==`?? ${note}`) throw Error("Unexpected commit scope");
      await git("add","--",note);
      const staged=await git("diff","--cached","--name-status","--no-renames");
      if(staged!==`A\t${note}`) throw Error("Unexpected staged scope");
      const blob=await runGitBuffer(["show",`:${note}`]);
      if(!blob.ok || sha256(blob.stdout)!==local.afterHash) throw Error("Staged blob hash mismatch");
      await git("-c","user.name=notemesh","-c","user.email=notemesh@localhost","commit","-m",`pilot-001: ${args.operationId}`);
      const commit=await git("rev-parse","HEAD");
      if(await git("rev-parse","HEAD^")!==base ||
        await git("diff-tree","--no-commit-id","--name-status","-r","--no-renames","HEAD")!==`A\t${note}` ||
        await git("status","--porcelain","--untracked-files=all")) throw Error("Commit verification failed");
      recordGitPilot(args.operationId,actor,{state:"push_unknown",commit});
      // A timeout may mean the server accepted the push. Never retry it here.
      // A private trusted pre-push hook binds the advertised old OID. Git's
      // receive-pack then CAS-checks that OID at update time. No force/lease
      // option, repo-supplied hooks or remote rewind race is accepted.
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
      recordGitPilot(args.operationId,actor,{state:"pushed",commit});
      if(await remoteHead()!==commit) throw Error("Remote ref changed");
      await git("fetch","--no-tags",remote,"refs/heads/main");
      if(await git("rev-parse","FETCH_HEAD")!==commit) throw Error("Remote fetch mismatch");
      const readback=await runGitBuffer(["show",`FETCH_HEAD:${note}`]);
      if(!readback.ok || sha256(readback.stdout)!==local.afterHash ||
        sha256(fs.readFileSync(path.join(env.vaultDir,note)))!==local.afterHash)
        throw Error("Remote/physical readback hash mismatch");
      recordGitPilot(args.operationId,actor,{state:"verified",commit,remoteSha256:local.afterHash});
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

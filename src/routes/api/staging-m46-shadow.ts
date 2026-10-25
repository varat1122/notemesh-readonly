/** Authenticated owner-only READ-ONLY staging M4.6 exact package inspection.
 * GET doesn't preview, journal, approve, write, Git push or change any flags.
 * POST always refuses, including after someone enables any M4 writer flags.
 */
import type {APIEvent} from "@solidjs/start/server";
import {owner,html,denied,escapeHtml as esc} from "./staging-git-pilot";
import {assertGitPilot} from "~/server/safe-edit/git-pilot-policy";
import {M46_FILES,M46_MANIFEST,M46_MANIFEST_SHA256,M46_ROOT,M46_SOURCE} from "~/server/safe-edit/m46-staging-package";

export async function GET({request}:APIEvent){
  const session=await owner(request);
  if(!session)return denied("Sign in as staging owner before inspecting M4.6.",401);
  try{assertGitPilot();}catch{return denied("Not isolated Staging Git pilot scope.",403);}
  const packageHtml=M46_FILES.map((f,i)=>
    '<details><summary>'+esc(f.role)+' — '+esc(f.path)+'</summary><pre>'+
    esc(f.content)+'</pre></details><p>SHA-256: <code>'+esc(M46_MANIFEST[i].sha256)+'</code></p>').join("");
  return html('<h1>M4.6 NVDA real-news shadow — READ ONLY</h1>'+
    '<p><b>NO WRITE:</b> This screen never prepares a Safe Edit token, approves changes, creates files, Git-commits, or touches the live Investment_OS Vault. Existing Staging Safe Edit pilot remains restricted.</p>'+
    '<p>Source is NVIDIA Newsroom; announcement 2026-10-21. This is a proposed four-file Staging Test Vault fixture, NOT a live Investment OS update.</p>'+
    '<p>Owner approvals and new separately guarded Git transaction code are still required before any M4.6 write can be enabled.</p>'+
    '<p>Original issuer URL: '+esc(M46_SOURCE)+'</p>'+
    '<p>Operation root: '+esc(M46_ROOT)+'; manifest SHA-256 <code>'+esc(M46_MANIFEST_SHA256)+'</code></p>'+
    '<p>Target count: '+M46_FILES.length+'. All destination paths are ONLY in Staging Test Vault; this route offers no Apply button.</p>'+
    packageHtml);
}
export async function POST(_event:APIEvent){
  return denied("M4.6 shadow route is read-only. No write endpoint exists.",405);
}

/** Staging NVDA shadow owner screen. Read-only by default. Preview and Apply
 * exist ONLY under a separate M4.6 flag + existing M4 timed writer gates.
 */
import type {APIEvent} from "@solidjs/start/server";
import {owner,html,denied,escapeHtml as esc,smallForm} from "./staging-git-pilot";
import {env} from "~/server/env";
import {assertGitPilot} from "~/server/safe-edit/git-pilot-policy";
import {M46_FILES,M46_MANIFEST,M46_MANIFEST_SHA256,M46_ROOT,M46_SOURCE} from "~/server/safe-edit/m46-staging-package";
import {assertOwnerM46,previewOwnerM46,ownerM46Status,applyOwnerM46,M46_NOTE_ID,M46_NOTE_PATH} from "~/server/safe-edit/owner-m46";
const actor=(id:string)=>"staging-owner-research:"+id;
function review(token:string,prev:ReturnType<typeof ownerM46Status>){
 const p=prev.preview,eligible=p.approved&&p.status==="preview"&&Date.parse(p.expiresAt)>Date.now();
 const hidden='<input type="hidden" name="operationId" value="'+esc(M46_NOTE_ID)+'">'+
   '<input type="hidden" name="previewToken" value="'+esc(token)+'">'+
   '<input type="hidden" name="expectedHash" value="'+esc(prev.record.beforeHash)+'">';
 return html('<h1>M4.6 STAGING — Review exactly ONE NVDA Research Draft</h1>'+
   '<p><b>Action 1:</b> Open the approval page and inspect the entire exact diff. This note is Staging-only, never a Production Thesis update.</p>'+
   '<p><a href="'+esc(p.approvalUrl)+'" target="_blank" rel="noopener noreferrer">Approve exact SHA-256 '+esc(p.afterHash)+'</a></p>'+
   '<p>Approved: '+(eligible?'YES':'NOT YET')+'</p>'+
   '<form method="post">'+hidden+'<button name="action" value="check">Check human approval — no write</button></form>'+
   (eligible?'<form method="post">'+hidden+'<button name="action" value="apply">Apply exactly one Staging note ONCE</button></form>':'')+
   '<details><summary>Hash and complete diff</summary><pre>'+esc(JSON.stringify(p,null,2))+'</pre></details>'+
   '<p>After any Apply error stop and inspect remote Git + journal; never retry.</p>');
}
export async function GET({request}:APIEvent){
 const session=await owner(request);
 if(!session)return denied("Sign in as staging owner before inspecting M4.6.",401);
 try{assertGitPilot();}catch{return denied("Not isolated Staging Git pilot scope.",403);}
 const readOnly=M46_FILES.map((f,i)=>
  '<details><summary>'+esc(f.role)+' — '+esc(f.path)+'</summary><pre>'+
  esc(f.content)+'</pre></details><p>SHA-256: <code>'+esc(M46_MANIFEST[i].sha256)+'</code></p>').join("");
 let writerPanel='<p><b>Writer disabled:</b> review only. No Safe Edit journal or Vault file created by GET.</p>';
 try{
  assertOwnerM46();
  writerPanel='<p><b>One-note M4.6 Safe Edit is enabled within a limited Staging time window.</b> Human owner SHA-256 approval required; only '+esc(M46_NOTE_PATH)+' may be created.</p>'+
   '<form method="post"><button name="action" value="preview">Preview one fixed NVDA research note (no Vault write)</button></form>';
 }catch{/* Leave fail-closed read-only panel. */}
 return html('<h1>M4.6 NVDA real-news shadow — read-only report + optional owner gate</h1>'+
   '<p><b>NO AUTOMATIC WRITE:</b> this GET only reads a fixed SHA-bound package.</p>'+
   '<p>Public NVIDIA issuer announcement 2026-10-21. This is a four-file proposed fixture, NOT live Investment_OS data.</p>'+
   '<p>Issuer source: '+esc(M46_SOURCE)+'</p>'+
   '<p>Proposed manifest '+esc(M46_ROOT)+': '+esc(M46_MANIFEST_SHA256)+'</p>'+
   writerPanel+readOnly);
}
export async function POST({request}:APIEvent){
 if(request.headers.get("origin")!==env.baseUrl)return denied("Forbidden origin",403);
 const session=await owner(request);
 if(!session)return denied("Sign in to the staging owner dashboard.",401);
 try{assertOwnerM46();}catch{return denied("M4.6 writer is disabled or outside Staging window.",403);}
 let form:URLSearchParams;
 try{form=await smallForm(request,2048);}catch{return denied("Invalid M4.6 form",400);}
 const action=form.get("action")||"";
 if(!["preview","check","apply"].includes(action))return denied("Unknown action",400);
 const allowed=action==="preview"?["action"]:["action","operationId","previewToken","expectedHash"];
 if([...form.keys()].some(k=>!allowed.includes(k))||[...form.keys()].length!==new Set(form.keys()).size ||
    (action!=="preview"&&form.get("operationId")!==M46_NOTE_ID))return denied("Invalid exact M4.6 scope",400);
 try{
  const a=actor(session.user.id);
  if(action==="preview"){
   const x=await previewOwnerM46(a);
   return review(x.preview.previewToken!,ownerM46Status(a));
  }
  const p=ownerM46Status(a);
  if(action==="check")return review(form.get("previewToken")??"",p);
  const result=await applyOwnerM46({operationId:M46_NOTE_ID,previewToken:form.get("previewToken")||"",expectedHash:form.get("expectedHash")||""},a);
  if(result.status!=="m46_single_note_staging_git_fts_verified")
    return denied("Operation previously attempted; inspect receipts and Git. No replay.",409);
  return html('<h1>M4.6 Staging writeback verified</h1><pre>'+esc(JSON.stringify(result,null,2))+'</pre><p>Production/Device Sync remain unverified and untouched.</p>');
 }catch{return denied("Review/Apply refused. Inspect receipts and Git; never automatically retry.",409);}
}

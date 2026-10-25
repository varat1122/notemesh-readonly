/** Human-operated authenticated M4 transport. Never invoked by an MCP tool. */
import type {APIEvent} from "@solidjs/start/server";
import {env} from "~/server/env";
import {BOOTSTRAP_FIXTURES,BOOTSTRAP_ROOT} from "~/server/safe-edit/synthetic-bootstrap-fixtures";
import {assertOwnerBootstrap,previewOwnerBootstrap,ownerBootstrapStatus,applyOwnerBootstrap,verifiedBootstrapResearchPackage} from "~/server/safe-edit/owner-bootstrap";
import {assertOwnerResearch,previewOwnerResearch,ownerResearchStatus,applyOwnerResearch} from "~/server/safe-edit/owner-research";
import {owner,smallForm,escapeHtml as esc,html,denied} from "./staging-git-pilot";

function review(root:string,tokens:string[],state:{previews:ReturnType<typeof ownerResearchStatus>["previews"];reviewHash:string;context?:unknown;anchors?:unknown},context?:unknown,bootstrap=false){
  const eligible=state.previews.every(p=>p.approved&&p.status==="preview"&&Date.parse(p.expiresAt)>Date.now());
  const hidden='<input type="hidden" name="operationRoot" value="'+esc(root)+'">'+tokens.map((t,n)=>'<input type="hidden" name="token'+n+'" value="'+esc(t)+'">').join("");
  const prefix=bootstrap?"bootstrap-":"";
  return html('<h1>'+(bootstrap?"M4 TEST — Review 4 files":"Investment Research — Owner Review")+'</h1>'+
    '<p><b>STEP 1 — Approve each file below:</b> Open each link, read the complete change and press Approve on that page. Return to THIS tab after each approval. Do not close or refresh this tab.</p>'+
    '<ol>'+state.previews.map(p=>'<li><a target="_blank" rel="noopener noreferrer" href="'+esc(p.approvalUrl)+'">Review / Approve '+esc(p.path)+'</a> — '+(p.approved?'Approved':'Not approved')+'</li>').join("")+'</ol>'+
    '<p><b>STEP 2 — Check approvals</b> (this does not write files).</p>'+
    '<p>Approval status: <b>'+(eligible?'ALL FOUR APPROVED':'NOT COMPLETE')+'</b></p>'+
    '<form method="post">'+hidden+'<button name="action" value="'+prefix+'check">Check four approvals (safe)</button></form>'+
    (eligible?'<p><b>STEP 3 — Write approved synthetic test files once.</b></p><form method="post">'+hidden+'<button name="action" value="'+prefix+'apply">Apply approved synthetic test ONCE</button></form>':'')+
    '<details><summary>Show complete preview, hashes and audit details</summary><pre>'+esc(JSON.stringify({reviewHash:state.reviewHash,previews:state.previews,context:context??state.context,anchors:state.anchors},null,2))+'</pre></details>'+
    '<p>If there is any error, stop and inspect read-only receipts. Never retry Apply without checking Git.</p>');
}
export async function GET({request}:APIEvent){
  const session=await owner(request);if(!session)return denied("Sign in to the staging owner dashboard.",401);
  try{
    assertOwnerResearch();
    const query=new URL(request.url).searchParams;
    if(query.get("bootstrap")==="1")return html('<h1>Synthetic bootstrap receipts — read only</h1><pre>'+esc(JSON.stringify(ownerBootstrapStatus("staging-owner-research:"+session.user.id),null,2))+'</pre>');
    const root=query.get("operationRoot");
    if(root)return html('<h1>Research operation receipt — read only</h1><pre>'+esc(JSON.stringify(ownerResearchStatus(root,"staging-owner-research:"+session.user.id),null,2))+'</pre>');
    let testPanel='';
    if(process.env.GIT_RESEARCH_BOOTSTRAP_M4==="1"){
      try{
        const s=ownerBootstrapStatus("staging-owner-research:"+session.user.id);
        if(s.records.every(r=>r.status==="written"&&r.receipt?.gitPilot?.state==="bootstrap_verified"&&!r.receipt?.gitPilot?.manualReviewRequired))
          testPanel='<section><h2>M4 TEST — Step 2: Analysis A + Timeline</h2><p>Bootstrap passed. This preview is generated from the verified fixed synthetic Source A; it creates no notes and requires TWO separate exact-hash approvals.</p><form method="post"><button name="action" value="synthetic-research-preview">Preview Synthetic Analysis A (no write)</button></form><p>Only click once. Keep the preview page open, approve the two diffs, Check and Apply once.</p></section>';
      }catch{/* No verified bootstrap for this owner; never infer approval. */}
    }
    return html('<h1>M4 Staging Test</h1>'+testPanel+
      '<details><summary>Advanced: import a separate review package</summary><p>Import previews only; it never approves or writes.</p><form method="post"><textarea name="package" rows="24" cols="100" maxlength="120000" required></textarea><button name="action" value="import">Import and preview</button></form></details>'+
      (process.env.GIT_RESEARCH_BOOTSTRAP_M4==="1"&&!testPanel?'<p>Fixed synthetic bootstrap must be completed before Analysis A. The previous bootstrap is not automatically retried.</p>':''));
  }catch{return denied("Research review disabled, unavailable or outside staging scope.",403);}
}
export async function POST({request}:APIEvent){
  if(request.headers.get("origin")!==env.baseUrl)return denied("Forbidden origin",403);
  const session=await owner(request);if(!session)return denied("Sign in to the staging owner dashboard.",401);
  try{assertOwnerResearch();}catch{return denied("Research review disabled or outside staging scope.",403);}
  let form:URLSearchParams;
  try{form=await smallForm(request,512000);}catch{return denied("Invalid or oversized review form",400);}
  const actor="staging-owner-research:"+session.user.id;
  const action=form.get("action")??"";
  if(action.startsWith("bootstrap-")){
    try{assertOwnerBootstrap();}catch{return denied("Synthetic bootstrap disabled or outside staging scope.",403);}
    if(!["bootstrap-preview","bootstrap-check","bootstrap-apply"].includes(action))return denied("Unknown bootstrap action",400);
    const allowed=action==="bootstrap-preview"?["action"]:["action","operationRoot",...BOOTSTRAP_FIXTURES.map((_,n)=>"token"+n)];
    if([...form.keys()].some(k=>!allowed.includes(k))||new Set(form.keys()).size!==[...form.keys()].length||
      (action!=="bootstrap-preview"&&form.get("operationRoot")!==BOOTSTRAP_ROOT))return denied("Invalid fixed bootstrap scope",400);
  }
  try{
    if(action==="bootstrap-preview"){
      const p=await previewOwnerBootstrap(actor),state=ownerBootstrapStatus(actor);
      return review(BOOTSTRAP_ROOT,p.previews.map(p=>p.previewToken!),{previews:state.previews,reviewHash:state.manifestHash},undefined,true);
    }
    if(action==="bootstrap-check"||action==="bootstrap-apply"){
      const state=ownerBootstrapStatus(actor),tokens=BOOTSTRAP_FIXTURES.map((_,n)=>form.get("token"+n)??"");
      if(action==="bootstrap-check")return review(BOOTSTRAP_ROOT,tokens,{previews:state.previews,reviewHash:state.manifestHash},undefined,true);
      const result=await applyOwnerBootstrap(BOOTSTRAP_FIXTURES.map((f,n)=>({operationId:f.id,previewToken:tokens[n],expectedHash:state.records[n].beforeHash})),actor);
      if(result.status!=="synthetic_bootstrap_git_physical_fts_verified")return denied("Bootstrap already attempted; inspect receipts and reconcile manually. No retry performed.",409);
      return html('<h1>Synthetic bootstrap verified</h1><pre>'+esc(JSON.stringify(result,null,2))+'</pre><p>Copy the returned research package only after independent readback and a fresh Git HEAD check. Research import/approval/apply are separate actions.</p>');
    }
    if(action==="synthetic-research-preview"){
      if([...form.keys()].length!==1)return denied("Unexpected synthetic test input",400);
      const pkg=verifiedBootstrapResearchPackage(actor);
      const p=await previewOwnerResearch(pkg,actor);
      const root=p.analysis.operationId.slice(0,-9);
      return review(root,[p.analysis.previewToken!,p.timeline.previewToken!],ownerResearchStatus(root,actor),p.context);
    }
    if(form.get("action")==="import"){
      const p=await previewOwnerResearch(JSON.parse(form.get("package")??""),actor);
      const root=p.analysis.operationId.slice(0,-9);
      return review(root,[p.analysis.previewToken!,p.timeline.previewToken!],ownerResearchStatus(root,actor),p.context);
    }
    const root=form.get("operationRoot")??"",tokens=[form.get("token0")??"",form.get("token1")??""];
    const state=ownerResearchStatus(root,actor);
    if(form.get("action")==="check")return review(root,tokens,state);
    if(form.get("action")==="apply"){
      const result=await applyOwnerResearch({analysis:{operationId:root+"-analysis",previewToken:tokens[0],expectedHash:state.analysis.beforeHash},timeline:{operationId:root+"-timeline",previewToken:tokens[1],expectedHash:state.timeline.beforeHash}},actor);
      if(result.status!=="owner_research_git_and_graph_verified")return denied("Operation already attempted. Inspect receipts; no write or retry performed.",409);
      return html('<h1>Research writeback verified</h1><pre>'+esc(JSON.stringify(result,null,2))+'</pre><p>Server/Git verification only. Device sync is not verified.</p>');
    }
    return denied("Unknown research action",400);
  }catch{return denied("Review or Apply refused/uncertain. Inspect operation receipts and Git before any further action; never resubmit automatically.",409);}
}

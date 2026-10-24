/** Human-operated authenticated M4 transport. Never invoked by an MCP tool. */
import type {APIEvent} from "@solidjs/start/server";
import {env} from "~/server/env";
import {assertOwnerResearch,previewOwnerResearch,ownerResearchStatus,applyOwnerResearch} from "~/server/safe-edit/owner-research";
import {owner,smallForm,escapeHtml as esc,html,denied} from "./staging-git-pilot";

function review(root:string,tokens:string[],state:ReturnType<typeof ownerResearchStatus>,context?:unknown){
  const eligible=state.previews.every(p=>p.approved&&p.status==="preview"&&Date.parse(p.expiresAt)>Date.now());
  const hidden='<input type="hidden" name="operationRoot" value="'+esc(root)+'">'+tokens.map((t,n)=>'<input type="hidden" name="token'+n+'" value="'+esc(t)+'">').join("");
  return html('<h1>Investment Research — Owner Review</h1><p>All imported/source text is untrusted data. Review the FULL diffs and historical context. AI analysis remains unverified archived analysis.</p>'+
    '<pre>'+esc(JSON.stringify({reviewHash:state.reviewHash,previews:state.previews,context:context??state.context,anchors:state.anchors},null,2))+'</pre>'+
    state.previews.map(p=>'<p><a target="_blank" rel="noopener noreferrer" href="'+esc(p.approvalUrl)+'">Approve exact '+esc(p.path)+' diff in separate tab</a></p>').join("")+
    '<p>Both independent admin approvals: '+(eligible?'VERIFIED':'NOT YET VERIFIED')+'</p>'+
    '<form method="post">'+hidden+'<button name="action" value="check">Check approvals — no write</button></form>'+
    (eligible?'<form method="post">'+hidden+'<button name="action" value="apply">Apply this approved research ONCE</button></form>':'')+
    '<p>Keep this tab open. If Apply outcome is uncertain, do not retry. Use the operation receipt and manual reconciliation.</p>');
}
export async function GET({request}:APIEvent){
  const session=await owner(request);if(!session)return denied("Sign in to the staging owner dashboard.",401);
  try{
    assertOwnerResearch();
    const root=new URL(request.url).searchParams.get("operationRoot");
    if(root)return html('<h1>Research operation receipt — read only</h1><pre>'+esc(JSON.stringify(ownerResearchStatus(root,"staging-owner-research:"+session.user.id),null,2))+'</pre>');
    return html('<h1>Import Investment Research Review Package</h1><p>Paste the existing graph bundle JSON from ChatGPT. Import creates previews only. It grants no approval and performs no note write, commit or push.</p><form method="post"><textarea name="package" rows="24" cols="100" maxlength="120000" required></textarea><button name="action" value="import">Import and preview</button></form>');
  }catch{return denied("Research review disabled, unavailable or outside staging scope.",403);}
}
export async function POST({request}:APIEvent){
  if(request.headers.get("origin")!==env.baseUrl)return denied("Forbidden origin",403);
  const session=await owner(request);if(!session)return denied("Sign in to the staging owner dashboard.",401);
  try{assertOwnerResearch();}catch{return denied("Research review disabled or outside staging scope.",403);}
  let form:URLSearchParams;
  try{form=await smallForm(request,512000);}catch{return denied("Invalid or oversized review form",400);}
  const actor="staging-owner-research:"+session.user.id;
  try{
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

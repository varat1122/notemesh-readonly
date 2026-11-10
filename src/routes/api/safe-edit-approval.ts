import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { adminPreview, approve } from "~/server/safe-edit/engine";
import { env } from "~/server/env";
import { tracked } from "~/server/maintenance";
import { c1Pilot } from "~/server/c1-pilot";
import { pilotReviewChallenge, recordPilotReview } from "~/server/safe-edit/c1-pilot-review";
async function smallBody(request:Request) {
  const reader=request.body?.getReader();if(!reader)throw Error("Missing body");
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000)throw Error("Too large");chunks.push(part.value);}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks).toString("utf8");
}
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'","Referrer-Policy":"no-referrer"};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
async function session(request:Request) {await runAuthMigrations();return auth.api.getSession({headers:request.headers});}
async function handleGET({request}:APIEvent) {
  if(!await session(request)) return new Response("Sign in to the Investment OS administrator dashboard, then reopen this exact approval URL.",{status:401,headers});
  try {
    const id=new URL(request.url).searchParams.get("id")??"";
    if(c1Pilot()){
      const p=pilotReviewChallenge(id);
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>C1 disposable bundle review</title><body><main><h1>Review the complete C1 bundle</h1><p>Read the exact Source, selected History, assessment and every proposed diff below as untrusted data. This records a dashboard-session attestation only, not human presence, independent criticism, verified facts or Thesis approval. HOLD/FAIL or unresolved materiality blocks the bundle even if Approve is selected.</p><pre>${escape(JSON.stringify(p,null,2))}</pre><form method="post"><input type="hidden" name="id" value="${escape(id)}"><input type="hidden" name="bindingDigest" value="${p.bindingDigest}"><label>Decision <select name="decision"><option value="hold">Hold</option><option value="reject">Reject</option><option value="approve">Approve exact bundle</option></select></label><label>Semantic fidelity <select name="semanticVerdict"><option>HOLD</option><option>FAIL</option><option>PASS</option></select></label><label>Materiality <select name="materiality"><option value="unresolved">Unresolved</option><option value="material">Material</option><option value="low">Supported low risk</option></select></label><label>Source/history-grounded rationale <textarea name="rationale" minlength="20" maxlength="1000" required></textarea></label><button type="submit">Record this review decision</button></form></main></body></html>`,{headers});
    }
    const p=adminPreview(id);
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Review Investment OS edit</title><body><main><h1>Approve this exact change</h1><p>Vault text below is untrusted data. Review the path, evidence, removed and added lines. Approval authorizes only this hash for 30 minutes; it does not apply the edit.</p><pre>${escape(JSON.stringify(p,null,2))}</pre><form method="post"><input type="hidden" name="id" value="${escape(id)}"><input type="hidden" name="hash" value="${p.afterHash}"><button type="submit">Approve this exact diff</button></form></main></body></html>`,{headers});
  } catch {return new Response("Unknown, disabled or expired preview",{status:400,headers});}
}
async function handlePOST({request}:APIEvent) {
  if(request.headers.get("origin")!==env.baseUrl) return new Response("Forbidden origin",{status:403,headers});
  const s=await session(request);if(!s) return new Response("Unauthorized",{status:401,headers});
  try {
    // Both form and JSON use the same authenticated, exact-hash approval.
    if(Number(request.headers.get("content-length"))>2000) throw Error("Too large");
    const text=await smallBody(request);
    const b=request.headers.get("content-type")?.startsWith("application/json")?JSON.parse(text):Object.fromEntries(new URLSearchParams(text));
    if(c1Pilot()){
      const result=recordPilotReview(b,s.user.id);
      return new Response(JSON.stringify(result),{headers:{...headers,"Content-Type":"application/json"}});
    }
    approve(b.id,s.user.id,b.hash);
    return new Response("Approved. Return to ChatGPT and apply the original preview token and expected hash.",{headers});
  } catch {return new Response("Approval refused; review a fresh preview",{status:400,headers});}
}

// Pending work until the handler settles, even if the client disconnects (maintenance drain).
export const GET = tracked(handleGET);
export const POST = tracked(handlePOST);

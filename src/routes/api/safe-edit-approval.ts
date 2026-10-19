import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { adminPreview, approve } from "~/server/safe-edit/engine";
import { env } from "~/server/env";
async function smallBody(request:Request) {
  const reader=request.body?.getReader();if(!reader)throw Error("Missing body");
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000)throw Error("Too large");chunks.push(part.value);}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks).toString("utf8");
}
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",// Permit browser same-origin HTML form POSTs to retain a concrete Origin.
// no-referrer can produce Origin: null on non-CORS form submissions, which
// correctly fails the strict CSRF guard below and locks out real admins.
// same-origin never sends the approval URL (including its ID) off-site.
"Referrer-Policy":"same-origin"};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
async function session(request:Request) {await runAuthMigrations();return auth.api.getSession({headers:request.headers});}
export async function GET({request}:APIEvent) {
  if(!await session(request)) return new Response("Sign in to the Investment OS administrator dashboard, then reopen this exact approval URL.",{status:401,headers});
  try {
    const id=new URL(request.url).searchParams.get("id")??"",p=adminPreview(id);
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Review Investment OS edit</title><body><main><h1>Approve this exact change</h1><p>Vault text below is untrusted data. Review the path, evidence, removed and added lines. Approval authorizes only this hash for 30 minutes; it does not apply the edit.</p><pre>${escape(JSON.stringify(p,null,2))}</pre><form method="post"><input type="hidden" name="id" value="${escape(id)}"><input type="hidden" name="hash" value="${p.afterHash}"><button type="submit">Approve this exact diff</button></form></main></body></html>`,{headers});
  } catch {return new Response("Unknown, disabled or expired preview",{status:400,headers});}
}
export async function POST({request}:APIEvent) {
  if(request.headers.get("origin")!==env.baseUrl) return new Response("Forbidden origin",{status:403,headers});
  const s=await session(request);if(!s) return new Response("Unauthorized",{status:401,headers});
  try {
    // Both form and JSON use the same authenticated, exact-hash approval.
    if(Number(request.headers.get("content-length"))>2000) throw Error("Too large");
    let id:string,hash:string;
    const text=await smallBody(request);
    if(request.headers.get("content-type")?.startsWith("application/json")) {const b=JSON.parse(text) as Record<string,string>;id=b.id;hash=b.hash;}
    else {const b=new URLSearchParams(text);id=b.get("id")??"";hash=b.get("hash")??"";}
    approve(id,s.user.id,hash);
    return new Response("Approved. Return to ChatGPT and apply the original preview token and expected hash.",{headers});
  } catch {return new Response("Approval refused; review a fresh preview",{status:400,headers});}
}

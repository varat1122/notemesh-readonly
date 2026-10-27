import type { APIEvent } from "@solidjs/start/server";
import { z } from "zod";
import { auth, runAuthMigrations } from "~/server/auth";
import { env } from "~/server/env";
import { audit } from "~/server/audit";
import { primaryAttestationSchema, primarySignedImportSchema,
  preparePrimaryEvidenceAttestation, importSignedPrimaryEvidence,
  revokePrimaryEvidenceReceipt } from "~/server/vault/primary-evidence-attestation-m551";

/** Admin-session-only import of TWO external signatures, never an MCP tool.
 * A valid vault:edit OAuth token or API key is not authorization here. */
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("prepare"),attestation:primaryAttestationSchema}).strict(),
  z.object({action:z.literal("issue"),signed:primarySignedImportSchema}).strict(),
  z.object({action:z.literal("revoke"),receiptId:z.string(),reason:z.string()}).strict()
]);
const responseHeaders={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:responseHeaders});
async function boundedJson(request:Request):Promise<unknown>{
  const declared=Number(request.headers.get("content-length"));
  if(Number.isFinite(declared)&&declared>16000)throw Error("body_too_large");
  const reader=request.body?.getReader();
  if(!reader)throw Error("missing_body");
  const chunks:Uint8Array[]=[];let length=0;
  try{
    while(true){const r=await reader.read();if(r.done)break;
      length+=r.value.byteLength;
      if(length>16000)throw Error("body_too_large");
      chunks.push(r.value);
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST({request}:APIEvent){
  if(request.headers.get("origin")!==env.baseUrl)return json({error:"forbidden_origin"},403);
  if(!request.headers.get("content-type")?.startsWith("application/json"))
    return json({error:"json_required"},415);
  await runAuthMigrations();
  const session=await auth.api.getSession({headers:request.headers});
  if(!session)return json({error:"admin_session_required"},401);
  const actor="admin:"+session.user.id;
  try {
    const args=input.parse(await boundedJson(request));
    const result=args.action==="prepare"?preparePrimaryEvidenceAttestation(args.attestation):
      args.action==="issue"?importSignedPrimaryEvidence(args.signed,actor):
      revokePrimaryEvidenceReceipt(args.receiptId,args.reason,actor);
    return json(result);
  }catch(e){
    const code=e instanceof Error?e.message:"receipt_request_refused";
    audit("primary_evidence_receipt_refused",{actor,code:code.slice(0,120)});
    return json({error:"receipt_request_refused",reason:code.slice(0,160)},400);
  }
}
export async function GET(){return json({error:"post_only"},405);}

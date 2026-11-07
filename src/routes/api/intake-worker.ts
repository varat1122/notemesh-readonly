import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { bearerToken } from "~/server/mcp/auth";
import { readCappedJson } from "~/server/mcp/http";
import { nextIntake, acknowledge } from "~/server/intake";
import { cloudIntakeEnabled } from "~/server/cloud-intake";
import { tracked } from "~/server/maintenance";

// Separate named credential, never OAuth or an ordinary research API key.
async function allowed(request:Request){
  const token=bearerToken(request);if(!token)return false;
  try{await runAuthMigrations();const r=await auth.api.verifyApiKey({body:{key:token}});return Boolean(r.valid && r.key?.name === "Investment OS Intake Worker");}catch{return false;}
}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
async function handleGET({request}:APIEvent){if(!await allowed(request))return response({error:"Unauthorized"},401);if(cloudIntakeEnabled())return response({item:null,processor:"railway",desktopReceiverDisabled:true});return response({item:nextIntake()});}
async function handlePOST({request}:APIEvent){if(!await allowed(request))return response({error:"Unauthorized"},401);if(cloudIntakeEnabled())return response({error:"Desktop receipts disabled; cloud receiver owns the queue"},409);try{return response(acknowledge(await readCappedJson(request)));}catch{return response({error:"Invalid receipt"},400);}}

// Pending work until the handler settles, even if the client disconnects (maintenance drain).
export const GET = tracked(handleGET);
export const POST = tracked(handlePOST);

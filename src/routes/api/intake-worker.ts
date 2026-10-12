import type { APIEvent } from "@solidjs/start/server";
import { auth, runAuthMigrations } from "~/server/auth";
import { bearerToken } from "~/server/mcp/auth";
import { readCappedJson } from "~/server/mcp/http";
import { nextIntake, acknowledge } from "~/server/intake";

// Separate named credential, never OAuth or an ordinary research API key.
async function allowed(request:Request){
  const token=bearerToken(request);if(!token)return false;
  try{await runAuthMigrations();const r=await auth.api.verifyApiKey({body:{key:token}});return Boolean(r.valid && r.key?.name === "Investment OS Intake Worker");}catch{return false;}
}
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
export async function GET({request}:APIEvent){if(!await allowed(request))return response({error:"Unauthorized"},401);return response({item:nextIntake()});}
export async function POST({request}:APIEvent){if(!await allowed(request))return response({error:"Unauthorized"},401);try{return response(acknowledge(await readCappedJson(request)));}catch{return response({error:"Invalid receipt"},400);}}

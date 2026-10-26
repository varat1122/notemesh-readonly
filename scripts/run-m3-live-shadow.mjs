/**
 * Local opt-in ONLY: 20 frozen fictional cases over OpenAI Responses API.
 * No Production/Vault access, no arbitrary prompts/files, no server route.
 * API usage may incur charges. Never paste or commit credentials.
 *
 * Required env: OPENAI_API_KEY, NM_M3_REAL_MODEL_OPT_IN=YES,
 *               NM_M3_MODEL=<operator-verified supported API model>
 * Usage: node --experimental-strip-types scripts/run-m3-live-shadow.mjs
 *        --execute-synthetic-only [--trials=1|2|3]
 */
import {registerHooks} from "node:module";

registerHooks({
  resolve(specifier,context,nextResolve){
    if((specifier.startsWith("./")||specifier.startsWith("../"))&&
      !/\.(?:[cm]?[jt]s|json|node)$/i.test(specifier)){
      try{return nextResolve(specifier,context);}
      catch(error){
        if(error?.code!=="ERR_MODULE_NOT_FOUND")throw error;
        return nextResolve(specifier+".ts",context);
      }
    }
    return nextResolve(specifier,context);
  },
});

async function main(){
  const args=process.argv.slice(2);
  if(!args.includes("--execute-synthetic-only")||args.some(a=>
    a!=="--execute-synthetic-only"&&!/^--trials=[123]$/.test(a))||
    args.filter(x=>x.startsWith("--trials=")).length>1)
    throw Error("M3_EXPLICIT_SYNTHETIC_ONLY_COMMAND_REQUIRED");
  const option=args.find(x=>x.startsWith("--trials="));
  const trialCount=option?Number(option.slice("--trials=".length)):1;
  const {runOptInRealM3Shadow}=await import("../src/server/vault/m3-shadow-openai.ts");
  const result=await runOptInRealM3Shadow({
    key:process.env.OPENAI_API_KEY,model:process.env.NM_M3_MODEL,
    trialCount,explicitConsent:true});
  // Do not print provider raw text, source prompts, Bearer tokens, headers or
  // arbitrary response bodies. Outcome remains fictional test-set only.
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
try{await main();}
catch(e){
  const message=e instanceof Error?e.message:"unknown";
  // Only fixed local error codes defined by our transport layer are exposed.
  process.stderr.write("m3_real_model_shadow_hold: "+
    (/^M3_[A-Z0-9_]+$/.test(message)?message:"M3_UNEXPECTED_ERROR_HOLD")+"\n");
  process.exitCode=1;
}

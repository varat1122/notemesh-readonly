/**
 * Local/offline ChatGPT-room synthetic fixture handoff and result scorer.
 * Export and score do NOT invoke an LLM API, connected tool or Vault.
 *
 * node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=micro
 * node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --score-stdin < submissions.json
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

async function readBoundedStdin(){
  let data="";
  for await(const chunk of process.stdin){
    data+=chunk.toString("utf8");
    if(Buffer.byteLength(data,"utf8")>256*1024)
      throw Error("M3_CHAT_NATIVE_SUBMISSION_OVERSIZED_HOLD");
  }
  if(!data.trim())throw Error("M3_CHAT_NATIVE_EMPTY_SUBMISSION_HOLD");
  try{return JSON.parse(data);}
  catch{throw Error("M3_CHAT_NATIVE_SUBMISSION_INVALID_JSON_HOLD");}
}

async function main(){
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID||process.env.CI)
    throw Error("M3_CHAT_NATIVE_LOCAL_ONLY_HOLD");
  const args=process.argv.slice(2);
  if(args.length!==1)throw Error("M3_CHAT_NATIVE_EXPLICIT_COMMAND_REQUIRED");
  const {makeM3ChatRoomBundle,scoreM3ChatRoomSubmission}=await import(
    "../src/server/vault/m3-chat-native.ts");
  if(/^--export-room=(micro|macro|pdf)$/.test(args[0])){
    const room=args[0].slice("--export-room=".length);
    process.stdout.write(JSON.stringify(makeM3ChatRoomBundle(room),null,2)+"\n");
  }else if(args[0]==="--score-stdin"){
    process.stdout.write(JSON.stringify(scoreM3ChatRoomSubmission(await readBoundedStdin()),null,2)+"\n");
  }else throw Error("M3_CHAT_NATIVE_EXPLICIT_COMMAND_REQUIRED");
}

try{await main();}
catch(error){
  const code=error instanceof Error?error.message:"";
  process.stderr.write("m3_chat_native_hold: "+
    (/^M3_[A-Z0-9_]+$/.test(code)?code:"M3_CHAT_NATIVE_SCHEMA_OR_UNEXPECTED_ERROR_HOLD")+"\n");
  process.exitCode=1;
}

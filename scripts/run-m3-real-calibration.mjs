/**
 * Offline, explicitly manual three-room historical calibration export/scorer.
 * No API/model call, MCP action, Vault access, writes or policy installation.
 * Examples:
 * node --experimental-strip-types scripts/run-m3-real-calibration.mjs --export-room=micro
 * node --experimental-strip-types scripts/run-m3-real-calibration.mjs --score-stdin < submission.json
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
  let input="";
  for await(const chunk of process.stdin){
    input+=chunk.toString("utf8");
    if(Buffer.byteLength(input,"utf8")>128*1024)
      throw Error("M3_REAL_CALIBRATION_SUBMISSION_TOO_LARGE_HOLD");
  }
  if(!input.trim())throw Error("M3_REAL_CALIBRATION_EMPTY_SUBMISSION_HOLD");
  try{return JSON.parse(input);}catch{throw Error("M3_REAL_CALIBRATION_INVALID_JSON_HOLD");}
}
async function main(){
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID||process.env.CI)
    throw Error("M3_REAL_CALIBRATION_LOCAL_ONLY_HOLD");
  const args=process.argv.slice(2);
  if(args.length!==1)throw Error("M3_REAL_CALIBRATION_EXPLICIT_COMMAND_HOLD");
  const {makeM3RealCalibrationBundle,scoreM3RealCalibrationSubmission}=await import(
    "../src/server/vault/m3-real-calibration.ts");
  if(/^--export-room=(micro|macro|pdf)$/.test(args[0])){
    process.stdout.write(JSON.stringify(makeM3RealCalibrationBundle(args[0].slice(14)),null,2)+"\n");
  }else if(args[0]==="--score-stdin"){
    process.stdout.write(JSON.stringify(scoreM3RealCalibrationSubmission(await readBoundedStdin()),null,2)+"\n");
  }else throw Error("M3_REAL_CALIBRATION_EXPLICIT_COMMAND_HOLD");
}
try{await main();}
catch(error){
  const code=error instanceof Error?error.message:"";
  process.stderr.write("m3_real_calibration_hold: "+(
    /^M3_REAL_CALIBRATION_[A-Z0-9_]+(?:_HOLD)?$/.test(code)
      ?code:"M3_REAL_CALIBRATION_SCHEMA_OR_UNEXPECTED_ERROR_HOLD")+"\n");
  process.exitCode=1;
}

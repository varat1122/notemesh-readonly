/**
 * Opt-in local command for PR #91. Sends ONLY 8 hardcoded fictional SYNTH
 * cases to https://api.openai.com/v1/responses.
 *
 * NO Vault, no user input, no file writes, no logging secrets.
 *
 * Usage (on a developer machine, never CI / Railway):
 *   export OPENAI_API_KEY='<your credential>'
 *   export NM_ENABLE_SYNTHETIC_OPENAI_RUN=YES
 *   node --experimental-strip-types scripts/run-synthetic-openai-eval.mjs \
 *     --execute-synthetic-only
 *
 * Do not run in a shell with set -x. API usage may incur a small cost.
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
  if(process.argv.length!==3||
    process.argv[2]!=="--execute-synthetic-only")
    throw Error("synthetic_openai_explicit_command_flag_required");
  if(process.env.CI||process.env.GITHUB_ACTIONS||
    process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("synthetic_openai_ci_and_production_refused");
  const {runOptInRealOpenAISyntheticEvaluation}=await import(
    "../src/server/vault/offline-synthetic-openai-eval.ts");
  const result=await runOptInRealOpenAISyntheticEvaluation(
    process.env.OPENAI_API_KEY,true);
  // Only compact sanitized quantitative summary. Do not emit any model
  // raw text, Thesis notes, prompts, bearer tokens or response headers.
  process.stdout.write(JSON.stringify({
    status:result.status,
    responseSource:result.responseSource,
    model:"gpt-5-mini",
    cases:result.cases,
    metrics:result.metrics,
    caseResults:result.caseResults,
    heldOutEvaluationPerformed:false,
    independentRealWorldAccuracyMeasured:false,
    productionReleaseAllowed:false,
    ownerApprovalGranted:false,
    vaultModified:false,
  },null,2)+"\n");
}
try{await main();}
catch(error){
  // Error strings must originate from our own fixed error codes, never
  // output the raw API response which may contain sensitive metadata.
  process.stderr.write("synthetic_openai_evaluation_hold: "+
    (error instanceof Error?error.message:"unknown")+"\n");
  process.exitCode=1;
}

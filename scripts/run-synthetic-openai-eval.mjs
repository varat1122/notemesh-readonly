/**
 * Local evaluation only. --initialize-budget / --status are OFFLINE.
 * Paid execution additionally requires reviewed readiness evidence and the
 * persistent campaign ledger. See docs/OPENAI_EVALUATION_BUDGET.md.
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
  if(process.env.CI||process.env.GITHUB_ACTIONS||
    process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("synthetic_openai_ci_and_production_refused");
  const {OpenAIEvaluationBudget,LIVE_LEDGER}=await import(
    "../src/server/vault/openai-evaluation-budget.ts");
  const [command,...args]=process.argv.slice(2);
  if(command==="--initialize-budget"&&args.length===0){
    OpenAIEvaluationBudget.initialize(LIVE_LEDGER);
  }else if(command!=="--status"&&command!=="--execute-synthetic-only"){
    throw Error("synthetic_openai_explicit_command_flag_required");
  }
  if(command!=="--execute-synthetic-only"){
    if(args.length)throw Error("synthetic_openai_unknown_argument_hold");
    const budget=new OpenAIEvaluationBudget(LIVE_LEDGER);
    try{process.stdout.write(JSON.stringify({...budget.status(),
      readinessNotChecked:true,paidAuthorizationGrantedByThisCommand:false},null,2)+"\n");}
    finally{budget.close();}
    return;
  }
  // Explicit intentional round, no automatic repeat or fallback model.
  if(args.length!==3||!/^[a-zA-Z0-9_.-]{1,64}$/.test(args[0])||
    !/^[1-9]\d*$/.test(args[1])||!["low","medium","high"].includes(args[2]))
    throw Error("synthetic_openai_round_output_limit_effort_required");
  const {runOptInRealOpenAISyntheticEvaluation}=await import(
    "../src/server/vault/offline-synthetic-openai-eval.ts");
  const result=await runOptInRealOpenAISyntheticEvaluation(
    process.env.OPENAI_API_KEY,true,
    {round:args[0],maxOutputTokens:Number(args[1]),reasoningEffort:args[2]});
  // Only compact sanitized quantitative summary. Do not emit any model
  // raw text, Thesis notes, prompts, bearer tokens or response headers.
  process.stdout.write(JSON.stringify({
    status:result.status,
    responseSource:result.responseSource,
    model:result.model,
    spending:result.spending,
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
  const message=error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?
    error.message:"local_configuration_or_ledger_error";
  process.stderr.write("synthetic_openai_evaluation_hold: "+message+"\n");
  process.exitCode=1;
}

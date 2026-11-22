/**
 * Baseline-only CLI. No provider, no Vault, no files written, no user input.
 * This prints only case IDs / deterministic quality issue codes and counts.
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
  if(process.argv.length!==3||process.argv[2]!=="--baseline-only")
    throw Error("m3_baseline_only_explicit_flag_required");
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("m3_baseline_forbidden_in_railway");
  const {measureM551LegacyBaseline}=await import("../src/server/vault/m3-shadow-evaluator.ts");
  const result=measureM551LegacyBaseline();
  process.stdout.write(JSON.stringify({status:result.status,cases:result.caseCount,
    metrics:result.metrics,perCase:result.rows.map(x=>({caseId:x.caseId,
      goldReviewSafe:x.goldReviewSafe,oldGateWouldAllow:x.oldGateWouldAllow,
      qualityIssueCodes:x.qualityIssueCodes,falseVerified:x.falseVerified,falseHold:x.falseHold})),
    realModelInvoked:false,heldOutIndependentTruthEvaluated:false,
    productionReleaseAllowed:false,vaultModified:false},null,2)+"\n");
}
try{await main();}
catch(e){
  process.stderr.write("m3_shadow_baseline_hold: "+
    (e instanceof Error?e.message:"unknown")+"\n");
  process.exitCode=1;
}

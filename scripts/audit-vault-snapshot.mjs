/**
 * Offline-only CLI for an already-captured segregated Vault + SQLite copy.
 *
 * No third-party TypeScript runner, network calls, Vault writes or source
 * mutation. Node >=24 supports built-in type-stripping; this resolve hook
 * preserves the repository's existing extensionless local .ts imports.
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

const {verifyOfflineSnapshotCoverage}=await import(
  "../src/server/vault/snapshot-coverage-acceptance.ts"
);
const target=process.argv[2];
if(!target||process.argv.length!==3){
  console.error("Usage: pnpm snapshot:coverage:offline /ABSOLUTE/SEGREGATED/SNAPSHOT_DIR");
  process.exitCode=2;
}else{
  try{
    const report=verifyOfflineSnapshotCoverage(target);
    console.log(JSON.stringify(report,null,2));
    if(report.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
      process.exitCode=1;
  }catch(e){
    console.error(e instanceof Error?e.message:"snapshot_acceptance_unexpected_error");
    process.exitCode=1;
  }
}

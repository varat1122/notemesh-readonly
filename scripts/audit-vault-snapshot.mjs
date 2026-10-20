/**
 * Offline-only CLI for pre-captured segregated Vault + SQLite snapshots.
 * Node >=24 uses TypeScript type stripping and local extension resolution.
 * --sources audits separately registered blobs, after Markdown consistency.
 * No archive capture, network request, Vault edit or Production operation.
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
const sourceMode=process.argv[2]==="--sources";
const target=process.argv[sourceMode?3:2];
if(!target||process.argv.length!==(sourceMode?4:3)){
  console.error(
    "Usage: pnpm snapshot:coverage:offline /ABSOLUTE/SEGREGATED/SNAPSHOT_DIR"+
    " OR pnpm snapshot:sources:offline /ABSOLUTE/SEGREGATED/SNAPSHOT_DIR"
  );
  process.exitCode=2;
}else{
  try{
    const report=sourceMode?
      (await import("../src/server/vault/offline-source-provenance.ts"))
        .verifyOfflineSourceArchiveCoverage(target):
      (await import("../src/server/vault/snapshot-coverage-acceptance.ts"))
        .verifyOfflineSnapshotCoverage(target);
    console.log(JSON.stringify(report,null,2));
    const approvedState=sourceMode?
      "offline_archived_bytes_intact_not_publisher_verified":
      "snapshot_markdown_index_reconciled_not_originals_verified";
    if(report.status!==approvedState)process.exitCode=1;
  }catch(e){
    console.error(e instanceof Error?e.message:"snapshot_acceptance_unexpected_error");
    process.exitCode=1;
  }
}

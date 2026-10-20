/**
 * Offline-only CLI for pre-captured segregated Vault + SQLite snapshots.
 * Node >=24 TypeScript stripping and local extension resolution.
 * --review only produces a human worksheet (NO changes or approval).
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
const mode=process.argv[2];
const sourceMode=mode==="--sources",reviewMode=mode==="--review";
const target=process.argv[sourceMode||reviewMode?3:2];
const usage="Usage: pnpm snapshot:coverage:offline /ABSOLUTE/SNAPSHOT "+
  "OR pnpm snapshot:sources:offline /ABSOLUTE/SNAPSHOT "+
  "OR pnpm snapshot:review:offline /ABSOLUTE/SNAPSHOT "+
  "'relative/note.md' inspect_original_claim|metadata_correction_candidate|"+
  "navigation_link_candidate|duplicate_or_contradiction_review [expectedNoteSha256]";
const goodCount=reviewMode?
  [6,7].includes(process.argv.length):
  sourceMode?process.argv.length===4:
    process.argv.length===3;
if(!target||!goodCount){
  console.error(usage);
  process.exitCode=2;
}else{
  try{
    const report=reviewMode?
      (await import("../src/server/vault/offline-evidence-human-review.ts"))
        .prepareOfflineEvidenceGatedHumanReview({
          snapshotRoot:target,notePath:process.argv[4],
          action:process.argv[5],expectedNoteSha256:process.argv[6],
        }):
      sourceMode?
        (await import("../src/server/vault/offline-source-provenance.ts"))
          .verifyOfflineSourceArchiveCoverage(target):
        (await import("../src/server/vault/snapshot-coverage-acceptance.ts"))
          .verifyOfflineSnapshotCoverage(target);
    console.log(JSON.stringify(report,null,2));
    const required=reviewMode?
      "stored_bytes_located_for_manual_verification_only":
      sourceMode?"offline_archived_bytes_intact_not_publisher_verified":
      "snapshot_markdown_index_reconciled_not_originals_verified";
    if(report.status!==required)process.exitCode=1;
  }catch(e){
    console.error(e instanceof Error?e.message:"offline_vault_review_error");
    process.exitCode=1;
  }
}

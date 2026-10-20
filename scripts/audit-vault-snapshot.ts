/**
 * Explicitly local, offline reader for an ALREADY CAPTURED segregated snapshot.
 *
 * Usage: pnpm snapshot:coverage:offline /absolute/path/to/copy\n * Requires dev dependencies for vite-node TypeScript module resolution.
 *
 * A snapshot contains vault/ and a CONSISTENT app.sqlite from SQLite's
 * backup API (or a quiescent atomic source). Never target live production.
 * Prints metadata only; stdout never contains full note prose or secrets.
 */
import {verifyOfflineSnapshotCoverage} from "../src/server/vault/snapshot-coverage-acceptance.ts";

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

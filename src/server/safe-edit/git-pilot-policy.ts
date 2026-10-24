import fs from "node:fs";
import { env } from "../env";
import { getSetting } from "../db";
import { assertEnabled } from "./engine";
export const note="PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md";
export const remote="https://github.com/varat1122/investment-os-staging-test-vault.git";
const ids={RAILWAY_PROJECT_ID:"8ac4a414-9f0b-4a90-bcce-4995e5736d9d",RAILWAY_ENVIRONMENT_ID:"bce3bde4-29c1-44e5-8cfe-7400db9f7f51",RAILWAY_SERVICE_ID:"0f673bc3-e433-4641-85a8-12b2678eb040"};
export function assertGitPilot() {
  assertEnabled();
  if(process.env.GIT_SAFE_WRITEBACK_PILOT!=="1" ||
    Object.entries(ids).some(([k,v])=>process.env[k]!==v) ||
    env.dataDir!=="/pilot-001-data" || fs.realpathSync(env.dataDir)!==env.dataDir ||
    fs.realpathSync(env.vaultDir)!=="/pilot-001-data/vault" ||
    process.env.RAILWAY_REPLICA_COUNT!=="1" ||
    getSetting("sync_backend")!=="git" || getSetting("git_remote")!==remote ||
    getSetting("git_branch")!=="main" || process.env.INVESTMENT_GRAPH_BUNDLE_ENABLED!=="0" ||
    process.env.CLOUD_INTAKE!=="0") throw Error("Git pilot staging scope refused");
}

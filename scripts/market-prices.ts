import { runPriceRefresh } from "../src/server/market-prices/collector.ts";
import { priceDataStatus } from "../src/server/market-prices/status.ts";
import { PriceError } from "../src/server/market-prices/model.ts";
import { runDailyPriceJob } from "../src/server/market-prices/daily-job.ts";

const command = process.argv[2] ?? "status";
try {
  if (["drive-pilot-gate-plan", "drive-pilot-gate-dry-run", "drive-pilot-gate-mock-worker"].includes(command)) {
    if (command === "drive-pilot-gate-mock-worker" ? process.argv.length !== 5 : process.argv.length !== 3) throw new PriceError("unexpected_drive_pilot_gate_argument");
    const log = console.log; let result: unknown;
    try {
      console.log = (...args) => console.error(...args);
      if (command === "drive-pilot-gate-plan") { const { singleUseGatePlan } = await import("../src/server/market-prices/drive-pilot-gate.ts"); result = singleUseGatePlan(); }
      else { const { runSingleUseGateDryRun, runMockGateWorker } = await import("../src/server/market-prices/drive-pilot-gate-mock.ts");
        result = command === "drive-pilot-gate-dry-run" ? await runSingleUseGateDryRun() : await runMockGateWorker(process.argv[3], process.argv[4]); }
    } finally { console.log = log; }
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "drive-pilot-plan" || command === "drive-pilot-dry-run") {
    if (process.argv.length !== 3) throw new PriceError("unexpected_drive_pilot_argument");
    const { drivePilotPlan, runDrivePilotDryRun } = await import("../src/server/market-prices/drive-pilot-demo.ts");
    const log = console.log;
    let result: unknown;
    try { console.log = (...args) => console.error(...args); result = command === "drive-pilot-plan" ? drivePilotPlan() : await runDrivePilotDryRun(); }
    finally { console.log = log; }
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "dry-run") {
    const { runOfflinePriceDemo } = await import("../src/server/market-prices/offline-demo.ts");
    let watchlist: unknown;
    if (process.argv.length !== 3) {
      if (process.argv.length !== 5 || process.argv[3] !== "--watchlist") throw new PriceError("unexpected_offline_demo_argument");
      const { default: fs } = await import("node:fs");
      const file = process.argv[4], stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new PriceError("invalid_offline_watchlist_file");
      try { watchlist = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new PriceError("invalid_offline_watchlist_json"); }
    }
    const log = console.log;
    let result: Awaited<ReturnType<typeof runOfflinePriceDemo>>;
    try {
      console.log = (...args) => console.error(...args); // Keep stdout a single JSON receipt.
      result = await runOfflinePriceDemo(watchlist);
    } finally { console.log = log; }
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "snapshot") {
    // Explicit local inputs only. No implicit production database, Google API or scheduler path.
    if (![9, 11].includes(process.argv.length) || process.argv[3] !== "--database" || process.argv[5] !== "--output" || process.argv[7] !== "--as-of" ||
      (process.argv.length === 11 && process.argv[9] !== "--provider-receipt")) throw new PriceError("snapshot_requires_database_output_as_of");
    const { exportLocalPriceSnapshot } = await import("../src/server/market-prices/local-snapshot.ts");
    const asOf = new Date(process.argv[8]);
    if (!Number.isFinite(asOf.getTime())) throw new PriceError("invalid_snapshot_as_of");
    console.log(JSON.stringify(exportLocalPriceSnapshot(process.argv[4], process.argv[6], asOf, 62, process.argv[10]), null, 2));
  } else if (command === "daily") {
    if (process.argv.length > 3) throw new PriceError("unexpected_price_job_argument");
    const result = await runDailyPriceJob();
    console.log(JSON.stringify(result, null, 2));
    const success = result.status === "COMPLETE" || result.status === "NOT_DUE" ||
      (result.status === "REPLAY_NO_NEW_ATTEMPT" && "receipt" in result && result.receipt.status === "COMPLETE");
    if (!success) process.exitCode = 1;
  } else if (command === "refresh") {
    if (process.argv.length > 3) throw new PriceError("unexpected_price_job_argument");
    const result = await runPriceRefresh({ trigger: "job" });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "complete") process.exitCode = 1;
  } else if (command === "status") {
    if (process.env.MARKET_PRICES_STORAGE === "google-drive") {
      const { drivePriceCache } = await import("../src/server/market-prices/drive-backend.ts");
      await drivePriceCache().loadVerified();
    }
    console.log(JSON.stringify(await priceDataStatus(), null, 2));
  }
  else throw new PriceError("invalid_price_job_command");
} catch (error) {
  console.error(error instanceof PriceError ? error.code : "price_command_failed");
  process.exitCode = 1;
}

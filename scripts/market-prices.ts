import { runPriceRefresh } from "../src/server/market-prices/collector.ts";
import { priceDataStatus } from "../src/server/market-prices/status.ts";
import { PriceError } from "../src/server/market-prices/model.ts";

const command = process.argv[2] ?? "status";
try {
  if (command === "refresh") {
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

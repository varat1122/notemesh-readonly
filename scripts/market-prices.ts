import { refreshPrices } from "../src/server/market-prices/collector.ts";
import { readCachedPrices } from "../src/server/market-prices/backend.ts";

const command = process.argv[2] ?? "status";
try {
  if (command === "refresh") {
    const result = await refreshPrices({ force: process.argv.includes("--force") });
    console.log(JSON.stringify(result, null, 2));
    if (!["complete", "batch_complete"].includes(result.status)) process.exitCode = 1;
  } else if (command === "status") {
    if (process.env.MARKET_PRICES_STORAGE === "google-drive") {
      const { drivePriceCache } = await import("../src/server/market-prices/drive-backend.ts");
      await drivePriceCache().loadVerified();
    }
    console.log(JSON.stringify(await readCachedPrices(store => store.status()), null, 2));
  }
  else throw new Error("Usage: node scripts/market-prices.ts status|refresh [--force]");
} catch (error) {
  console.error(error instanceof Error ? error.message : "price_command_failed");
  process.exitCode = 1;
}

import { refreshPrices } from "../src/server/market-prices/collector.ts";
import { readPriceStore } from "../src/server/market-prices/store.ts";

const command = process.argv[2] ?? "status";
try {
  if (command === "refresh") {
    const result = await refreshPrices({ force: process.argv.includes("--force") });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "complete") process.exitCode = 1;
  } else if (command === "status") console.log(JSON.stringify(readPriceStore(store => store.status()), null, 2));
  else throw new Error("Usage: node scripts/market-prices.ts status|refresh [--force]");
} catch (error) {
  console.error(error instanceof Error ? error.message : "price_command_failed");
  process.exitCode = 1;
}

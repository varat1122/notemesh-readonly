// Bundle the existing price CLI into the existing server image. No new runtime,
// dependency, scheduler resource, HTTP endpoint or model is introduced.
import { createRequire } from "node:module";
const { build } = createRequire(import.meta.resolve("vinxi"))("esbuild");
await build({ entryPoints: ["scripts/market-prices.ts"], bundle: true, packages: "external",
  platform: "node", format: "esm", target: "node24", outfile: ".output/server/price-job.mjs" });

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { marketSchema, isoDate, PriceError, BENCHMARKS } from "../market-prices/model.ts";
import { readCachedPrices } from "../market-prices/backend.ts";
import { eventAnalysisSchema, analyzePriceEvent } from "../market-prices/event-analysis.ts";
import { priceDataStatus } from "../market-prices/status.ts";

// Internal dependency seam for a disposable archive demo; never a tool argument or HTTP option.
export function registerPriceTools(server: McpServer, reader = readCachedPrices): void {
  if (process.env.MARKET_PRICES_ENABLED !== "1") return;
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: process.env.MARKET_PRICES_STORAGE === "google-drive" };
  const reply = async (read: () => unknown) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await read()) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text" as const,
      text: error instanceof PriceError ? error.code : "price_query_failed" }] }; }
  };
  server.registerTool("list_price_instruments", {
    title: "List cached price instruments", annotations,
    description: "List instruments with locally cached daily OHLCV, currency, exchange timezone, coverage and latest refresh error. Drive mode may read its verified catalogue; no quote downloads or writes. Listings, DRs and ADRs are distinct instruments.",
    inputSchema: {},
  }, () => reply(() => reader(store => ({ instruments: store.instruments() }))));
  server.registerTool("read_price_bars", {
    title: "Read daily OHLCV", annotations,
    description: "Read cached daily series schema v2: nullable OHLC/volume are labelled close_only or ohlc_without_volume, never invented. Inspect identity, rights, session date, fetchedAt, raw/adjusted basis, corrections and freshness. GLD is an ETF, not spot gold or a future; ^GSPC is an index, not SPY. Drive mode may read a verified stored partition. No provider quote requests, refresh or Vault writes.",
    inputSchema: { market: marketSchema, symbol: z.string().min(1).max(20).describe("Local symbol without Yahoo suffix, e.g. NVDA / PTT / 9988 / 7203"),
      start: isoDate.optional().describe("Inclusive exchange-local date"), end: isoDate.optional().describe("Inclusive exchange-local date"),
      limit: z.number().int().min(1).max(1500).default(100).describe("Latest bars in range, returned oldest first; narrow dates for earlier history") },
  }, ({ market, symbol, start, end, limit }) => reply(() => reader(store => store.read({ market, symbol }, start, end, limit), [{ market, symbol }])));
  server.registerTool("get_price_data_status", {
    title: "Price data coverage and freshness", annotations,
    description: "Read cached market-price coverage, source policy, refresh receipts, revisions and storage budget. Does not prove exchange-certified correctness or Obsidian device sync. No writes or quote-provider requests; Drive mode may read its catalogue.",
    inputSchema: {},
  }, () => reply(() => priceDataStatus(reader)));
  server.registerTool("analyze_price_event", {
    title: "Compare returns around an event", annotations,
    description: "Compare cached stock and same-market benchmark returns over 1–60 observed benchmark sessions. Requires a caller-verified first affected session and publication timing. Unknown timing refuses calculation. Reports missing/quarantined data, sample hash and ETF proxy identity. Association only; not causal attribution, CAR, a point-in-time backtest or a trade execution estimate. Read the source/thesis in Obsidian first; this tool never writes notes or fetches live/provider data; Drive mode may read the requested stored partitions.",
    inputSchema: eventAnalysisSchema.shape,
  }, args => reply(() => reader(store => analyzePriceEvent(store, args), [{ market: args.market, symbol: args.symbol }, args.benchmark ?? BENCHMARKS[args.market]])));
}

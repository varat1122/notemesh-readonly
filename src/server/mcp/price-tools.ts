import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { marketSchema, isoDate, PriceError } from "../market-prices/model.ts";
import { readPriceStore } from "../market-prices/store.ts";
import { eventAnalysisSchema, analyzePriceEvent } from "../market-prices/event-analysis.ts";

export function registerPriceTools(server: McpServer): void {
  if (process.env.MARKET_PRICES_ENABLED !== "1") return;
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const reply = (read: () => unknown) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(read()) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text" as const,
      text: error instanceof PriceError ? error.code : "price_query_failed" }] }; }
  };
  server.registerTool("list_price_instruments", {
    title: "List cached price instruments", annotations,
    description: "List instruments with locally cached daily OHLCV, currency, exchange timezone, coverage and latest refresh error. No network requests or writes. Listings, DRs and ADRs are distinct instruments.",
    inputSchema: {},
  }, () => reply(() => readPriceStore(store => ({ instruments: store.instruments() }))));
  server.registerTool("read_price_bars", {
    title: "Read daily OHLCV", annotations,
    description: "Read cached daily OHLCV and separate provider adjustedClose, dividends and splits. Conservative next-day data, not live quotes. Inspect fetchedAt and refresh errors. Never substitute a DR/ADR or other listing. This tool cannot fetch, change prices, write notes or refresh data.",
    inputSchema: { market: marketSchema, symbol: z.string().min(1).max(20).describe("Local symbol without Yahoo suffix, e.g. NVDA / PTT / 9988 / 7203"),
      start: isoDate.optional().describe("Inclusive exchange-local date"), end: isoDate.optional().describe("Inclusive exchange-local date"),
      limit: z.number().int().min(1).max(1500).default(100).describe("Latest bars in range, returned oldest first; narrow dates for earlier history") },
  }, ({ market, symbol, start, end, limit }) => reply(() => readPriceStore(store => store.read({ market, symbol }, start, end, limit))));
  server.registerTool("get_price_data_status", {
    title: "Price data coverage and freshness", annotations,
    description: "Read cached market-price coverage, source policy, refresh receipts, revisions and storage budget. Does not prove exchange-certified correctness or Obsidian device sync. No writes or external requests.",
    inputSchema: {},
  }, () => reply(() => readPriceStore(store => store.status())));
  server.registerTool("analyze_price_event", {
    title: "Compare returns around an event", annotations,
    description: "Compare cached stock and same-market benchmark returns over 1–60 observed benchmark sessions. Requires a caller-verified first affected session and publication timing. Unknown timing refuses calculation. Reports missing/quarantined data, sample hash and ETF proxy identity. Association only; not causal attribution, CAR, a point-in-time backtest or a trade execution estimate. Read the source/thesis in Obsidian first; this tool never writes notes or fetches data.",
    inputSchema: eventAnalysisSchema.shape,
  }, args => reply(() => readPriceStore(store => analyzePriceEvent(store, args))));
}

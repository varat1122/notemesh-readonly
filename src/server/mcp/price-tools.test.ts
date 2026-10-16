import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server";
import { PriceStore, priceDbPath } from "../market-prices/store";
import { parseYahooChart } from "../market-prices/yahoo";
import { chartFixture, TEST_NOW } from "../market-prices/fixtures";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "price-mcp-")); vi.stubEnv("DATA_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function connect(read = true) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ read, write: false, label: "test" });
  const client = new Client({ name: "test", version: "1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

it("keeps the existing tool list unchanged when disabled and creates no price files", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "0"); const c = await connect();
  try { expect((await c.client.listTools()).tools.some(t => t.name.includes("price"))).toBe(false); }
  finally { await c.close(); }
  expect(fs.existsSync(priceDbPath())).toBe(false);
});
it("does not expose price tools without read scope", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); const c = await connect(false);
  try {
    expect(c.client.getServerCapabilities()?.tools).toBeUndefined();
    await expect(c.client.listTools()).rejects.toThrow("Method not found");
  }
  finally { await c.close(); }
});
it("exposes only cached read tools and reads actual SQLite data through MCP", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1");
  const store = new PriceStore(priceDbPath(), true);
  store.save(parseYahooChart(chartFixture(), { market: "US", symbol: "NVDA" }, TEST_NOW)); store.close();
  fs.mkdirSync(path.join(root, "vault")); fs.writeFileSync(path.join(root, "vault", "Original.md"), "original");
  const bytesBefore = fs.readFileSync(priceDbPath());
  const network = vi.spyOn(globalThis, "fetch");
  const c = await connect();
  try {
    const prices = (await c.client.listTools()).tools.filter(t => t.name.includes("price"));
    expect(prices.map(t => t.name).sort()).toEqual(["analyze_price_event", "get_price_data_status", "list_price_instruments", "read_price_bars"]);
    expect(prices.every(t => t.annotations?.readOnlyHint && t.annotations.openWorldHint === false)).toBe(true);
    const response = await c.client.callTool({ name: "read_price_bars", arguments: { market: "US", symbol: "NVDA", limit: 1 } });
    const body = JSON.parse((response.content as { text: string }[])[0].text);
    expect(body).toMatchObject({ instrument: { currency: "USD" }, total: 2, count: 1, truncated: true });
    expect(body.bars[0].date).toBe("2026-10-15");
    const invalid = await c.client.callTool({ name: "read_price_bars", arguments: { market: "US", symbol: "../NVDA" } });
    expect(invalid.isError).toBe(true);
    expect(network).not.toHaveBeenCalled();
    expect(fs.readFileSync(priceDbPath())).toEqual(bytesBefore);
    expect(fs.readFileSync(path.join(root, "vault", "Original.md"), "utf8")).toBe("original");
  } finally { network.mockRestore(); await c.close(); }
});

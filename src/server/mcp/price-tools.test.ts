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
import { packPriceCatalogue } from "../market-prices/drive-catalogue";
import { packDriveArchive } from "../market-prices/drive-archive";
import { drivePriceCache } from "../market-prices/drive-backend";

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
it("reads only a requested Drive partition on a cold MCP cache without quote requests or writes", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_STORAGE", "google-drive");
  vi.stubEnv("ENCRYPTION_KEY", "12".repeat(32));
  const memory = new PriceStore(":memory:", true);
  memory.save(parseYahooChart(chartFixture(), { market: "US", symbol: "NVDA" }, TEST_NOW));
  const database = memory.db.serialize(), packed = packDriveArchive(database); memory.close();
  const catalogue = packPriceCatalogue({ version: 2, updatedAt: TEST_NOW.toISOString(), providerRetryAfter: null, entries: [{
    instrument: { market: "US", symbol: "NVDA" }, archiveId: "archive1", databaseBytes: database.length, barCount: 2,
    firstDate: "2026-10-14", lastDate: "2026-10-15", lastFetchedAt: TEST_NOW.toISOString(), lastSuccessfulRefresh: TEST_NOW.toISOString(),
    lastAttemptAt: TEST_NOW.toISOString(), lastAttemptSuccess: true, lastError: null, qualityIssueCount: 0, lastFullRefreshAt: TEST_NOW.toISOString() }] });
  // Test the production cache loader with Drive API fixtures, not a tool-side fetch.
  const { sealDriveCredential } = await import("../market-prices/drive-auth");
  vi.stubEnv("BASE_URL", "https://investment.example");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("MARKET_PRICES_DRIVE_CREDENTIAL", sealDriveCredential("refresh-test-token"));
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "access-test-token", token_type: "Bearer", expires_in: 3600 }));
    if (url.includes("alt=media")) return new Response(new Uint8Array(url.includes("catalogue1") ? catalogue : packed));
    const query = new URL(url).searchParams.get("q") ?? "";
    return new Response(JSON.stringify({ files: [{ id: query.includes("mimeType=") ? "folder1" : "catalogue1" }] }));
  });
  await drivePriceCache().loadVerified(); network.mockClear();
  const c = await connect();
  try {
    const result = await c.client.callTool({ name: "read_price_bars", arguments: { market: "US", symbol: "NVDA" } });
    const body = JSON.parse((result.content as { text: string }[])[0].text);
    expect(body).toMatchObject({ total: 2, archive: { backend: "google-drive", catalogueId: "catalogue1" } });
    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0][0])).toContain("/archive1?alt=media");
    expect(network.mock.calls[0][1]?.method).toBeUndefined(); network.mockClear();
    await c.client.callTool({ name: "read_price_bars", arguments: { market: "US", symbol: "NVDA" } });
    expect(network).not.toHaveBeenCalled(); expect(fs.readdirSync(root)).toEqual([]);
  } finally { await c.close(); network.mockRestore(); drivePriceCache().close(); }
});

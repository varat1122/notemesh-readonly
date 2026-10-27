import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ signedIn: true }));
vi.mock("~/server/auth", () => ({ runAuthMigrations: async () => {}, auth: { api: {
  getSession: async () => state.signedIn ? { user: { id: "synthetic-admin" } } : null } } }));
vi.mock("~/server/market-prices/collector", async original => ({ ...await original<typeof import("~/server/market-prices/collector")>(),
  runPriceRefresh: vi.fn(async () => ({ status: "complete", batches: 2, remainingDue: 0, results: [] })) }));
import { runPriceRefresh } from "~/server/market-prices/collector";
import { GET, POST } from "./market-prices-drive";
import { GET as callback } from "./market-prices-drive/callback";
const origin = "https://drive-admin.example";
const event = (request: Request) => ({ request }) as Parameters<typeof GET>[0];
beforeEach(() => {
  state.signedIn = true; vi.stubEnv("BASE_URL", origin); vi.stubEnv("ENCRYPTION_KEY", "12".repeat(32));
  vi.mocked(runPriceRefresh).mockClear();
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("MARKET_PRICES_DRIVE_CLIENT_SECRET", "test-client-secret");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("requires an existing admin session for setup, consent and callback", async () => {
  state.signedIn = false;
  expect((await GET(event(new Request(origin + "/api/market-prices-drive")))).status).toBe(401);
  expect((await POST(event(new Request(origin + "/api/market-prices-drive", { method: "POST", headers: { Origin: origin } })))).status).toBe(401);
  expect((await callback(event(new Request(origin + "/api/market-prices-drive/callback?state=x&code=x")))).status).toBe(401);
});
it.each([undefined, "https://evil.example"])("rejects cross-origin consent: %s", async incoming => {
  const r = await POST(event(new Request(origin + "/api/market-prices-drive", { method: "POST", headers: incoming ? { Origin: incoming } : {} })));
  expect(r.status).toBe(403);
});
it("renders exact configuration without leaking client secrets or stored credentials", async () => {
  vi.stubEnv("MARKET_PRICES_DRIVE_CREDENTIAL", "stored-secret-value");
  const r = await GET(event(new Request(origin + "/api/market-prices-drive"))), html = await r.text();
  expect(html).toContain(origin + "/api/market-prices-drive/callback");
  expect(html).not.toContain("test-client-secret"); expect(html).not.toContain("stored-secret-value");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});
it("clears the OAuth code from the URL before a one-use encrypted credential is displayed", async () => {
  const consent = await POST(event(new Request(origin + "/api/market-prices-drive", { method: "POST", headers: { Origin: origin } })));
  const url = new URL(consent.headers.get("location")!), pending = url.searchParams.get("state")!;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600,
    refresh_token: "test-refresh-token", scope: "https://www.googleapis.com/auth/drive.file" })));
  const result = await callback(event(new Request(origin + `/api/market-prices-drive/callback?state=${pending}&code=private-code`)));
  expect(result.status).toBe(303);
  const location = result.headers.get("location")!;
  expect(location).not.toContain("private-code"); expect(location).not.toContain("test-refresh-token");
  const display = await GET(event(new Request(location))), html = await display.text();
  expect(html).toContain("<textarea"); expect(html).not.toContain("test-refresh-token");
  expect((await GET(event(new Request(location)))).status).toBe(400);
});

const refreshRequest = (body = "action=refresh", requestOrigin = origin) => event(new Request(origin + "/api/market-prices-drive", {
  method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/x-www-form-urlencoded" }, body }));
it("requires activation, session and same Origin for the manual price update", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "0");
  expect((await POST(refreshRequest())).status).toBe(403);
  vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1"); state.signedIn = false;
  expect((await POST(refreshRequest())).status).toBe(401); state.signedIn = true;
  expect((await POST(refreshRequest("action=refresh", "https://evil.example"))).status).toBe(403);
  expect(runPriceRefresh).not.toHaveBeenCalled();
});
it("runs only the configured watchlist and never accepts caller paths, force or oversized forms", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1");
  for (const body of ["action=refresh&path=/vault", "action=refresh&force=1", "action=refresh&action=refresh", "action="+"x".repeat(129)]) {
    expect((await POST(refreshRequest(body))).status).toBe(400);
  }
  expect(runPriceRefresh).not.toHaveBeenCalled();
  const result = await POST(refreshRequest()); expect(result.status).toBe(200);
  expect(runPriceRefresh).toHaveBeenCalledExactlyOnceWith({ trigger: "admin" });
  expect(await result.text()).toContain("No Vault note was written");
  expect(result.headers.get("cache-control")).toBe("no-store");
});
it("shows the update button only after activation and reports an incomplete run without success", async () => {
  vi.stubEnv("MARKET_PRICES_ENABLED", "1"); vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "0");
  expect(await (await GET(event(new Request(origin+"/api/market-prices-drive")))).text()).not.toContain('value="refresh"');
  vi.stubEnv("MARKET_PRICES_REFRESH_ENABLED", "1");
  expect(await (await GET(event(new Request(origin+"/api/market-prices-drive")))).text()).toContain('value="refresh"');
  vi.mocked(runPriceRefresh).mockResolvedValueOnce({ status: "pending_time_limit", trigger: "admin", startedAt: "2026-10-27T06:00:00Z",
    finishedAt: "2026-10-27T06:05:00Z", universeSize: 8, batches: 1, remainingDue: 3, results: [] });
  expect((await POST(refreshRequest())).status).toBe(409);
});

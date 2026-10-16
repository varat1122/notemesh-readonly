import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ signedIn: true }));
vi.mock("~/server/auth", () => ({ runAuthMigrations: async () => {}, auth: { api: {
  getSession: async () => state.signedIn ? { user: { id: "synthetic-admin" } } : null } } }));
import { GET, POST } from "./market-prices-drive";
import { GET as callback } from "./market-prices-drive/callback";
const origin = "https://drive-admin.example";
const event = (request: Request) => ({ request }) as Parameters<typeof GET>[0];
beforeEach(() => {
  state.signedIn = true; vi.stubEnv("BASE_URL", origin); vi.stubEnv("ENCRYPTION_KEY", "12".repeat(32));
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

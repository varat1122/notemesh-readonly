import { beforeEach, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
const state = vi.hoisted(() => ({ revoked: false }));
const origin = "https://jwt-fixture.test";
vi.mock("../env", () => ({ env: { baseUrl: "https://jwt-fixture.test" } }));
vi.mock("@better-auth/oauth-provider/resource-client", () => ({ oauthProviderResourceClient: () => ({
  getActions: () => ({ verifyBearerToken: async (token: string, options: { verifyOptions: Record<string, unknown> }) => {
    // A synthetic signed JWT exercises the real issuer/audience verification
    // with the options supplied by our handler, without a network JWKS server.
    const { jwtVerify } = await import("jose");
    return (await jwtVerify(token, new TextEncoder().encode("synthetic-endpoint-binding-test-key"), options.verifyOptions)).payload;
  } }),
}) }));
vi.mock("./auth", () => ({
  bearerToken: (request: Request) => request.headers.get("authorization")?.slice(7),
  oauthClientExists: () => !state.revoked,
  accessFromScopes: (scopes: string[], label: string) => ({ scopes, label }),
}));
vi.mock("./http", () => ({ serveMcp: async (_request: Request, access: unknown, endpoint: string) =>
  new Response(JSON.stringify({ access, endpoint })) }));
import { handleMcpWithOAuth } from "./oauth";
async function request(audience: string) {
  const token = await new SignJWT({ scope: "vault:read inbox:submit", client_id: "fixture-client" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(`${origin}/api/auth`)
    .setAudience(audience).setExpirationTime("5m")
    .sign(new TextEncoder().encode("synthetic-endpoint-binding-test-key"));
  return new Request(`${origin}/api/save-analysis`, { headers: { Authorization: `Bearer ${token}` } });
}
beforeEach(() => { state.revoked = false; });
it("accepts a token for the dedicated save resource", async () => {
  const response = await handleMcpWithOAuth(await request(`${origin}/api/save-analysis`), "save-analysis");
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ endpoint: "save-analysis", access: { scopes: ["vault:read", "inbox:submit"] } });
});
it("rejects a research-audience token at the save endpoint and vice versa", async () => {
  expect((await handleMcpWithOAuth(await request(`${origin}/api/mcp`), "save-analysis"))?.status).toBe(401);
  expect((await handleMcpWithOAuth(await request(`${origin}/api/save-analysis`), "research"))?.status).toBe(401);
});
it("preserves valid research and legacy-origin audiences", async () => {
  expect((await handleMcpWithOAuth(await request(`${origin}/api/mcp`), "research"))?.status).toBe(200);
  expect((await handleMcpWithOAuth(await request(origin), "save-analysis"))?.status).toBe(200);
});
it("refuses a revoked client even with a valid save-audience signature", async () => {
  state.revoked = true;
  expect((await handleMcpWithOAuth(await request(`${origin}/api/save-analysis`), "save-analysis"))?.status).toBe(401);
});

import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ apiKeyChecks: 0, oauthEndpoints: [] as string[] }));
vi.mock("~/server/auth", () => ({ runAuthMigrations: async () => {} }));
vi.mock("~/server/db", () => ({ getSetting: () => "true" }));
vi.mock("~/server/mcp/auth", () => ({
  bearerToken: (r: Request) => r.headers.get("authorization")?.slice(7) ?? null,
  looksLikeJwt: (token: string) => token === "fixture.jwt.token",
  accessFromOpaqueOAuth: (token: string) => token === "scoped-oauth" ? {
    read: true, write: false, intake: true, scopes: ["vault:read", "inbox:submit"], label: "oauth:fixture",
  } : null,
  accessFromApiKey: async () => { state.apiKeyChecks++; return { read: true, write: false, label: "api-key:fixture" }; },
}));
vi.mock("~/server/mcp/http", () => ({ serveMcp: async (_request: Request, access: unknown, endpoint: string) =>
  new Response(JSON.stringify({ access, endpoint }), { status: 200 }) }));
vi.mock("~/server/mcp/oauth", () => ({ handleMcpWithOAuth: async (_request: Request, endpoint: string) => {
  state.oauthEndpoints.push(endpoint); return new Response(null, { status: 200 });
} }));
vi.mock("~/server/mcp/ratelimit", () => ({
  clientIp: () => "fixture", authFailureBlock: () => ({ blocked: false }), noteAuthFailure: () => {},
  clearAuthFailures: () => {}, shortCircuit: () => ({ blocked: false }), noteFailedCredential: () => {},
  recordAuthAttempt: () => {}, recordShortCircuit: () => {},
}));
import { POST, GET } from "./save-analysis";
import { POST as researchPost } from "./mcp";
const event = (headers: Record<string, string> = {}) => ({
  request: new Request("https://fixture.test/api/save-analysis", { method: "POST", headers }),
}) as Parameters<typeof POST>[0];
beforeEach(() => { state.apiKeyChecks = 0; state.oauthEndpoints = []; });

it("challenges unauthenticated POST and GET with this resource and both scopes", async () => {
  for (const response of [await POST(event()), GET(event())]) {
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource/api/save-analysis");
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="vault:read inbox:submit"');
  }
});
it.each<Record<string, string>>([{ "x-api-key": "receiver-key" }, { Authorization: "Bearer research-key" }])(
  "refuses API keys without even validating them: %j", async (headers) => {
    expect((await POST(event(headers))).status).toBe(401);
    expect(state.apiKeyChecks).toBe(0);
  },
);
it("dispatches verified opaque OAuth to the save-only server", async () => {
  const response = await POST(event({ Authorization: "Bearer scoped-oauth" }));
  expect(await response.json()).toMatchObject({ endpoint: "save-analysis", access: { scopes: ["vault:read", "inbox:submit"] } });
});
it("selects the correct resource audience for JWT verification", async () => {
  await POST(event({ Authorization: "Bearer fixture.jwt.token" }));
  expect(state.oauthEndpoints).toEqual(["save-analysis"]);
});
it("preserves research endpoint API-key access", async () => {
  const response = await researchPost(event({ "x-api-key": "research-key" }));
  expect(state.apiKeyChecks).toBe(1);
  expect(await response.json()).toMatchObject({ access: { label: "api-key:fixture" } });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
const current = vi.hoisted(() => ({ userId: "test-admin" as string | null }));
vi.mock("~/server/auth", () => ({
  runAuthMigrations: async () => {},
  auth: { api: { getSession: async () => current.userId ? { user: { id: current.userId } } : null } }
}));
import { GET, POST } from "./backup-drive";
import { GET as callback } from "./backup-drive/callback";
import { DR_DRIVE_CALLBACK_PATH, openDrCredential, sealDrRefreshToken } from "~/server/backup/drive-auth";

const origin = "https://notemesh-dr.example";
const event = (request: Request) => ({ request }) as Parameters<typeof GET>[0];
const post = (headers: Record<string,string> = { Origin: origin }) =>
  POST(event(new Request(origin + "/api/backup-drive", { method: "POST", headers })));
beforeEach(() => {
  current.userId = "test-admin";
  vi.stubEnv("BASE_URL", origin);
  vi.stubEnv("ENCRYPTION_KEY", "31".repeat(32));
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_ID", "test-dr-client.apps.googleusercontent.com");
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_SECRET", "fixture-dr-client-secret");
  vi.stubEnv("NOTEMESH_DRIVE_SETUP_ENABLED", "1");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("requires an existing signed-in administrator session for all DR setup endpoints", async () => {
  current.userId = null;
  expect((await GET(event(new Request(origin + "/api/backup-drive")))).status).toBe(401);
  expect((await post()).status).toBe(401);
  expect((await callback(event(new Request(origin + "/api/backup-drive/callback?state=x&code=x")))).status).toBe(401);
});

it.each([undefined, "https://evil.example", "null"])("denies missing or cross-origin POST: %s", async value => {
  const response = await post(value ? { Origin: value } : {});
  expect(response.status).toBe(403);
});

it("disables consent and callback without explicit setup gate; admin status still safe", async () => {
  vi.stubEnv("NOTEMESH_DRIVE_SETUP_ENABLED", "0");
  expect((await post()).status).toBe(403);
  expect((await callback(event(new Request(origin + "/api/backup-drive/callback?state=x&code=x")))).status).toBe(403);
  const response = await GET(event(new Request(origin + "/api/backup-drive")));
  const html = await response.text();
  expect(html).toContain("OAuth setup enabled: false");
  expect(html).not.toContain('<button type="submit">');
});

it("renders exact redirect URI with no secret disclosure, no caches and no credential refresh", async () => {
  vi.stubEnv("NOTEMESH_DRIVE_CREDENTIAL", "sensitive-sealed-credential");
  const response = await GET(event(new Request(origin + "/api/backup-drive")));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain(origin + DR_DRIVE_CALLBACK_PATH);
  expect(html).not.toContain("fixture-dr-client-secret");
  expect(html).not.toContain("sensitive-sealed-credential");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
});

it("creates one-use PKCE state bound to signed-in user, exact drive.file scope, redirect", async () => {
  const res = await post();
  expect(res.status).toBe(303);
  const url = new URL(res.headers.get("location")!);
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
  expect(url.searchParams.get("redirect_uri")).toBe(origin + DR_DRIVE_CALLBACK_PATH);
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
  expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
});

it("rejects wrong-user callback and permits the correct user once", async () => {
  const consent = await post();
  const state = new URL(consent.headers.get("location")!).searchParams.get("state")!;
  current.userId = "different-user";
  const wrong = await callback(event(new Request(origin + "/api/backup-drive/callback?state=" + state + "&code=private-code")));
  expect(wrong.status).toBe(400);
  current.userId = "test-admin";
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
    access_token: "fixture-test-access-token", token_type: "Bearer", expires_in: 3600,
    refresh_token: "fixture-test-refresh-token", scope: "https://www.googleapis.com/auth/drive.file"
  })));
  const correct = await callback(event(new Request(origin + "/api/backup-drive/callback?state=" + state + "&code=private-code")));
  expect(correct.status).toBe(303);
  const location = correct.headers.get("location")!;
  expect(location).not.toContain("private-code");
  expect(location).not.toContain("fixture-test-refresh-token");
  const response = await GET(event(new Request(location)));
  const html = await response.text();
  expect(html).toContain("<textarea readonly");
  expect(html).not.toContain("fixture-test-refresh-token");
  expect((await GET(event(new Request(location)))).status).toBe(400);
  expect((await callback(event(new Request(origin + "/api/backup-drive/callback?state=" + state + "&code=private-code")))).status).toBe(400);
});

it("refuses scope escalation and consumes state even on token exchange failure", async () => {
  const consent = await post();
  const state = new URL(consent.headers.get("location")!).searchParams.get("state")!;
  const fetch = vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
    access_token: "fixture-test-access-token", token_type: "Bearer", expires_in: 3600,
    refresh_token: "fixture-test-refresh-token", scope: "https://www.googleapis.com/auth/drive"
  })));
  const path = origin + "/api/backup-drive/callback?state=" + state + "&code=private-code";
  expect((await callback(event(new Request(path)))).status).toBe(400);
  expect((await callback(event(new Request(path)))).status).toBe(400);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("seals credential with a DR-specific key and rejects tamper, client mismatch, key rotation", () => {
  const sealed = sealDrRefreshToken("fixture-sealed-refresh-token-123");
  expect(sealed).not.toContain("fixture-sealed-refresh-token");
  expect(openDrCredential(sealed).refreshToken).toBe("fixture-sealed-refresh-token-123");
  // Flip a decoded GCM tag byte, not the final base64url characters: the
  // latter include unused padding bits and can sometimes decode unchanged.
  const chunks = sealed.split(".");
  const tag = Buffer.from(chunks[2], "base64url");
  tag[0] ^= 0x01;
  const tampered = [chunks[0], chunks[1], tag.toString("base64url")].join(".");
  expect(() => openDrCredential(tampered)).toThrow("invalid_or_missing");
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_ID", "other-client.apps.googleusercontent.com");
  expect(() => openDrCredential(sealed)).toThrow("invalid_or_missing");
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_ID", "test-dr-client.apps.googleusercontent.com");
  vi.stubEnv("ENCRYPTION_KEY", "32".repeat(32));
  expect(() => openDrCredential(sealed)).toThrow("invalid_or_missing");
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ userId: "fixture-admin" as string | null }));
vi.mock("~/server/auth", () => ({
  runAuthMigrations: async () => {},
  auth: {
    api: {
      getSession: async () =>
        current.userId ? { user: { id: current.userId }, session: { id: "fixture-session" } } : null,
    },
  },
}));
import { GET } from "./backup-drive";

const app = "https://notemesh-dr.example";
const request = () => ({ request: new Request(app + "/api/backup-drive") }) as Parameters<typeof GET>[0];

beforeEach(() => {
  current.userId = "fixture-admin";
  vi.stubEnv("BASE_URL", app);
  vi.stubEnv("ENCRYPTION_KEY", "31".repeat(32));
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_ID", "fixture-client.apps.googleusercontent.com");
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_SECRET", "fixture-dedicated-client-secret");
  vi.stubEnv("NOTEMESH_DRIVE_SETUP_ENABLED", "1");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("provides an authenticated direct Google consent link with PKCE and least-privilege scope", async () => {
  const response = await GET(request());
  const html = await response.text();
  expect(response.status).toBe(200);
  const encoded = html.match(/<a href="([^"]+)"[^>]*>Open Google consent directly/ )?.[1];
  expect(encoded).toBeTruthy();
  const link = new URL(encoded!.replace(/&amp;/g, "&"));
  expect(link.origin).toBe("https://accounts.google.com");
  expect(link.searchParams.get("client_id")).toBe("fixture-client.apps.googleusercontent.com");
  expect(link.searchParams.get("redirect_uri")).toBe(app + "/api/backup-drive/callback");
  expect(link.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
  expect(link.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
  expect(link.searchParams.get("code_challenge_method")).toBe("S256");
  expect(html).not.toContain("fixture-dedicated-client-secret");
  expect(html).toContain('target="_self"');
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it("does not render direct Google consent link for a logged out admin", async () => {
  current.userId = null;
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("accounts.google.com");
});

it("does not issue direct Google consent when the feature gate is disabled", async () => {
  vi.stubEnv("NOTEMESH_DRIVE_SETUP_ENABLED", "0");
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("Open Google consent directly");
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ authenticated: true, enabled: true, error: "" }));
vi.mock("~/server/auth", () => ({
  runAuthMigrations: async () => {},
  auth: { api: { getSession: async () =>
    consent.authenticated ? { user: { id: "fixture-admin" } } : null } },
}));
vi.mock("~/server/backup/drive-auth", () => ({
  driveSetupEnabled: () => consent.enabled,
  finishDrDriveConsent: async () => { throw Error(consent.error || "dr_oauth_state_refused"); },
}));
vi.mock("~/server/env", () => ({ env: { baseUrl: "https://fixture.example" } }));
import { GET } from "./backup-drive/callback";

const callback = (search: string) => GET({
  request: new Request("https://fixture.example/api/backup-drive/callback" + search),
} as Parameters<typeof GET>[0]);

beforeEach(() => {
  consent.authenticated = true;
  consent.enabled = true;
  consent.error = "";
});
afterEach(() => vi.restoreAllMocks());

it("diagnoses Google consent refusal without leaking Google query parameters", async () => {
  const response = await callback("?error=access_denied&state=sensitive-state");
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toContain("Google did not grant authorization");
  expect(body).not.toContain("sensitive-state");
  expect(body).not.toContain("access_denied");
});

it("diagnoses missing state without echoing state or authorization code", async () => {
  consent.error = "dr_oauth_state_refused";
  const response = await callback("?state=private-state&code=private-code");
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toContain("dr_oauth_state_refused");
  expect(body).not.toContain("private-state");
  expect(body).not.toContain("private-code");
});

it("categorizes Google exchange errors but never prints secret data", async () => {
  consent.error = "dr_oauth_token_exchange_failed";
  const response = await callback("?state=private-state&code=private-code");
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("dr_oauth_token_exchange_failed");
});

it("sanitizes unexpected exception messages", async () => {
  consent.error = "secret and token data here";
  const response = await callback("?state=s&code=c");
  expect(response.status).toBe(400);
  const body = await response.text();
  expect(body).toContain("dr_oauth_callback_failed");
  expect(body).not.toContain("secret and token data");
});

it("rejects missing admin session before inspecting Google callback", async () => {
  consent.authenticated = false;
  expect((await callback("?error=access_denied")).status).toBe(401);
});

it("rejects disabled DR setup", async () => {
  consent.enabled = false;
  expect((await callback("?error=access_denied")).status).toBe(403);
});

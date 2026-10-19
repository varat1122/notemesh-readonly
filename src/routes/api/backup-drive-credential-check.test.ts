import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ userId: "dr-test-admin" as string | null, sessionId: "dr-test-session" }));
vi.mock("~/server/auth", () => ({
  runAuthMigrations: async () => {},
  auth: { api: { getSession: async () => fake.userId ? {
    user: { id: fake.userId }, session: { id: fake.sessionId },
  } : null } },
}));
import { POST } from "./backup-drive/credential-check";
import { issueDrConsentFormProof } from "~/server/backup/drive-consent-form";
import { sealDrRefreshToken } from "~/server/backup/drive-auth";
import { env } from "~/server/env";

const origin = "https://notemesh-dr-staging.example";
const call = (opts: { proof?: string; origin?: string; referer?: string } = {}) => {
  const proof = opts.proof === undefined ?
    issueDrConsentFormProof(fake.sessionId, env.encryptionKey) : opts.proof;
  const headers: Record<string,string> = { "Content-Type":"application/x-www-form-urlencoded" };
  if (opts.origin !== undefined) headers.Origin = opts.origin;
  if (opts.referer !== undefined) headers.Referer = opts.referer;
  return POST({ request:new Request(origin + "/api/backup-drive/credential-check", {
    method:"POST",headers,body:new URLSearchParams({dr_consent_proof:proof}),
  }) } as Parameters<typeof POST>[0]);
};
beforeEach(() => {
  fake.userId = "dr-test-admin";
  vi.stubEnv("BASE_URL", origin);
  vi.stubEnv("ENCRYPTION_KEY", "31".repeat(32));
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
  vi.stubEnv("NOTEMESH_DRIVE_SETUP_ENABLED", "1");
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_ID", "fixture-dr-client.apps.googleusercontent.com");
  vi.stubEnv("NOTEMESH_DRIVE_CLIENT_SECRET", "fixture-dr-client-secret");
  vi.stubEnv("NOTEMESH_DRIVE_CREDENTIAL", sealDrRefreshToken("fixture-dr-refresh-token-123"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("rejects prod even if DR feature is enabled", async () => {
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
  expect((await call()).status).toBe(403);
});
it("requires admin session", async () => {
  fake.userId = null;
  expect((await call()).status).toBe(401);
});
it("rejects cross origin and unproven form", async () => {
  expect((await call({origin:"https://attacker.example"})).status).toBe(403);
  expect((await call({referer:"https://attacker.example/x"})).status).toBe(403);
  expect((await call({proof:"bogus"})).status).toBe(403);
});
it("reports encrypted key mismatch without sending Google request", async () => {
  const spy = vi.spyOn(globalThis,"fetch");
  vi.stubEnv("ENCRYPTION_KEY", "32".repeat(32));
  const response = await call();
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("dr_credential_invalid");
  expect(spy).not.toHaveBeenCalled();
});
it("tests refresh with Google without exposing tokens or touching Google Drive", async () => {
  const spy = vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
    access_token:"fixture-short-lived-access-token",
    token_type:"Bearer",scope:"https://www.googleapis.com/auth/drive.file",
  }), {status:200,headers:{"Content-Type":"application/json"}}));
  const response = await call({origin});
  const output = await response.text();
  expect(response.status).toBe(200);
  expect(output).toContain("PASS:");
  expect(output).not.toContain("fixture-dr-refresh-token");
  expect(output).not.toContain("fixture-short-lived-access-token");
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
  const payload = spy.mock.calls[0]![1]?.body as URLSearchParams;
  expect(payload.get("grant_type")).toBe("refresh_token");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("reports only Google HTTP status on failure, without leaking its error body", async () => {
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(
    '{"error":"invalid_grant","secret":"must-not-echo"}', {status:400}));
  const response = await call();
  expect(response.status).toBe(502);
  const output = await response.text();
  expect(output).toContain("HTTP 400");
  expect(output).not.toContain("must-not-echo");
  expect(output).not.toContain("invalid_grant");
});
it("rejects Google scope escalation", async () => {
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({
    access_token:"fixture-access-token",
    token_type:"Bearer",scope:"https://www.googleapis.com/auth/drive",
  }),{status:200}));
  const response = await call();
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("dr_refresh_scope_invalid");
});

it("blocks direct Better Auth adapter before staging credential smoke test during freeze",async()=>{
  const {inProcessDrWriterFence:fence}=await import("~/server/backup/writer-fence");
  await fence.withFrozenWriters(async()=>{
    await expect(call({origin})).rejects.toThrow("backup_writer_freeze_active");
    expect(fence.getAdmissionEvidence().activeWriters).toBe(0);
  });
});

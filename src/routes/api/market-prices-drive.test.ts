import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ signedIn: true, calls:0, hold:null as Promise<void>|null }));
vi.mock("~/server/auth", () => ({ runAuthMigrations: async () => {}, auth: { api: {
  getSession: async () => {state.calls++;if(state.hold)await state.hold;return state.signedIn ? { user: { id: "synthetic-admin" } } : null;} } } }));
import { GET, POST } from "./market-prices-drive";
import { GET as callback } from "./market-prices-drive/callback";
const origin = "https://drive-admin.example";
const event = (request: Request) => ({ request }) as Parameters<typeof GET>[0];
beforeEach(() => {
  state.signedIn = true; state.calls=0;state.hold=null; vi.stubEnv("BASE_URL", origin); vi.stubEnv("ENCRYPTION_KEY", "12".repeat(32));
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


it("refuses direct price Drive setup and callback adapter access during freeze",async()=>{
  const {inProcessDrWriterFence:fence}=await import("~/server/backup/writer-fence");
  await fence.withFrozenWriters(async()=>{
    await expect(GET(event(new Request(origin+"/api/market-prices-drive")))).rejects.toThrow("backup_writer_freeze_active");
    await expect(POST(event(new Request(origin+"/api/market-prices-drive",{method:"POST",headers:{Origin:origin}})))).rejects.toThrow("backup_writer_freeze_active");
    await expect(callback(event(new Request(origin+"/api/market-prices-drive/callback?state=synthetic")))).rejects.toThrow("backup_writer_freeze_active");
    expect(state.calls).toBe(0);
    expect(fence.getAdmissionEvidence().activeWriters).toBe(0);
  });
});

it("counts direct price Drive session through awaited adapter work",async()=>{
  const {inProcessDrWriterFence:fence}=await import("~/server/backup/writer-fence");
  let release!:()=>void;
  state.hold=new Promise<void>(resolve=>{release=resolve;});
  const pending=GET(event(new Request(origin+"/api/market-prices-drive")));
  await vi.waitFor(()=>expect(state.calls).toBe(1));
  expect(fence.getAdmissionEvidence().activeByClass.better_auth_adapter).toBe(1);
  let cutRan=false;
  const freeze=fence.withFrozenWriters(()=>{cutRan=true;return "fixture-only";});
  expect(cutRan).toBe(false);
  await expect(callback(event(new Request(origin+"/api/market-prices-drive/callback?state=synthetic")))).rejects.toThrow("backup_writer_freeze_active");
  expect(state.calls).toBe(1);
  release();
  expect((await pending).status).toBe(200);
  await expect(freeze).resolves.toBe("fixture-only");
  expect(fence.status).toEqual({frozen:false,activeWriters:0});
});

import { afterAll, beforeAll, expect, it } from "vitest";
import { startServer, claimAdmin, type Server } from "./harness";

let server: Server;
let cookie: string;
beforeAll(async () => { server = await startServer(); cookie = await claimAdmin(server); }, 60000);
afterAll(async () => { await server?.stop(); });
it("routes the Drive setup/callback to their real admin guards instead of middleware 404", async () => {
  for (const path of ["/api/market-prices-drive", "/api/market-prices-drive/callback"]) {
    const response = await fetch(server.url + path);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  }
});
it("retains exact Origin and admin-session checks for routed consent POSTs", async () => {
  const path = server.url + "/api/market-prices-drive";
  expect((await fetch(path, { method: "POST", headers: { Origin: "https://evil.example" } })).status).toBe(403);
  expect((await fetch(path, { method: "POST", headers: { Origin: server.url } })).status).toBe(401);
});
it("serves the authenticated setup and safely refuses an unconfigured OAuth client", async () => {
  const path = server.url + "/api/market-prices-drive";
  const response = await fetch(path, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(server.url + "/api/market-prices-drive/callback");
  expect(html).toContain("OAuth setup is not ready yet");
  expect((await fetch(path, { method: "POST", headers: { Origin: server.url, Cookie: cookie }, redirect: "manual" })).status).toBe(400);
});
it("keeps unknown Drive/API subpaths closed", async () => {
  for (const path of ["/api/market-prices-drive/unknown", "/api/market-prices-drive/callback/unknown"]) {
    expect((await fetch(server.url + path)).status).toBe(404);
  }
});

import { beforeAll, afterAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { decodeJwt } from "jose";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-refresh-scope-"));
const origin = "http://localhost:19874";
process.env.DATA_DIR = root;
process.env.BASE_URL = origin;
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
let auth: typeof import("./auth")["auth"];
let cookie: string;
beforeAll(async () => {
  const module = await import("./auth"); auth = module.auth; await module.runAuthMigrations();
  const res = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method:"POST", headers:{"Content-Type":"application/json", Origin:origin},
    body:JSON.stringify({email:"synthetic@example.com", password:"synthetic-fixture-passphrase", name:"Fixture"}),
  }));
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}, 30000);
afterAll(async () => { (await import("./db")).db().close(); delete process.env.DATA_DIR; delete process.env.BASE_URL; delete process.env.ENCRYPTION_KEY; });

async function post(endpoint: string, body: Record<string, unknown>, form = false) {
  return auth.handler(new Request(`${origin}/api/auth/oauth2/${endpoint}`, {
    method:"POST", headers:{"Content-Type":form ? "application/x-www-form-urlencoded" : "application/json", Origin:origin, Cookie:cookie},
    body:form ? new URLSearchParams(body as Record<string,string>) : JSON.stringify(body),
  }));
}
async function connect(scopes: string, resource = `${origin}/api/mcp`) {
  const reg = await (await post("register", {client_name:"synthetic-refresh-test", redirect_uris:["https://example.com/cb"], grant_types:["authorization_code","refresh_token"], response_types:["code"], token_endpoint_auth_method:"none"})).json();
  expect(typeof reg.client_id).toBe("string");
  const params = new URLSearchParams({client_id:reg.client_id, response_type:"code", redirect_uri:"https://example.com/cb", scope:scopes, resource, code_challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method:"S256", state:"synthetic-test"});
  const res = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${params}`, {headers:{Cookie:cookie}}));
  const dest = res.headers.get("location") ?? (await res.json()).url;
  expect(dest).toContain("/oauth/consent");
  const consent = await (await post("consent", {accept:true, oauth_query:dest.split("?")[1]})).json();
  const code = new URL(consent.url ?? consent.redirectURI).searchParams.get("code");
  expect(code).toBeTruthy();
  const token = await (await post("token", {grant_type:"authorization_code", client_id:reg.client_id, code, redirect_uri:"https://example.com/cb", code_verifier:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", resource}, true)).json();
  expect(typeof token.refresh_token).toBe("string");
  return {clientId:reg.client_id as string, refreshToken:token.refresh_token as string, accessToken:token.access_token as string};
}
async function refresh(clientId: string, refreshToken: string, scope: string) {
  const res = await post("token", {grant_type:"refresh_token", client_id:clientId, refresh_token:refreshToken, scope, resource:`${origin}/api/mcp`}, true);
  return {status:res.status, body:await res.json()};
}

it("keeps the original refresh grant after minting a read token, then permits an approved submission token", async () => {
  const c = await connect("openid email offline_access vault:read inbox:submit");
  const read = await refresh(c.clientId, c.refreshToken, "openid email offline_access vault:read");
  expect(read.status).toBe(200);
  expect(decodeJwt(read.body.access_token).scope).not.toContain("inbox:submit");
  const submit = await refresh(c.clientId, read.body.refresh_token, "openid email offline_access vault:read inbox:submit");
  expect(submit.status, submit.body.error_description).toBe(200);
  expect(decodeJwt(submit.body.access_token).scope).toContain("inbox:submit");
  const {oauthScopeDiagnostics} = await import("./oauth-diagnostics");
  expect(oauthScopeDiagnostics(c.clientId)?.activeRefreshScopes).toContain("inbox:submit");
});
it("never gives a read-only grant the submission scope", async () => {
  const c = await connect("openid email offline_access vault:read");
  const read = await refresh(c.clientId, c.refreshToken, "openid email offline_access vault:read");
  expect(read.status).toBe(200);
  const escalation = await refresh(c.clientId, read.body.refresh_token, "vault:read inbox:submit");
  expect(escalation.status).toBe(400);
  expect(escalation.body.error).toBe("invalid_scope");
});
it("rejects replay of the original refresh token after scope-preserving rotation", async () => {
  const c = await connect("openid offline_access vault:read inbox:submit");
  const rotated = await refresh(c.clientId, c.refreshToken, "vault:read");
  expect(rotated.status).toBe(200);
  expect(rotated.body.refresh_token).not.toBe(c.refreshToken);
  expect(decodeJwt(rotated.body.access_token).scope).not.toContain("inbox:submit");
  const replay = await refresh(c.clientId, c.refreshToken, "vault:read inbox:submit");
  expect(replay.status).toBe(400);
  expect(replay.body.error).toBe("invalid_grant");
});
it("issues an explicitly approved grant for the dedicated save resource", async () => {
  const resource = `${origin}/api/save-analysis`;
  const connection = await connect("openid email offline_access vault:read inbox:submit", resource);
  const jwt = decodeJwt(connection.accessToken);
  expect([jwt.aud].flat()).toContain(resource);
  expect(String(jwt.scope).split(" ")).toEqual(expect.arrayContaining(["vault:read", "inbox:submit"]));
});

it("issues edit scope only after explicit Safe Edit consent on a fresh client", async () => {
  const resource = `${origin}/api/safe-edit`;
  const connection = await connect("openid email offline_access vault:read vault:edit", resource);
  const jwt = decodeJwt(connection.accessToken);
  expect([jwt.aud].flat()).toContain(resource);
  expect([jwt.aud].flat()).not.toContain(`${origin}/api/mcp`);
  expect(String(jwt.scope).split(" ")).toContain("vault:edit");
});
it.each(["vault:read", "vault:read inbox:submit"])("never widens an existing %s refresh grant into edit", async scopes => {
  const c = await connect(`openid offline_access ${scopes}`);
  const res = await post("token", {grant_type:"refresh_token",client_id:c.clientId,refresh_token:c.refreshToken,scope:"vault:read vault:edit",resource:`${origin}/api/safe-edit`},true);
  expect(res.status).toBe(400);
  const body=await res.json();
  expect(["invalid_scope","invalid_target"]).toContain(body.error);
});

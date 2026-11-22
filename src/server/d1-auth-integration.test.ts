import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "d1-auth-g01-"));
process.env.DATA_DIR = root;
process.env.BASE_URL = "http://localhost:3000";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const { auth, runAuthMigrations } = await import("./auth");
const { db } = await import("./db");
const registration = (n: number) => ({ body: {
  client_name: `Synthetic G01 ${n}`, redirect_uris: ["https://client.example.invalid/callback"],
  token_endpoint_auth_method: "none" as const,
} });
let cookie = "";

describe("G01 actual Better Auth 1.7.7 / Kysely / SQLite", () => {
  it("lazy import has no SQLite/bootstrap effects", () => {
    expect(fs.existsSync(path.join(root, "app.sqlite"))).toBe(false);
  });
  it("single-flight real migration, signup, login and session work", async () => {
    await Promise.all([runAuthMigrations(), runAuthMigrations(), runAuthMigrations()]);
    const send = (route: string) => auth.handler(new Request(`http://localhost:3000/api/auth/${route}`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "G01 Synthetic", email: "g01@example.invalid", password: "Synthetic-only-password-938!" }),
    }));
    const signup = await send("sign-up/email");
    const signupBody = await signup.json();
    expect(signup.status, JSON.stringify(signupBody)).toBe(200);
    const login = await send("sign-in/email");
    const loginBody = await login.json();
    expect(login.status, JSON.stringify(loginBody)).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("g01@example.invalid");
  });
  it("anonymous and signed-in DCR both create genuine clients before cap", async () => {
    const anonymous = await auth.api.registerOAuthClient(registration(0));
    const signed = await auth.api.registerOAuthClient({ ...registration(1), headers: new Headers({ cookie }) });
    expect(anonymous.client_id).toBeTruthy();
    expect(signed.client_id).toBeTruthy();
    expect(db().prepare('SELECT userId FROM "oauthClient" WHERE clientId=?').get(signed.client_id)).toMatchObject({ userId: expect.any(String) });
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({ n: 2 });
  });
  it("all-DCR atomic cap keeps exactly fifty clients and denies overflow", async () => {
    for (let n = 2; n < 49; n++) await auth.api.registerOAuthClient(registration(n));
    const race = await Promise.allSettled([
      auth.api.registerOAuthClient(registration(49)),
      auth.api.registerOAuthClient({ ...registration(50), headers: new Headers({ cookie }) }),
    ]);
    expect(race.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({ n: 50 });
    await expect(auth.api.registerOAuthClient({ ...registration(51), headers: new Headers({ cookie }) })).rejects.toThrow();
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({ n: 50 });
  });
  it("24-hour abandoned-client eviction permits a fresh genuine DCR", async () => {
    // Disposable fault/chronology fixture only; no receipt or authority is fabricated.
    db().prepare('UPDATE "oauthClient" SET createdAt=? WHERE clientId=(SELECT clientId FROM "oauthClient" LIMIT 1)')
      .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    const next = await auth.api.registerOAuthClient(registration(52));
    expect(next.client_id).toBeTruthy();
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({ n: 50 });
  });

  it("real SQLite lock never becomes cap-check permission", async () => {
    const other = new Database(path.join(root,"app.sqlite"),{timeout:0});
    try {
      other.exec("BEGIN IMMEDIATE");
      await expect(auth.api.registerOAuthClient(registration(53))).rejects.toThrow(/locked|busy/i);
    } finally {if(other.inTransaction)other.exec("ROLLBACK");other.close();}
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({n:50});
  });
  it("authenticated managed client route remains separate from DCR cap", async () => {
    const managed = await auth.api.createOAuthClient({...registration(54),headers:new Headers({cookie})});
    expect(managed.client_id).toBeTruthy();
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({n:51});
    await expect(auth.api.registerOAuthClient(registration(55))).rejects.toThrow();
    expect(db().prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get()).toEqual({n:51});
  });

  it("Auth hook waits for the owned count and refuses an already-claimed instance without a cookie", async () => {
    const { withAuthDatabaseOwner } = await import("./db");
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const owner = withAuthDatabaseOwner(async () => { entered(); await blocked; });
    await started;
    const response = auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Rejected", email: "rejected@example.invalid", password: "Synthetic-rejected-password-938!" }),
    }));
    release(); await owner;
    const denied = await response;
    expect(denied.status).toBe(403);
    expect(denied.headers.get("set-cookie")).toBeNull();
    expect(await denied.text()).toMatch(/already claimed/i);
    expect(db().prepare('SELECT COUNT(*) AS n FROM "user"').get()).toEqual({ n: 1 });
  });

  it("an Auth count denied by maintenance remains unknown, never unclaimed", async () => {
    const { beginMaintenance } = await import("./maintenance");
    beginMaintenance();
    const { authUserCount } = await import("./auth");
    expect(await authUserCount()).toMatchObject({ known: false });
    const read = new Database(path.join(root, "app.sqlite"), { readonly: true, fileMustExist: true });
    try { expect(read.prepare('SELECT COUNT(*) AS n FROM "user"').get()).toEqual({ n: 1 }); }
    finally { read.close(); }
  });

});

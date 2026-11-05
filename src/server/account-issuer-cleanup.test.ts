import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error standalone operator script is deliberately not bundled
import { cleanupAccountIssuer } from "../../scripts/account-issuer-cleanup.mjs";

// The Production shape: Better Auth 1.7.2's own DDL for account, with issuer
// second, NOT NULL and no default, plus its unique index. Captured from a fresh
// 1.7.2 migration; it is the only difference from a fresh 1.7.7 schema.
const ACCOUNT_172 = `CREATE TABLE "account" ("id" text not null primary key, "issuer" text not null, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null)`;
const COLUMNS_177 = ["id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken",
  "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"];

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-issuer-cleanup-"));
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 12).toString("base64");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function boot() {
  vi.resetModules();
  const { auth, runAuthMigrations } = await import("./auth");
  await runAuthMigrations();
  return auth;
}

/** A claimed instance whose account table is in the 1.7.2 shape; returns the db file, app connection closed. */
async function legacyInstance() {
  const auth = await boot();
  await auth.api.signUpEmail({ body: { email: "admin@example.com", password: "the-original-password", name: "Admin" } });
  const { db } = await import("./db");
  const { env } = await import("./env");
  const d = db();
  d.pragma("foreign_keys = OFF");
  d.exec(`
    ALTER TABLE account RENAME TO account_177;
    ${ACCOUNT_172};
    INSERT INTO account SELECT id, 'local:credential', ${COLUMNS_177.slice(1).map(c => `"${c}"`).join(", ")} FROM account_177;
    DROP TABLE account_177;
    CREATE INDEX "account_userId_idx" on "account" ("userId");
    CREATE UNIQUE INDEX "account_issuer_accountId_uidx" on "account" ("issuer", "accountId");
  `);
  d.close();
  return env.dbPath;
}

const columns = async () => {
  const { db } = await import("./db");
  return (db().prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(c => c.name);
};

describe("PR #135 account.issuer cleanup procedure", () => {
  it("reports without changing anything, then cleans so 1.7.7 boots and the admin signs in", async () => {
    const file = await legacyInstance();
    // That 1.7.7 refuses this shape at boot is pinned in auth-upgrade.test.ts.

    const check = cleanupAccountIssuer(file);
    expect(check).toMatchObject({ state: "needs_cleanup", applied: false, refusals: [], providers: [{ provider: "credential", n: 1 }] });
    expect(check.before.accountColumns).toContain("issuer");

    const done = cleanupAccountIssuer(file, { apply: true });
    expect(done).toMatchObject({ state: "cleaned", applied: true });
    expect(done.after.counts).toEqual(done.before.counts);
    expect(done.after.otherSchemaSha256).toBe(done.before.otherSchemaSha256);
    expect(done.after.accountColumns).toEqual(COLUMNS_177);

    const upgraded = await boot();
    expect(await columns()).toEqual(COLUMNS_177);
    const { db } = await import("./db");
    expect(db().prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='account' AND sql IS NOT NULL").all())
      .toEqual([{ name: "account_userId_idx" }]);
    const res = await upgraded.api.signInEmail({ body: { email: "admin@example.com", password: "the-original-password" } });
    expect(res.user.email).toBe("admin@example.com");
    expect(cleanupAccountIssuer(file).state).toBe("already_clean");
  });

  it("refuses accounts from another provider and leaves the table as it was", async () => {
    const file = await legacyInstance();
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(file);
    d.exec(`INSERT INTO account (id, issuer, accountId, providerId, userId, createdAt, updatedAt)
      SELECT 'other', 'https://idp.example', 'x', 'oidc', userId, createdAt, updatedAt FROM account LIMIT 1`);
    d.close();
    const result = cleanupAccountIssuer(file, { apply: true });
    expect(result.state).toBe("refused");
    expect(result.refusals).toContain("non_credential_accounts_present");
    const after = new DatabaseSync(file, { readOnly: true });
    expect((after.prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(c => c.name)).toContain("issuer");
    after.close();
  });

  it("refuses to apply while the app still holds an unflushed write-ahead log", async () => {
    const file = await legacyInstance();
    const { DatabaseSync } = await import("node:sqlite");
    const live = new DatabaseSync(file);
    live.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; UPDATE account SET scope = 'pending';");
    expect(() => cleanupAccountIssuer(file, { apply: true })).toThrow("Write-ahead log is not empty");
    live.close();
  });
});

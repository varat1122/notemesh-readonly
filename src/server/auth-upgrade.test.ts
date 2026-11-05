import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Better Auth >=1.7.3 restored the 1.6 account schema (no issuer).
// Upgrading from 1.7.2 needs a separately backed-up SQLite cleanup.
// Test both a safe pre-issuer database and fail-closed legacy issuer detection.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-authupgrade-"));
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 12).toString("base64");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function boot() {
  vi.resetModules();
  const { auth, runAuthMigrations } = await import("./auth");
  await runAuthMigrations();
  return auth;
}

/** Turn a fresh 1.7 account table into the shape 1.6 left behind. */
async function reshapeTo16() {
  const { db } = await import("./db");
  const d = db();
  d.exec(`
    CREATE TABLE account_16 AS SELECT id, accountId, providerId, userId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt FROM account;
    DROP TABLE account;
    ALTER TABLE account_16 RENAME TO account;
  `);
  const columns = (d.prepare("PRAGMA table_info(account)").all() as { name: string }[]).map((c) => c.name);
  expect(columns).not.toContain("issuer");
  return d;
}

describe("Better Auth 1.7.7 account compatibility", () => {
  it("accepts a claimed 1.6-style database without issuer and preserves admin sign-in", async () => {
    const auth = await boot();
    await auth.api.signUpEmail({
      body: { email: "admin@example.com", password: "the-original-password", name: "Admin" },
    });
    const d = await reshapeTo16();
    const upgraded = await boot();
    const cols = (d.prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(c => c.name);
    expect(cols).not.toContain("issuer");
    const res = await upgraded.api.signInEmail({
      body: { email: "admin@example.com", password: "the-original-password" },
    });
    expect(res.user.email).toBe("admin@example.com");
  });

  it("fails closed on a 1.7.2-style issuer column until operator-backed cleanup", async () => {
    const auth = await boot();
    await auth.api.signUpEmail({
      body: { email: "admin@example.com", password: "the-original-password", name: "Admin" },
    });
    const { db } = await import("./db");
    const d = db();
    d.exec("ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT 'local:credential'");
    d.exec("CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (issuer, accountId)");
    await expect(boot()).rejects.toThrow("Legacy Better Auth account.issuer detected; deployment held.");
    const cols = (d.prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain("issuer");
    const idx = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='account_issuer_accountId_uidx'").get();
    expect(idx).toBeTruthy();
  });
});

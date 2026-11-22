import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

// Better Auth >=1.7.3 restored the 1.6 account schema (no issuer).
// Upgrading from 1.7.2 needs a separately backed-up SQLite cleanup.
// Test both a safe pre-issuer database and fail-closed legacy issuer detection.

let root: string;
const coldProbe = process.env.D1_AUTH_UPGRADE_COLD;

beforeEach(() => {
  if (coldProbe) { root = process.env.DATA_DIR!; return; }
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-authupgrade-"));
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 12).toString("base64");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (coldProbe) return;
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function coldBoot(mode: "signin" | "issuer") {
  // resetModules is not a process restart: D1 ownership is process-global.
  // Use the actual production modules and preserved disposable DB in a child.
  const output = execFileSync(process.execPath, [
    "node_modules/vitest/vitest.mjs", "run", "src/server/auth-upgrade.test.ts",
    "--maxWorkers=1", "--no-file-parallelism",
  ], { cwd: process.cwd(), timeout: 25_000, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    CI: "1", TZ: "UTC", DATA_DIR: root, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    D1_AUTH_UPGRADE_COLD: mode,
  } });
  expect(output.toString()).toContain(`cold-auth-${mode}-verified`);
}

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

describe.skipIf(Boolean(coldProbe))("Better Auth 1.7.7 account compatibility", () => {
  it("G06 a pre-migration native BUSY can retry without restarting or wedging the bootstrap flight", async () => {
    vi.resetModules();
    const { db } = await import("./db");
    // Disposable rollback-journal contention makes the real preflight SELECT
    // return BUSY. Identity/bootstrap was already verified by the real db().
    db().pragma("journal_mode = DELETE");
    const { runAuthMigrations, auth } = await import("./auth");
    const other = new Database(path.join(root, "app.sqlite"), { timeout: 0 });
    try {
      other.exec("BEGIN EXCLUSIVE");
      await expect(runAuthMigrations()).rejects.toThrow(/busy|locked/i);
    } finally { if (other.inTransaction) other.exec("ROLLBACK"); other.close(); }
    await new Promise(resolve => setTimeout(resolve, 120));
    await expect(Promise.all([runAuthMigrations(), runAuthMigrations()])).resolves.toEqual([undefined, undefined]);
    const signed = await auth.api.signUpEmail({ body: { email: "retry@example.invalid", password: "synthetic-retry-password-938!", name: "Retry" } });
    expect(signed.user.email).toBe("retry@example.invalid");
  });
  it("G06 a failure after entering the migrator remains terminal rather than replaying migration", async () => {
    vi.resetModules(); const { db } = await import("./db"); db();
    const { runAuthMigrations } = await import("./auth");
    const other = new Database(path.join(root, "app.sqlite"), { timeout: 0 });
    let original: unknown;
    try {
      other.exec("BEGIN IMMEDIATE");
      try { await runAuthMigrations(); } catch (error) { original = error; }
      expect(original).toBeDefined();
    } finally { if (other.inTransaction) other.exec("ROLLBACK"); other.close(); }
    await new Promise(resolve => setTimeout(resolve, 120));
    await expect(runAuthMigrations()).rejects.toBe(original);
    expect(db().prepare("SELECT name FROM sqlite_master WHERE name='user'").get()).toBeUndefined();
  });
  it("G06 repeated pre-migration BUSY has a finite attempt budget, never an automatic retry loop", async () => {
    vi.resetModules(); const { db } = await import("./db"); db().pragma("journal_mode = DELETE");
    const other = new Database(path.join(root, "app.sqlite"), { timeout: 0 });
    const { runAuthMigrations } = await import("./auth"); let last: unknown;
    try {
      other.exec("BEGIN EXCLUSIVE");
      for (let n = 0; n < 3; n++) {
        try { await runAuthMigrations(); } catch (error) { last = error; }
        expect(last).toMatchObject({ code: "SQLITE_BUSY" });
        await expect(runAuthMigrations()).rejects.toBe(last);
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    } finally { if (other.inTransaction) other.exec("ROLLBACK"); other.close(); }
    await expect(runAuthMigrations()).rejects.toBe(last);
  });
  it("accepts a claimed 1.6-style database without issuer and preserves admin sign-in", async () => {
    const auth = await boot();
    await auth.api.signUpEmail({
      body: { email: "admin@example.com", password: "the-original-password", name: "Admin" },
    });
    const d = await reshapeTo16();
    coldBoot("signin");
    const cols = (d.prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(c => c.name);
    expect(cols).not.toContain("issuer");
  }, 30_000);

  it("fails closed on a 1.7.2-style issuer column until operator-backed cleanup", async () => {
    const auth = await boot();
    await auth.api.signUpEmail({
      body: { email: "admin@example.com", password: "the-original-password", name: "Admin" },
    });
    const { db } = await import("./db");
    const d = db();
    d.exec("ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT 'local:credential'");
    d.exec("CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (issuer, accountId)");
    coldBoot("issuer");
    const cols = (d.prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain("issuer");
    const idx = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='account_issuer_accountId_uidx'").get();
    expect(idx).toBeTruthy();
  }, 30_000);
});

if (coldProbe) it("checks the preserved fixture in a genuinely fresh process", async () => {
  if (coldProbe === "issuer") {
    await expect(boot()).rejects.toThrow("Legacy Better Auth account.issuer detected; deployment held.");
  } else {
    expect(coldProbe).toBe("signin");
    const auth = await boot();
    const res = await auth.api.signInEmail({ body: {
      email: "admin@example.com", password: "the-original-password",
    } });
    expect(res.user.email).toBe("admin@example.com");
  }
  console.log(`cold-auth-${coldProbe}-verified`);
});

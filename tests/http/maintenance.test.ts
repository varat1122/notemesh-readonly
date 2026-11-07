import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimAdmin, markConfigured, rpc, startServer, type Server } from "./harness";

/**
 * The maintenance barrier against the built server: middleware ordering, the
 * real first-request hooks, and what reaches the DB and the Vault on disk.
 */

const id = "6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const record = (state = "active", rid = id) =>
  JSON.stringify({ version: 1, id: rid, state, requestedAt: "2026-11-07T00:00:00.000Z", settledAt: null, drain: null });

// Every kind of door: pages, RPC (public and admin), auth, OAuth discovery,
// MCP endpoints, Safe Edit, intake, attachments and prices.
const DOORS: [string, string][] = [
  ["GET", "/"], ["GET", "/status"], ["GET", "/login"], ["GET", "/setup"],
  ["POST", "/api/rpc/getSetupStage"], ["POST", "/api/rpc/syncNow"], ["POST", "/api/rpc/enterMaintenance"],
  ["POST", "/api/auth/sign-up/email"], ["GET", "/api/auth/get-session"],
  ["GET", "/.well-known/oauth-authorization-server"], ["GET", "/.well-known/oauth-protected-resource"],
  ["POST", "/api/mcp"], ["GET", "/api/mcp"], ["POST", "/api/save-analysis"], ["POST", "/api/safe-edit"],
  ["POST", "/api/safe-edit-approval"], ["POST", "/api/intake-worker"], ["GET", "/api/attachment"],
  ["GET", "/api/market-prices-drive"], ["POST", "/api/health"],
];

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

async function knockEverywhere(s: Server) {
  for (const [method, p] of DOORS) {
    const res = await fetch(`${s.url}${p}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: s.url },
      body: method === "POST" ? JSON.stringify(p === "/api/mcp" ? { jsonrpc: "2.0", id: 1, method: "tools/list" } : []) : undefined,
      redirect: "manual",
    });
    expect([p, method, res.status]).toEqual([p, method, 503]);
    expect(res.headers.get("retry-after")).toBe("300");
    expect((await res.json()).error).toBe("maintenance");
  }
}

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function volume(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-maint-"));
  dirs.push(d);
  return d;
}

describe("booting into maintenance", () => {
  it("NOTEMESH_MAINTENANCE=1 on a fresh volume serves only health and creates no DB, Vault or worker", async () => {
    const dataDir = volume();
    const s = await startServer({ NOTEMESH_MAINTENANCE: "1" }, { dataDir, keepDataDir: true });
    servers.push(s);
    const health = await (await fetch(`${s.url}/api/health`)).json();
    expect(health).toMatchObject({ ok: true, serving: "maintenance_only", maintenance: { active: true, source: "env", forcedByEnv: true } });
    await knockEverywhere(s);
    expect(fs.readdirSync(dataDir)).toEqual([]);
    expect(s.log()).not.toMatch(/\[indexer\]|\[git\]|\[supervisor\]|\[market-prices\]/);
  });

  it("a durable record on a configured volume leaves every DB and Vault byte untouched, across a restart", async () => {
    const dataDir = volume();
    const { default: Database } = await import("better-sqlite3");
    fs.mkdirSync(path.join(dataDir, "vault"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "vault", "Note.md"), "# A note\n");
    const db = new Database(path.join(dataDir, "app.sqlite"));
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)");
    for (const [k, v] of [["vault_configured", "true"], ["sync_backend", "git"], ["git_remote", "https://example.invalid/vault.git"]])
      db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run(k, v);
    db.close();
    fs.writeFileSync(path.join(dataDir, "maintenance.json"), record());
    const before = snapshot(dataDir);
    for (let boot = 0; boot < 2; boot++) {
      const s = await startServer({}, { dataDir, keepDataDir: true });
      const health = await (await fetch(`${s.url}/api/health`)).json();
      expect(health.maintenance).toMatchObject({ active: true, source: "file", state: "active", id, drainedByThisProcess: false });
      await knockEverywhere(s);
      await s.stop();
      expect(snapshot(dataDir)).toEqual(before);
    }
  });
});

describe("resume", () => {
  it("needs the exact id, forced maintenance wins, an undrained record needs its acknowledgement, and the record is archived first", async () => {
    const dataDir = volume();
    fs.writeFileSync(path.join(dataDir, "maintenance.json"), record("drain_failed"));
    const refusals: [Record<string, string>, RegExp][] = [
      [{ NOTEMESH_MAINTENANCE_RESUME: "6a1f0c2e-0000-4e5f-8a9b-0c1d2e3f4a5b" }, /id does not match/],
      [{ NOTEMESH_MAINTENANCE_RESUME: id, NOTEMESH_MAINTENANCE_RESUME_UNDRAINED: id, NOTEMESH_MAINTENANCE: "1" }, /takes precedence/],
      [{ NOTEMESH_MAINTENANCE_RESUME: id }, /RESUME_UNDRAINED/],
    ];
    for (const [envs, why] of refusals) {
      const s = await startServer(envs, { dataDir, keepDataDir: true });
      expect((await (await fetch(`${s.url}/api/health`)).json()).maintenance.active).toBe(true);
      expect(s.log()).toMatch(why);
      await s.stop();
      expect(fs.readdirSync(dataDir)).toEqual(["maintenance.json"]);
    }

    const s = await startServer({ NOTEMESH_MAINTENANCE_RESUME: id, NOTEMESH_MAINTENANCE_RESUME_UNDRAINED: id }, { dataDir, keepDataDir: true });
    servers.push(s);
    const health = await (await fetch(`${s.url}/api/health`)).json();
    expect(health).toEqual({ ok: true, configured: false });
    expect(fs.existsSync(path.join(dataDir, "maintenance.json"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "maintenance-history", `${id}.json`), "utf8"))).toMatchObject({ id, state: "drain_failed" });
    expect((await rpc(s, "getSetupStage")).status).toBe(200);
  });
});

describe("entering from a running server", () => {
  it("admin entry drains with every admitted request observed, then refuses everything, and the next boot stays in maintenance", async () => {
    const dataDir = volume();
    const s = await startServer({}, { dataDir, keepDataDir: true });
    const cookie = await claimAdmin(s);
    await markConfigured(s, { sync_backend: "git" });
    expect((await rpc(s, "getStatusPage", [], cookie)).status).toBe(200);
    // The /_server router is a separate bundle with its own module copies: a
    // request there opens its own DB connection through its own middleware.
    await fetch(`${s.url}/_server`, { method: "POST", headers: { Origin: s.url } });

    const entered = await rpc(s, "enterMaintenance", [], cookie);
    expect(entered.status).toBe(200);
    const result = entered.body.result as { id: string; state: string; drain: Record<string, unknown> };
    expect(result.state).toBe("active");
    // One process-wide registry in the EMITTED build: both router bundles
    // registered, and both bundles' DB connections are fenced read-only.
    expect(result.drain).toMatchObject({ pendingWork: 0, untrackedRequests: 0, gitQuiescent: true, obsidianQuiescent: true,
      indexerQuiescent: true, cloudIntakeIdle: true, priceCollectorIdle: true, safeEditLockAbsent: true,
      gitMutationLockAbsent: true, safeEditWritingRows: 0, dbConnections: 2, dbFenced: 2 });
    expect(Number(result.drain.bundles)).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "maintenance.json"), "utf8"))).toMatchObject({ id: result.id, state: "active" });
    const health = await (await fetch(`${s.url}/api/health`)).json();
    expect(health.maintenance).toMatchObject({ source: "process", state: "active", id: result.id, drainedByThisProcess: true });
    expect((await rpc(s, "syncNow", [], cookie)).status).toBe(503);
    expect((await rpc(s, "enterMaintenance", [], cookie)).status).toBe(503);
    await knockEverywhere(s);
    await s.stop();

    const settled = snapshot(dataDir);
    const next = await startServer({}, { dataDir, keepDataDir: true });
    servers.push(next);
    expect((await (await fetch(`${next.url}/api/health`)).json()).maintenance).toMatchObject({ source: "file", state: "active", id: result.id });
    await knockEverywhere(next);
    expect(snapshot(dataDir)).toEqual(settled);
  });
});

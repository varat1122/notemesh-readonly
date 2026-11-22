import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "d1-native-g01-"));
process.env.DATA_DIR = root;
const { db, withAuthDatabaseOwner } = await import("./db");


describe("G01 actual native production facade", () => {
  it("normal IMMEDIATE transaction commits; timeout is zero", () => {
    const d = db();
    expect(d.pragma("busy_timeout", { simple: true })).toBe(0);
    d.transaction(() => d.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("positive", "one"))();
    expect(d.prepare("SELECT value FROM settings WHERE key=?").get("positive")).toEqual({ value: "one" });
  });
  it("rolls back failed Research transaction without committing partial rows", () => {
    const d = db();
    expect(() => d.transaction(() => {
      d.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("partial", "one");
      throw Error("synthetic-primary");
    })()).toThrow("synthetic-primary");
    expect(d.prepare("SELECT value FROM settings WHERE key=?").get("partial")).toBeUndefined();
  });
  it("native Auth ownership excludes shared Research, then releases normally", async () => {
    await withAuthDatabaseOwner(async auth => {
      auth.prepare("BEGIN").run();
      auth.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("auth", "one");
      await Promise.resolve();
      expect(() => db()).toThrow("d1_research_foreign_context");
      auth.prepare("COMMIT").run();
    });
    expect(db().prepare("SELECT value FROM settings WHERE key=?").get("auth")).toEqual({ value: "one" });
  });

  it("Research promise callback rolls back and its late continuation cannot write", async () => {
    const d = db();let denied = false;let continuation: Promise<void> | undefined;
    expect(() => d.transaction(() => {
      d.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("async-partial", "one");
      continuation = Promise.resolve().then(() => {
        try { d.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("async-late", "one"); }
        catch { denied = true; }
      });
      return continuation;
    })()).toThrow("d1_research_transaction_await_forbidden");
    await continuation;
    expect(denied).toBe(true);
    expect(d.prepare("SELECT key FROM settings WHERE key LIKE 'async-%'").all()).toEqual([]);
  });
  it("real competing SQLite writer gets fail-fast BUSY, then normal retry succeeds", () => {
    const d = db(), other = new Database(path.join(root, "app.sqlite"), { timeout: 0 });
    try {
      other.exec("BEGIN IMMEDIATE");
      expect(() => d.transaction(() => d.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("retry", "one"))()).toThrow(/locked|busy/i);
      expect(d.pragma("busy_timeout", { simple: true })).toBe(0);
      other.exec("ROLLBACK");
      d.transaction(() => d.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("retry", "one"))();
      expect(d.prepare("SELECT value FROM settings WHERE key='retry'").get()).toEqual({ value: "one" });
    } finally { if(other.inTransaction)other.exec("ROLLBACK");other.close(); }
  });
  it("bounded Auth queue serializes two actual native owners", async () => {
    const order: string[] = [];
    await Promise.all([
      withAuthDatabaseOwner(async connection => {
        connection.prepare("BEGIN").run();order.push("first");
        await new Promise<void>(resolve=>setImmediate(resolve));
        connection.prepare("COMMIT").run();order.push("settled");
      }),
      withAuthDatabaseOwner(async connection => {
        order.push("second");connection.prepare("SELECT 1").get();
      }),
    ]);
    expect(order).toEqual(["first","settled","second"]);
  });
  it("DRAINING wins before native COMMIT; owned rollback leaves zero business rows", async () => {
    await expect(withAuthDatabaseOwner(async auth => {
      auth.prepare("BEGIN").run();
      auth.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("after-barrier", "one");
      const module = pathToFileURL(path.resolve("src/server/maintenance.ts")).href;
      execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
        `const m=await import(${JSON.stringify(module)}); m.beginMaintenance();`],
        { env: { PATH: process.env.PATH, DATA_DIR: root }, timeout: 5000 });
      await Promise.resolve();
      auth.prepare("COMMIT").run();
    })).rejects.toThrow();
    // Independent read-only connection, no schema/repair/checkpoint writes.
    const reader = new Database(path.join(root, "app.sqlite"), { readonly: true, fileMustExist: true });
    try { expect(reader.prepare("SELECT value FROM settings WHERE key=?").get("after-barrier")).toBeUndefined(); }
    finally { reader.close(); }
  });
});

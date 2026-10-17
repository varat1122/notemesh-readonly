import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-readonly-test-"));
process.env.DATA_DIR = root;
fs.mkdirSync(path.join(root, "vault"));
const notePath = path.join(root, "vault", "Test.md");
const original = "# Synthetic\nRead-only protocol fixture.\n";
fs.writeFileSync(notePath, original);
let client: Client;
let server: Awaited<ReturnType<typeof import("./server")["createMcpServer"]>>;

beforeAll(async () => {
  const { createMcpServer } = await import("./server");
  // Deliberately supply the broadest access; this fork must still be read-only.
  server = createMcpServer({ read: true, write: true, label: "legacy-write-test" });
  client = new Client({ name: "readonly-test", version: "1.0.0" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right);
  await client.connect(left);
});
afterAll(async () => {
  await client?.close();
  await server?.close();
  const { db } = await import("../db");
  db().close();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("read-only deployment protocol", () => {
  it("exposes only read tools even to a write-capable credential", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(10);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    expect(tools.map(t => t.name)).toContain("search_vault");
    expect(tools.map(t => t.name)).toContain("read_note");
  });
  it("reads content through MCP without modifying the file", async () => {
    const result = await client.callTool({ name: "read_note", arguments: { path: "Test.md" } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("Read-only protocol fixture");
    // Text and structured MCP payloads must both carry the real note body.
    // Merely receiving {} is a failed read even when no protocol error fires.
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Read-only protocol fixture") }),
    ]));
    expect(result.structuredContent).toEqual(expect.objectContaining({
      path: "Test.md",
      content: expect.stringContaining("Read-only protocol fixture"),
      count: 3,
      totalLines: 3,
      hasMore: false,
    }));
    expect(fs.readFileSync(notePath, "utf8")).toBe(original);
  });
  for (const tool of ["create_note", "update_note", "edit_note", "append_to_note", "prepend_to_note", "delete_note", "move_note", "move_folder", "delete_folder", "set_property", "remove_property", "toggle_task", "unique_note"]) {
    it(`rejects ${tool} without filesystem changes`, async () => {
      const result = await client.callTool({ name: tool, arguments: { path: "Test.md", content: "Forbidden" } });
      expect(result.isError).toBe(true);
      expect(fs.readFileSync(notePath, "utf8")).toBe(original);
      expect(fs.readdirSync(path.join(root, "vault"))).toEqual(["Test.md"]);
    });
  }
  for (const action of ["append", "prepend"]) {
    it(`rejects daily_note ${action}`, async () => {
      const result = await client.callTool({ name: "daily_note", arguments: { action, content: "Forbidden", date: "2026-10-11" } });
      expect(result.isError).toBe(true);
      expect(fs.readdirSync(path.join(root, "vault"))).toEqual(["Test.md"]);
    });
  }
});

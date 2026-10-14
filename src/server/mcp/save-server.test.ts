import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpAccess } from "./server";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "save-only-mcp-"));
process.env.DATA_DIR = root;
process.env.BASE_URL = "https://save-fixture.test";
const input = { sourceChat: "SYNTHETIC SAVE TEST", notes: [{
  title: "Fixture only", eventDate: null, userInput: "Synthetic source",
  analysis: "Synthetic analysis", relatedNotes: [],
}] };
const granted: McpAccess = { read: true, write: false, intake: true,
  scopes: ["vault:read", "inbox:submit"], label: "oauth:save-fixture" };

async function connected(access: McpAccess) {
  const { createSaveMcpServer } = await import("./save-server");
  const server = createSaveMcpServer(access);
  const client = new Client({ name: "save-fixture", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right);
  await client.connect(left);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

beforeAll(async () => { const { nextIntake } = await import("../intake"); nextIntake(); });
afterAll(async () => { const { db } = await import("../db"); db().close();
  delete process.env.DATA_DIR; delete process.env.BASE_URL; });

it("advertises exactly two equally scoped tools, with the correct write annotation", async () => {
  const connection = await connected(granted);
  try {
    const { tools } = await connection.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_submission_status", "submit_investment_notes"]);
    for (const tool of tools) expect(tool._meta?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["vault:read", "inbox:submit"] },
    ]);
    expect(tools.find((tool) => tool.name === "submit_investment_notes")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  } finally { await connection.close(); }
});

it.each([
  { ...granted, scopes: ["vault:read"] },
  { ...granted, scopes: ["inbox:submit"] },
  { ...granted, scopes: undefined },
  { ...granted, label: "api-key:Investment OS Intake Worker" },
])("refuses both handlers without actual OAuth scopes and leaves the queue unchanged: %j", async (access) => {
  const { db } = await import("../db");
  const before = db().prepare("SELECT count(*) AS n FROM intake_queue").get();
  const connection = await connected(access);
  try {
    for (const [name, args] of [["submit_investment_notes", input],
      ["get_submission_status", { id: "0".repeat(64) }]] as const) {
      const result = await connection.client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result._meta)).toContain("/.well-known/oauth-protected-resource/api/save-analysis");
      expect(JSON.stringify(result._meta)).toContain("insufficient_scope");
    }
    expect(db().prepare("SELECT count(*) AS n FROM intake_queue").get()).toEqual(before);
  } finally { await connection.close(); }
});

it("accepts a scoped submission, deduplicates it, and reads the durable receipt without writing vault files", async () => {
  const connection = await connected(granted);
  try {
    const first = await connection.client.callTool({ name: "submit_investment_notes", arguments: input });
    expect(first.isError).not.toBe(true);
    const receipt = JSON.parse((first.content as { text: string }[])[0].text);
    expect(receipt).toMatchObject({ id: expect.stringMatching(/^[a-f0-9]{64}$/), status: "queued" });
    const duplicate = await connection.client.callTool({ name: "submit_investment_notes", arguments: input });
    expect(duplicate.content).toEqual(first.content);
    const status = await connection.client.callTool({ name: "get_submission_status", arguments: { id: receipt.id } });
    expect(status.isError).not.toBe(true);
    expect(status.content).toEqual(first.content);
    expect(fs.readdirSync(path.join(root, "vault"))).toEqual([]);
  } finally { await connection.close(); }
});

it("rejects insufficient scopes at the HTTP boundary with the exact resource challenge", async () => {
  const { serveMcp } = await import("./http");
  for (const access of [{ ...granted, scopes: ["vault:read"] },
    { ...granted, label: "api-key:research" }]) {
    const response = await serveMcp(new Request("https://save-fixture.test/api/save-analysis", { method: "POST" }), access, "save-analysis");
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://save-fixture.test/.well-known/oauth-protected-resource/api/save-analysis", error="insufficient_scope", scope="vault:read inbox:submit"');
  }
});

it("serves the same two scoped tools and a working submission over the real HTTP transport", async () => {
  const { serveMcp } = await import("./http");
  async function request(method: string, params?: unknown) {
    const response = await serveMcp(new Request("https://save-fixture.test/api/save-analysis", {
      method: "POST",
      headers: { Host: "save-fixture.test", "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }), granted, "save-analysis");
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const data = response.headers.get("Content-Type")?.includes("text/event-stream")
      ? body.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : body;
    expect(data).toBeTruthy();
    return JSON.parse(data!);
  }
  const listed = await request("tools/list");
  expect(listed.result.tools).toHaveLength(2);
  for (const tool of listed.result.tools) {
    expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["vault:read", "inbox:submit"] }]);
    expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
  }
  const submitted = await request("tools/call", { name: "submit_investment_notes", arguments: input });
  expect(submitted.result.isError).not.toBe(true);
  const receipt = JSON.parse(submitted.result.content[0].text);
  expect(receipt.status).toBe("queued");
  const status = await request("tools/call", { name: "get_submission_status", arguments: { id: receipt.id } });
  expect(JSON.parse(status.result.content[0].text).id).toBe(receipt.id);
});

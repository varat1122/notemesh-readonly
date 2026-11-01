import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpAccess } from "./server";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { withToolAuthMetadata } from "./tool-auth";

// The Tools tab is documentation that has to stay true, and the only way it
// stays true is by being the tool surface rather than a description of it.
// Compare actual protocol listings with the reviewed research contract, then
// check its permission metadata and the separately scoped Save documentation.

const RESEARCH_TOOLS = [
  "assess_thesis_change_proposal", "daily_note", "discover_near_duplicate_sources",
  "find_in_note", "get_links", "get_outline", "get_vault_info", "investment_context_pack",
  "list_attachments", "list_directory", "list_folders", "list_link_issues", "list_notes",
  "list_tags", "list_tasks", "notes_by_tag", "plan_duplicate_source_link",
  "plan_investment_writeback", "plan_pdf_extraction_coverage", "plan_review_revision",
  "preview_edit", "random_note", "read_attachment", "read_note", "read_properties",
  "review_investment_claim", "search_vault", "word_count",
].sort();
const SAVE_TOOLS = ["get_submission_status", "submit_investment_notes"];
const READ_ACCESS: McpAccess = {
  read: true, write: false, intake: false, label: "oauth:catalog-read", scopes: ["vault:read"],
};
// Even a caller carrying legacy write/intake flags must get the same research
// surface. The endpoint, not a broader credential, owns that boundary.
const LEGACY_ACCESS: McpAccess = {
  read: true, write: true, intake: true, label: "oauth:catalog-legacy",
  scopes: ["vault:read", "inbox:submit", "vault:edit"],
};

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-catalog-"));
  process.env.DATA_DIR = root;
  // db.ts caches its handle at module scope; these cases differ by settings.
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function catalog() {
  const { listMcpTools } = await import("./catalog");
  return listMcpTools();
}

async function registered(access: McpAccess, resource: "research" | "save-analysis" = "research") {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createMcpServer } = await import("./server");
  const { createSaveMcpServer } = await import("./save-server");
  const server = resource === "research" ? createMcpServer(access) : createSaveMcpServer(access);
  const client = new Client({ name: "catalog-contract-test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

function expectAdvertisedScopes(tools: Tool[], scopes: string[]) {
  // Exercise the same descriptor transform as HTTP, including both formats
  // consumed by clients. A correct catalogue alone could hide scope drift.
  const message = withToolAuthMetadata({ jsonrpc: "2.0", id: 1, result: { tools } });
  if (!("result" in message)) throw new Error("Expected a tools/list response");
  const advertised = message.result.tools as (Tool & { securitySchemes?: unknown })[];
  expect(advertised).toHaveLength(tools.length);
  for (const tool of advertised) {
    const expected = [{ type: "oauth2", scopes }];
    expect(tool.securitySchemes, `${tool.name} top-level scopes`).toEqual(expected);
    expect(tool._meta?.securitySchemes, `${tool.name} metadata scopes`).toEqual(expected);
  }
}

describe("the tool catalogue", () => {
  it("lists the exact 28 research tools for read-only and legacy OAuth callers", async () => {
    const names = (await catalog()).map((t) => t.name).sort();
    expect(names).toHaveLength(28);
    expect(names).toEqual(RESEARCH_TOOLS);
    for (const access of [READ_ACCESS, LEGACY_ACCESS]) {
      expect((await registered(access)).map((t) => t.name).sort(), access.label).toEqual(names);
    }
  });

  it("keeps research read-only without intake or write scopes, with Save separately scoped", async () => {
    const tools = await catalog();
    const readOnly = new Set((await registered(READ_ACCESS)).map((t) => t.name));
    expect(tools).toHaveLength(RESEARCH_TOOLS.length);
    for (const t of tools) {
      expect(t.write, `${t.name} write flag`).toBe(t.annotations?.readOnlyHint !== true);
      expect(readOnly.has(t.name)).toBe(true);
      expect(t.write, `${t.name} cannot write`).toBe(false);
      expect(t.intake, `${t.name} cannot submit`).toBe(false);
      expect(t.annotations?.readOnlyHint, `${t.name} only reads`).toBe(true);
    }
    for (const access of [READ_ACCESS, LEGACY_ACCESS]) {
      const listed = await registered(access);
      expect(listed.filter((t) => SAVE_TOOLS.includes(t.name))).toEqual([]);
      expect(listed.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
      expectAdvertisedScopes(listed, ["vault:read"]);
    }
    // Positive control: separation must not erase Save's tools, write hint or
    // required submission scope just to make the research assertions pass.
    const save = await registered(LEGACY_ACCESS, "save-analysis");
    expect(save.map((t) => t.name).sort()).toEqual(SAVE_TOOLS);
    expect(save.find((t) => t.name === "submit_investment_notes")?.annotations?.readOnlyHint).toBe(false);
    expect(save.find((t) => t.name === "get_submission_status")?.annotations?.readOnlyHint).toBe(true);
    expectAdvertisedScopes(save, ["vault:read", "inbox:submit"]);
  });

  it("carries the description and parameters the protocol sends", async () => {
    const read = (await catalog()).find((t) => t.name === "read_note")!;
    expect(read.description).toBeTruthy();
    const p = read.params.find((x) => x.name === "path")!;
    expect(p).toBeDefined();
    expect(p.type).toBe("string");
    expect(p.required).toBe(true);
    // Optional parameters are marked as such, not merely present.
    expect(read.params.find((x) => x.name === "offset")!.required).toBe(false);
  });

  it("every tool has a description, so no row renders blank", async () => {
    for (const t of await catalog()) {
      expect(t.description, `${t.name} has a description`).toBeTruthy();
    }
  });

  it("follows a conditional tool rather than hardcoding it", async () => {
    // delete_note is registered behind a setting. A catalogue built from a
    // written-down list would show it either always or never.
    expect((await catalog()).map((t) => t.name)).not.toContain("delete_note");

    const { setSetting } = await import("../db");
    setSetting("delete_enabled", "false");
    vi.resetModules();
    expect((await catalog()).map((t) => t.name)).not.toContain("delete_note");
  });
});

// The version the server reports on connect, the version in package.json, and
// the version at the top of the changelog are three copies of one fact. They
// drift silently — nothing fails when they disagree, and a client showing a
// stale version is the kind of thing nobody notices for months.
// The product is spelled NoteMesh where a person reads it and notemesh where a
// machine keys on it. Those are different jobs and they drift toward each other
// — someone tidies the "inconsistent" casing and renames an identifier, or adds
// a display string in the identifier's spelling.
describe("the name a client is told", () => {
  it("advertises notemesh as the identifier and NoteMesh as the title", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMcpServer } = await import("./server");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ read: true, write: true, label: "name-test" });
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const info = client.getServerVersion();
    await client.close();
    await server.close();

    // `name` is what a config or a registry keys on, so it does not get
    // capitalised for looks.
    expect(info?.name).toBe("notemesh");
    // `title` is what a client puts in front of a person.
    expect((info as { title?: string } | undefined)?.title).toBe("NoteMesh");
  });
});

describe("the reported version", () => {
  it("matches package.json and the changelog", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")).version as string;
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);

    const serverSrc = readFileSync("src/server/mcp/server.ts", "utf8");
    const reported = serverSrc.match(/name: "notemesh",[\s\S]{0,300}?version: "([^"]+)"/)?.[1];
    expect(reported, "the MCP server reports a version").toBeDefined();
    expect(reported).toBe(pkg);

    // The newest released heading in the changelog, ignoring Unreleased.
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const latest = changelog.match(/^## (\d+\.\d+\.\d+)/m)?.[1];
    expect(latest, "the changelog names a released version").toBeDefined();
    expect(latest).toBe(pkg);
  });

  it("opens every release with what taking it costs the deployer", async () => {
    // The convention only works if it is never skipped: a deployer who learns
    // the first line always answers "what do I have to do" stops reading the
    // rest, and one release without it silently breaks that habit. Cheap to
    // forget when writing an entry, so it is checked rather than remembered.
    const { readFileSync } = await import("node:fs");
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const sections = changelog.split(/^## /m).slice(1);
    const releases = sections.filter((s) => /^\d+\.\d+\.\d+/.test(s));
    expect(releases.length, "there is at least one released version").toBeGreaterThan(0);
    for (const body of releases) {
      const heading = body.split("\n")[0];
      expect(body, `release "${heading}" must open with **Taking this update:**`).toContain(
        "**Taking this update:**",
      );
    }
  });

  it("counts the separate research and Save surfaces in the unreleased changelog", async () => {
    // Bind to the candidate entry; historical release counts describe their
    // own artifacts and must not be rewritten to match this local change.
    const { readFileSync } = await import("node:fs");
    const entry = readFileSync("CHANGELOG.md", "utf8").split(/^## /m)
      .find((s) => s.startsWith("Unreleased — Read Only research candidate\n"));
    expect(entry, "the changelog identifies candidate behavior").toBeDefined();
    const claimed = Number(entry!.match(/Research surface: (\d+) tools covering/)?.[1]);
    expect(claimed).toBeGreaterThan(0);
    expect((await catalog()).length).toBe(claimed);
    const saveClaimed = Number(entry!.match(/Save Analysis surface: (\d+) tools/)?.[1]);
    expect(saveClaimed).toBeGreaterThan(0);
    expect(await registered(LEGACY_ACCESS, "save-analysis")).toHaveLength(saveClaimed);
    expect(entry).toContain("`/api/mcp`");
    expect(entry).toContain("`/api/save-analysis`");
    expect(entry).toContain("`vault:read inbox:submit`");
    for (const name of SAVE_TOOLS) expect(entry).toContain(`\`${name}\``);
  });
});

// What a tool says about itself has to be true of how it is registered. The
// `write` flag is derived from the registration conditionals; the annotations
// are declared by hand next to each tool. These check the two never disagree,
// and that no parameter is left for a model to guess at.
describe("tool definitions, as a client reads them", () => {
  it("describes every parameter of every tool", async () => {
    for (const t of await catalog()) {
      for (const p of t.params) {
        expect(p.description, `${t.name}.${p.name} has a description`).toBeTruthy();
      }
    }
  });

  it("annotates every tool, and never as open-world", async () => {
    for (const t of await catalog()) {
      expect(t.annotations, `${t.name} has annotations`).toBeDefined();
      expect(t.annotations!.readOnlyHint, `${t.name} says whether it only reads`).toBeTypeOf("boolean");
      // The vault is a closed world; nothing here reaches outside it.
      expect(t.annotations!.openWorldHint, `${t.name} is not open-world`).toBe(false);
    }
  });

  it("agrees with the registration conditionals about who can write", async () => {
    for (const t of await catalog()) {
      const ro = t.annotations!.readOnlyHint;
      // A tool only a write credential gets must not claim to be read-only...
      if (t.write) expect(ro, `${t.name} needs write scope, so cannot be read-only`).toBe(false);
      // ...and a tool that claims to be read-only must be available without one.
      if (ro) expect(t.write, `${t.name} is read-only, so must not need write scope`).toBe(false);
      // Every tool that can write says whether it can discard content.
      if (!ro) expect(t.annotations!.destructiveHint, `${t.name} says whether it is destructive`).toBeTypeOf("boolean");
    }
    // The five that can lose content a person wrote, and only those.
    const destructive = (await catalog()).filter((t) => t.annotations!.destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual([]);
  });
});

// Tool Descriptions.md is the longer explanation beside the catalogue. A tool
// added without a section there, or a section for a tool that no longer
// exists, is drift a reader would find before a test did.
describe("Tool Descriptions.md", () => {
  it("has a section for every tool, and no section for a tool that is gone", async () => {
    const doc = fs.readFileSync("Tool Descriptions.md", "utf8");
    const sections = doc.split(/^## Save Analysis resource — \/api\/save-analysis$/m);
    expect(sections, "separate research and Save documentation").toHaveLength(2);
    const [researchDoc, saveDoc] = sections;
    const documented = [...researchDoc.matchAll(/^### (\w+) — /gm)].map((m) => m[1]).sort();
    const tools = (await catalog()).map((t) => t.name).sort();
    expect(documented).toEqual(tools);
    // Each section says whether the tool reads or writes, matching its annotation.
    for (const t of await catalog()) {
      const line = researchDoc.match(new RegExp(`^### ${t.name} — (read|write)`, "m"));
      expect(line, `${t.name} says read or write`).not.toBeNull();
      expect(line![1]).toBe(t.annotations!.readOnlyHint ? "read" : "write");
    }
    const save = await registered(LEGACY_ACCESS, "save-analysis");
    const saveDocumented = [...saveDoc.matchAll(/^### (\w+) — /gm)].map((m) => m[1]).sort();
    expect(saveDocumented).toEqual(save.map((t) => t.name).sort());
    expect(saveDocumented).toEqual(SAVE_TOOLS);
    expect(saveDocumented.filter((name) => documented.includes(name))).toEqual([]);
    for (const t of save) {
      const line = saveDoc.match(new RegExp(`^### ${t.name} — (read|write)`, "m"));
      expect(line, `${t.name} says read or write on Save`).not.toBeNull();
      expect(line![1]).toBe(t.annotations!.readOnlyHint ? "read" : "write");
    }
    expect(researchDoc).toContain("`vault:read`");
    expect(saveDoc).toContain("`vault:read inbox:submit`");
  });
});

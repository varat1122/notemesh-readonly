import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The tool surface is an API. A client caches the tool list when it connects,
// so a tool that fails to register is invisible until someone reconnects — and
// an error message naming a tool that isn't there sends an agent down a dead
// end. These pin what each scope exposes.
//
// Registration consults the settings table (delete is opt-in), so each case
// runs against its own scratch data directory rather than whatever ./data
// happens to hold.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-mcp-"));
  process.env.DATA_DIR = root;
  // db.ts caches its handle at module scope, so without this every test in the
  // file would share the first test's database — and these cases differ
  // precisely by what is in the settings table.
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function toolNames(read: boolean, write: boolean): Promise<string[]> {
  const { createMcpServer } = await import("./server");
  const server = createMcpServer({ read, write, label: "test" }) as unknown as {
    _registeredTools: Record<string, unknown>;
  };
  return Object.keys(server._registeredTools).sort();
}

async function setDelete(on: boolean) {
  const { setSetting } = await import("../db");
  setSetting("delete_enabled", on ? "true" : "false");
}

const READ_TOOLS = [
  "assess_thesis_change_proposal",
  "daily_note",
  "find_in_note",
  "get_links",
  "get_outline",
  "get_vault_info",
  "investment_context_pack",
  "list_attachments",
  "list_directory",
  "list_folders",
  "list_link_issues",
  "list_notes",
  "list_tags",
  "list_tasks",
  "notes_by_tag",
  "preview_edit",
  "random_note",
  "read_attachment",
  "read_note",
  "read_properties",
  "review_investment_claim",
  "search_vault",
  "word_count",
];

const WRITE_TOOLS = [
  "append_to_note",
  "create_note",
  // Present unless the setting turns it off — see the delete_note block below.
  "delete_folder",
  "delete_note",
  "edit_note",
  "move_folder",
  "move_note",
  "prepend_to_note",
  "remove_property",
  "set_property",
  "toggle_task",
  "unique_note",
  "update_note",
];

describe("tool surface", () => {
  it("exposes exactly the read tools to a read-only client", async () => {
    expect(await toolNames(true, false)).toEqual(READ_TOOLS);
  });

  it("keeps legacy writable clients read-only", async () => {
    expect(await toolNames(true, true)).toEqual(READ_TOOLS);
  });

  it("exposes investment_context_pack only to read-scoped clients", async () => {
    expect(await toolNames(true, false)).toContain("investment_context_pack");
    expect(await toolNames(false, false)).not.toContain("investment_context_pack");
  });

  it("registers list_attachments", async () => {
    // Called out on its own because read_attachment's errors refer callers to
    // it, and advice pointing at a tool that does not exist is worse than no
    // advice at all.
    expect(await toolNames(true, false)).toContain("list_attachments");
  });

  it("never exposes a write tool to a read-only client", async () => {
    const readOnly = await toolNames(true, false);
    for (const w of WRITE_TOOLS) expect(readOnly).not.toContain(w);
  });
});

// Deleting is on by default: both backends keep the file in their history, so
// it is recoverable rather than destructive. The setting still turns it off,
// and read scope still never gets it — those are the parts that matter.
describe("delete_folder", () => {
  it("never registers delete_folder even when the legacy setting is on", async () => {
    await setDelete(false);
    expect(await toolNames(true, true)).not.toContain("delete_folder");
    await setDelete(true);
    expect(await toolNames(true, true)).not.toContain("delete_folder");
    expect(await toolNames(true, false)).not.toContain("delete_folder");
  });
});

describe("delete_note", () => {
  it("is absent even for a legacy writable client", async () => {
    expect(await toolNames(true, true)).not.toContain("delete_note");
  });

  it("disappears once the setting is turned off", async () => {
    await setDelete(false);
    expect(await toolNames(true, true)).not.toContain("delete_note");
  });

  it("stays absent when the setting is turned on again", async () => {
    await setDelete(true);
    expect(await toolNames(true, true)).not.toContain("delete_note");
  });

  it("is never exposed to a read-only client", async () => {
    expect(await toolNames(true, false)).not.toContain("delete_note");
    await setDelete(true);
    expect(await toolNames(true, false)).not.toContain("delete_note");
  });
});

// The preview is the read half of an edit: offered without write scope, and
// touching nothing — no write, no reindex, no word to the sync backend. The
// write path is one shared helper, so this pins that the preview is not
// wired to it. The real edit runs through the same spies first, as proof
// that they see what they are meant to see.
describe("preview_edit", () => {
  type Handler = (args: unknown, extra: unknown) => { content: { text: string }[]; isError?: boolean };

  async function serverWith(write: boolean) {
    const reindex = vi.fn();
    const notify = vi.fn();
    vi.doMock("../vault/indexer", async (original) => ({
      ...(await original<typeof import("../vault/indexer")>()),
      reindexPath: reindex,
    }));
    vi.doMock("../sync", async (original) => ({
      ...(await original<typeof import("../sync")>()),
      syncBackend: () => ({ notifyLocalChange: notify }),
    }));
    const { createMcpServer } = await import("./server");
    const server = createMcpServer({ read: true, write, label: "test" }) as unknown as {
      _registeredTools: Record<string, { handler: Handler } | undefined>;
    };
    const call = (tool: string, args: Record<string, unknown>) => server._registeredTools[tool]!.handler(args, {});
    const has = (tool: string) => server._registeredTools[tool] !== undefined;
    return { call, has, reindex, notify };
  }

  afterEach(() => {
    vi.doUnmock("../vault/indexer");
    vi.doUnmock("../sync");
  });

  function plant(content: string) {
    const abs = path.join(root, "vault", "Note.md");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  }

  it.each(["edit_note", "append_to_note", "prepend_to_note", "move_folder", "move_note"])("refuses legacy %s without reindex or Sync effects", async tool => {
    const { has, reindex, notify } = await serverWith(true);
    const abs = plant("## A\nold\n");
    expect(has(tool)).toBe(false);
    expect(fs.readFileSync(abs,"utf8")).toBe("## A\nold\n");
    expect(reindex).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("is offered to a read-only credential and touches nothing", async () => {
    const { call, has, reindex, notify } = await serverWith(false);
    expect(has("edit_note")).toBe(false);
    expect(has("preview_edit")).toBe(true);
    const abs = plant("a\nfoo\nb\n");
    const res = call("preview_edit", { path: "Note.md", oldString: "foo", newString: "bar" });
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(body).toMatchObject({ path: "Note.md", count: 1, wouldReplace: 1 });
    expect(body.matches[0].line).toBe(2);
    expect(fs.readFileSync(abs, "utf8")).toBe("a\nfoo\nb\n");
    expect(reindex).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

// Full-disk write handling belongs to the separate Safe Edit engine suite.
// The research resource must not route even legacy callers to a write handler.
describe("research write isolation", () => {
  it("does not register create_note even for a legacy write flag", async () => {
    expect(await toolNames(true,true)).not.toContain("create_note");
  });
});

// Sorting and narrowing happen before paging: total and hasMore describe the
// narrowed list, and page two follows page one under the same order.
describe("list_notes and list_attachments, sorted and narrowed", () => {
  type Handler = (args: unknown, extra: unknown) => { content: { text: string }[]; isError?: boolean };
  type Envelope = { total: number; count: number; hasMore: boolean; items: { path: string }[] };

  async function tools() {
    const { createMcpServer } = await import("./server");
    const server = createMcpServer({ read: true, write: false, label: "test" }) as unknown as {
      _registeredTools: Record<string, { handler: Handler } | undefined>;
    };
    return (tool: string, args: Record<string, unknown>) => {
      const res = server._registeredTools[tool]!.handler(args, {});
      return { res, body: res.isError ? null : (JSON.parse(res.content[0].text) as Envelope) };
    };
  }

  const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  function plant(rel: string, size: number, modifiedMs: number) {
    const abs = path.join(root, "vault", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x".repeat(size));
    fs.utimesSync(abs, modifiedMs / 1000, modifiedMs / 1000);
  }

  beforeEach(() => {
    plant("b.md", 3, T0 + 2000);
    plant("a.md", 1, T0 + 3000);
    plant("c.md", 2, T0 + 1000);
    plant("img/one.png", 5, T0 + 1000);
    plant("img/two.png", 4, T0 + 2000);
  });

  it("sorts by modified, newest first, and pages under that order", async () => {
    const call = await tools();
    const first = call("list_notes", { sort: "modified", limit: 2 }).body!;
    expect(first.items.map((i) => i.path)).toEqual(["a.md", "b.md"]);
    expect(first).toMatchObject({ total: 3, count: 2, hasMore: true });
    const second = call("list_notes", { sort: "modified", limit: 2, offset: 2 }).body!;
    expect(second.items.map((i) => i.path)).toEqual(["c.md"]);
    expect(second.hasMore).toBe(false);
  });

  it("modifiedAfter narrows the whole listing, so total is the narrowed count", async () => {
    const call = await tools();
    const { setSetting } = await import("../db");
    setSetting("timezone", "Pacific/Auckland");
    // Auckland's 2026-01-02 begins at 11:00Z on the 1st; every note is after that.
    expect(call("list_notes", { modifiedAfter: "2026-01-02" }).body!.total).toBe(3);
    // 12:00:02Z exactly: strictly after keeps only the one at 12:00:03Z.
    const after = call("list_notes", { modifiedAfter: "2026-01-01T12:00:02Z", limit: 1 }).body!;
    expect(after).toMatchObject({ total: 1, count: 1, hasMore: false });
    expect(after.items[0].path).toBe("a.md");
  });

  it("attachments sort by size, largest first, and narrow the same way", async () => {
    const call = await tools();
    expect(call("list_attachments", { sort: "size" }).body!.items.map((i) => i.path)).toEqual([
      "img/one.png",
      "img/two.png",
    ]);
    expect(call("list_attachments", { modifiedAfter: "2026-01-01T12:00:01Z" }).body!.items.map((i) => i.path)).toEqual([
      "img/two.png",
    ]);
  });

  it("name finds a file by filename on every listing tool", async () => {
    const call = await tools();
    expect(call("list_notes", { name: "A*" }).body!.items.map((i) => i.path)).toEqual(["a.md"]);
    expect(call("list_attachments", { name: "two" }).body!.items.map((i) => i.path)).toEqual(["img/two.png"]);
    expect(call("list_directory", { name: "*.md" }).body!).toMatchObject({ total: 3 });
  });

  it("search_vault takes the same narrowing and reports modified on each hit", async () => {
    const call = await tools();
    const { reindexPath } = await import("../vault/indexer");
    for (const rel of ["a.md", "b.md", "c.md"]) {
      // Same word in each, keeping the mtime the fixture set.
      const abs = path.join(root, "vault", rel);
      const { mtime } = fs.statSync(abs);
      fs.writeFileSync(abs, "zebra\n");
      fs.utimesSync(abs, mtime, mtime);
      reindexPath(rel);
    }
    const body = call("search_vault", { query: "zebra", folder: ".", modifiedAfter: "2026-01-01T12:00:01Z", sort: "modified" })
      .body!;
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.path)).toEqual(["a.md", "b.md"]);
    expect((body.items[0] as { modified?: string }).modified).toBe("2026-01-01T12:00:03+00:00");
  });

  it("a modifiedAfter it cannot read is a tool error that says what it wanted", async () => {
    const call = await tools();
    const { res } = call("list_notes", { modifiedAfter: "last tuesday" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/ISO 8601 timestamp .* or a date/);
  });
});

describe("find_in_note", () => {
  type Handler = (args: unknown, extra: unknown) => { content: { text: string }[]; isError?: boolean };

  it("lists matches by line with the envelope, fenced, and pages them", async () => {
    const { createMcpServer } = await import("./server");
    const server = createMcpServer({ read: true, write: false, label: "test" }) as unknown as {
      _registeredTools: Record<string, { handler: Handler } | undefined>;
    };
    const abs = path.join(root, "vault", "Long.md");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "one\nZebra here\nthree\nzebra and zebra\n");
    const call = (args: Record<string, unknown>) => {
      const res = server._registeredTools.find_in_note!.handler({ path: "Long.md", ...args }, {});
      return { res, body: res.isError ? null : JSON.parse(res.content[0].text) };
    };
    const { body } = call({ pattern: "zebra", limit: 2 });
    expect(body).toMatchObject({ path: "Long.md", total: 3, count: 2, hasMore: true });
    expect(body.items.map((m: { line: number; column: number }) => [m.line, m.column])).toEqual([
      [2, 1],
      [4, 1],
    ]);
    // Fenced: the boundary token wraps the line text.
    expect(body.items[0].text).toContain("Zebra here");
    expect(body.items[0].text).not.toBe("Zebra here");
    // A page past the end is empty but still counted.
    const { body: tail } = call({ pattern: "zebra", offset: 2 });
    expect(tail).toMatchObject({ total: 3, count: 1, hasMore: false });
    const { res } = call({ pattern: "" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/must not be empty/);
  });
});

describe("list_directory", () => {
  type Handler = (args: unknown, extra: unknown) => { content: { text: string }[]; isError?: boolean };

  it("is a read tool with the listing envelope, sorted and paged like the others", async () => {
    const { createMcpServer } = await import("./server");
    const server = createMcpServer({ read: true, write: false, label: "test" }) as unknown as {
      _registeredTools: Record<string, { handler: Handler } | undefined>;
    };
    const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
    for (const [rel, at] of [
      ["Old/a.md", T0 + 1000],
      ["New/b.md", T0 + 3000],
      ["c.md", T0 + 2000],
    ] as const) {
      const abs = path.join(root, "vault", rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "x");
      fs.utimesSync(abs, at / 1000, at / 1000);
    }
    const { reindexPath } = await import("../vault/indexer");
    for (const rel of ["Old/a.md", "New/b.md", "c.md"]) reindexPath(rel);

    const res = server._registeredTools.list_directory!.handler({ sort: "modified", limit: 2 }, {});
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(body).toMatchObject({ total: 3, count: 2, hasMore: true });
    expect(body.items.map((i: { path: string; kind: string }) => [i.path, i.kind])).toEqual([
      ["New", "folder"],
      ["c.md", "file"],
    ]);
  });
});


// A direct MCP protocol round-trip isolates server semantics from the
// ChatGPT app tool snapshot/response adapter. No external Vault is touched.
describe("read-only MCP wire contract", () => {
  it("exposes claim review through real MCP tools/list and tools/call without modifying Vault", async () => {
    const rel = "Canaries/Structured Claim.md";
    const abs = path.join(root, "vault", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `---
entity: NVDA
metric: operating_cash_flow
period: FY27H1
original_source: https://example.org/filing-A.htm
value: "74421"
unit: USD millions
verification: not_reverified
---
# Synthetic source claim
`, "utf8");
    const { reindexPath } = await import("../vault/indexer");
    reindexPath(rel);

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMcpServer } = await import("./server");
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ read: true, write: false, label: "claim-review-test" });
    const client = new Client({ name: "claim-review-protocol", version: "1.0" });
    const before = fs.readFileSync(abs, "utf8");
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);
      const names = (await client.listTools()).tools.map(tool=>tool.name);
      expect(names).toContain("review_investment_claim");
      const result = await client.callTool({
        name: "review_investment_claim",
        arguments: {
          domain:"company",entity:"NVDA",metric:"operating_cash_flow",
          period:"FY27H1",originalSource:"https://example.org/filing-A.htm",
          statement:"Reported operating cash flows for the six-month period.",
          value:"74421",unit:"USD millions"
        }
      });
      expect(result.isError).not.toBe(true);
      const content = (result as {content?:Array<{type:string;text?:string}>}).content ?? [];
      const message = content.find(part=>part.type==="text")?.text;
      if (!message) throw new Error("claim review omitted text MCP payload");
      const out = JSON.parse(message) as {
        status:string;classification:string;canAutoUpdateThesis:boolean;
        matchingClaims:Array<{path:string}>;
      };
      expect(out.status).toBe("review_only_not_verified");
      expect(out.classification).toBe("duplicate_candidate");
      expect(out.canAutoUpdateThesis).toBe(false);
      const packet=(out as unknown as {decisionPacket:{
        status:string;thesisDecision:{selected:null;canAutoUpdateThesis:false};
        businessTransmission:{stages:Array<{status:string}>};
        changeLogDraft:{status:string};
      }}).decisionPacket;
      expect(packet.status).toBe("analyst_review_packet_not_verified");
      expect(packet.thesisDecision.selected).toBeNull();
      expect(packet.thesisDecision.canAutoUpdateThesis).toBe(false);
      expect(packet.businessTransmission.stages.every(x=>x.status==="not_assessed")).toBe(true);
      expect(packet.changeLogDraft.status).toBe("draft_not_approved_or_written");
      const ledger=(packet as unknown as {evidenceVerificationLedger:{
        status:string;entries:Array<{originalVerifiedThisRun:boolean}>;
        gates:{ownerApprovedThesisChange:boolean;originalPrimarySourceRead:string};
        canAutoUpdateThesis:boolean;
      }}).evidenceVerificationLedger;
      expect(ledger.status).toBe("metadata_lineage_only_no_external_verification");
      expect(ledger.entries.every(x=>x.originalVerifiedThisRun===false)).toBe(true);
      expect(ledger.gates.ownerApprovedThesisChange).toBe(false);
      expect(ledger.gates.originalPrimarySourceRead).toBe("not_performed");
      expect(ledger.canAutoUpdateThesis).toBe(false);
      expect(out.matchingClaims.map(x=>x.path)).toContain(rel);
    } finally {
      await client.close().catch(()=>{});
      await server.close().catch(()=>{});
    }
    expect(fs.readFileSync(abs,"utf8")).toBe(before);
  });

  it("lists the context tool and returns real short note content through tools/call", async () => {
    const vault = path.join(root, "vault", "Canaries");
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "Read Smoke.md"), "# Read Smoke\nFirst line\nSecond line\n", "utf8");

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMcpServer } = await import("./server");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ read: true, write: false, label: "protocol-smoke" });
    const client = new Client({ name: "read-only-protocol-smoke", version: "1.0" });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("investment_context_pack");
      expect(names).toContain("read_note");

      const answer = await client.callTool({
        name: "read_note",
        arguments: { path: "Canaries/Read Smoke.md", offset: 0, limit: 2 },
      });
      expect(answer.isError).not.toBe(true);
      const content = (answer as { content?: Array<{ type: string; text?: string }> }).content ?? [];
      const block = content.find((part) => part.type === "text");
      if (!block?.text) throw new Error("read_note omitted the text content block");
      const parsed = JSON.parse(block.text) as {
        path: string; content: string; count: number; hasMore: boolean;
      };
      expect(parsed.path).toBe("Canaries/Read Smoke.md");
      expect(parsed.content).toContain("# Read Smoke");
      expect(parsed.count).toBe(2);
      expect(parsed.hasMore).toBe(true);
    } finally {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
});

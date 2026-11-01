import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
let root: string, vault: string, remote: string, device: string;
let b: import("./git").GitBackend;
let d: typeof import("../db");
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, GIT_AUTHOR_NAME: "Synthetic", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "Synthetic", GIT_COMMITTER_EMAIL: "fixture@invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  } }).trim();
}
async function idle() { await vi.waitFor(() => expect(b.status().activity.active).toBe(false), { timeout: 10_000, interval: 10 }); }
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
beforeEach(async () => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "git-safe-edit-real-"));
  remote = path.join(root, "remote.git"); device = path.join(root, "device"); vault = path.join(root, "data", "vault");
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("OB_ALLOW_LOCAL_GIT", "1");
  vi.stubEnv("SAFE_EDIT_GIT_REMOTE", remote); vi.stubEnv("SAFE_EDIT_GIT_BRANCH", "main");
  vi.stubEnv("SAFE_EDIT_ENABLED", "1"); vi.stubEnv("SAFE_EDIT_SINGLE_WRITER", "1"); vi.stubEnv("CLOUD_INTAKE", "1");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("BASE_URL", "http://127.0.0.1:3999");
  git(root, "init", "--bare", "-b", "main", remote);
  git(root, "clone", remote, device);
  fs.writeFileSync(path.join(device, "Fixture.md"), "# Synthetic\noriginal\n");
  git(device, "add", "-A"); git(device, "commit", "-m", "synthetic seed"); git(device, "push", "origin", "main");
  fs.mkdirSync(path.dirname(vault)); git(root, "clone", remote, vault);
  d = await import("../db");
  for (const [key, value] of Object.entries({ sync_backend: "git", vault_configured: "true", git_remote: remote, git_branch: "main", git_pull_seconds: "3600" })) d.setSetting(key, value);
  delete (globalThis as Record<string, unknown>).__obSyncGitBackend;
  const { gitBackend } = await import("./git"); b = gitBackend(); b.start(); await idle();
});
afterEach(async () => { vi.restoreAllMocks(); b.stop(); await idle(); d.db().close(); vi.unstubAllEnvs(); delete (globalThis as Record<string, unknown>).__obSyncGitBackend; fs.rmSync(root, { recursive: true, force: true }); });
it("applies a real synthetic Safe Edit, preserves backup/actor/idempotent receipt, then independently reads remote HEAD and bytes", async () => {
  const engine = await import("../safe-edit/engine");
  const actor = "oauth:synthetic-local-fixture";
  const p = engine.preview({ operationId: "synthetic-git-boundary", path: "Fixture.md", reason: "Local disposable integration fixture only", change: { kind: "replace", oldText: "original", newText: "local verified" } }, actor);
  const args = { operationId: p.operationId, previewToken: p.previewToken, expectedHash: p.beforeHash };
  const result = await b.withPausedForEdit(() => {
    const receipt = engine.apply(args, actor);
    expect(engine.apply(args, actor)).toEqual(receipt);
    expect(() => engine.apply(args, "oauth:other")).toThrow(/another/);
    expect(receipt).toMatchObject({ status: "written", receipt: { write: "written", readback: "verified", reindex: "verified", sync: "unverified", remoteSync: "unverified", mobileSync: "unverified" } });
    expect(hash(fs.readFileSync(path.join(root, "data", receipt.receipt.backup), "utf8"))).toBe(p.beforeHash);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "safe-edit-backups", `${p.operationId}.json`), "utf8"));
    expect(manifest).toMatchObject({ actor, beforeHash: p.beforeHash, afterHash: p.afterHash });
    return receipt;
  });
  await idle();
  const remoteHead = git(remote, "rev-parse", "refs/heads/main");
  const bytes = execFileSync("git", ["show", "refs/heads/main:Fixture.md"], { cwd: remote, encoding: "utf8" });
  expect(remoteHead).toBe(git(vault, "rev-parse", "HEAD")); expect(hash(bytes)).toBe(p.afterHash);
  // Receipt truth remains local even after independently verifying this local fixture remote.
  expect(engine.status(p.operationId, actor).receipt.remoteSync).toBe("unverified");
  const evidence = { receipt: result, remoteHead, remoteFileSha256: hash(bytes), fixtureOnly: true };
  if (process.env.IOS_M4_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.IOS_M4_EVIDENCE_DIR, "synthetic-local-receipt.json"), JSON.stringify(evidence, null, 2));
});
it("preserves a simultaneous remote edit as original and the guarded edit as a conflict copy without force pushing", async () => {
  const remoteText = "# Synthetic\nremote writer\n", localText = "# Synthetic\nguarded writer\n";
  await b.withPausedForEdit(() => {
    fs.writeFileSync(path.join(vault, "Fixture.md"), localText);
    fs.writeFileSync(path.join(device, "Fixture.md"), remoteText);
    git(device, "add", "-A"); git(device, "commit", "-m", "remote during guarded callback"); git(device, "push", "origin", "main");
  });
  await idle();
  expect(fs.readFileSync(path.join(vault, "Fixture.md"), "utf8")).toBe(remoteText);
  const copy = fs.readdirSync(vault).find(name => name.includes("Conflicted copy")); expect(copy).toBeTruthy();
  expect(fs.readFileSync(path.join(vault, copy!), "utf8")).toBe(localText);
  expect(git(remote, "rev-parse", "main")).toBe(git(vault, "rev-parse", "HEAD"));
  expect(execFileSync("git", ["show", `main:${copy}`], { cwd: remote, encoding: "utf8" })).toBe(localText);
  expect(b.status().conflicts?.[0].paths).toEqual(["Fixture.md"]);
  if (process.env.IOS_M4_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.IOS_M4_EVIDENCE_DIR, "synthetic-local-conflict.json"), JSON.stringify({ remoteHead: git(remote, "rev-parse", "main"), originalSha256: hash(remoteText), conflictSha256: hash(localText), fixtureOnly: true }, null, 2));
});
it("refuses fresh remote divergence, then succeeds after normal fast-forward reconciliation", async () => {
  fs.writeFileSync(path.join(device, "Other.md"), "synthetic remote advance\n");
  git(device, "add", "-A"); git(device, "commit", "-m", "advance"); git(device, "push", "origin", "main");
  const run = vi.fn(); await expect(b.withPausedForEdit(run)).rejects.toThrow(/divergence/); expect(run).not.toHaveBeenCalled();
  await idle(); expect(fs.readFileSync(path.join(vault, "Other.md"), "utf8")).toBe("synthetic remote advance\n");
  await b.withPausedForEdit(() => expect(git(vault, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "main")));
});
it("keeps local changes on delayed/rejected push and delivers through a later normal retry", async () => {
  const hook = path.join(remote, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const original = git(remote, "rev-parse", "main");
  await b.withPausedForEdit(() => fs.writeFileSync(path.join(vault, "Fixture.md"), "# Synthetic\npending delivery\n")); await idle();
  expect(git(remote, "rev-parse", "main")).toBe(original);
  expect(git(vault, "rev-parse", "HEAD")).not.toBe(original);
  expect(fs.readFileSync(path.join(vault, "Fixture.md"), "utf8")).toContain("pending delivery");
  fs.unlinkSync(hook); expect((await b.syncNow()).ok).toBe(true);
  expect(git(remote, "rev-parse", "main")).toBe(git(vault, "rev-parse", "HEAD"));
});

it("recovers from a real non-fast-forward rejection without a force push", async () => {
  const exec = await import("./git-exec"); const realRun = exec.runGit;
  let advanced = false;
  vi.spyOn(exec, "runGit").mockImplementation(async (args, options) => {
    if (args[0] === "push" && !advanced) {
      advanced = true;
      fs.writeFileSync(path.join(device, "Other.md"), "remote between fetch and push\n");
      git(device, "add", "-A"); git(device, "commit", "-m", "non-fast-forward race"); git(device, "push", "origin", "main");
    }
    expect(args).not.toContain("--force"); expect(args).not.toContain("--force-with-lease");
    return realRun(args, options);
  });
  await b.withPausedForEdit(() => fs.writeFileSync(path.join(vault, "Fixture.md"), "local non-fast-forward fixture\n")); await idle();
  expect(advanced).toBe(true);
  expect(b.getLogs().some(l => l.line.includes("push rejected"))).toBe(true);
  expect(git(remote, "rev-parse", "main")).not.toBe(git(vault, "rev-parse", "HEAD"));
  expect((await b.syncNow()).ok).toBe(true);
  expect(git(remote, "rev-parse", "main")).toBe(git(vault, "rev-parse", "HEAD"));
  expect(fs.readFileSync(path.join(vault, "Other.md"), "utf8")).toBe("remote between fetch and push\n");
  expect(fs.readFileSync(path.join(vault, "Fixture.md"), "utf8")).toBe("local non-fast-forward fixture\n");
});
it("does not steal a mutation lock left by a SIGTERM-terminated process", async () => {
  b.stop(); await idle();
  const lock = path.join(root, "data", "git-mutation.lock");
  const child = spawn(process.execPath, ["-e", 'require("node:fs").mkdirSync(process.argv[1]);process.stdout.write("ready");setInterval(()=>{},1000)', lock], { stdio: ["ignore", "pipe", "pipe"] });
  await once(child.stdout!, "data");
  const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
  const { GitBackend } = await import("./git"); const restarted = new GitBackend(); restarted.start();
  await vi.waitFor(() => expect(restarted.status().activity.active).toBe(false), { timeout: 5_000 });
  expect(restarted.state).toBe("backoff"); expect(fs.existsSync(lock)).toBe(true);
  const run = vi.fn(); await expect(restarted.withPausedForEdit(run)).rejects.toThrow(); expect(run).not.toHaveBeenCalled();
  restarted.stop();
});

it("runs MCP Event A context -> canonical Source/Review save -> Event B retrieval through the real Git pause boundary", async () => {
  const { reindexPath } = await import("../vault/indexer");
  const seed = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), content); reindexPath(rel);
  };
  seed("01_Companies/NVDA.md", "# NVDA synthetic hub\n");
  seed("05_Thesis/NVDA - Current Thesis.md", "# Protected synthetic thesis\n");
  for (const folder of ["00_Inbox/ChatGPT", "10_Knowledge/Company Research", "10_Knowledge/Industry and Concepts", "10_Knowledge/Macro and Markets"])
    fs.mkdirSync(path.join(vault, folder), { recursive: true });
  expect((await b.syncNow()).ok).toBe(true);
  const access = { read: true, write: false, label: "oauth:synthetic-git-loop", scopes: ["vault:read", "vault:edit"] };
  const readerServer = (await import("../mcp/server")).createMcpServer(access);
  const writerServer = (await import("../mcp/safe-edit-server")).createSafeEditMcpServer(access);
  const reader = new Client({ name: "git-loop-reader", version: "1" });
  const writer = new Client({ name: "git-loop-writer", version: "1" });
  const [ra, rb] = InMemoryTransport.createLinkedPair(), [wa, wb] = InMemoryTransport.createLinkedPair();
  await Promise.all([readerServer.connect(rb), reader.connect(ra), writerServer.connect(wb), writer.connect(wa)]);
  const unpack = (response: any, safe = false) => {
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const value = JSON.parse(response.content[0].text);
    return safe ? JSON.parse(value.result.split("\n").slice(1, -1).join("\n")) : value;
  };
  try {
    await new Promise(resolve => setTimeout(resolve, 15));
    const cutoffA = new Date().toISOString();
    const packA = unpack(await reader.callTool({ name: "investment_context_pack", arguments: { question: "NVDA capacity event A", issuers: ["NVDA"], asOf: cutoffA } }));
    expect(packA.items.some((x: any) => x.path === "01_Companies/NVDA.md")).toBe(true);
    const provenance = { policy: { reference: "synthetic-policy", version: "1" }, protocol: { reference: "synthetic-protocol", version: "1" },
      producer: { kind: "llm", id: "synthetic", model: "unknown", method: "synthetic-fixture", version: "unknown" },
      context: packA.manifest, coverage: "Synthetic files only", limitations: ["No live verification"] };
    const input = { domain: "company", entities: ["NVDA"], topic: "NVDA synthetic capacity event A", inputFormat: "text",
      sourceKind: "archived_chat", sourceChat: "CORE-ENG-005 synthetic", sourceLanguage: "th", publisher: "Synthetic fixture",
      contentTypes: ["analyst_opinion"], sourceChannel: "archived_chat", originalDocumentAccess: "not_obtained",
      extractedText: "ข้อความต้นทางจำลองเกี่ยวกับกำลังการผลิต ไม่มีข้ออ้างการลงทุนจริง", eventDate: "2026-10-28", publicationDate: "2026-10-29",
      researchReview: { headlineTh: "ข่าวจำลองกำลังการผลิต", whatChangedTh: "ข้อมูลใหม่ที่ยังไม่ยืนยัน", mechanismTh: "อุปสงค์อาจส่งผลต่อกำไร",
        thesisImplicationTh: "ยังไม่เปลี่ยน Thesis", counterEvidenceTh: "ต้องตรวจข้อมูลคัดค้าน", requiredEvidenceTh: "ต้องตรวจต้นฉบับเพิ่มเติม" },
      researchProvenance: provenance };
    const p = unpack(await writer.callTool({ name: "prepare_canonical_writeback", arguments: input }), true);
    expect(p.qualityIssues).toEqual([]); expect(p.previews).toHaveLength(2);
    const result = unpack(await writer.callTool({ name: "apply_canonical_writeback", arguments: { input, planId: p.planId,
      authorizations: p.previews.map((x: any) => ({ operationId: x.operationId, previewToken: x.previewToken, expectedHash: x.beforeHash })) } }), true);
    expect(result.status).toBe("saved_verified"); expect(result.readyForNextNews).toBe(true);
    expect(result.receipts.map((r: any) => r.path)).toEqual(result.steps.map((s: any) => s.path));
    expect(result.steps.map((s: any) => s.kind)).toEqual(["source_intake", "canonical_review"]);
    for (const step of result.steps) {
      expect(step).toMatchObject({ readbackVerified: true, indexed: true, searchable: true, linksVerified: true });
      const read = unpack(await reader.callTool({ name: "read_note", arguments: { path: step.path } }));
      expect(read.content).toContain(packA.manifest.id);
      const { splitFrontmatter } = await import("../vault/markdown");
      expect(splitFrontmatter(fs.readFileSync(path.join(vault, step.path), "utf8")).data.research_provenance).toEqual(provenance);
    }
    await idle(); expect(b.isEditPaused()).toBe(false);
    expect(git(remote, "rev-parse", "main")).toBe(git(vault, "rev-parse", "HEAD"));
    for (const receipt of result.receipts) expect(receipt.receipt.remoteSync).toBe("unverified");
    await new Promise(resolve => setTimeout(resolve, 15));
    const cutoffB = new Date().toISOString();
    await new Promise(resolve => setTimeout(resolve, 15));
    seed("10_Knowledge/Company Research/Investment Review - NVDA - FUTURE_ONLY_SECRET.md", "# NVDA capacity\nFUTURE_ONLY_SECRET\n");
    const packB = unpack(await reader.callTool({ name: "investment_context_pack", arguments: { question: "NVDA capacity event B versus A", issuers: ["NVDA"], asOf: cutoffB, maxNotes: 16 } }));
    expect(packB.items.some((x: any) => x.path === result.steps[1].path)).toBe(true);
    expect(JSON.stringify(packB)).not.toContain("FUTURE_ONLY_SECRET");
    const replayA = unpack(await reader.callTool({ name: "investment_context_pack", arguments: { question: "NVDA capacity event A", issuers: ["NVDA"], asOf: cutoffA } }));
    expect(replayA.items.map((x: any) => x.path)).not.toContain(result.steps[1].path);
    expect(JSON.stringify(replayA)).not.toContain("FUTURE_ONLY_SECRET");
    const eventB = unpack(await reader.callTool({ name: "plan_investment_writeback", arguments: {
      domain: input.domain, entities: input.entities, inputFormat: input.inputFormat, sourceKind: input.sourceKind,
      sourceChat: input.sourceChat, sourceLanguage: input.sourceLanguage, publisher: input.publisher,
      extractedText: "ข้อความต้นทางจำลอง Event B เพื่อเปรียบเทียบกับ Event A", completedAnalysis: "บทวิเคราะห์จำลองที่อ้างอิง Event A",
      topic: "NVDA synthetic capacity event B", eventDate: "2026-10-30", publicationDate: "2026-10-31",
      researchProvenance: { ...provenance, context: packB.manifest } } }));
    expect(eventB.historical.paths).toContain(result.steps[1].path);
    expect(eventB.safeEditWorkflow.writesPerformedByPlanner).toBe(false);
    expect(fs.readFileSync(path.join(vault, "05_Thesis/NVDA - Current Thesis.md"), "utf8")).toBe("# Protected synthetic thesis\n");
  } finally {
    await reader.close(); await readerServer.close(); await writer.close(); await writerServer.close();
  }
});

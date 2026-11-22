import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A tool write reindexes synchronously and resolves the note's links; the
// watcher then sees the same bytes again. That second, identical index pass
// must not reset already-resolved links to NULL until the debounced link
// pass runs: a stop/crash/maintenance in that window left the durable index
// disagreeing with a "reindex: verified" receipt (C1 cold readback).

let root: string;
let vault: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "notemesh-links-watch-")));
  vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  process.env.DATA_DIR = root;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 4).toString("base64");
  vi.resetModules();
});

// start() resolves after the rebuild; chokidar's initial scan may still be
// running, and events before it completes are dropped as "initial".
async function watcherReady() {
  const probe = path.join(vault, "watcher-ready.md");
  const { db } = await import("../db");
  // Rewrite slower than awaitWriteFinish's 400 ms stability window.
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(probe, `# ready ${i}\n`);
    for (let j = 0; j < 30; j++) {
      await new Promise((r) => setTimeout(r, 50));
      if (db().prepare("SELECT 1 FROM notes WHERE path = ?").get("watcher-ready.md")) return;
    }
  }
  throw Error("watcher never became ready");
}

afterEach(async () => {
  const { indexer } = await import("./indexer");
  await indexer().stop();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

it("a watcher re-index of unchanged bytes keeps links resolved by the tool's reindex", async () => {
  const { indexer, reindexPath } = await import("./indexer");
  const { db } = await import("../db");
  fs.mkdirSync(path.join(vault, "Hub"));
  fs.writeFileSync(path.join(vault, "Hub/Source.md"), "# Source\n");
  await indexer().start();
  await watcherReady();
  fs.writeFileSync(path.join(vault, "Draft.md"), "# Draft\n\nSee [[Hub/Source]] and [[Missing]].\n");
  reindexPath("Draft.md");
  const links = () => db().prepare("SELECT target, resolved_path FROM links WHERE source_path = ? ORDER BY target")
    .all("Draft.md") as { target: string; resolved_path: string | null }[];
  const resolved = [{ target: "Hub/Source", resolved_path: "Hub/Source.md" }, { target: "Missing", resolved_path: null }];
  expect(links()).toEqual(resolved);
  // Cover the watcher's write-stability delay and the 1 s debounced pass.
  const seen: string[] = [];
  for (const until = Date.now() + 2500; Date.now() < until;) {
    seen.push(JSON.stringify(links()));
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(new Set(seen)).toEqual(new Set([JSON.stringify(resolved)]));
});

it("a watcher re-index of changed bytes drops removed targets and adds new ones unresolved until the link pass", async () => {
  const { indexer, reindexPath } = await import("./indexer");
  const { db } = await import("../db");
  fs.writeFileSync(path.join(vault, "A.md"), "# A\n");
  fs.writeFileSync(path.join(vault, "B.md"), "# B\n");
  await indexer().start();
  await watcherReady();
  fs.writeFileSync(path.join(vault, "Note.md"), "[[A]]\n");
  reindexPath("Note.md");
  // An external edit (no tool reindex): only the watcher sees it.
  fs.writeFileSync(path.join(vault, "Note.md"), "[[B]]\n");
  const links = () => db().prepare("SELECT target, resolved_path FROM links WHERE source_path = ?").all("Note.md");
  for (const until = Date.now() + 5000; Date.now() < until;) {
    if (JSON.stringify(links()) === JSON.stringify([{ target: "B", resolved_path: "B.md" }])) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(links()).toEqual([{ target: "B", resolved_path: "B.md" }]);
});

import { denyPilotRawWriter } from "../c1-pilot";
import path from "node:path";
import fs from "node:fs";
import { runGit, runGitBuffer } from "./git-exec";

// What to do when git can't reconcile two versions on its own.
//
// This only ever runs for the residue: the same region of the same note changed
// on both sides inside one sync window. Everything else — different notes, or
// the same note in different places — git merges cleanly and this file is not
// involved.
//
// There is one behaviour, and it is Obsidian Sync's: the remote's version keeps
// the real filename, ours is saved beside it as a conflicted copy, and both are
// committed so the copy reaches every device. The user resolves it in Obsidian,
// with or without asking their assistant to help.
//
// Earlier versions offered two more, chosen on the Settings tab, and both were
// dropped. Parking ours on a branch left the vault pristine — but the branch
// never left the server, so a user without a shell into the container could
// not reach it, while the UI told them it was "visible in a git client". And
// letting git write <<<<<<< markers put both versions in front of the user at
// once — inside a note the assistant then read as content. A copy in the vault
// is the only outcome the user can act on from where they actually are.

export interface ConflictOutcome {
  ok: boolean;
  /** Vault-relative paths git could not merge. */
  paths: string[];
  /**
   * Aligned with `paths`: the conflicted copy written for each, or null where
   * our side had no version to save (a path only the other side had). Kept in
   * step by construction, because the notice to connectors pairs them up.
   */
  copies?: (string | null)[];
  message: string;
}

// Would merging these two commits succeed, and if not, which files are the
// problem? `merge-tree --write-tree` answers both entirely inside git's object
// database: no checkout, no index change, and above all nothing written into
// the vault the indexer is watching.
//
// Output shape (git >= 2.38):
//   <tree-oid>\n<conflicted path>\n<conflicted path>\n\n<human-readable notes>
//
// Three outcomes, and only two of them may drive reconciliation:
//   CLEAN    git-exec verified a successful merge (exit 0).
//   CONFLICT git-exec verified exit 1 (`merge_conflict_observed`) and every
//            reported path is usable.
//   HOLD     anything else: refused before launch (external driver, snapshot
//            budget, maintenance), an uncertain result, or paths that are
//            missing or unusable. `hold` is set and `paths` is empty, so a
//            failed probe can never be read as a conflict with no paths.
export interface MergeProbe {
  clean: boolean;
  paths: string[];
  hold?: string;
}

export async function probeMerge(dir: string, ours: string, theirs: string): Promise<MergeProbe> {
  const res = await runGit(["merge-tree", "--write-tree", "--name-only", ours, theirs], {
    cwd: dir,
  });
  if (res.ok && res.code === 0) return { clean: true, paths: [] };
  const detail = (res.stderr.trim().split("\n")[0] ?? "").slice(0, 200);
  if (res.ok || res.code !== 1 || res.outcome !== "merge_conflict_observed")
    return { clean: false, paths: [], hold: `merge_probe_${res.outcome ?? "refused"}${detail ? `: ${detail}` : ""}` };
  const block = res.stdout.split("\n\n")[0] ?? "";
  const paths = block.split("\n").filter(Boolean).slice(1);
  if (!usableConflictPaths(paths)) return { clean: false, paths: [], hold: "merge_probe_invalid_paths" };
  return { clean: false, paths };
}

// A path the resolver can read back with `git show <commit>:<path>` and write
// inside the vault. Git quotes unusual names (core.quotePath), and a quoted
// name cannot be read back, so it is unusable here rather than silently
// treated as "nothing of ours to save".
function usableConflictPaths(paths: readonly string[]): boolean {
  if (!paths.length || new Set(paths).size !== paths.length) return false;
  return paths.every((p) => {
    if (!p || p.length > 4096 || p.startsWith('"') || p.startsWith("/")) return false;
    if ([...p].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return false;
    const segments = p.split("/");
    return segments.every((s) => s !== "" && s !== "." && s !== "..") && segments[0].toLowerCase() !== ".git";
  });
}

// `Daily/2026-08-03.md` -> `Daily/2026-08-03 (Conflicted copy notemesh 202608031958).md`
// Deliberately Obsidian Sync's convention, with notemesh where it puts the
// device name — because that is what this is: another device that edited the note.
export function conflictCopyPath(relPath: string, stamp: string): string {
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);
  const name = `${base} (Conflicted copy notemesh ${stamp})${ext}`;
  return dir === "." ? name : path.posix.join(dir, name);
}

export function conflictStamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `${p(at.getHours())}${p(at.getMinutes())}`
  );
}

export interface ResolveOptions {
  dir: string;
  remoteRef: string;
  paths: string[];
  now?: Date;
}

// Ours becomes `<name> (Conflicted copy ...)`, the remote keeps the real
// filename. Your device's version stays where you left it; the assistant's
// arrives alongside, and both are committed so the copy reaches your devices.
//
// Leaves the repo on a single commit with a clean working tree, so the next
// sync cycle proceeds normally rather than finding a half-finished merge — and
// so the caller has nothing to wait on. A handled conflict is not a state.
export async function resolveConflict(opts: ResolveOptions): Promise<ConflictOutcome> {
  denyPilotRawWriter();
  const { dir, remoteRef, paths } = opts;
  const now = opts.now ?? new Date();
  // The reset below discards our side; it is only allowed for verified,
  // usable conflict paths. Anything else is refused before the reset.
  const refuse = (why: string): ConflictOutcome => ({ ok: false, paths, message: `Conflict resolution refused: ${why}` });
  if (!usableConflictPaths(paths)) return refuse("no usable conflicting paths");
  const head = await runGit(["rev-parse", "HEAD"], { cwd: dir });
  const local = head.stdout.trim();
  if (!head.ok || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(local)) return refuse("could not read the local commit");
  const stamp = conflictStamp(now);

  // Read our versions out of the object database before moving the working
  // tree, so nothing depends on what is currently checked out.
  // One entry per path, in order, so the copies line up with the paths they
  // were made for; a null is a path that only the other side had.
  const saved: ({ copyPath: string; content: Buffer } | null)[] = [];
  for (const rel of paths) {
    const blob = await runGitBuffer(["show", `${local}:${rel}`], { cwd: dir });
    // A read that did not run to completion proves nothing about our side.
    if (!blob.ok && blob.outcome !== "child_exited") return refuse(`could not read our version of ${rel}`);
    // A path that only exists on one side has no blob here; the remote's state
    // is then already correct and there is nothing of ours to preserve.
    saved.push(blob.ok ? { copyPath: conflictCopyPath(rel, stamp), content: blob.stdout } : null);
  }

  const reset = await runGit(["reset", "--hard", remoteRef], { cwd: dir });
  if (!reset.ok) {
    return {
      ok: false,
      paths,
      message: `Could not reset to the remote: ${reset.combined.trim()}`,
    };
  }

  for (const s of saved) {
    if (!s) continue;
    const { copyPath, content } = s;
    const abs = path.join(dir, copyPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const copies = saved.map((s) => (s ? s.copyPath : null));
  const written = copies.filter((c): c is string => c !== null);
  if (written.length) {
    await runGit(["add", "-A"], { cwd: dir });
    await runGit(
      [
        "-c",
        "user.name=notemesh",
        "-c",
        "user.email=notemesh@localhost",
        "commit",
        "-m",
        `notemesh: conflict ${written.length === 1 ? "copy" : "copies"}\n\n${written.join("\n")}`,
      ],
      { cwd: dir },
    );
  }

  return {
    ok: true,
    paths,
    copies,
    // Built from the pairs, so the log line and the Status tab say the same
    // thing the notices do.
    message:
      `Conflicting edits on ${paths
        .map((p, i) =>
          copies[i] ? `${p} (the assistant's version saved as ${copies[i]})` : `${p} (nothing of ours to save)`,
        )
        .join("; ")}. Your other devices' version kept the original filename.`,
  };
}

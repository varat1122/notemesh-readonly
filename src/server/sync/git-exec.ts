import { denyPilotRawWriter } from "../c1-pilot";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../env";
import { getGitCredentials } from "./git-credentials";
import { mutationFenced, withD1NativeInterlock, announceWriter, beginWork, endWork, maintenanceActive, beginMaintenance, registry } from "../maintenance";

// Every git invocation goes through here. Split out from git.ts so the
// conflict-resolution module can run git without importing the backend that
// consumes it.

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  combined: string;
  code: number | null;
  /** Child exit is not proof of remote durability or descendant containment. */
  outcome?: "not_launched" | "child_exited" | "merge_conflict_observed" | "partial_or_unknown";
}

// execa's pinned core launches spawn synchronously. Return a plain wrapper
// under the native interlock, never an async callback/completion permit.
interface ChildOutcome {
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  isCanceled?: boolean;
  isTerminated?: boolean;
}

// These exact builtin forms only inspect refs/object bytes/configured URLs.
// Their normal absence/error statuses are not evidence of a launched mutation.
// In particular do NOT generalize this to fetch/push/merge/reset, aliases,
// leading -c overrides, or merge-tree (which can invoke custom merge drivers).
// A root exit still does not establish descendant containment.
function completedReadProbe(args: readonly string[], result: ChildOutcome): boolean {
  if (result.signal || result.timedOut || result.isCanceled || result.isTerminated) return false;
  if (result.exitCode !== 1 && result.exitCode !== 128) return false;
  const [command, ...rest] = args;
  if (command === "rev-parse") {
    return rest.length === 2 && ["--verify", "--abbrev-ref"].includes(rest[0]) &&
      rest[1].length > 0 && !rest[1].startsWith("-");
  }
  if (command === "rev-list") {
    return rest.length === 2 && rest[0] === "--count" && rest[1].length > 0 && !rest[1].startsWith("-");
  }
  if (command === "remote") return rest.length === 2 && rest[0] === "get-url" && rest[1] === "origin";
  if (command === "show") return rest.length === 1 && !rest[0].startsWith("-") && rest[0].indexOf(":") > 0;
  if (command === "cat-file") return rest.length === 2 && rest[0] === "blob" && /^[a-f0-9]{40,64}$/.test(rest[1]);
  return false;
}

function explicitAlias(args: readonly string[]): boolean {
  // An explicitly configured alias has no process-tree settlement proof, even
  // on exit 0. Retain its writer evidence. This is containment of the reported
  // success signal ONLY, not proof that hooks/configured descendants are dead.
  return args.some((arg, i) => i > 0 && args[i - 1] === "-c" && arg.startsWith("alias."));
}

function mergeProbe(args: readonly string[]): boolean {
  return args.length === 5 && args[0] === "merge-tree" && args[1] === "--write-tree" && args[2] === "--name-only" &&
    args.slice(3).every(ref => ref.length > 0 && ref.length <= 1024 && !ref.startsWith("-") && !ref.includes("\0"));
}

// A conflict may add Git objects, but must not change business bytes, HEAD,
// index or refs. This is a bounded observation, NOT crash recovery or proof of
// descendant settlement. Unsupported layouts/configuration stay HOLD.
function mergeState(dir: string): string {
  const root = fs.realpathSync(dir), dot = path.join(root, ".git");
  if (!fs.lstatSync(dot).isDirectory() || fs.lstatSync(dot).isSymbolicLink()) throw Error("git_merge_probe_layout_hold");
  for (const rel of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "index.lock", "HEAD.lock"])
    if (fs.existsSync(path.join(dot, rel))) throw Error("git_merge_probe_interrupted_hold");
  const hash = crypto.createHash("sha256");
  let entries = 0, bytes = 0;
  const names = (dir: string) => {
    const handle = fs.opendirSync(dir), found: string[] = [];
    try {
      for (let entry; (entry = handle.readSync()) !== null;) {
        if (found.length + entries >= 25_000) throw Error("git_merge_probe_snapshot_budget_hold");
        found.push(entry.name);
      }
    } finally { handle.closeSync(); }
    return found.sort();
  };
  const visit = (file: string, label: string) => {
    if (++entries > 25_000) throw Error("git_merge_probe_snapshot_budget_hold");
    let st: fs.Stats;
    try { st = fs.lstatSync(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { hash.update(JSON.stringify([label, "absent"])); return; }
      throw error;
    }
    hash.update(JSON.stringify([label, st.mode]));
    if (st.isSymbolicLink()) throw Error("git_merge_probe_symlink_hold");
    if (st.isDirectory()) {
      for (const name of names(file)) visit(path.join(file, name), `${label}/${name}`);
    } else if (st.isFile()) {
      bytes += st.size;
      if (bytes > 128 * 1024 * 1024) throw Error("git_merge_probe_snapshot_budget_hold");
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const before = fs.fstatSync(fd);
        if (before.dev !== st.dev || before.ino !== st.ino || before.size !== st.size) throw Error("git_merge_probe_drift_hold");
        const content = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < content.length) {
          const n = fs.readSync(fd, content, offset, content.length - offset, offset);
          if (!n) throw Error("git_merge_probe_drift_hold");
          offset += n;
        }
        hash.update(crypto.createHash("sha256").update(content).digest());
        const after = fs.fstatSync(fd);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
          throw Error("git_merge_probe_drift_hold");
      } finally { fs.closeSync(fd); }
    } else throw Error("git_merge_probe_file_type_hold");
  };
  for (const name of names(root)) if (name !== ".git") visit(path.join(root, name), name);
  for (const name of ["HEAD", "index", "packed-refs", "refs", "config", "config.worktree", "shallow", "info/attributes"])
    visit(path.join(dot, name), `.git/${name}`);
  return hash.digest("hex");
}

// Exact values written by `git lfs install` (with or without --skip-smudge).
const STANDARD_LFS_FILTERS: Record<string, readonly string[] | undefined> = {
  "filter.lfs.clean": ["git-lfs clean -- %f"],
  "filter.lfs.smudge": ["git-lfs smudge -- %f", "git-lfs smudge --skip -- %f"],
  "filter.lfs.process": ["git-lfs filter-process", "git-lfs filter-process --skip"],
};

async function mergeEvidence(dir: string): Promise<(result: ChildOutcome & { stdout?: unknown }) => Promise<boolean>> {
  const config = async () => {
    // Goes through the same admission/interlock as every other Git launch.
    const r = await runGit(["config", "--null", "--list"], { cwd: dir, timeoutMs: 5000 });
    if (!r.ok) throw Error("git_merge_probe_config_hold");
    // [lowercased key for detection, value, key exactly as listed]. Git already
    // lowercases section and variable names; the subsection keeps its case, so
    // the allowlist matches only the exact `filter.lfs.*` driver, never e.g. LFS.
    const entries = r.stdout.split("\0").filter(Boolean).map(entry => {
      const split = entry.indexOf("\n"), raw = split < 0 ? entry : entry.slice(0, split);
      return [raw.toLowerCase(), split < 0 ? "" : entry.slice(split + 1), raw];
    });
    // `git lfs install --system` (the runtime image) configures the lfs clean/
    // smudge/process filters. merge-tree --write-tree runs filters only when it
    // renormalizes, so exactly those standard values pass while renormalize is
    // off. Any other filter, a merge driver, renormalize or lazy fetch stays HOLD.
    if (entries.some(([key]) => /^merge\..*\.driver$|^remote\..*\.promisor$|^extensions\.partialclone$/.test(key)) ||
        entries.some(([key, value, raw]) => /^filter\..*\.(clean|smudge|process)$/.test(key) && !STANDARD_LFS_FILTERS[raw]?.includes(value)) ||
        entries.some(([key, value]) => key === "merge.renormalize" && !/^(false|no|off|0)$/i.test(value.trim())))
      throw Error("git_merge_probe_external_driver_hold");
    // Never expose configuration/credential bytes in diagnostics.
    return crypto.createHash("sha256").update(r.stdout).digest("hex");
  };
  const beforeConfig = await config(), before = mergeState(dir);
  return async result => {
    const text = String(result.stdout ?? "");
    if (text.length > 1024 * 1024) return false;
    const lines = text.split("\n\n", 1)[0].trimEnd().split("\n");
    const oid = lines[0];
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) || (result.exitCode === 1 && lines.length < 2)) return false;
    const object = await runGit(["cat-file", "-t", oid], { cwd: dir, timeoutMs: 5000 });
    return object.ok && object.stdout.trim() === "tree" && await config() === beforeConfig && mergeState(dir) === before;
  };
}

async function admittedGit<T extends ChildOutcome>(args: readonly string[], launch:()=>PromiseLike<T>,
  verifyMerge?: (result: T) => Promise<boolean>):Promise<T>{
  let writer:ReturnType<typeof announceWriter>|undefined;
  let work:number|undefined;
  let launched=false;
  try{
    const {child}=withD1NativeInterlock("business",()=>{
      writer=announceWriter("writer");work=beginWork("d1-git-child");
      launched=true;
      return {child:launch()};
    });
    const result=await child;
    if(explicitAlias(args)||result.signal||result.timedOut||result.isCanceled||result.isTerminated||maintenanceActive())
      throw Error("git_partial_or_unknown_recovery_hold");
    if (verifyMerge) {
      if ((result.exitCode !== 0 && result.exitCode !== 1) || !await verifyMerge(result) || maintenanceActive())
        throw Error("git_partial_or_unknown_recovery_hold");
    } else if (result.exitCode !== 0 && !completedReadProbe(args, result)) throw Error("git_partial_or_unknown_recovery_hold");
    writer!.release();writer=undefined;
    return result;
  }catch(error){
    if(launched){
      // Retain the durable writer lock on an uncertain outcome. Never allow a
      // failed command to masquerade as no effects or verified quiescence.
      registry().heldClosed="git_partial_or_unknown_recovery_required";
      try{beginMaintenance();}catch{/* Retained lock/heldClosed are restrictive; not durable success. */}
      throw new Error("git_partial_or_unknown_recovery_hold",{cause:error});
    }
    throw error;
  }finally{if(work!==undefined)endWork(work);}
}

// Credentials reach git through a helper that reads them from the environment
// rather than from argv or the stored remote URL. argv is world-readable via
// ps/proc, and a token baked into the remote would persist in .git/config.
const CREDENTIAL_HELPER =
  `!f() { printf 'username=%s\\npassword=%s\\n' "$OB_GIT_USER" "$OB_GIT_TOKEN"; }; f`;

function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("«redacted»");
  }
  return out;
}

export async function runGit(
  args: string[],
  opts: { cwd?: string; authenticated?: boolean; timeoutMs?: number } = {},
): Promise<GitResult> {
  denyPilotRawWriter();
  // After maintenance settles nothing may run git, including a late
  // continuation of a reconcile that was still in flight when the drain ended.
  if (mutationFenced()) return { ok: false, stdout: "", stderr: "maintenance", combined: "Maintenance is active; git refused", code: null };
  const creds = opts.authenticated ? getGitCredentials() : null;
  const full = creds ? ["-c", `credential.helper=${CREDENTIAL_HELPER}`, ...args] : args;
  try {
    const verifyMerge = mergeProbe(args) ? await mergeEvidence(opts.cwd ?? env.vaultDir) : undefined;
    const res = await admittedGit(args,()=>execa("git", full, {
      cwd: opts.cwd ?? env.vaultDir,
      env: {
        // Never prompt: an interactive credential prompt in a daemon hangs
        // forever instead of failing.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        ...(verifyMerge ? { GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0" } : {}),
        ...(creds ? { OB_GIT_USER: creds.username, OB_GIT_TOKEN: creds.token } : {}),
      },
      timeout: opts.timeoutMs ?? 120_000,
      reject: false,
      all: true,
      killDescendants: true,
    }), verifyMerge);
    const secrets = [creds?.token];
    return {
      ok: res.exitCode === 0,
      stdout: redact(String(res.stdout ?? ""), secrets),
      stderr: redact(String(res.stderr ?? ""), secrets),
      combined: redact(String((res as any).all ?? ""), secrets),
      code: res.exitCode ?? null,
      outcome: verifyMerge && res.exitCode === 1 ? "merge_conflict_observed" : "child_exited",
    };
  } catch (e: any) {
    const msg = redact(String(e?.message ?? e), [creds?.token]);
    return { ok: false, stdout: "", stderr: msg, combined: msg, code: null,
      outcome: msg.includes("partial_or_unknown")?"partial_or_unknown":"not_launched" };
  }
}


// Binary-safe variant: `git show` on an attachment must not be forced through
// UTF-8 decoding, or a conflict copy of an image would be written as mojibake.
export async function runGitBuffer(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; stdout: Buffer; outcome?:GitResult["outcome"] }> {
  denyPilotRawWriter();
  try {
    const res = await admittedGit(args,()=>execa("git", args, {
      cwd: opts.cwd ?? env.vaultDir,
      env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
      timeout: opts.timeoutMs ?? 120_000,
      reject: false,
      encoding: "buffer",
      stripFinalNewline: false, // conflict copies must preserve every original byte
      killDescendants: true,
    }));
    // execa hands back a Uint8Array here. Convert rather than cast: the two are
    // interchangeable for fs writes, but only a Buffer has an encoding-aware
    // toString, so a cast would leave a trap for the next caller.
    const out = res.stdout as unknown as Uint8Array | undefined;
    return { ok: res.exitCode === 0, stdout: out ? Buffer.from(out) : Buffer.alloc(0),outcome:"child_exited" };
  } catch(error) {
    return { ok: false, stdout: Buffer.alloc(0),outcome:String(error).includes("partial_or_unknown")?"partial_or_unknown":"not_launched" };
  }
}

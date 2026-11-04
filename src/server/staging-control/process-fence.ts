import fs from "node:fs";
import path from "node:path";
import { TARGET } from "./contract";

const INIT = new Set(["tini", "dumb-init", "railway-init", "docker-init"]);
type Proc = { pid: number; parent: number; comm: string; start: string; state: string };
function stat(proc: string, pid: number): Proc {
  const raw = fs.readFileSync(`${proc}/${pid}/stat`, "utf8"), end = raw.lastIndexOf(")");
  const fields = raw.slice(end + 2).trim().split(/\s+/), parent = Number(fields[1]), start = fields[19], state = fields[0];
  if (!raw.startsWith(`${pid} (`) || end < 0 || !Number.isSafeInteger(parent) || parent < 0 ||
    !/^\d{1,20}$/.test(start ?? "") || !/^[RSDZTtXxKWIP]$/.test(state ?? "")) throw Error("stat unavailable");
  return { pid, parent, comm: raw.slice(raw.indexOf("(") + 1, end), start, state };
}
const same = (a: Proc, b: Proc) => a.pid === b.pid && a.parent === b.parent && a.start === b.start && a.comm === b.comm;
const name = (s: string, max: number) => s.length <= max && /^[a-zA-Z0-9_.-]+$/.test(s) ? s : null;
type Evidence = {
  pid: number; ppid: number | null; comm: string | null; process_state: string | null; start_ticks: string | null;
  relationship: string; identity: string; exe_basename: string | null; exe_status: string;
  fd_status: string; fd_count: number | null; writable_data_fds: number | null; classification: string; reason: string;
};
const empty = (pid: number): Evidence => ({ pid, ppid: null, comm: null, process_state: null, start_ticks: null,
  relationship: "unknown", identity: "unverified", exe_basename: null, exe_status: "unreadable", fd_status: "unreadable",
  fd_count: null, writable_data_fds: null, classification: "unreadable", reason: "STAT_UNREADABLE" });

// Snapshot evidence only. No cmdline, environment, executable paths, FD targets or errors leave this function.
// Descendant relationship is observable, never authorization to write or an executable-name exemption.
export function processFence(root: string = TARGET.data_root, proc = "/proc", self = process.pid) {
  const started = performance.now(), processes = new Map<number, Proc>(), observations: Evidence[] = [];
  let unknown = 0, unreadable = 0, owned = 0, ancestors = 0, fallback = 0, writable = 0, fdUnreadable = 0, zombies = 0;
  const bound = () => { if (performance.now() - started > 1_000) throw Error("process budget"); };
  const ids = () => fs.readdirSync(proc).filter(p => /^\d+$/.test(p)).map(Number).sort((a, b) => a - b);
  try {
    const before = ids();
    if (before.length > 256) throw Error("process count bound");
    for (const pid of before) {
      bound();
      try { processes.set(pid, stat(proc, pid)); }
      catch { unreadable++; observations.push(empty(pid)); }
    }
    const lineage = new Set<number>();
    let next = processes.get(self)?.parent;
    if (next === undefined) throw Error("self lineage unavailable");
    while (next) {
      if (lineage.has(next) || lineage.size >= 64 || !processes.has(next)) throw Error("ancestor lineage incomplete");
      lineage.add(next); next = processes.get(next)!.parent;
    }
    for (const p of processes.values()) {
      if (p.pid === self) continue;
      bound();
      const e = { ...empty(p.pid), ppid: p.parent, comm: name(p.comm, 15), process_state: p.state, start_ticks: p.start,
        classification: "unknown", reason: "UNRELATED_PROCESS", relationship: "unrelated" };
      observations.push(e);
      let parent = p.parent, depth = 0;
      const visited = new Set<number>();
      while (parent && parent !== self && depth++ < 64 && !visited.has(parent)) { visited.add(parent); parent = processes.get(parent)?.parent ?? 0; }
      if (parent === self) { owned++; e.relationship = "control-descendant-unregistered"; e.reason = "UNREGISTERED_OWNED_CHILD"; }
      if (lineage.has(p.pid)) e.relationship = "control-ancestor";
      let exe: string | null = null;
      try { exe = path.basename(fs.readlinkSync(`${proc}/${p.pid}/exe`)); e.exe_status = "readable"; e.exe_basename = name(exe, 64); }
      catch { /* An unreadable exe is evidence, never proof of exit. */ }
      // Inventory permission failure is not an empty inventory, including for zombies.
      try {
        const fds = fs.readdirSync(`${proc}/${p.pid}/fd`).sort();
        if (fds.length > 1024 || fds.some(fd => !/^\d+$/.test(fd))) throw Error("FD bound");
        e.fd_count = fds.length; e.writable_data_fds = 0; e.fd_status = "readable";
        for (const fd of fds) {
          bound();
          try {
            const target = fs.readlinkSync(`${proc}/${p.pid}/fd/${fd}`).replace(/ \(deleted\)$/, "");
            if (target !== root && !target.startsWith(root + "/")) continue;
            const flags = /^flags:\s+([0-7]+)$/m.exec(fs.readFileSync(`${proc}/${p.pid}/fdinfo/${fd}`, "utf8"))?.[1];
            if (!flags) throw Error("FD flags unavailable");
            if ((parseInt(flags, 8) & 3) !== 0) { writable++; e.writable_data_fds++; }
          } catch { fdUnreadable++; e.fd_status = "incomplete"; }
        }
        if (JSON.stringify(fds) !== JSON.stringify(fs.readdirSync(`${proc}/${p.pid}/fd`).sort())) {
          fdUnreadable++; e.fd_status = "changed";
        }
      } catch { fdUnreadable++; e.fd_status = "unreadable"; }
      if (e.fd_status !== "readable") e.writable_data_fds = null;
      const again = stat(proc, p.pid);
      e.identity = same(p, again) ? "stable-reread" : "changed";
      if (e.identity !== "stable-reread") { unreadable++; e.reason = "PROCESS_IDENTITY_CHANGED"; continue; }
      // Linux Z means exit has completed. Require two Z snapshots of the same identity AND a readable empty FD table.
      // No PID, name, age, ownership or unreadable-FD exemption; a live helper remains unknown.
      if (p.state === "Z" && again.state === "Z" && e.fd_status === "readable" && e.fd_count === 0) {
        zombies++; e.classification = "non-writing-zombie"; e.reason = "STABLE_ZOMBIE_EMPTY_FD_TABLE";
      } else if (lineage.has(p.pid)) {
        const comm = fs.readFileSync(`${proc}/${p.pid}/comm`, "utf8").trim();
        if (INIT.has(comm) && p.comm === comm && (exe === comm || exe === null)) {
          e.classification = "expected-ancestor"; ancestors++;
          e.reason = exe ? "INIT_EXE_AND_VERIFIED_LINEAGE" : "INIT_COMM_AND_VERIFIED_LINEAGE_EXE_UNREADABLE";
          if (!exe) fallback++;
        } else e.reason = "UNEXPECTED_ANCESTOR";
      }
      if (e.classification === "unknown") { if (exe) unknown++; else { unreadable++; e.reason = "UNTRUSTED_EXE_UNREADABLE"; } }
      if (e.writable_data_fds) e.reason = "OTHER_PROCESS_CAN_WRITE_DATA_ROOT";
    }
    // Re-read every identity, including self and lineage, after scanning all FDs. PID reuse/set changes cannot confer trust.
    if (JSON.stringify(before) !== JSON.stringify(ids())) throw Error("process set changed");
    for (const p of processes.values()) {
      bound(); const after = stat(proc, p.pid);
      if (!same(p, after) || (p.state === "Z" && after.state !== "Z")) {
        unreadable++;
        const e = observations.find(e => e.pid === p.pid);
        if (e) { e.identity = "changed"; e.classification = "unknown"; e.reason = "PROCESS_IDENTITY_CHANGED"; }
      }
    }
  } catch { unreadable++; observations.push({ ...empty(0), reason: "PROCESS_OR_LINEAGE_SCAN_INCOMPLETE" }); }
  return { unknown, unreadable, owned_children: owned, expected_ancestors: ancestors, ancestor_exe_fallback: fallback,
    non_writing_zombies: zombies, writable_data_fds: writable, fd_unreadable: fdUnreadable, observations,
    scope: "bounded proc snapshot; identity rechecked; unregistered descendants are not trusted",
    state: unknown || unreadable || writable || fdUnreadable ? "UNKNOWN/HOLD" : "exclusive-process-observed" };
}

import fs from "node:fs";
import path from "node:path";
import { TARGET } from "./contract";

const INIT = new Set(["tini", "dumb-init", "railway-init", "docker-init"]);
const gone = (e: unknown) => ["ENOENT", "ESRCH"].includes((e as NodeJS.ErrnoException).code ?? "");
type Proc = { pid: number; parent: number; comm: string; start: string };
function stat(proc: string, pid: number): Proc {
  const raw = fs.readFileSync(`${proc}/${pid}/stat`, "utf8"), end = raw.lastIndexOf(")");
  const fields = raw.slice(end + 2).trim().split(/\s+/);
  const parent = Number(fields[1]), start = fields[19];
  if (end < 0 || !Number.isSafeInteger(parent) || !/^\d+$/.test(start ?? "")) throw Error("stat unavailable");
  return { pid, parent, comm: raw.slice(raw.indexOf("(") + 1, end), start };
}

// Never return cmdline, environment, executable paths, FD targets or raw errors.
// A familiar executable name alone does NOT make an unrelated process trusted.
export function processFence(root: string = TARGET.data_root, proc = "/proc", self = process.pid) {
  const started = performance.now(), processes = new Map<number, Proc>();
  const observations: { pid: number; classification: string; reason: string }[] = [];
  let unknown = 0, unreadable = 0, owned = 0, ancestors = 0, fallback = 0, writable = 0, fdUnreadable = 0;
  const bound = () => { if (performance.now() - started > 1_000) throw Error("process budget"); };
  try {
    const ids = fs.readdirSync(proc).filter(p => /^\d+$/.test(p));
    if (ids.length > 256) throw Error("process count bound");
    for (const id of ids) {
      bound();
      try { processes.set(Number(id), stat(proc, Number(id))); }
      catch (e) { if (!gone(e)) { unreadable++; observations.push({ pid: Number(id), classification: "unreadable", reason: "STAT_UNREADABLE" }); } }
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
      let classification = "unknown", reason = "UNRELATED_PROCESS", exe: string | null = null;
      let parent = p.parent, depth = 0;
      while (parent && parent !== self && depth++ < 64) parent = processes.get(parent)?.parent ?? 0;
      if (parent === self) { owned++; reason = "UNREGISTERED_OWNED_CHILD"; }
      try { exe = path.basename(fs.readlinkSync(`${proc}/${p.pid}/exe`)); }
      catch (e) {
        // ENOENT can mean a live non-dumpable/zombie process, not just exit.
        if (gone(e) && !fs.existsSync(`${proc}/${p.pid}`)) continue;
      }
      if (lineage.has(p.pid)) {
        const comm = fs.readFileSync(`${proc}/${p.pid}/comm`, "utf8").trim();
        if (INIT.has(comm) && p.comm === comm && (exe === comm || exe === null)) {
          const again = stat(proc, p.pid);
          if (again.parent === p.parent && again.start === p.start && again.comm === p.comm) {
            classification = "expected-ancestor"; ancestors++;
            reason = exe ? "INIT_EXE_AND_VERIFIED_LINEAGE" : "INIT_COMM_AND_VERIFIED_LINEAGE_EXE_UNREADABLE";
            if (!exe) fallback++;
          } else reason = "PROCESS_IDENTITY_CHANGED";
        } else reason = "UNEXPECTED_ANCESTOR";
      }
      if (classification === "unknown") { if (exe) unknown++; else { unreadable++; reason = "UNTRUSTED_EXE_UNREADABLE"; } }
      observations.push({ pid: p.pid, classification, reason });
      // Infrastructure ancestry never exempts a process from the FD fence.
      try {
        const fds = fs.readdirSync(`${proc}/${p.pid}/fd`);
        if (fds.length > 1024) throw Error("FD count bound");
        for (const fd of fds) {
          bound();
          try {
            const target = fs.readlinkSync(`${proc}/${p.pid}/fd/${fd}`).replace(/ \(deleted\)$/, "");
            if (target !== root && !target.startsWith(root + "/")) continue;
            const info = fs.readFileSync(`${proc}/${p.pid}/fdinfo/${fd}`, "utf8");
            const flags = /^flags:\s+([0-7]+)$/m.exec(info)?.[1];
            if (!flags) throw Error("FD flags unavailable");
            if ((parseInt(flags, 8) & 3) !== 0) { writable++; observations.push({ pid: p.pid, classification: "writable-wave3-fd", reason: "OTHER_PROCESS_CAN_WRITE_DATA_ROOT" }); }
          } catch (e) { if (!gone(e)) fdUnreadable++; }
        }
      } catch (e) { if (!gone(e)) fdUnreadable++; }
      if (fs.existsSync(`${proc}/${p.pid}`)) {
        const again = stat(proc, p.pid);
        if (again.parent !== p.parent || again.start !== p.start || again.comm !== p.comm) unreadable++;
      }
    }
    // Do not silently miss processes born during the scan.
    const added = fs.readdirSync(proc).filter(p => /^\d+$/.test(p) && !processes.has(Number(p)));
    if (added.length) { unknown += added.length; observations.push({ pid: 0, classification: "unknown", reason: "PROCESS_SET_CHANGED" }); }
  } catch { unreadable++; observations.push({ pid: 0, classification: "unreadable", reason: "PROCESS_OR_LINEAGE_SCAN_INCOMPLETE" }); }
  return { unknown, unreadable, owned_children: owned, expected_ancestors: ancestors, ancestor_exe_fallback: fallback,
    writable_data_fds: writable, fd_unreadable: fdUnreadable, observations,
    state: unknown || unreadable || writable || fdUnreadable ? "UNKNOWN/HOLD" : "exclusive-process-observed" };
}

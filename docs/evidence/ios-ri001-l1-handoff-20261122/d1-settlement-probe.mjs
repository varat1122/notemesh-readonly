// Disposable D1 evidence probe. NOT application code. Runs only in a fresh tmp dir.
// Compares: (A) current order (publish barrier, child keeps running) vs
// (B) user-space pre-publication settlement (SIGSTOP+enumerate pgid/ppid tree+SIGKILL, verify, then publish)
// on: same-pgid child, same-pgid background descendant, setsid+double-fork daemon, git auto-gc detach.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const wait = ms => new Promise(r => setTimeout(r, ms));
function procs() {
  const out = [];
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = fs.readFileSync(`/proc/${d}/stat`, "utf8"); const r = s.slice(s.lastIndexOf(")") + 2).split(" ");
      out.push({ pid: +d, state: r[0], ppid: +r[1], pgid: +r[2], sid: +r[3] });
    } catch { /* exited */ }
  }
  return out;
}
// Freeze-then-kill everything reachable by pgid OR live ppid chain from root. Synchronous.
function settle(root) {
  const seen = new Set();
  for (let round = 0; round < 50; round++) {
    const ps = procs(); let grew = false;
    for (const p of ps) {
      const inTree = p.pgid === root || seen.has(p.ppid) || p.pid === root;
      if (inTree && !seen.has(p.pid)) { seen.add(p.pid); grew = true; try { process.kill(p.pid, "SIGSTOP"); } catch {} }
    }
    if (!grew) break;
  }
  for (const pid of seen) try { process.kill(pid, "SIGKILL"); } catch {}
  try { process.kill(-root, "SIGKILL"); } catch {}
  const deadline = Date.now() + 2000;
  for (;;) {
    const live = procs().filter(p => seen.has(p.pid) && p.state !== "Z" && p.state !== "X");
    if (!live.length) return { verified: true, killed: seen.size };
    if (Date.now() > deadline) return { verified: false, live: live.length };
    sleep(5);
  }
}
async function scenario(name, script, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d1probe-"));
  const child = spawn("sh", ["-c", script], { cwd: dir, detached: true, stdio: "ignore" });
  const exited = new Promise(r => child.on("exit", (c, s) => r({ c, s })));
  for (let i = 0; i < 300 && !fs.existsSync(path.join(dir, "started")); i++) await wait(10);
  let settlement = null;
  if (mode === "B") settlement = settle(child.pid);
  fs.writeFileSync(path.join(dir, "BARRIER_PUBLISHED"), "");           // durable DRAINING stand-in
  fs.writeFileSync(path.join(dir, "release"), "");
  await Promise.race([exited, wait(1500)]); await wait(600);
  const late = fs.readdirSync(dir).filter(f => f.endsWith("-business"));
  for (const p of procs()) if (p.sid === child.pid || p.pgid === child.pid) try { process.kill(p.pid, "SIGKILL"); } catch {}
  for (const p of procs()) { try { if (fs.readlinkSync(`/proc/${p.pid}/cwd`) === dir) process.kill(p.pid, "SIGKILL"); } catch {} } // cleanup this probe's escapes only
  fs.rmSync(dir, { recursive: true, force: true });
  return { name, mode, settlement, lateBusinessAfterBarrier: late };
}
const W = "while test ! -f release; do sleep 0.01; done";
const cases = {
  child_same_pgid: `touch started; ${W}; printf x > late-business`,
  bg_descendant_same_pgid: `( ${W}; printf x > bg-business ) & touch started; wait`,
  setsid_double_fork_daemon: `setsid sh -c '( ${W}; printf x > daemon-business ) &' ; sleep 0.05; touch started; ${W}`,
};
const results = [];
for (const [n, s] of Object.entries(cases)) for (const m of ["A", "B"]) results.push(await scenario(n, s, m));
console.log(JSON.stringify({ probe: "d1-settlement", uid: process.getuid(), results }, null, 1));

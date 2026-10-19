import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  assertIsolatedInterprocessFixture,
  withFixtureInterprocessExclusion,
  acquireFixtureInterprocessTicket,
} from "./nm-interprocess-fixture-gate.mjs";

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), "nm-dr-ipc-fixture-"));
const lockDir = root => path.join(root, ".notemesh-fixture-exclusive");

// Separate real Node process, not another Promise in this test process.
async function holdInChild(root) {
  const url = new URL("./nm-interprocess-fixture-gate.mjs", import.meta.url).href;
  const program = `import {withFixtureInterprocessExclusion} from ${JSON.stringify(url)};
    await withFixtureInterprocessExclusion(process.argv[1],"writer",async()=>{
      process.stdout.write("LOCKED\\n");
      await new Promise(resolve => process.stdin.once("data",resolve));
    });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", program, root], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, RAILWAY_PROJECT_ID:"", RAILWAY_SERVICE_ID:"",
      RAILWAY_ENVIRONMENT_ID:"", RAILWAY_ENVIRONMENT_NAME:"",
      RAILWAY_PROJECT_NAME:"", RAILWAY_SERVICE_NAME:"" },
  });
  let stderr = "";
  child.stderr.on("data", buffer => { stderr += buffer.toString().slice(0, 1000); });
  try {
    const first = await Promise.race([
      once(child.stdout, "data").then(args => args[0].toString()),
      once(child, "exit").then(([code]) => { throw Error("child_exited_before_lock: " + code + " " + stderr); }),
      new Promise((_, reject) => setTimeout(() => reject(Error("child_lock_timeout")), 5000)),
    ]);
    assert.match(first, /LOCKED/);
    return child;
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}
async function stopChild(child, signal=null) {
  const exited = once(child, "exit");
  if (signal) child.kill(signal);
  else child.stdin.end("release\n"); // EOF allows the held child process to exit.
  const [code, sig] = await exited;
  if (!signal) assert.equal(code, 0);
  else assert.equal(sig, signal);
}

test("real second process holding writer admission blocks fixture snapshot; retry only after release", async () => {
  const root = fixture();
  let child;
  try {
    child = await holdInChild(root);
    let captured = false;
    await assert.rejects(
      withFixtureInterprocessExclusion(root, "snapshot", () => { captured = true; }),
      /dr_ipc_gate_occupied_fail_closed/,
    );
    assert.equal(captured, false);
    await stopChild(child);
    child = null;
    const result = await withFixtureInterprocessExclusion(root, "snapshot", async () => {
      assert.ok(fs.existsSync(lockDir(root)));
      return "synthetic-capture";
    });
    assert.equal(result, "synthetic-capture");
    assert.equal(fs.existsSync(lockDir(root)), false);
  } finally {
    if (child) { child.kill("SIGKILL"); await once(child, "exit").catch(() => {}); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("crashed real child leaves a sticky lock; PID age never automatically authorizes capture", async () => {
  const root = fixture();
  let child;
  try {
    child = await holdInChild(root);
    await stopChild(child, "SIGKILL");
    child = null;
    assert.equal(fs.existsSync(lockDir(root)), true);
    await assert.rejects(
      withFixtureInterprocessExclusion(root, "snapshot", () => "never"),
      /dr_ipc_gate_occupied_fail_closed/,
    );
    assert.equal(fs.existsSync(lockDir(root)), true);
  } finally {
    if (child) { child.kill("SIGKILL"); await once(child, "exit").catch(() => {}); }
    // Operator-only fixture cleanup; no lock reaping inside the implementation.
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("overlap, callback failure and tampered ownership fail closed", async () => {
  const root = fixture();
  try {
    await withFixtureInterprocessExclusion(root, "writer", async () => {
      await assert.rejects(
        withFixtureInterprocessExclusion(root, "writer", () => 1),
        /dr_ipc_gate_occupied_fail_closed/,
      );
    });
    assert.equal(fs.existsSync(lockDir(root)), false);
    await assert.rejects(
      withFixtureInterprocessExclusion(root, "snapshot", () => { throw Error("synthetic_capture_error"); }),
      /synthetic_capture_error/,
    );
    assert.equal(fs.existsSync(lockDir(root)), false);
    await assert.rejects(
      withFixtureInterprocessExclusion(root, "writer", () => {
        fs.writeFileSync(path.join(lockDir(root), "holder"), "modified-by-another-owner");
      }),
      /dr_ipc_gate_ownership_lost_fail_closed/,
    );
    assert.equal(fs.existsSync(lockDir(root)), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("refuses Railway, production locations, symlink aliases and invalid purpose before claiming a gate", async () => {
  const root = fixture(), alias = root + "-alias";
  try {
    const original = process.env.RAILWAY_SERVICE_ID;
    try {
      process.env.RAILWAY_SERVICE_ID = "railway-synthetic";
      assert.throws(() => assertIsolatedInterprocessFixture(root), /no_railway/);
    } finally {
      if (original === undefined) delete process.env.RAILWAY_SERVICE_ID;
      else process.env.RAILWAY_SERVICE_ID = original;
    }
    assert.throws(() => assertIsolatedInterprocessFixture("/data"), /outside_scratch/);
    assert.throws(() => assertIsolatedInterprocessFixture("/app/data"), /outside_scratch/);
    fs.symlinkSync(root, alias);
    assert.throws(() => assertIsolatedInterprocessFixture(alias), /outside_scratch|unsafe/);
    await assert.rejects(withFixtureInterprocessExclusion(root, "other", () => true), /invalid_purpose/);
    assert.equal(fs.existsSync(lockDir(root)), false);
  } finally {
    fs.rmSync(alias, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("explicit resource-lifetime writer ticket blocks a REAL second process until release", async () => {
  const root = fixture(), url = new URL("./nm-interprocess-fixture-gate.mjs", import.meta.url).href;
  // The runner has no access to the parent's in-memory gate; this is a
  // separate Node process using only the shared fixture filesystem.
  const script = `import {withFixtureInterprocessExclusion} from ${JSON.stringify(url)};
    try {
      await withFixtureInterprocessExclusion(process.argv[1],"snapshot",()=>process.stdout.write("CAPTURED"));
    } catch(e) {
      process.stderr.write(String(e.message));
      process.exitCode=3;
    }`;
  const env = { ...process.env, RAILWAY_PROJECT_ID:"", RAILWAY_SERVICE_ID:"",
    RAILWAY_ENVIRONMENT_ID:"", RAILWAY_ENVIRONMENT_NAME:"",
    RAILWAY_PROJECT_NAME:"", RAILWAY_SERVICE_NAME:"" };
  let ticket;
  try {
    ticket = acquireFixtureInterprocessTicket(root, "writer");
    const first = spawnSync(process.execPath, ["--input-type=module","-e",script,root],
      {env,encoding:"utf8",timeout:5000});
    assert.equal(first.status,3);
    assert.match(first.stderr,/dr_ipc_gate_occupied_fail_closed/);
    assert.doesNotMatch(first.stdout,/CAPTURED/);
    assert.ok(fs.existsSync(lockDir(root)));

    ticket.release();
    assert.throws(()=>ticket.release(),/dr_ipc_ticket_already_released/);
    ticket = null;

    const second = spawnSync(process.execPath, ["--input-type=module","-e",script,root],
      {env,encoding:"utf8",timeout:5000});
    assert.equal(second.status,0,second.stderr);
    assert.match(second.stdout,/CAPTURED/);
    assert.equal(fs.existsSync(lockDir(root)),false);
  } finally {
    // A held gate is not auto-reaped in production. This is fixture cleanup.
    try { ticket?.release(); } catch { /* no unsafe reclamation */ }
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("resource ticket tampering is rejected and the gate remains sticky", async () => {
  const root = fixture();
  try {
    const ticket = acquireFixtureInterprocessTicket(root,"writer");
    fs.writeFileSync(path.join(lockDir(root),"holder"),"attacker");
    assert.throws(()=>ticket.release(),/ownership_lost_fail_closed/);
    assert.ok(fs.existsSync(lockDir(root)));
    await assert.rejects(
      withFixtureInterprocessExclusion(root,"snapshot",()=>true),
      /occupied_fail_closed/,
    );
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("unregistered external writer bypasses cooperative lock: NO Production proof", async () => {
  const root = fixture();
  try {
    await withFixtureInterprocessExclusion(root,"snapshot",async()=>{
      const file = path.join(root,"unregistered.txt");
      const result = spawnSync(process.execPath,[
        "-e","require('node:fs').writeFileSync(process.argv[1],'unfenced')",file,
      ],{encoding:"utf8",timeout:5000});
      assert.equal(result.status,0,result.stderr);
      assert.equal(fs.readFileSync(file,"utf8"),"unfenced");
      // Demonstrates that cooperation of ALL write paths is a release blocker.
    });
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MANDATORY_WRITER_CLASSES,
  inspectWriterCoverageRegister,
  assertSourceWitnessRegisterStable,
} from "./nm-writer-coverage-register.mjs";

function syntheticSourceTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-writer-register-"));
  for (const cls of MANDATORY_WRITER_CLASSES) {
    for (const [relative,literal] of cls.witnesses) {
      const dest=path.join(root,relative);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.appendFileSync(dest,literal+"\n");
    }
  }
  return root;
}

test("real repository writer witnesses have not silently disappeared", () => {
  const root = path.resolve(new URL("../../",import.meta.url).pathname);
  const report = assertSourceWitnessRegisterStable(root);
  assert.equal(report.witnessDrift.length,0);
  assert.equal(report.approvalStatus,"NO_GO");
  assert.equal(report.productionSnapshotReady,false);
  assert.equal(report.runtimeVerifiedClasses,0);
  assert.equal(report.externalWriterQuiescenceVerified,false);
  assert.equal(report.independentRestoreVerified,false);
  assert.ok(report.classCount>=12);
  assert.ok(report.candidateCount>10);
  assert.ok(report.unclassifiedCandidateCount>0,
    "unmapped source candidates must be visible as gaps, never silently approved");
  assert.ok(report.classes.every(c=>c.runtimeCoverage==="not_verified"));
  const byId=new Map(report.classes.map(c=>[c.id,c]));
  for(const id of ["app_sqlite_wal","better_auth_adapter","git_sync",
    "obsidian_sync","market_price_drive","external_devices"]) {
    assert.ok(byId.has(id),id);
  }
  for(const id of ["other_processes_and_replicas","external_devices"])
    assert.equal(byId.get(id).sourceWitnessStatus,"runtime_only");
});

test("synthetic source tokens can all match while production remains NO_GO", () => {
  const root = syntheticSourceTree();
  try {
    const report=assertSourceWitnessRegisterStable(root);
    assert.equal(report.witnessDrift.length,0);
    assert.equal(report.productionSnapshotReady,false);
    assert.equal(report.runtimeVerifiedClasses,0);
    assert.equal(report.approvalStatus,"NO_GO");
    assert.equal(report.externalWriterQuiescenceVerified,false);
    assert.equal(report.independentRestoreVerified,false);
    assert.ok(report.classes.every(c=>c.runtimeCoverage==="not_verified"));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("moving or removing a known write witness creates fail-closed audit drift", () => {
  const root = syntheticSourceTree();
  try {
    const p=path.join(root,"src/server/db.ts");
    fs.writeFileSync(p,"// SQLite write implementation moved; cannot assume risk disappeared\n");
    const report=inspectWriterCoverageRegister(root);
    assert.equal(report.productionSnapshotReady,false);
    assert.equal(report.approvalStatus,"NO_GO");
    assert.ok(report.witnessDrift.some(w=>w.classId==="app_sqlite_wal" &&
      w.file==="src/server/db.ts"));
    assert.throws(()=>assertSourceWitnessRegisterStable(root),
      /dr_writer_source_witness_drift_fail_closed/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("a symlinked witness never satisfies a source audit", () => {
  const root=syntheticSourceTree(),external=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-writer-external-"));
  try {
    const relative="src/server/auth.ts",target=path.join(root,relative);
    fs.copyFileSync(target,path.join(external,"auth.ts"));
    fs.unlinkSync(target);
    fs.symlinkSync(path.join(external,"auth.ts"),target);
    const report=inspectWriterCoverageRegister(root);
    assert.ok(report.witnessDrift.some(w=>w.classId==="better_auth_adapter"));
    assert.throws(()=>assertSourceWitnessRegisterStable(root),
      /dr_writer_source_witness_drift_fail_closed/);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
    fs.rmSync(external,{recursive:true,force:true});
  }
});

test("new unmapped write-capable sources are surfaced without readiness promotion", () => {
  const root=syntheticSourceTree();
  try {
    const f=path.join(root,"src/server/unregistered-remote-worker.ts");
    fs.writeFileSync(f,'export function start(){fs.writeFileSync("/fixture","unregistered");}\n');
    const report=inspectWriterCoverageRegister(root);
    assert.ok(report.unclassifiedCandidateFiles.includes("src/server/unregistered-remote-worker.ts"));
    assert.ok(report.unclassifiedCandidateCount>0);
    assert.equal(report.productionSnapshotReady,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inventoryWriterSurfaces } from "./nm-writer-source-inventory.mjs";

test("source inventory identifies direct SQL, disk and child-process writers without certifying coverage",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-source-audit-"));
  try{
    fs.mkdirSync(path.join(root,"src/server"),{recursive:true});
    fs.mkdirSync(path.join(root,"src/routes"),{recursive:true});
    fs.writeFileSync(path.join(root,"src/server","unguarded.ts"),
      'export const writer=()=>{fs.writeFileSync("sample","x");db().prepare("DELETE FROM x").run();};\n');
    fs.writeFileSync(path.join(root,"src/server","referenced.ts"),
      'import {inProcessDrWriterFence} from "./backup/writer-fence";\n'+
      'export const writer=()=>fs.renameSync("a","b");\n');
    fs.writeFileSync(path.join(root,"src/routes","command.ts"),
      'export const command=()=>runGit(["fetch"]);\n');
    fs.writeFileSync(path.join(root,"src/server","test-only.test.ts"),
      'fs.writeFileSync("not production code","x");\n');
    const report=inventoryWriterSurfaces(root);
    assert.equal(report.productionSnapshotReady,false);
    assert.equal(report.completeRuntimeWriterCoverageVerified,false);
    assert.equal(report.externalWriterQuiescenceVerified,false);
    assert.equal(report.evidenceClassification,"source_heuristic_human_review_required");
    assert.equal(report.analyzedFiles,3);
    assert.equal(report.candidateCount,4);
    assert.equal(report.noFenceReferenceCount,3);
    assert.ok(report.candidates.some(x=>x.kind==="sqlite_statement" && !x.fenceReferencedSomewhereInFile));
    assert.ok(report.candidates.some(x=>x.kind==="filesystem" && x.fenceReferencedSomewhereInFile && !x.verified));
    assert.ok(!JSON.stringify(report).includes("sample"));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("real repository inventory does not silently promote green tests into snapshot readiness",()=>{
  const root=path.resolve(new URL("../../",import.meta.url).pathname);
  const result=inventoryWriterSurfaces(root);
  assert.ok(result.analyzedFiles>30);
  assert.ok(result.candidateCount>10);
  assert.ok(result.noFenceReferenceCount>0);
  assert.equal(result.productionSnapshotReady,false);
  assert.equal(result.completeRuntimeWriterCoverageVerified,false);
  assert.ok(result.candidates.every(x=>x.verified===false));
  // This is a prioritized, intentionally incomplete human review register.
  // No source heuristic is a distributed lock, runtime attestation or approval.
});

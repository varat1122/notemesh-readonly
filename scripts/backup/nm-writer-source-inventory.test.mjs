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
      'export const command=()=>runGit(["fetch"]);\nexport const verify=()=>auth.api.verifyApiKey({body:{key:"fixture"}});\n');
    fs.writeFileSync(path.join(root,"src/server","test-only.test.ts"),
      'fs.writeFileSync("not production code","x");\n');
    const report=inventoryWriterSurfaces(root);
    assert.equal(report.productionSnapshotReady,false);
    assert.equal(report.completeRuntimeWriterCoverageVerified,false);
    assert.equal(report.externalWriterQuiescenceVerified,false);
    assert.equal(report.evidenceClassification,"source_heuristic_human_review_required");
    assert.equal(report.analyzedFiles,3);
    assert.equal(report.candidateCount,5);
    assert.equal(report.noFenceReferenceCount,4);
    assert.ok(report.candidates.some(x=>x.kind==="auth_adapter" && !x.fenceReferencedSomewhereInFile));
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

test("source audit catches async fs writers, named-import aliases, streams and filehandles", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-async-writer-audit-"));
  try {
    fs.mkdirSync(path.join(root,"src/server"),{recursive:true});
    fs.mkdirSync(path.join(root,"src/routes"),{recursive:true});
    fs.writeFileSync(path.join(root,"src/server","async-writers.ts"), [
      'import { writeFile as persist, readFile } from "node:fs/promises";',
      'import { createWriteStream } from "node:fs";',
      'export async function candidates() {',
      '  await fs.promises.rename("old","new");',
      '  await fsp.copyFile("old","new");',
      '  await fsPromises.open("new","w");',
      '  await persist("new","payload");',
      '  const handle = await fs.promises.open("new","w");',
      '  await handle.writeFile("payload");',
      '  fs.createWriteStream("new");',
      '  createWriteStream("new");',
      '  await readFile("new");',
      '}',
    ].join("\\n"));
    const report=inventoryWriterSurfaces(root);
    const detected=new Set(report.candidates.map(x=>x.kind));
    assert.ok(detected.has("filesystem_async"));
    assert.ok(detected.has("filesystem_named_import"));
    assert.ok(detected.has("filesystem_filehandle"));
    assert.ok(detected.has("filesystem_stream"));
    assert.ok(!report.candidates.some(x=>x.line===12), "read-only import must not be promoted as a writer");
    assert.ok(report.candidates.every(x=>x.verified===false));
    assert.equal(report.productionSnapshotReady,false);
    assert.equal(report.externalWriterQuiescenceVerified,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

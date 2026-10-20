import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {execFileSync} from "node:child_process";

let root:string,vault:string,snapshot:string;
const note="10_Knowledge/Company Research/ASML - Historical.md";
const source="07_Sources/ChatGPT/Conversations/ASML chat.md";
const hub="01_Companies/ASML.md";
function put(rel:string,content:string){
  const p=path.join(vault,rel);fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,content);
}
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-snapshot-qa-")));
  vault=path.join(root,"vault");
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-offline-segregated-")));
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(root,{recursive:true,force:true});
  fs.rmSync(snapshot,{recursive:true,force:true});
  delete process.env.DATA_DIR;
  delete process.env.RAILWAY_PROJECT_ID;
});
async function makeIsolatedSnapshot(){
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
  fs.mkdirSync(snapshot,{recursive:true});
  fs.cpSync(vault,path.join(snapshot,"vault"),{
    recursive:true,preserveTimestamps:true,
  });
  const {db}=await import("../db");
  // SQLite's official backup API produces a logically consistent standalone
  // copy, unlike copying app.sqlite without its pending WAL bytes.
  await db().backup(path.join(snapshot,"app.sqlite"));
}
function fixture(){
  put(note,["---","type: knowledge_note","source_type: chatgpt_history",
    "verification: not_reverified","company: ['ASML']",
    "source_records:","  - "+source,"---",
    "# Archived analysis","Earlier claim is NOT issuer verified.",
    "[[01_Companies/ASML]]","[[07_Sources/ChatGPT/Conversations/ASML chat]]"].join("\n"));
  put(source,"---\ntype: chatgpt_archive\n---\n# Chat history\nNo primary evidence");
  put(hub,"---\ntype: company\n---\n# ASML company");
  const attachment=path.join(vault,"Attachments","issuer.pdf");
  fs.mkdirSync(path.dirname(attachment),{recursive:true});
  fs.writeFileSync(attachment,Buffer.from("sample PDF fixture - not a primary original"));
}
describe("offline isolated Vault+SQLite metadata / FTS / link coverage acceptance",()=>{
  it("reconciles a real scratch-index backup and never upgrades archived AI to primary evidence",async()=>{
    fixture();
    const before=fs.readFileSync(path.join(vault,note));
    await makeIsolatedSnapshot();
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    const report=verifyOfflineSnapshotCoverage(snapshot);
    expect(report).toMatchObject({
      status:"snapshot_markdown_index_reconciled_not_originals_verified",
      scannedPhysicalNotes:3,indexedMarkdownNotes:3,comparedMarkdownNotes:3,
      scannedPhysicalAttachments:1,indexedAttachments:1,checkedAttachmentMetadata:1,
      sqliteQuickCheckPassed:true,issueCounts:{},
      immutableMountVerified:false,
      sourceOriginalArchiveCoverageVerified:false,
      originalSourceIndependenceVerified:false,
      investmentClaimFactsVerified:false,
      disasterRecoveryAccepted:false,canAutoWrite:false,canAutoUpdateThesis:false,
    });
    expect(report.markdownContentManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(path.join(vault,note))).toEqual(before);
    expect(fs.readFileSync(path.join(snapshot,"vault",note))).toEqual(before);
  });
  it("runs the explicit offline CLI against a segregated scratch snapshot",async()=>{
    fixture();await makeIsolatedSnapshot();
    const output=execFileSync("pnpm",[
      "snapshot:coverage:offline",snapshot,
    ],{cwd:process.cwd(),encoding:"utf8",timeout:45_000});
    const report=JSON.parse(output) as {status:string;canAutoWrite:boolean};
    expect(report.status).toBe(
      "snapshot_markdown_index_reconciled_not_originals_verified");
    expect(report.canAutoWrite).toBe(false);
  });
  it("detects same-file-length and restored-mtime body tampering via indexed FTS",async()=>{
    fixture();await makeIsolatedSnapshot();
    const target=path.join(snapshot,"vault",note);
    const before=fs.statSync(target);
    const content=fs.readFileSync(target,"utf8");
    expect(content).toContain("Earlier claim");
    fs.writeFileSync(target,content.replace("Earlier claim","Altered claim"));
    fs.utimesSync(target,before.atime,before.mtime);
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    const report=verifyOfflineSnapshotCoverage(snapshot);
    expect(report.status).toBe("snapshot_coverage_hold");
    expect(report.issueCounts.index_note_body_mismatch).toBe(1);
    expect(report.investmentClaimFactsVerified).toBe(false);
  });
  it("detects unindexed physically present Markdown even when SQLite reports ready",async()=>{
    fixture();await makeIsolatedSnapshot();
    const newFile=path.join(snapshot,"vault","10_Knowledge","Unindexed.md");
    fs.mkdirSync(path.dirname(newFile),{recursive:true});
    fs.writeFileSync(newFile,"# Not indexed");
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    expect(verifyOfflineSnapshotCoverage(snapshot)).toMatchObject({
      status:"snapshot_coverage_hold",
      issueCounts:{physical_note_not_indexed:1},
      scannedPhysicalNotes:4,indexedMarkdownNotes:3,
    });
  });
  it("holds if an indexed file is missing from the segregated snapshot",async()=>{
    fixture();await makeIsolatedSnapshot();
    fs.rmSync(path.join(snapshot,"vault",note));
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    expect(verifyOfflineSnapshotCoverage(snapshot).issueCounts)
      .toMatchObject({indexed_note_absent_on_disk:1});
  });
  it("holds on stale attachment metadata and unindexed additional originals",async()=>{
    fixture();await makeIsolatedSnapshot();
    fs.writeFileSync(path.join(snapshot,"vault","Attachments","issuer.pdf"),"changed size");
    fs.writeFileSync(path.join(snapshot,"vault","Attachments","new-original.zip"),"unindexed");
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    const report=verifyOfflineSnapshotCoverage(snapshot);
    expect(report.issueCounts).toMatchObject({
      physical_attachment_not_indexed:1,index_attachment_version_mismatch:1,
    });
    expect(report.attachmentBytesVerified).toBe(false);
  });
  it("holds on indexed link drift independent of unchanged source bytes",async()=>{
    fixture();await makeIsolatedSnapshot();
    const dest=new Database(path.join(snapshot,"app.sqlite"));
    dest.prepare("DELETE FROM links WHERE source_path=?").run(note);
    dest.close();
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    expect(verifyOfflineSnapshotCoverage(snapshot).issueCounts)
      .toMatchObject({index_note_links_mismatch:1});
  });
  it("rejects visible symlinks and never reads their targets",async()=>{
    fixture();await makeIsolatedSnapshot();
    fs.symlinkSync("/etc/passwd",path.join(snapshot,"vault","spoof.md"));
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    expect(verifyOfflineSnapshotCoverage(snapshot).issueCounts)
      .toMatchObject({unsafe_or_symlink_path:1});
  });
  it("rejects live data directory, absent DB and Railway runtime without mutating anything",async()=>{
    fixture();await makeIsolatedSnapshot();
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    expect(()=>verifyOfflineSnapshotCoverage(root))
      .toThrow("snapshot_acceptance_live_data_directory_refused");
    const missing=path.join(root,"absent");
    fs.mkdirSync(path.join(missing,"vault"),{recursive:true});
    expect(()=>verifyOfflineSnapshotCoverage(missing)).toThrow();
    expect(fs.existsSync(path.join(missing,"app.sqlite"))).toBe(false);
    process.env.RAILWAY_PROJECT_ID="test-railway-project";
    expect(()=>verifyOfflineSnapshotCoverage(snapshot))
      .toThrow("snapshot_acceptance_refused_inside_railway_runtime");
  });
  it("treats unknown archived original bytes as unverified even if metadata perfectly reconciles",async()=>{
    put(note,["---","type: knowledge_note","source_type: chatgpt_history",
      "source_records:","  - 07_Sources/ChatGPT/Archive/Not-in-Markdown-Index.json",
      "---","# Source pointer not proof"].join("\n"));
    await makeIsolatedSnapshot();
    const {verifyOfflineSnapshotCoverage}=await import("./snapshot-coverage-acceptance");
    const r=verifyOfflineSnapshotCoverage(snapshot);
    expect(r.status).toBe("snapshot_markdown_index_reconciled_not_originals_verified");
    expect(r.sourceOriginalArchiveCoverageVerified).toBe(false);
    expect(r.originalSourceIndependenceVerified).toBe(false);
    expect(r.disasterRecoveryAccepted).toBe(false);
  });
});

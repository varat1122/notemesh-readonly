import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";

let root:string,vault:string,snapshot:string;
const url="https://www.sec.gov/Archives/edgar/data/2488/example.htm";
const independentNote="08_Daily_Weekly/Research Indexes/Synthetic - AMD Original.md";
const aiNote="10_Knowledge/Company Research/AMD - Archived Chat.md";
const bytes=Buffer.from("<!doctype html><html><body>Synthetic issuer input for QA only; not actual SEC content.</body></html>");
const hash=(v:Buffer)=>createHash("sha256").update(v).digest("hex");
function put(rel:string,content:string){
  const p=path.join(vault,rel);fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,content);
}
const meta=(urlValue=url,digest=hash(bytes))=>[
  "---","type: primary_ir_evidence_review","source_type: primary",
  "original_source: "+urlValue,"original_source_sha256: "+digest,
  "source_excerpt_sha256: "+hash(Buffer.from("excerpt")),
  "---","# Unverified original attribution",
].join("\n");
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-archive-source-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-archive-source-snapshot-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,6).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(root,{recursive:true,force:true});
  fs.rmSync(snapshot,{recursive:true,force:true});
  delete process.env.DATA_DIR;
  delete process.env.RAILWAY_PROJECT_ID;
});
async function prepare({store=true,withNotes=true}:{
  store?:boolean;withNotes?:boolean;
}={}){
  if(withNotes){
    put(independentNote,meta());
    put(aiNote,[
      "---","type: knowledge_note","source_type: chatgpt_history",
      "original_source: "+url,"verification: not_reverified",
      "---","# This archived AI summary is not independent evidence",
    ].join("\n"));
  }
  let digest:string|null=null;
  if(store){
    const {captureOriginalDocumentBytes}=await import("../research-source-archive");
    const row=captureOriginalDocumentBytes({
      originalSource:url,bytes,contentType:"text/html",
      capturedAt:"2026-10-20T00:00:00Z",
      captureMethod:"authorized_external_download",
      retrievedFrom:url,reviewerOrOperator:"synthetic-offline-qa",
    });
    digest=row.sha256;
  }
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  if(store)fs.cpSync(path.join(root,"source-archive"),path.join(snapshot,"source-archive"),
    {recursive:true,preserveTimestamps:true});
  return digest;
}
describe("offline original-source registry and provenance integrity (NO PROD)",()=>{
  it("matches stored bytes, registry versions and declared full hash without claiming publisher verification",async()=>{
    const digest=await prepare();
    const actual=fs.readFileSync(path.join(root,"source-archive","blobs",
      digest!.slice(0,2),digest+".bin"));
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    const report=verifyOfflineSourceArchiveCoverage(snapshot);
    expect(report).toMatchObject({
      status:"offline_archived_bytes_intact_not_publisher_verified",
      sourceSnapshotRecords:1,validSourceSnapshotRecords:1,
      distinctRegisteredBlobHashes:1,visibleBlobFiles:1,
      hashMatchedBlobs:1,invalidRegistryRows:0,issueCounts:{},
      noteReferenceCrosswalk:{
        notesWithExplicitSourceLocator:2,
        notesWithLocatorAndRegisteredOriginal:2,
        noteDeclaredFullHashesMatchingRegisteredVersion:1,
        derivativeOrArchivedAiNotesWithLocators:1,
        noteDeclaredExcerptHashesNotFullDocumentProof:1,
      },
      publisherIdentityVerified:false,originalSourceIndependenceVerified:false,
      excerptHashAcceptedAsOriginalHash:false,canAutoWrite:false,
      canAutoUpdateThesis:false,disasterRecoveryAccepted:false,
    });
    expect(actual.equals(bytes)).toBe(true);
    expect(fs.readFileSync(path.join(vault,independentNote),"utf8")).toBe(meta());
  });
  it("recognizes no registry as unverified, not as a clean original-source acceptance",async()=>{
    await prepare({store:false,withNotes:true});
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    const report=verifyOfflineSourceArchiveCoverage(snapshot);
    expect(report.status).toBe("offline_no_original_source_snapshots_unverified");
    expect(report.noteReferenceCrosswalk.notesWithLocatorButNoRegisteredOriginal).toBe(2);
    expect(report.originalSourceCoverageComplete).toBe(false);
  });
  it("detects same-size tampered original bytes without rewriting them",async()=>{
    const digest=await prepare();
    const blob=path.join(snapshot,"source-archive","blobs",digest!.slice(0,2),digest+".bin");
    const corrupted=Buffer.alloc(bytes.length,0x61);fs.writeFileSync(blob,corrupted);
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    expect(verifyOfflineSourceArchiveCoverage(snapshot)).toMatchObject({
      status:"offline_archive_bytes_integrity_hold",
      issueCounts:{original_blob_hash_mismatch:1},
      hashMatchedBlobs:0,
    });
    expect(fs.readFileSync(blob)).toEqual(corrupted);
  });
  it("detects missing registered blobs",async()=>{
    const digest=await prepare();
    fs.rmSync(path.join(snapshot,"source-archive","blobs",digest!.slice(0,2),digest+".bin"));
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    const report=verifyOfflineSourceArchiveCoverage(snapshot);
    expect(report.issueCounts.original_blob_missing).toBe(1);
    expect(report.status).toBe("offline_archive_bytes_integrity_hold");
  });
  it("detects an extra unregistered source blob, not independent evidence",async()=>{
    const digest=await prepare();
    const bogusHash=hash(Buffer.from("another source without registry"));
    const other=path.join(snapshot,"source-archive","blobs",bogusHash.slice(0,2));
    fs.mkdirSync(other,{recursive:true});
    fs.writeFileSync(path.join(other,bogusHash+".bin"),Buffer.alloc(40,0x61));
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    expect(verifyOfflineSourceArchiveCoverage(snapshot)).toMatchObject({
      status:"offline_archive_bytes_integrity_hold",
      issueCounts:{unregistered_source_archive_blob:1},
      sourceSnapshotRecords:1,hashMatchedBlobs:1,
    });
    expect(digest).toBe(hash(bytes));
  });
  it("holds symlinked source archive blobs, never dereferences targets",async()=>{
    const digest=await prepare();
    const blob=path.join(snapshot,"source-archive","blobs",digest!.slice(0,2),digest+".bin");
    fs.rmSync(blob);fs.symlinkSync("/etc/passwd",blob);
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    expect(verifyOfflineSourceArchiveCoverage(snapshot)).toMatchObject({
      status:"offline_archive_bytes_integrity_hold",
      issueCounts:{original_blob_unsafe_type_or_size:1},
    });
  });
  it("holds malformed registry metadata even when blob bytes are internally consistent",async()=>{
    await prepare();
    const Database=(await import("better-sqlite3")).default;
    const db=new Database(path.join(snapshot,"app.sqlite"));
    db.prepare("UPDATE source_snapshots SET source_key='https://example.org/'").run();
    db.close();
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    const r=verifyOfflineSourceArchiveCoverage(snapshot);
    expect(r.status).toBe("offline_archive_bytes_integrity_hold");
    expect(r.issueCounts.invalid_source_registry_metadata).toBe(1);
    expect(r.originalSourceCoverageComplete).toBe(false);
  });
  it("separates registered original-byte health from false note-declared full hashes",async()=>{
    const wrong="1".repeat(64);
    put(independentNote,meta(url,wrong));
    const {captureOriginalDocumentBytes}=await import("../research-source-archive");
    captureOriginalDocumentBytes({
      originalSource:url,bytes,contentType:"text/html",
      capturedAt:"2026-10-20T00:00:00Z",
      captureMethod:"authorized_external_download",retrievedFrom:url,
      reviewerOrOperator:"synthetic-offline-qa",
    });
    const {indexer}=await import("./indexer");await indexer().rebuild();
    fs.cpSync(vault,path.join(snapshot,"vault"),{recursive:true,preserveTimestamps:true});
    const {db}=await import("../db");await db().backup(path.join(snapshot,"app.sqlite"));
    fs.cpSync(path.join(root,"source-archive"),path.join(snapshot,"source-archive"),
      {recursive:true,preserveTimestamps:true});
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    const report=verifyOfflineSourceArchiveCoverage(snapshot);
    expect(report.status).toBe("offline_archive_bytes_intact_provenance_review_pending");
    expect(report.unresolvedDeclaredNoteReferenceCount).toBe(1);
    expect(report.noteReferenceCrosswalk.noteDeclaredFullHashesNotMatchingRegisteredVersion).toBe(1);
    expect(report.noteReferenceReviewSamples).toContainEqual({
      path:independentNote,kind:"declared_full_hash_not_matching_archived_version",
    });
  });
  it("requires PR74 physical Markdown+SQLite consistency before source archive acceptance",async()=>{
    await prepare();
    fs.writeFileSync(path.join(snapshot,"vault","10_Knowledge","Extra.md"),"# Extra");
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    expect(()=>verifyOfflineSourceArchiveCoverage(snapshot))
      .toThrow("offline_source_archive_requires_clean_markdown_snapshot_hold");
  });
  it("executes the actual offline source command on an isolated synthetic snapshot",async()=>{
    await prepare();
    const printed=execFileSync("pnpm",["snapshot:sources:offline",snapshot],{
      cwd:process.cwd(),encoding:"utf8",timeout:45_000,
    });
    const report=JSON.parse(printed) as {status:string;canAutoWrite:boolean};
    expect(report.status).toBe("offline_archived_bytes_intact_not_publisher_verified");
    expect(report.canAutoWrite).toBe(false);
  });
  it("holds the live data root and Railway even for legitimate indexed originals",async()=>{
    await prepare();
    const {verifyOfflineSourceArchiveCoverage}=await import("./offline-source-provenance");
    expect(()=>verifyOfflineSourceArchiveCoverage(root))
      .toThrow("snapshot_acceptance_live_data_directory_refused");
    process.env.RAILWAY_PROJECT_ID="fixture-prohibited";
    expect(()=>verifyOfflineSourceArchiveCoverage(snapshot))
      .toThrow("snapshot_acceptance_refused_inside_railway_runtime");
  });
});

import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";

let live:string,snapshot:string,vault:string;
const target="10_Knowledge/Company Research/SYNTH - Evidence Review.md";
const protectedNote="05_Thesis/SYNTH - Current Thesis.md";
const src="https://example.org/issuer/synthetic-release";
const original=Buffer.from("<html><body>Synthetic issuer-like bytes. NOT authenticated or factual.</body></html>");
const sha=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");
const raw=(opts:{type?:string;sourceType?:string;sourceHash?:string;
  claim?:boolean;dates?:boolean}={})=>[
  "---","type: "+(opts.type??"research_note"),
  "source_type: "+(opts.sourceType??"primary"),
  "verification: not_reverified",
  "original_source: "+src,
  "original_source_sha256: '"+(opts.sourceHash??sha(original))+"'",
  "event_key: SYNTH-2026Q2",
  ...(opts.dates?["event_date: '2026-07-25'",
    "published_at: '2026-07-26T10:00:00Z'",
    "imported_at: '2026-07-27T10:00:00Z'",
    "verified_at: '2026-07-28T10:00:00Z'"]:[]),
  ...(opts.claim?[
    "claims:","  - claim_id: synthetic-claim",
    "    entity: SYNTH","    period: 2026Q2","    metric: revenue",
    "    unit: USD millions","    value: '10'"]:[]),
  "---","# Example","Old synthetic fact value: 10.",""
].join("\n");
function put(file:string,contents:string){
  const p=path.join(vault,file);
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,contents);
}
async function prep(withBlob=true){
  if(withBlob){
    const {captureOriginalDocumentBytes}=await import("../research-source-archive");
    captureOriginalDocumentBytes({
      originalSource:src,bytes:original,contentType:"text/html",
      capturedAt:"2026-10-20T01:00:00Z",captureMethod:"authorized_external_download",
      retrievedFrom:src,reviewerOrOperator:"synthetic-offline-only",
    });
  }
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  if(withBlob)fs.cpSync(path.join(live,"source-archive"),
    path.join(snapshot,"source-archive"),{recursive:true,preserveTimestamps:true});
}
const currentHash=(note=target)=>
  sha(fs.readFileSync(path.join(snapshot,"vault",note)));
const request=(p=target)=>({
  snapshotRoot:snapshot,notePath:p,expectedNoteSha256:currentHash(p),
  action:"metadata_correction_candidate" as const,
  reviewRationale:"Draft synthetic metadata correction needs owner review",
  relationship:"new_event" as const,
  oldLine:"Old synthetic fact value: 10.",
  newLine:"Proposed synthetic fact value: 12.",
});
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-bound-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-bound-snapshot-")));
  vault=path.join(live,"vault");
  fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(live,{recursive:true,force:true});
  fs.rmSync(snapshot,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
});
describe("PR #78 offline source-bound read-only evidence bridge",()=>{
  it("derives note/index/source-byte evidence from actual segregated files, no approval",async()=>{
    put(target,raw({dates:true,claim:true}));await prep();
    const before=fs.readFileSync(path.join(snapshot,"vault",target));
    const blobPath=path.join(snapshot,"source-archive","blobs",
      sha(original).slice(0,2),sha(original)+".bin");
    const beforeBlob=fs.readFileSync(blobPath);
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const p=prepareOfflineBoundEvidenceProposal(request());
    expect(p).toMatchObject({
      status:"human_review_required",exactTargetPath:target,
      exactBeforeSha256:sha(before),claimMetadataPresent:true,
      offlineIndexFingerprintScope:"isolated_sqlite_note_rows_and_links_not_pr73_live_queue",
      storedSource:{originalBlobSha256:sha(original),revision:1,
        exactStoredBlobIntegrityVerified:true,issuerAuthenticityVerified:false},
      publisherAuthenticityVerified:false,investmentClaimFactsVerified:false,
      originalSourceIndependenceVerified:false,
      reviewerAuthenticationIndependentlyVerified:false,
      ownerApprovalGranted:false,canAutoWrite:false,canAutoUpdateThesis:false,
      safeEditPreview:null,proposedPatch:null,vaultModified:false,
    });
    expect(p.offlineIndexMetadataLinksFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(p.physicalMarkdownManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(p.unresolvedGates).toContain("reviewer_identity_unverified");
    expect(fs.readFileSync(path.join(snapshot,"vault",target))).toEqual(before);
    expect(fs.readFileSync(blobPath)).toEqual(beforeBlob);
  });
  it("keeps missing event/publication/import/verification times unknown and no preview",async()=>{
    put(target,raw());await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const p=prepareOfflineBoundEvidenceProposal(request());
    expect(p.status).toBe("human_review_required");
    expect(p.chronology).toEqual({
      eventDate:null,publishedAt:null,importedAt:null,verifiedAt:null,
    });
    expect(p.unresolvedGates).toContain("chronology_missing_fields_remain_unknown");
    expect(p.claimMetadataPresent).toBe(false);
    expect(p.safeEditPreview).toBeNull();
  });
  it("holds exact stale hash, tampered note and changed SQLite index",async()=>{
    put(target,raw({dates:true}));await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    expect(()=>prepareOfflineBoundEvidenceProposal({
      ...request(),expectedNoteSha256:"0".repeat(64),
    })).toThrow("offline_review_expected_note_hash_changed_hold");
    const notePath=path.join(snapshot,"vault",target);
    const noteBefore=fs.readFileSync(notePath,"utf8");
    fs.writeFileSync(notePath,noteBefore.replace("Old synthetic","Bad synthetic"));
    expect(()=>prepareOfflineBoundEvidenceProposal(request())).toThrow();
  });
  it("holds archive missing or tampered, even if frontmatter claims verification",async()=>{
    put(target,raw());await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const archiveFile=path.join(snapshot,"source-archive","blobs",
      sha(original).slice(0,2),sha(original)+".bin");
    fs.writeFileSync(archiveFile,Buffer.alloc(original.length,0x65));
    const packet=prepareOfflineBoundEvidenceProposal(request());
    expect(packet.status).toBe("hold");
    expect(packet.safeEditPreview).toBeNull();
    expect(packet.underlyingReviewStatus).toBe("source_archive_integrity_hold");
  });
  it("holds missing original registry and mismatched declared full hash",async()=>{
    put(target,raw());await prep(false);
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const noArchive=prepareOfflineBoundEvidenceProposal(request());
    expect(noArchive.status).toBe("hold");
    expect(noArchive.underlyingReviewStatus).toBe("source_or_independence_evidence_missing_hold");
  });
  it("rejects YAML numeric hash coercion as invalid original evidence",async()=>{
    put(target,raw().replace("'"+sha(original)+"'","1".repeat(64)));
    await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const r=prepareOfflineBoundEvidenceProposal(request());
    expect(r.status).toBe("hold");
    expect(r.safeEditPreview).toBeNull();
  });
  it("fails protected Thesis and archived AI notes closed",async()=>{
    put(protectedNote,raw({type:"current_thesis"}));await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const r=prepareOfflineBoundEvidenceProposal(request(protectedNote));
    expect(r.status).toBe("hold");
    expect(r.underlyingReviewStatus).toBe("protected_or_ineligible_note_hold");
  });
  it("holds hidden symlink source, no path traversal and live runtime",async()=>{
    put(target,raw());await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    expect(()=>prepareOfflineBoundEvidenceProposal({
      ...request(),notePath:"../secret.md",
    })).toThrow("offline_review_invalid_note_path");
    expect(()=>prepareOfflineBoundEvidenceProposal({...request(),
      snapshotRoot:live})).toThrow("snapshot_acceptance_live_data_directory_refused");
    process.env.RAILWAY_PROJECT_ID="blocked-fixture";
    expect(()=>prepareOfflineBoundEvidenceProposal(request()))
      .toThrow("snapshot_acceptance_refused_inside_railway_runtime");
  });
  it("never trusts a reviewer or owner flag from caller and does not accept invalid edit",async()=>{
    put(target,raw({dates:true}));await prep();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    const p=prepareOfflineBoundEvidenceProposal({
      ...request(),oldLine:"This line does not exist",
    });
    expect(p.status).toBe("hold");
    expect(p.unresolvedGates)
      .toContain("edit_anchor_missing_duplicate_or_in_protected_structure");
    expect(p.safeEditPreview).toBeNull();
    expect(p.ownerApprovalGranted).toBe(false);
  });
  it("rejects unsafe snapshot index rows before a proposal can be emitted",async()=>{
    put(target,raw({dates:true}));await prep();
    const db=new Database(path.join(snapshot,"app.sqlite"));
    db.prepare("UPDATE notes SET size=size+1 WHERE path=?").run(target);
    db.close();
    const {prepareOfflineBoundEvidenceProposal}=await import("./offline-bound-evidence-proposal");
    expect(()=>prepareOfflineBoundEvidenceProposal(request())).toThrow();
  });
});

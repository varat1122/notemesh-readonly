import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";

let live:string,snapshot:string,vault:string;
const note="10_Knowledge/Company Research/SYNTH - Review.md";
const archived="10_Knowledge/Company Research/SYNTH - Archived AI.md";
const protectedNote="05_Thesis/SYNTH - Current Thesis.md";
const url="https://www.sec.gov/Archives/edgar/data/1234/fictional-source.htm";
const original=Buffer.from("<html><body>Fabricated QA fixture. No real issuer or financial claim is verified.</body></html>");
const sha=(s:Buffer|string)=>createHash("sha256").update(s).digest("hex");
function put(rel:string,contents:string){
  const full=path.join(vault,rel);
  fs.mkdirSync(path.dirname(full),{recursive:true});
  fs.writeFileSync(full,contents);
}
function text({source=url,hash=sha(original),type="research_note",sourceType="primary",verification="not_reverified"}:
  {source?:string;hash?:string;type?:string;sourceType?:string;verification?:string}={}){
  return ["---","type: "+type,"source_type: "+sourceType,
    "verification: "+verification,"original_source: "+source,
    "original_source_sha256: '"+hash+"'","---",
    "# Synthetic analysis","No factual evidence is confirmed."].join("\n");
}
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-human-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-human-snapshot-")));
  vault=path.join(live,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=live;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
  Reflect.deleteProperty(globalThis,"__vaultIndexer");
  fs.rmSync(live,{recursive:true,force:true});
  fs.rmSync(snapshot,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
});
async function snapshotCopy({archive=true}: {archive?:boolean}={}){
  if(archive){
    const {captureOriginalDocumentBytes}=await import("../research-source-archive");
    captureOriginalDocumentBytes({
      originalSource:url,bytes:original,contentType:"text/html",
      capturedAt:"2026-10-20T01:00:00Z",
      captureMethod:"authorized_external_download",retrievedFrom:url,
      reviewerOrOperator:"unverified-fixture-operator",
    });
  }
  const {indexer}=await import("./indexer");await indexer().rebuild();
  fs.cpSync(vault,path.join(snapshot,"vault"),{recursive:true,preserveTimestamps:true});
  const {db}=await import("../db");
  await db().backup(path.join(snapshot,"app.sqlite"));
  if(archive)fs.cpSync(path.join(live,"source-archive"),
    path.join(snapshot,"source-archive"),{recursive:true,preserveTimestamps:true});
}
const request=(expected?:string,p=note)=>({
  snapshotRoot:snapshot,notePath:p,action:"metadata_correction_candidate" as const,
  expectedNoteSha256:expected,rationale:"Operator candidate only; not approval",
});
describe("offline human review: evidence gates; no writes, approval or automatic source promotion",()=>{
  it("requires explicit exact note hash before a bounded manual packet with matched stored bytes",async()=>{
    put(note,text());await snapshotCopy();
    const originalBytes=fs.readFileSync(path.join(snapshot,"vault",note));
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    const first=prepareOfflineEvidenceGatedHumanReview(request());
    expect(first).toMatchObject({
      status:"awaiting_note_hash_reconfirmation",
      expectedNoteHashMatched:false,
      noteSourceEvidence:{
        status:"registered_original_bytes_hash_matched_only",
        fullHashMatchesStoredVersion:true,publisherIdentityVerified:false,
        exactFinancialClaimVerified:false,sourceExcerptHashIsNotFullDocumentProof:true,
      },
      ownerApprovalGranted:false,reviewerAuthenticated:false,reviewCompleted:false,
      claimVerified:false,canAutoWrite:false,canAutoUpdateThesis:false,
      proposedPatch:null,safeEditTemplate:null,
    });
    expect(first.noteSha256).toBe(sha(originalBytes));
    const second=prepareOfflineEvidenceGatedHumanReview(request(first.noteSha256));
    expect(second.status).toBe("stored_bytes_located_for_manual_verification_only");
    expect(second.changeLogDraft.status).toBe("unsaved_unapproved_review_worksheet");
    expect(second.noteSourceEvidence.exactStoredBlobSha256).toBe(sha(original));
    expect(second.originalSourceIndependentlyAuthenticated).toBe(false);
    expect(fs.readFileSync(path.join(snapshot,"vault",note))).toEqual(originalBytes);
  });
  it("refuses stale expected hash even when note content remains otherwise internally consistent",async()=>{
    put(note,text());await snapshotCopy();
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    expect(()=>prepareOfflineEvidenceGatedHumanReview(request("0".repeat(64))))
      .toThrow("offline_review_expected_note_hash_changed_hold");
  });
  it("holds archived ChatGPT-derived analysis despite exact registered original hash",async()=>{
    put(archived,text({type:"knowledge_note",sourceType:"chatgpt_history"}));
    await snapshotCopy();
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    const noteHash=sha(fs.readFileSync(path.join(snapshot,"vault",archived)));
    const p=prepareOfflineEvidenceGatedHumanReview(request(noteHash,archived));
    expect(p.status).toBe("source_or_independence_evidence_missing_hold");
    expect(p.independenceAssessment).toBe("not_independent_archived_ai");
    expect(p.blockers.some(x=>x.includes("Archived AI"))).toBe(true);
    expect(p.noteSourceEvidence.fullHashMatchesStoredVersion).toBe(true);
  });
  it("holds protected Current Thesis even if claim source and hash are present",async()=>{
    put(protectedNote,text({type:"current_thesis"}));await snapshotCopy();
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    const hash=sha(fs.readFileSync(path.join(snapshot,"vault",protectedNote)));
    const packet=prepareOfflineEvidenceGatedHumanReview(request(hash,protectedNote));
    expect(packet.status).toBe("protected_or_ineligible_note_hold");
    expect(packet.roleAndPathEligible).toBe(false);
    expect(packet.safeEditTemplate).toBeNull();
  });
  it("holds missing original archive, no matter what caller declares",async()=>{
    put(note,text({verification:"verified_against_primary"}));
    await snapshotCopy({archive:false});
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    const packet=prepareOfflineEvidenceGatedHumanReview(
      request(sha(fs.readFileSync(path.join(snapshot,"vault",note)))));
    expect(packet.status).toBe("source_or_independence_evidence_missing_hold");
    expect(packet.noteSourceEvidence.status).toBe("not_registered_in_offline_archive");
    expect(packet.originalSourceIndependentlyAuthenticated).toBe(false);
    expect(packet.claimVerified).toBe(false);
  });
  it("holds declared full hash mismatching the registered source version",async()=>{
    put(note,text({hash:"a".repeat(64)}));await snapshotCopy();
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    const p=prepareOfflineEvidenceGatedHumanReview(
      request(sha(fs.readFileSync(path.join(snapshot,"vault",note)))));
    expect(p.status).toBe("source_or_independence_evidence_missing_hold");
    expect(p.offlineSourceAuditState).toBe("offline_archive_bytes_intact_provenance_review_pending");
    expect(p.noteSourceEvidence.status).toBe("declared_hash_not_in_registered_versions");
  });
  it("holds original archive tampering without altering stored bytes",async()=>{
    put(note,text());await snapshotCopy();
    const blob=path.join(snapshot,"source-archive","blobs",sha(original).slice(0,2),
      sha(original)+".bin");
    fs.writeFileSync(blob,Buffer.alloc(original.length,0x41));
    const before=fs.readFileSync(blob);
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    const p=prepareOfflineEvidenceGatedHumanReview(
      request(sha(fs.readFileSync(path.join(snapshot,"vault",note)))));
    expect(p.status).toBe("source_archive_integrity_hold");
    expect(p.noteSourceEvidence.fullHashMatchesStoredVersion).toBe(false);
    expect(fs.readFileSync(blob)).toEqual(before);
  });
  it("fails closed when physical Markdown no longer matches the SQLite snapshot",async()=>{
    put(note,text());await snapshotCopy();
    fs.appendFileSync(path.join(snapshot,"vault",note),"\nExtra");
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    expect(()=>prepareOfflineEvidenceGatedHumanReview(request()))
      .toThrow("offline_source_archive_requires_clean_markdown_snapshot_hold");
  });
  it("rejects traversal, invalid request fields and live or Railway snapshots",async()=>{
    put(note,text());await snapshotCopy();
    const {prepareOfflineEvidenceGatedHumanReview}=await import("./offline-evidence-human-review");
    expect(()=>prepareOfflineEvidenceGatedHumanReview(
      {...request(),notePath:"../secret.md"})).toThrow("offline_review_invalid_note_path");
    expect(()=>prepareOfflineEvidenceGatedHumanReview(
      {...request(),expectedNoteSha256:"123"})).toThrow("offline_review_invalid_expected_hash");
    expect(()=>prepareOfflineEvidenceGatedHumanReview(
      {...request(),snapshotRoot:live})).toThrow("snapshot_acceptance_live_data_directory_refused");
    process.env.RAILWAY_PROJECT_ID="synthetic-block";
    expect(()=>prepareOfflineEvidenceGatedHumanReview(request()))
      .toThrow("snapshot_acceptance_refused_inside_railway_runtime");
  });
  it("runs the CLI and never returns a diff or approval even after hash reconfirmation",async()=>{
    put(note,text());await snapshotCopy();
    const printed=execFileSync("pnpm",[
      "snapshot:review:offline",snapshot,note,
      "inspect_original_claim",sha(fs.readFileSync(path.join(snapshot,"vault",note))),
    ],{cwd:process.cwd(),encoding:"utf8",timeout:60_000});
    const p=JSON.parse(printed) as {status:string;canAutoWrite:boolean;
      proposedPatch:null;reviewerAuthenticated:boolean};
    expect(p.status).toBe("stored_bytes_located_for_manual_verification_only");
    expect(p.proposedPatch).toBeNull();
    expect(p.canAutoWrite).toBe(false);
    expect(p.reviewerAuthenticated).toBe(false);
  });
});

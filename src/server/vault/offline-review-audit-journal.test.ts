import {afterEach,beforeEach,describe,expect,it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {appendOfflineAuditObservation,inspectOfflineAuditJournal}
  from "./offline-review-audit-journal";
const digest=(x:string)=>createHash("sha256").update(x).digest("hex");
let live:string,snapshot:string,auditDir:string;
beforeEach(()=>{
  live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-journal-live-")));
  snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-journal-snapshot-")));
  auditDir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),
    "nm-offline-review-audit-")));
  fs.mkdirSync(path.join(live,"vault"));
  process.env.DATA_DIR=live;
});
afterEach(()=>{
  for(const p of [live,snapshot,auditDir])fs.rmSync(p,{recursive:true,force:true});
  delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
});
const zero="0".repeat(64);
const append=(expectedHeadSha256:string,ref="check-1",
  kind:"registry_check_consistent_only"|"enrollment_challenge_checked"=
  "registry_check_consistent_only")=>appendOfflineAuditObservation({
  auditDir,snapshotRoot:snapshot,expectedHeadSha256,kind,
  referenceSha256:digest(ref),reason:"synthetic untrusted audit observation",
});
describe("PR #81 isolated on-disk audit observations, never Vault authorization",()=>{
  it("persists sequenced fsynced records, verifies chain across repeated opens",()=>{
    const empty=inspectOfflineAuditJournal({
      auditDir,snapshotRoot:snapshot,expectedHeadSha256:zero,
    });
    expect(empty).toMatchObject({records:0,headSha256:zero,
      externallyAnchored:false,independentlyImmutable:false,
      ownerAuthenticated:false,canAutoWrite:false});
    const a=append(zero);
    const b=append(a.headSha256,"check-2");
    expect(b.records).toBe(2);
    expect(b.status).toBe("offline_scratch_record_fsynced_not_anchored");
    const verified=inspectOfflineAuditJournal({
      auditDir,snapshotRoot:snapshot,expectedHeadSha256:b.headSha256,
    });
    expect(verified.records).toBe(2);
    expect(fs.readdirSync(auditDir).sort()).toEqual(["000001.json","000002.json"]);
    expect(fs.readFileSync(path.join(auditDir,"000001.json"),"utf8"))
      .toContain("investment_os_offline_audit_v1");
    expect(b.ownerApprovalGranted).toBe(false);
    expect(b.productionVaultModified).toBe(false);
    expect(b.auditLogImmutable).toBe(false);
  });
  it("rejects modified bytes and missing middle record",()=>{
    const a=append(zero),b=append(a.headSha256,"second");
    const file=path.join(auditDir,"000001.json");
    const original=fs.readFileSync(file,"utf8");
    fs.writeFileSync(file,original.replace("synthetic","altered"));
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot,
      expectedHeadSha256:b.headSha256})).toThrow("offline_audit_record_integrity_hold");
    fs.writeFileSync(file,original);
    fs.rmSync(file);
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot}))
      .toThrow("offline_audit_missing_or_reordered_record");
  });
  it("refuses rollback against externally carried head and duplicate challenge",()=>{
    const a=append(zero);
    expect(()=>append(zero,"stale")).toThrow("offline_audit_expected_head_stale_hold");
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot,
      expectedHeadSha256:zero})).toThrow("offline_audit_external_head_mismatch_hold");
    const b=append(a.headSha256,"single-challenge",
      "enrollment_challenge_checked");
    expect(()=>append(b.headSha256,"single-challenge",
      "enrollment_challenge_checked")).toThrow(
        "offline_audit_duplicate_challenge_reference_hold");
    expect(inspectOfflineAuditJournal({
      auditDir,snapshotRoot:snapshot,expectedHeadSha256:b.headSha256,
    }).records).toBe(2);
  });
  it("rejects a stale lock, symlinks and unsafe or extra records",()=>{
    fs.writeFileSync(path.join(auditDir,".lock"),"stale");
    expect(()=>append(zero)).toThrow();
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot}))
      .toThrow("offline_audit_active_or_stale_lock_hold");
    fs.rmSync(path.join(auditDir,".lock"));
    fs.symlinkSync("/etc/passwd",path.join(auditDir,"000001.json"));
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot})).toThrow();
    fs.rmSync(path.join(auditDir,"000001.json"));
    fs.writeFileSync(path.join(auditDir,"other.json"),"{}");
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot}))
      .toThrow("offline_audit_unrecognized_file_or_limit");
  });
  it("rejects live/snapshot directories, world-readable directory and Railway",()=>{
    expect(()=>inspectOfflineAuditJournal({auditDir:live,
      snapshotRoot:snapshot})).toThrow("offline_audit_unrecognized_scratch_directory");
    const inside=path.join(live,"nm-offline-review-audit-inside");
    fs.mkdirSync(inside,{mode:0o700});
    expect(()=>inspectOfflineAuditJournal({auditDir:inside,
      snapshotRoot:snapshot})).toThrow("offline_audit_must_be_separate");
    fs.chmodSync(auditDir,0o755);
    expect(()=>append(zero)).toThrow("offline_audit_directory_not_private");
    fs.chmodSync(auditDir,0o700);
    process.env.RAILWAY_PROJECT_ID="synthetic";
    expect(()=>append(zero)).toThrow("offline_audit_railway_refused");
  });
  it("does not silently accept deleted final record when expected head is pinned",()=>{
    const a=append(zero),b=append(a.headSha256,"second");
    fs.rmSync(path.join(auditDir,"000002.json"));
    expect(()=>inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot,
      expectedHeadSha256:b.headSha256})).toThrow(
        "offline_audit_external_head_mismatch_hold");
    // Without an independent durable head pin this deletion CANNOT be proven.
    expect(inspectOfflineAuditJournal({auditDir,snapshotRoot:snapshot}).records)
      .toBe(1);
  });
});

/**
 * PR #81: deliberately detached, local-only *durable-attempted* audit journal.
 * Files are written ONLY under an explicitly pre-created private scratch
 * directory named nm-offline-review-audit-*. Never writes to Vault, Railway,
 * a registry, or a production service. Not immutable, externally anchored,
 * owner-authenticated, or a security-grade one-time nonce store.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {checkOfflineKeyRegistryReadiness,
  type OfflineRegistryRequest} from "./offline-review-key-registry-readiness";

const SHA=/^[a-f0-9]{64}$/;
const NAME=/^\d{6}\.json$/;
const ZERO="0".repeat(64);
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const safe=(s:unknown,max=120)=>typeof s==="string"&&s.length>0&&
  s.length<=max&&!/[\r\n\0]/.test(s);
export type OfflineAuditKind="registry_check_consistent_only"|
  "registry_check_held"|"enrollment_challenge_checked"|"enrollment_challenge_held";
export type OfflineAuditRecord={
  schema:"investment_os_offline_audit_v1";
  seq:number;previousSha256:string;createdAt:string;
  kind:OfflineAuditKind;referenceSha256:string;
  reason:string;recordSha256:string;
};
const dataDigest=(r:Omit<OfflineAuditRecord,"recordSha256">)=>
  sha(JSON.stringify(["investment-os-offline-audit-v1",r.schema,r.seq,
    r.previousSha256,r.createdAt,r.kind,r.referenceSha256,r.reason]));
function guardDir(dir:string,excludedSnapshot:string):string{
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("offline_audit_railway_refused");
  if(!process.env.DATA_DIR)throw Error("offline_audit_live_data_root_must_be_known");
  if(typeof dir!=="string"||!path.isAbsolute(dir)||dir.length>1000||
    dir.includes("\0")||!/^nm-offline-review-audit-[a-zA-Z0-9_-]+$/.test(
      path.basename(dir)))throw Error("offline_audit_unrecognized_scratch_directory");
  const root=fs.realpathSync(dir);
  if(root!==path.normalize(dir)||!fs.lstatSync(root).isDirectory())
    throw Error("offline_audit_symlink_or_non_directory");
  const live=fs.realpathSync(process.env.DATA_DIR);
  const snapshot=fs.realpathSync(excludedSnapshot);
  const working=fs.realpathSync(process.cwd());
  if([live,snapshot,working].some(ex=>
    root===ex||root.startsWith(ex+path.sep)||ex.startsWith(root+path.sep)))
    throw Error("offline_audit_must_be_separate_from_live_snapshot_repo");
  const stat=fs.statSync(root);
  if((stat.mode&0o077)!==0||
    (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
    throw Error("offline_audit_directory_not_private");
  return root;
}
function readOne(file:string):OfflineAuditRecord{
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const a=fs.fstatSync(fd);
    if(!a.isFile()||a.nlink!==1||a.size<30||a.size>4096||
      (a.mode&0o077)!==0)
      throw Error("offline_audit_record_unsafe");
    const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd);
    if(b.size!==a.size||b.ctimeMs!==a.ctimeMs||b.mtimeMs!==a.mtimeMs)
      throw Error("offline_audit_record_changed_during_read");
    const v=JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(bytes));
    if(!v||typeof v!=="object"||Array.isArray(v)||
      Object.keys(v).sort().join(",")!==[
        "createdAt","kind","previousSha256","reason","recordSha256",
        "referenceSha256","schema","seq"].sort().join(","))
      throw Error("offline_audit_record_fields_invalid");
    return v as OfflineAuditRecord;
  }finally{fs.closeSync(fd);}
}
function scan(root:string,insideLock=false){
  const entries=fs.readdirSync(root);
  const files=entries.filter(x=>x!==".lock");
  if(entries.some(x=>x===".lock")&&!insideLock)
    throw Error("offline_audit_active_or_stale_lock_hold");
  if(files.length>1000||files.some(x=>!NAME.test(x)))
    throw Error("offline_audit_unrecognized_file_or_limit");
  files.sort();
  let head=ZERO,seq=0;
  const seen=new Set<string>();
  for(const name of files){
    seq++;
    if(name!==String(seq).padStart(6,"0")+".json")
      throw Error("offline_audit_missing_or_reordered_record");
    const r=readOne(path.join(root,name));
    if(r.schema!=="investment_os_offline_audit_v1"||r.seq!==seq||
      r.previousSha256!==head||!SHA.test(r.referenceSha256)||
      !SHA.test(r.recordSha256)||!safe(r.reason,120)||
      !["registry_check_consistent_only","registry_check_held",
        "enrollment_challenge_checked","enrollment_challenge_held"].includes(r.kind)||
      !Number.isFinite(Date.parse(r.createdAt))||
      new Date(r.createdAt).toISOString()!==r.createdAt||
      r.recordSha256!==dataDigest({
        schema:r.schema,seq:r.seq,previousSha256:r.previousSha256,
        createdAt:r.createdAt,kind:r.kind,
        referenceSha256:r.referenceSha256,reason:r.reason,
      }))
      throw Error("offline_audit_record_integrity_hold");
    if(seen.has(r.referenceSha256)&&r.kind==="enrollment_challenge_checked")
      throw Error("offline_audit_duplicate_challenge_reference_hold");
    seen.add(r.referenceSha256);
    head=r.recordSha256;
  }
  return {headSha256:head,records:seq,challengeRefs:seen};
}
export function inspectOfflineAuditJournal(req:{
  auditDir:string;snapshotRoot:string;expectedHeadSha256?:string;
}){
  const root=guardDir(req.auditDir,req.snapshotRoot);
  const state=scan(root);
  if(req.expectedHeadSha256!==undefined&&
    (!SHA.test(req.expectedHeadSha256)||
      req.expectedHeadSha256!==state.headSha256))
    throw Error("offline_audit_external_head_mismatch_hold");
  return {headSha256:state.headSha256,records:state.records,
    externallyAnchored:false as const,
    independentlyImmutable:false as const,
    ownerAuthenticated:false as const,
    replayEnforcedAcrossOtherStores:false as const,
    canAutoWrite:false as const,ownerApprovalGranted:false as const};
}
export function appendOfflineAuditObservation(req:{
  auditDir:string;snapshotRoot:string;
  expectedHeadSha256:string;
  kind:OfflineAuditKind;referenceSha256:string;reason:string;
}){
  const root=guardDir(req.auditDir,req.snapshotRoot);
  if(!SHA.test(req.expectedHeadSha256)||!SHA.test(req.referenceSha256)||
    !safe(req.reason,120)||!["registry_check_consistent_only",
      "registry_check_held","enrollment_challenge_checked",
      "enrollment_challenge_held"].includes(req.kind))
    throw Error("offline_audit_bad_observation");
  const lock=path.join(root,".lock");
  const fd=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
    fs.writeSync(fd,Buffer.from("offline audit exclusive writer lock\n"));
    fs.fsyncSync(fd);
    const prior=scan(root,true);
    if(prior.headSha256!==req.expectedHeadSha256)
      throw Error("offline_audit_expected_head_stale_hold");
    if(prior.records>=1000)throw Error("offline_audit_record_limit_hold");
    if(req.kind==="enrollment_challenge_checked"&&
      prior.challengeRefs.has(req.referenceSha256))
      throw Error("offline_audit_duplicate_challenge_reference_hold");
    const base:Omit<OfflineAuditRecord,"recordSha256">={
      schema:"investment_os_offline_audit_v1",seq:prior.records+1,
      previousSha256:prior.headSha256,createdAt:new Date().toISOString(),
      kind:req.kind,referenceSha256:req.referenceSha256,reason:req.reason,
    };
    const record:OfflineAuditRecord={...base,recordSha256:dataDigest(base)};
    const filename=path.join(root,
      String(record.seq).padStart(6,"0")+".json");
    const out=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{
      const encoded=Buffer.from(JSON.stringify(record)+"\n","utf8");
      let offset=0;
      while(offset<encoded.length){
        const written=fs.writeSync(out,encoded,offset,encoded.length-offset);
        if(written<=0)throw Error("offline_audit_short_write_hold");
        offset+=written;
      }
      fs.fsyncSync(out);
    }finally{fs.closeSync(out);}
    const dirfd=fs.openSync(root,fs.constants.O_RDONLY);
    try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
    const actual=scan(root,true);
    if(actual.headSha256!==record.recordSha256||
      actual.records!==record.seq)
      throw Error("offline_audit_post_append_validation_hold");
    return {
      status:"offline_scratch_record_fsynced_not_anchored" as const,
      headSha256:actual.headSha256,records:actual.records,
      ownerApprovalGranted:false as const,canAutoWrite:false as const,
      auditLogImmutable:false as const,
      globallyReplayProtected:false as const,
      productionVaultModified:false as const,
    };
  }finally{
    fs.closeSync(fd);
    // A crash can leave a lock or torn final record: manual review required.
    fs.unlinkSync(lock);
  }
}
/** Re-checks PR #80 and then records ONLY its non-authoritative status. */
export function observeOfflineRegistryCheck(req:{
  readiness:OfflineRegistryRequest;
  auditDir:string;expectedHeadSha256:string;
}){
  const result=checkOfflineKeyRegistryReadiness(req.readiness);
  const consistent=result.status===
    "unprovisioned_registry_and_signatures_consistent_only";
  const reference=sha(JSON.stringify([
    "offline-registry-check-observation-v1",
    "registrySha256" in result?result.registrySha256:null,
    "signedReviewSubjectSha256" in result?result.signedReviewSubjectSha256:null,
    result.status,
  ]));
  const appended=appendOfflineAuditObservation({
    auditDir:req.auditDir,snapshotRoot:req.readiness.snapshotRoot,
    expectedHeadSha256:req.expectedHeadSha256,
    kind:consistent?"registry_check_consistent_only":"registry_check_held",
    referenceSha256:reference,reason:consistent?
      "unsigned_owner_enrollment_unproven":"registry_or_review_hold",
  });
  return {...appended,registryCheckStatus:result.status,
    reviewerAndOwnerRegisteredByAuthority:false as const,
    ownerApprovalGranted:false as const,canAutoWrite:false as const};
}

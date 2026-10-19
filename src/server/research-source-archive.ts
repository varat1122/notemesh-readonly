import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "./db";
import { env } from "./env";

/**
 * Internal, authenticated-ingest ADAPTER DEPENDENCY — not an MCP write action.
 *
 * Accepts bytes already collected through a separately authorized and
 * source-vetted ingestion channel. Never fetches a URL. Never writes Vault.
 * Recording bytes proves storage integrity, not the publisher's identity.
 */
const MAX_DOCUMENT_BYTES=8*1024*1024;
const MAX_ARCHIVE_BYTES=256*1024*1024;
export const sha256=(data:Buffer)=>createHash("sha256").update(data).digest("hex");
export type DocumentArchiveInput={
  originalSource:string;
  bytes:Buffer;
  contentType:"text/html"|"application/pdf"|"text/plain"|"application/xml"|"text/xml"|"application/json";
  capturedAt:string;
  captureMethod:"authorized_external_download"|"authorized_manual_upload";
  retrievedFrom:string;
  reviewerOrOperator:string;
  responseEtag?:string|null;
  responseLastModified?:string|null;
};
export type DocumentSnapshot={
  snapshotId:string;originalSource:string;sha256:string;
  byteLength:number;revision:number;capturedAt:string;
  contentType:string;captureMethod:string;retrievedFrom:string;
  reviewerOrOperator:string;responseEtag:string|null;
  responseLastModified:string|null;
  archiveStatus:"stored_original_bytes_unattributed"|"intact_stored_bytes"|"tampered_or_missing_bytes";
  publisherAuthenticityVerified:false;
  originalDocumentSignatureVerified:false;
};
type Row={snapshot_id:string;original_source:string;source_key:string;sha256:string;
  byte_length:number;revision:number;captured_at:string;content_type:string;
  capture_method:string;retrieved_from:string;operator_label:string;
  response_etag:string|null;response_last_modified:string|null};
function validTimestamp(s:string):boolean {
  const d=new Date(s);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)&&
    !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,19)===s.slice(0,19);
}
function normalizedSource(source:string):string{
  let u:URL;
  try{u=new URL(source);}catch{throw new Error("source_url_invalid");}
  if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.port)
    throw new Error("source_url_must_be_standard_https");
  u.hash="";
  for(const k of [...u.searchParams.keys()])
    if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
  u.searchParams.sort();
  return u.toString(); // URL path/query values remain case-sensitive
}
function sourceDir():string {
  const root=path.resolve(env.dataDir);
  const dir=path.join(root,"source-archive");
  const vault=path.join(root,"vault");
  const rel=path.relative(vault,dir);
  if(rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel)))
    throw new Error("source_archive_must_be_outside_vault");
  return dir;
}
const blobPath=(hash:string)=>path.join(sourceDir(),"blobs",hash.slice(0,2),hash+".bin");
function getRow(row:Row,validateBytes:boolean):DocumentSnapshot{
  // A corrupted database row must never become a filesystem traversal,
  // even when this audit runs against an untrusted restored index.
  if(!/^[a-f0-9]{64}$/.test(row.sha256))throw Error("source_archive_hash_invalid");
  let archiveStatus:DocumentSnapshot["archiveStatus"]="stored_original_bytes_unattributed";
  if(validateBytes){
    try{
      const filepath=blobPath(row.sha256);
      const stat=fs.lstatSync(filepath);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==row.byte_length)
        throw new Error("invalid_blob_type_or_size");
      const fd=fs.openSync(filepath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
      let bytes:Buffer;
      try{
        const realStat=fs.fstatSync(fd);
        if(!realStat.isFile()||realStat.nlink!==1||realStat.size!==row.byte_length)throw new Error("invalid_open_inode");
        bytes=fs.readFileSync(fd);
      }finally{fs.closeSync(fd);}
      archiveStatus=sha256(bytes)===row.sha256?"intact_stored_bytes":"tampered_or_missing_bytes";
    }catch{archiveStatus="tampered_or_missing_bytes";}
  }
  return {snapshotId:row.snapshot_id,originalSource:row.original_source,sha256:row.sha256,
    byteLength:row.byte_length,revision:row.revision,capturedAt:row.captured_at,
    contentType:row.content_type,captureMethod:row.capture_method,retrievedFrom:row.retrieved_from,
    reviewerOrOperator:row.operator_label,responseEtag:row.response_etag,responseLastModified:row.response_last_modified,
    archiveStatus,publisherAuthenticityVerified:false,originalDocumentSignatureVerified:false};
}
function safeBlobWrite(bytes:Buffer,digest:string){
  const target=blobPath(digest);
  const parent=path.dirname(target);
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const tmp=target+"."+process.pid+"."+createHash("sha256").update(String(Date.now())+Math.random()).digest("hex").slice(0,16)+".tmp";
  let tmpPresent=false;
  try{
    const fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0),0o600);
    tmpPresent=true;
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{
      // Hard link makes the destination no-clobber and atomic. Never overwrite
      // an existing digest file, even if a bad or malicious file occupies it.
      fs.linkSync(tmp,target);
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
      const existing=fs.lstatSync(target);
      if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1||existing.size!==bytes.length)
        throw new Error("source_blob_existing_path_unsafe");
      const stored=fs.readFileSync(target);
      if(sha256(stored)!==digest)throw new Error("source_blob_existing_hash_mismatch");
    }
  }finally{if(tmpPresent)try{fs.unlinkSync(tmp);}catch{/* Temp may already have been removed. */}}
}
export function captureOriginalDocumentBytes(input:DocumentArchiveInput):DocumentSnapshot{
  if(!Buffer.isBuffer(input.bytes)||input.bytes.length<16||input.bytes.length>MAX_DOCUMENT_BYTES)
    throw new Error("source_document_invalid_size");
  if(!validTimestamp(input.capturedAt))throw new Error("capture_timestamp_invalid");
  if(!input.reviewerOrOperator.trim()||input.reviewerOrOperator.length>160)throw new Error("operator_label_required");
  if(!normalizedSource(input.retrievedFrom))throw new Error("retrieved_url_required");
  const key=normalizedSource(input.originalSource);
  if(input.captureMethod==="authorized_external_download"&&normalizedSource(input.retrievedFrom)!==key)
    throw new Error("download_url_must_match_original_source");
  if(input.contentType==="application/pdf"&&!input.bytes.subarray(0,5).equals(Buffer.from("%PDF-")))
    throw new Error("file_is_not_pdf");
  const digest=sha256(input.bytes);
  const archive=db();
  const existing=archive.prepare("SELECT * FROM source_snapshots WHERE source_key = ? AND sha256 = ?")
    .get(key,digest) as Row|undefined;
  if(existing) return getRow(existing,true);
  const total=(archive.prepare("SELECT COALESCE(SUM(byte_length),0) as total FROM source_snapshots").get() as {total:number}).total;
  if(total+input.bytes.length>MAX_ARCHIVE_BYTES)throw new Error("source_archive_capacity_limit");
  safeBlobWrite(input.bytes,digest);
  const previous=(archive.prepare("SELECT COALESCE(MAX(revision),0) as revision FROM source_snapshots WHERE source_key = ?")
    .get(key) as {revision:number}).revision;
  const id=sha256(Buffer.from(key+"\n"+digest));
  const revision=previous+1;
  archive.prepare(`INSERT INTO source_snapshots
    (snapshot_id,original_source,source_key,sha256,byte_length,revision,captured_at,content_type,
     capture_method,retrieved_from,operator_label,response_etag,response_last_modified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,input.originalSource,key,digest,input.bytes.length,
       revision,input.capturedAt,input.contentType,input.captureMethod,input.retrievedFrom,
       input.reviewerOrOperator,input.responseEtag??null,input.responseLastModified??null);
  const row=archive.prepare("SELECT * FROM source_snapshots WHERE snapshot_id = ?").get(id) as Row;
  return getRow(row,true);
}
export function inspectOriginalSourceHistory(originalSource:string,validateBytes=true):{
  status:"source_byte_archive_inspection_only";
  originalSource:string;revisionCount:number;snapshots:DocumentSnapshot[];
  changesObserved:boolean;limitReached:boolean;
  publisherAuthenticityVerified:false;
}{
  const key=normalizedSource(originalSource);
  const all=db().prepare("SELECT * FROM source_snapshots WHERE source_key = ? ORDER BY revision LIMIT 101")
    .all(key) as Row[];
  const truncated=all.length>100;
  const snapshots=all.slice(0,100).map(x=>getRow(x,validateBytes));
  return {status:"source_byte_archive_inspection_only",originalSource,revisionCount:snapshots.length,
    snapshots,changesObserved:snapshots.length>1,limitReached:truncated,publisherAuthenticityVerified:false};
}


/**
 * Low-cost operational health summary for the existing get_vault_info read
 * tool. It never exports source bytes, URLs or operator identifiers.
 * Scan is bounded so a populated archive cannot stall ordinary research.
 * This is NOT an off-server backup or an issuer signature verification.
 */
export function sourceArchiveHealth():{
  status:"empty_no_originals"|"checked_intact"|"partial_scan"|"integrity_warning";
  snapshotCount:number;distinctSources:number;declaredBytes:number;
  hashCheckedSnapshots:number;hashCheckedBytes:number;
  intactSnapshots:number;damagedOrMissingSnapshots:number;
  uncheckedSnapshots:number;fullByteScanComplete:boolean;
  originalByteArchiveInsideObsidianVault:false;
  offServerBackupVerified:false;remoteObsidianSyncVerified:false;
}{
  const d=db();
  const stats=d.prepare(
    "SELECT COUNT(*) AS count,COUNT(DISTINCT source_key) AS sources,"+
    "COALESCE(SUM(byte_length),0) AS bytes FROM source_snapshots"
  ).get() as {count:number;sources:number;bytes:number};
  const limit=16,maxBytes=64*1024*1024;
  const recent=d.prepare("SELECT * FROM source_snapshots ORDER BY captured_at DESC,snapshot_id DESC LIMIT ?")
    .all(limit) as Row[];
  let checked=0,bytes=0,intact=0,damaged=0;
  for(const row of recent){
    if(row.byte_length>maxBytes-bytes)break;
    checked++;bytes+=row.byte_length;
    try{
      const status=getRow(row,true).archiveStatus;
      if(status==="intact_stored_bytes")intact++;
      else damaged++;
    }catch{damaged++;}
  }
  const remaining=Math.max(0,stats.count-checked);
  return {
    status:stats.count===0?"empty_no_originals":damaged>0?"integrity_warning":
      remaining>0?"partial_scan":"checked_intact",
    snapshotCount:stats.count,distinctSources:stats.sources,declaredBytes:stats.bytes,
    hashCheckedSnapshots:checked,hashCheckedBytes:bytes,
    intactSnapshots:intact,damagedOrMissingSnapshots:damaged,
    uncheckedSnapshots:remaining,fullByteScanComplete:stats.count>0&&remaining===0,
    originalByteArchiveInsideObsidianVault:false,
    offServerBackupVerified:false,remoteObsidianSyncVerified:false
  };
}

/**
 * Content-addressed, additive user-supplied screenshot/PDF preservation.
 * Original bytes are stored as untrusted ATTACHMENTS in the Obsidian Vault,
 * not in primary issuer source archives. This never authenticates a broker,
 * proves source claims, performs OCR, or changes protected investment views.
 *
 * Call store via the dedicated Safe Edit OAuth server AND withPausedSync.
 * All filenames are derived from the byte hash, never an input filename.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { assertHeadroom } from "./vault/disk";
import { resolveNotePath, assertDescriptorInVault, openNoFollow } from "./vault/paths";
import { recordLocalModification } from "./vault/modified";
import { reindexPath } from "./vault/indexer";
import { assertEnabled } from "./safe-edit/engine";

export type AttachmentType="image/jpeg"|"image/png"|"image/webp"|"application/pdf";
const ext:Record<AttachmentType,string>={
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"
};
const allowed=new Set<AttachmentType>(Object.keys(ext) as AttachmentType[]);
export const MAX_USER_ATTACHMENT_BYTES=4*1024*1024;
const base="07_Sources/ChatGPT/Attachments";
const sha=(bytes:Buffer)=>crypto.createHash("sha256").update(bytes).digest("hex");
const validDigest=(s:string)=>/^[a-f0-9]{64}$/.test(s);

function verifyFileType(b:Buffer,mime:AttachmentType){
  if(mime==="image/jpeg"&&b.length>=4&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return;
  if(mime==="image/png"&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return;
  if(mime==="image/webp"&&b.subarray(0,4).toString("ascii")==="RIFF"&&b.subarray(8,12).toString("ascii")==="WEBP")return;
  if(mime==="application/pdf"&&b.subarray(0,5).toString("ascii")==="%PDF-")return;
  throw Error("attachment_content_type_magic_mismatch");
}
function decode(base64:string){
  if(base64.length>Math.ceil(MAX_USER_ATTACHMENT_BYTES/3)*4+4||
    base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error("attachment_base64_invalid_or_too_large");
  const b=Buffer.from(base64,"base64");
  if(b.length<16||b.length>MAX_USER_ATTACHMENT_BYTES||b.toString("base64")!==base64)
    throw Error("attachment_base64_invalid_or_too_large");
  return b;
}
function checkedPath(digest:string,mime:AttachmentType){
  if(!validDigest(digest)||!allowed.has(mime))throw Error("invalid_attachment_identity");
  const rel=base+"/"+digest+"."+ext[mime];
  const abs=resolveNotePath(rel,{allowMissingExt:true});
  return {rel,abs,dir:path.dirname(abs)};
}
function ensureDirectory(){
  // Folder names are constant and no user-controlled path component exists.
  // Reject symlinked parents at every level. Never write under a redirected path.
  for(const rel of ["07_Sources","07_Sources/ChatGPT",base]){
    const dir=resolveNotePath(rel,{allowMissingExt:true});
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
    const st=fs.lstatSync(dir);
    if(!st.isDirectory()||st.isSymbolicLink())throw Error("unsafe_attachment_directory");
    const real=fs.realpathSync(dir),vault=fs.realpathSync(env.vaultDir);
    if(!real.startsWith(vault+path.sep))throw Error("unsafe_attachment_parent");
  }
}
function readAndVerify(abs:string,digest:string):{byteLength:number;verified:boolean}{
  let fd:number;
  try{fd=openNoFollow(abs);}catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return {byteLength:0,verified:false};
    throw e;
  }
  try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.size<16||st.size>MAX_USER_ATTACHMENT_BYTES)
      throw Error("attachment_existing_file_unsafe");
    const bytes=fs.readFileSync(fd);
    return {byteLength:bytes.length,verified:sha(bytes)===digest};
  }finally{fs.closeSync(fd);}
}
export function inspectUserAttachment({sha256,contentType}:{sha256:string;contentType:AttachmentType}){
  const {rel,abs}=checkedPath(sha256,contentType);
  const file=readAndVerify(abs,sha256);
  return {status:file.verified?"stored_and_readback_verified":"missing_or_hash_mismatch",
    path:rel,sha256,contentType,byteLength:file.byteLength,
    byteReadbackVerified:file.verified,publisherVerified:false,ocrVerified:false,
    claimVerified:false,remoteSyncVerified:false,mobileSyncVerified:false};
}
export function storeUserAttachment({base64,contentType}:{
  base64:string;contentType:AttachmentType;
}){
  assertEnabled();
  if(!allowed.has(contentType))throw Error("unsupported_attachment_content_type");
  const bytes=decode(base64);
  verifyFileType(bytes,contentType);
  const digest=sha(bytes);
  ensureDirectory();
  const {rel,abs,dir}=checkedPath(digest,contentType);
  const check=readAndVerify(abs,digest);
  if(check.byteLength){
    if(!check.verified)throw Error("attachment_existing_path_hash_conflict");
    return {...inspectUserAttachment({sha256:digest,contentType}),duplicate:true};
  }
  assertHeadroom(bytes.length*2+64_000);
  const tmp=path.join(dir,digest+"."+crypto.randomBytes(12).toString("hex")+".tmp");
  let created=false;
  try{
    const fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    created=true;
    try{
      assertDescriptorInVault(fd);
      fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
    }finally{fs.closeSync(fd);}
    try{fs.linkSync(tmp,abs);}catch(e){
      if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
      const already=readAndVerify(abs,digest);
      if(!already.verified)throw Error("attachment_existing_path_hash_conflict");
    }
    // A temporary hardlink gives the target inode nlink=2 until unlinked.
    // Release the temporary name before enforcing the final nlink=1 invariant.
    fs.unlinkSync(tmp);created=false;
    // Immutable add-only blob is in the Vault; recompute from stored bytes.
    const verified=readAndVerify(abs,digest);
    if(!verified.verified||verified.byteLength!==bytes.length)
      throw Error("attachment_readback_failed");
    const dirFd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
    recordLocalModification(rel);reindexPath(rel);
    return {...inspectUserAttachment({sha256:digest,contentType}),duplicate:false};
  }finally{if(created)try{fs.unlinkSync(tmp);}catch{ /* best-effort temporary-file cleanup; preserve primary error */ }}
}

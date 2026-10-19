/**
 * Download one existing, immutable encrypted NoteMesh DR bundle from Google
 * Drive into an OFFLINE recovery directory. Never touches deployed DATA_DIR.
 *
 * Requires an already verified upload receipt and a dedicated drive.file
 * credential. This is NOT production snapshot creation or a restore.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { refreshAccessToken } from "./nm-drive-upload.mjs";

const API = "https://www.googleapis.com";
const ID = /^[A-Za-z0-9_-]{10,150}$/;
const NAME = /^notemesh-(daily|weekly|monthly|predeploy|fixture)-[A-Za-z0-9_-]+\.nmb$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_BYTES = 2_000_000_000;
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function refuseLiveRuntime() {
  if (["RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID","RAILWAY_ENVIRONMENT_ID",
       "RAILWAY_ENVIRONMENT_NAME","RAILWAY_PROJECT_NAME","RAILWAY_SERVICE_NAME"]
      .some(k => process.env[k]))
    throw Error("offline_drive_recovery_refuses_railway");
}

export function validateUploadReceipt(receipt) {
  if (!receipt || receipt.verified !== true || receipt.uploadedToDrive !== true ||
      !ID.test(receipt.fileId || "") || !ID.test(receipt.folderId || "") ||
      !NAME.test(receipt.name || "") || !SHA.test(receipt.sha256 || "") ||
      !Number.isSafeInteger(receipt.size) || receipt.size < 50 || receipt.size > MAX_BYTES ||
      receipt.readbackBytes !== receipt.size)
    throw Error("Invalid or unverified immutable DR upload receipt");
  return receipt;
}

async function safeRecoveryDirectory(folder) {
  refuseLiveRuntime();
  if (typeof folder !== "string" || !path.isAbsolute(folder))
    throw Error("Offline recovery output must be an absolute existing directory");
  const lexical = path.resolve(folder);
  const canonical = await fsp.realpath(lexical);
  const st = await fsp.lstat(lexical);
  if (!st.isDirectory() || st.isSymbolicLink() || canonical !== lexical)
    throw Error("Unsafe or symlinked recovery output directory");
  const forbidden = ["/data","/app/data",process.env.DATA_DIR].filter(Boolean);
  for (const candidate of forbidden) {
    let resolved = path.resolve(candidate);
    try { resolved = await fsp.realpath(resolved); } catch { /* absent root */ }
    if (inside(resolved,canonical) || inside(canonical,resolved))
      throw Error("Recovery output overlaps deployed or configured data directory");
  }
  return canonical;
}

function googleFileUrl(id, media = false) {
  return API + "/drive/v3/files/" + encodeURIComponent(id) +
    (media ? "?alt=media" : "?fields=id,name,size,parents,appProperties");
}

export async function recoverVerifiedBundle({receipt,outDir,accessToken,fetcher=fetch}) {
  const r = validateUploadReceipt(receipt);
  const folder = await safeRecoveryDirectory(outDir);
  if (typeof accessToken !== "string" || !accessToken)
    throw Error("Dedicated short-lived access token required");

  const headers = {Authorization:"Bearer " + accessToken};
  const metadataRes = await fetcher(googleFileUrl(r.fileId),{
    headers,redirect:"error",signal:AbortSignal.timeout(30000)
  });
  if (!metadataRes.ok) throw Error("Drive recovery metadata HTTP " + metadataRes.status);
  const metadata = await metadataRes.json();
  if (metadata.id !== r.fileId || metadata.name !== r.name ||
      Number(metadata.size) !== r.size || !Array.isArray(metadata.parents) ||
      !metadata.parents.includes(r.folderId) ||
      metadata.appProperties?.kind !== "notemesh-dr-v1" ||
      metadata.appProperties?.sha256 !== r.sha256)
    throw Error("Drive recovery metadata mismatches verified upload receipt");

  const mediaRes = await fetcher(googleFileUrl(r.fileId,true),{
    headers,redirect:"error",signal:AbortSignal.timeout(300000)
  });
  if (!mediaRes.ok || !mediaRes.body)
    throw Error("Drive recovery download HTTP " + mediaRes.status);

  // Open with O_EXCL: never overwrite a prior backup, symlink or user file.
  // No response body, token, or encrypted application data is logged.
  const destination = path.join(folder,r.name);
  let file,owned=false,bytes=0;
  const hash=createHash("sha256");
  try {
    file=await fsp.open(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    owned=true;
    for await (const piece of mediaRes.body) {
      bytes+=piece.byteLength;
      if (bytes>r.size) throw Error("Drive recovery exceeds expected byte count");
      hash.update(piece);
      const block=Buffer.from(piece);
      let off=0;
      while(off<block.length) {
        const {bytesWritten}=await file.write(block,off,block.length-off);
        if(bytesWritten<=0)throw Error("Drive recovery write failed");
        off+=bytesWritten;
      }
    }
    await file.sync();
    if(bytes!==r.size || hash.digest("hex")!==r.sha256)
      throw Error("Drive recovery downloaded SHA-256 mismatch");
    return {downloaded:true,sha256:r.sha256,size:bytes,fileId:r.fileId,
      name:r.name,localPath:destination,cryptographicBundleVerified:false,
      restored:false,productionRecoveryVerified:false};
  } catch(e) {
    if(file) await file.close().catch(()=>{});
    file=undefined;
    if(owned) await fsp.rm(destination,{force:true}).catch(()=>{});
    throw e;
  } finally {
    if(file) await file.close();
  }
}

async function main(argv=process.argv.slice(2)) {
  refuseLiveRuntime();
  const flags=new Map();
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(!key.startsWith("--") || flags.has(key))throw Error("Bad/repeated recovery option");
    if(key==="--authorize-recovery")flags.set(key,true);
    else {const v=argv[++i];if(!v || v.startsWith("--"))throw Error("Missing "+key);flags.set(key,v);}
  }
  if(!flags.has("--authorize-recovery") || !flags.has("--receipt") ||
     !flags.has("--out-dir") || [...flags.keys()].some(k=>
      !["--authorize-recovery","--receipt","--out-dir"].includes(k)))
    throw Error("Explicit --authorize-recovery, --receipt and --out-dir required");
  const receiptPath=path.resolve(flags.get("--receipt"));
  const st=await fsp.lstat(receiptPath);
  if(!st.isFile() || st.isSymbolicLink() || st.size>4096)
    throw Error("Unsafe receipt file");
  const receipt=validateUploadReceipt(JSON.parse(await fsp.readFile(receiptPath,"utf8")));
  const token=await refreshAccessToken();
  const downloaded=await recoverVerifiedBundle({
    receipt,outDir:flags.get("--out-dir"),accessToken:token
  });
  // Unlike a matching transport hash, this authenticates the encrypted
  // NMDR1 format and internal manifest/SQLite integrity with the offline key.
  // A failed verification removes only the brand-new recovered output.
  try {
    const check=JSON.parse(execFileSync(process.execPath,[
      fileURLToPath(new URL("./nm-backup.mjs",import.meta.url)),
      "verify","--bundle",downloaded.localPath],{
      encoding:"utf8",maxBuffer:1024*1024,env:process.env,timeout:300000
    }));
    if(check.verified!==true) throw Error("Cryptographic bundle verify refused");
    console.log(JSON.stringify({...downloaded,cryptographicBundleVerified:true,
      manifestFiles:check.files,restored:false,productionRecoveryVerified:false}));
  } catch {
    await fsp.rm(downloaded.localPath,{force:true});
    throw Error("Recovered Drive bundle failed offline cryptographic verification");
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error("Offline DR recovery refused: "+e.message);process.exitCode=1;});

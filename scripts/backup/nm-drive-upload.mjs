/**
 * Explicitly gated, immutable encrypted NoteMesh DR bundle upload to Drive.
 * Distinct from Google Drive market-price archives and their credentials.
 * NOT wired to Railway or scheduled. No delete, patch, share or overwrite APIs.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHUNK=8*1024*1024;
const FOLDER=/^[a-zA-Z0-9_-]{10,150}$/;
const API="https://www.googleapis.com";
const TOKEN_URL="https://oauth2.googleapis.com/token";

async function digest(file) {
  const sha=createHash("sha256");
  let size=0;
  for await(const part of fs.createReadStream(file)) {size+=part.length;sha.update(part);}
  return {sha256:sha.digest("hex"),size};
}
async function getJson(res,label) {
  if(!res.ok) throw Error(label+" HTTP "+res.status);
  return res.json();
}
function assertGoogleUrl(str) {
  const u=new URL(str);
  if(u.origin!==API || !u.pathname.startsWith("/upload/drive/v3/files"))throw Error("Refusing non-Google resumable upload endpoint");
  return u.toString();
}
export async function refreshAccessToken(fetcher=fetch) {
  const id=process.env.NOTEMESH_DRIVE_CLIENT_ID;
  const secret=process.env.NOTEMESH_DRIVE_CLIENT_SECRET;
  const refresh=process.env.NOTEMESH_DRIVE_REFRESH_TOKEN;
  if(!id || !secret || !refresh)throw Error("Dedicated Drive OAuth credentials are not configured");
  const data=new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"});
  const r=await fetcher(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:data,redirect:"error",signal:AbortSignal.timeout(30_000)});
  const json=await getJson(r,"Token refresh");
  if(typeof json.access_token!=="string" || !json.access_token)throw Error("Missing access token");
  return json.access_token;
}
function headers(token,extra={}) {return {...extra,Authorization:"Bearer "+token};}
export async function uploadVerifiedBundle({bundle,folderId,accessToken,fetcher=fetch}) {
  if(!FOLDER.test(folderId))throw Error("Invalid Drive folder ID");
  if(!accessToken)throw Error("Missing short-lived access token");
  const name=path.basename(bundle);
  if(!/^notemesh-(daily|weekly|monthly|predeploy|fixture)-[\w-]+\.nmb$/.test(name))throw Error("Only immutable encrypted NoteMesh bundles are accepted");
  const fd=await fsp.open(bundle,"r");
  const magic=Buffer.alloc(5);await fd.read(magic,0,5,0);
  if(magic.toString()!=="NMDR1"){await fd.close();throw Error("Not an encrypted NoteMesh backup");}
  await fd.close();
  const local=await digest(bundle);
  if(!Number.isSafeInteger(local.size) || local.size<50 || local.size>2_000_000_000)throw Error("Bundle exceeds upload safety bounds");
  const meta={name,parents:[folderId],mimeType:"application/octet-stream",
    appProperties:{kind:"notemesh-dr-v1",sha256:local.sha256}};
  const start=await fetcher(API+"/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,parents,md5Checksum",{
    method:"POST",headers:headers(accessToken,{"Content-Type":"application/json; charset=UTF-8",
      "X-Upload-Content-Type":"application/octet-stream","X-Upload-Content-Length":String(local.size)}),
    body:JSON.stringify(meta),redirect:"error",signal:AbortSignal.timeout(30_000)});
  if(!start.ok)throw Error("Drive resumable session failed: HTTP "+start.status+"; check drive.file folder authorization");
  const endpoint=assertGoogleUrl(start.headers.get("location")||"");
  const file=await fsp.open(bundle,"r");
  let uploaded=null;
  try {
    for(let offset=0;offset<local.size;) {
      const len=Math.min(CHUNK,local.size-offset),block=Buffer.allocUnsafe(len);
      const {bytesRead}=await file.read(block,0,len,offset);
      if(bytesRead!==len)throw Error("Local bundle changed while uploading");
      const response=await fetcher(endpoint,{
        method:"PUT",headers:headers(accessToken,{"Content-Type":"application/octet-stream",
          "Content-Range":"bytes "+offset+"-"+(offset+len-1)+"/"+local.size}),
        body:block,redirect:"error",signal:AbortSignal.timeout(120_000)});
      if(response.status===308) {
        const expected="bytes=0-"+(offset+len-1);
        if(response.headers.get("range")!==expected)throw Error("Drive partial-range acknowledgement differs");
        offset+=len;
      } else if(response.ok && offset+len===local.size) {
        uploaded=await response.json();
        offset+=len;
      } else throw Error("Incomplete/failed Drive chunk: HTTP "+response.status+"; retain orphan for investigation");
    }
  } finally {await file.close();}
  if(!uploaded?.id || typeof uploaded.id!=="string")throw Error("Drive did not provide final uploaded file ID");
  const id=encodeURIComponent(uploaded.id);
  const info=await getJson(await fetcher(API+"/drive/v3/files/"+id+"?fields=id,name,size,parents,md5Checksum,appProperties",{
    headers:headers(accessToken),redirect:"error",signal:AbortSignal.timeout(30_000)}),"Drive readback metadata");
  if(info.id!==uploaded.id || info.name!==name || Number(info.size)!==local.size ||
     !Array.isArray(info.parents) || !info.parents.includes(folderId) ||
     info.appProperties?.sha256!==local.sha256)
       throw Error("Uploaded Drive metadata mismatch; no verified receipt");
  // Hash the ciphertext *downloaded from Drive*. An upload receipt alone is insufficient.
  const r=await fetcher(API+"/drive/v3/files/"+id+"?alt=media",{
    headers:headers(accessToken),redirect:"error",signal:AbortSignal.timeout(300_000)});
  if(!r.ok || !r.body)throw Error("Drive download for readback failed: HTTP "+r.status);
  const hash=createHash("sha256");let total=0;
  for await(const piece of r.body) {
    total+=piece.length;if(total>local.size)throw Error("Drive readback larger than source");
    hash.update(piece);
  }
  if(total!==local.size || hash.digest("hex")!==local.sha256)throw Error("Drive readback SHA-256 mismatch");
  return {verified:true,uploadedToDrive:true,fileId:uploaded.id,folderId,name,
    size:local.size,sha256:local.sha256,readbackBytes:total,verifiedAt:new Date().toISOString()};
}
async function run() {
  const input=process.argv.slice(2),args=new Map();
  for(let i=0;i<input.length;i++) {
    if(!input[i].startsWith("--") || args.has(input[i]))throw Error("Bad/repeated argument");
    const k=input[i];
    if(k==="--authorize-upload") args.set(k,true);
    else {const val=input[++i];if(!val || val.startsWith("--"))throw Error("Missing "+k);args.set(k,val);}
  }
  if(!args.has("--authorize-upload"))throw Error("Refusing Drive write without --authorize-upload");
  for(const k of args.keys())if(!["--authorize-upload","--bundle","--folder-id","--receipt-dir"].includes(k))throw Error("Unknown option "+k);
  if(!args.has("--bundle") || !args.has("--folder-id") || !args.has("--receipt-dir"))throw Error("Missing bundle, folder or receipt directory");
  const bundle=path.resolve(args.get("--bundle"));
  const verifyScript=path.join(path.dirname(fileURLToPath(import.meta.url)),"nm-backup.mjs");
  const check=JSON.parse(execFileSync(process.execPath,[verifyScript,"verify","--bundle",bundle],
    {encoding:"utf8",env:process.env,maxBuffer:1024*1024}));
  if(check.verified!==true)throw Error("Local cryptographic verification failed");
  const token=await refreshAccessToken();
  const result=await uploadVerifiedBundle({bundle,folderId:args.get("--folder-id"),accessToken:token});
  const dir=path.resolve(args.get("--receipt-dir"));
  await fsp.mkdir(dir,{recursive:true,mode:0o700});
  const receipt=path.join(dir,result.name+".receipt.json");
  await fsp.writeFile(receipt,JSON.stringify(result,null,2),{flag:"wx",mode:0o600});
  // User sees nonsecret receipt summary only.
  console.log(JSON.stringify({...result,receipt}));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  run().catch(e=>{console.error("DR upload blocked/failed: "+e.message);process.exitCode=1;});

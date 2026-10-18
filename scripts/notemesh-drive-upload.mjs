/**
 * Upload ONLY a verified encrypted .nmbk backup to a separately authorized
 * Google Drive folder. No live Vault access, no deletion, no full-Drive OAuth.
 * The Railway server has NO right to use ChatGPT's Google Drive connection.
 *
 * Token credentials must be installed by the owner, outside GitHub/Vault.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
const MAX_BYTES=1024*1024*1024,CHUNK=4*1024*1024;
const googleHost=(s)=>{
  const u=new URL(s);
  if(u.protocol!=="https:"||u.hostname!=="www.googleapis.com"||u.port||u.username||u.password)
    throw Error("Google Drive URL origin blocked");
  return u;
};
function validId(id){return /^[A-Za-z0-9_-]{20,120}$/.test(id);}
function readSha(file){
  const hash=crypto.createHash("sha256"),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const b=Buffer.allocUnsafe(1024*1024);
  try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)hash.update(b.subarray(0,n));}
  finally{fs.closeSync(fd);}
  return hash.digest("hex");
}
async function request(fetcher,url,opts,expected=[200]){
  const u=googleHost(url);
  const response=await fetcher(u,{...opts,redirect:"error",signal:AbortSignal.timeout(10*60_000)});
  if(!expected.includes(response.status)) {
    await response.body?.cancel();
    // Provider body may include sensitive details: never log it.
    throw Error("Google Drive HTTP "+response.status);
  }
  return response;
}
async function accessToken(fetcher=fetch){
  const id=process.env.NM_BACKUP_DRIVE_CLIENT_ID??"",
    secret=process.env.NM_BACKUP_DRIVE_CLIENT_SECRET??"",
    refresh=process.env.NM_BACKUP_DRIVE_REFRESH_TOKEN??"";
  if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)||
      secret.length<10||refresh.length<20)
    throw Error("Dedicated backup Google OAuth client + refresh token not configured");
  const res=await fetcher("https://oauth2.googleapis.com/token",{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"}).toString()
  });
  if(!res.ok){await res.body?.cancel();throw Error("Google Backup OAuth refresh refused");}
  const json=await res.json();
  if(typeof json.access_token!=="string"||json.access_token.length<10||
    (typeof json.scope==="string"&&
     !json.scope.split(" ").includes("https://www.googleapis.com/auth/drive.file")))
    throw Error("Backup OAuth scope/access-token mismatch; only explicit drive.file consent supported");
  if(json.refresh_token)throw Error("Refresh token rotated: separately update secure secret, no silent discard");
  return json.access_token;
}
export async function uploadEncryptedBackup(file,folderId,fetcher=fetch,token=null){
  const basename=path.basename(file),st=fs.lstatSync(file);
  if(!basename.endsWith(".nmbk")||!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     st.size<40||st.size>MAX_BYTES)throw Error("Refuse non-encrypted/symlink/oversized backup upload");
  const head=Buffer.alloc(8),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{fs.readSync(fd,head,0,head.length,0);}finally{fs.closeSync(fd);}
  if(!head.equals(Buffer.from("NMBK1GCM")))throw Error("Not an encrypted NoteMesh snapshot");
  if(!validId(folderId))throw Error("A dedicated owner-approved backup folder ID is required");
  const bearer=token??await accessToken(fetcher);
  const auth={Authorization:"Bearer "+bearer},hash=readSha(file);
  // Check prior app-created generations. Drive.file cannot query other apps'
  // unseen files, so folder consent is separately necessary.
  const q="name = '"+basename.replaceAll("'","\\'")+"' and '"+folderId+"' in parents and trashed = false";
  const query=new URL("https://www.googleapis.com/drive/v3/files");
  query.search=new URLSearchParams({q,fields:"nextPageToken,files(id,name,size)",page_size:"20"}).toString();
  const listing=await request(fetcher,query,{headers:auth});
  const found=await listing.json();
  if(!Array.isArray(found.files))throw Error("Google Drive list permission or response invalid");
  if(found.files.some(item=>item.name===basename))
    throw Error("Existing backup filename in Google Drive: do not blindly duplicate or overwrite");

  const init=await request(fetcher,"https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size",
    {method:"POST",headers:{...auth,"Content-Type":"application/json",
      "X-Upload-Content-Type":"application/octet-stream","X-Upload-Content-Length":String(st.size)},
      body:JSON.stringify({name:basename,mimeType:"application/octet-stream",parents:[folderId]})},[200,201]);
  const loc=init.headers.get("location");
  if(!loc)throw Error("Google Drive resumable upload location missing");
  const session=googleHost(loc);
  if(!session.pathname.startsWith("/upload/drive/v3/files"))
    throw Error("Unexpected Google upload session path");
  const handle=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let id=null;
  try{
    for(let offset=0;offset<st.size;){
      const length=Math.min(CHUNK,st.size-offset),buf=Buffer.allocUnsafe(length);
      const count=fs.readSync(handle,buf,0,length,offset);
      if(count!==length)throw Error("Local encrypted file changed during upload");
      const part=await request(fetcher,session,{method:"PUT",
        headers:{...auth,"Content-Type":"application/octet-stream",
          "Content-Length":String(length),
          "Content-Range":"bytes "+offset+"-"+(offset+length-1)+"/"+st.size},
        body:buf},[200,201,308]);
      if(offset+length<st.size){
        if(part.status!==308)throw Error("Google Drive uploaded too few bytes");
        const range=part.headers.get("range");
        if(range!=="bytes=0-"+(offset+length-1))
          throw Error("Google upload acknowledgment out of sequence");
      }else{
        if(part.status===308)throw Error("Incomplete final Google upload");
        const body=await part.json();
        if(!validId(body.id)||Number(body.size)!==st.size)
          throw Error("Remote uploaded file ID or size invalid");
        id=body.id;
      }
      offset+=length;
    }
  }finally{fs.closeSync(handle);}
  if(!id)throw Error("No Google Drive upload receipt");
  // Full REMOTE readback and SHA check. Merely receiving a 200 or Drive MD5
  // metadata is insufficient evidence the encrypted backup is recoverable.
  const download=await request(fetcher,
    "https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(id)+"?alt=media",
    {headers:auth});
  const stream=download.body;
  if(!stream)throw Error("Google Drive remote readback body missing");
  const digest=crypto.createHash("sha256"),reader=stream.getReader();
  let read=0;
  try{
    while(true){
      const next=await reader.read();if(next.done)break;
      read+=next.value.byteLength;
      if(read>st.size)throw Error("Google Drive backup bigger than uploaded file");
      digest.update(next.value);
    }
  }finally{reader.releaseLock();}
  if(read!==st.size||digest.digest("hex")!==hash)
    throw Error("Google Drive remote readback SHA-256 mismatch");
  return {status:"remote_encrypted_backup_sha256_readback_verified",
    fileId:id,filename:basename,bytes:read,sha256:hash,folderId,
    publisherVerified:false,obsidianMobileSyncConfirmed:false};
}
if(import.meta.url==="file://"+process.argv[1]){
  try{
    const [file]=process.argv.slice(2);
    if(!file)throw Error("Usage: node scripts/notemesh-drive-upload.mjs /tmp/backup.nmbk");
    const folder=process.env.NM_BACKUP_DRIVE_FOLDER_ID??"";
    const result=await uploadEncryptedBackup(file,folder);
    process.stdout.write(JSON.stringify(result)+"\n");
  }catch(e){process.stderr.write("Google Drive backup upload failed: "+(e instanceof Error?e.message:"unknown")+"\n");process.exitCode=1;}
}

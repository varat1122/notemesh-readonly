/**
 * Standalone, operator-invoked NoteMesh encrypted snapshot utility.
 *
 * Runtime: Node >=24, tar. NO network calls, no Drive credentials, no Vault edits.
 * Online SQLite backups use node:sqlite instead of copying live WAL sidecars.
 *
 * This is a backup BUILDING BLOCK; scheduling and Drive upload are separately gated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";

const MAGIC=Buffer.from("NMBK1GCM","ascii"), NONCE=12, TAG=16;
const sha256=b=>crypto.createHash("sha256").update(b).digest("hex");
const isSidecar=name=>/-wal$|-shm$|-journal$/i.test(name);
const sqliteName=name=>/\.(sqlite|sqlite3|db)$/i.test(name);
const maxSource=Number(process.env.NM_BACKUP_MAX_BYTES??(800*1024*1024));

function keyFromEnvironment() {
  const raw=process.env.NM_BACKUP_ENCRYPTION_KEY??"";
  const key=/^[0-9a-fA-F]{64}$/.test(raw)?Buffer.from(raw,"hex"):
    /^[A-Za-z0-9+/]{43}=$/.test(raw)?Buffer.from(raw,"base64"):Buffer.alloc(0);
  if(key.length!==32)throw Error("NM_BACKUP_ENCRYPTION_KEY must be independent random 32-byte key (64 hex or canonical base64)");
  return key;
}
function regular(p) {
  const stat=fs.lstatSync(p);
  if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))
    throw Error("Unsupported symlink/device/socket in backup source");
  if(stat.isFile()&&stat.nlink!==1)throw Error("Hard-linked source file refused");
  return stat;
}
function fileSha(p) {
  const h=crypto.createHash("sha256"),fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const buf=Buffer.allocUnsafe(1024*1024);
  try {let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));}
  finally {fs.closeSync(fd);}
  return h.digest("hex");
}
function command(name,args) {
  return new Promise((resolve,reject)=>{
    const p=spawn(name,args,{stdio:["ignore","pipe","pipe"]});
    let stderr="";
    p.stderr.on("data",v=>{if(stderr.length<1000)stderr+=v.toString("utf8").slice(0,1000-stderr.length);});
    let stdout="";
    p.stdout.on("data",v=>{if(stdout.length<16*1024*1024)stdout+=v.toString("utf8").slice(0,16*1024*1024-stdout.length);});
    p.on("error",reject);
    p.on("close",code=>code===0?resolve(stdout):reject(Error(name+" failed: "+stderr.slice(0,250))));
  });
}
async function copyConsistent(src,dst,manifest,prefix="",counter={bytes:0}) {
  const stat=regular(src);
  if(stat.isDirectory()){
    fs.mkdirSync(dst,{recursive:true,mode:0o700});
    for(const name of fs.readdirSync(src).sort()){
      // Never take unstable SQLite sidecars. Base SQLite database is backed up
      // transactionally using the SQLite online-backup API.
      if(isSidecar(name)||name==="safe-edit.lock")continue;
      if(prefix===""&&["backup-staging","tmp"].includes(name))continue;
      await copyConsistent(path.join(src,name),path.join(dst,name),manifest,
        prefix?prefix+"/"+name:name,counter);
    }
    return;
  }
  counter.bytes+=stat.size;
  if(counter.bytes>maxSource||!Number.isFinite(maxSource)||maxSource<1)
    throw Error("Source exceeds explicit backup size cap");
  fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o700});
  const fd=fs.openSync(src,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const sig=Buffer.alloc(16);
  try{fs.readSync(fd,sig,0,16,0);}finally{fs.closeSync(fd);}
  const isDb=sqliteName(src)&&sig.equals(Buffer.from("SQLite format 3\0","ascii"));
  if(isDb) {
    const source=new DatabaseSync(src,{readOnly:true});
    try {await sqliteBackup(source,dst);} finally {source.close();}
    const restored=new DatabaseSync(dst,{readOnly:true});
    try {if(restored.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")
      throw Error("SQLite online-backup quick_check failed");}
    finally {restored.close();}
  } else fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
  const after=regular(src);
  if(stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ino!==after.ino)
    throw Error("Source file changed during snapshot: abort and retry with sync quiesced");
  const copied=regular(dst);
  manifest.push({path:prefix,bytes:copied.size,sha256:fileSha(dst),sqliteOnlineBackup:isDb});
}
function checkedArchiveEntries(text) {
  const names=text.split("\n").filter(Boolean);
  if(names.length>100000)throw Error("Archive has too many entries");
  for(const raw of names){
    const n=raw.replace(/^\.\//,"");
    if(n==="."||n==="")continue;
    if(path.posix.isAbsolute(n)||n.split("/").includes("..")||n.includes("\0")||n.includes("\\"))
      throw Error("Unsafe tar member name");
  }
}
async function encryptTar(stage,destination,key){
  const tmp=destination+".partial";
  const nonce=crypto.randomBytes(NONCE);
  const out=fs.createWriteStream(tmp,{flags:"wx",mode:0o600});
  const cipher=crypto.createCipheriv("aes-256-gcm",key,nonce);
  const tail=new Transform({
    transform(chunk,enc,cb){this.push(chunk);cb();},
    flush(cb){this.push(cipher.getAuthTag());cb();}
  });
  out.write(Buffer.concat([MAGIC,nonce]));
  const p=spawn("tar",["-czf","-","-C",stage,"."],{stdio:["ignore","pipe","pipe"]});
  let err="";
  p.stderr.on("data",v=>{if(err.length<250)err+=v.toString().slice(0,250-err.length);});
  const closed=new Promise((resolve,reject)=>{
    p.on("error",reject);p.on("close",code=>code===0?resolve():reject(Error("tar create failed "+err)));
  });
  try{
    await Promise.all([pipeline(p.stdout,cipher,tail,out),closed]);
    fs.renameSync(tmp,destination);
  }catch(e){p.kill();fs.rmSync(tmp,{force:true});throw e;}
}
async function extractVerifiedSealedArchive(file,dest,key){
  const st=regular(file),size=st.size;
  if(size<MAGIC.length+NONCE+TAG+1)throw Error("Encrypted archive truncated");
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const header=Buffer.alloc(MAGIC.length+NONCE),tag=Buffer.alloc(TAG);
  try {
    fs.readSync(fd,header,0,header.length,0);
    fs.readSync(fd,tag,0,TAG,size-TAG);
  }finally{fs.closeSync(fd);}
  if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw Error("Invalid encrypted archive magic");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const temp=path.join(dest,"authenticated.tar.gz");
  // GCM authenticity is validated BEFORE anything is extracted.
  await pipeline(
    fs.createReadStream(file,{start:header.length,end:size-TAG-1}),
    decipher,fs.createWriteStream(temp,{flags:"wx",mode:0o600})
  );
  const names=await command("tar",["-tzf",temp]);
  checkedArchiveEntries(names);
  const restore=path.join(dest,"restore");
  fs.mkdirSync(restore,{mode:0o700});
  await command("tar",["--no-same-owner","--no-same-permissions","-xzf",temp,"-C",restore]);
  const mf=JSON.parse(fs.readFileSync(path.join(restore,"manifest.json"),"utf8"));
  if(mf.version!==1||!Array.isArray(mf.files)||mf.files.length>100000)
    throw Error("Invalid snapshot manifest");
  const expected=new Set(["manifest.json"]);
  for(const f of mf.files){
    if(typeof f.path!=="string"||!f.path||path.posix.isAbsolute(f.path)||
      f.path.split("/").includes("..")||f.path.includes("\\")||expected.has(f.path))
      throw Error("Invalid snapshot manifest entry");
    expected.add("payload/"+f.path);
    const abs=path.join(restore,"payload",f.path),stat=regular(abs);
    if(!stat.isFile()||stat.size!==f.bytes||fileSha(abs)!==f.sha256)
      throw Error("Snapshot payload verification failed");
    if(f.sqliteOnlineBackup){
      const sql=new DatabaseSync(abs,{readOnly:true});
      try {if(sql.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")
        throw Error("Restored SQLite integrity check failed");}
      finally{sql.close();}
    }
  }
  // Any file not in manifest is unexpected; no silent incomplete restore.
  const walk=(dir,prefix="")=>{
    for(const name of fs.readdirSync(dir)){
      const relative=prefix?prefix+"/"+name:name,stat=regular(path.join(dir,name));
      if(stat.isDirectory())walk(path.join(dir,name),relative);
      else if(!expected.has(relative))throw Error("Unexpected snapshot member");
    }
  };
  walk(restore);
  return {files:mf.files.length,createdAt:mf.createdAt,manifestSha256:fileSha(path.join(restore,"manifest.json"))};
}
export async function verifySnapshot(file,key=keyFromEnvironment()){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"notemesh-verify-"));
  try{return await extractVerifiedSealedArchive(path.resolve(file),dir,key);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export async function createSnapshot(dataDir,outFile,key=keyFromEnvironment()){
  if(process.env.NM_BACKUP_SOURCE_QUIESCED!=="1")
    throw Error("NM_BACKUP_SOURCE_QUIESCED=1 required; first pause Obsidian Sync and live Safe Edit/writers");
  const root=fs.realpathSync(path.resolve(dataDir)),out=path.resolve(outFile);
  if(out===root||out.startsWith(root+path.sep))
    throw Error("Snapshot output must be OUTSIDE live /data volume");
  if(fs.existsSync(out)||fs.existsSync(out+".partial"))
    throw Error("Snapshot filename exists; never overwrite backup generations");
  if(!fs.statSync(root).isDirectory()||!fs.existsSync(path.join(root,"vault"))||
    !fs.existsSync(path.join(root,"app.sqlite")))
    throw Error("Not a recognizable NoteMesh /data folder");
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),"notemesh-snapshot-"));
  try{
    const files=[];
    await copyConsistent(root,path.join(stage,"payload"),files);
    const manifest={version:1,createdAt:new Date().toISOString(),sourceKind:"quiesced_NoteMesh_data",
      sqliteMode:"online_backup_not_live_wal_copy",files};
    fs.writeFileSync(path.join(stage,"manifest.json"),JSON.stringify(manifest),{flag:"wx",mode:0o600});
    await encryptTar(stage,out,key);
    const check=await verifySnapshot(out,key);
    return {status:"verified_encrypted_local_snapshot_not_uploaded",filename:path.basename(out),
      encryptedBytes:fs.statSync(out).size,sha256:fileSha(out),...check};
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
if(import.meta.url==="file://"+process.argv[1]){
  const [mode,loc,out]=process.argv.slice(2);
  try{
    const result=mode==="verify"?await verifySnapshot(loc):
      mode==="create"?await createSnapshot(loc,out):null;
    if(!result)throw Error("Usage: node scripts/notemesh-backup.mjs create /data /tmp/snapshot.nmbk | verify /tmp/snapshot.nmbk");
    process.stdout.write(JSON.stringify(result)+"\n");
  }catch(e){process.stderr.write("NoteMesh backup failed: "+(e instanceof Error?e.message:"unknown error")+"\n");process.exitCode=1;}
}

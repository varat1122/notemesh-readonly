/**
 * Investment OS Disaster Recovery: local, encrypted, offline snapshot.
 * NO production scheduling, Railway mutation or Google token handling.
 *
 * Node >=24 (built-in node:sqlite). GNU tar required.
 * Do not use while a vault writer or Obsidian Sync is active.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";

const MAGIC = Buffer.from("NMDR1");
const HEADER_BYTES = MAGIC.length + 16 + 12;
const PASS_ENV = "NOTEMESH_BACKUP_PASSPHRASE";
const KINDS = new Set(["daily", "weekly", "monthly", "predeploy", "fixture"]);
const EXCLUDE = new Set(["app.sqlite-wal", "app.sqlite-shm", "app.sqlite-journal"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const clean = (p) => path.resolve(p);
const nameSafe = (name) => name !== "." && name !== ".." && !/[\x00-\x1f]/u.test(name);

function passphrase() {
  const value = process.env[PASS_ENV];
  if (!value || Buffer.byteLength(value) < 32) throw Error(PASS_ENV + " must contain >=32 bytes; do not print it or put it in Git.");
  return value;
}
function args(argv) {
  const [cmd, ...rest] = argv;
  if (!["create", "verify", "restore"].includes(cmd)) throw Error("Usage: create|verify|restore with --data-dir, --out, --bundle or --dest");
  const flags = new Map();
  for (let i=0; i<rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith("--") || flags.has(k)) throw Error("Invalid or repeated argument");
    if (["--offline-confirmed", "--fixture-only"].includes(k)) flags.set(k, true);
    else {
      const v = rest[++i];
      if (!v || v.startsWith("--")) throw Error("Missing value for "+k);
      flags.set(k, v);
    }
  }
  const allowed = new Set(["--offline-confirmed","--fixture-only","--data-dir","--out","--kind","--bundle","--dest"]);
  for (const k of flags.keys()) if (!allowed.has(k)) throw Error("Unknown argument: "+k);
  return {cmd, flags};
}
async function run(cmd, argv, options={}) {
  const child = spawn(cmd, argv, {stdio: ["ignore","pipe","pipe"], ...options});
  let err = "";
  child.stderr.on("data", b => { if (err.length < 2048) err += b.toString().slice(0, 2048); });
  const closed = new Promise((resolve,reject) => {child.on("error",reject);child.on("close", c=>c===0?resolve():reject(Error(cmd+" failed: "+err.slice(0,256))));});
  return {child, closed};
}
async function copyTree(src,dst,inventory,rel="") {
  for(const e of await fsp.readdir(src,{withFileTypes:true})) {
    if(!nameSafe(e.name)) throw Error("Unsupported filename");
    const child = path.join(src,e.name), target=path.join(dst,e.name), logical=rel ? rel+"/"+e.name:e.name;
    const st = await fsp.lstat(child);
    if(st.isSymbolicLink() || !st.isFile() && !st.isDirectory() || st.nlink !== 1 && st.isFile()) throw Error("Symlink, hardlink or non-regular file refused: "+logical);
    if(st.isDirectory()) {await fsp.mkdir(target,{recursive:true,mode:0o700}); await copyTree(child,target,inventory,logical);continue;}
    if(rel==="" && EXCLUDE.has(e.name)) continue;
    const before = {size:st.size,mtimeMs:st.mtimeMs,ino:st.ino};
    await fsp.copyFile(child,target,fs.constants.COPYFILE_EXCL);
    const after = await fsp.lstat(child);
    if(after.size!==before.size || after.mtimeMs!==before.mtimeMs || after.ino!==before.ino) throw Error("Source changed during snapshot: "+logical);
    const buf = await fsp.readFile(target);
    inventory.push({path:logical,size:buf.length,sha256:sha(buf)});
  }
}
async function stageData(data,stage) {
  const payload=path.join(stage,"payload");
  await fsp.mkdir(payload,{recursive:true,mode:0o700});
  const inventory=[];
  await copyTree(data,payload,inventory);
  const liveDb = path.join(data,"app.sqlite");
  const stagedDb=path.join(payload,"app.sqlite");
  if(!fs.existsSync(liveDb)) throw Error("app.sqlite not found; incomplete NoteMesh data directory");
  // The online SQLite backup API takes a transactionally consistent snapshot,
  // including committed WAL state; never copy app.sqlite from a live source.
  await fsp.rm(stagedDb,{force:true});
  const db=new DatabaseSync(liveDb,{readOnly:true});
  try {await sqliteBackup(db,stagedDb);} finally {db.close();}
  const check=new DatabaseSync(stagedDb,{readOnly:true});
  try {if(check.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok") throw Error("SQLite integrity check failed");}
  finally {check.close();}
  const buf=await fsp.readFile(stagedDb);
  const pos=inventory.findIndex(x=>x.path==="app.sqlite");
  if(pos>=0) inventory.splice(pos,1);
  inventory.push({path:"app.sqlite",size:buf.length,sha256:sha(buf)});
  inventory.sort((a,b)=>a.path.localeCompare(b.path));
  const meta={
    format:"notemesh-dr/1",createdAt:new Date().toISOString(),sqlite:"online-backup+integrity-check",
    files:inventory,totalBytes:inventory.reduce((a,x)=>a+x.size,0)
  };
  await fsp.writeFile(path.join(stage,"manifest.json"),JSON.stringify(meta),{mode:0o600,flag:"wx"});
  return meta;
}
async function encryptTar(stage,target,secret) {
  const salt=randomBytes(16),nonce=randomBytes(12);
  const key=scryptSync(secret,salt,32,{N:16384,r:8,p:1});
  const cipher=createCipheriv("aes-256-gcm",key,nonce);
  const {child,closed}=await run("tar",["-czf","-","-C",stage,"manifest.json","payload"]);
  const out=fs.createWriteStream(target,{flags:"wx",mode:0o600});
  out.write(Buffer.concat([MAGIC,salt,nonce]));
  try {
    await Promise.all([pipeline(child.stdout,cipher,out),closed]);
    await fsp.appendFile(target,cipher.getAuthTag());
  } catch(e) {child.kill();await fsp.rm(target,{force:true});throw e;}
}
async function decryptTar(bundle,archive,secret) {
  const fd=await fsp.open(bundle,"r");
  const stat=await fd.stat();
  if(stat.size<HEADER_BYTES+16) {await fd.close();throw Error("Truncated backup");}
  const prefix=Buffer.alloc(HEADER_BYTES),tag=Buffer.alloc(16);
  await fd.read(prefix,0,prefix.length,0);await fd.read(tag,0,16,stat.size-16);
  await fd.close();
  if(!prefix.subarray(0,MAGIC.length).equals(MAGIC)) throw Error("Unsupported backup format");
  const salt=prefix.subarray(5,21),nonce=prefix.subarray(21,33);
  const decipher=createDecipheriv("aes-256-gcm",scryptSync(secret,salt,32,{N:16384,r:8,p:1}),nonce);
  decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(bundle,{start:HEADER_BYTES,end:stat.size-17}),decipher,fs.createWriteStream(archive,{flags:"wx",mode:0o600}));
}
async function inspectTar(archive) {
  // Refuse links, devices and unsafe paths BEFORE extraction.
  const {child,closed}=await run("tar",["-tzvf",archive]);
  let listing="";
  for await(const chunk of child.stdout) {
    listing+=chunk.toString();
    if(listing.length>20_000_000) {child.kill();throw Error("Archive listing too large");}
  }
  await closed;
  const lines=listing.trim().split("\n");
  for(const line of lines) {
    if(!line || !/^[d-]/.test(line)) throw Error("Archive contains links or special members");
    const match=/\s(?:manifest\.json|payload(?:\/.*)?)$/u.exec(line);
    if(!match) throw Error("Unexpected archive member");
    const member=match[0].trim();
    if(member.startsWith("/") || member.split("/").includes("..") || /[\r\n\x00]/u.test(member)) throw Error("Unsafe archive path");
  }
}
async function checkStage(stage) {
  const meta=JSON.parse(await fsp.readFile(path.join(stage,"manifest.json"),"utf8"));
  if(meta.format!=="notemesh-dr/1" || !Array.isArray(meta.files) || meta.files.length>100000) throw Error("Invalid manifest");
  const seen=new Set();let total=0;
  for(const item of meta.files) {
    if(typeof item.path!=="string" || !item.path || item.path.startsWith("/") || item.path.split("/").some(x=>!nameSafe(x)) ||
       seen.has(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size<0) throw Error("Invalid manifest entry");
    seen.add(item.path);
    const p=path.join(stage,"payload",item.path);
    const s=await fsp.lstat(p);
    if(!s.isFile() || s.isSymbolicLink() || s.nlink!==1 || s.size!==item.size) throw Error("Manifest stat mismatch");
    if(sha(await fsp.readFile(p))!==item.sha256) throw Error("Manifest SHA-256 mismatch");
    total+=s.size;
  }
  const actual=[];
  async function walk(root,rel="") {
    for(const e of await fsp.readdir(root,{withFileTypes:true})) {
      const child=rel?rel+"/"+e.name:e.name;
      if(e.isDirectory()) await walk(path.join(root,e.name),child);
      else if(e.isFile()) actual.push(child);
      else throw Error("Unsafe extracted entry");
    }
  }
  await walk(path.join(stage,"payload"));
  if(actual.length!==seen.size || actual.some(x=>!seen.has(x)) || total!==meta.totalBytes || !seen.has("app.sqlite")) throw Error("Archive file count/size mismatch");
  const db=new DatabaseSync(path.join(stage,"payload","app.sqlite"),{readOnly:true});
  try {if(db.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok")throw Error("Recovered database invalid");}
  finally {db.close();}
  return {files:seen.size,bytes:total,createdAt:meta.createdAt};
}
async function openVerified(bundle,secret) {
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),"notemesh-restore-"));
  const tgz=path.join(dir,"archive.tar.gz"),stage=path.join(dir,"extract");
  try {
    await decryptTar(bundle,tgz,secret);
    await inspectTar(tgz);
    await fsp.mkdir(stage,{mode:0o700});
    const {child,closed}=await run("tar",["-xzf",tgz,"-C",stage,"--no-same-owner","--no-same-permissions"]);
    for await(const _ of child.stdout) {/* drain */} await closed;
    const summary=await checkStage(stage);
    return {dir,stage,summary};
  } catch(e){await fsp.rm(dir,{recursive:true,force:true});throw e;}
}
export async function main(argv=process.argv.slice(2)) {
  const {cmd,flags}=args(argv),secret=passphrase();
  if(cmd==="create") {
    const data=clean(flags.get("--data-dir")||""),out=clean(flags.get("--out")||"");
    const kind=flags.get("--kind")||"fixture";
    if(!flags.has("--data-dir")||!flags.has("--out") || !KINDS.has(kind))throw Error("Require --data-dir, --out and valid --kind");
    if(!flags.get("--offline-confirmed") && !flags.get("--fixture-only"))throw Error("Refusing live data: --offline-confirmed or --fixture-only required");
    if(inside(data,out) || inside(out,data))throw Error("Backup output and source directories must be disjoint");
    await fsp.mkdir(out,{recursive:true,mode:0o700});
    const stage=await fsp.mkdtemp(path.join(os.tmpdir(),"notemesh-stage-"));
    const target=path.join(out,"notemesh-"+kind+"-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomBytes(4).toString("hex")+".nmb");
    try {
      const meta=await stageData(data,stage);
      await encryptTar(stage,target,secret);
      const encrypted=await fsp.readFile(target);
      const receipt={bundle:target,sha256:sha(encrypted),encryptedBytes:encrypted.length,files:meta.files.length,kind,verified:false};
      console.log(JSON.stringify(receipt));
    } finally {await fsp.rm(stage,{recursive:true,force:true});}
  } else {
    const bundle=clean(flags.get("--bundle")||"");
    if(!flags.has("--bundle"))throw Error("Require --bundle");
    const {dir,stage,summary}=await openVerified(bundle,secret);
    try {
      if(cmd==="restore") {
        if(!flags.has("--dest"))throw Error("Require --dest");
        const dest=clean(flags.get("--dest"));
        if(dest==="/" || dest==="/data" || dest===clean(process.env.DATA_DIR||"/data") || inside(dest,bundle))throw Error("Refusing restore over a live/protected path");
        await fsp.mkdir(dest,{recursive:true,mode:0o700});
        if((await fsp.readdir(dest)).length)throw Error("Restore destination must be empty");
        const manifest=JSON.parse(await fsp.readFile(path.join(stage,"manifest.json"),"utf8"));
        for(const item of manifest.files) {
          const src=path.join(stage,"payload",item.path),target=path.join(dest,item.path);
          await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
          await fsp.copyFile(src,target,fs.constants.COPYFILE_EXCL);
        }
      }
      console.log(JSON.stringify({verified:true,restored:cmd==="restore",...summary}));
    } finally {await fsp.rm(dir,{recursive:true,force:true});}
  }
}
if(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(e=>{console.error("Backup operation failed: "+e.message);process.exitCode=1;});
}

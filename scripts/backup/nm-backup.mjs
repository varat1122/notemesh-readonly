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
async function shaFile(p) {
  const hash=createHash("sha256");
  for await(const chunk of fs.createReadStream(p)) hash.update(chunk);
  return hash.digest("hex");
}
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const clean = (p) => path.resolve(p);
const nameSafe = (name) => name !== "." && name !== ".." && ![...name].some(ch=>ch.charCodeAt(0)<32);
const MAX_TOTAL_BYTES=2_000_000_000;
const MAX_FILES=100_000;
const within = (root,entry) => entry.startsWith(root+path.sep);
const sourceRoot = (value) => fs.realpathSync(value);

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
async function copyTree(src,dst,inventory,rel="",databases=[],folders=[],budget={bytes:0,files:0,root:""}) {
  for(const e of await fsp.readdir(src,{withFileTypes:true})) {
    if(!nameSafe(e.name)) throw Error("Unsupported filename");
    const child = path.join(src,e.name), target=path.join(dst,e.name), logical=rel ? rel+"/"+e.name:e.name;
    const st = await fsp.lstat(child);
    if(st.isSymbolicLink() || !st.isFile() && !st.isDirectory() || st.nlink !== 1 && st.isFile()) throw Error("Symlink, hardlink or non-regular file refused: "+logical);
    if(st.isDirectory()) {
      // Refuse races that turn an ancestor into a link outside DATA_DIR.
      if(!within(budget.root,sourceRoot(child)))throw Error("Directory escaped source root: "+logical);
      await fsp.mkdir(target,{recursive:true,mode:0o700});
      folders.push(logical);
      await copyTree(child,target,inventory,logical,databases,folders,budget);
      continue;
    }
    if(/\.sqlite(?:-(?:wal|shm|journal))?$/.test(e.name)) {
      if(e.name.endsWith(".sqlite"))databases.push(logical);
      continue;
    }
    budget.files++;
    budget.bytes+=st.size;
    if(budget.files>MAX_FILES || budget.bytes>MAX_TOTAL_BYTES)throw Error("Snapshot exceeds bounded file/byte budget");
    const handle=await fsp.open(child,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const opened=await handle.stat();
      if(!opened.isFile() || opened.nlink!==1 || opened.ino!==st.ino || opened.dev!==st.dev)
        throw Error("Source changed before open: "+logical);
      // Resolve the opened descriptor, not just the filename: a swapped ancestor
      // symlink must never read files outside the selected DATA_DIR.
      if(process.platform==="linux") {
        const actual=fs.realpathSync("/proc/self/fd/"+handle.fd);
        if(!within(budget.root,actual))throw Error("Source descriptor escaped data root: "+logical);
      }
      const output=fs.createWriteStream(target,{flags:"wx",mode:0o600});
      await pipeline(handle.createReadStream({autoClose:false}),output);
      const after=await handle.stat();
      if(after.size!==opened.size || after.mtimeMs!==opened.mtimeMs ||
         (await fsp.stat(target)).size!==opened.size)
        throw Error("Source changed during snapshot: "+logical);
      inventory.push({path:logical,size:opened.size,sha256:await shaFile(target)});
    } finally {await handle.close();}
  }
}
async function stageData(data,stage) {
  const payload=path.join(stage,"payload");
  await fsp.mkdir(payload,{recursive:true,mode:0o700});
  const inventory=[],databases=[],folders=[],budget={bytes:0,files:0,root:sourceRoot(data)};
  await copyTree(data,payload,inventory,"",databases,folders,budget);
  if(!databases.includes("app.sqlite")) throw Error("app.sqlite not found; incomplete NoteMesh data directory");
  if(inventory.length+databases.length>MAX_FILES)throw Error("Snapshot exceeds file budget");
  for(const relative of databases) {
    const liveDb=path.join(data,relative),stagedDb=path.join(payload,relative);
    // Online SQLite backup obtains committed WAL contents, never raw live DB copying.
    const db=new DatabaseSync(liveDb,{readOnly:true});
    try {await sqliteBackup(db,stagedDb);} finally {db.close();}
    const check=new DatabaseSync(stagedDb,{readOnly:true});
    try {if(check.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok") throw Error("SQLite integrity check failed: "+relative);}
    finally {check.close();}
    for(const suffix of ["-wal","-shm","-journal"]) await fsp.rm(stagedDb+suffix,{force:true});
    const size=(await fsp.stat(stagedDb)).size;
    budget.bytes+=size;
    if(budget.bytes>MAX_TOTAL_BYTES)throw Error("Snapshot exceeds bounded file/byte budget");
    inventory.push({path:relative,size,sha256:await shaFile(stagedDb)});
  }
  inventory.sort((a,b)=>a.path.localeCompare(b.path));
  const meta={
    format:"notemesh-dr/1",createdAt:new Date().toISOString(),sqlite:"online-backup+integrity-check",sqliteDatabases:databases.sort(),
    files:inventory,folders:folders.sort(),totalBytes:inventory.reduce((a,x)=>a+x.size,0)
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
    if(member.startsWith("/") || member.split("/").includes("..") || [...member].some(ch=>ch.charCodeAt(0)<32)) throw Error("Unsafe archive path");
  }
}
async function checkStage(stage) {
  const meta=JSON.parse(await fsp.readFile(path.join(stage,"manifest.json"),"utf8"));
  if(meta.format!=="notemesh-dr/1" || !Array.isArray(meta.files) || meta.files.length>MAX_FILES ||
     !Array.isArray(meta.folders) || meta.folders.length>MAX_FILES ||
     !Number.isSafeInteger(meta.totalBytes) || meta.totalBytes>MAX_TOTAL_BYTES) throw Error("Invalid manifest");
  const seen=new Set();let total=0;
  for(const item of meta.files) {
    if(typeof item.path!=="string" || !item.path || item.path.startsWith("/") || item.path.split("/").some(x=>!nameSafe(x)) ||
       seen.has(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size<0) throw Error("Invalid manifest entry");
    seen.add(item.path);
    const p=path.join(stage,"payload",item.path);
    const s=await fsp.lstat(p);
    if(!s.isFile() || s.isSymbolicLink() || s.nlink!==1 || s.size!==item.size) throw Error("Manifest stat mismatch");
    if(await shaFile(p)!==item.sha256) throw Error("Manifest SHA-256 mismatch");
    total+=s.size;
  }
  const actual=[],actualFolders=[];
  async function walk(root,rel="") {
    for(const e of await fsp.readdir(root,{withFileTypes:true})) {
      const child=rel?rel+"/"+e.name:e.name;
      if(e.isDirectory()) {actualFolders.push(child);await walk(path.join(root,e.name),child);}
      else if(e.isFile()) actual.push(child);
      else throw Error("Unsafe extracted entry");
    }
  }
  await walk(path.join(stage,"payload"));
  const folderSet=new Set(meta.folders);
  if(folderSet.size!==meta.folders.length || meta.folders.some(x=>typeof x!=="string" || !x ||
     x.startsWith("/") || x.split("/").some(p=>!nameSafe(p))) ||
     actualFolders.length!==folderSet.size || actualFolders.some(x=>!folderSet.has(x)))
    throw Error("Archive directory inventory mismatch");
  if(actual.length!==seen.size || actual.some(x=>!seen.has(x)) || total!==meta.totalBytes || !seen.has("app.sqlite"))
    throw Error("Archive file count/size mismatch (manifest="+seen.size+",actual="+actual.length+",bytes="+total+"/"+meta.totalBytes+",extra="+actual.filter(x=>!seen.has(x)).slice(0,5).join(",")+")");
  const paths=meta.sqliteDatabases;
  if(!Array.isArray(paths) || !paths.length || !paths.includes("app.sqlite") ||
    paths.some(p=>typeof p!=="string" || !seen.has(p)))throw Error("Missing SQLite database metadata");
  for(const sqlitePath of paths) {
    const db=new DatabaseSync(path.join(stage,"payload",sqlitePath),{readOnly:true});
    try {if(db.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok")throw Error("Recovered database invalid: "+sqlitePath);}
    finally {db.close();}
  }
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
    // Fail closed on any Railway process: a manual --offline-confirmed flag
    // cannot prove that the deployed service, Sync and SQLite writers stopped.
    // This CLI remains offline/fixture-only until a separately audited,
    // service-wide snapshot coordinator and cross-process lease exist.
    if (process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID ||
        process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_ENVIRONMENT_NAME ||
        process.env.RAILWAY_PROJECT_NAME || process.env.RAILWAY_SERVICE_NAME)
      throw Error("backup_create_refused_on_railway_without_coordinated_snapshot");
    const resolvedData=fs.realpathSync(data);
    if(flags.get("--fixture-only") && (inside("/data",resolvedData) ||
      inside(clean(process.env.DATA_DIR||"/data"),resolvedData) ||
      process.env.RAILWAY_ENVIRONMENT_ID))
      throw Error("Fixture mode cannot operate on Railway or a deployed data root");
    if(inside(data,out) || inside(out,data))throw Error("Backup output and source directories must be disjoint");
    if(!fs.statSync(data).isDirectory())throw Error("Source must be a directory");
    if(process.platform==="linux" && !fs.realpathSync(data).startsWith(path.sep))
      throw Error("Invalid resolved source root");
    // Resolve the closest existing ancestor BEFORE mkdir. A backup output
    // routed through a symlink into DATA_DIR must fail without even creating
    // an empty directory in the source. Relative suffixes are appended after
    // canonicalizing that ancestor.
    let existingOutAncestor=out;
    while(!fs.existsSync(existingOutAncestor)) {
      const next=path.dirname(existingOutAncestor);
      if(next===existingOutAncestor)throw Error("Unresolvable backup output parent");
      existingOutAncestor=next;
    }
    const prospectiveOut=path.resolve(fs.realpathSync(existingOutAncestor),
      path.relative(existingOutAncestor,out));
    if(inside(resolvedData,prospectiveOut) || inside(prospectiveOut,resolvedData))
      throw Error("Resolved backup output overlaps source data directory");
    await fsp.mkdir(out,{recursive:true,mode:0o700});
    // Repeat after creation: a pre-existing symlink can change while mkdir
    // runs. This is a fail-closed check, not an atomic cross-process lease.
    const resolvedOut=fs.realpathSync(out);
    if(inside(resolvedData,resolvedOut) || inside(resolvedOut,resolvedData))
      throw Error("Resolved backup output overlaps source data directory");
    const stage=await fsp.mkdtemp(path.join(os.tmpdir(),"notemesh-stage-"));
    const target=path.join(out,"notemesh-"+kind+"-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomBytes(4).toString("hex")+".nmb");
    try {
      const meta=await stageData(data,stage);
      await encryptTar(stage,target,secret);
      const receipt={bundle:target,sha256:await shaFile(target),encryptedBytes:(await fsp.stat(target)).size,files:meta.files.length,kind,verified:false};
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
        // Never follow a symlink target. The sandbox must be a NEW directory,
        // not a preexisting (even empty) destination that could be overwritten.
        let cursor=path.dirname(dest);
        while(true){
          const st=await fsp.lstat(cursor);
          if(!st.isDirectory() || st.isSymbolicLink())throw Error("Restore parent directory is unsafe");
          const parent=path.dirname(cursor);
          if(parent===cursor)break;
          cursor=parent;
        }
        await fsp.mkdir(dest,{mode:0o700}).catch(e=>{
          if(e?.code==="EEXIST")throw Error("Restore destination must be empty and not already exist");
          throw e;
        });
        const manifest=JSON.parse(await fsp.readFile(path.join(stage,"manifest.json"),"utf8"));
        for(const directory of manifest.folders)
          await fsp.mkdir(path.join(dest,directory),{recursive:true,mode:0o700});
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

"use strict";
// Offline-only restore of an *actual* pre-existing ChatGPT export attachment.
// No deletion, no placeholder creation, no user-facing write route.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const ROOT="07_Sources/ChatGPT/Archive/";
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const fail=s=>{throw Error(s)};
const HEADERS={".zip":"zip",".json":"json",".txt":"text"};
function checkedTarget(rel){
  if(typeof rel!=="string"||!rel.startsWith(ROOT)||rel.includes("\\")||rel.includes("\0")||
    /[\x00-\x1f<>:"|?*#]/.test(rel)) fail("Unsafe archive target");
  const parts=rel.split("/");
  if(parts.some(s=>!s||s==="."||s===".."||s.startsWith(".")||/[. ]$/.test(s)))fail("Unsafe archive path component");
  const ext=path.extname(rel).toLowerCase();
  if(!(ext in HEADERS))fail("Unsupported archive extension");
  if(Buffer.byteLength(rel)>850)fail("Archive target too long");
  return {rel,ext};
}
function inspectBytes(bytes,ext){
  if(bytes.length<1||bytes.length>40_000_000)fail("Invalid attachment size");
  if(ext===".json"){try{JSON.parse(bytes.toString("utf8"))}catch{fail("Original JSON is invalid")}}
  if(ext===".zip"&&!["504b0304","504b0506","504b0708"].includes(bytes.subarray(0,4).toString("hex")))fail("Invalid ZIP header");
  if(ext===".txt"&&bytes.includes(0))fail("NUL bytes in text file");
}
function safePath(vault,rel,create=false){
  const real=fs.realpathSync(vault);
  if(fs.lstatSync(vault).isSymbolicLink())fail("Symlink vault root");
  const parts=rel.split("/");
  let cur=real;
  for(const part of parts.slice(0,-1)){
    cur=path.join(cur,part);
    if(!fs.existsSync(cur)){if(create)fs.mkdirSync(cur);else continue}
    if(fs.existsSync(cur)&&(fs.lstatSync(cur).isSymbolicLink()||!fs.lstatSync(cur).isDirectory()))fail("Unsafe archive directory");
  }
  const output=path.join(real,...parts);
  if(fs.existsSync(output)&&(fs.lstatSync(output).isSymbolicLink()||!fs.lstatSync(output).isFile()))fail("Unsafe archive destination");
  return output;
}
function restore({vault,sourceFile,targetPath,expectedSha256=null,commit=false}){
  if(!vault||!sourceFile)fail("Vault and actual source file are required");
  const {rel,ext}=checkedTarget(targetPath);
  const st=fs.lstatSync(sourceFile);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>40_000_000)fail("Unsafe original file");
  const bytes=fs.readFileSync(sourceFile);
  inspectBytes(bytes,ext);
  const digest=hash(bytes);
  if(expectedSha256!==null&&(!/^[a-f0-9]{64}$/.test(expectedSha256)||expectedSha256!==digest))fail("Expected original SHA-256 mismatch");
  const full=safePath(vault,rel,false);
  if(fs.existsSync(full)&&hash(fs.readFileSync(full))!==digest)fail("Destination conflicts with existing archive; refused");
  const outcome={targetPath:rel,sha256:digest,bytes:bytes.length,sourceIdentity:expectedSha256?"hash_matched":"file_bytes_only_no_historical_identity_proof",
    status:commit?"commit":"dry_run"};
  if(!commit)return outcome;
  const f=fs.statfsSync(vault);
  if(f.bavail*f.bsize<50_000_000+bytes.length)fail("Insufficient vault disk space");
  safePath(vault,rel,true);
  if(!fs.existsSync(full)){
    const fd=fs.openSync(full,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    try{let n=0;while(n<bytes.length)n+=fs.writeSync(fd,bytes,n,bytes.length-n);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  }
  if(hash(fs.readFileSync(full))!==digest)fail("Restored archive failed byte-identical SHA-256 readback");
  return {...outcome,status:"written_or_identical_verified"};
}
function cli(args){
  const out={commit:false};const flags={"--vault":"vault","--file":"sourceFile","--target":"targetPath","--sha256":"expectedSha256"};
  for(let i=0;i<args.length;i++){if(args[i]==="--commit"){out.commit=true;continue}const k=flags[args[i]];if(!k||!args[i+1])fail("Invalid CLI argument");out[k]=args[++i]}
  if(!out.vault||!out.sourceFile||!out.targetPath)fail("Usage: node scripts/restore-original-archive.cjs --vault VAULT --file ORIGINAL --target 07_Sources/ChatGPT/Archive/path.zip [--sha256 VERIFIED_SOURCE_DIGEST] [--commit]");
  return out;
}
if(require.main===module)try{process.stdout.write(JSON.stringify(restore(cli(process.argv.slice(2))),null,2)+"\n")}catch(e){process.stderr.write(String(e.message||e)+"\n");process.exitCode=1}
module.exports={restore,checkedTarget,inspectBytes};

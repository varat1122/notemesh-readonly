/**
 * Read-only NoteMesh DR preflight. Does not stop sync, modify Vault/DB, or
 * claim that a coherent production snapshot has been taken.
 * Never prints sensitive filenames, settings, database rows or credentials.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";

export async function inspect(dataDir) {
  const dir=await fsp.realpath(dataDir);
  const stats=await fsp.stat(dir);
  if(!stats.isDirectory())throw Error("DATA_DIR must be a directory");
  const report={
    format:"notemesh-dr-preflight/1",
    snapshotReady:false,
    writerQuiescenceVerified:false,
    readOnly:true,
    files:0,bytes:0,
    vaultFiles:0,homeFiles:0,sourceArchiveFiles:0,otherFiles:0,
    databases:0,sqliteBytes:0,
    unsafePaths:0,danglingSqliteSidecars:0,
    required:{vault:false,home:false,appSqlite:false},
    warnings:[],
    staging:"unverified"
  };
  const mainDbs=new Set(),sidecars=[];
  const visit=async (p,rel="")=>{
    for(const entry of await fsp.readdir(p,{withFileTypes:true})) {
      const sub=rel?rel+"/"+entry.name:entry.name;
      const filename=path.join(p,entry.name);
      const info=await fsp.lstat(filename);
      if(info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink!==1) {
        report.unsafePaths++;continue;
      }
      if(info.isDirectory()) {
        if(sub==="vault")report.required.vault=true;
        if(sub==="home")report.required.home=true;
        await visit(filename,sub);
      } else {
        report.files++;report.bytes+=info.size;
        if(sub.startsWith("vault/"))report.vaultFiles++;
        else if(sub.startsWith("home/"))report.homeFiles++;
        else if(sub.startsWith("source-archive/"))report.sourceArchiveFiles++;
        else report.otherFiles++;
        if(sub==="app.sqlite")report.required.appSqlite=true;
        if(sub.endsWith(".sqlite")) {report.databases++;report.sqliteBytes+=info.size;mainDbs.add(sub);}
        if(/\.sqlite-(?:wal|shm|journal)$/.test(sub))sidecars.push(sub);
      }
      if(report.files>100000 || report.bytes>2_000_000_000) {
        report.warnings.push("data_size_exceeds_fixture_backup_limits");return;
      }
    }
  };
  await visit(dir);
  report.danglingSqliteSidecars=sidecars.filter(x=>!mainDbs.has(x.replace(/-(?:wal|shm|journal)$/,""))).length;
  for(const [k,v] of Object.entries(report.required))if(!v)report.warnings.push("missing_"+k);
  if(report.unsafePaths)report.warnings.push("unsafe_file_types_or_symlinks");
  if(report.danglingSqliteSidecars)report.warnings.push("sqlite_sidecars_without_database");
  // This checks free space on local scratch only. Production snapshot
  // quiescence, off-device Drive auth and Railway volume budget remain blocked.
  try{
    const space=fs.statfsSync(os.tmpdir(),{bigint:true});
    const free=space.bavail*space.bsize;
    const estimate=BigInt(Math.max(1,report.bytes))*2n+64n*1024n*1024n;
    report.staging=free>=estimate?"scratch_capacity_estimate_ok":"insufficient_scratch_estimate";
    if(free<estimate)report.warnings.push("scratch_free_space_too_low");
  }catch{report.warnings.push("scratch_free_space_unknown");}
  report.warnings.push("not_an_authorized_production_backup");
  return report;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=="--data-dir")throw Error("Usage: nm-dr-preflight.mjs --data-dir PATH");
  console.log(JSON.stringify(await inspect(args[1])));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error("DR preflight denied: "+e.message);process.exitCode=1;});

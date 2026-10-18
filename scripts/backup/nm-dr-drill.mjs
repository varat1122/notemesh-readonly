/**
 * OFFLINE FIXTURE disaster-recovery drill: create -> verify -> restore ->
 * compare every regular file + all SQLite schema/rows. No Google, Railway,
 * credentials, production mounts, service endpoints or external writes.
 *
 * This is NOT proof of live writer quiescence or production recovery.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";

const tool=fileURLToPath(new URL("./nm-backup.mjs",import.meta.url));
const inside=(root,p)=>p===root||p.startsWith(root+path.sep);
const h=()=>createHash("sha256");
async function checksum(file){
  const result=h();
  for await(const b of fs.createReadStream(file))result.update(b);
  return result.digest("hex");
}
function dbState(file){
  const db=new DatabaseSync(file,{readOnly:true}),digest=h();
  let tables=0,rows=0;
  try{
    if(db.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok")throw Error("fixture_sqlite_integrity_failure");
    for(const table of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
      tables++;
      digest.update(JSON.stringify(table));
      const escaped=table.name.replace(/"/g,'""');
      const values=db.prepare('SELECT * FROM "'+escaped+'"').all()
        .map(row=>JSON.stringify(row)).sort();
      rows+=values.length;
      for(const value of values){digest.update(value);digest.update("\n");}
    }
  }finally{db.close();}
  return {sha256:digest.digest("hex"),tables,rows};
}
async function inventory(root){
  const files=[],dirs=[];let tables=0,rows=0,databases=0,bytes=0;
  async function descend(dir,relative=""){
    for(const entry of await fsp.readdir(dir,{withFileTypes:true})){
      const rel=relative?relative+"/"+entry.name:entry.name;
      const full=path.join(dir,entry.name);
      const st=await fsp.lstat(full);
      if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory())||(st.isFile()&&st.nlink!==1))
        throw Error("fixture_unsafe_entry");
      if(st.isDirectory()){dirs.push(rel);await descend(full,rel);continue;}
      if(/\.sqlite-(wal|shm|journal)$/.test(rel))continue;
      bytes+=st.size;
      if(rel.endsWith(".sqlite")){
        const db=dbState(full);databases++;tables+=db.tables;rows+=db.rows;
        files.push([rel,"db",db.sha256]);
      }else files.push([rel,"file",await checksum(full)]);
    }
  }
  await descend(root);
  if(!files.some(x=>x[0]==="app.sqlite"))throw Error("fixture_missing_app_sqlite");
  files.sort((a,b)=>a[0].localeCompare(b[0]));dirs.sort();
  const digest=h().update(JSON.stringify({files,dirs})).digest("hex");
  return {sha256:digest,files:files.length,dirs:dirs.length,databases,tables,rows,bytes};
}
function callBackup(argv){
  const res=spawnSync(process.execPath,[tool,...argv],{
    env:process.env,encoding:"utf8",maxBuffer:1024*1024,timeout:120_000
  });
  if(res.status!==0)throw Error("fixture_backup_step_failed ("+argv[0]+")");
  try{return JSON.parse(res.stdout.trim());}
  catch{throw Error("fixture_backup_invalid_receipt ("+argv[0]+")");}
}
export async function drill(fixtureData){
  if(process.env.RAILWAY_ENVIRONMENT_ID)throw Error("fixture_drill_refuses_railway");
  const source=await fsp.realpath(fixtureData);
  const active=path.resolve(process.env.DATA_DIR||"/data");
  if(inside("/data",source)||inside(active,source))throw Error("fixture_drill_refuses_production_root");
  if(!(await fsp.stat(source)).isDirectory())throw Error("fixture_root_not_a_directory");
  if((process.env.NOTEMESH_BACKUP_PASSPHRASE||"").length<32)throw Error("fixture_drill_requires_secure_passphrase");
  const scratch=await fsp.mkdtemp(path.join(os.tmpdir(),"notemesh-dr-drill-"));
  try{
    const before=await inventory(source);
    const out=path.join(scratch,"bundles");
    const created=callBackup(["create","--data-dir",source,"--out",out,"--kind","fixture","--fixture-only"]);
    const checked=callBackup(["verify","--bundle",created.bundle]);
    if(checked.verified!==true)throw Error("fixture_backup_not_verified");
    const after=await inventory(source);
    if(before.sha256!==after.sha256)throw Error("fixture_changed_during_backup");
    const target=path.join(scratch,"restored");
    const recovered=callBackup(["restore","--bundle",created.bundle,"--dest",target]);
    if(recovered.verified!==true||recovered.restored!==true)throw Error("fixture_restore_not_verified");
    const restored=await inventory(target);
    if(before.sha256!==restored.sha256||before.files!==restored.files||
       before.databases!==restored.databases||before.rows!==restored.rows||
       before.dirs!==restored.dirs)throw Error("fixture_recovery_mismatch");
    const ciphertext=await checksum(created.bundle);
    if(ciphertext!==created.sha256)throw Error("fixture_bundle_sha256_mismatch");
    return {format:"notemesh-dr-drill/1",kind:"offline-fixture-only",passed:true,
      encryptedCiphertext:true,ciphertextSha256:ciphertext,
      verifiedFiles:restored.files,verifiedDirectories:restored.dirs,
      verifiedDatabases:restored.databases,verifiedTables:restored.tables,
      verifiedRows:restored.rows,semanticSha256:restored.sha256,
      googleDriveReadbackTested:false,productionSnapshotTested:false};
  }finally{await fsp.rm(scratch,{recursive:true,force:true});}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=="--fixture-data")
    throw Error("Usage: node scripts/backup/nm-dr-drill.mjs --fixture-data /path/to/ISOLATED-fixture");
  console.log(JSON.stringify(await drill(args[1])));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error("DR drill denied: "+e.message);process.exitCode=1;});

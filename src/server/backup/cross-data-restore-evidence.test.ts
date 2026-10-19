/**
 * Offline-only synthetic Recovery Evidence: crypto/integrity are necessary but
 * do NOT imply cross-database or source-archive referential consistency.
 * Never run against a real Investment_OS Vault, Railway or external Drive.
 */
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import Database from "better-sqlite3";
import {SnapshotWriterFence} from "./writer-fence";
import {withCoordinatedOfflineFixtureCut} from "./offline-snapshot-cut";

const railway=[
  "RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID","RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_ENVIRONMENT_NAME","RAILWAY_PROJECT_NAME","RAILWAY_SERVICE_NAME",
];
const passphrase="offline-linked-evidence-fixture-not-a-secret-2026";
const backupScript=path.resolve("scripts/backup/nm-backup.mjs");
const original=Buffer.from("%PDF-1.7\nsynthetic source archive; nothing from Investment_OS\n%%EOF\n");
let dataDir:string,gateDir:string,outputDir:string;
const digest=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");

function cli(args:string[]) {
  const env:NodeJS.ProcessEnv={
    ...process.env,
    NOTEMESH_BACKUP_PASSPHRASE:passphrase,
    ...Object.fromEntries(railway.map(k=>[k,""])),
  };
  // Never point a backup subprocess at the test coordinator's source volume.
  // The CLI receives only an explicit fixture-only --data-dir argument.
  delete env.DATA_DIR;
  return JSON.parse(execFileSync(process.execPath,[backupScript,...args],{
    encoding:"utf8",timeout:120_000,maxBuffer:1024*1024,env,
  }).trim()) as Record<string,unknown>;
}

/** The two individually valid SQLite DBs intentionally have a related epoch. */
function syntheticLinkedDataset({
  appEpoch=17,priceEpoch=17,sourceHash=digest(original),
}:{
  appEpoch?:number;priceEpoch?:number;sourceHash?:string;
}={}) {
  for(const rel of ["vault/05_Thesis","source-archive","home","market-prices"])
    fs.mkdirSync(path.join(dataDir,rel),{recursive:true});
  fs.writeFileSync(path.join(dataDir,"source-archive","synthetic-original.pdf"),original);
  fs.writeFileSync(path.join(dataDir,"vault","05_Thesis","FIXTURE.md"),
    "# Synthetic linked fixture\n"+
    "epoch: "+appEpoch+"\n"+
    "original_sha256: "+sourceHash+"\n");
  fs.writeFileSync(path.join(dataDir,"home","fixture-state.json"),JSON.stringify({kind:"offline-only"}));
  const app=new Database(path.join(dataDir,"app.sqlite"));
  const price=new Database(path.join(dataDir,"market-prices","prices.sqlite"));
  try {
    app.pragma("journal_mode = WAL");
    price.pragma("journal_mode = WAL");
    app.exec("CREATE TABLE evidence (generation INTEGER NOT NULL, original_hash TEXT NOT NULL)");
    price.exec("CREATE TABLE correlated_prices (generation INTEGER NOT NULL, instrument TEXT NOT NULL, value INTEGER NOT NULL)");
    app.prepare("INSERT INTO evidence VALUES(?,?)").run(appEpoch,sourceHash);
    price.prepare("INSERT INTO correlated_prices VALUES(?,?,?)").run(priceEpoch,"SYNTH",42);
    // This tests post-quiescence data only. Closing/checkpointing the fixture
    // prevents SQLite metadata churn during source fingerprint comparison.
    app.pragma("journal_mode = DELETE");
    price.pragma("journal_mode = DELETE");
  } finally { app.close();price.close(); }
}

function verifyIndependentRestore(root:string) {
  const app=new Database(path.join(root,"app.sqlite"),{readonly:true,fileMustExist:true});
  const price=new Database(path.join(root,"market-prices","prices.sqlite"),{readonly:true,fileMustExist:true});
  try {
    if(app.pragma("integrity_check",{simple:true})!=="ok" ||
       price.pragma("integrity_check",{simple:true})!=="ok")
      throw Error("dr_fixture_sqlite_integrity_failed");
    const a=app.prepare("SELECT generation,original_hash FROM evidence").get() as
      {generation:number;original_hash:string}|undefined;
    const p=price.prepare("SELECT generation,instrument,value FROM correlated_prices").get() as
      {generation:number;instrument:string;value:number}|undefined;
    if(!a || !p || a.generation!==p.generation)
      throw Error("dr_fixture_cross_db_epoch_mismatch");
    const actualSource=fs.readFileSync(path.join(root,"source-archive","synthetic-original.pdf"));
    if(a.original_hash!==digest(actualSource))
      throw Error("dr_fixture_original_source_hash_mismatch");
    const note=fs.readFileSync(path.join(root,"vault","05_Thesis","FIXTURE.md"),"utf8");
    if(note!== "# Synthetic linked fixture\n"+
       "epoch: "+a.generation+"\n"+
       "original_sha256: "+a.original_hash+"\n")
      throw Error("dr_fixture_note_to_source_link_mismatch");
    if(fs.readFileSync(path.join(root,"home","fixture-state.json"),"utf8")!==
       JSON.stringify({kind:"offline-only"}))
      throw Error("dr_fixture_home_content_mismatch");
    if(fs.existsSync(path.join(root,".notemesh-fixture-exclusive")))
      throw Error("dr_fixture_lock_metadata_leaked");
    return {epoch:a.generation,verifiedOriginalHash:a.original_hash,quote:p.value,
      sqliteIntegrity:"ok" as const};
  } finally {app.close();price.close();}
}

async function encryptedRoundtrip() {
  let paused=false;
  const sync={
    async withPausedForEdit<T>(fn:()=>Promise<T>|T):Promise<T>{
      paused=true;
      try{return await fn();}
      finally{paused=false;}
    },
  };
  const evidence=await withCoordinatedOfflineFixtureCut({
    fence:new SnapshotWriterFence(),sync,assertNoExternalWriters:()=>true,
    capture:()=>{
      expect(paused).toBe(true);
      expect(fs.existsSync(path.join(gateDir,".notemesh-fixture-exclusive"))).toBe(true);
      return cli(["create","--fixture-only","--kind","fixture",
        "--data-dir",dataDir,"--out",path.join(outputDir,"encrypted")]);
    },
  });
  expect(paused).toBe(false);
  expect(fs.existsSync(path.join(gateDir,".notemesh-fixture-exclusive"))).toBe(false);
  const bundle=evidence.bundle as string;
  expect(bundle).toMatch(/\.nmb$/);
  expect(cli(["verify","--bundle",bundle]).verified).toBe(true);
  const restored=path.join(outputDir,"isolated-recovery");
  const receipt=cli(["restore","--bundle",bundle,"--dest",restored]);
  expect(receipt.verified).toBe(true);
  return restored;
}

beforeEach(()=>{
  dataDir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-snapshot-fixture-")));
  const suffix=path.basename(dataDir).slice("nm-dr-snapshot-fixture-".length);
  gateDir=path.join(fs.realpathSync(os.tmpdir()),"nm-dr-ipc-fixture-"+suffix);
  outputDir=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-linked-recovery-"));
  fs.mkdirSync(gateDir,{mode:0o700});
  vi.stubEnv("DATA_DIR",dataDir);
  for(const key of railway)vi.stubEnv(key,"");
});
afterEach(()=>{
  vi.unstubAllEnvs();
  for(const directory of [dataDir,gateDir,outputDir])
    fs.rmSync(directory,{recursive:true,force:true});
});

it("coordinated cut restores TWO SQLite databases, source bytes, linked note and sync home coherently",async()=>{
  syntheticLinkedDataset();
  const restored=await encryptedRoundtrip();
  expect(verifyIndependentRestore(restored)).toEqual({
    epoch:17,verifiedOriginalHash:digest(original),quote:42,sqliteIntegrity:"ok",
  });
  expect(fs.readFileSync(path.join(restored,"source-archive","synthetic-original.pdf")))
    .toEqual(original);
  expect(fs.existsSync(path.join(restored,"market-prices","prices.sqlite"))).toBe(true);
});

it("crypto-verifiable archive with individually valid DBs can conceal a CROSS-DB split generation",async()=>{
  syntheticLinkedDataset({appEpoch:17,priceEpoch:18});
  const restored=await encryptedRoundtrip();
  // Transport/manifest/SQLite checks all succeeded. A semantic, *independent*
  // cross-DB validation is required to detect the inconsistency.
  expect(()=>verifyIndependentRestore(restored))
    .toThrow("dr_fixture_cross_db_epoch_mismatch");
});

it("crypto-verifiable archive can conceal ORIGINAL-SOURCE reference corruption",async()=>{
  syntheticLinkedDataset({sourceHash:digest(Buffer.from("not the archived source"))});
  const restored=await encryptedRoundtrip();
  expect(()=>verifyIndependentRestore(restored))
    .toThrow("dr_fixture_original_source_hash_mismatch");
});

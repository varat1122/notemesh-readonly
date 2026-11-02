import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {DatabaseSync} from "node:sqlite";
import {drill} from "./nm-dr-drill.mjs";

test("offline fixture DR drill verifies all file SHA, empty dirs and SQLite schema/rows",async()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"notemesh-dr-drill-test-"));
  const source=path.join(base,"fixture");fs.mkdirSync(source);
  for(const dir of ["vault/05_Thesis","vault/Empty","home","source-archive","market-prices"])
    fs.mkdirSync(path.join(source,dir),{recursive:true});
  fs.writeFileSync(path.join(source,"vault/05_Thesis/NVDA.md"),"# NVDA Thesis");
  fs.writeFileSync(path.join(source,"home/login.json"),"sensitive fake token");
  fs.writeFileSync(path.join(source,"source-archive/original.pdf"),Buffer.from("%PDF-1.7 fake fixture"));
  const old=process.env.NOTEMESH_BACKUP_PASSPHRASE;
  const key="fixture-drill-test-passphrase-123456789012345";
  process.env.NOTEMESH_BACKUP_PASSPHRASE=key;
  const app=new DatabaseSync(path.join(source,"app.sqlite"));
  const market=new DatabaseSync(path.join(source,"market-prices/prices.sqlite"));
  try{
    app.exec("PRAGMA journal_mode=WAL;CREATE TABLE claim(id INTEGER PRIMARY KEY,evidence TEXT);INSERT INTO claim(evidence) VALUES('original')");
    market.exec("PRAGMA journal_mode=WAL;CREATE TABLE bars(ticker TEXT,close REAL);INSERT INTO bars VALUES('NVDA',157.6)");
    const result=await drill(source);
    assert.equal(result.passed,true);
    assert.equal(result.verifiedFiles,5);
    assert.equal(result.verifiedDirectories,6);
    assert.equal(result.verifiedDatabases,2);
    assert.equal(result.verifiedTables,2);
    assert.equal(result.verifiedRows,2);
    assert.equal(result.googleDriveReadbackTested,false);
    assert.equal(result.productionSnapshotTested,false);
    assert.equal(JSON.stringify(result).includes("sensitive fake token"),false);
    assert.equal(JSON.stringify(result).includes("NVDA Thesis"),false);
  }finally{
    app.close();market.close();
    if(old===undefined)delete process.env.NOTEMESH_BACKUP_PASSPHRASE;
    else process.env.NOTEMESH_BACKUP_PASSPHRASE=old;
    fs.rmSync(base,{recursive:true,force:true});
  }
});
test("offline drill refuses active/deployed source roots and missing key",async()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"notemesh-dr-drill-refuse-"));
  const origData=process.env.DATA_DIR,origPass=process.env.NOTEMESH_BACKUP_PASSPHRASE;
  try{
    process.env.DATA_DIR=base;
    process.env.NOTEMESH_BACKUP_PASSPHRASE="long-test-fixture-key-for-refusal-12345";
    await assert.rejects(()=>drill(base),/refuses_production_root/);
    delete process.env.DATA_DIR;
    delete process.env.NOTEMESH_BACKUP_PASSPHRASE;
    await assert.rejects(()=>drill(base),/requires_secure_passphrase/);
  }finally{
    if(origData===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=origData;
    if(origPass===undefined)delete process.env.NOTEMESH_BACKUP_PASSPHRASE;
    else process.env.NOTEMESH_BACKUP_PASSPHRASE=origPass;
    fs.rmSync(base,{recursive:true,force:true});
  }
});

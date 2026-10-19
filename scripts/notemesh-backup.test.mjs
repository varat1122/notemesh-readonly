import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {createSnapshot,verifySnapshot} from "./notemesh-backup.mjs";

test("encrypted backup: SQLite WAL + Vault + archive bytes, restore test, tamper and no overwrite",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nmbk-test-"));
  const data=path.join(root,"data"),vault=path.join(data,"vault");
  const target=path.join(root,"encrypted.nmbk"),key=crypto.randomBytes(32),wrong=crypto.randomBytes(32);
  fs.mkdirSync(vault,{recursive:true});
  fs.mkdirSync(path.join(data,"source-archive","blobs"),{recursive:true});
  fs.writeFileSync(path.join(vault,"บริษัท-ทดสอบ.md"),"ภาษาไทย 🚀 original source\n");
  fs.writeFileSync(path.join(data,"source-archive","blobs","source.bin"),crypto.randomBytes(51));
  fs.writeFileSync(path.join(data,"market-prices.db"),"not really SQLite, preserve byte-for-byte");
  const live=new DatabaseSync(path.join(data,"app.sqlite"));
  const prior=process.env.NM_BACKUP_SOURCE_QUIESCED;
  try{
    live.exec("PRAGMA journal_mode=WAL; CREATE TABLE receipts(id TEXT PRIMARY KEY,value TEXT)");
    live.prepare("INSERT INTO receipts VALUES (?,?)").run("IN-DEMO","record survives WAL-safe backup");
    delete process.env.NM_BACKUP_SOURCE_QUIESCED;
    await assert.rejects(createSnapshot(data,target,key),/SOURCE_QUIESCED/);
    assert.equal(fs.existsSync(target),false);
    process.env.NM_BACKUP_SOURCE_QUIESCED="1";
    const snapshot=await createSnapshot(data,target,key);
    assert.equal(snapshot.status,"verified_encrypted_local_snapshot_not_uploaded");
    assert.equal(snapshot.files>=4,true);
    assert.match(snapshot.sha256,/^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(target).includes(Buffer.from("ภาษาไทย")),false);
    const verified=await verifySnapshot(target,key);
    assert.equal(verified.files,snapshot.files);
    assert.equal(verified.manifestSha256,snapshot.manifestSha256);
    await assert.rejects(verifySnapshot(target,wrong),/authenticate|Unsupported state|bad decrypt/i);
    await assert.rejects(createSnapshot(data,target,key),/filename exists/);
    const buf=fs.readFileSync(target);
    buf[buf.length-1]^=1;
    fs.writeFileSync(target,buf);
    await assert.rejects(verifySnapshot(target,key),/authenticate|Unsupported state|bad decrypt/i);
  }finally{
    live.close();
    if(prior===undefined)delete process.env.NM_BACKUP_SOURCE_QUIESCED;
    else process.env.NM_BACKUP_SOURCE_QUIESCED=prior;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
test("backup refuses source symlinks and source-contained destination",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nmbk-test-"));
  const data=path.join(root,"data"),vault=path.join(data,"vault"),key=crypto.randomBytes(32);
  fs.mkdirSync(vault,{recursive:true});
  const source=new DatabaseSync(path.join(data,"app.sqlite"));source.close();
  fs.symlinkSync(os.tmpdir(),path.join(vault,"external"));
  const prior=process.env.NM_BACKUP_SOURCE_QUIESCED;
  process.env.NM_BACKUP_SOURCE_QUIESCED="1";
  try{
    await assert.rejects(createSnapshot(data,path.join(data,"bad.nmbk"),key),/OUTSIDE live/);
    await assert.rejects(createSnapshot(data,path.join(root,"other.nmbk"),key),/symlink/);
  }finally{
    if(prior===undefined)delete process.env.NM_BACKUP_SOURCE_QUIESCED;
    else process.env.NM_BACKUP_SOURCE_QUIESCED=prior;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

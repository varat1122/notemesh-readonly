import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const tool = new URL("./nm-backup.mjs",import.meta.url).pathname;
const env = {...process.env, NOTEMESH_BACKUP_PASSPHRASE:"fixture-test-key-012345678901234567890123456789"};
function command(parts, options={}) {
  return execFileSync(process.execPath,[tool,...parts],{encoding:"utf8",env,...options});
}
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-test-"));
  const data=path.join(root,"data"),out=path.join(root,"bundles");
  fs.mkdirSync(path.join(data,"vault","05_Thesis"),{recursive:true});
  fs.mkdirSync(path.join(data,"home"),{recursive:true});
  fs.writeFileSync(path.join(data,"vault","05_Thesis","NVDA.md"),"# Thesis\nทดสอบ");
  fs.writeFileSync(path.join(data,"home","auth.conf"),"fixture secret in encrypted bundle");
  fs.mkdirSync(path.join(data,"market-prices"),{recursive:true});
  const prices=new DatabaseSync(path.join(data,"market-prices","prices.sqlite"));
  prices.exec("PRAGMA journal_mode=WAL; CREATE TABLE bars (ticker TEXT, close REAL); INSERT INTO bars VALUES ('NVDA', 100.25);");
  const db=new DatabaseSync(path.join(data,"app.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE claims (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO claims(value) VALUES ('committed wal');");
  return Promise.resolve().then(()=>fn({root,data,out,db,prices})).finally(()=>{db.close();prices.close();fs.rmSync(root,{recursive:true,force:true});});
}
test("encrypted fixture snapshot, SHA readback, SQLite WAL recovery and non-destructive restore",()=>fixture(async ({root,data,out,db})=>{
  const created=JSON.parse(command(["create","--data-dir",data,"--out",out,"--kind","fixture","--fixture-only"]));
  assert.equal(created.kind,"fixture");
  assert.equal(created.verified,false);
  assert.ok(fs.existsSync(created.bundle));
  const plain=fs.readFileSync(created.bundle);
  assert.equal(plain.subarray(0,5).toString(),"NMDR1");
  assert.equal(plain.includes(Buffer.from("fixture secret")),false);
  assert.equal(plain.includes(Buffer.from("# Thesis")),false);
  const checked=JSON.parse(command(["verify","--bundle",created.bundle]));
  assert.equal(checked.verified,true);
  assert.equal(checked.files,4);
  const target=path.join(root,"restored");
  const restored=JSON.parse(command(["restore","--bundle",created.bundle,"--dest",target]));
  assert.equal(restored.restored,true);
  assert.equal(fs.readFileSync(path.join(target,"vault","05_Thesis","NVDA.md"),"utf8"),"# Thesis\nทดสอบ");
  const d=new DatabaseSync(path.join(target,"app.sqlite"),{readOnly:true});
  assert.equal(d.prepare("SELECT value FROM claims").get().value,"committed wal");
  d.close();
  const p=new DatabaseSync(path.join(target,"market-prices","prices.sqlite"),{readOnly:true});
  assert.equal(p.prepare("SELECT close FROM bars WHERE ticker='NVDA'").get().close,100.25);
  p.close();
  assert.throws(()=>command(["restore","--bundle",created.bundle,"--dest",target]),/Restore destination must be empty/);
  // A later committed transaction is not silently added to the original snapshot.
  db.exec("INSERT INTO claims(value) VALUES ('later')");
  assert.equal(new DatabaseSync(path.join(target,"app.sqlite"),{readOnly:true}).prepare("SELECT count(*) as n FROM claims").get().n,1);
}));
test("tampered ciphertext and wrong key fail authenticated verification",()=>fixture(async ({data,out})=>{
  const {bundle}=JSON.parse(command(["create","--data-dir",data,"--out",out,"--fixture-only"]));
  const broken=fs.readFileSync(bundle);broken[40]^=1;
  const altered=path.join(out,"tampered.nmb");fs.writeFileSync(altered,broken);
  const a=spawnSync(process.execPath,[tool,"verify","--bundle",altered],{env,encoding:"utf8"});
  assert.notEqual(a.status,0);assert.equal(a.stdout.includes('"verified":true'),false);
  const b=spawnSync(process.execPath,[tool,"verify","--bundle",bundle],{env:{...env,NOTEMESH_BACKUP_PASSPHRASE:"another-different-very-long-key-1234567890"},encoding:"utf8"});
  assert.notEqual(b.status,0);
}));
test("unsafe source types, overlapping paths, and missing offline acknowledgement refused",()=>fixture(async ({data,out})=>{
  const noGate=spawnSync(process.execPath,[tool,"create","--data-dir",data,"--out",out],{env,encoding:"utf8"});
  assert.notEqual(noGate.status,0);
  const overlapping=spawnSync(process.execPath,[tool,"create","--data-dir",data,"--out",path.join(data,"backup"),"--fixture-only"],{env,encoding:"utf8"});
  assert.notEqual(overlapping.status,0);
  fs.symlinkSync("/etc/passwd",path.join(data,"vault","badlink"));
  const symlink=spawnSync(process.execPath,[tool,"create","--data-dir",data,"--out",out,"--fixture-only"],{env,encoding:"utf8"});
  assert.notEqual(symlink.status,0);
}));

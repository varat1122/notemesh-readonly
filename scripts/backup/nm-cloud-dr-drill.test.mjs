/**
 * Entire real .nmb protocol through a MOCK Google transport, independently
 * downloaded and restored. OFFLINE FIXTURE ONLY; zero Google/network/Railway.
 * A stronger integration check than a mock NMDR1 magic-header upload, but
 * NOT evidence of consistent live production snapshots or Drive availability.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { uploadVerifiedBundle } from "./nm-drive-upload.mjs";

const backupScript = new URL("./nm-backup.mjs", import.meta.url).pathname;
const passphrase = "offline-fixture-only-not-a-real-secret-0123456789";
const isolatedEnv = () => ({
  ...process.env,
  NOTEMESH_BACKUP_PASSPHRASE: passphrase,
  // A deployed service is never a valid environment for this test.
  RAILWAY_ENVIRONMENT_ID: "",
});

function cli(args) {
  return JSON.parse(execFileSync(process.execPath,[backupScript,...args],
    {encoding:"utf8",env:isolatedEnv(),timeout:120000,maxBuffer:1024*1024}).trim());
}
function fakeVault(root) {
  const data=path.join(root,"isolated-fixture");
  for(const rel of ["vault/05_Thesis","vault/Empty","home","source-archive","market-prices"])
    fs.mkdirSync(path.join(data,rel),{recursive:true});
  fs.writeFileSync(path.join(data,"vault/05_Thesis/FIXTURE.md"),
    "# Synthetic thesis\nOnly fake data.\n");
  fs.writeFileSync(path.join(data,"home/ob-state.json"),'{"fake":true,"token":"not-a-real-secret"}');
  fs.writeFileSync(path.join(data,"source-archive/mock.pdf"),Buffer.from("%PDF-1.7 fixture"));
  const db=new DatabaseSync(path.join(data,"app.sqlite"));
  const prices=new DatabaseSync(path.join(data,"market-prices/prices.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE claims(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO claims(note) VALUES('fixture');");
  prices.exec("PRAGMA journal_mode=WAL; CREATE TABLE quotes(ticker TEXT, value INTEGER); INSERT INTO quotes VALUES('TEST',42);");
  return {data,db,prices};
}
function fakeGoogleDrive(parentId, {corruptReadback=false}={}) {
  const id="offline_fixture_blob_0123456";
  let metadata,bytes=null;
  const requests=[];
  async function fetcher(url, options={}) {
    requests.push({url,method:options.method??"GET"});
    assert.equal(new URL(url).origin,"https://www.googleapis.com");
    assert.equal(options.headers.Authorization,"Bearer offline-fixture-access-token");
    if(url.includes("uploadType=resumable")) {
      assert.equal(options.method,"POST");
      metadata=JSON.parse(options.body);
      assert.deepEqual(metadata.parents,[parentId]);
      assert.equal(metadata.appProperties.kind,"notemesh-dr-v1");
      return new Response(null,{status:200,
        headers:{location:"https://www.googleapis.com/upload/drive/v3/files?upload_id=offline-fixture"}});
    }
    if(url.includes("upload_id=offline-fixture")) {
      assert.equal(options.method,"PUT");
      bytes=Buffer.from(options.body);
      assert.equal(options.headers["Content-Range"],"bytes 0-"+(bytes.length-1)+"/"+bytes.length);
      assert.equal(createHash("sha256").update(bytes).digest("hex"),metadata.appProperties.sha256);
      return Response.json({id});
    }
    if(url.includes("?alt=media")) {
      assert.ok(bytes,"No uploaded ciphertext");
      const sent=Buffer.from(bytes);
      if(corruptReadback)sent[sent.length-24]^=1;
      return new Response(new Uint8Array(sent),{status:200});
    }
    if(url.includes("/drive/v3/files/")) {
      assert.ok(bytes,"No uploaded ciphertext");
      return Response.json({id,name:metadata.name,size:String(bytes.length),
        parents:[parentId],appProperties:metadata.appProperties});
    }
    throw Error("Unexpected Google Drive request");
  }
  return {fetcher,requests,uploadedBytes:()=>bytes};
}
function assertRestored(dest) {
  assert.equal(fs.readFileSync(path.join(dest,"vault/05_Thesis/FIXTURE.md"),"utf8"),
    "# Synthetic thesis\nOnly fake data.\n");
  assert.equal(fs.readFileSync(path.join(dest,"home/ob-state.json"),"utf8"),
    '{"fake":true,"token":"not-a-real-secret"}');
  assert.equal(fs.readFileSync(path.join(dest,"source-archive/mock.pdf"),"utf8"),"%PDF-1.7 fixture");
  assert.ok(fs.statSync(path.join(dest,"vault/Empty")).isDirectory());
  const db=new DatabaseSync(path.join(dest,"app.sqlite"),{readOnly:true});
  const prices=new DatabaseSync(path.join(dest,"market-prices/prices.sqlite"),{readOnly:true});
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.equal(prices.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.deepEqual(db.prepare("SELECT id,note FROM claims").all().map(row=>({...row})),[{id:1,note:"fixture"}]);
    assert.deepEqual(prices.prepare("SELECT ticker,value FROM quotes").all().map(row=>({...row})),[{ticker:"TEST",value:42}]);
  } finally {db.close();prices.close();}
}
test("full isolated fixture backup -> mock Drive upload/readback -> independent restore",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-full-cloud-fixture-"));
  const {data,db,prices}=fakeVault(root);
  try {
    const bundleDir=path.join(root,"encrypted-bundle");
    const created=cli(["create","--data-dir",data,"--out",bundleDir,"--kind","fixture","--fixture-only"]);
    assert.ok(created.bundle.endsWith(".nmb"));
    assert.equal(cli(["verify","--bundle",created.bundle]).verified,true);
    const folderId="fixture_app_owned_folder_id_012345678";
    const google=fakeGoogleDrive(folderId);
    const result=await uploadVerifiedBundle({
      bundle:created.bundle,folderId,accessToken:"offline-fixture-access-token",
      fetcher:google.fetcher,
    });
    assert.equal(result.verified,true);
    assert.equal(result.uploadedToDrive,true);
    assert.equal(result.readbackBytes,result.size);
    assert.deepEqual(google.requests.map(x=>x.method),["POST","PUT","GET","GET"]);
    const cloudBytes=google.uploadedBytes();
    assert.ok(cloudBytes);
    assert.equal(cloudBytes.subarray(0,5).toString(),"NMDR1");
    assert.equal(cloudBytes.includes(Buffer.from("Synthetic thesis")),false);
    assert.equal(cloudBytes.includes(Buffer.from("not-a-real-secret")),false);

    // Restore from a *new* bundle copy representing separately downloaded
    // cloud ciphertext, never from the original local backup.
    const downloaded=path.join(root,"independent-download.nmb");
    fs.writeFileSync(downloaded,cloudBytes,{flag:"wx",mode:0o600});
    assert.equal(cli(["verify","--bundle",downloaded]).verified,true);
    const restored=path.join(root,"isolated-restore");
    const receipt=cli(["restore","--bundle",downloaded,"--dest",restored]);
    assert.equal(receipt.restored,true);
    assertRestored(restored);
    const second=spawnSync(process.execPath,[backupScript,"restore","--bundle",downloaded,
      "--dest",restored],{env:isolatedEnv(),encoding:"utf8"});
    assert.notEqual(second.status,0,"Never overwrite an existing recovery target");
  } finally { db.close();prices.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test("tampered Google ciphertext is never given a verified receipt",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-cloud-corrupt-fixture-"));
  const {data,db,prices}=fakeVault(root);
  try {
    const created=cli(["create","--data-dir",data,"--out",path.join(root,"encrypted"),
      "--kind","fixture","--fixture-only"]);
    const cloud=fakeGoogleDrive("fixture_app_owned_folder_id_012345678",{corruptReadback:true});
    await assert.rejects(uploadVerifiedBundle({bundle:created.bundle,
      folderId:"fixture_app_owned_folder_id_012345678",
      accessToken:"offline-fixture-access-token",fetcher:cloud.fetcher
    }),/SHA-256 mismatch/);
    assert.equal(fs.existsSync(path.join(root,"isolated-restore")),false);
  } finally {db.close();prices.close();fs.rmSync(root,{recursive:true,force:true});}
});

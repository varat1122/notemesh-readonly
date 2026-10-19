import {test} from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {recoverVerifiedBundle,validateUploadReceipt} from "./nm-drive-recover.mjs";

const sha256=b=>createHash("sha256").update(b).digest("hex");
const fileId="recovery_mock_drive_0123456";
const folderId="recovery_mock_folder_12345";
const name="notemesh-fixture-2026-10-19-example.nmb";
function fixture(bytes) {
  return {verified:true,uploadedToDrive:true,fileId,folderId,name,
    size:bytes.length,readbackBytes:bytes.length,sha256:sha256(bytes)};
}
function remote(bytes,receipt,{corrupt=false,badFolder=false,badHash=false}={}) {
  const phases=[];
  const fetcher=async (url,opts)=>{
    assert.equal(opts.redirect,"error");
    assert.equal(opts.headers.Authorization,"Bearer fixture-short-lived");
    assert.ok(url.startsWith("https://www.googleapis.com/drive/v3/files/"));
    if(url.includes("alt=media")) {
      phases.push("media");
      return new Response(corrupt?Buffer.alloc(bytes.length,99):bytes,{status:200});
    }
    phases.push("metadata");
    return new Response(JSON.stringify({id:receipt.fileId,name:receipt.name,
      size:String(bytes.length),parents:[badFolder?"wrong_folder_987654":folderId],
      appProperties:{kind:"notemesh-dr-v1",sha256:badHash?"a".repeat(64):receipt.sha256}}),{
      status:200,headers:{"content-type":"application/json"}});
  };
  return {fetcher,phases};
}
async function inScratch(fn) {
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),"nm-drive-recover-test-"));
  try{return await fn(root);} finally{await fsp.rm(root,{recursive:true,force:true});}
}

test("offline recovery re-downloads ciphertext and verifies Drive metadata and full SHA-256",()=>inScratch(async root=>{
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(200,19)]);
  const receipt=fixture(bytes),server=remote(bytes,receipt);
  const result=await recoverVerifiedBundle({
    receipt,outDir:root,accessToken:"fixture-short-lived",fetcher:server.fetcher
  });
  assert.deepEqual(server.phases,["metadata","media"]);
  assert.equal(result.downloaded,true);
  assert.equal(result.cryptographicBundleVerified,false);
  assert.equal(result.productionRecoveryVerified,false);
  assert.equal(result.sha256,receipt.sha256);
  assert.deepEqual(await fsp.readFile(result.localPath),bytes);
}));

test("corrupted Drive readback cannot yield a trusted or partial local bundle",()=>inScratch(async root=>{
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(150,18)]);
  const receipt=fixture(bytes),server=remote(bytes,receipt,{corrupt:true});
  await assert.rejects(recoverVerifiedBundle({
    receipt,outDir:root,accessToken:"fixture-short-lived",fetcher:server.fetcher
  }),/SHA-256 mismatch/);
  assert.deepEqual(await fsp.readdir(root),[]);
}));

test("wrong Drive folder or remote hash refuses before creating any file",()=>inScratch(async root=>{
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(150,17)]);
  const receipt=fixture(bytes);
  for(const config of [{badFolder:true},{badHash:true}]) {
    const server=remote(bytes,receipt,config);
    await assert.rejects(recoverVerifiedBundle({
      receipt,outDir:root,accessToken:"fixture-short-lived",fetcher:server.fetcher
    }),/metadata mismatches/);
    assert.deepEqual(server.phases,["metadata"]);
    assert.deepEqual(await fsp.readdir(root),[]);
  }
}));

test("existing output is never overwritten, including pre-existing symlink",()=>inScratch(async root=>{
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(100,4)]);
  const receipt=fixture(bytes),target=path.join(root,name);
  await fsp.writeFile(target,"keep my prior file");
  await assert.rejects(recoverVerifiedBundle({
    receipt,outDir:root,accessToken:"fixture-short-lived",fetcher:remote(bytes,receipt).fetcher
  }),/EEXIST/);
  assert.equal(await fsp.readFile(target,"utf8"),"keep my prior file");
  await fsp.unlink(target);
  const outside=path.join(os.tmpdir(),"should-not-overwrite");
  await fsp.symlink(outside,target);
  await assert.rejects(recoverVerifiedBundle({
    receipt,outDir:root,accessToken:"fixture-short-lived",fetcher:remote(bytes,receipt).fetcher
  }),/EEXIST/);
  assert.equal((await fsp.lstat(target)).isSymbolicLink(),true);
}));

test("rejects Railway runtime, symlinked output directories and DATA_DIR",()=>inScratch(async root=>{
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(99)]);
  const receipt=fixture(bytes),fetcher=remote(bytes,receipt).fetcher;
  const previous=process.env.RAILWAY_ENVIRONMENT_ID;
  try {
    process.env.RAILWAY_ENVIRONMENT_ID="fixture-must-refuse";
    await assert.rejects(recoverVerifiedBundle({
      receipt,outDir:root,accessToken:"fixture-short-lived",fetcher
    }),/refuses_railway/);
  }finally{
    if(previous===undefined)delete process.env.RAILWAY_ENVIRONMENT_ID;
    else process.env.RAILWAY_ENVIRONMENT_ID=previous;
  }
  const aliased=path.join(root,"alias");
  await fsp.symlink(root,aliased);
  await assert.rejects(recoverVerifiedBundle({
    receipt,outDir:aliased,accessToken:"fixture-short-lived",fetcher
  }),/symlinked recovery output/);
  const oldData=process.env.DATA_DIR;
  try {
    process.env.DATA_DIR=root;
    await assert.rejects(recoverVerifiedBundle({
      receipt,outDir:root,accessToken:"fixture-short-lived",fetcher
    }),/overlaps deployed or configured/);
  }finally{
    if(oldData===undefined)delete process.env.DATA_DIR;
    else process.env.DATA_DIR=oldData;
  }
}));

test("rejects fabricated/unverified upload receipts before any network request",async()=>{
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(70)]);
  const correct=fixture(bytes);
  for(const bad of [
    {...correct,verified:false},{...correct,uploadedToDrive:false},
    {...correct,readbackBytes:1},{...correct,name:"../exfil.nmb"},
    {...correct,fileId:"/?bad"},{...correct,sha256:"wrong"}
  ])assert.throws(()=>validateUploadReceipt(bad),/Invalid or unverified/);
});

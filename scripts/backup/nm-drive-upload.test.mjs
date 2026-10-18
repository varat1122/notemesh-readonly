import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {uploadVerifiedBundle,refreshAccessToken} from "./nm-drive-upload.mjs";
import {openStoredDrCredential} from "./nm-drive-credential.mjs";
import {randomBytes,createCipheriv,hkdfSync} from "node:crypto";

test("Drive uploader sends encrypted bytes and verifies full download hash (mock transport)",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"nm-upload-fixture-"));
  const name="notemesh-fixture-2026-10-18-mock.nmb",bundle=path.join(temp,name);
  const bytes=Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(150,17)]);
  fs.writeFileSync(bundle,bytes);
  const folderId="1UcwzEvoisX0Crocwnm7HYiCeqNyDBiUe";
  let bodyMeta,id="mock_file_123",phase=[];
  const mock=async (url,options)=>{
    if(url.includes("uploadType=resumable")) {
      phase.push("init");bodyMeta=JSON.parse(options.body);
      return new Response(null,{status:200,headers:{location:"https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture"}});
    }
    if(url.includes("upload_id=fixture")) {
      phase.push("upload");
      assert.equal(options.headers["Content-Range"],"bytes 0-"+(bytes.length-1)+"/"+bytes.length);
      assert.deepEqual(Buffer.from(options.body),bytes);
      return new Response(JSON.stringify({id}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url.includes("alt=media")) {phase.push("readback");return new Response(bytes,{status:200});}
    if(url.includes("/drive/v3/files/")) {
      phase.push("metadata");
      return new Response(JSON.stringify({id,name,size:String(bytes.length),parents:[folderId],
        appProperties:bodyMeta.appProperties}),{status:200});
    }
    throw Error("Unexpected request URL");
  };
  try {
    const result=await uploadVerifiedBundle({bundle,folderId,accessToken:"mock-token",fetcher:mock});
    assert.deepEqual(phase,["init","upload","metadata","readback"]);
    assert.equal(result.verified,true);
    assert.equal(result.readbackBytes,bytes.length);
    assert.equal(result.fileId,id);
  } finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test("Drive uploader refuses ciphertext mismatch on readback, no verified receipt",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nm-upload-mismatch-"));
  const bundle=path.join(dir,"notemesh-fixture-test.nmb");
  fs.writeFileSync(bundle,Buffer.concat([Buffer.from("NMDR1"),Buffer.alloc(80)]));
  const folderId="1UcwzEvoisX0Crocwnm7HYiCeqNyDBiUe";
  let meta;
  const mock=async(url,o)=>{
    if(url.includes("uploadType=resumable")){meta=JSON.parse(o.body);return new Response(null,{status:200,headers:{location:"https://www.googleapis.com/upload/drive/v3/files?upload_id=x"}});}
    if(url.includes("upload_id=x"))return new Response('{"id":"file_x"}',{status:200});
    if(url.includes("alt=media"))return new Response(Buffer.alloc(85,1),{status:200});
    return new Response(JSON.stringify({id:"file_x",name:"notemesh-fixture-test.nmb",size:"85",parents:[folderId],appProperties:meta.appProperties}),{status:200});
  };
  try {await assert.rejects(uploadVerifiedBundle({bundle,folderId,accessToken:"mock",fetcher:mock}),/SHA-256 mismatch/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});

function encryptedTestCredential(clientId,refreshToken,key) {
  const iv=randomBytes(12);
  const derived=Buffer.from(hkdfSync("sha256",Buffer.from(key,"hex"),
    "investment-os-notemesh-dr","investment-os-notemesh-dr/oauth-v1",32));
  const cipher=createCipheriv("aes-256-gcm",derived,iv);
  const plaintext=JSON.stringify({version:1,clientId,scope:"https://www.googleapis.com/auth/drive.file",refreshToken});
  const bytes=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);
  return [iv,bytes,cipher.getAuthTag()].map(b=>b.toString("base64url")).join(".");
}
test("DR uploader decrypts only sealed, client-matched credentials; never needs a plaintext refresh-token env",async()=>{
  const old={...process.env};
  const id="fixture-backup.apps.googleusercontent.com",key="a1".repeat(32);
  try {
    process.env.ENCRYPTION_KEY=key;
    process.env.NOTEMESH_DRIVE_CLIENT_ID=id;
    process.env.NOTEMESH_DRIVE_CLIENT_SECRET="dedicated-test-client-secret";
    process.env.NOTEMESH_DRIVE_CREDENTIAL=encryptedTestCredential(id,"fixture-refresh-token-1234",key);
    delete process.env.NOTEMESH_DRIVE_REFRESH_TOKEN;
    assert.equal(openStoredDrCredential().refreshToken,"fixture-refresh-token-1234");
    let received=false;
    const mock=async(url,o)=>{
      assert.equal(url,"https://oauth2.googleapis.com/token");
      const body=new URLSearchParams(o.body);
      assert.equal(body.get("refresh_token"),"fixture-refresh-token-1234");
      received=true;
      return new Response(JSON.stringify({access_token:"fixture-access-token-1234",token_type:"Bearer",
        scope:"https://www.googleapis.com/auth/drive.file"}),{status:200});
    };
    assert.equal(await refreshAccessToken(mock),"fixture-access-token-1234");
    assert.equal(received,true);
    process.env.NOTEMESH_DRIVE_CLIENT_ID="another-client.apps.googleusercontent.com";
    await assert.rejects(refreshAccessToken(mock),/encrypted credential missing or invalid/);
    process.env.NOTEMESH_DRIVE_CLIENT_ID=id;
    process.env.ENCRYPTION_KEY="b2".repeat(32);
    assert.throws(()=>openStoredDrCredential(),/encrypted credential missing or invalid/);
  } finally {
    for(const name of ["ENCRYPTION_KEY","NOTEMESH_DRIVE_CLIENT_ID","NOTEMESH_DRIVE_CLIENT_SECRET",
      "NOTEMESH_DRIVE_CREDENTIAL","NOTEMESH_DRIVE_REFRESH_TOKEN"]) {
      if(old[name]===undefined)delete process.env[name];
      else process.env[name]=old[name];
    }
  }
});

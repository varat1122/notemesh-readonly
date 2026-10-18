import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {uploadVerifiedBundle} from "./nm-drive-upload.mjs";

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

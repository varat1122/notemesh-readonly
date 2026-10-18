import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {createSnapshot} from "./notemesh-backup.mjs";
import {uploadEncryptedBackup} from "./notemesh-drive-upload.mjs";

test("encrypted Drive upload is append-only and verifies complete remote ciphertext SHA",async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nm-drive-test-"));
 const data=path.join(tmp,"data"),vault=path.join(data,"vault"),file=path.join(tmp,"demo.nmbk");
 const folder="1"+"F".repeat(26),remoteId="1"+"R".repeat(26),key=crypto.randomBytes(32);
 const before=process.env.NM_BACKUP_SOURCE_QUIESCED;
 fs.mkdirSync(vault,{recursive:true});
 fs.writeFileSync(path.join(vault,"original.md"),"Test with Thai ทดสอบ");
 const db=new DatabaseSync(path.join(data,"app.sqlite"));
 db.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY,value TEXT); INSERT INTO proof(value) VALUES ('save')");
 db.close();
 process.env.NM_BACKUP_SOURCE_QUIESCED="1";
 try{
  await createSnapshot(data,file,key);
  let uploaded=null,calls=[];
  const fetcher=async(input,opts)=>{
   const uri=new URL(String(input));calls.push({path:uri.pathname,method:opts.method||"GET"});
   if(uri.pathname==="/drive/v3/files"&&uri.searchParams.has("q"))
     return new Response(JSON.stringify({files:[]}),{status:200});
   if(uri.pathname==="/upload/drive/v3/files"&&opts.method==="POST")
     return new Response(null,{status:200,headers:{location:"https://www.googleapis.com/upload/drive/v3/files?upload_id=test"}});
   if(uri.pathname==="/upload/drive/v3/files"&&opts.method==="PUT"){
     uploaded=Buffer.from(opts.body);
     return new Response(JSON.stringify({id:remoteId,size:String(uploaded.length)}),{status:200});
   }
   if(uri.pathname==="/drive/v3/files/"+remoteId&&uri.searchParams.get("alt")==="media")
     return new Response(uploaded,{status:200});
   throw Error("Unexpected fake Google Drive call "+uri);
  };
  const x=await uploadEncryptedBackup(file,folder,fetcher,"fake-oauth-access-token",key);
  assert.equal(x.status,"remote_encrypted_backup_sha256_readback_verified");
  assert.equal(x.fileId,remoteId);
  assert.equal(x.bytes,fs.statSync(file).size);
  assert.equal(x.sha256,crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  assert.deepEqual(calls.map(x=>x.method),["GET","POST","PUT","GET"]);
  calls=[];uploaded=null;
  const corrupted=async(u,opts)=>{
    const r=await fetcher(u,opts);
    if(new URL(String(u)).searchParams.get("alt")==="media"){
      const changed=Buffer.from(uploaded);changed[changed.length-1]^=1;
      return new Response(changed,{status:200});
    }
    return r;
  };
  await assert.rejects(uploadEncryptedBackup(file,folder,corrupted,"fake-oauth-access-token",key),/remote readback SHA-256 mismatch/);
  let requests=0;
  await assert.rejects(uploadEncryptedBackup(file,folder,async()=>{requests++;throw Error("should never request");},"token",crypto.randomBytes(32)),
    /authenticate|Unsupported state/i);
  assert.equal(requests,0);
 }finally{
   if(before===undefined)delete process.env.NM_BACKUP_SOURCE_QUIESCED;
   else process.env.NM_BACKUP_SOURCE_QUIESCED=before;
   fs.rmSync(tmp,{recursive:true,force:true});
 }
});

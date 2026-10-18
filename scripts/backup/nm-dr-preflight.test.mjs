import {test} from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {inspect} from "./nm-dr-preflight.mjs";
test("read-only inventory recognizes Vault, source originals and SQLite without printing names/secrets",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-preflight-"));
 try {
   for(const dir of ["vault","home","source-archive","market-prices"])fs.mkdirSync(path.join(root,dir));
   fs.writeFileSync(path.join(root,"vault","Private Thesis.md"),"confidential");
   fs.writeFileSync(path.join(root,"home","auth"),"secret-token");
   fs.writeFileSync(path.join(root,"source-archive","issuer-source.bin"),"issuer");
   fs.writeFileSync(path.join(root,"app.sqlite"),"fixture db");
   fs.writeFileSync(path.join(root,"market-prices","prices.sqlite"),"fixture");
   const before=fs.statSync(path.join(root,"app.sqlite")).mtimeMs;
   const result=await inspect(root);
   assert.equal(result.readOnly,true);assert.equal(result.writerQuiescenceVerified,false);
   assert.equal(result.required.appSqlite,true);
   assert.equal(result.databases,2);assert.equal(result.vaultFiles,1);
   assert.equal(result.sourceArchiveFiles,1);
   assert.equal(JSON.stringify(result).includes("Private Thesis"),false);
   assert.equal(JSON.stringify(result).includes("secret-token"),false);
   assert.equal(fs.statSync(path.join(root,"app.sqlite")).mtimeMs,before);
 } finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("read-only preflight does not treat a symlink or missing database as safe",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"nm-dr-preflight-"));
 try{
   fs.mkdirSync(path.join(root,"vault"));fs.mkdirSync(path.join(root,"home"));
   fs.symlinkSync("/etc/passwd",path.join(root,"vault","shortcut"));
   const result=await inspect(root);
   assert.equal(result.snapshotReady,false);
   assert.equal(result.unsafePaths,1);
   assert.ok(result.warnings.includes("missing_appSqlite"));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

/** G01 NEW integration measurement. Existing synthetic M56 input is reused;
 * no new semantic/critic or genuine human-approval claim. Real emitted server,
 * Better Auth, OAuth, canonical writes, local bare Git and fresh Node reader. */
import { it, expect } from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {startServer,claimAdmin,markConfigured,rpc,type Server} from "./harness";
it("G01 Source -> Review -> actual receipt/index -> settled fresh-process readback",async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"m56p1-http-"))),key=Buffer.alloc(32,61).toString("base64"),remote=path.join(root,"remote.git"),vault=path.join(root,"vault");
 const {execFileSync}=await import("node:child_process");
 const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{PATH:process.env.PATH??"",HOME:root,GIT_AUTHOR_NAME:"Synthetic",GIT_AUTHOR_EMAIL:"fixture@invalid",
  GIT_COMMITTER_NAME:"Synthetic",GIT_COMMITTER_EMAIL:"fixture@invalid",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"}}).trim();
 const hub="02_Industries_Themes/Memory Semiconductors.md";
 let s:Server|undefined;
 try{
  const device=path.join(root,"device");git(root,"init","--bare","-b","main",remote);git(root,"clone",remote,device);
  for(const [p,t] of [[hub,"# Memory Semiconductors\n"],["05_Thesis/protected.md","# Protected unchanged\n"],["00_Inbox/ChatGPT/.keep",""],["10_Knowledge/Industry and Concepts/.keep",""],["Notes/Ordinary.md","# Ordinary\n"]] as const){
   fs.mkdirSync(path.dirname(path.join(device,p)),{recursive:true});fs.writeFileSync(path.join(device,p),t);}
  git(device,"add","-A");git(device,"commit","-m","synthetic seed");git(device,"push","origin","main");git(root,"clone",remote,vault);
  s=await startServer({ENCRYPTION_KEY:key,SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",CLOUD_INTAKE:"1",OB_ALLOW_LOCAL_GIT:"1",SAFE_EDIT_GIT_REMOTE:remote,SAFE_EDIT_GIT_BRANCH:"main",
   GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"},{dataDir:root,keepDataDir:true});
  const cookie=await claimAdmin(s);await markConfigured(s,{sync_backend:"git",git_remote:remote,git_branch:"main",git_pull_seconds:"3600",git_debounce_seconds:"1"});
  expect((await rpc(s,"rebuildIndex",[],cookie)).status).toBe(200);
  const meta=await(await fetch(s.url+"/.well-known/oauth-protected-resource/api/safe-edit")).json();
  const redirect="http://localhost:9999/cb",headers={"Content-Type":"application/json",Origin:s.url};
  const oauth=async(name:string)=>{
   const reg=await(await fetch(s!.url+"/api/auth/oauth2/register",{method:"POST",headers,body:JSON.stringify({client_name:name,redirect_uris:[redirect],grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"none"})})).json();
   const params=new URLSearchParams({response_type:"code",client_id:reg.client_id,redirect_uri:redirect,scope:"vault:read vault:edit",code_challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",code_challenge_method:"S256",state:"synthetic",resource:meta.resource});
   const a=await fetch(s!.url+"/api/auth/oauth2/authorize?"+params,{headers:{cookie},redirect:"manual"}),dest=a.headers.get("location")??(await a.json()).url;
   const consent=await(await fetch(s!.url+"/api/auth/oauth2/consent",{method:"POST",headers:{...headers,cookie},body:JSON.stringify({accept:true,oauth_query:dest.split("?")[1]})})).json();
   const code=new URL(consent.redirectURI??consent.url).searchParams.get("code")!;
   const t=await(await fetch(s!.url+"/api/auth/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect,client_id:reg.client_id,code_verifier:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",resource:meta.resource})})).json();
   expect(t.access_token).toBeTruthy();
   const call=async(tool:string,args:object)=>{
    const r=await fetch(s!.url+"/api/safe-edit",{method:"POST",headers:{...headers,Accept:"application/json, text/event-stream",Authorization:"Bearer "+t.access_token},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:tool,arguments:args}})});
    expect(r.status).toBe(200);const text=await r.text(),data=text.split("\n").find(l=>l.startsWith("data: "));
    return (data?JSON.parse(data.slice(6)):JSON.parse(text)).result as {isError?:boolean;content:{text:string}[]};
   };
   return call;
  };
  const decode=(result:{isError?:boolean;content:{text:string}[]})=>{expect(result.isError,JSON.stringify(result)).not.toBe(true);const outer=JSON.parse(result.content[0].text);return JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));};
  const callA=await oauth("G01 HTTP SYNTHETIC");
  // The Git backend commits/pushes asynchronously (debounced): settle before every ledger snapshot.
  const settle=async()=>{for(let i=0;i<80;i++){if(git(vault,"status","--porcelain")===""&&git(vault,"rev-parse","HEAD")===git(root,"--git-dir",remote,"rev-parse","refs/heads/main"))return;await new Promise(res=>setTimeout(res,250));}
   throw Error("git did not settle");};
  // Canonical Industry-IN Source+Review and a captured duplicate Source, written over HTTP and persisted through Git.
  const thai={headlineTh:"ราคาหน่วยความจำสมมติปรับขึ้นในตุลาคม 2026",translationTh:"ข่าวสมมติระบุว่าราคาชิปหน่วยความจำปรับขึ้นในเดือนตุลาคม 2026",
   whatChangedTh:"เป็นข้อกล่าวอ้างด้านราคาที่ยังไม่ได้ตรวจสอบกับต้นฉบับ",mechanismTh:"ยังไม่มีหลักฐานว่าราคาที่ปรับขึ้นส่งผลต่อกำไรของผู้ผลิต",
   thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข่าวนี้",counterEvidenceTh:"ข้อมูลอาจเป็นการคาดการณ์ของสื่อ ไม่ใช่ราคาที่ตกลงจริง",requiredEvidenceTh:"ตรวจข้อมูลราคาจากต้นฉบับก่อนยกระดับข้อกล่าวอ้าง"};
  const wb=(text:string,url:string,capture=false)=>({domain:"industry",entities:["Memory Semiconductors"],topic:"Synthetic memory price",inputFormat:"text",sourceKind:"news_media",sourceLanguage:"en",
   sourceChannel:"fixture",contentTypes:["other"],sourceChat:"M56 HTTP synthetic",sourceUrl:url,eventDate:"2026-10-20",publicationDate:"2026-10-20",originalDocumentAccess:"not_obtained",
   extractedText:text,...(capture?{captureOnly:true}:{researchReview:thai})});
  const save=async(input:Record<string,unknown>)=>{
   const p=decode(await callA("prepare_canonical_writeback",input));
   for(let i=0;;i++){const r=await callA("apply_canonical_writeback",{input,planId:p.planId,authorizations:p.previews.map((x:{operationId:string;previewToken:string;beforeHash:string})=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))});
    if(!r.isError)return {p,out:decode(r)};
    if(i>40||!/Git must be running|Git drain|In-flight Git/.test(JSON.stringify(r)))throw Error(JSON.stringify(r));
    await new Promise(res=>setTimeout(res,500));}
  };
  const first=await save(wb("SYNTHETIC: Memory Semiconductors contract prices rose in October 2026, a synthetic tracker reported for DRAM.","https://example.org/memory/tracker-a"));
  expect(first.out.status).toBe("saved_verified");
  const src=first.p.steps.find((x:{kind:string})=>x.kind==="source_intake").path,rev=first.p.steps.find((x:{kind:string})=>x.kind==="canonical_review").path;
  const revReceipt=first.p.previews.find((x:{kind:string})=>x.kind==="canonical_review").operationId;
  const evidence = first.p.previews.map((p:{operationId:string;path:string;afterHash:string}) => ({ id:p.operationId,path:p.path,sha:p.afterHash }));
  await settle();
  await s.stop(); s=undefined;
  const coldScript = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Database=require('better-sqlite3');
    const root=process.argv[1],entries=JSON.parse(process.argv[2]);const d=new Database(path.join(root,'app.sqlite'),{readonly:true,fileMustExist:true});
    const rows=entries.map(e=>{const bytes=fs.readFileSync(path.join(root,'vault',e.path));const row=d.prepare('SELECT status,receipt FROM safe_edit_operations WHERE id=?').get(e.id);
      return {...e,actualSha:crypto.createHash('sha256').update(bytes).digest('hex'),status:row.status,receipt:JSON.parse(row.receipt),
        indexed:!!d.prepare('SELECT 1 FROM notes WHERE path=?').get(e.path),fts:!!d.prepare('SELECT 1 FROM notes_fts WHERE path=?').get(e.path),
        links:d.prepare('SELECT target,resolved_path FROM links WHERE source_path=?').all(e.path),text:bytes.toString('utf8')};});d.close();console.log(JSON.stringify(rows));`;
  const cold=JSON.parse(execFileSync(process.execPath,["-e",coldScript,root,JSON.stringify(evidence)],{encoding:"utf8",env:{PATH:process.env.PATH},timeout:10000}));
  for(const item of cold){expect(item.actualSha).toBe(item.sha);expect(item.status).toBe("written");expect(item.receipt).toMatchObject({write:"written",readback:"verified",reindex:"verified"});expect(item.indexed).toBe(true);expect(item.fts).toBe(true);}
  const review=cold.find((x:{path:string})=>x.path===rev);
  expect(review.links.some((l:{resolved_path:string})=>l.resolved_path===src)).toBe(true);
  expect(review.text).toContain("historical_analysis_only");
  expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
  console.log(JSON.stringify({g01ColdProof:{entries:evidence,reviewReceipt:revReceipt,indexed:cold.length,protectedUnchanged:true,semanticAcceptance:false}}));
 }finally{await s?.stop();fs.rmSync(root,{recursive:true,force:true});}
},120000);

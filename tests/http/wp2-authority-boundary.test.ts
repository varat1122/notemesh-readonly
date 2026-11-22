/** WP2 E03/E04 over real local HTTP + OAuth + the emitted server bundle (OFF mode, loopback only).
 * Preview/authority path only: no Sync backend is configured, so no apply/persistence claim is made
 * here (OFF real persistence is proven in src/server/safe-edit/wp2-protected-boundary.test.ts).
 * A test-generated admin session is NOT proof of a human. The migration epoch is established by the
 * administrative kernel function in the test process (no MCP/HTTP/RPC route exists for it). */
import {it,expect} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import {startServer,claimAdmin,markConfigured,rpc,type Server} from "./harness";
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
function files(dir:string,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
it("E03/E04: public MCP over HTTP — stable descriptors, kernel-minted witness on the normal path, OFF-mode ICW forge refused post-epoch with zero effects",async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-http-off-"))),key=Buffer.alloc(32,43).toString("base64");let s:Server|undefined;
 try{
  for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","Notes"])fs.mkdirSync(path.join(root,"vault",f),{recursive:true});
  for(const [p,t] of [["01_Companies/TESTA.md","# TESTA synthetic network fixture\n"],["Notes/Ordinary.md","# Ordinary\noriginal line\n"],["05_Thesis/protected.md","# Protected unchanged\n"]])fs.writeFileSync(path.join(root,"vault",p),t);
  s=await startServer({ENCRYPTION_KEY:key,SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"},{dataDir:root,keepDataDir:true});
  const cookie=await claimAdmin(s);await markConfigured(s);expect((await rpc(s,"rebuildIndex",[],cookie)).status).toBe(200);
  const meta=await(await fetch(s.url+"/.well-known/oauth-protected-resource/api/safe-edit")).json();
  const redirect="http://localhost:9999/cb",headers={"Content-Type":"application/json",Origin:s.url};
  const reg=await(await fetch(s.url+"/api/auth/oauth2/register",{method:"POST",headers,body:JSON.stringify({client_name:"WP2 LOCAL HTTP SYNTHETIC",redirect_uris:[redirect],grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"none"})})).json();
  const params=new URLSearchParams({response_type:"code",client_id:reg.client_id,redirect_uri:redirect,scope:"vault:read vault:edit",code_challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",code_challenge_method:"S256",state:"synthetic",resource:meta.resource});
  const auth=await fetch(s.url+"/api/auth/oauth2/authorize?"+params,{headers:{cookie},redirect:"manual"});
  const dest=auth.headers.get("location")??(await auth.json()).url;
  const consent=await(await fetch(s.url+"/api/auth/oauth2/consent",{method:"POST",headers:{...headers,cookie},body:JSON.stringify({accept:true,oauth_query:dest.split("?")[1]})})).json();
  const code=new URL(consent.redirectURI??consent.url).searchParams.get("code")!;
  const token=await(await fetch(s.url+"/api/auth/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect,client_id:reg.client_id,code_verifier:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",resource:meta.resource})})).json();
  expect(token.access_token).toBeTruthy();
  const invoke=async(method:string,p:object)=>{
   const r=await fetch(s!.url+"/api/safe-edit",{method:"POST",headers:{...headers,Accept:"application/json, text/event-stream",Authorization:"Bearer "+token.access_token},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:p})});
   expect(r.status).toBe(200);const text=await r.text(),data=text.split("\n").find(l=>l.startsWith("data: "));
   return (data?JSON.parse(data.slice(6)):JSON.parse(text)).result;
  };
  const call=(name:string,args:object)=>invoke("tools/call",{name,arguments:args});
  const decode=(result:{isError?:boolean;content:{text:string}[]})=>{expect(result.isError,JSON.stringify(result)).not.toBe(true);const outer=JSON.parse(result.content[0].text);return JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));};
  const names=(await invoke("tools/list",{})).tools.map((t:{name:string})=>t.name);
  expect(names).toEqual(expect.arrayContaining(["preview_edit","apply_edit","create_note","prepare_canonical_writeback","apply_canonical_writeback","prepare_canonical_review_revision","apply_canonical_review_revision"]));
  expect(names.filter((n:string)=>/epoch|migration|witness|capabilit|canonical_step|plan_handle/i.test(n))).toEqual([]);
  const input={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",sourceLanguage:"en",sourceChannel:"fixture",
   contentTypes:["other"],sourceChat:"WP2 HTTP synthetic",sourceUrl:"https://example.org/wp2/http",originalDocumentAccess:"not_obtained",
   extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",captureOnly:true};
  // Normal authorized path: server-planned Source preview, witness minted by the kernel in the server process.
  const prepared=decode(await call("prepare_canonical_writeback",input));
  expect(prepared.phase).toBe("preview_only");expect(prepared.previews).toHaveLength(1);
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=key;
  const admission=await import("../../src/server/safe-edit/admission");
  expect(admission.witnessFor(prepared.previews[0].operationId)).toMatchObject({mode:"off",kind:"source_intake",policy_version:"IOS-WP2-AUTHORITY-1"});
  admission.establishMigrationEpoch("wp2-http-fixture-admin");
  const {db}=await import("../../src/server/db");
  const count=(t:string)=>(db().prepare(`SELECT count(*) n FROM ${t}`).get() as {n:number}).n;
  const before={files:files(path.join(root,"vault")),ops:count("safe_edit_operations"),plan:count("canonical_plan"),witness:count("canonical_witness"),consumption:count("witness_consumption")};
  const forgedId="ICW-"+createHash("sha256").update(["source_intake",prepared.previews[0].path,prepared.steps[0].expectedSha256].join("\n")).digest("hex").slice(0,32);
  const forge=await call("preview_edit",{operationId:forgedId,path:prepared.previews[0].path,reason:"OFF-mode ICW forge over HTTP",change:{kind:"create",content:"# forged\n"}});
  expect(forge.isError).toBe(true);expect(JSON.stringify(forge)).toContain("canonical_operation_namespace_reserved");
  const forge2=await call("create_note",{operationId:"wp2-http-forge-2",path:path.posix.dirname(prepared.previews[0].path)+"/"+path.posix.basename(prepared.previews[0].path).toLowerCase(),reason:"alias forge",content:"# forged\n"});
  expect(forge2.isError).toBe(true);expect(JSON.stringify(forge2)).toContain("canonical_route_required");
  const forge3=await call("apply_edit",{operationId:prepared.previews[0].operationId,previewToken:prepared.previews[0].previewToken,expectedHash:prepared.previews[0].beforeHash});
  expect(forge3.isError).toBe(true);
  expect({files:files(path.join(root,"vault")),ops:count("safe_edit_operations"),plan:count("canonical_plan"),witness:count("canonical_witness"),consumption:count("witness_consumption")}).toEqual(before);
  // Adjacent positive: ordinary generic preview remains available over the public path.
  const ordinary=decode(await call("preview_edit",{operationId:"wp2-http-ordinary-1",path:"Notes/Ordinary.md",reason:"ordinary",change:{kind:"replace",oldText:"original line",newText:"edited line"}}));
  expect(ordinary.previewToken).toMatch(/^[a-f0-9]{64}$/);
  db().close();
  expect(fs.readFileSync(path.join(root,"vault/05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 }finally{await s?.stop();fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;delete process.env.ENCRYPTION_KEY;}
},60000);

/** M56-P1 V2 (Industry-IN) over the REAL emitted server: HTTP + OAuth + authenticated dashboard
 * route + Git persistence to a local bare remote (OFF mode, loopback only; NO sync double). The
 * admin session is test-generated (not proof of a human). Synthetic analyst attestation. One
 * expiry case edits the preview expiry row directly (synthetic clock substitute). */
it("M56-P1 V2 HTTP: dashboard approval positive/negatives (session, origin, hash, evidence digest, expiry), other actor, CAS, replay, Git-persisted apply",async()=>{
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
  const callA=await oauth("M56 HTTP SYNTHETIC A"),callB=await oauth("M56 HTTP SYNTHETIC B");
  const {default:Database}=await import("better-sqlite3");
  const walk=(dir:string,b=""):string[]=>fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!==".git").flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();
  const ledger=()=>{const d=new Database(path.join(root,"app.sqlite"),{readonly:true});
   try{const all=(q:string)=>JSON.stringify(d.prepare(q).all());
    return {files:walk(vault),ops:all("SELECT id,status,approval,before_hash,after_hash,expires FROM safe_edit_operations ORDER BY id"),plan:all("SELECT * FROM canonical_plan ORDER BY 1"),
     witness:all("SELECT * FROM canonical_witness ORDER BY 1"),consumption:all("SELECT * FROM witness_consumption ORDER BY 1"),events:all("SELECT operation_id,actor,event FROM safe_edit_events ORDER BY rowid"),
     notes:all("SELECT path FROM notes ORDER BY path"),remote:git(root,"--git-dir",remote,"rev-parse","refs/heads/main")};}finally{d.close();}};
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
  const dup=await save(wb("SYNTHETIC (second edition): Memory Semiconductors contract prices rose in October 2026 for DRAM, the tracker repeated.","https://www.example.org/memory/tracker-b",true));
  const dupPath=dup.p.steps[0].path,dupReceipt=dup.p.previews[0].operationId;
  const raw=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
  const {preservedSubmittedText}=await import("../../src/server/vault/research-decision-v2"),{splitFrontmatter}=await import("../../src/server/vault/markdown");
  const part=preservedSubmittedText(raw(src))!,text=[part,part+"\n"].find(t=>sha(t)===splitFrontmatter(raw(src)).data.source_text_sha256)!,q="Memory Semiconductors contract prices rose in October 2026",at=text.indexOf(q);
  const input:Record<string,unknown>={selectorVersion:"M56-REVIEW-SELECTOR-2",entity:"industry",
   existingReview:{path:rev,intakeId:rev.match(/IN-[A-F0-9]{16}/)![0],expectedSha256:sha(raw(rev)),receiptId:revReceipt,reviewScope:"industry",originalSourcePath:src,relationship:"duplicate",
    comparisonBasis:"Both synthetic editions report the same October 2026 memory contract price rise from one publisher family."},
   subject:{domain:"industry",hubPath:hub,topic:"DRAM contract pricing",period:"October 2026",evidence:[{key:"original_source",quote:q,locator:`utf16:${at}:${at+q.length}`,sourceSha256:sha(text)}]},
   additionalSources:[{path:dupPath,sha256:sha(raw(dupPath)),receiptId:dupReceipt}],reviewDate:"2026-11-14",methodVersion:"M56-HTTP-SYNTHETIC-1",revisionText:"Synthetic duplicate link over HTTP.",
   analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"Synthetic repeat of the same dated event; not new evidence.",counterEvidence:"Same-event identity is an analyst proposal only.",
    requiredEvidence:"Read the original before any decision.",criticIndependence:"not_verified",independentEvidenceIncrement:0}};
  const seal=(packet:Record<string,any>)=>{
   const body=JSON.parse(packet.packet.body),ref=(k:string,t:string,h:string)=>({key:k,quote:t.slice(0,100),locator:`utf16:0:${Math.min(t.length,100)}`,sourceSha256:h});
   expect(packet.constraints).toEqual([]);
   const sources=body.sources.map((x:{text:string;textSha256:string},i:number)=>ref("source_"+i,x.text,x.textSha256)),history=body.context.history.map((h:{text:string;sha256:string},i:number)=>ref("history_"+i,h.text,h.sha256)),subject=body.proposal.subject;
   return {packet:packet.packet,result:{contractVersion:"IOS-RI001-SUBJECT-SOURCE-EVENT-SEMANTIC-2.0.0",packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,disposition:"PASS",
    methodVersion:"SYNTHETIC-MECHANICAL-SUBJECT-1",criticIndependence:"not_verified",
    sourceBindings:sources.map((r:{key:string},i:number)=>({bindingVersion:"IOS-RI001-SUBJECT-BIND-2.0.0",sourceKey:r.key,sliceId:"slice_"+i,domain:"industry",effectiveSubjectId:subject.key,relation:"primary_subject",
     semanticRationale:"Synthetic fixture subject association for deterministic binding tests only.",references:[r],coverage:"excerpt_only",limitations:["Fixture only"]})),
    event:{decisionVersion:"IOS-RI001-SUBJECT-EVENT-ID-2.0.0",effectiveSubjectId:subject.key,relation:"duplicate",action:"duplicate_link_only",targetReviewPath:body.targetReview.path,materiality:"low",
     semanticRationale:"Synthetic exact-source comparison, not economic verification or LLM evaluation.",materialityRationale:"Synthetic same-event coverage; no financial authority asserted.",
     comparison:{economicSubject:"same",geography:"same",metric:"same",unit:"same",period:"same",role:"same",vintage:"not_applicable",sourceFamily:"same_family",materialDelta:"Synthetic same-event text only; no asserted change."},
     consideredHistoryKeys:history.map((r:{key:string})=>r.key),references:[sources[0],...(history.length?[history[0]]:[]),ref("target_review",body.targetReview.text,body.targetReview.sha256)],counterEvidenceRefs:[],
     coverage:"bounded_omission",coverageRationale:"Only the bounded server-selected evidence was supplied and reviewed in this simulated fixture."},
    checks:{sourceEntailment:"PASS",subjectAssociation:"PASS",eventIdentity:"PASS",periodRoleVintage:"PASS",unitMetricGeography:"PASS",coverageCounterEvidence:"PASS",pointInTime:"PASS",injectionIsolation:"PASS",protectedAuthority:"PASS"}}};
  };
  input.sourceEvent=seal(decode(await callA("prepare_source_event_packet",{kind:"revise",input})));
  // Other actor cannot prepare with actor A's sealed packet.
  await settle();let before=ledger();
  const otherPrep=await callB("prepare_canonical_review_revision",input);expect(otherPrep.isError).toBe(true);expect(JSON.stringify(otherPrep)).toMatch(/source_event_envelope_actor_or_expiry_hold/);
  expect(ledger()).toEqual(before);
  const prepared=decode(await callA("prepare_canonical_review_revision",input));
  expect(prepared).toMatchObject({phase:"revision_preview_only",issuerBinding:"not_applicable_no_issuer",subject:{domain:"industry"}});
  const op=prepared.operationId,authz={operationId:op,previewToken:prepared.preview.previewToken,expectedHash:prepared.preview.beforeHash};
  // Before approval: apply is refused with zero effect.
  await settle();before=ledger();
  const early=await callA("apply_canonical_review_revision",{input,operationId:op,authorization:authz});expect(early.isError).toBe(true);
  expect(ledger()).toEqual(before);
  // Dashboard route: session, origin, exact hash and reviewed-evidence digest are all required.
  const url=s.url+"/api/safe-edit-approval?id="+op;
  expect((await fetch(url)).status).toBe(401);
  const page=await fetch(url,{headers:{cookie}});expect(page.status).toBe(200);
  const html=await page.text(),digest=/name="reviewedEvidenceDigest" value="([a-f0-9]{64})"/.exec(html)?.[1];
  expect(digest).toBeTruthy();expect(html).toContain("subjectBinding");
  const post=(body:object,h:Record<string,string>)=>fetch(s!.url+"/api/safe-edit-approval",{method:"POST",headers:{"Content-Type":"application/json",...h},body:JSON.stringify(body)});
  await settle();before=ledger();
  expect((await post({id:op,hash:prepared.preview.afterHash,reviewedEvidenceDigest:digest},{Origin:s.url})).status).toBe(401);
  expect((await post({id:op,hash:prepared.preview.afterHash,reviewedEvidenceDigest:digest},{Origin:"https://evil.example.com",cookie})).status).toBe(403);
  expect((await post({id:op,hash:"0".repeat(64),reviewedEvidenceDigest:digest},{Origin:s.url,cookie})).status).toBe(400);
  expect((await post({id:op,hash:prepared.preview.afterHash,reviewedEvidenceDigest:"f".repeat(64)},{Origin:s.url,cookie})).status).toBe(400);
  expect((await post({id:op,hash:prepared.preview.afterHash},{Origin:s.url,cookie})).status).toBe(400);
  expect(ledger()).toEqual(before);
  expect((await post({id:op,hash:prepared.preview.afterHash,reviewedEvidenceDigest:digest},{Origin:s.url,cookie})).status).toBe(200);
  // Other actor and CAS mismatch cannot apply the approved preview; zero effect.
  await settle();before=ledger();
  expect((await callB("apply_canonical_review_revision",{input,operationId:op,authorization:authz})).isError).toBe(true);
  expect((await callA("apply_canonical_review_revision",{input,operationId:op,authorization:{...authz,expectedHash:"0".repeat(64)}})).isError).toBe(true);
  expect(ledger()).toEqual(before);
  // Positive apply, persisted through Git to the bare remote; replay is idempotent.
  const applied=decode(await callA("apply_canonical_review_revision",{input,operationId:op,authorization:authz}));
  expect(applied).toMatchObject({status:"revision_saved_verified",reviewAppendChainVerified:true,sourceReceiptsVerified:true,independentEvidenceIncrement:0,issuerBinding:"not_applicable_no_issuer"});
  const once=raw(rev);expect(once).toContain(`[[${dupPath.slice(0,-3)}]]`);
  await settle();
  expect(git(root,"--git-dir",remote,"show","refs/heads/main:"+rev)).toBe(once.replace(/\n$/,""));
  expect(decode(await callA("apply_canonical_review_revision",{input,operationId:op,authorization:authz}))).toMatchObject({status:"revision_saved_verified"});
  expect(raw(rev)).toBe(once);
  await settle();before=ledger();
  const replay=await callA("prepare_canonical_review_revision",input);expect(replay.isError).toBe(true);
  expect(ledger()).toEqual(before);
  // Expiry: a second (added detail) preview whose expiry has passed cannot be approved or applied.
  const third=await save(wb("SYNTHETIC (detail edition): Memory Semiconductors contract prices rose in October 2026; the tracker added a DDR5 note.","https://news.example.org/memory/tracker-c",true));
  const detail:Record<string,unknown>={...input,existingReview:{...(input.existingReview as object),expectedSha256:sha(raw(rev)),relationship:"added_detail",
   comparisonBasis:"The synthetic detail edition adds a DDR5 scope note to the same October 2026 price rise; same publisher family."},
   additionalSources:[{path:third.p.steps[0].path,sha256:sha(raw(third.p.steps[0].path)),receiptId:third.p.previews[0].operationId}],
   analystAssessment:{...(input.analystAssessment as object),eventRelation:"added_detail"}};
  delete detail.sourceEvent;
  const pk=decode(await callA("prepare_source_event_packet",{kind:"revise",input:detail})),sealedDetail=seal(pk);
  sealedDetail.result.event.relation="added_detail";sealedDetail.result.event.action="append_revision";detail.sourceEvent=sealedDetail;
  const p2=decode(await callA("prepare_canonical_review_revision",detail));
  { const d=new Database(path.join(root,"app.sqlite"));try{d.prepare("UPDATE safe_edit_operations SET expires=? WHERE id=?").run(Date.now()-1000,p2.operationId);}finally{d.close();} }
  await settle();before=ledger();
  const page2=await fetch(s.url+"/api/safe-edit-approval?id="+p2.operationId,{headers:{cookie}}),d2=/name="reviewedEvidenceDigest" value="([a-f0-9]{64})"/.exec(await page2.text())?.[1];
  expect((await post({id:p2.operationId,hash:p2.preview.afterHash,reviewedEvidenceDigest:d2},{Origin:s.url,cookie})).status).toBe(400);
  expect((await callA("apply_canonical_review_revision",{input:detail,operationId:p2.operationId,authorization:{operationId:p2.operationId,previewToken:p2.preview.previewToken,expectedHash:p2.preview.beforeHash}})).isError).toBe(true);
  expect(ledger()).toEqual(before);
  expect(raw("05_Thesis/protected.md")).toBe("# Protected unchanged\n");
 }finally{await s?.stop();fs.rmSync(root,{recursive:true,force:true});}
},120000);

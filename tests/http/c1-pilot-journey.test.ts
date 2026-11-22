/** C1 product journey over the real emitted server: Source -> Judge -> reviewed
 * Draft -> receipts -> immediate stop -> cold readback -> restart -> a NEW OAuth
 * client (stand-in for a fresh ChatGPT room) retrieves through the read-only
 * research endpoint. Mechanism only: the admin session and Judge result are
 * synthetic; this is not proof of a human reviewer, a model, or a real room. */
import {it,expect} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {execFileSync} from "node:child_process";
import {startServer,claimAdmin,rpc,type Server} from "./harness";
import {DRAFT_RISK_POLICY,riskDimensions,judgeHash} from "../../src/server/vault/research-judge-contract";

type Endpoint="safe-edit"|"research";
it("C1 journey: reviewed Draft, duplicate, Source-only HOLD, cold readback and fresh-client retrieval after restart",async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-c1-pilot-journey-")));let s:Server|undefined;
 const pilotEnv={TMPDIR:fs.realpathSync(os.tmpdir()),C1_RESEARCH_PILOT:"disposable",SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1",
  MARKET_PRICES_ENABLED:"1",ENCRYPTION_KEY:Buffer.alloc(32,12).toString("base64")};
 try{
  fs.mkdirSync(path.join(root,"vault"));
  s=await startServer(pilotEnv,{dataDir:root,keepDataDir:true});
  await claimAdmin(s);
  const login=async()=>{const r=await fetch(s!.url+"/api/auth/sign-in/email",{method:"POST",headers:{"Content-Type":"application/json",Origin:s!.url},
   body:JSON.stringify({email:"admin@example.com",password:"correct-horse-battery-staple"})});expect(r.status).toBe(200);return r.headers.get("set-cookie")!.split(";")[0];};
  let cookie=await login();
  expect((await rpc(s,"setupLocalPilotVault",[{confirmLocalOnly:true}],cookie)).status).toBe(200);
  fs.mkdirSync(path.join(root,"vault/05_Thesis"));fs.writeFileSync(path.join(root,"vault/05_Thesis/Protected.md"),"# Protected journey bytes\n");
  expect((await rpc(s,"rebuildIndex",[],cookie)).status).toBe(200);
  const oauth=async(endpoint:Endpoint)=>{
   // Every call registers a new client: no client, token or session is shared.
   const headers={"Content-Type":"application/json",Origin:s!.url};
   const meta=await(await fetch(s!.url+"/.well-known/oauth-protected-resource"+(endpoint==="research"?"":"/api/safe-edit"))).json();
   expect(meta.resource).toBe(s!.url+(endpoint==="research"?"/api/mcp":"/api/safe-edit"));
   const scope=endpoint==="research"?"vault:read":"vault:read vault:edit",redirect="http://localhost:9999/cb";
   const reg=await(await fetch(s!.url+"/api/auth/oauth2/register",{method:"POST",headers,body:JSON.stringify({client_name:`C1 JOURNEY ${endpoint} ${Date.now()}`,
    redirect_uris:[redirect],grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"none"})})).json();
   const params=new URLSearchParams({response_type:"code",client_id:reg.client_id,redirect_uri:redirect,scope,code_challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method:"S256",state:"synthetic",resource:meta.resource});
   const auth=await fetch(s!.url+"/api/auth/oauth2/authorize?"+params,{headers:{cookie},redirect:"manual"});
   const dest=auth.headers.get("location")??(await auth.json()).url;expect(dest).toContain("/oauth/consent");
   const consent=await(await fetch(s!.url+"/api/auth/oauth2/consent",{method:"POST",headers:{...headers,cookie},body:JSON.stringify({accept:true,oauth_query:dest.split("?")[1]})})).json();
   const code=new URL(consent.redirectURI??consent.url).searchParams.get("code");expect(code).toBeTruthy();
   const token=await(await fetch(s!.url+"/api/auth/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({
    grant_type:"authorization_code",code:code!,redirect_uri:redirect,client_id:reg.client_id,code_verifier:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",resource:meta.resource})})).json();
   expect(token.access_token).toBeTruthy();return token.access_token as string;
  };
  const mcp=async(endpoint:Endpoint,token:string,method:string,params:object)=>{
   const response=await fetch(s!.url+(endpoint==="research"?"/api/mcp":"/api/safe-edit"),{method:"POST",headers:{"Content-Type":"application/json",Origin:s!.url,
    Accept:"application/json, text/event-stream",Authorization:"Bearer "+token},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
   const text=await response.text(),data=text.split("\n").find(l=>l.startsWith("data: "));
   return {status:response.status,result:response.status===200?(data?JSON.parse(data.slice(6)):JSON.parse(text)).result:undefined};
  };
  const edit=await oauth("safe-edit");
  const call=async(name:string,args:object)=>{const r=await mcp("safe-edit",edit,"tools/call",{name,arguments:args});expect(r.status).toBe(200);return r.result;};
  const decode=(result:any)=>{expect(result.isError,JSON.stringify(result)).not.toBe(true);const outer=JSON.parse(result.content[0].text);return JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));};
  const prepare=async(input:object)=>decode(await call("prepare_canonical_writeback",input));
  const save=async(input:object,p:any)=>decode(await call("apply_canonical_writeback",{input,planId:p.planId,authorizations:p.previews.map((t:any)=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))}));
  // In-app Company Hub onboarding: setup created only the empty parent; the Hub
  // note is an ordinary receipted Safe Edit create (no filesystem fixture).
  expect(fs.readdirSync(path.join(root,"vault/01_Companies"))).toEqual([]);
  const hub=decode(await call("create_note",{operationId:"C1-JOURNEY-HUB",path:"01_Companies/TESTB.md",reason:"C1 Company Hub onboarding",content:"# TESTB\n"}));
  expect(hub.pilotReviewRequired).toBe(false);
  const hubApplied=decode(await call("apply_edit",{operationId:hub.operationId,previewToken:hub.previewToken,expectedHash:hub.beforeHash}));
  expect(hubApplied).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified"}});
  expect(fs.readFileSync(path.join(root,"vault/01_Companies/TESTB.md"),"utf8")).toBe("# TESTB\n");
  const editTools=(await mcp("safe-edit",edit,"tools/list",{})).result.tools.map((t:{name:string})=>t.name);
  expect(editTools).toEqual(expect.arrayContaining(["prepare_research_judge_packet","research_judge_result_contract","prepare_canonical_writeback","apply_canonical_writeback","get_edit_status"]));
  expect(editTools.some((n:string)=>/approv|review_decision/.test(n))).toBe(false);

  const base={domain:"company",entities:["TESTB"],topic:"TESTB journey",sourceKind:"news_media",sourceLanguage:"th",sourceChat:"Synthetic C1 journey fixture",sourceChannel:"chat",inputFormat:"text",originalDocumentAccess:"not_obtained",contentTypes:["other"]};
  const history="TESTB มีหน้าคำถามที่พบบ่อยสำหรับลูกค้าที่เผยแพร่ไว้แล้ว พร้อมคำแนะนำการติดต่อฝ่ายบริการ";
  const old={...base,sourceUrl:"https://example.org/c1-journey/history",extractedText:history,captureOnly:true};
  const previous=await save(old,await prepare(old));expect(previous.receipts).toHaveLength(1);
  const judged=async(input:any)=>{
   const packet=decode(await call("prepare_research_judge_packet",{input})),body=JSON.parse(packet.packet.body);
   const h=body.history.find((h:any)=>h.path===previous.steps[0].path),span=h.citationSpans.find((x:any)=>x.text.includes(history));
   const refs=[{key:"received_source",quote:input.extractedText,locator:`utf16:0:${input.extractedText.length}`,sourceSha256:judgeHash(input.extractedText)},
    {key:h.key,quote:span.text,locator:`utf16:${span.start}:${span.end}`,sourceSha256:h.sha256}];
   const assessment=(key:string)=>({key,verdict:"PASS",rationale:"Simulated semantic assessment for local HTTP journey mechanism test only",references:refs,
    checks:{entailment:"PASS",numbersUnits:"PASS",periodRoleAttributionVintage:"PASS",identityRelationships:"PASS",pointInTime:"PASS",independenceCounterEvidence:"PASS",injectionCoverage:"PASS"}});
   const result={packetId:packet.packet.packetId,packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,reviewDigest:body.reviewDigest,
    claims:body.claims.map((c:{key:string})=>assessment(c.key)),relationships:body.relationships.map((c:{key:string})=>assessment(c.key)),
    event:{...assessment("event"),classification:"added_detail"},review:assessment("review"),materialRisk:false,
    riskAssessment:{policy:DRAFT_RISK_POLICY,scopeDigest:body.riskScope.digest,coveredKeys:body.riskScope.items.map((x:any)=>x.key),
     findings:riskDimensions.map(dimension=>({dimension,disposition:"absent",rationale:"Simulated assessment against the actual Source and receipt-bound History.",references:refs}))}};
   return {...input,researchJudge:{packet:packet.packet,result}};
  };
  const prose="เป็นรายละเอียดช่องทางติดต่อในหน้าคำถามที่พบบ่อยตามข้อความที่ได้รับ ยังไม่มีหลักฐานแสดงผลต่อรายได้ ต้นทุน ราคา หรือเงื่อนไขสัญญา จึงใช้เป็นข้อมูลประกอบการค้นหาเท่านั้น";
  const review={headlineTh:"TESTB เพิ่มรายละเอียดช่องทางติดต่อในหน้าคำถาม",whatChangedTh:prose,mechanismTh:prose,
   thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือมูลค่าบริษัทจากข้อความเกี่ยวกับหน้าคำถามฉบับนี้",
   counterEvidenceTh:"ข้อมูลนี้อาจเป็นข้อความส่งต่อและยังไม่ได้ตรวจสอบกับผู้เผยแพร่ต้นฉบับ จึงต้องรักษาข้อจำกัดนี้",
   requiredEvidenceTh:"ตรวจหน้าเว็บต้นฉบับและประกาศของบริษัทก่อนใช้ ข้อความนี้เป็นข้อมูลทดสอบ ไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว"};
  const source="TESTB เพิ่มคำอธิบายช่องทางติดต่อในหน้าคำถามเดิม โดยข้อความที่ได้รับไม่ได้ระบุการเปลี่ยนแปลงการดำเนินธุรกิจ";

  // 1. Normal positive path: Source + reviewed restrictive Draft.
  const data=await judged({...base,sourceUrl:"https://example.org/c1-journey/new",extractedText:source,researchReview:review}),p=await prepare(data);
  expect(p.researchJudge.decision).toBe("PASS");
  const t=p.previews.find((x:any)=>x.kind==="canonical_review"),sourcePath=p.previews.find((x:any)=>x.kind==="source_intake").path;
  const url=s.url+"/api/safe-edit-approval?id="+t.operationId,html=await(await fetch(url,{headers:{cookie}})).text();
  const bindingDigest=/name="bindingDigest" value="([a-f0-9]{64})"/.exec(html)![1];
  const approval=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Origin:s.url,cookie},body:JSON.stringify({id:t.operationId,bindingDigest,decision:"approve",
   semanticVerdict:"PASS",materiality:"low",rationale:"SIMULATED local authenticated session reviewing exact source/history/manual Draft. Not proof of human authority."})});
  expect(approval.status).toBe(200);expect(await approval.json()).toMatchObject({effective:"PASS",humanPresence:"not_verified"});
  const saved=await save(data,p);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(2);
  for(const receipt of saved.receipts)expect(receipt).toMatchObject({receipt:{write:"written",readback:"verified",reindex:"verified"}});
  const reviewBytes=fs.readFileSync(path.join(root,"vault",t.path),"utf8");
  for(const label of ["historical_analysis_only","comparator_eligible: false","independent_evidence_increment: 0"])expect(reviewBytes).toContain(label);

  // 2. Duplicate: the same Source and Draft add nothing.
  const repeat=await prepare(data);expect(repeat.previews).toEqual([]);expect((await save(data,repeat)).receipts).toEqual([]);

  // 3. Numeric/date scope: Source preserved, Draft held, no Review written.
  const numeric=await judged({...base,sourceUrl:"https://example.org/c1-journey/numeric",extractedText:source+" The FAQ update is dated 2026-11-12.",researchReview:review});
  const held=await prepare(numeric);expect(held.researchJudge.decision).toBe("HOLD");
  expect(held.previews.map((x:any)=>x.kind)).toEqual(["source_intake"]);
  const heldSaved=await save(numeric,held);expect(heldSaved.receipts).toHaveLength(1);
  const heldSourcePath=held.previews[0].path;

  // 4. Stop at once (no settling delay): the durable index must match the receipts.
  const evidence=[...p.previews,...held.previews].map((x:any)=>({id:x.operationId,path:x.path,sha:x.afterHash}));
  await s.stop();s=undefined;
  const coldScript=`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Database=require('better-sqlite3');
   const root=process.argv[1],entries=JSON.parse(process.argv[2]),d=new Database(path.join(root,'app.sqlite'),{readonly:true,fileMustExist:true});
   const result=entries.map(e=>{const row=d.prepare('SELECT status,receipt FROM safe_edit_operations WHERE id=?').get(e.id);
    return {...e,shaActual:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'vault',e.path))).digest('hex'),status:row.status,receipt:JSON.parse(row.receipt),
     indexed:!!d.prepare('SELECT 1 FROM notes WHERE path=?').get(e.path),links:d.prepare('SELECT target,resolved_path FROM links WHERE source_path=?').all(e.path)};});
   d.close();console.log(JSON.stringify(result));`;
  const cold=JSON.parse(execFileSync(process.execPath,["-e",coldScript,root,JSON.stringify(evidence)],{encoding:"utf8",timeout:10000,env:{PATH:process.env.PATH}}));
  for(const item of cold){expect(item.shaActual).toBe(item.sha);expect(item.status).toBe("written");expect(item.indexed).toBe(true);
   expect(item.receipt).toMatchObject({write:"written",readback:"verified",reindex:"verified"});}
  const coldReview=cold.find((x:any)=>x.path===t.path);
  expect(coldReview.links.some((x:any)=>x.resolved_path===sourcePath)).toBe(true);
  expect(coldReview.links.some((x:any)=>x.resolved_path==="01_Companies/TESTB.md")).toBe(true);
  expect(coldReview.links.every((x:any)=>x.resolved_path!==null)).toBe(true);

  // 5. Restart; a brand-new OAuth client reads through the research endpoint only.
  s=await startServer(pilotEnv,{dataDir:root,keepDataDir:true});cookie=await login();
  const fresh=await oauth("research");
  // Audience-bound: a read token cannot reach the editor, an edit token cannot reach the reader.
  expect((await mcp("safe-edit",fresh,"tools/list",{})).status).not.toBe(200);
  expect((await mcp("research",await oauth("safe-edit"),"tools/list",{})).status).not.toBe(200);
  const tool=async(name:string,args:object)=>{const r=await mcp("research",fresh,"tools/call",{name,arguments:args});expect(r.status).toBe(200);
   expect(r.result.isError,JSON.stringify(r.result)).not.toBe(true);return r.result.content.map((c:{text?:string})=>c.text??"").join("\n");};
  const listed=(await mcp("research",fresh,"tools/list",{})).result.tools as {name:string;annotations?:{readOnlyHint?:boolean}}[];
  expect(listed.map(x=>x.name)).toEqual(expect.arrayContaining(["search_vault","read_note","get_links","investment_context_pack"]));
  // The only non-read tool is the legacy inbox archive, which needs inbox:submit and is C1-denied.
  expect(listed.filter(x=>x.annotations?.readOnlyHint!==true).map(x=>x.name)).toEqual(["submit_investment_notes"]);
  // MARKET_PRICES_ENABLED=1 is set above: C1 still offers no price tools.
  expect(listed.filter(x=>/price/.test(x.name)).map(x=>x.name)).toEqual([]);
  const vaultFiles=()=>fs.readdirSync(path.join(root,"vault"),{recursive:true}).map(String).sort();
  const filesBefore=vaultFiles(),submit=await mcp("research",fresh,"tools/call",{name:"submit_investment_notes",arguments:{}});
  expect(submit.status!==200||submit.result?.isError===true).toBe(true);expect(vaultFiles()).toEqual(filesBefore);
  // FTS unicode61 does not segment unspaced Thai; a fresh room finds the bundle by
  // ticker/intake ID and the issuer-scoped context pack (see the C1 runbook).
  expect(await tool("search_vault",{query:"TESTB"})).toContain(t.path);
  const pack=await tool("investment_context_pack",{question:"TESTB FAQ contact channel update",issuers:["TESTB"]});
  expect(pack).toContain(t.path);
  const readBack=await tool("read_note",{path:t.path});
  for(const label of ["historical_analysis_only","comparator_eligible: false"])expect(readBack).toContain(label);
  expect(await tool("get_links",{path:t.path,direction:"outgoing"})).toContain(sourcePath);
  expect(await tool("get_links",{path:sourcePath,direction:"backlinks"})).toContain(t.path);
  expect(await tool("read_note",{path:heldSourcePath})).toContain("2026-11-12");
  expect(fs.existsSync(path.join(root,"vault",t.path.replace(t.path.split("/").pop()!,"")))).toBe(true);
  expect(fs.readdirSync(path.join(root,"vault/10_Knowledge/Company Research")).filter(n=>n.includes(heldSourcePath.match(/IN-[A-F0-9]{16}/)![0]))).toEqual([]);
  expect(fs.readFileSync(path.join(root,"vault/05_Thesis/Protected.md"),"utf8")).toBe("# Protected journey bytes\n");
  expect(fs.readdirSync(root).filter(n=>/price|\.git$/.test(n))).toEqual([]);
  expect(s.log()).not.toMatch(/\[supervisor\] starting|\[git\] |\[market-prices\]/);
 }finally{await s?.stop();fs.rmSync(root,{recursive:true,force:true});}
},120000);

/** Real local HTTP + OAuth + emitted server bundles. A test-generated admin
 * session/decision is NOT proof of a human or a ChatGPT room connection. */
import {it,expect} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {startServer,claimAdmin,markConfigured,rpc,type Server} from "./harness";
import {DRAFT_RISK_POLICY,riskDimensions,judgeHash} from "../../src/server/vault/research-judge-contract";
it("never-enrolled legacy emitted server initializes auth/index and restarts without a pilot flag",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"legacy-c1-http-")),key=Buffer.alloc(32,9).toString("base64");let s:Server|undefined;
 try{
  fs.mkdirSync(path.join(root,"vault"));fs.writeFileSync(path.join(root,"vault/Legacy.md"),"# Legacy fixture\n");
  s=await startServer({ENCRYPTION_KEY:key},{dataDir:root,keepDataDir:true});
  const cookie=await claimAdmin(s);await markConfigured(s);expect((await rpc(s,"rebuildIndex",[],cookie)).status).toBe(200);
  await s.stop();s=undefined;
  s=await startServer({ENCRYPTION_KEY:key},{dataDir:root,keepDataDir:true});
  expect((await fetch(s.url+"/api/health")).status).toBe(200);
  expect(fs.readFileSync(path.join(root,"vault/Legacy.md"),"utf8")).toBe("# Legacy fixture\n");
 }finally{await s?.stop();fs.rmSync(root,{recursive:true,force:true});}
},30000);
it("C1 local network: audience/descriptor, explicit dashboard review, raw/generic refusal, Source and Draft",async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-c1-pilot-http-")));let s:Server|undefined;
 try{
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies"])fs.mkdirSync(path.join(root,"vault",folder),{recursive:true});
  fs.writeFileSync(path.join(root,"vault/01_Companies/TESTA.md"),"# TESTA synthetic network fixture\n");
  s=await startServer({C1_RESEARCH_PILOT:"disposable",SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"},{dataDir:root,keepDataDir:true});
  const cookie=await claimAdmin(s);await markConfigured(s);expect((await rpc(s,"rebuildIndex",[],cookie)).status).toBe(200);
  const meta=await(await fetch(s.url+"/.well-known/oauth-protected-resource/api/safe-edit")).json();expect(meta.resource).toBe(s.url+"/api/safe-edit");expect(meta.scopes_supported).toEqual(["vault:read","vault:edit"]);
  const redirect="http://localhost:9999/cb",headers={"Content-Type":"application/json",Origin:s.url};
  const reg=await(await fetch(s.url+"/api/auth/oauth2/register",{method:"POST",headers,body:JSON.stringify({client_name:"C1 LOCAL HTTP SYNTHETIC",redirect_uris:[redirect],grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"none"})})).json();
  const params=new URLSearchParams({response_type:"code",client_id:reg.client_id,redirect_uri:redirect,scope:"vault:read vault:edit",code_challenge:"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",code_challenge_method:"S256",state:"synthetic",resource:meta.resource});
  const auth=await fetch(s.url+"/api/auth/oauth2/authorize?"+params,{headers:{cookie},redirect:"manual"});
  const dest=auth.headers.get("location")??(await auth.json()).url;expect(dest).toContain("/oauth/consent");
  const consent=await(await fetch(s.url+"/api/auth/oauth2/consent",{method:"POST",headers:{...headers,cookie},body:JSON.stringify({accept:true,oauth_query:dest.split("?")[1]})})).json();
  const code=new URL(consent.redirectURI??consent.url).searchParams.get("code")!;
  const token=await(await fetch(s.url+"/api/auth/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect,client_id:reg.client_id,code_verifier:"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",resource:meta.resource})})).json();expect(token.access_token).toBeTruthy();
  const invoke=async(method:string,params:object)=>{
   const response=await fetch(s!.url+"/api/safe-edit",{method:"POST",headers:{...headers,Accept:"application/json, text/event-stream",Authorization:"Bearer "+token.access_token},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
   expect(response.status).toBe(200);const text=await response.text(),data=text.split("\n").find(l=>l.startsWith("data: "));
   return (data?JSON.parse(data.slice(6)):JSON.parse(text)).result;
  };
  const call=async(name:string,args:object)=>invoke("tools/call",{name,arguments:args});
  const decode=(result:any)=>{expect(result.isError,JSON.stringify(result)).not.toBe(true);const outer=JSON.parse(result.content[0].text);return JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));};
  const tools=await invoke("tools/list",{});expect(JSON.stringify(tools)).toContain("researchJudge");expect(tools.tools.some((t:{name:string})=>t.name==="prepare_research_judge_packet")).toBe(true);expect(tools.tools.some((t:{name:string})=>/approv|review_decision/.test(t.name))).toBe(false);
  const base={domain:"company",entities:["TESTA"],topic:"TESTA คู่มือ",sourceKind:"news_media",sourceLanguage:"th",sourceChat:"Synthetic local HTTP fixture",sourceChannel:"chat",inputFormat:"text",originalDocumentAccess:"not_obtained",contentTypes:["other"]};
  const history="TESTA มีคู่มือการใช้งานที่เผยแพร่ไว้แล้ว พร้อมคำแนะนำเกี่ยวกับการค้นหาเอกสาร";
  const old={...base,sourceUrl:"https://example.org/c1-http/history",extractedText:history,captureOnly:true};
  const prepare=async(input:object)=>decode(await call("prepare_canonical_writeback",input));
  const save=async(input:object,p:any)=>decode(await call("apply_canonical_writeback",{input,planId:p.planId,authorizations:p.previews.map((t:any)=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))}));
  const previous=await save(old,await prepare(old));expect(previous.receipts).toHaveLength(1);
  const source="TESTA เพิ่มคำอธิบายตำแหน่งคำแนะนำในคู่มือเดิม โดยข้อความที่ได้รับไม่ได้ระบุการเปลี่ยนแปลงการดำเนินธุรกิจ";
  const prose="เป็นรายละเอียดตำแหน่งคำแนะนำในคู่มือเดิมตามข้อความที่ได้รับ ยังไม่มีหลักฐานแสดงผลต่อรายได้ ต้นทุน ราคา หรือเงื่อนไขสัญญา จึงใช้เป็นข้อมูลประกอบการค้นหาเท่านั้น";
  const input={...base,sourceUrl:"https://example.org/c1-http/new",extractedText:source,researchReview:{headlineTh:"TESTA เพิ่มรายละเอียดตำแหน่งคำแนะนำในคู่มือ",whatChangedTh:prose,mechanismTh:prose,thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือมูลค่าบริษัทจากข้อความเกี่ยวกับคู่มือฉบับนี้",counterEvidenceTh:"ข้อมูลนี้อาจเป็นข้อความส่งต่อและยังไม่ได้ตรวจสอบกับผู้เผยแพร่ต้นฉบับ จึงต้องรักษาข้อจำกัดนี้",requiredEvidenceTh:"ตรวจคู่มือต้นฉบับและประกาศของบริษัทก่อนใช้ ข้อความนี้เป็นข้อมูลทดสอบ ไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว"}};
  const packet=decode(await call("prepare_research_judge_packet",{input})),body=JSON.parse(packet.packet.body);
  const h=body.history.find((h:any)=>h.path===previous.steps[0].path);expect(h.sourceReceiptKey).toBeTruthy();
  const span=h.citationSpans.find((x:any)=>x.text.includes(history));expect(span).toBeTruthy();
  const refs=[{key:"received_source",quote:source,locator:`utf16:0:${source.length}`,sourceSha256:judgeHash(source)},{key:h.key,quote:span.text,locator:`utf16:${span.start}:${span.end}`,sourceSha256:h.sha256}];
  const assessment=(key:string)=>({key,verdict:"PASS",rationale:"Simulated semantic assessment for local HTTP mechanism test only",references:refs,checks:{entailment:"PASS",numbersUnits:"PASS",periodRoleAttributionVintage:"PASS",identityRelationships:"PASS",pointInTime:"PASS",independenceCounterEvidence:"PASS",injectionCoverage:"PASS"}});
  const result={packetId:packet.packet.packetId,packetDigest:packet.packet.digest,packetEnvelopeDigest:packet.packetEnvelopeDigest,reviewDigest:body.reviewDigest,claims:[],relationships:[],event:{...assessment("event"),classification:"added_detail"},review:assessment("review"),materialRisk:false,riskAssessment:{policy:DRAFT_RISK_POLICY,scopeDigest:body.riskScope.digest,coveredKeys:body.riskScope.items.map((x:any)=>x.key),findings:riskDimensions.map(dimension=>({dimension,disposition:"absent",rationale:"Simulated assessment of manual navigation only against the actual Source and receipt-bound History.",references:refs}))}};
  const data={...input,researchJudge:{packet:packet.packet,result}},p=await prepare(data);expect(p.researchJudge.decision).toBe("PASS");
  const t=p.previews.find((t:any)=>t.kind==="canonical_review");expect(t).toBeTruthy();
  expect((await call("apply_edit",{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash})).isError).toBe(true);
  expect((await call("preview_edit",{operationId:"C1-NET-RAW",path:"10_Knowledge/Company Research/Raw.md",reason:"Synthetic bypass",change:{kind:"create",content:"Raw bypass"}})).isError).toBe(true);
  const url=s.url+"/api/safe-edit-approval?id="+t.operationId;
  expect((await fetch(url,{headers:{Authorization:"Bearer "+token.access_token}})).status).toBe(401);
  const page=await fetch(url,{headers:{cookie}});expect(page.status).toBe(200);const html=await page.text();expect(html).toContain("dashboard-session attestation only");
  const bindingDigest=/name="bindingDigest" value="([a-f0-9]{64})"/.exec(html)![1];
  const request={id:t.operationId,bindingDigest,decision:"approve",semanticVerdict:"PASS",materiality:"low",rationale:"SIMULATED local authenticated session reviewing exact source/history/manual Draft. Not proof of human authority."};
  expect((await fetch(url,{method:"POST",headers,body:JSON.stringify(request)})).status).toBe(401);
  const approval=await fetch(url,{method:"POST",headers:{...headers,cookie},body:JSON.stringify(request)});expect(approval.status).toBe(200);expect(await approval.json()).toMatchObject({effective:"PASS",humanPresence:"not_verified"});
  const saved=await save(data,p);expect(saved.status,JSON.stringify(saved)).toBe("saved_verified");expect(saved.receipts).toHaveLength(2);
  const bytes=fs.readFileSync(path.join(root,"vault",t.path),"utf8");expect(bytes).toContain("historical_analysis_only");expect(bytes).toContain("comparator_eligible: false");
  expect(s.log()).not.toMatch(/\[supervisor\] starting|\[git\] no remote configured/);
  // F2: actual emitted server restart on the SAME persisted data, losing the
  // flag. Refuse before auth migrations, indexing, sync or writer admission.
  const restartUrl=s.url;await s.stop();s=undefined;
  const snapshot=()=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
   const file=path.join(e.parentPath,e.name);return [path.relative(root,file),createHash("sha256").update(fs.readFileSync(file)).digest("hex")];
  }));
  const before=snapshot(),child=spawn(process.execPath,[path.resolve(".output/server/index.mjs")],{env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:"production",DATA_DIR:root,BASE_URL:restartUrl,PORT:new URL(restartUrl).port,ENCRYPTION_KEY:Buffer.alloc(32,8).toString("base64")},stdio:["ignore","pipe","pipe"]});
  let log="";child.stdout.on("data",b=>log+=b);child.stderr.on("data",b=>log+=b);
  try{
   const deadline=Date.now()+10000;
   while(Date.now()<deadline&&child.exitCode===null&&!log.includes("c1_pilot_mode_required_hold")){
    let response:Response|undefined;
    try{response=await fetch(restartUrl+"/api/health",{signal:AbortSignal.timeout(500)});}catch{/* startup may refuse before listening */}
    if(response)expect(response.ok).toBe(false);
    await new Promise(r=>setTimeout(r,50));
   }
   expect(log).toContain("c1_pilot_mode_required_hold");
   expect(log).not.toMatch(/\[supervisor\] starting|\[indexer\]|\[git\]|\[market-prices\]/);
  }finally{if(child.exitCode===null){child.kill("SIGKILL");await new Promise<void>(r=>child.once("close",()=>r()));}}
  expect(snapshot()).toEqual(before);
 }finally{await s?.stop();fs.rmSync(root,{recursive:true,force:true});}
},60000);

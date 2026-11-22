/** NEW synthetic mechanisms: real canonical Source receipts, no semantic PASS,
 * reviewer approval, direct SQL mutation or live data. */
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {stripVTControlCharacters} from "node:util";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {WritebackInput} from "../vault/investment-writeback-router";
import {MACRO_SOURCE_POLICY} from "../vault/macro-source-scope";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex"),actor="oauth:macro-history-fixture";
let root:string,vault:string;
const review={headlineTh:"คู่มือจำลองเพิ่มคำแนะนำการค้นหัวข้อ",translationTh:"คู่มือของ Fictionland เพิ่มคำแนะนำให้ค้นชื่อหัวข้อในสารบัญ ข้อความนี้เป็นแบบฝึกระบบไม่ใช่ประกาศเศรษฐกิจจริง",
 whatChangedTh:"เมื่อเทียบกับคู่มือจำลองเดิม มีคำแนะนำตำแหน่งค้นชื่อหัวข้อเพิ่มเติม ยังไม่ได้ตรวจต้นฉบับโดยอิสระ",
 mechanismTh:"ข้อความอธิบายการค้นเอกสารเท่านั้น ไม่ได้ให้หลักฐานผลต่อรายได้ กำไรหรือเศรษฐกิจ การตีความผลกระทบเพิ่มเติมยังไม่มีหลักฐานรองรับ",
 thesisImplicationTh:"ไม่ปรับ Thesis หรือข้อสรุปทางการลงทุนจากรายละเอียดคู่มือจำลองนี้",
 counterEvidenceTh:"ต้องตรวจข้อความคู่มือเดิมและขอบเขตที่เกี่ยวข้อง ความไม่ครบถ้วนของประวัติยังไม่ใช่หลักฐานว่าไม่มีข้อมูลแย้ง",
 requiredEvidenceTh:"ต้องตรวจข้อความเดิม ตำแหน่งอ้างอิงและข้อจำกัดของหลักฐานก่อนนำไปใช้ ไม่ใช่ข้อเท็จจริงที่ยืนยันโดยอิสระ"};
function input(label="Fictionland",detail="คู่มือมีสารบัญสำหรับค้นคำอธิบาย"):WritebackInput{
 const line="Macro subject: "+label,text=line+"\nข้อมูลจำลอง: "+label+" "+detail+" เอกสารนี้เป็นแบบฝึกระบบ ไม่ใช่ประกาศของหน่วยงานจริง";
 return {domain:"macro",entities:[label],topic:"คู่มือจำลอง",inputFormat:"text",sourceKind:"user_commentary",sourceChat:"Macro disposable fixture",
  sourceChannel:"chat",originalDocumentAccess:"not_obtained",sourceUrl:null,eventDate:null,publicationDate:null,extractedText:text,captureOnly:true,
  macroSubject:{version:MACRO_SOURCE_POLICY,kind:"country",label,anchor:{quote:line,locator:`utf16:0:${line.length}`,sourceSha256:sha(text)}}};
}
const current=()=>({...input("Fictionland","คู่มือเพิ่มคำแนะนำว่าชื่อหัวข้ออยู่ในสารบัญ"),captureOnly:undefined,researchReview:review,contentTypes:["other" as const]});
beforeEach(()=>{
 root=process.env.MACRO_COLD_ROOT??fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-c1-pilot-macro-")));vault=path.join(root,"vault");
 if(!process.env.MACRO_COLD_ROOT)for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Macro and Markets"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 process.env.DATA_DIR=root;process.env.C1_RESEARCH_PILOT="disposable";process.env.ENCRYPTION_KEY=Buffer.alloc(32,6).toString("base64");
 process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
});
afterEach(async()=>{
 vi.restoreAllMocks();vi.useRealTimers();(await import("../db")).db().close();if(!process.env.MACRO_COLD_ROOT)fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","C1_RESEARCH_PILOT","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});
async function prepare(data:WritebackInput&{researchJudge?:unknown}){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function save(data:WritebackInput&{researchJudge?:unknown}=input()){
 const api=await import("./canonical-writeback"),p=await prepare(data);
 const result=await api.applyCanonicalWriteback({input:data,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);
 expect(result.receipts).toHaveLength(1);expect(result.receipts[0]).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified"}});return result;
}
async function packet(data:WritebackInput=current(),who=actor){
 const api=await import("./canonical-writeback"),j=await import("../vault/research-judge");
 const built=j.buildResearchJudgePacket(api.canonicalInputSchema.parse(data),who);return {...built,body:JSON.parse(built.packet.body) as import("../vault/research-judge").PacketBody};
}
async function fresh(w:Awaited<ReturnType<typeof packet>>,data:WritebackInput=current()){
 const p=(await import("../vault/investment-writeback-router")).planInvestmentWriteback(data),s=await import("../vault/research-judge-scope");
 return s.judgeScopeCurrent(w.body.scopeWitness,w.body.coverage.retrieval,s.judgeTargets(p),p.planId,actor);
}
it("prior canonical Source reaches sealed Macro history without a Hub; risk/reviewer remain HOLD",async()=>{
 const prior=await save(),w=await packet(),h=w.body.history.find(h=>h.path===prior.steps[0].path)!;
 expect(h).toBeDefined();expect(h.sourceReceiptKey).toBe(prior.steps[0].receiptKey);
 expect(h.sourceBinding).toMatchObject({scopeBasis:"receipted_source_declared_macro_subject",macroScope:{key:"FICTIONLAND",authority:"source_declared_not_geographic_verification"},independentEvidenceIncrement:0,primaryVerification:"not_performed",sourceActor:actor,eventDate:null,publicationDate:null});
 const raw=fs.readFileSync(path.join(vault,h.path),"utf8");expect(h.sha256).toBe(sha(raw));
 expect(h.citationSpans.length).toBeGreaterThan(0);for(const s of h.citationSpans)expect(raw.slice(s.start,s.end)).toBe(s.text);
 expect(w.body.scopeWitness).toMatchObject({version:2,policy:"RI001-MACRO-HISTORY-1",scope:{macroScope:{key:"FICTIONLAND"}}});
 expect(w.body.coverage.retrieval.status).toBe("operational_complete");expect(await fresh(w)).toBe(true);
 expect(h.researchTrust).toMatchObject({primary_authority:false,comparator_eligible:false,independent_evidence_increment:0});
 const held=await prepare({...current(),researchJudge:{packet:w.packet}});expect(held.researchJudge?.decision).toBe("HOLD");expect(held.researchJudge?.reasons).toContain("judge_result_missing");
 expect(held.previews.every(p=>p.kind==="source_intake")).toBe(true);await save({...current(),researchJudge:{packet:w.packet}});
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Macro and Markets"))).toEqual([]);
 const retry=await prepare(current());expect(retry.previews.filter(t=>t.kind!=="source_intake")).toEqual([]);
 console.info("MACRO_HISTORY_EVIDENCE",JSON.stringify({sourceReceipt:prior.receipts[0],historicalPath:h.path,historicalSha256:h.sha256,
  binding:h.sourceBinding,citationSpans:h.citationSpans,witnessVersion:w.body.scopeWitness?.version,judgeDecision:held.researchJudge?.decision,nonSourceWrites:0}));
 const engine=await import("../safe-edit/engine");expect(()=>engine.preview({operationId:"forged-macro-review",path:"10_Knowledge/Macro and Markets/Investment Review - Forged.md",reason:"Synthetic refusal",change:{kind:"create",content:"# Forged"}},actor)).toThrow();
});
it("wrong-country co-mention is not selected and does not cause a false operational HOLD",async()=>{
 const a=await save(),b=await save(input("Otherland","คู่มือกล่าวถึง Fictionland เป็นตัวอย่างต่างประเทศ")),w=await packet();
 expect(w.body.history.map(h=>h.path)).toContain(a.steps[0].path);expect(w.body.history.map(h=>h.path)).not.toContain(b.steps[0].path);expect(w.body.coverage.retrieval.status).toBe("operational_complete");
});
it.each(["missing","multiple","mixed","wrong-label","hash","span","wrong-domain"])("invalid declaration %s preserves only unscoped Source",async fault=>{
 const d=input();
 if(fault==="missing")d.extractedText="ข้อมูลจำลอง: Fictionland มีคู่มือ";
 if(fault==="multiple")d.extractedText+="\nMacro subject: Otherland";
 if(fault==="mixed")d.extractedText=d.extractedText.replace("Macro subject: Fictionland","Macro subject: Fictionland / Otherland");
 if(fault==="wrong-label")d.macroSubject!.label="Otherland";
 if(fault==="hash")d.macroSubject!.anchor.sourceSha256="a".repeat(64);
 if(fault==="span")d.macroSubject!.anchor.locator="utf16:1:25";
 if(fault==="wrong-domain")d.domain="asset";
 const saved=await save(d),raw=fs.readFileSync(path.join(vault,saved.steps[0].path),"utf8");expect(raw).not.toContain("macro_subject:");
 expect((await packet()).body.history.map(h=>h.path)).not.toContain(saved.steps[0].path);
});
it("pending Source and caller-forged receipt fields cannot become history",async()=>{
 const p=await prepare(input());expect(p.writesPerformed).toBe(false);expect(fs.existsSync(path.join(vault,p.steps[0].path))).toBe(false);expect((await packet()).body.history).toEqual([]);
 const api=await import("./canonical-writeback");expect(()=>api.canonicalInputSchema.parse({...input(),macroSubject:{...input().macroSubject,receiptId:p.steps[0].receiptKey,verified:true}})).toThrow();
});
it("legacy unscoped Source is reused byte-for-byte and cannot be upgraded by new labels",async()=>{
 const d=input();delete d.macroSubject;const saved=await save(d),raw=fs.readFileSync(path.join(vault,saved.steps[0].path),"utf8");
 const p=await prepare(input());expect(p.planId).toBe(saved.planId);expect(p.previews).toHaveLength(0);expect(fs.readFileSync(path.join(vault,saved.steps[0].path),"utf8")).toBe(raw);
 expect((await packet()).body.history.map(h=>h.path)).not.toContain(saved.steps[0].path);
});
it("own Source/repost excludes itself before discovery; wrong actor cannot claim its operation",async()=>{
 await save();const d={...current(),captureOnly:true,researchReview:undefined},saved=await save(d),w=await packet();expect(w.body.history.map(h=>h.path)).not.toContain(saved.steps[0].path);
 const retry=await prepare(d);expect(retry.previews).toHaveLength(0);expect(retry.steps[0].receiptKey).toBe(saved.steps[0].receiptKey);
 await expect(packet(current(),"oauth:another-actor")).rejects.toThrow(/self_write_receipt_hold/);
});
it.each(["changed","scope","missing","symlink","index"])("required Source %s invalidates witness and reports operational HOLD",async fault=>{
 const saved=await save(),w=await packet(),p=path.join(vault,saved.steps[0].path),raw=fs.readFileSync(p,"utf8");
 if(fault==="changed")fs.writeFileSync(p,raw+"\nChanged");
 if(fault==="scope")fs.writeFileSync(p,raw.replace('"key":"FICTIONLAND"','"key":"OTHERLAND"'));
 if(fault==="missing")fs.unlinkSync(p);
 if(fault==="symlink"){fs.renameSync(p,p+".untrusted");fs.symlinkSync(p+".untrusted",p);}
 if(fault==="index"){fs.writeFileSync(p,raw.replace("source_chat:","untrusted_source_chat:"));(await import("../vault/indexer")).reindexPath(saved.steps[0].path);}
 expect(await fresh(w)).toBe(false);const newer=await packet();expect(newer.body.history.map(h=>h.path)).not.toContain(saved.steps[0].path);expect(newer.body.coverage.retrieval.status).toBe("operational_hold");
});
it("new relevant evidence invalidates selected witness; unrelated valid Source does not",async()=>{
 await save();const w=await packet();await save(input("Otherland","มีคู่มืออีกชุด"));expect(await fresh(w)).toBe(true);
 await save(input("Fictionland","มีคำอธิบายเพิ่มเติมในคู่มืออีกฉบับ"));expect(await fresh(w)).toBe(false);
});
it("expired envelope, seal mismatch and unassessed bundle cannot gain authority",async()=>{
 await save();const w=await packet(),j=await import("../vault/research-judge");expect(()=>j.verifyResearchJudgeEnvelope({...w.packet,seal:"0".repeat(64)},actor)).toThrow();expect(()=>j.verifyResearchJudgeEnvelope(w.packet,"oauth:wrong")).toThrow();
 vi.useFakeTimers();vi.setSystemTime(w.packet.expiresAt+1);expect(()=>j.verifyResearchJudgeEnvelope(w.packet,actor)).toThrow();vi.useRealTimers();
 const p=await prepare(current());expect(p.previews.every(t=>t.kind==="source_intake")).toBe(true);
});
it("MCP descriptors and actual packet/prepare/apply support typed Source without reviewer fabrication",async()=>{
 const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
 const client=new Client({name:"macro-synthetic-mechanism",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 const unwrap=(r:unknown)=>{const v=r as {isError?:boolean;content:{type:string;text:string}[]};expect(v.isError).not.toBe(true);const parsed=JSON.parse(v.content.find(c=>c.type==="text")!.text);return JSON.parse(parsed.result.slice(parsed.boundary.length).trim().slice(0,-parsed.boundary.length).trim());};
 try{
  const tools=await client.listTools();expect(JSON.stringify(tools.tools.find(t=>t.name==="prepare_research_judge_packet")!.inputSchema)).toContain("macroSubject");
  const p=unwrap(await client.callTool({name:"prepare_canonical_writeback",arguments:{...input()}}));
  const saved=unwrap(await client.callTool({name:"apply_canonical_writeback",arguments:{input:input(),planId:p.planId,authorizations:p.previews.map((t:{operationId:string;previewToken:string;beforeHash:string})=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))}}));expect(saved.receipts).toHaveLength(1);
  const out=unwrap(await client.callTool({name:"prepare_research_judge_packet",arguments:{input:current()}}));expect(JSON.parse(out.packet.body).history).toHaveLength(1);
 }finally{await client.close();await server.close();}
});
it("fresh process independently reads real receipt, index, scope and exact prior bytes",async()=>{
 const saved=await save(),runner=path.resolve("node_modules/vitest/vitest.mjs"),testFile=path.relative(process.cwd(),import.meta.filename);
 const output=execFileSync(process.execPath,[runner,"run",testFile,"-t","cold-reader-only","--maxWorkers=1"],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,CI:"1",MACRO_COLD_ROOT:root,MACRO_COLD_PATH:saved.steps[0].path},timeout:45000,encoding:"utf8"});expect(output).toContain("1 passed");console.info("MACRO_COLD_PROCESS",stripVTControlCharacters(output).split("\n").filter(s=>s.includes("Tests")||s.includes("Test Files")).join("; "));
});
it.runIf(!!process.env.MACRO_COLD_ROOT)("cold-reader-only",async()=>{
 const p=process.env.MACRO_COLD_PATH!;const w=await packet();expect(w.body.history.map(h=>h.path)).toContain(p);
 expect(w.body.history[0].sourceReceiptKey).toMatch(/^ICW-/);expect(w.body.coverage.retrieval.status).toBe("operational_complete");
});
it("unwitnessed provenance and receipt verification errors cannot masquerade as history",async()=>{
 const saved=await save(),w=await packet(),mod=await import("../vault/investment-research-context"),original=mod.receiptProvenance;
 const fault=vi.spyOn(mod,"receiptProvenance").mockImplementation((kind,p,content)=>{
  const result=original(kind,p,content);return p===saved.steps[0].path?{...result,tier:"legacy_origin_unverified"}:result;
 });
 try{expect(await fresh(w)).toBe(false);const b=(await packet()).body;expect(b.history).toEqual([]);expect(b.coverage.retrieval.status).toBe("operational_hold");}finally{fault.mockRestore();}
 const broken=vi.spyOn(mod,"createReceipt").mockImplementation(()=>{throw Error("synthetic receipt verification failure");});
 try{expect(await fresh(w)).toBe(false);expect((await packet()).body.coverage.retrieval.status).toBe("operational_hold");}finally{broken.mockRestore();}
});
it.each(["EACCES","EIO"])("required physical read failure %s is retained without leaking exception text",async code=>{
 const saved=await save(),w=await packet(),notes=await import("../vault/notes"),original=notes.readNote;
 const fault=vi.spyOn(notes,"readNote").mockImplementation(p=>{if(p===saved.steps[0].path)throw Object.assign(Error("private fault detail"),{code});return original(p);});
 try{expect(await fresh(w)).toBe(false);const b=(await packet()).body;expect(b.coverage.retrieval.status).toBe("operational_hold");expect(JSON.stringify(b)).not.toContain("private fault detail");}finally{fault.mockRestore();}
});
it("sentinel overflow stays bounded and self-write is excluded before the bound",async()=>{
 for(let i=0;i<17;i++)await save(input("Fictionland","คู่มือจำลองฉบับ "+String.fromCharCode(65+i)));
 const own=await save({...current(),captureOnly:true,researchReview:undefined}),w=await packet();
 const scan=w.body.coverage.standaloneSources![0];expect(scan.paths).toHaveLength(16);expect(scan.complete).toBe(false);expect(scan.reasons).toContain("standalone_source_candidate_limit");
 expect(scan.paths).not.toContain(own.steps[0].path);expect(w.body.history.length).toBeLessThanOrEqual(8);expect(w.body.coverage.retrieval.status).toBe("operational_complete");
 expect(w.body.coverage.incomplete.join(" ")).toContain("standalone_source_candidate_limit");
},20000);
it("exact repost has a fresh appearance but one Source receipt and zero evidence increment",async()=>{
 const d={...input(),appearance:{key:"macro-appearance-first",channel:"chat",locator:"synthetic:message:one",receivedAt:"2026-11-21T01:00:00Z"}},first=await save(d);
 const other={...d,appearance:{...d.appearance,key:"macro-appearance-second",channel:"line",locator:"synthetic:message:two",receivedAt:"2026-11-21T01:01:00Z"}};
 const p=await prepare(other),api=await import("./canonical-writeback");expect(p.previews).toHaveLength(0);expect(p.steps[0].receiptKey).toBe(first.steps[0].receiptKey);
 const r=await api.applyCanonicalWriteback({input:other,planId:p.planId,authorizations:[]},actor);expect(r.receipts).toHaveLength(0);
 expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toHaveLength(1);
 const w=await packet();expect(w.body.history).toHaveLength(1);expect(w.body.history[0].sourceBinding?.independentEvidenceIncrement).toBe(0);
});

function l1ProtectedSnapshot(){
 const files=["05_Thesis/Fictionland - Current Thesis.md","05_Thesis/Fictionland - Evidence Register.md",
  "01_Companies/Fictionland - Company Evolution Timeline.md","06_Portfolio/Positions.md","06_Portfolio/Trades.md"];
 for(const file of files){const absolute=path.join(vault,file);fs.mkdirSync(path.dirname(absolute),{recursive:true});
  if(!fs.existsSync(absolute))fs.writeFileSync(absolute,"# Synthetic protected sentinel; no investment facts\n");}
 return ()=>Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(path.join(vault,file),"utf8"))]));
}
it.each([
 {name:"focus mismatch",focus:"general" as const,sourceKind:"user_commentary" as const,reason:"macro_history_scope_contract_hold"},
 {name:"broker implicit focus",focus:undefined,sourceKind:"broker_research" as const,reason:"macro_source_kind_scope_hold"},
 {name:"broker explicit macro focus",focus:"macro" as const,sourceKind:"broker_research" as const,reason:"macro_source_kind_scope_hold"}
])("L1 $name preserves exact unscoped Source and blocks non-Source",async({focus,sourceKind,reason})=>{
 const snapshot=l1ProtectedSnapshot(),before=snapshot(),d={...input(),focus,sourceKind};
 const router=await import("../vault/investment-writeback-router"),api=await import("./canonical-writeback");
 const planned=router.planInvestmentWriteback(d);expect(planned.macroScope).toEqual({binding:null,reason});
 const p=await prepare(d);expect(p.previews.map(t=>t.kind)).toEqual(["source_intake"]);expect(p.qualityIssues).toContain(reason);
 const saved=await save(d),source=saved.steps[0],bytes=fs.readFileSync(path.join(vault,source.path),"utf8");
 const readers=await import("../vault/investment-research-context"),note=readers.indexedRead(source.path);
 expect(note.raw).toBe(bytes);expect(note.fm.macro_subject).toBeUndefined();expect(note.fm.source_kind).toBe(sourceKind);
 expect(note.fm.source_text_sha256).toBe(sha(d.extractedText));expect(note.fm.source_url).toBeNull();expect(note.fm.verification).toBe("not_reverified");
 expect((await import("../vault/research-decision-v2")).preservedSubmittedText(bytes)).toBe(d.extractedText);
 expect(readers.createReceipt("source_intake",source.path,bytes)).toBe(source.receiptKey);
 expect(saved.receipts[0]).toMatchObject({receipt:{afterHash:sha(bytes),path:source.path,readback:"verified",reindex:"verified"}});
 expect(source).toMatchObject({readbackVerified:true,indexed:true,searchable:true});
 expect((await import("../vault/queries")).searchVault("InvestmentIntake"+p.planId.slice(3),{limit:20}).hits.map(h=>h.path)).toContain(source.path);
 const retry=await prepare(d);expect(retry.planId).toBe(saved.planId);expect(retry.previews).toEqual([]);
 const repeated=await api.applyCanonicalWriteback({input:d,planId:retry.planId,authorizations:[]},actor);expect(repeated.receipts).toEqual([]);
 expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toHaveLength(1);
 // Even omitting or correcting the conflicting request hint cannot retrofit
 // a scope onto the immutable unscoped Source receipt.
 const corrected={...d,focus:"macro" as const};expect((await prepare(corrected)).previews).toEqual([]);
 expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toBe(bytes);
 expect((await packet()).body.history.map(h=>h.path)).not.toContain(source.path);
 const analysis={...d,captureOnly:undefined,researchReview:review,contentTypes:["other" as const],claims:[{
  entity:"Fictionland",metric:"declared_subject",value:"Fictionland",unit:"label",period:"synthetic fixture",
  evidenceClass:"reported_actual" as const,statement:"ข้อความจำลองระบุหัวข้อ Fictionland",sourceLocator:d.macroSubject!.anchor.locator,
  sourceExcerpt:d.macroSubject!.anchor.quote,verification:"unverified" as const}]};
 const workflow=router.planInvestmentWriteback(analysis).safeEditWorkflow!;
 expect(workflow.qualityIssues).toContain("macro_source_existing_scope_hold");expect(workflow.claimIssues).toContain("macro_source_existing_scope_hold");
 expect(workflow.steps.filter(t=>t.kind!=="source_intake").every(t=>t.safeEditRequest===null)).toBe(true);
 const w=await packet(analysis);expect(w.body.constraints).toContain("macro_source_existing_scope_hold");
 expect(w.body.coverage.retrieval.scope.macroScope).toBeUndefined();expect(w.body.macroHistoryPolicy).toBeUndefined();
 const held=await prepare({...analysis,researchJudge:{packet:w.packet}});expect(held.researchJudge?.decision).toBe("HOLD");
 expect(held.previews).toEqual([]);expect(held.steps.some(t=>t.kind==="structured_claim")).toBe(true);
 const result=await api.applyCanonicalWriteback({input:{...analysis,researchJudge:{packet:w.packet}},planId:held.planId,authorizations:[]},actor);
 expect(result.receipts).toEqual([]);expect(result.writeAttempts).toBe(0);
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Macro and Markets"))).toEqual([]);expect(snapshot()).toEqual(before);
 console.info("MACRO_L1_SOURCE_PRESERVATION",JSON.stringify({sourceKind,focus:focus??null,reason,sourcePath:source.path,
  sourceReceipt:source.receiptKey,sourceSha256:sha(bytes),nonSourceWrites:0,judgeDecision:held.researchJudge?.decision,protectedUnchanged:true}));
});
it("L1 broker history remains excluded across an existing real receipt",async()=>{
 // Also run against the frozen parent first using MACRO_COLD_ROOT to retain
 // its genuinely issued broker receipt, then inspect that same disposable
 // evidence with the successor. Never forge or rewrite old Source/DB bytes.
 const snapshot=l1ProtectedSnapshot(),before=snapshot(),d={...input(),sourceKind:"broker_research" as const,focus:"macro" as const};
 const p=await prepare(d);if(p.previews.length)await save(d);
 const source=p.steps[0],readers=await import("../vault/investment-research-context"),note=readers.indexedRead(source.path);
 expect(readers.createReceipt("source_intake",source.path,note.raw)).toBe(source.receiptKey);
 const priorSha=sha(note.raw),w=await packet();
 console.info("MACRO_L1_EXISTING_BROKER",JSON.stringify({sourcePath:source.path,receipt:source.receiptKey,sha256:priorSha,
  preservedLegacyScope:note.fm.macro_subject!==undefined,selected:w.body.history.some(h=>h.path===source.path)}));
 expect(w.body.history.map(h=>h.path)).not.toContain(source.path);
 expect(w.body.coverage.retrieval.status).toBe("operational_complete");
 expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toBe(note.raw);expect(snapshot()).toEqual(before);
});
it("L1 existing compatible receipt is immutable when a later focus conflicts",async()=>{
 const saved=await save(),source=saved.steps[0],bytes=fs.readFileSync(path.join(vault,source.path),"utf8"),d={...input(),focus:"general" as const};
 const p=await prepare(d);expect(p.planId).toBe(saved.planId);expect(p.qualityIssues).toContain("macro_history_scope_contract_hold");expect(p.previews).toEqual([]);
 const analysis={...d,captureOnly:undefined,researchReview:review},w=await packet(analysis);
 expect(w.body.constraints).toContain("macro_history_scope_contract_hold");expect(w.body.coverage.retrieval.scope.macroScope).toBeUndefined();
 expect((await prepare({...analysis,researchJudge:{packet:w.packet}})).researchJudge?.decision).toBe("HOLD");
 expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toBe(bytes);
 expect((await import("../vault/investment-research-context")).createReceipt("source_intake",source.path,bytes)).toBe(source.receiptKey);
 // Under a different compatible request the original valid scope stays valid.
 expect((await packet()).body.history.map(h=>h.path)).toContain(source.path);
});
it("L1 does not preserve unauthorized identity, extra metadata or another actor's token",async()=>{
 const api=await import("./canonical-writeback"),d={...input(),focus:"general" as const};
 await expect(prepare({...d,existingIntakeId:"IN-0000000000000000"})).rejects.toThrow(/M56_EXISTING_INTAKE_PROVENANCE_MISMATCH/);
 expect(()=>api.canonicalInputSchema.parse({...d,macroSubject:{...d.macroSubject,verified:true}})).toThrow();
 const p=await prepare(d);
 await expect(api.applyCanonicalWriteback({input:d,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},"oauth:wrong")).rejects.toThrow();
 expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Macro and Markets"))).toEqual([]);
});
it("L1 public read-only actor cannot use Source preservation as write permission",async()=>{
 const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read"]});
 const client=new Client({name:"macro-l1-read-only",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{const result=await client.callTool({name:"prepare_canonical_writeback",arguments:{...input(),focus:"general"}});expect(result.isError).toBe(true);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);expect(fs.readdirSync(path.join(vault,"10_Knowledge/Macro and Markets"))).toEqual([]);
 }finally{await client.close();await server.close();}
});

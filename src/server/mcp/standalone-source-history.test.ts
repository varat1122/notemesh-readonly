/** N3 disposable integration. Real canonical/Safe Edit receipts; simulated Judge verdicts test mechanical enforcement only. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";

import type {WritebackInput} from "../vault/investment-writeback-router";
import type {JudgeResult} from "../vault/research-judge";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const actor="oauth:normal-research-disposable",sha=(s:string)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const protectedPaths=["05_Thesis/TESTA - Current Thesis.md","05_Thesis/TESTA - Evidence Register.md","08_Daily_Weekly/Research Indexes/Company Evolution - TESTA.md","08_Daily_Weekly/Research Indexes/Investment Decision Ledger.md","06_Portfolio/Positions.md","06_Portfolio/Trades.md"];
const sourceN1="TESTA reported quarterly revenue of USD 100 million, up 10% YoY. Management stated that higher shipment volume supported growth.";
const reviewN1={headlineTh:"TESTA รายงานรายได้รายไตรมาส โดยฝ่ายบริหารอ้างปริมาณส่งมอบเป็นปัจจัยสนับสนุน",
 translationTh:"TESTA รายงานรายได้รายไตรมาส 100 ล้านดอลลาร์สหรัฐ เพิ่มขึ้น 10% จากปีก่อน ฝ่ายบริหารระบุว่าปริมาณการส่งมอบที่สูงขึ้นสนับสนุนการเติบโต",
 whatChangedTh:"ตามข้อความที่ได้รับ TESTA รายงานรายได้เพิ่มขึ้น 10% จากปีก่อน และฝ่ายบริหารระบุว่าปริมาณส่งมอบที่สูงขึ้นเป็นปัจจัยสนับสนุน ยังไม่มีเอกสารต้นฉบับมายืนยันโดยอิสระ",
 mechanismTh:"คำอธิบายว่าปริมาณส่งมอบสนับสนุนรายได้เป็นถ้อยแถลงของฝ่ายบริหาร ส่วนการส่งผ่านไปยังกำไรหรือ FCF เป็นการตีความที่ยังต้องตรวจราคา ต้นทุนและเงินทุนหมุนเวียนเพิ่มเติม ไม่ใช่ข้อเท็จจริงจากข้อความนี้",
 thesisImplicationTh:"ยังไม่ปรับ Thesis หรือมูลค่า เพราะไม่ทราบงวดบัญชีที่แน่นอน Margin และ Consensus ที่เปรียบเทียบได้ จึงไม่สรุปว่ารายได้ดีกว่าคาดหรือหุ้นราคาถูก",
 counterEvidenceTh:"ไม่มีหลักฐานแย้งที่ค้นพบใน fixture นี้ ความเสี่ยงว่าต้นทุนหรือราคาขายอาจหักล้างการเติบโตเป็นเพียงสมมติฐานที่ต้องตรวจ ไม่ใช่ข่าวแย้งที่ยืนยันแล้ว",
 requiredEvidenceTh:"ต้องตรวจเอกสารบริษัท งวดบัญชี ฐานเปรียบเทียบปีก่อน ราคาและต้นทุนต่อหน่วย ข้อมูลนี้เป็น synthetic fixture ไม่ใช่ข้อมูลการเงินจริงหรือการยืนยันจากหลักฐานปฐมภูมิ",
 claimAssessments:[{entity:"TESTA",metric:"revenue growth",period:"quarter unspecified",unit:"percent YoY",competingValues:["10%"],resolution:"unresolved" as const,conclusion:"conditional" as const}]};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic TESTA quarterly revenue",inputFormat:"text",sourceKind:"news_media",sourceLanguage:"en",sourceChannel:"news_media",sourceChat:"ORCH N1-N8 disposable fixture",publisher:"Synthetic news fixture",originalDocumentAccess:"not_obtained",sourceUrl:"https://example.org/ios-fixtures/n1",extractedText:sourceN1,contentTypes:["reported_fact"],researchReview:reviewN1,researchLineage:{knowledgeCutoffAsOf:null}};
const appearance=(key:string,channel="chat",n=1)=>({key,channel,locator:`fixture:${channel}/message/${n}`,receivedAt:`2026-11-08T08:0${n}:00Z`});
beforeEach(async()=>{vi.resetModules();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri001-normal-n-")));vault=path.join(root,"vault");
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY=Buffer.alloc(32,8).toString("base64");process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
 for(const key of ["NOTEMESH_MAINTENANCE","NOTEMESH_MAINTENANCE_RESUME","NOTEMESH_MAINTENANCE_RESUME_UNDRAINED"])delete process.env[key];
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 for(const p of ["01_Companies/TESTA.md","01_Companies/TESTB.md",...protectedPaths]){fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});
  fs.writeFileSync(path.join(vault,p),p.startsWith("01_")?`---\ntype: company_hub\n---\n# ${path.basename(p,".md")} synthetic fixture identity\n`:"# Protected disposable fixture\n");(await import("../vault/indexer")).reindexPath(p);}
});
afterEach(async()=>{for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Protected disposable fixture\n");
 (await import("../db")).db().close();vi.useRealTimers();vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];});
async function prepare(input:WritebackInput&{researchJudge?:unknown}){return (await import("./canonical-writeback")).prepareCanonicalWriteback(input,actor);}
async function apply(input:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);}
async function save(input:WritebackInput){return apply(input,await prepare(input));}

const oldInput:WritebackInput={...base,captureOnly:true,researchReview:undefined,sourceUrl:"https://example.org/n3/orders",topic:"TESTA orders",extractedText:"TESTA received an order for 100 units.",eventDate:"2026-11-01",publicationDate:"2026-11-01",appearance:appearance("prior")};
const nextInput:WritebackInput={...base,sourceUrl:"https://example.org/n3/orders",topic:"TESTA orders pilot shipment",extractedText:"TESTA announced a pilot shipment of 20 units.",eventDate:"2026-11-02",publicationDate:"2026-11-02",researchReview:{...reviewN1,claimAssessments:[],headlineTh:"TESTA ประกาศการส่งมอบนำร่องที่ยังต้องตรวจขอบเขต",translationTh:"TESTA ประกาศการส่งมอบนำร่องจำนวน 20 หน่วย",whatChangedTh:"ข้อมูลใหม่เป็นการส่งมอบนำร่อง ต้องตรวจว่าสัมพันธ์กับคำสั่งซื้อเดิมอย่างไรก่อนรวมตัวเลข",mechanismTh:"คำสั่งซื้อและการส่งมอบเป็นคนละขั้นตอน ยังไม่ใช่หลักฐานยืนยันรายได้หรือการเติบโตที่เป็นอิสระ",requiredEvidenceTh:"ต้องตรวจวันที่ ขอบเขตคำสั่งซื้อและการส่งมอบกับต้นทางก่อนสรุปเหตุการณ์หรือผลทางการเงิน"}};
async function packet(data=nextInput){const api=await import("./canonical-writeback"),j=await import("../vault/research-judge");return j.buildResearchJudgePacket(api.canonicalInputSchema.parse(data),actor);}
async function judged(data=nextInput){const built=await packet(data),body=JSON.parse(built.packet.body);
 const row=(key:string)=>({key,verdict:"PASS" as const,rationale:"Simulated mechanical assessment only; not economic equivalence or semantic acceptance",references:[{key:"received_source",quote:data.extractedText,locator:`utf16:0:${data.extractedText.length}`,sourceSha256:sha(data.extractedText)}],checks:{entailment:"PASS" as const,numbersUnits:"PASS" as const,periodRoleAttributionVintage:"PASS" as const,identityRelationships:"PASS" as const,pointInTime:"PASS" as const,independenceCounterEvidence:"PASS" as const,injectionCoverage:"PASS" as const}});
 const result:JudgeResult={packetId:built.packet.packetId,packetDigest:built.packet.digest,packetEnvelopeDigest:built.packetEnvelopeDigest,reviewDigest:body.reviewDigest,claims:body.claims.map((c:{key:string})=>row(c.key)),relationships:[],event:{...row("event"),classification:"new_event"},review:row("review"),materialRisk:false};
 return {...data,researchJudge:{packet:built.packet,result}};
}
it("N3 prior receipted Source-only is present in sealed history beside incoming Source",async()=>{
 const prior=await save(oldInput);expect(prior.receipts).toHaveLength(1);
 const {searchVault}=await import("../vault/queries");expect(searchVault("TESTA",{limit:20}).hits.some(h=>h.path===prior.steps[0].path)).toBe(true);
 const built=await packet(),body=JSON.parse(built.packet.body),history=body.history.find((h:{path:string})=>h.path===prior.steps[0].path);
 expect(history).toBeDefined();expect(history.sourceBinding.sourceFamily.canonicalUrl).toBe(body.source.url);expect(history.excerpt).toContain("100 units");expect(body.source.text).toContain("20 units");expect(history.excerpt).not.toContain("120");
 expect(history.researchTrust).toMatchObject({primary_authority:false,independent_evidence_increment:0,comparator_eligible:false});
});
async function rows(){const d=(await import("../db")).db();return {operations:d.prepare("SELECT * FROM safe_edit_operations ORDER BY id").all(),events:d.prepare("SELECT * FROM safe_edit_events ORDER BY rowid").all()};}
async function context(issuers=["TESTA"],extra={}){return (await import("../vault/investment-context")).buildInvestmentContextPack({question:"TESTA orders shipment",issuers,...extra});}
async function unchangedSource(prior:Awaited<ReturnType<typeof save>>,bytes:Buffer){expect(fs.readFileSync(path.join(vault,prior.steps[0].path))).toEqual(bytes);expect((await import("../vault/investment-research-context")).createReceipt("source_intake",prior.steps[0].path,bytes.toString())).toBe(prior.steps[0].receiptKey);}
it("receipt/index/original text/family/chronology/labels survive; aliases and repost do not multiply history",async()=>{
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"---\ntype: company_hub\naliases: [Test Alpha]\n---\n# TESTA\n");(await import("../vault/indexer")).reindexPath("01_Companies/TESTA.md");
 const prior=await save(oldInput),bytes=fs.readFileSync(path.join(vault,prior.steps[0].path));await save({...oldInput,appearance:appearance("repost")});const journal=await rows();
 const c=await context(["TESTA","Test Alpha"]),items=c.items.filter(i=>i.path===prior.steps[0].path);expect(items).toHaveLength(1);
 expect(items[0].sourceBinding).toMatchObject({status:"receipted_source_only",sourceReceiptId:prior.steps[0].receiptKey,receivedTextSha256:sha(oldInput.extractedText),eventDate:"2026-11-01",publicationDate:"2026-11-01",independentEvidenceIncrement:0,primaryVerification:"not_performed",subjectRole:"not_established",sourceFamily:{canonicalUrl:oldInput.sourceUrl,economicEventEquivalence:"not_established"}});
 expect(c.incomplete).toContain("No original issuer/filing source selected; primary claim verification required.");
 expect(items[0].researchTrust).toMatchObject({primary_authority:false,comparator_eligible:false,independent_evidence_increment:0});
 expect(await rows()).toEqual(journal);await unchangedSource(prior,bytes);
});
it.each(["wrong issuer","substring","publisher only","wrong path","forged metadata"])("%s cannot become receipted standalone history",async fault=>{
 const text=fault==="substring"?"TESTAX received an order for 100 units.":"TESTB received an order for 100 units.";
 const p=await save({...oldInput,entities:["TESTB"],extractedText:fault==="wrong path"||fault==="forged metadata"?oldInput.extractedText:text,publisher:"TESTA"});
 if(fault==="wrong path"){const target="00_Inbox/ChatGPT/Not a canonical source.md";fs.copyFileSync(path.join(vault,p.steps[0].path),path.join(vault,target));fs.unlinkSync(path.join(vault,p.steps[0].path));(await import("../vault/indexer")).reindexPath(p.steps[0].path);(await import("../vault/indexer")).reindexPath(target);}
 if(fault==="forged metadata"){const file=path.join(vault,p.steps[0].path);fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace("verification: not_reverified","verification: verified_against_primary\nissuer: TESTA"));(await import("../vault/indexer")).reindexPath(p.steps[0].path);}
 const c=await context();expect(c.items.some(i=>i.sourceBinding)).toBe(false);
 if(fault==="forged metadata")expect(c.retrieval.status).toBe("operational_hold");
});
it("ambiguous alias cannot grant standalone issuer scope",async()=>{
 await save(oldInput);fs.writeFileSync(path.join(vault,"01_Companies/TESTB.md"),"---\ntype: company_hub\naliases: [TESTA]\n---\n# TESTB\n");(await import("../vault/indexer")).reindexPath("01_Companies/TESTB.md");
 const c=await context();expect(c.issuerResolution[0].status).toBe("ambiguous_hold");expect(c.items.some(i=>i.sourceBinding)).toBe(false);
 const data=await judged();expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");
});
async function corrupt(prior:Awaited<ReturnType<typeof save>>,fault:string){
 const p=prior.steps[0].path,file=path.join(vault,p),d=(await import("../db")).db();
 if(fault==="missing")fs.unlinkSync(file);
 if(fault==="changed"){fs.appendFileSync(file,"\nchanged received evidence\n");(await import("../vault/indexer")).reindexPath(p);}
 if(fault==="symlink"){const outside=path.join(root,"outside.md");fs.renameSync(file,outside);fs.symlinkSync(outside,file);}
 if(fault==="receipt")d.prepare("UPDATE safe_edit_operations SET receipt='{}' WHERE id=?").run(prior.steps[0].receiptKey);
 if(fault==="fts")d.prepare("UPDATE notes_fts SET body='TESTA corrupt index InvestmentIntake"+prior.planId.slice(3)+"' WHERE path=?").run(p);
 if(fault==="metadata")d.prepare("UPDATE notes SET frontmatter='{}' WHERE path=?").run(p);
}
it.each(["missing","changed","symlink","receipt","fts","metadata"])("selected Source %s after PASS denies canonical AND generic non-Source admission",async fault=>{
 const prior=await save(oldInput),data=await judged(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");await corrupt(prior,fault);
 const engine=await import("../safe-edit/engine"),t=p.previews.find(s=>s.kind==="canonical_review")!;
 expect(()=>engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(/research_judge/);
 const held=await prepare(data);expect(held.researchJudge?.decision).toBe("HOLD");expect(held.previews.every(x=>x.kind==="source_intake")).toBe(true);
 await expect(apply(data,p)).rejects.toThrow();expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
});
it.each(["missing","changed","receipt","fts"])("unavailable prospective Source %s is an operational failure, not a silent omission",async fault=>{
 const prior=await save(oldInput);await corrupt(prior,fault);const data=await judged(),body=JSON.parse(data.researchJudge.packet.body);
 expect(body.coverage.retrieval.status).toBe("operational_hold");expect(body.coverage.retrieval.failures).toContainEqual(expect.objectContaining({stage:"standalone_source",path:prior.steps[0].path}));
 expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");
});
it("newly relevant receipted Source changes the sealed selection and invalidates prior PASS",async()=>{
 const data=await judged(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");const prior=await save(oldInput);
 const fresh=JSON.parse((await packet()).packet.body);expect(fresh.history.some((h:{path:string})=>h.path===prior.steps[0].path)).toBe(true);
 const engine=await import("../safe-edit/engine"),t=p.previews.find(s=>s.kind==="canonical_review")!;expect(()=>engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor)).toThrow(/research_judge/);
 expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
});
it("own exact Source write and unrelated external evidence do not cause false HOLD; normal Draft remains eligible",async()=>{
 const prior=await save(oldInput),bytes=fs.readFileSync(path.join(vault,prior.steps[0].path));const data=await judged(),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");
 await save({...oldInput,appearance:undefined,entities:["TESTB"],extractedText:"TESTB received orders for 50 units.",sourceUrl:"https://example.org/unrelated"});
 const engine=await import("../safe-edit/engine"),source=p.previews[0];engine.apply({operationId:source.operationId,previewToken:source.previewToken,expectedHash:source.beforeHash},actor);
 const retry=await prepare(data);expect(retry.researchJudge?.decision).toBe("PASS");const saved=await apply(data,retry);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(1);await unchangedSource(prior,bytes);
 const normal=await save({...base,sourceUrl:"https://example.org/ungated-n3",appearance:undefined});expect(normal.status).toBe("saved_verified");expect(normal.researchJudge).toBeNull();
});
it("added_detail retains critic HOLD even with both Sources visible, while Source-only preservation remains eligible",async()=>{
 await save(oldInput);const data=await judged();data.researchJudge.result.event.classification="added_detail";data.researchJudge.result.materialRisk=true;
 const body=JSON.parse(data.researchJudge.packet.body);expect(body.history.some((h:{excerpt:string})=>h.excerpt.includes("100 units"))).toBe(true);expect(body.source.text).toContain("20 units");
 const p=await prepare(data);expect(p.researchJudge?.decision).toBe("HOLD");expect(p.researchJudge?.reasons).toContain("independent_critic_provenance_unavailable");const saved=await apply(data,p);expect(saved.receipts).toHaveLength(1);expect(saved.steps.filter(s=>s.kind!=="source_intake").every(s=>!s.readbackVerified)).toBe(true);
});
it("valid no-URL/no-appearance historical Source remains eligible and is not upgraded to a publisher",async()=>{
 const prior=await save({...oldInput,sourceUrl:null,appearance:undefined}),body=JSON.parse((await packet()).packet.body);
 expect(body.history.find((h:{path:string})=>h.path===prior.steps[0].path).sourceBinding).toMatchObject({sourceFamily:{canonicalUrl:null},primaryVerification:"not_performed",provenance:{authority:"receipt_preserves_attribution_not_source_authenticity"}});
});
it("generic unreceipted spoof cannot enter history even with canonical filename/type/issuer",async()=>{
 const file="00_Inbox/ChatGPT/Investment Intake - IN-0000000000000001.md",text=oldInput.extractedText;
 fs.writeFileSync(path.join(vault,file),`---\ntype: investment_source_intake\nissuer: TESTA\nintake_id: IN-0000000000000001\nsource_text_sha256: ${sha(text)}\n---\nSource token: InvestmentIntake0000000000000001\n\n## User-supplied original language text\n\n\`\`\`text\n${text}\n\`\`\`\n`);(await import("../vault/indexer")).reindexPath(file);
 const c=await context();expect(c.items.some(x=>x.path===file)).toBe(false);expect(c.retrieval.status).toBe("operational_hold");
});
it("Source read changes between discovery and selection remain a recorded operational HOLD",async()=>{
 const prior=await save(oldInput),notes=await import("../vault/notes"),read=notes.readNote;let count=0;
 const spy=vi.spyOn(notes,"readNote").mockImplementation((p)=>{const n=read(p);if(p===prior.steps[0].path&&++count>=2)return {...n,content:n.content.replace("100 units","999 units")};return n;});
 try{const c=await context();expect(c.retrieval.status).toBe("operational_hold");expect(c.items.some(x=>x.path===prior.steps[0].path)).toBe(false);}finally{spy.mockRestore();}
});
it("deterministic bounded omissions and unselected changes do not invalidate unchanged effective selection",async()=>{
 for(let i=0;i<18;i++)await save({...oldInput,appearance:undefined,sourceUrl:`https://example.org/n3/bounded/${i}`,extractedText:`TESTA prior orders fixture ${i}: 100 units.`});
 const data=await judged(),body=JSON.parse(data.researchJudge.packet.body),p=await prepare(data);expect(p.researchJudge?.decision).toBe("PASS");
 expect(body.coverage.standaloneSources[0]).toMatchObject({complete:false,reasons:["standalone_source_candidate_limit"]});expect(body.coverage.retrieval.status).toBe("operational_complete");
 const selected=new Set(body.history.map((h:{path:string})=>h.path));const scanned=body.coverage.standaloneSources[0].paths as string[];
 const unselected=scanned.find(file=>!selected.has(file))!;expect(unselected).toBeTruthy();
 // An unrelated issuer is outside scope; a valid new Source beyond the
 // deterministic candidate window is an intentional omission, not a failure.
 await save({...oldInput,entities:["TESTB"],appearance:undefined,sourceUrl:"https://example.org/bounded/unrelated",extractedText:"TESTB received 10 units."});
 const identity=await import("../vault/source-identity-m56");
 let omittedInput:typeof oldInput|undefined;
 for(let i=0;i<500;i++){
   const candidate={...oldInput,appearance:undefined,extractedText:`TESTA omitted candidate ${i}: 100 units.`,sourceUrl:`https://example.org/omitted/${i}`};
   const id=identity.resolveSourceIdentityM56({...candidate,eventDate:candidate.eventDate!,publicationDate:candidate.publicationDate!}).planId;
   if(`00_Inbox/ChatGPT/Investment Intake - ${id}.md`>scanned.at(-1)!){omittedInput=candidate;break;}
 }
 expect(omittedInput).toBeDefined();await save(omittedInput!);
 const scope=await import("../vault/research-judge-scope"),gate=(await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)!;
 expect(scope.judgeScopeCurrent(body.scopeWitness,body.coverage.retrieval,gate.targets,p.planId,actor)).toBe(true);
 const saved=await apply(data,p);expect(saved.status).toBe("saved_verified");
});
it("same-intake Source and Claims can finish through generic admission without history self-write drift",async()=>{
 await save(oldInput);const data=await judged({...nextInput,claims:[{entity:"TESTA",metric:"pilot shipment",value:"20",unit:"units",period:"unspecified",evidenceClass:"unverified_claim",statement:"Attributed fixture statement, not verified",sourceExcerpt:nextInput.extractedText,sourceLocator:"fixture sentence",verification:"unverified"}]});const p=await prepare(data);
 expect(p.researchJudge?.decision).toBe("PASS");expect(p.previews.map(x=>x.kind)).toEqual(["source_intake","structured_claim","canonical_review"]);
 const engine=await import("../safe-edit/engine");for(const t of p.previews)engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor);
 expect((await prepare(data)).workflowStatus).toBe("saved_verified");expect((await apply(data,await prepare(data))).receipts).toHaveLength(0);
});
it("fresh historical Source citation uses exact full-note SHA/UTF-16 offsets, never a fabricated locator",async()=>{
 const prior=await save(oldInput),data=await judged(),body=JSON.parse(data.researchJudge.packet.body),h=body.history.find((x:{path:string})=>x.path===prior.steps[0].path),raw=fs.readFileSync(path.join(vault,h.path),"utf8"),start=raw.indexOf(oldInput.extractedText);
 data.researchJudge.result.event.references=[{key:h.key,quote:oldInput.extractedText,locator:`utf16:${start}:${start+oldInput.extractedText.length}`,sourceSha256:h.sha256}];expect((await prepare(data)).researchJudge?.decision).toBe("PASS");
 data.researchJudge.result.event.references[0].locator="utf16:0:4";expect((await prepare(data)).researchJudge?.decision).toBe("HOLD");
});
it("explicit readback-verified alias locates original text without inventing instrument equivalence",async()=>{
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"---\ntype: company_hub\naliases: [Test Alpha]\n---\n# TESTA\n");(await import("../vault/indexer")).reindexPath("01_Companies/TESTA.md");
 const prior=await save({...oldInput,extractedText:"Test Alpha received an order for 100 units."}),body=JSON.parse((await packet()).packet.body);
 expect(body.history.find((h:{path:string})=>h.path===prior.steps[0].path).sourceBinding).toMatchObject({contextKeys:["TESTA"],matchedLabels:["Test Alpha"],subjectRole:"not_established"});
});
it("fresh packet and assessment can recover after newly relevant Source invalidates an earlier envelope",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.parse("2026-11-08T10:00:00Z"));
 const old=await judged(),p=await prepare(old);await save(oldInput);vi.setSystemTime(Date.now()+1000);
 expect((await prepare(old)).researchJudge?.decision).toBe("HOLD");await expect(apply(old,p)).rejects.toThrow();vi.setSystemTime(Date.now()+1000);
 const fresh=await judged();expect(fresh.researchJudge.packet.digest).not.toBe(old.researchJudge.packet.digest);const next=await prepare(fresh);expect(next.researchJudge?.decision).toBe("PASS");expect((await apply(fresh,next)).status).toBe("saved_verified");
});
it("an existing Review with broken binding cannot relabel its Source as standalone to bypass bundle HOLD",async()=>{
 const saved=await save({...base,sourceUrl:"https://example.org/n3/paired"}),review=saved.steps.find(s=>s.kind==="canonical_review")!,source=saved.steps[0];
 const d=(await import("../db")).db();d.prepare("DELETE FROM links WHERE source_path=?").run(review.path);
 const c=await context();expect(c.contextBundles.find(b=>b.reviewPath===review.path)?.status).toBe("HOLD");expect(c.items.some(i=>i.path===source.path&&i.sourceBinding)).toBe(false);
});

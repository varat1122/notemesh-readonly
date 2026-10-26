import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";

let root:string,vault:string;
const actor="oauth:m53-synthetic";
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"investment-m53-")));
  vault=path.join(root,"vault");
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","02_Industries_Themes",
    "10_Knowledge/Company Research","10_Knowledge/Industry and Concepts",
    "10_Knowledge/Macro and Markets","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";
  process.env.SAFE_EDIT_SINGLE_WRITER="1";
  vi.resetModules();
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];
});
async function seed(notePath:string,content:string){
  const absolute=path.join(vault,notePath);
  fs.mkdirSync(path.dirname(absolute),{recursive:true});
  fs.writeFileSync(absolute,content,"utf8");
  const {reindexPath}=await import("./indexer");
  reindexPath(notePath);
}
const news={domain:"industry" as const,entities:["SK hynix","Samsung Electronics","Micron","Kioxia"],
  themes:["Memory"],entityRoles:[
    {entity:"SK hynix",role:"covered_company" as const},
    {entity:"Samsung Electronics",role:"covered_company" as const},
    {entity:"Micron",role:"covered_company" as const},
    {entity:"Kioxia",role:"covered_company" as const}
  ],contentTypes:["analyst_opinion","industry_data"] as ("analyst_opinion"|"industry_data")[],
  topic:"JPMorgan Memory HBM4 QLC investor commentary",inputFormat:"screenshot" as const,
  sourceKind:"broker_research" as const,sourceLanguage:"en",
  eventDate:"2026-10-22",publicationDate:"2026-10-23",publisher:"J.P. Morgan (user-attributed)",
  extractedText:"User-supplied English excerpt: Memory pricing and HBM4 yield vary by producer. Yield concern is market noise, not confirmed company fact.",
  sourceChat:"Micro 251026",completedAnalysis:"## Investment takeaway\nASP growth deceleration can affect EPS revisions. HBM4 yield risks are unresolved; no verified thesis change."
};
async function applyRecipe(plan:Awaited<ReturnType<typeof route>>){
  const {preview,apply}=await import("../safe-edit/engine");
  const written=[];
  for(const step of plan.safeEditWorkflow?.steps??[]){
    if(!step.safeEditRequest)continue;
    const p=preview(step.safeEditRequest,actor);
    expect(fs.existsSync(path.join(vault,step.path))).toBe(false);
    const receipt=apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);
    expect(receipt).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified",
      mobileSync:"unverified",remoteSync:"unverified"}});
    written.push(step.path);
  }
  return written;
}
async function route(input:typeof news|Record<string,unknown>){
  const {planInvestmentWriteback}=await import("./investment-writeback-router");
  return planInvestmentWriteback(input as typeof news);
}

describe("M5.5.1 contradiction claim pre-write safety",()=>{
 it("preserves Source preview but holds an unsupported confirmed Guidance Review",async()=>{
  await seed("01_Companies/MU.md","# MU\n");
  await seed("02_Industries_Themes/Memory.md","# Memory\n");
  const r={headlineTh:"ข่าวสมมติ MU มีข้ออ้าง Guidance สวนทางกัน",
    translationTh:"ข่าวทดสอบเท่านั้น แหล่ง A อ้าง +20% แหล่ง B อ้าง -20%",
    whatChangedTh:"ข่าว A และ B อ้างการเปลี่ยน Guidance ในงวดเดียวกัน",
    mechanismTh:"ผลต่อรายได้และกำไรจะขึ้นกับ Guidance จริง",
    thesisImplicationTh:"ไม่มีผลต่อ Thesis ที่ยืนยันแล้ว",
    counterEvidenceTh:"คำกล่าวสองแหล่งขัดแย้งกันและยังไม่มีเอกสารต้นฉบับ",
    requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและวันที่ประกาศ",
    claimAssessments:[{metric:"revenue guidance",period:"FY2027",unit:"% YoY",
      competingValues:["+20%","-20%"],resolution:"verified_primary",conclusion:"confirmed"}]};
  const input={domain:"company",entities:["MU"],topic:"Synthetic contradictory Guidance",
    inputFormat:"text",sourceKind:"user_commentary",sourceChat:"M55 P0 Synthetic Regression",
    extractedText:"SYNTHETIC ONLY: MU FY2027 +20% vs -20% guidance; neither verified.",
    sourceLanguage:"en",contentTypes:["guidance"],entityRoles:[{entity:"MU",role:"primary_subject"}],
    themes:["Memory"],sourceChannel:"synthetic_test",originalDocumentAccess:"not_obtained",researchReview:r};
  const held=await route(input);
  expect(held.safeEditWorkflow?.status).toBe("hold_research_quality");
  expect(held.safeEditWorkflow?.steps.map(s=>s.state)).toEqual(["needs_create","hold_quality_gate"]);
  expect(held.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
  expect(held.safeEditWorkflow?.qualityIssues).toContain("conflicting_claims_unresolved");
  const valid=await route({...input,researchReview:{...r,claimAssessments:[{
    ...r.claimAssessments[0],resolution:"unresolved",conclusion:"no_change"}]}});
  expect(valid.safeEditWorkflow?.qualityIssues).toEqual([]);
  expect(valid.safeEditWorkflow?.steps[1].state).toBe("needs_create");
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
 });
 it("requires an autonomous unresolved decision for guidance even when the caller spoofs reported_fact",async()=>{
  await seed("01_Companies/MU.md","# MU\n");
  await seed("02_Industries_Themes/Memory.md","# Memory\n");
  const base={domain:"company",entities:["MU"],topic:"Synthetic source-text guidance",
    inputFormat:"text",sourceKind:"issuer_release",sourceChat:"M55 Autonomous Regression",
    extractedText:"Synthetic only: MU FY2027 revenue guidance +20% according to A, -20% according to B.",
    sourceLanguage:"en",contentTypes:["reported_fact"],
    entityRoles:[{entity:"MU",role:"primary_subject"}],themes:["Memory"],
    sourceChannel:"synthetic_test",originalDocumentAccess:"not_obtained",
    researchReview:{headlineTh:"ข้อความทดสอบแนวโน้ม MU ขัดแย้งกัน",translationTh:"แหล่ง A อ้าง +20% แต่ B อ้าง -20%",
      whatChangedTh:"ยังไม่พบเอกสารต้นฉบับของ Guidance",mechanismTh:"ผลต่อรายได้ยังไม่แน่นอน",
      thesisImplicationTh:"ยังไม่ปรับ Thesis",counterEvidenceTh:"ข้ออ้างสองแหล่งขัดกัน",
      requiredEvidenceTh:"ตรวจต้นฉบับและวันที่"}};
  const blocked=await route(base);
  expect(blocked.safeEditWorkflow?.qualityIssues).toContain("source_text_guidance_assessment_missing");
  expect(blocked.safeEditWorkflow?.steps.map(s=>s.state)).toEqual(["needs_create","hold_quality_gate"]);
  const allowed=await route({...base,researchReview:{...base.researchReview,claimAssessments:[{
    entity:"MU",metric:"revenue guidance",period:"FY2027",unit:"% YoY",
    competingValues:["+20%","-20%"],resolution:"unresolved",conclusion:"conditional"}]}});
  expect(allowed.safeEditWorkflow?.qualityIssues).toEqual([]);
  expect(allowed.safeEditWorkflow?.steps.map(s=>s.state)).toEqual(["needs_create","needs_create"]);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toEqual([]);
 });
});

describe("M5.6 source identity and immutable legacy receipt linking",()=>{
 const original="Truist: We view the softness in $CRWV and $NBIS shares as a buying opportunity\n\n• Compute supply constrained through 2028\n• $10M/MW on long-term deals";
 const oldId="IN-1A96025E6CFD35D9";
 const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
 const review={headlineTh:"ข้อความที่อ้างถึง Truist กล่าวถึง Pricing Power ของ AI Cloud",
  translationTh:"Truist มองการอ่อนตัวของหุ้น CRWV และ NBIS เป็นโอกาสซื้อ โดยกล่าวถึงข้อจำกัด Compute ถึงปี 2028 และสัญญายาว $10M/MW",
  whatChangedTh:"เป็นรายละเอียดต่อ Narrative เดิม แต่ยังไม่ตรวจรายงานต้นฉบับ",
  mechanismTh:"Demand และ Utilization แปลงเป็น Revenue/MW ก่อนหัก Depreciation และต้นทุนเงินทุน",
  thesisImplicationTh:"ยังไม่ปรับ Thesis หรือราคาเป้าหมายจนกว่าจะทราบ Realized Pricing และ FCF",
  counterEvidenceTh:"การขยาย Capacity ต้องใช้ CapEx สูงและต้นทุนดอกเบี้ยอาจกดกำไร",
  requiredEvidenceTh:"ต้องตรวจรายงาน Truist ต้นฉบับและนิยามสัญญาต่อ MW"};
 const base={domain:"company" as const,entities:["NBIS","CRWV"],topic:"AI Cloud pricing",
  inputFormat:"text" as const,sourceKind:"social_repost" as const,sourceLanguage:"en",
  extractedText:original,sourceChat:"MICRO Test 2",publisher:"Truist attributed",
  themes:["AI Infrastructure"],entityRoles:[{entity:"NBIS",role:"covered_company" as const},{entity:"CRWV",role:"covered_company" as const}],
  contentTypes:["analyst_opinion"],sourceChannel:"social_repost",attributedOrigin:"Truist attributed",
  originalDocumentAccess:"not_obtained" as const,researchReview:review};
 async function legacy(id=oldId,attachmentPath?:string){
  const source=["---","type: investment_source_intake","source_type: user_supplied",
   `intake_id: "${id}"`,`source_chat: "MICRO Test 2"`,"source_kind: \"social_repost\"",
   `input_format: "${attachmentPath?"screenshot":"text"}"`,"source_url: null","event_date: null","published_at: null",
   `attachment_status: "${attachmentPath?"hash_readback_verified_user_bytes":"not_verified"}"`,
   `attachment_path: ${attachmentPath?JSON.stringify(attachmentPath):"null"}`,`source_text_sha256: ${sha(original)}`,"---","",
   `# Attributed User Source — ${id}`,"",`Source token: InvestmentIntake${id.slice(3)}`,
   "","## User-supplied original language text","","```text",original,"```",""] .join("\n");
  await seed(`00_Inbox/ChatGPT/Investment Intake - ${id}.md`,source);
  return source;
 }
 it("links the original Source across company→industry, entity reorder and publisher drift without rewriting Source",async()=>{
  for(const ticker of ["NBIS","CRWV"])await seed(`01_Companies/${ticker}.md`,`# ${ticker}\n`);
  await seed("02_Industries_Themes/AI Infrastructure.md","# AI Infrastructure\n");
  await seed("05_Thesis/NVDA - Current Thesis.md","# Protected thesis\n");
  const preserved=await legacy();
  const changed={...base,domain:"industry" as const,entities:["CRWV","NBIS"],
   entityRoles:[{entity:"CRWV",role:"covered_company" as const},{entity:"NBIS",role:"covered_company" as const}],
   publisher:"Truist Securities (attributed; unverified)",topic:"Reclassified sector view"};
  const p=await route(changed);
  expect(p.planId).toBe(oldId);
  expect(p.sourceIdentity.mode).toBe("linked_existing");
  expect(p.safeEditWorkflow?.qualityIssues).toEqual([]);
  expect(p.safeEditWorkflow?.steps.map(s=>s.state)).toEqual(["verified_existing","needs_create"]);
  expect(p.safeEditWorkflow?.steps[0].safeEditRequest).toBeNull();
  await applyRecipe(p);
  const verified=await route(changed);
  expect(verified.safeEditWorkflow?.status).toBe("saved_verified");
  expect(fs.readFileSync(path.join(vault,`00_Inbox/ChatGPT/Investment Intake - ${oldId}.md`),"utf8")).toBe(preserved);
  expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected thesis\n");
 });
 it("makes v3 identity independent of domain, entity order, publisher and analysis",async()=>{
  const a=await route(base),b=await route({...base,domain:"industry",entities:["CRWV","NBIS"],publisher:"Changed attribution",topic:"Changed topic"});
  expect(a.planId).toBe(b.planId);
  expect(a.sourceIdentity.mode).toBe("new_v3");
  expect((await route({...base,eventDate:"2026-10-15"})).planId).not.toBe(a.planId);
  expect((await route({...base,sourceUrl:"https://example.org/repost"})).planId).not.toBe(a.planId);
 });
 it("rejects forged existingIntakeId and ambiguous duplicate legacy receipts",async()=>{
  await legacy();
  await expect(route({...base,existingIntakeId:"IN-FFFFFFFFFFFFFFFF"})).rejects.toThrow("M56_EXISTING_INTAKE_PROVENANCE_MISMATCH");
  expect((await route({...base,existingIntakeId:oldId})).sourceIdentity.mode).toBe("explicit_existing");
  await legacy("IN-AAAAAAAAAAAAAAAA");
  await expect(route(base)).rejects.toThrow("M56_AMBIGUOUS_EXISTING_SOURCE");
  expect((await route({...base,existingIntakeId:oldId})).planId).toBe(oldId);
 });
 it("holds conflicting source type or format instead of double-counting the same text",async()=>{
  await legacy();
  await expect(route({...base,sourceKind:"broker_research"})).rejects.toThrow("M56_SOURCE_PROVENANCE_CONFLICT");
  await expect(route({...base,inputFormat:"pdf"})).rejects.toThrow("M56_SOURCE_PROVENANCE_CONFLICT");
 });
 it("reuses an attachment-backed Source only for the same verified attachment path",async()=>{
  const attachment="00_Inbox/ChatGPT/attachments/sha256-abc123.png";
  await legacy(oldId,attachment);
  const {resolveSourceIdentityM56}=await import("./source-identity-m56");
  const input={extractedText:original,inputFormat:"screenshot",sourceKind:"social_repost",
    eventDate:null,publicationDate:null,rawAttachmentSha256:"f".repeat(64),verifiedAttachmentPath:attachment};
  expect(resolveSourceIdentityM56(input)).toMatchObject({planId:oldId,mode:"linked_existing"});
  expect(()=>resolveSourceIdentityM56({...input,verifiedAttachmentPath:"different-path"})).toThrow("M56_SOURCE_PROVENANCE_CONFLICT");
 });
});

describe("M5.6.2 Solidigm Thai/English same-event Source Receipt relation (synthetic Vault fixture)",()=>{
 const thai="00_Inbox/ChatGPT/Investment Intake - IN-4AF8FD0215D3A798.md";
 const english="00_Inbox/ChatGPT/Investment Intake - IN-B637DC6926EBA011.md";
 const review="10_Knowledge/Industry and Concepts/Investment Review - Cross Theme - IN-4AF8FD0215D3A798.md";
 const source=(id:string,url:string,lang:string)=>[
  "---","type: investment_source_intake",`intake_id: "${id}"`,
  "source_kind: \"news_media\"",`source_language: "${lang}"`,
  `source_url: "${url}"`,`event_date: "2026-10-23"`,`published_at: "2026-10-23"`,
  "---","# Original user-supplied source receipt",""] .join("\n");
 const request={reviewPath:review,additionalSourcePath:english,
  eventAnchor:"sk-hynix-solidigm-ipo-cancellation",
  comparisonBasis:"Both user-supplied Investing.com language editions describe the Oct. 23 Solidigm IPO decision and the same LYNX NAND-capacity scenario; not a second economic event.",
  linkedOnDate:"2026-10-26"};
 it("previews an append-only related Source receipt, CAS-applies once and never edits protected notes",async()=>{
  await seed(thai,source("IN-4AF8FD0215D3A798","https://th.investing.com/news/stock-market-news/article-810087","th"));
  await seed(english,source("IN-B637DC6926EBA011","https://www.investing.com/news/stock-market-news/micron-sandisk-gain-as-sk-hynix-scraps-solidigm-ipo-lynx-says-4970053","en"));
  await seed(review,["---","type: investment_research_review",`intake_id: "IN-4AF8FD0215D3A798"`,
   `original_source_path: "${thai}"`,"---","# Solidigm annotated historical review", "## Source provenance",
   `- Exact Source: [[${thai.slice(0,-3)}]]`,"","## Research analysis","Unchanged synthetic review content.",""] .join("\n"));
  await seed("05_Thesis/NVDA - Current Thesis.md","# Protected thesis fixture\n");
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const plan=planDuplicateSourceLinkM56(request);
  expect(plan).toMatchObject({status:"requires_safe_edit_preview",writePerformed:false});
  expect(plan.safeEditRequest?.change.kind).toBe("append");
  expect(plan.safeEditRequest?.change.content).toContain("not independent confirmation");
  const {preview,apply}=await import("../safe-edit/engine");
  const prepared=preview(plan.safeEditRequest!,actor);
  expect(prepared.beforeHash).toBe(plan.reviewVersionSha256);
  const applied=apply({operationId:prepared.operationId,previewToken:prepared.previewToken,
   expectedHash:prepared.beforeHash},actor);
  expect(applied.receipt).toMatchObject({write:"written",readback:"verified",reindex:"verified"});
  const later=planDuplicateSourceLinkM56(request);
  expect(later.status).toBe("already_linked");
  expect(later.safeEditRequest).toBeNull();
  const content=fs.readFileSync(path.join(vault,review),"utf8");
  expect(content).toContain(`[[${english.slice(0,-3)}]]`);
  expect(content).toContain("Unchanged synthetic review content.");
  expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected thesis fixture\n");
 });
 it("rejects a date mismatch or unrelated publisher without inventing event equivalence",async()=>{
  await seed(thai,source("IN-4AF8FD0215D3A798","https://th.investing.com/news/stock-market-news/article-810087","th"));
  await seed(english,source("IN-B637DC6926EBA011","https://www.investing.com/news/stock-market-news/item-123","en").replaceAll("2026-10-23","2026-10-24"));
  await seed(review,["---","type: investment_research_review",`intake_id: "IN-4AF8FD0215D3A798"`,
   `original_source_path: "${thai}"`,"---","## Source provenance",`- [[${thai.slice(0,-3)}]]`,""] .join("\n"));
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  expect(()=>planDuplicateSourceLinkM56(request)).toThrow("M56_RELATION_CHRONOLOGY_MISMATCH");
 });
});

describe("M5.3 canonical Safe Edit recipes and verified ChatGPT readiness",()=>{
 it("M55-JPM real X excerpt: missing structured classification saves Source only, repair yields Thai Memory Review",async()=>{
  for(const company of ["MU","SK hynix","Samsung"])await seed(`01_Companies/${company}.md`,`# ${company}\n`);
  await seed("02_Industries_Themes/Memory.md","# Memory\n");
  const excerpt="JP Morgan on historical memory boom/bust cycles for $MU -25% $SKHY - 59% and Samsung -42% which is historically the bottom. \n\nThese companies have returned 1361% in the past year on average.\n";
  const review={headlineTh:"ข้อความ X ที่อ้าง JPMorgan กล่าวถึงรอบลงของหุ้น Memory",
    translationTh:"ผู้โพสต์อ้างว่าหุ้น MU ลดลง 25%, SK hynix 59%, Samsung 42% และอ้างว่าผลตอบแทนเฉลี่ยในปีที่ผ่านมาเท่ากับ 1,361% โดยยังไม่พบรายงานต้นฉบับ",
    whatChangedTh:"เป็นข้อความอ้างอิงจาก X ยังไม่ยืนยันว่าเป็นเหตุการณ์ใหม่",
    mechanismTh:"หาก ASP ของหน่วยความจำเปลี่ยน อาจมีผลต่อรายได้และกำไร แต่ไม่มีข้อมูลประมาณการยืนยัน",
    thesisImplicationTh:"ยังไม่ปรับ Thesis หรือสรุปว่าราคาถึงจุดต่ำสุด",
    counterEvidenceTh:"ช่วงเวลาของผลตอบแทนและสถิติรอบลงยังไม่ได้ตรวจจากต้นทาง",
    requiredEvidenceTh:"ต้องตรวจรายงาน JPMorgan ต้นฉบับและชุดราคาที่ปรับ Corporate Action แล้ว"};
  const base={domain:"industry" as const,entities:["MU","SK hynix","Samsung"],topic:"Memory boom bust X repost",
    inputFormat:"text" as const,sourceKind:"social_repost" as const,sourceLanguage:"en",sourceChat:"MICRO 261026",
    publisher:"RealNickMugalli X repost attributing J.P. Morgan",sourceChannel:"social_repost",
    attributedOrigin:"J.P. Morgan",originalDocumentAccess:"excerpt_only" as const,
    sourceUrl:"https://x.com/RealNickMugalli/status/2114375124875141299",
    extractedText:excerpt,researchReview:review};
  const held=await route(base);
  expect(held.safeEditWorkflow?.status).toBe("hold_research_quality");
  expect(held.safeEditWorkflow?.steps.map(x=>x.state)).toEqual(["needs_create","hold_quality_gate"]);
  expect(held.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
  expect(held.safeEditWorkflow?.qualityIssues).toContain("content_types_missing");
  const captured=await applyRecipe(held);
  expect(captured).toHaveLength(1);
  const enriched={...base,themes:["Memory"],entityRoles:base.entities.map(entity=>({entity,role:"covered_company" as const})),
    contentTypes:["analyst_opinion","market_commentary"] as const};
  const ready=await route(enriched);
  expect(ready.planId).toBe(held.planId);
  expect(ready.safeEditWorkflow?.steps.map(x=>x.state)).toEqual(["verified_existing","needs_create"]);
  expect(ready.safeEditWorkflow?.steps[1].path).toContain("Investment Review - Memory - ");
  const content=ready.safeEditWorkflow?.steps[1].safeEditRequest?.change.content??"";
  expect(content).toContain("## คำแปลจากต้นฉบับ");
  expect(content).toContain("source_channel: \"social_repost\"");
  expect(content).toContain("original_document_access: \"excerpt_only\"");
  expect(content).toContain("[[01_Companies/MU]]");
  expect(content).toContain("[[02_Industries_Themes/Memory]]");
  await applyRecipe(ready);
  const verified=await route(enriched);
  expect(verified.safeEditWorkflow).toMatchObject({status:"saved_verified",readyForNextNews:true,qualityIssues:[]});
 });
 it("M53-F01 synthetic Memory: raw source → canonical review with four company backlinks → SHA readback and FTS → ready",async()=>{
  for(const company of ["SK hynix","Samsung","MU","Kioxia"])await seed(`01_Companies/${company}.md`,`# ${company} fixture\n`);
  await seed("02_Industries_Themes/Memory.md","# Memory industry fixture\n");
  await seed("05_Thesis/NVDA - Current Thesis.md","# Protected synthetic thesis\n");
  await seed("06_Portfolio/Team.md","# Protected synthetic portfolio\n");
  const first=await route(news);
  const steps=first.safeEditWorkflow?.steps??[];
  expect(first.status).toBe("read_only_plan_not_written");
  expect(first.safeEditWorkflow?.status).toBe("pending_safe_edit");
  expect(first.safeEditWorkflow?.readyForNextNews).toBe(false);
  expect(steps.map(x=>x.state)).toEqual(["needs_create","needs_create"]);
  expect(steps[0].path).toContain("00_Inbox/ChatGPT/Investment Intake - IN-");
  expect(steps[1].path).toContain("10_Knowledge/Industry and Concepts/Investment Review - Memory - IN-");
  expect(steps[0].safeEditRequest?.change.content).toContain(news.extractedText);
  expect(steps[1].safeEditRequest?.change.content).toContain(news.completedAnalysis);
  expect(steps[1].safeEditRequest?.change.content).toContain("[[01_Companies/MU]]");
  expect(steps[1].safeEditRequest?.change.content).toContain("[[02_Industries_Themes/Memory]]");
  const written=await applyRecipe(first);
  expect(written).toHaveLength(2);
  const again=await route(news);
  expect(again.planId).toBe(first.planId);
  expect(again.safeEditWorkflow).toMatchObject({status:"saved_verified",readyForNextNews:true,
    writesPerformedByPlanner:false,protectedNotesTouched:false,perDeviceSync:"unverified"});
  expect(again.safeEditWorkflow?.steps.map(x=>x.state)).toEqual(["verified_existing","verified_existing"]);
  expect(again.safeEditWorkflow?.steps.every(x=>x.readbackVerified&&x.indexed&&x.searchable)).toBe(true);
  const {searchVault,outgoingLinks}=await import("./queries");
  const found=searchVault("InvestmentIntake"+first.planId.slice(3),{limit:20});
  expect(found.hits.map(x=>x.path)).toEqual(expect.arrayContaining(written));
  expect(outgoingLinks(written[1]).some(x=>x.resolved==="01_Companies/SK hynix.md")).toBe(true);
  expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected synthetic thesis\n");
  expect(fs.readFileSync(path.join(vault,"06_Portfolio/Team.md"),"utf8")).toBe("# Protected synthetic portfolio\n");
 });
 it("P0 Fresh Micro company: primary MU stays Company Review while SK hynix mention remains linked; source/review CAS and FTS verified",async()=>{
  await seed("01_Companies/SK hynix.md","# SK hynix\n");
  await seed("01_Companies/MU.md","# MU\n");
  await seed("02_Industries_Themes/Memory.md","# Memory\n");
  await seed("05_Thesis/MU - Current Thesis.md","# User-protected MU thesis\n");
  const input={...news,domain:"company" as const,entities:["SK hynix","MU"],
    entityRoles:[{entity:"SK hynix",role:"mentioned" as const},{entity:"MU",role:"primary_subject" as const}],
    topic:"Micron HBM4 research update with SK hynix mentioned",sourceChannel:"broker_excerpt",
    originalDocumentAccess:"excerpt_only" as const,completedAnalysis:undefined,
    researchReview:{headlineTh:"ข่าวไมครอนกล่าวถึงแนวโน้ม HBM4 และ SK hynix ในฐานะบริษัทที่ถูกอ้างถึง",
      translationTh:"รายงานที่ผู้ใช้อ้างถึงกล่าวถึงราคาหน่วยความจำและการแข่งขันด้าน HBM4 ของผู้ผลิตหลายราย",
      whatChangedTh:"ข้อความนี้เป็นข้อมูลเพิ่มเติมที่ยังไม่ได้ตรวจต้นฉบับของรายงาน",
      mechanismTh:"ความต้องการ HBM4 อาจกระทบยอดขายและกำไรขั้นต้น ขึ้นกับการส่งมอบจริง",
      thesisImplicationTh:"ยังไม่ปรับ Thesis หรือมูลค่าเหมาะสมจากข้อความที่ไม่ได้ตรวจยืนยัน",
      counterEvidenceTh:"การแข่งขันและต้นทุนอาจชะลอการเพิ่มขึ้นของกำไร",
      requiredEvidenceTh:"ต้องตรวจรายงานต้นฉบับ วันที่และตัวเลขประมาณการให้ตรงกัน"}};
  const first=await route(input);
  expect(first.routingV2.reviewScope).toBe("company");
  expect(first.routingV2.preferredReviewSubject).toBe("MU");
  expect(first.safeEditWorkflow?.qualityIssues).toEqual([]);
  expect(first.safeEditWorkflow?.steps[1].path).toContain("10_Knowledge/Company Research/Investment Review - MU - IN-");
  const reviewBody=first.safeEditWorkflow?.steps[1].safeEditRequest?.change.content??"";
  expect(reviewBody).toContain("[[01_Companies/MU]]");
  expect(reviewBody).toContain("[[01_Companies/SK hynix]]");
  expect(reviewBody).toContain("[[02_Industries_Themes/Memory]]");
  const written=await applyRecipe(first);
  const repeat=await route(input);
  expect(repeat.safeEditWorkflow).toMatchObject({status:"saved_verified",readyForNextNews:true,protectedNotesTouched:false});
  expect(repeat.safeEditWorkflow?.steps.map(x=>x.state)).toEqual(["verified_existing","verified_existing"]);
  const {outgoingLinks,searchVault}=await import("./queries");
  const targets=outgoingLinks(written[1]).map(x=>x.resolved);
  expect(targets).toContain("01_Companies/MU.md");
  expect(targets).toContain("01_Companies/SK hynix.md");
  expect(targets).toContain("02_Industries_Themes/Memory.md");
  expect(searchVault("InvestmentIntake"+first.planId.slice(3),{limit:20}).hits.map(x=>x.path)).toEqual(expect.arrayContaining(written));
  expect(fs.readFileSync(path.join(vault,"05_Thesis/MU - Current Thesis.md"),"utf8")).toBe("# User-protected MU thesis\n");
 });
 it("M53-F02 incomplete input stays a read-only analysis plan and cannot fabricate successful write",async()=>{
  const p=await route({...news,completedAnalysis:undefined});
  expect(p.safeEditWorkflow).toBeUndefined();
  expect(p.gates.canAutoWrite).toBe(false);
  await expect(route({...news,sourceChat:undefined})).rejects.toThrow(/requires sourceChat/);
 });
 it("M53-F03 changed review text for identical raw intake holds conflict and never overwrites",async()=>{
  const a=await route(news);
  await applyRecipe(a);
  const changed=await route({...news,completedAnalysis:news.completedAnalysis+" Follow-up inference."});
  expect(changed.planId).toBe(a.planId);
  expect(changed.safeEditWorkflow?.steps[0].state).toBe("verified_existing");
  expect(changed.safeEditWorkflow?.steps[1].state).toBe("hold_conflict");
  expect(changed.safeEditWorkflow?.readyForNextNews).toBe(false);
  expect(changed.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
 });
 it("M53-F04 source/date duplicate candidate permits raw preservation but holds redundant canonical review",async()=>{
  await seed("01_Companies/SK hynix.md","# SK hynix\n");
  const existing="10_Knowledge/Company Research/HBM4 prior event.md";
  const url="https://example.org/analyst/memory-20261022";
  await seed(existing,["---","company: [SK hynix]","event_date: 2026-10-22",
    `source_url: ${url}`,"verification: not_reverified","---","# Prior source"].join("\n"));
  const p=await route({...news,sourceUrl:url});
  expect(p.sourceEventReview.candidatePaths).toContain(existing);
  expect(p.safeEditWorkflow?.status).toBe("hold_source_event_review");
  expect(p.safeEditWorkflow?.steps[0].state).toBe("needs_create");
  expect(p.safeEditWorkflow?.steps[1].state).toBe("hold_event_review");
  expect(p.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
 });
 it("M53-F05 legacy generic review gets a hold instead of duplicate canonical review",async()=>{
  const first=await route(news);
  const legacy=first.routes.find(x=>x.kind==="research_review")?.path;
  expect(legacy).toBeTruthy();
  await seed(legacy!,"# Previously imported generic review\n");
  const second=await route(news);
  expect(second.safeEditWorkflow?.steps[1].state).toBe("hold_event_review");
  expect(second.safeEditWorkflow?.readyForNextNews).toBe(false);
 });
 it("M53-F06 unindexed existing same bytes require index repair, not a duplicate create",async()=>{
  const p=await route(news);
  const source=p.safeEditWorkflow?.steps[0];
  expect(source?.safeEditRequest).toBeTruthy();
  fs.writeFileSync(path.join(vault,source!.path),source!.safeEditRequest!.change.content);
  const replan=await route(news);
  expect(replan.safeEditWorkflow?.steps[0].state).toBe("hold_index_repair");
  expect(replan.safeEditWorkflow?.steps[0].readbackVerified).toBe(true);
  expect(replan.safeEditWorkflow?.readyForNextNews).toBe(false);
 });
 it("M53-F07 source type PDF without binary receipt keeps attachment_status not_verified",async()=>{
  const p=await route({...news,inputFormat:"pdf"});
  expect(p.safeEditWorkflow?.steps[0].safeEditRequest?.change.content).toContain('attachment_status: "not_verified"');
  expect(p.sourceCapture.attachmentVerified).toBe(false);
 });
 it("M53-F08 portfolio capture routes only to unprotected source/review, no automatic portfolio mutation",async()=>{
  const p=await route({domain:"asset",entities:["Team Portfolio"],topic:"ทีม Capture",
    sourceKind:"user_commentary",inputFormat:"screenshot",contentTypes:["portfolio_snapshot"],
    extractedText:"ภาพพอร์ตของทีมที่ผู้ใช้ส่งมา ยังไม่ตรวจตำแหน่งหรือมูลค่า",
    sourceChat:"Portfolio 251026",completedAnalysis:"Capture-only: no trade, no target exposure and no manager sign-off."});
  expect(p.safeEditWorkflow?.steps.map(x=>x.path).every(x=>!x.startsWith("06_Portfolio/")&&!x.startsWith("05_Thesis/"))).toBe(true);
  expect(p.safeEditWorkflow?.readyForNextNews).toBe(false);
  expect(p.safeEditWorkflow?.protectedNotesTouched).toBe(false);
 });
 it("M53-F09 disabled Safe Edit cannot apply recipe, even when source/review are eligible",async()=>{
  const p=await route(news);
  const {preview}=await import("../safe-edit/engine");
  process.env.SAFE_EDIT_ENABLED="0";
  expect(()=>preview(p.safeEditWorkflow!.steps[0].safeEditRequest!,actor)).toThrow(/disabled/);
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT"))).toHaveLength(0);
 });
 it("M53-F10 stable intake identity distinguishes dates, while classification/review changes do not alter original source ID",async()=>{
  const a=await route(news),b=await route({...news,contentTypes:["analyst_opinion"],completedAnalysis:"Short follow-up"});
  const c=await route({...news,eventDate:"2026-10-24"});
  expect(a.planId).toBe(b.planId);
  expect(a.safeEditWorkflow?.steps[0].expectedSha256).toBe(b.safeEditWorkflow?.steps[0].expectedSha256);
  expect(a.safeEditWorkflow?.steps[1].expectedSha256).not.toBe(b.safeEditWorkflow?.steps[1].expectedSha256);
  expect(a.planId).not.toBe(c.planId);
 });
 it("M53-F11 Feed Only archives exact source, then later analysis adds a review without duplicating the source",async()=>{
  const feed=await route({...news,completedAnalysis:undefined,captureOnly:true});
  expect(feed.safeEditWorkflow).toMatchObject({status:"pending_source_capture",analysisComplete:false,
    readyForNextNews:false});
  expect(feed.safeEditWorkflow?.steps).toHaveLength(1);
  await applyRecipe(feed);
  const accepted=await route({...news,completedAnalysis:undefined,captureOnly:true});
  expect(accepted.safeEditWorkflow).toMatchObject({status:"source_saved_analysis_pending",
    analysisComplete:false,readyForNextNews:true,perDeviceSync:"unverified"});
  const full=await route(news);
  expect(full.planId).toBe(feed.planId);
  expect(full.safeEditWorkflow?.steps.map(x=>x.state)).toEqual(["verified_existing","needs_create"]);
  await applyRecipe(full);
  const verified=await route(news);
  expect(verified.safeEditWorkflow).toMatchObject({status:"saved_verified",analysisComplete:true,
    readyForNextNews:true});
  expect(fs.readdirSync(path.join(vault,"00_Inbox/ChatGPT")).filter(x=>x.endsWith(".md"))).toHaveLength(1);
 });
 it("M53-F12 a review already indexed under another path with the same intake ID blocks second review creation",async()=>{
  const initial=await route(news);
  await seed("10_Knowledge/Company Research/Existing indexed review.md",[
    "---",`intake_id: ${JSON.stringify(initial.planId)}`,"verification: not_reverified", "---",
    "# Already registered review under a previous classification"
  ].join("\n"));
  const replan=await route({...news,themes:["Storage"]});
  expect(replan.planId).toBe(initial.planId);
  expect(replan.safeEditWorkflow?.steps[1].state).toBe("hold_event_review");
  expect(replan.safeEditWorkflow?.steps[1].safeEditRequest).toBeNull();
 });
 it("M53-F13 broker FY2027E old/new model rows remain attributed and distinct from management guidance",async()=>{
  const p=await route({...news,brokerUpdate:{bank:"J.P. Morgan",priorBank:"J.P. Morgan",
    reportDate:"2026-10-23",priorReportDate:"2026-09-25",targetPrice:"120",priorTargetPrice:"110",
    currency:"USD",priorCurrency:"USD",estimateChanges:[{metric:"EPS",period:"2027E",oldValue:"9.1",newValue:"9.8",unit:"USD/share"}]}});
  const body=p.safeEditWorkflow?.steps[1].safeEditRequest?.change.content;
  expect(body).toContain("J.P. Morgan");
  expect(body).toContain("EPS 2027E: 9.1 → 9.8 USD/share");
  expect(body).toContain("pt_raise_candidate");
  expect(body).toContain("not independently verified");
 });
 it("M53-F14 industry repost with different wording but same original URL/date holds a second canonical review",async()=>{
  const sourceUrl="https://example.org/memory/industry-update";
  const original=await route({...news,sourceUrl});
  await applyRecipe(original);
  const repeated=await route({...news,sourceUrl,extractedText:news.extractedText+" Social repost with new wording."});
  expect(repeated.planId).not.toBe(original.planId);
  expect(repeated.sourceEventReview.status).toBe("possible_same_source_event_candidates");
  expect(repeated.sourceEventReview.candidatePaths).toContain(original.safeEditWorkflow?.steps[0].path);
  expect(repeated.safeEditWorkflow?.steps[0].state).toBe("needs_create");
  expect(repeated.safeEditWorkflow?.steps[1].state).toBe("hold_event_review");
 });
});

import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {kernelCanonicalCreate} from "../../../tests/source-event-fixture";

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
  sourceChat:"Micro 251026",sourceChannel:"broker_research",originalDocumentAccess:"excerpt_only" as const,
  researchReview:{headlineTh:"ข่าวสมมติกล่าวถึงข้อมูลที่ยังต้องตรวจสอบต้นฉบับ",
    translationTh:"ข้อความภาษาอังกฤษที่ผู้ใช้ส่งมา: ราคาหน่วยความจำและอัตราผลผลิต HBM4 แตกต่างกันตามผู้ผลิต ข้อกังวลเรื่องผลผลิตเป็นกระแสตลาด ไม่ใช่ข้อเท็จจริงที่บริษัทยืนยัน",
    whatChangedTh:"เป็นข้อมูลที่ผู้ใช้ส่งมาและยังไม่ได้ตรวจสอบกับหลักฐานต้นฉบับ",
    mechanismTh:"ความต้องการและกำลังการผลิตอาจส่งผลต่อรายได้และกำไร แต่ยังต้องตรวจสอบข้อมูลจริง",
    thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือประมาณการกำไร",
    counterEvidenceTh:"ต้นทุนและอัตราผลผลิตจริงอาจแตกต่างจากคาด",
    requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและวันที่ประกาศก่อนใช้ข้อมูล"},
  completedAnalysis:"## Investment takeaway\nASP growth deceleration can affect EPS revisions. HBM4 yield risks are unresolved; no verified thesis change."
};
async function applyRecipe(plan:Awaited<ReturnType<typeof route>>){
  // WP2 (OD-04+OD-06): server recipes persist through the kernel route; the
  // generic Safe Edit route refuses canonical IDs/namespaces in every mode.
  const steps=(plan.safeEditWorkflow?.steps??[]).filter(step=>step.safeEditRequest);
  for(const step of steps)expect(fs.existsSync(path.join(vault,step.path))).toBe(false);
  if(!steps.length)return [];
  const results=await kernelCanonicalCreate(steps.map(step=>({kind:step.kind,path:step.path,content:(step.safeEditRequest!.change as {content:string}).content})),actor);
  const {status}=await import("../safe-edit/engine");
  results.forEach((r,i)=>{expect(r.operationId).toBe(steps[i].safeEditRequest!.operationId);
    expect(status(r.operationId,actor)).toMatchObject({status:"written",receipt:{write:"written",readback:"verified",reindex:"verified",
      mobileSync:"unverified",remoteSync:"unverified"}});});
  return steps.map(step=>step.path);
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
 it("M56-A/M56-P1: an unreceipted (historical) Industry Review stays read-only — truthful HOLD, no generic append recipe, zero writes",async()=>{
  // Canonical Reviews change only through the dedicated revision route. Since M56-P1 the
  // route also serves server-receipted Industry-IN/Macro-IN Draft Reviews (positive: the
  // "M56-P1" describe below); this seeded note has no server receipt or Draft metadata.
  // The Company-Review M56 positive is in src/server/mcp/wp2-review-revision-legacy.test.ts.
  await seed(thai,source("IN-4AF8FD0215D3A798","https://th.investing.com/news/stock-market-news/article-810087","th"));
  await seed(english,source("IN-B637DC6926EBA011","https://www.investing.com/news/stock-market-news/micron-sandisk-gain-as-sk-hynix-scraps-solidigm-ipo-lynx-says-4970053","en"));
  await seed(review,["---","type: investment_research_review",`intake_id: "IN-4AF8FD0215D3A798"`,
   `original_source_path: "${thai}"`,"---","# Solidigm annotated historical review", "## Source provenance",
   `- Exact Source: [[${thai.slice(0,-3)}]]`,"","## Research analysis","Unchanged synthetic review content.",""] .join("\n"));
  await seed("05_Thesis/NVDA - Current Thesis.md","# Protected thesis fixture\n");
  const before=fs.readFileSync(path.join(vault,review),"utf8");
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const plan=planDuplicateSourceLinkM56(request);
  expect(plan).toMatchObject({status:"hold_draft_review_required",writePerformed:false,safeEditRequest:null,canonicalReviewRevision:null});
  const engine=await import("../safe-edit/engine");
  expect(()=>engine.preview({operationId:"ILK-former-generic-append-1",path:review,reason:"former M56 generic append",
   change:{kind:"append",heading:"Source provenance",date:"2026-10-26",content:"probe"}},actor)).toThrow(/dedicated_route_required|canonical_route_required/);
  expect(fs.readFileSync(path.join(vault,review),"utf8")).toBe(before);
  expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected thesis fixture\n");
 });
 it("OD-10 F-4: an Industry Review that already text-references the Source still HOLDs (unreceipted historical Draft check); no already_linked before the domain/receipt checks",async()=>{
  await seed(thai,source("IN-4AF8FD0215D3A798","https://th.investing.com/news/stock-market-news/article-810087","th"));
  await seed(english,source("IN-B637DC6926EBA011","https://www.investing.com/news/stock-market-news/micron-sandisk-gain-as-sk-hynix-scraps-solidigm-ipo-lynx-says-4970053","en"));
  await seed(review,["---","type: investment_research_review",`intake_id: "IN-4AF8FD0215D3A798"`,
   `original_source_path: "${thai}"`,"---","## Source provenance",`- [[${thai.slice(0,-3)}]]`,`- [[${english.slice(0,-3)}]] (text reference only)`,""] .join("\n"));
  const before=fs.readFileSync(path.join(vault,review),"utf8");
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const plan=planDuplicateSourceLinkM56(request);
  expect(plan).toMatchObject({status:"hold_draft_review_required",writePerformed:false,safeEditRequest:null,canonicalReviewRevision:null});
  expect(plan).not.toHaveProperty("linkEvidence");
  expect(fs.readFileSync(path.join(vault,review),"utf8")).toBe(before);
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
  expect(steps[1].safeEditRequest?.change.content).toContain(news.researchReview.whatChangedTh);
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
  const p=await route({...news,completedAnalysis:undefined,researchReview:undefined});
  expect(p.safeEditWorkflow).toBeUndefined();
  expect(p.gates.canAutoWrite).toBe(false);
  await expect(route({...news,sourceChat:undefined})).rejects.toThrow(/requires sourceChat/);
 });
 it("M53-F03 changed review text for identical raw intake holds conflict and never overwrites",async()=>{
  await seed("02_Industries_Themes/Memory.md","# Memory");
  const a=await route(news);
  await applyRecipe(a);
  const changed=await route({...news,researchReview:{...news.researchReview,whatChangedTh:"มีข้อความเพิ่มเติมที่แตกต่างจากบทวิเคราะห์เดิม"}});
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
 it("M53-F05 existing canonical path with generic historical bytes holds conflict instead of overwrite",async()=>{
  const first=await route(news);
  const legacy=first.routes.find(x=>x.kind==="research_review")?.path;
  expect(legacy).toBeTruthy();
  await seed(legacy!,"# Previously imported generic review\n");
  const second=await route(news);
  expect(second.safeEditWorkflow?.steps[1].state).toBe("hold_conflict");
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
  const a=await route(news),b=await route({...news,contentTypes:["analyst_opinion"],researchReview:{...news.researchReview,whatChangedTh:"การวิเคราะห์เพิ่มเติมโดยใช้ต้นฉบับเดิม"}});
  const c=await route({...news,eventDate:"2026-10-24"});
  expect(a.planId).toBe(b.planId);
  expect(a.safeEditWorkflow?.steps[0].expectedSha256).toBe(b.safeEditWorkflow?.steps[0].expectedSha256);
  expect(a.safeEditWorkflow?.steps[1].expectedSha256).not.toBe(b.safeEditWorkflow?.steps[1].expectedSha256);
  expect(a.planId).not.toBe(c.planId);
 });
 it("M53-F11 Feed Only archives exact source, then later analysis adds a review without duplicating the source",async()=>{
  await seed("02_Industries_Themes/Memory.md","# Memory");
  const feed=await route({...news,completedAnalysis:undefined,researchReview:undefined,captureOnly:true});
  expect(feed.safeEditWorkflow).toMatchObject({status:"pending_source_capture",analysisComplete:false,
    readyForNextNews:false});
  expect(feed.safeEditWorkflow?.steps).toHaveLength(1);
  await applyRecipe(feed);
  const accepted=await route({...news,completedAnalysis:undefined,researchReview:undefined,captureOnly:true});
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
  await seed("02_Industries_Themes/Memory.md","# Memory");
  const p=await route({...news,brokerUpdate:{bank:"J.P. Morgan",priorBank:"J.P. Morgan",
    reportDate:"2026-10-23",priorReportDate:"2026-09-25",targetPrice:"120",priorTargetPrice:"110",
    currency:"USD",priorCurrency:"USD",estimateChanges:[{metric:"EPS",period:"2027E",oldValue:"9.1",newValue:"9.8",unit:"USD/share"}]}});
  const body=p.safeEditWorkflow?.steps[1].safeEditRequest?.change.content;
  expect(body).toContain("J.P. Morgan");
  expect(body).toContain("EPS 2027E: 9.1 → 9.8 USD/share");
  expect(body).toContain("pt_raise_candidate");
  expect(body).toContain("ยังไม่ได้ตรวจสอบโดยอิสระ");
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

/** M56-P1 (Owner-approved Phase 1): dedicated revision of existing server-receipted
 * Industry-IN / Macro-IN Draft Reviews under the versioned V2 subject contract.
 * Synthetic Sources + ephemeral Vault/SQLite; dashboard approval is simulated through
 * engine.approve (SYNTHETIC: not human presence). Every refusal compares a full ledger. */
describe("M56-P1 Industry-IN / Macro-IN dedicated revision (V2 subject contract)",()=>{
 // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF for the dedicated apply (as in wp2-review-revision-legacy).
 beforeEach(()=>{vi.doMock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));});
 afterEach(()=>{vi.doUnmock("../safe-edit/sync");});
 const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
 const hub="02_Industries_Themes/Memory Semiconductors.md";
 const researchReview={headlineTh:"ราคาหน่วยความจำสมมติปรับขึ้นในตุลาคม 2026",translationTh:"ข่าวสมมติระบุว่าราคาชิปหน่วยความจำปรับขึ้นในเดือนตุลาคม 2026",
  whatChangedTh:"เป็นข้อกล่าวอ้างด้านราคาที่ยังไม่ได้ตรวจสอบกับต้นฉบับ",mechanismTh:"ยังไม่มีหลักฐานว่าราคาที่ปรับขึ้นส่งผลต่อกำไรของผู้ผลิต",
  thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข่าวนี้",counterEvidenceTh:"ข้อมูลอาจเป็นการคาดการณ์ของสื่อ ไม่ใช่ราคาที่ตกลงจริง",
  requiredEvidenceTh:"ตรวจข้อมูลราคาจากต้นฉบับก่อนยกระดับข้อกล่าวอ้าง"};
 const industryText="SYNTHETIC: Memory Semiconductors contract prices rose in October 2026, a synthetic tracker reported for DRAM.";
 const macroText="SYNTHETIC: The Bank of Thailand held the policy rate at 2.50% in October 2026, the synthetic notice said.";
 const writeback=(domain:"industry"|"macro",entity:string,text:string,url:string,capture=false)=>({domain,entities:[entity],topic:"Synthetic "+domain+" event",inputFormat:"text" as const,
  sourceKind:"news_media" as const,sourceLanguage:"en",sourceChannel:"synthetic",contentTypes:["other" as const],sourceChat:"M56-P1 synthetic",sourceUrl:url,
  eventDate:"2026-10-20",publicationDate:"2026-10-20",originalDocumentAccess:"not_obtained" as const,extractedText:text,
  ...(capture?{captureOnly:true as const}:{researchReview})});
 async function save(input:ReturnType<typeof writeback>){
  // Server recipe persisted through the kernel route (same helper as M53 tests above).
  const plan=await route(input as never),written=await applyRecipe(plan);
  const steps=plan.safeEditWorkflow!.steps;
  expect(written).toEqual(steps.map(x=>x.path));
  return {steps:steps.map(x=>({kind:x.kind,path:x.path,receiptKey:x.receiptKey}))};
 }
 function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?[b+e.name+"/",...files(path.join(dir,e.name),b+e.name+"/")]:[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name),"utf8"))]).sort();}
 /** Files+directories+full bytes, notes/notes_fts/links, plan/witness/consumption, operations/receipts, journal and modification ledger. */
 async function ledger(){
  const d=(await import("../db")).db(),m=await import("./modified"),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t));
  const all=(t:string,cols="*")=>has(t)?d.prepare(`SELECT ${cols} FROM ${t} ORDER BY 1`).all():[];
  const md=files().filter(f=>f.includes(".md:")).map(f=>f.slice(0,f.lastIndexOf(":")));
  return {files:files(),notes:all("notes"),fts:all("notes_fts","path,body"),links:all("links","source_path,target,resolved_path"),
   plan:all("canonical_plan"),witness:all("canonical_witness"),consumption:all("witness_consumption"),ops:all("safe_edit_operations"),
   events:all("safe_edit_events"),modified:md.map(f=>[f,m.modifiedFor(f,-1)])};
 }
 const raw=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
 async function quote(sourcePath:string,q:string){
  const {preservedSubmittedText}=await import("./research-decision-v2"),{splitFrontmatter}=await import("./markdown");
  const r=raw(sourcePath),part=preservedSubmittedText(r)!,fm=splitFrontmatter(r).data;
  const text=[part,part+"\n"].find(t=>sha(t)===fm.source_text_sha256)!,at=text.indexOf(q);
  expect(at,q).toBeGreaterThanOrEqual(0);
  return {key:"original_source",quote:q,locator:`utf16:${at}:${at+q.length}`,sourceSha256:sha(text)};
 }
 /** SYNTHETIC analyst attestation (mechanical; not semantic verification). */
 async function sealed(input:unknown,relation:"duplicate"|"added_detail",action:"duplicate_link_only"|"append_revision",tweak?:(r:Record<string,any>)=>void){
  const sea=await import("../safe-edit/source-event-admission"),pilot=await import("../safe-edit/canonical-review-revision-pilot");
  const proposal=sea.subjectRevisionEventProposal(pilot.subjectRevisionInputSchema.parse(input));
  const built=sea.buildSourceEventPacket(proposal,actor),body=JSON.parse(built.packet.body);
  expect(built.constraints,JSON.stringify(built.constraints)).toEqual([]);
  const ref=(key:string,text:string,s256:string)=>({key,quote:text.slice(0,100),locator:`utf16:0:${Math.min(text.length,100)}`,sourceSha256:s256});
  const sourceRefs=body.sources.map((s:{text:string;textSha256:string},i:number)=>ref("source_"+i,s.text,s.textSha256));
  const historyRefs=body.context.history.map((h:{text:string;sha256:string},i:number)=>ref("history_"+i,h.text,h.sha256));
  const subject=body.proposal.subject;
  const result:Record<string,any>={contractVersion:pilot.SUBJECT_SOURCE_EVENT_POLICY,packetDigest:built.packet.digest,packetEnvelopeDigest:built.packetEnvelopeDigest,
   disposition:"PASS",methodVersion:"SYNTHETIC-MECHANICAL-SUBJECT-1",criticIndependence:"not_verified",
   sourceBindings:sourceRefs.map((r:{key:string},i:number)=>({bindingVersion:pilot.SUBJECT_BIND_POLICY,sourceKey:r.key,sliceId:"slice_"+i,domain:subject.domain,
    effectiveSubjectId:subject.key,relation:"primary_subject",semanticRationale:"Synthetic fixture subject association for deterministic binding tests only.",
    references:[r],coverage:"excerpt_only",limitations:["Fixture only; publisher not independently verified"]})),
   event:{decisionVersion:pilot.SUBJECT_EVENT_ID_POLICY,effectiveSubjectId:subject.key,relation,action,targetReviewPath:body.targetReview.path,materiality:"low",
    semanticRationale:"Synthetic exact-source comparison, not economic verification or LLM evaluation.",
    materialityRationale:"Synthetic same-event coverage; no asserted financial or investment authority.",
    comparison:{economicSubject:"same",geography:"same",metric:"same",unit:"same",period:"same",role:"same",vintage:"not_applicable",sourceFamily:"same_family",
     materialDelta:"Synthetic same-event text only; no asserted change of value, unit, period or role."},
    consideredHistoryKeys:historyRefs.map((r:{key:string})=>r.key),
    references:[sourceRefs[0],...(historyRefs.length?[historyRefs[0]]:[]),ref("target_review",body.targetReview.text,body.targetReview.sha256)],counterEvidenceRefs:[],
    coverage:"bounded_omission",coverageRationale:"Only the bounded server-selected evidence was supplied and reviewed in this simulated fixture."},
   checks:{sourceEntailment:"PASS",subjectAssociation:"PASS",eventIdentity:"PASS",periodRoleVintage:"PASS",unitMetricGeography:"PASS",
    coverageCounterEvidence:"PASS",pointInTime:"PASS",injectionIsolation:"PASS",protectedAuthority:"PASS"}};
  tweak?.(result);
  return {packet:built.packet,result};
 }
 const assessment=(relation:"duplicate"|"added_detail")=>({disposition:"PASS" as const,eventRelation:relation,materiality:"low" as const,
  assessment:"Synthetic analyst view: the second Source repeats or details the same dated event; it is not new evidence or guidance.",
  counterEvidence:"Same-event identity is an analyst proposal; the publisher's original page was not independently compared.",
  requiredEvidence:"Read the real original publications before relying on any detail in an investment decision.",
  criticIndependence:"not_verified" as const,independentEvidenceIncrement:0 as const});
 async function revise(input:Record<string,unknown>){
  const bridge=await import("../mcp/canonical-review-revision"),engine=await import("../safe-edit/engine");
  const p=bridge.prepareReviewRevision(input,actor) as {operationId:string;preview:{previewToken:string|null;beforeHash:string}};
  const view=engine.adminPreview(p.operationId) as {afterHash:string;reviewedEvidenceDigest?:string};
  engine.approve(p.operationId,"synthetic-dashboard-reviewer",view.afterHash,view.reviewedEvidenceDigest);
  const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
  return {prepared:p as Record<string,any>,view,authorization,result:await bridge.applyReviewRevision({input,operationId:p.operationId,authorization},actor) as Record<string,any>};
 }
 async function industrySetup(){
  await seed(hub,"# Memory Semiconductors\n");
  const first=await save(writeback("industry","Memory Semiconductors",industryText,"https://example.org/memory/tracker-a"));
  const rev=first.steps.find(s=>s.kind==="canonical_review")!,src=first.steps.find(s=>s.kind==="source_intake")!;
  const dup=await save(writeback("industry","Memory Semiconductors","SYNTHETIC (second edition): Memory Semiconductors contract prices rose in October 2026 for DRAM, the synthetic tracker repeated.","https://www.example.org/memory/tracker-b",true));
  return {rev,src,dupPath:dup.steps[0].path};
 }
 const planRequest=(reviewPath:string,additional:string)=>({reviewPath,additionalSourcePath:additional,eventAnchor:"synthetic-memory-price-2026-10",
  comparisonBasis:"Both synthetic editions report the same October 2026 memory contract price rise from one publisher family; not a second event.",linkedOnDate:"2026-11-14"});
 async function industryInput(rev:{path:string},dupPath:string,src:{path:string}){
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const plan=planDuplicateSourceLinkM56(planRequest(rev.path,dupPath));
  expect(plan).toMatchObject({status:"requires_dedicated_review_revision_v2",writePerformed:false,safeEditRequest:null});
  if(plan.status!=="requires_dedicated_review_revision_v2")throw Error("unreachable");
  expect(plan.requiredCompletion.subject).toEqual({domain:"industry",hubPath:hub,topic:null,period:null,evidence:[]});
  expect(plan.requiredCompletion.analystAssessment.disposition).toMatch(/^<analyst-selected: /);
  return {plan,input:{...plan.canonicalReviewRevision,subject:{domain:"industry" as const,hubPath:hub,topic:"DRAM contract pricing",period:"October 2026",
    evidence:[await quote(src.path,"Memory Semiconductors contract prices rose in October 2026")]},analystAssessment:assessment("duplicate")} as Record<string,any>};
 }

 it("M56-P1-02 Industry-IN: receipted planner recipe → sealed V2 subject event → dashboard approval → apply (duplicate link, then added detail); Draft trust and receipts kept",async()=>{
  const {rev,src,dupPath}=await industrySetup();
  const before0=await ledger();
  const {input}=await industryInput(rev,dupPath,src);
  expect(await ledger()).toEqual(before0); // planner is read-only
  input.sourceEvent=await sealed(input,"duplicate","duplicate_link_only");
  const original=raw(rev.path);
  const {prepared,result}=await revise(input);
  expect(prepared).toMatchObject({selectorVersion:"M56-REVIEW-SELECTOR-2",subject:{domain:"industry",subjectKey:"industry:"+hub},issuerBinding:"not_applicable_no_issuer",
   subjectBinding:"not_verified",independentEvidenceIncrement:0,writesPerformed:false});
  expect(result).toMatchObject({status:"revision_saved_verified",reviewAppendChainVerified:true,sourceReceiptsVerified:true,researchStatus:"draft",
   independentEvidenceIncrement:0,subjectBinding:"analyst_attested_not_independently_verified",issuerBinding:"not_applicable_no_issuer"});
  const after=raw(rev.path);
  expect(after.startsWith(original.split("\n## ")[0])).toBe(true);
  expect(after).toContain(`[[${dupPath.slice(0,-3)}]]`);expect(after).toContain("### Duplicate Source link (link only;");
  expect(after).toContain("Subject (M56-REVIEW-SELECTOR-2, server-bound to the receipted Review and Source text, not an issuer): Industry Hub Memory Semiconductors");
  expect(after).toContain("independent_evidence_increment=0");expect(after).toMatch(/research_status: "draft"/);expect(after).toMatch(/usage_tier: "historical_analysis_only"/);
  const reader=await import("./investment-research-context");
  expect(reader.receiptProvenance("canonical_review",rev.path,after).tier).toBe("server_witnessed");
  // Idempotent planner after the write; text reference only, not receipt truth.
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  expect(planDuplicateSourceLinkM56(planRequest(rev.path,dupPath))).toMatchObject({status:"already_linked",linkEvidence:"text_reference_only"});
  // Added detail on the revised Review (depth 2) through the same V2 route.
  const third=await save(writeback("industry","Memory Semiconductors","SYNTHETIC (detail edition): Memory Semiconductors contract prices rose in October 2026; the tracker added that the rise applied to DDR5 modules.","https://news.example.org/memory/tracker-c",true));
  const detail:Record<string,any>={...input,existingReview:{...input.existingReview,expectedSha256:sha(after),relationship:"added_detail",
   comparisonBasis:"The synthetic detail edition adds a DDR5 scope note to the same October 2026 price rise; same publisher family."},
   additionalSources:[{path:third.steps[0].path,sha256:sha(raw(third.steps[0].path)),receiptId:third.steps[0].receiptKey}],analystAssessment:assessment("added_detail")};
  delete detail.sourceEvent;detail.sourceEvent=await sealed(detail,"added_detail","append_revision");
  const second=await revise(detail);
  expect(second.result.status).toBe("revision_saved_verified");
  expect(raw(rev.path)).toContain("### Source-linked evidence addendum (Draft, not endorsed)");
  expect(reader.receiptProvenance("canonical_review",rev.path,raw(rev.path)).tier).toBe("server_witnessed");
 },60_000);

 it("M56-P1-03 Macro-IN: explicit geography/topic/period/role quoted from the Source, no issuer; duplicate link positive and inspect labels",async()=>{
  const first=await save(writeback("macro","Thailand Policy Rate",macroText,"https://example.org/bot/notice-a"));
  const rev=first.steps.find(s=>s.kind==="canonical_review")!,src=first.steps.find(s=>s.kind==="source_intake")!;
  expect(rev.path.startsWith("10_Knowledge/Macro and Markets/")).toBe(true);
  const dup=await save(writeback("macro","Thailand Policy Rate","SYNTHETIC (repost): The Bank of Thailand held the policy rate at 2.50% in October 2026, the synthetic notice was repeated.","https://www.example.org/bot/notice-b",true));
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const plan=planDuplicateSourceLinkM56({...planRequest(rev.path,dup.steps[0].path),eventAnchor:"synthetic-bot-rate-hold-2026-10",
   comparisonBasis:"Both synthetic notices report the same October 2026 Bank of Thailand policy-rate hold; same publisher family, not a new decision."});
  if(plan.status!=="requires_dedicated_review_revision_v2")throw Error(JSON.stringify(plan));
  expect(plan.requiredCompletion.subject).toEqual({domain:"macro",geography:null,topic:null,period:null,role:null,vintage:null,evidence:[]});
  const input:Record<string,any>={...plan.canonicalReviewRevision,analystAssessment:assessment("duplicate"),
   subject:{domain:"macro",geography:"Thailand",topic:"policy rate",period:"October 2026",role:"policy_decision",vintage:null,
    evidence:[await quote(src.path,"The Bank of Thailand held the policy rate at 2.50% in October 2026")]}};
  input.sourceEvent=await sealed(input,"duplicate","duplicate_link_only");
  const {prepared,result}=await revise(input);
  expect(prepared.subject.subjectKey).toMatch(/^macro:[a-f0-9]{32}$/);expect(prepared.subject.label).toContain("Macro Thailand — policy rate — October 2026 (policy_decision)");
  expect(result).toMatchObject({status:"revision_saved_verified",issuerBinding:"not_applicable_no_issuer"});
  expect(raw(rev.path)).toContain(`[[${dup.steps[0].path.slice(0,-3)}]]`);
  const bridge=await import("../mcp/canonical-review-revision");
  expect(bridge.inspectCanonicalReviewRevision(prepared.operationId,actor).gate).toMatchObject({version:"IOS-REVIEW-REVISION-PILOT-3-SUBJECT",domain:"macro",
   subjectKey:prepared.subject.subjectKey,subjectBinding:"not_verified",independentEvidenceIncrement:0});
 },60_000);

 it("M56-P1-04/05/06/07/09 negatives: cross-domain, unsupported/changed subject, stale hash, wrong IN-ID/actor, relation drift, mixed pair, legacy/Company V1 paths — no Review/plan/witness/receipt/index/link effect",async()=>{
  const {rev,src,dupPath}=await industrySetup();
  const {input}=await industryInput(rev,dupPath,src);
  const bridge=await import("../mcp/canonical-review-revision");
  const refuse=async(name:string,payload:unknown,code:RegExp,who=actor)=>{
   const before=await ledger();
   expect(()=>bridge.prepareReviewRevision(payload,who),name).toThrow(code);
   expect(await ledger(),name).toEqual(before);
  };
  const withEvent=async(i:Record<string,any>):Promise<Record<string,any>>=>({...i,sourceEvent:await sealed(i,"duplicate","duplicate_link_only")});
  const good=await withEvent(input);
  // M56-P1-04 cross-domain: Industry Review addressed as Macro, a Company path in V2, an Industry path in V1.
  await refuse("industry review as macro",{...good,existingReview:{...good.existingReview,reviewScope:"macro"},
   subject:{domain:"macro",geography:"Korea",topic:"memory",period:"October 2026",role:"market_event",vintage:null,evidence:good.subject.evidence}},/revision_subject_domain_scope_hold/);
  await refuse("company path in V2",{...good,existingReview:{...good.existingReview,path:"10_Knowledge/Company Research/Investment Review - TESTA - "+good.existingReview.intakeId+".md"}},/revision_subject_domain_scope_hold/);
  await refuse("industry path in V1",{existingReview:{path:rev.path,expectedSha256:good.existingReview.expectedSha256,receiptId:good.existingReview.receiptId,
   relationship:"duplicate",comparisonBasis:good.existingReview.comparisonBasis},entity:"MEMORY",additionalSources:good.additionalSources,reviewDate:good.reviewDate,
   methodVersion:good.methodVersion,analystAssessment:good.analystAssessment,revisionText:good.revisionText},/Company Research|invalid|regex|path/i);
  // Subject binding: another Hub, macro geography/period not stated by the Source, forecast detail.
  await seed("02_Industries_Themes/Foundry.md","# Foundry\n");
  await refuse("other hub",{...good,subject:{...good.subject,hubPath:"02_Industries_Themes/Foundry.md"}},/revision_subject_binding_hold/);
  await refuse("evidence not exact",{...good,subject:{...good.subject,evidence:[{...good.subject.evidence[0],quote:"Memory Semiconductors contract prices FELL"}]}},/revision_subject_evidence_hold/);
  // M56-P1-07: stale hash / forged receipt / mismatched IN-ID / wrong actor.
  await refuse("stale hash",{...good,existingReview:{...good.existingReview,expectedSha256:"0".repeat(64)}},/revision_review_receipt_hash_hold/);
  await refuse("forged receipt",{...good,existingReview:{...good.existingReview,receiptId:"ICW-"+"a".repeat(32)}},/revision_review_receipt_hash_hold/);
  await refuse("wrong IN-ID",{...good,existingReview:{...good.existingReview,intakeId:"IN-0000000000000000"}},/revision_draft_review_required/);
  await refuse("wrong actor",good,/source_event_envelope_actor_or_expiry_hold/,"oauth:someone-else");
  // M56-P1-09: tampered packet/result binding (V2 packet drift) is refused before enrollment.
  const tampered=await withEvent(input);tampered.sourceEvent.result.packetDigest="f".repeat(64);
  await refuse("result binding drift",tampered,/source_event_result_binding_hold/);
  // M56-P1-07: stale index/readback — Review metadata (and bytes) changed on disk without reindex.
  {const bytes=raw(rev.path),before=await ledger();
   fs.writeFileSync(path.join(vault,rev.path),bytes.replace("---\n","---\nstale_probe: true\n"));
   expect(()=>bridge.prepareReviewRevision(good,actor)).toThrow(/index_readback_mismatch/);
   fs.writeFileSync(path.join(vault,rev.path),bytes+"\nunindexed body drift\n");
   expect(()=>bridge.prepareReviewRevision(good,actor)).toThrow(/revision_review_receipt_hash_hold/);
   fs.writeFileSync(path.join(vault,rev.path),bytes);
   expect(await ledger()).toEqual(before);}
  // M56-P1-09: relation drift (sealed added_detail for a duplicate request) refused before enrollment.
  await refuse("relation drift",{...input,sourceEvent:await sealed(input,"added_detail","append_revision")},/revision_event_relation_binding_hold/);
  // Analyst disposition/materiality cannot be downgraded into a routine revision.
  await refuse("material",{...good,analystAssessment:{...good.analystAssessment,materiality:"material"}},/revision_material_or_unresolved_hold/);
  // M56-P1-05: changed period / mixed pair are semantic HOLDs: by design (as V1) only a restrictive
  // non-PASS journal row is enrolled — no Review/plan/witness/receipt/index/link/op change.
  for(const [name,tweak,relation,action] of [
    ["changed period",(r:Record<string,any>)=>{r.event.comparison.period="different";},"duplicate","duplicate_link_only"],
    ["changed unit",(r:Record<string,any>)=>{r.event.comparison.unit="different";},"duplicate","duplicate_link_only"],
    ["mixed pair",undefined,"duplicate","append_revision"]] as const){
   const before=await ledger();
   const payload={...input,sourceEvent:await sealed(input,relation,action,tweak)};
   expect(()=>bridge.prepareReviewRevision(payload,actor),name).toThrow(/source_event_revision_hold/);
   const after=await ledger();
   expect({...after,events:[]},name).toEqual({...before,events:[]});
   expect(after.events.length-before.events.length,name).toBe(1);
   expect(JSON.parse((after.events.at(-1) as {detail:string}).detail).body.decision,name).toBe("HOLD");
  }
 },90_000);

 it("M56-P1-05 Macro-IN negatives: geography/period not stated by the Source, forecast/guidance added detail, underspecified scope — no side effect",async()=>{
  const first=await save(writeback("macro","Thailand Policy Rate",macroText,"https://example.org/bot/notice-a"));
  const rev=first.steps.find(s=>s.kind==="canonical_review")!,src=first.steps.find(s=>s.kind==="source_intake")!;
  const dup=await save(writeback("macro","Thailand Policy Rate","SYNTHETIC (repost): The Bank of Thailand held the policy rate at 2.50% in October 2026, the synthetic notice was repeated.","https://www.example.org/bot/notice-b",true));
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const plan=planDuplicateSourceLinkM56({...planRequest(rev.path,dup.steps[0].path),eventAnchor:"synthetic-bot-rate-hold-2026-10",
   comparisonBasis:"Both synthetic notices report the same October 2026 Bank of Thailand policy-rate hold; same publisher family, not a new decision."});
  if(plan.status!=="requires_dedicated_review_revision_v2")throw Error(JSON.stringify(plan));
  const evidence=[await quote(src.path,"The Bank of Thailand held the policy rate at 2.50% in October 2026")];
  const base:Record<string,any>={...plan.canonicalReviewRevision,analystAssessment:assessment("duplicate"),
   subject:{domain:"macro",geography:"Thailand",topic:"policy rate",period:"October 2026",role:"policy_decision",vintage:null,evidence}};
  const bridge=await import("../mcp/canonical-review-revision");
  for(const [name,payload,code] of [
    ["inferred geography",{...base,subject:{...base.subject,geography:"ASEAN"}},/revision_macro_subject_unsupported_hold/],
    ["inferred period",{...base,subject:{...base.subject,period:"Q4 2026"}},/revision_macro_subject_unsupported_hold/],
    ["forecast detail",{...base,existingReview:{...base.existingReview,relationship:"added_detail"},analystAssessment:assessment("added_detail"),
      subject:{...base.subject,role:"forecast_or_guidance"}},/revision_material_or_unresolved_hold/],
    ["underspecified",{...base,subject:{...base.subject,topic:""}},/too_small|>=1|at least/i],
    ["no Source quote",{...base,subject:{...base.subject,evidence:[]}},/too_small|>=1|at least/i]] as const){
   const before=await ledger();
   expect(()=>bridge.prepareReviewRevision(payload,actor),name).toThrow(code);
   expect(await ledger(),name).toEqual(before);
  }
 },60_000);

 it("M56-P1 subject ambiguity: an Industry-IN Review declaring two Hubs is HOLD_SUBJECT_AMBIGUOUS in the planner and the V2 route — no side effect",async()=>{
  await seed(hub,"# Memory Semiconductors\n");await seed("02_Industries_Themes/Foundry.md","# Foundry\n");
  const first=await save({...writeback("industry","Memory Semiconductors",industryText,"https://example.org/memory/tracker-a"),entities:["Memory Semiconductors","Foundry"]});
  const rev=first.steps.find(s=>s.kind==="canonical_review")!,src=first.steps.find(s=>s.kind==="source_intake")!;
  expect(raw(rev.path)).toContain(`industry_hubs: ["${hub}","02_Industries_Themes/Foundry.md"]`);
  const dup=await save(writeback("industry","Memory Semiconductors","SYNTHETIC (second edition): Memory Semiconductors contract prices rose in October 2026 for DRAM, the synthetic tracker repeated.","https://www.example.org/memory/tracker-b",true));
  const {planDuplicateSourceLinkM56}=await import("./event-review-relation-m56");
  const before=await ledger();
  expect(planDuplicateSourceLinkM56(planRequest(rev.path,dup.steps[0].path))).toMatchObject({status:"hold_subject_ambiguous",canonicalReviewRevision:null,writePerformed:false});
  const bridge=await import("../mcp/canonical-review-revision"),reader=await import("./investment-research-context");
  const evidence=[await quote(src.path,"Memory Semiconductors contract prices rose in October 2026")];
  expect(()=>bridge.prepareReviewRevision({selectorVersion:"M56-REVIEW-SELECTOR-2",entity:"industry",
   existingReview:{path:rev.path,intakeId:rev.path.match(/IN-[A-F0-9]{16}/)![0],expectedSha256:sha(raw(rev.path)),receiptId:reader.createReceipt("canonical_review",rev.path,raw(rev.path)),
    reviewScope:"industry",originalSourcePath:src.path,relationship:"duplicate",comparisonBasis:"Both synthetic editions report the same October 2026 memory contract price rise."},
   subject:{domain:"industry",hubPath:hub,topic:"DRAM contract pricing",period:"October 2026",evidence},
   additionalSources:[{path:dup.steps[0].path,sha256:sha(raw(dup.steps[0].path)),receiptId:dup.steps[0].receiptKey}],reviewDate:"2026-11-14",methodVersion:"T",
   analystAssessment:assessment("duplicate"),revisionText:"Synthetic probe."},actor)).toThrow(/revision_subject_ambiguous_hold/);
  expect(await ledger()).toEqual(before);
 },60_000);

 it("M56-P1-07/10: apply-time Source drift refuses with no write; replay after success is idempotent with no duplicate append",async()=>{
  const {rev,src,dupPath}=await industrySetup();
  const {input}=await industryInput(rev,dupPath,src);
  input.sourceEvent=await sealed(input,"duplicate","duplicate_link_only");
  const bridge=await import("../mcp/canonical-review-revision"),engine=await import("../safe-edit/engine");
  const p=bridge.prepareReviewRevision(input,actor) as {operationId:string;preview:{previewToken:string;beforeHash:string}};
  const view=engine.adminPreview(p.operationId) as {afterHash:string;reviewedEvidenceDigest?:string};
  engine.approve(p.operationId,"synthetic-dashboard-reviewer",view.afterHash,view.reviewedEvidenceDigest);
  const authorization={operationId:p.operationId,previewToken:p.preview.previewToken,expectedHash:p.preview.beforeHash};
  const reviewBefore=raw(rev.path);
  // Timeout: the approved preview expired (synthetic clock) → refused, Review untouched.
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+31*60_000);
  await expect(bridge.applyReviewRevision({input,operationId:p.operationId,authorization},actor)).rejects.toThrow(/expir|Approval|revision_/i);
  vi.useRealTimers();expect(raw(rev.path)).toBe(reviewBefore);
  // Drift: the added Source changes on disk after approval (synthetic) → refused, Review untouched.
  const dupBytes=raw(dupPath);
  fs.writeFileSync(path.join(vault,dupPath),dupBytes.replace("repeated","re-edited"));(await import("./indexer")).reindexPath(dupPath);
  await expect(bridge.applyReviewRevision({input,operationId:p.operationId,authorization},actor)).rejects.toThrow(/revision_source|source_event/);
  expect(raw(rev.path)).toBe(reviewBefore);
  fs.writeFileSync(path.join(vault,dupPath),dupBytes);(await import("./indexer")).reindexPath(dupPath);
  const done=await bridge.applyReviewRevision({input,operationId:p.operationId,authorization},actor);
  expect(done).toMatchObject({status:"revision_saved_verified"});
  const once=raw(rev.path);
  const again=await bridge.applyReviewRevision({input,operationId:p.operationId,authorization},actor);
  expect(again).toMatchObject({status:"revision_saved_verified"});expect(raw(rev.path)).toBe(once);
  expect(once.split("### Duplicate Source link").length-1).toBe(1);
  // Re-preparing the same input after success is refused (Review hash moved on): no second append.
  const before=await ledger();
  expect(()=>bridge.prepareReviewRevision(input,actor)).toThrow(/revision_review_receipt_hash_hold/);
  expect(await ledger()).toEqual(before);
 },60_000);
});

describe("Macro declared-subject capture contract",()=>{
 const text="Macro subject: Fictionland\nSynthetic documentation only; no economic assertions.";
 const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
 const data=()=>({domain:"macro" as const,entities:["Fictionland"],topic:"Documentation",inputFormat:"text" as const,sourceKind:"user_commentary" as const,
  sourceChat:"New synthetic scope fixture",extractedText:text,captureOnly:true,
  macroSubject:{version:"RI001-MACRO-SOURCE-SCOPE-1" as const,kind:"country" as const,label:"Fictionland",
   anchor:{quote:"Macro subject: Fictionland",locator:`utf16:0:${"Macro subject: Fictionland".length}`,sourceSha256:sha(text)}}});
 it("renders new validated scope but never an issued receipt in preview bytes",async()=>{
  const p=await route(data()),step=p.safeEditWorkflow!.steps[0],content=(step.safeEditRequest!.change as {content:string}).content;
  const fm=(await import("./markdown")).splitFrontmatter(content).data;
  expect(fm.macro_subject).toMatchObject({key:"FICTIONLAND",authority:"source_declared_not_geographic_verification"});
  expect(content).toContain(text);expect(content).not.toContain(step.receiptKey);
  expect(step.readbackVerified).toBe(false);expect(fs.existsSync(path.join(vault,step.path))).toBe(false);
 });
 it.each(["absent","alias","conjunction","substring","duplicate","unicode-digit"])("does not infer a scope from %s",async fault=>{
  const d=data();
  if(fault==="absent")d.extractedText="Fictionland mentioned by another document";
  if(fault==="alias")d.macroSubject.label="FI";
  if(fault==="conjunction")d.extractedText="Macro subject: Fictionland and Otherland\nSynthetic";
  if(fault==="substring")d.macroSubject.anchor.locator="utf16:15:25";
  if(fault==="duplicate")d.extractedText+="\nMacro subject: Otherland";
  if(fault==="unicode-digit")d.macroSubject.label="Fictionland๒";
  const p=await route(d);expect(p.macroScope?.binding).toBeNull();expect(p.macroScope?.reason).toMatch(/hold/);
  const step=p.safeEditWorkflow!.steps[0];expect(step.state).toBe("needs_create");expect((step.safeEditRequest!.change as {content:string}).content).not.toContain("macro_subject:");
 });
 it("validates the whole exact CRLF/NFC source and restores only a hash-proven terminal newline",async()=>{
  const m=await import("./macro-source-scope"),text="Macro subject: Île\r\nSynthetic document\n",line="Macro subject: Île";
  const value={version:m.MACRO_SOURCE_POLICY,kind:"country",label:"Île",anchor:{quote:line,locator:`utf16:0:${line.length}`,sourceSha256:sha(text)}};
  const r=m.validateMacroSubject(value,text,"macro",["Île"]);expect(r.binding?.key).toBe("ÎLE");
  expect(m.readMacroSourceScope(r.binding,text.slice(0,-1),sha(text))).toEqual(r.binding);
  expect(()=>m.readMacroSourceScope(r.binding,text.slice(0,-1),sha(text+" "))).toThrow();
 });
});

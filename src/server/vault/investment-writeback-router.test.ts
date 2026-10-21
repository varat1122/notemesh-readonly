import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
let root:string,vault:string;
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"investment-route-")));
 vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
 vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,content:string){
 const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});
 fs.writeFileSync(abs,content,"utf8");
 const {reindexPath}=await import("./indexer");reindexPath(p);
}
const base={
 domain:"company" as const, entities:["MDB"],topic:"BofA reiterates MongoDB Buy $540",
 inputFormat:"screenshot" as const,sourceKind:"broker_research" as const,
 sourceLanguage:"en",publisher:"BofA via user screenshot",
 extractedText:"BofA Securities reiterates Buy on MongoDB, price target $540; enterprise modernisation and AI narrative. The screenshot is user-supplied and the full broker note is not available.",
 publicationDate:"2026-10-14"
};
describe("multilingual read-only writeback router",()=>{
 it("routes BofA MDB screenshot as attributed review; PT repetition not a new price-target revision",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const p=route(base);
  expect(p.status).toBe("read_only_plan_not_written");
  expect(p.sourceCapture.preservation).toBe("needs_safe_edit_raw_capture");
  expect(p.sourceCapture.attachmentVerified).toBe(false);
  expect(p.exactClaimReview.classification).toBeNull();
  expect(p.routes.find(x=>x.kind==="company_timeline_candidate")?.action).toBe("link_existing_or_hold");
  expect(p.warnings.some(x=>x.includes("'reiterates'"))).toBe(true);
  expect(p.gates.canAutoUpdateThesis).toBe(false);
  expect(p.gates.canAutoWrite).toBe(false);
  expect(fs.readdirSync(vault)).toHaveLength(0);
 });
 it("Citi AI connectivity/HDD/NAND multi-issuer preview goes to research without inferred company guidance",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const p=route({domain:"industry",entities:["AI Connectivity","HDD","NAND"],topic:"Citi 3Q26 AI Connectivity and Storage Preview",
   inputFormat:"screenshot",sourceKind:"broker_research",sourceLanguage:"en",
   extractedText:"Citi prefers connectivity; content per system may rise. HDD pricing power may persist, NAND could see demand from inference. Risk and valuation need source review."});
  expect(p.entityScope).toEqual(["AI Connectivity","HDD","NAND"]);
  expect(p.routes.find(x=>x.kind==="research_review")?.path).toContain("10_Knowledge/Industry and Concepts/");
  expect(p.routes.some(x=>x.kind==="company_timeline_candidate")).toBe(false);
  expect(p.routes.find(x=>x.kind==="industry_context_candidate")?.action).toBe("link_existing_or_hold");
  expect(p.warnings).toContain("No verified, matching original image/PDF attachment bytes; call scoped Safe Edit store_user_attachment first.");
 });
 it("NVIDIA announced planned investment is a future intention, not proved completed capex",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const p=route({domain:"company",entities:["NVDA"],topic:"Reported NVIDIA Europe AI investment plan",
    sourceKind:"news_media",inputFormat:"screenshot",sourceLanguage:"en",
    extractedText:"A user screenshot reports that NVIDIA plans to announce $2bn in new European AI investment next week; actual deployment and beneficiaries are not yet evidenced.",
    eventDate:null});
  expect(p.chronology.eventDate).toBeNull();
  expect(p.routes.find(x=>x.kind==="company_timeline_candidate")?.action).toBe("link_existing_or_hold");
  expect(p.warnings.join(" ")).toContain("announced investments to completed spending");
  expect(p.sourceCapture.originalSourceVerified).toBe(false);
 });
 it("accepts Thai/Vietnamese/Japanese Unicode text without silent translation or event date guessing",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  for(const [lang,text] of [
   ["th","สรุปวิจัย ธนาคารกลางเวียดนาม: ยอดสินเชื่อต้องแยกจากเงินสดจริง"],
   ["vi","Ngân hàng Việt Nam: đây là một đánh giá chưa được kiểm chứng"],
   ["ja","日本の設備投資ニュースは確認待ちです"]]){
    const p=route({domain:"macro",entities:["Vietnam"],topic:"Research input in original language",
     sourceKind:"user_commentary",inputFormat:"text",sourceLanguage:lang,extractedText:text});
    expect(p.sourceLanguage).toBe(lang);
    expect(p.chronology.eventDate).toBeNull();
    expect(p.sourceCapture.extractedTextIsOriginalBinary).toBe(false);
    expect(p.exactClaimReview.status).toBe("not_checked_missing_exact_fields");
   }
 });
 it("stable deterministic plan ID and candidate paths under repeated identical user input",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const a=route(base),b=route(base);
  expect(a.planId).toBe(b.planId);
  expect(a.routes[0].path).toBe(b.routes[0].path);
  expect(a.sourceCapture.textDigest).toHaveLength(64);
  expect(route({...base,extractedText:base.extractedText+" Amended."}).planId).not.toBe(a.planId);
 });
 it("does not auto-create a claim for an exact structured duplicate from an original URL",async()=>{
  const u="https://www.sec.gov/Archives/edgar/data/2488/fake-Q2.htm";
  await add("08_Daily_Weekly/Research Indexes/AMD source.md",[
   "---","type: investment_structured_claim_register","domain: company","entity: AMD",
   "original_source: "+u,
   "claims:","  - claim_id: AMD-REV","    metric: net_revenue",
   "    period: 2026Q2_ended_2026-06-27","    value: \"11536\"",
   "    unit: USD millions","---","# Synthetic claim"].join("\n"));
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const p=route({domain:"company",entities:["AMD"],topic:"AMD 2Q26 net revenue source",
    inputFormat:"text",sourceKind:"regulatory_filing",sourceUrl:u,
    extractedText:"AMD 2Q26 reported net revenue of USD 11,536 million.",
    claim:{metric:"net_revenue",period:"2026Q2_ended_2026-06-27",
      statement:"AMD Q2 2026 net revenue reported 11,536 million dollars.",
      value:"11536",unit:"USD millions"}});
  expect(p.exactClaimReview.classification).toBe("duplicate_candidate");
  expect(p.exactClaimReview.matchingClaimPaths).toContain("08_Daily_Weekly/Research Indexes/AMD source.md");
  expect(p.routes.find(x=>x.kind==="claim_registry_candidate")).toBeUndefined();
  expect(p.gates.duplicateAdjudicated).toBe(false);
 });
 it("links an actually stored screenshot only with a live matching SHA receipt",async()=>{
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";
  try{
   const {storeUserAttachment}=await import("../user-attachment-vault");
   const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from("synthetic Citi Research screenshot exact bytes")]);
   const receipt=storeUserAttachment({base64:bytes.toString("base64"),contentType:"image/png"});
   const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
   const p=route({...base,rawAttachmentSha256:receipt.sha256,
     rawAttachmentContentType:"image/png",rawAttachmentPath:receipt.path});
   expect(p.sourceCapture.attachmentVerified).toBe(true);
   expect(p.sourceCapture.preservation).toBe("stored_original_user_bytes");
   expect(p.sourceCapture.rawAttachmentPath).toBe(receipt.path);
   expect(p.sourceCapture.originalSourceVerified).toBe(false);
   expect(p.gates.attachmentArchived).toBe(true);
   expect(p.gates.canAutoWrite).toBe(false);
   expect(p.gates.canAutoUpdateThesis).toBe(false);
   expect(()=>route({...base,rawAttachmentSha256:receipt.sha256,
      rawAttachmentContentType:"image/png",rawAttachmentPath:"07_Sources/ChatGPT/Attachments/other.png"}))
     .toThrow(/digest_mismatch/);
   fs.writeFileSync(path.join(vault,receipt.path),Buffer.alloc(bytes.length,0x44));
   const later=route({...base,rawAttachmentSha256:receipt.sha256,rawAttachmentContentType:"image/png"});
   expect(later.sourceCapture.attachmentVerified).toBe(false);
   expect(later.gates.attachmentArchived).toBe(false);
  }finally{
   delete process.env.SAFE_EDIT_ENABLED;delete process.env.SAFE_EDIT_SINGLE_WRITER;
  }
 });
 it("date validation rejects invented impossible source dates; invalid ticker does not route to invented issuer timeline",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  expect(()=>route({...base,eventDate:"2026-02-30"})).toThrow(/invalid calendar/);
  const p=route({...base,entities:["上海机场"]});
  expect(p.routes.find(x=>x.kind==="company_timeline_candidate")).toBeUndefined();
  expect(p.routes.find(x=>x.kind==="industry_context_candidate")).toBeDefined();
 });
});

describe("new intake reconciles legacy company navigation before proposing Vault writes", () => {
 it("links to the retained historical issuer index and never implies absent history", async () => {
  await add("10_Knowledge/Indexes/Company - MDB.md",
   "# Legacy MDB history\\n\\nArchived notes in older Company Index; not independently verified.");
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const p=route(base);
  expect(p.status).toBe("read_only_plan_not_written");
  expect(p.historical.paths).toContain("10_Knowledge/Indexes/Company - MDB.md");
  expect(p.historical.missing.some(x=>x.includes("No legacy Company Index found for MDB"))).toBe(false);
  expect(p.historical.missing).not.toContain("08_Daily_Weekly/Research Indexes/Company - MDB.md");
  expect(p.gates.canAutoWrite).toBe(false);
  expect(p.gates.canAutoUpdateThesis).toBe(false);
 });
});


describe("P0 new-intake reconciliation against archived company events", () => {
 it("flags possible same-event CRWD CLEAR archive before proposing a distinct research review", async () => {
  const event="10_Knowledge/Company Research/2026-08-31 - CrowdStrike × CLEAR - Stock160726-190.md";
  await add(event,[
    "---","company: [CRWD]","verification: not_reverified","source_type: chatgpt_history","---",
    "# CrowdStrike × CLEAR identity verification",
    "CRWD historical user-shared CLEAR enterprise identity collaboration."
  ].join("\n"));
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const plan=route({
    domain:"company",entities:["CRWD"],
    topic:"CrowdStrike CLEAR identity verification partnership",
    inputFormat:"text",sourceKind:"archived_chat",
    extractedText:"CrowdStrike $CRWD CLEAR partnership biometric identity verification: this is a historical user-shared account, not newly issuer-verified evidence."
  });
  expect(plan.historical.paths).toContain(event);
  expect(plan.historicalEventReview.status).toBe("possible_same_event_candidates");
  expect(plan.historicalEventReview.candidatePaths).toContain(event);
  expect(plan.historicalEventReview.duplicateAdjudicated).toBe(false);
  expect(plan.routes.find(x=>x.kind==="research_review")?.reason).toContain("Possible prior event");
  expect(plan.gates.canAutoWrite).toBe(false);
  expect(plan.gates.canAutoUpdateThesis).toBe(false);
 });
 it("does not label a missing selected historical event as proven new", async () => {
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const plan=route(base);
  expect(plan.historicalEventReview.duplicateAdjudicated).toBe(false);
  expect(["possible_same_event_candidates","none_selected_not_proof_new"])
    .toContain(plan.historicalEventReview.status);
 });
});


describe("intake identity marker blocks repeat Timeline append", () => {
 it("routes repeated identical intake to existing Timeline link without a duplicate event", async () => {
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const request={domain:"company" as const,entities:["MCKT"],topic:"Synthetic one-off milestone 2026-10-19",
   inputFormat:"text" as const,sourceKind:"user_commentary" as const,
   extractedText:"Synthetic MCKT milestone supplied by user for test purposes, no independent issuer verification."};
  const first=route(request);
  const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - MCKT.md";
  await add(timeline,"# Synthetic MCKT Timeline\n## Chronology\nExisting archival item only.\n");
  const before=route(request);
  expect(before.routes.find(x=>x.kind==="company_timeline_candidate")?.action)
    .toBe("candidate_append_after_review");
  await add(timeline,"# Synthetic MCKT Timeline\n## Chronology\n<!-- investment-intake:"+first.planId+" -->\n");
  const after=route(request);
  expect(after.planId).toBe(first.planId);
  expect(after.routes.find(x=>x.kind==="company_timeline_candidate")).toMatchObject({
    action:"link_existing_or_hold"
  });
  expect(after.routes.find(x=>x.kind==="company_timeline_candidate")?.reason)
    .toContain("already recorded");
  expect(after.gates.canAutoWrite).toBe(false);
  expect(after.gates.canAutoUpdateThesis).toBe(false);
 });
});


describe("same-source economic event reconciliation despite changed input text",()=>{
 const url="https://www.sec.gov/Archives/edgar/data/88941/000008894126000041/smtc-20261015.htm";
 const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - SMTC.md";
 const evidence="08_Daily_Weekly/Research Indexes/Primary Evidence - SMTC 2026-10-15 Analyst Day.md";
 const intake={
   domain:"company" as const,entities:["SMTC"],
   topic:"Semtech analyst day FY2030 target",sourceKind:"regulatory_filing" as const,
   inputFormat:"text" as const,eventDate:"2026-10-15",publicationDate:"2026-10-15",
   sourceUrl:url,extractedText:"Semtech 15 October FY2030 targets reviewed in user supplied regulator excerpt."
 };
 it("holds a different paraphrase of the *same issuer/event date/original URL* before append",async()=>{
   await add(timeline,"---\ncompany: SMTC\n---\n# SMTC chronology\nPreviously dated events.");
   await add(evidence,[
     "---","type: primary_ir_evidence_review","company: SMTC",
     "event_date: 2026-10-15","published_at: 2026-10-15",
     "verification: not_reverified","---","# Synthetic primary excerpt",url
   ].join("\n"));
   const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
   const first=route(intake);
   const second=route({...intake,extractedText:intake.extractedText+" New wording about adjusted margins."});
   expect(first.planId).not.toBe(second.planId);
   for(const plan of [first,second]){
     expect(plan.sourceEventReview).toMatchObject({
       status:"possible_same_source_event_candidates",
       candidatePaths:[evidence],duplicateAdjudicated:false,scanTruncated:false
     });
     expect(plan.routes.find(x=>x.kind==="company_timeline_candidate")?.action).toBe("link_existing_or_hold");
     expect(plan.gates.canAutoWrite).toBe(false);
     expect(plan.gates.canAutoUpdateThesis).toBe(false);
   }
   const tracked=route({...intake,sourceUrl:url+"?utm_campaign=test"});
   expect(tracked.sourceEventReview.candidatePaths).toContain(evidence);
 });
 it("does not merge different event dates from a reused source URL",async()=>{
   await add(timeline,"# SMTC chronology.");
   await add(evidence,[
     "---","company: SMTC","event_date: 2026-10-15","verification: not_reverified",
     "original_source: "+url,"---","# Existing prior event"
   ].join("\n"));
   const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
   const later=route({...intake,eventDate:"2026-12-15"});
   expect(later.sourceEventReview.status).toBe("no_structured_match_not_proof_new");
   expect(later.sourceEventReview.candidatePaths).toHaveLength(0);
   expect(later.routes.find(x=>x.kind==="company_timeline_candidate")?.action).toBe("candidate_append_after_review");
   expect(later.gates.canAutoWrite).toBe(false);
 });
 it("rejects issuer co-mentions as distinct company event evidence",async()=>{
   await add(timeline,"# SMTC chronology.");
   await add("10_Knowledge/Company Research/2026-10-15 - LITE industry review.md",[
     "---","company: [LITE]","event_date: 2026-10-15","---",
     "# LITE research with passing mention of SMTC",url
   ].join("\n"));
   const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
   const p=route(intake);
   expect(p.sourceEventReview.candidatePaths).toHaveLength(0);
   expect(p.sourceEventReview.duplicateAdjudicated).toBe(false);
 });
});


describe("date-scoped intake identity with v1 source preservation",()=>{
 const original="https://www.sec.gov/Archives/edgar/data/88941/smtc-source-2026.htm";
 const baseRequest={domain:"company" as const,entities:["SMTC"],
   topic:"Same exact source transcript about two dated events",inputFormat:"text" as const,
   sourceKind:"regulatory_filing" as const,sourceUrl:original,
   eventDate:"2026-10-15",publicationDate:"2026-10-15",
   extractedText:"Synthetic Semtech original text verbatim repeated despite a later fiscal event date."};
 it("does not assign one raw intake ID to two distinct declared economic event dates",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const a=route(baseRequest),b=route({...baseRequest,eventDate:"2026-10-16"});
  expect(a.planId).not.toBe(b.planId);
  expect(a.routes.find(x=>x.kind==="raw_input")?.path).not.toBe(b.routes.find(x=>x.kind==="raw_input")?.path);
  expect(a.chronology.eventDate).toBe("2026-10-15");
  expect(b.chronology.eventDate).toBe("2026-10-16");
  expect(route(baseRequest).planId).toBe(a.planId);
 });
 it("keeps the original v1 ID for an already indexed matching dated raw note",async()=>{
  const {createHash}=await import("node:crypto");
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const legacy=createHash("sha256").update([
    "investment_os_intake_v1","company","text","regulatory_filing",
    "smtc",original,"",baseRequest.extractedText
  ].join("\n")).digest("hex");
  const legacyId="IN-"+legacy.slice(0,16).toUpperCase();
  await add("00_Inbox/ChatGPT/Investment Intake - "+legacyId+".md",[
    "---","company: [SMTC]","event_date: 2026-10-15","published_at: 2026-10-15",
    "verification: not_reverified","---","# Previously saved raw source","Synthetic source record"
  ].join("\n"));
  const matched=route(baseRequest);
  expect(matched.planId).toBe(legacyId);
  expect(matched.routes.find(x=>x.kind==="raw_input")?.action).toBe("link_existing_or_hold");
  expect(route({...baseRequest,eventDate:"2026-10-16"}).planId).not.toBe(legacyId);
  expect(route({...baseRequest,publicationDate:"2026-10-16"}).planId).not.toBe(legacyId);
 });
});


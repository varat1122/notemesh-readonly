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
  expect(p.coordination.status).toBe("read_only_coordination_not_written");
  expect(p.coordination.steps.map(x=>x.kind)).toEqual(["raw_input","research_review","company_timeline_candidate"]);
  expect(p.coordination.steps[0].action).toBe("hold"); // screenshot binary not actually archived
  expect(p.coordination.steps[1].dependsOn).toEqual([p.coordination.steps[0].operationId]);
  expect(p.safeEditDrafts.original.status).toBe("hold");
  expect(p.safeEditDrafts.original.content).toBeNull();
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
    expect(p.safeEditDrafts.original.content).toContain(text);
    expect(p.safeEditDrafts.analysis.status).toBe("hold");
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
  // Raw note preserves whitespace; ID must not collide across distinct bytes.
  expect(route({...base,extractedText:" "+base.extractedText}).planId).not.toBe(a.planId);
  expect(route({...base,extractedText:base.extractedText+"\n"}).planId).not.toBe(a.planId);
 });
 it("does not conflate identically worded originals with different event or attribution metadata",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const b={domain:"company" as const,entities:["MDB"],topic:"Broker analysis 1",
    inputFormat:"text" as const,sourceKind:"archived_chat" as const,
    extractedText:"Same captured words, but possibly different underlying event.",
    publisher:"Attributed source A",sourceLanguage:"th",eventDate:"2026-10-14",
    publicationDate:"2026-10-15"};
  const first=route(b);
  for(const changed of [
    {topic:"Broker analysis 2"},{publisher:"Attributed source B"},
    {sourceLanguage:"en"},{eventDate:"2026-10-15"},
    {publicationDate:"2026-10-16"},{entities:["mdb"]},
  ])expect(route({...b,...changed}).planId).not.toBe(first.planId);
  expect(route({...b,analysisText:"AI interpretation A"}).planId).toBe(first.planId);
  expect(route({...b,analysisText:"AI interpretation B"}).planId).toBe(first.planId);
  expect(route(b).safeEditDrafts.expectedOriginalSha256)
    .toBe(first.safeEditDrafts.expectedOriginalSha256);
 });
 it("rejects unpaired UTF-16 code units rather than silently changing original bytes",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  expect(()=>route({...base,extractedText:"broken"+String.fromCharCode(0xD800)}))
    .toThrow(/invalid Unicode/);
  expect(()=>route({...base,analysisText:String.fromCharCode(0xDFFF)}))
    .toThrow(/invalid Unicode/);
  expect(route({...base,extractedText:"Valid emoji 🚀 and Thai ภาษาไทย"}).sourceCapture.textDigest)
    .toHaveLength(64);
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
 it("integrates a separate human-supplied research interpretation without changing original ID",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  const t={domain:"company" as const,entities:["MDB"],topic:"BofA reiteration",
    inputFormat:"text" as const,sourceKind:"archived_chat" as const,
    extractedText:"BofA reiterates PT $540 (user-provided text only)"};
  const a=route(t);
  const b=route({...t,analysisText:"Broker PT is not issuer guidance. Report date unresolved."});
  expect(a.planId).toBe(b.planId);
  expect(a.safeEditDrafts.original.content).toBe(b.safeEditDrafts.original.content);
  expect(a.safeEditDrafts.analysis.content).toBeNull();
  expect(b.safeEditDrafts.analysis.content).toContain("Broker PT is not issuer guidance.");
  expect(b.safeEditDrafts.analysis.content).not.toContain("BofA reiterates PT $540");
  expect(b.safeEditDrafts.canAutoWrite).toBe(false);
  expect(b.coordination.steps[2].action).toBe("hold");
 });
 it("date validation rejects invented impossible source dates; invalid ticker does not route to invented issuer timeline",async()=>{
  const {planInvestmentWriteback:route}=await import("./investment-writeback-router");
  expect(()=>route({...base,eventDate:"2026-02-30"})).toThrow(/invalid calendar/);
  const p=route({...base,entities:["上海机场"]});
  expect(p.routes.find(x=>x.kind==="company_timeline_candidate")).toBeUndefined();
  expect(p.routes.find(x=>x.kind==="industry_context_candidate")).toBeDefined();
 });
});

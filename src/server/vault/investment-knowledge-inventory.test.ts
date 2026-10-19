import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let dir:string,vault:string;
beforeEach(()=>{
  dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"knowledge-inventory-")));
  vault=path.join(dir,"vault");fs.mkdirSync(vault,{recursive:true});
  process.env.DATA_DIR=dir;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(dir,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,frontmatter:string,body="# Synthetic"){
  const abs=path.join(vault,p);fs.mkdirSync(path.dirname(abs),{recursive:true});
  fs.writeFileSync(abs,frontmatter+"\n"+body,"utf8");
  const {reindexPath}=await import("./indexer");reindexPath(p);
}
async function report(){
 const {auditVaultKnowledgeIndex}=await import("./investment-knowledge-inventory");
 return auditVaultKnowledgeIndex();
}
async function auditCrossDomain(){return (await report()).linkHealth.crossDomainReview;}
const sec="https://www.sec.gov/Archives/edgar/data/2488/amd-Q2.htm";
const nvda="https://www.sec.gov/Archives/nvda-Q2.htm";
describe("full indexed vault metadata audit",()=>{
 it("audits claim metadata and preserves company vs macro periods without editing original files",async()=>{
   const amd=["---","type: investment_structured_claim_register","domain: company","entity: AMD",
     "event_key: AMD|Q2|SEC","original_source: "+sec,
     "source_type: primary","verification: verified_against_primary",
     "claims:","  - claim_id: AMD-REV","    metric: net_revenue",
     "    period: 2026Q2","    value: \"11536\"","    unit: USD millions","---"].join("\n");
   const vietnam=["---","type: investment_structured_claim_register","domain: macro","entity: Vietnam",
     "event_key: Vietnam|NSO|2026Q3_9M","original_source: https://www.nso.gov.vn/report",
     "claims:","  - claim_id: VNM-GDP-Q3","    metric: gdp_real_growth_yoy",
     "    period: 2026Q3","    value: \"9.95\"","    unit: percent",
     "  - claim_id: VNM-GDP-9M","    metric: gdp_real_growth_yoy",
     "    period: 2026_9M","    value: \"9.01\"","    unit: percent","---"].join("\n");
   const ap="08_Daily_Weekly/Research Indexes/AMD Claim.md";
   const vp="10_Knowledge/Macro and Markets/Vietnam Claim.md";
   await add(ap,amd,"# AMD\n[[10_Knowledge/Macro and Markets/Vietnam Claim]]");
   await add(vp,vietnam);
   const before=[fs.readFileSync(path.join(vault,ap),"utf8"),fs.readFileSync(path.join(vault,vp),"utf8")];
   const a=await report();
   expect(a.indexedNotes).toBe(2);
   expect(a.scannedNotes).toBe(2);
   expect(a.roleCounts.structured_claim).toBe(2);
   expect(a.claimRegisters.declaredClaimRows).toBe(3);
   expect(a.claimRegisters.noOriginalBytesHashDeclared).toBe(2);
   expect(a.claimRegisters.issueCounts).toEqual({});
   expect(a.duplicateCandidates.sameEventKey.totalGroups).toBe(0);
   expect(a.duplicateCandidates.sameExactSourceMetricPeriod.totalGroups).toBe(0);
   expect(a.status).toBe("partial_index_snapshot_do_not_claim_full_coverage");
   expect(a.linkHealth.unresolvedReferences).toBe(0);
   expect(fs.readFileSync(path.join(vault,ap),"utf8")).toBe(before[0]);
   expect(fs.readFileSync(path.join(vault,vp),"utf8")).toBe(before[1]);
 });
 it("reports exact-source duplicate candidate without labelling a verification or a thesis edit",async()=>{
  const front=["---","type: investment_structured_claim_register",
    "domain: company","entity: NVDA","event_key: NVDA|FY27H1|SEC",
    "original_source: "+nvda,
    "claims:","  - claim_id: NVDA-OCF","    metric: operating_cash_flow",
    "    period: FY27_H1_ended_2026-07-26","    value: \"74421\"","    unit: USD millions","---"].join("\n");
  await add("08_Daily_Weekly/Research Indexes/NVDA-A.md",front);
  await add("08_Daily_Weekly/Research Indexes/NVDA-B.md",front);
  const a=await report();
  expect(a.duplicateCandidates.sameEventKey.totalGroups).toBe(1);
  expect(a.duplicateCandidates.sameExactSourceMetricPeriod.totalGroups).toBe(1);
  expect(a.duplicateCandidates.sameEventKey.samples[0].count).toBe(2);
  expect(a.notes.join(" ")).toContain("only a duplicate candidate");
 });
 it("flags ambiguous legacy dates without demanding all archive chats have an economic event date",async()=>{
  await add("07_Sources/ChatGPT/Entries/Feed.md",
   ["---","type: research_note","source_type: user_supplied_chatgpt_summary",
    "date: 2026-09-01","imported_on: 2026-10-17","---"].join("\n"));
  await add("09_Templates/News Intake Template.md",["---","type: news","source_type: unverified","---"].join("\n"));
  const a=await report();
  expect(a.legacyWarnings.counts.legacy_date_is_not_event_date).toBe(1);
  expect(a.legacyWarnings.counts.legacy_imported_on_not_inferred).toBe(1);
  expect(a.legacyWarnings.counts.source_type_misused_for_verification).toBe(1);
  expect(a.sourceTypeCounts["(unmapped_legacy_type)"]).toBe(2);
  expect(a.rawSourceTypeCounts.user_supplied_chatgpt_summary).toBe(1);
  expect(a.normalizedSourceTypeCounts.user_supplied).toBe(1);
  expect(a.sourceTypeMappingCounts.legacy_alias).toBe(1);
  expect(a.independenceAssessmentCounts.not_independent_derivative_summary).toBe(1);
  expect(a.rawSourceTypeCounts.unverified).toBe(1);
  expect(a.unknownRoleTypeCounts).toBeDefined();
  expect(a.claimRegisters.notes).toBe(0);
  expect(a.claimRegisters.issueCounts).toEqual({});
 });
 it("counts archive and historical derivative roles while preserving raw source classifications",async()=>{
   await add("07_Sources/ChatGPT/Conversations/Feed.md",
     ["---","type: chat_transcript_index","source_type: chatgpt_export","date: 2026-07-16","---"].join("\n"));
   await add("10_Knowledge/Company Research/AMD - Analysis.md",
     ["---","type: knowledge_note","source_type: chatgpt_history","verification: not_reverified","---"].join("\n"));
   await add("10_Knowledge/Industry and Concepts/Old Index.md",
     ["---","type: knowledge_index","---"].join("\n"));
   const a=await report();
   expect(a.roleCounts.archive).toBe(1);
   expect(a.roleCounts.historical_analysis).toBe(1);
   expect(a.roleCounts.navigation).toBe(1);
   expect(a.normalizedSourceTypeCounts.archived_ai).toBe(2);
   expect(a.independenceAssessmentCounts.not_independent_archived_ai).toBe(2);
   expect(a.sourceTypeMappingCounts.legacy_alias).toBe(2);
   expect(a.rawSourceTypeCounts.chatgpt_export).toBe(1);
   expect(a.rawSourceTypeCounts.chatgpt_history).toBe(1);
   expect(a.duplicateCandidates.sameExactSourceMetricPeriod.totalGroups).toBe(0);
 });
 it("suggests historical-note navigation to a uniquely identified company thesis without editing originals",async()=>{
  const history="10_Knowledge/Company Research/NVDA - History.md";
  const thesis="05_Thesis/NVDA - Current Thesis.md";
  await add(history,["---","type: knowledge_note","source_type: chatgpt_history",
    "verification: not_reverified","entity: NVDA","---"].join("\n"),
    "# Prior research\nThis historical narrative is unverified.");
  await add(thesis,["---","type: current_thesis","entity: NVDA",
    "status: draft","---"].join("\n"),"# Working Thesis");
  const hBefore=fs.readFileSync(path.join(vault,history),"utf8");
  const tBefore=fs.readFileSync(path.join(vault,thesis),"utf8");
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
  const a=await report();
  expect(a.indexReady).toBe(true);
  expect(a.linkHealth.historicalReview).toMatchObject({
    status:"read_only_proposals",candidatesFound:1,
    canAutoWrite:false,canAutoUpdateThesis:false,
  });
  const proposed=a.linkHealth.historicalReview.samples[0];
  expect(proposed).toMatchObject({
    sourcePath:history,targetPath:thesis,declaredEntity:"NVDA",
    proposedWikilink:"[[05_Thesis/NVDA - Current Thesis]]",
    requiresHumanReview:true,canAutoWrite:false,
  });
  expect(fs.readFileSync(path.join(vault,history),"utf8")).toBe(hBefore);
  expect(fs.readFileSync(path.join(vault,thesis),"utf8")).toBe(tBefore);
  expect(a.notes.join(" ")).toContain("No Obsidian note");
 });
 it("suppresses historical edit proposals once the exact resolved link already exists",async()=>{
  const history="10_Knowledge/Company Research/NVDA - History.md";
  const thesis="05_Thesis/NVDA - Current Thesis.md";
  await add(history,["---","type: knowledge_note","source_type: chatgpt_history",
    "entity: NVDA","---"].join("\n"),
    "# History\n[[05_Thesis/NVDA - Current Thesis]]");
  await add(thesis,["---","type: current_thesis","entity: NVDA",
    "status: draft","---"].join("\n"),"# Working Thesis");
  const {indexer}=await import("./indexer");
  await indexer().rebuild();
  const a=await report();
  expect(a.linkHealth.historicalReview.status).toBe("read_only_proposals");
  expect(a.linkHealth.historicalReview.candidatesFound).toBe(0);
  expect(a.linkHealth.historicalReview.samples).toEqual([]);
 });
 it("links across industry, company and macro review metadata without ever rewriting source notes",async()=>{
   const company="01_Companies/AMD.md";
   const industry="02_Industries_Themes/AI Infrastructure.md";
   const claim="08_Daily_Weekly/Research Indexes/AMD OCF Claims.md";
   const macro="10_Knowledge/Macro and Markets/US Policy.md";
   await add(company,["---","type: company","entity: AMD","---"].join("\n"),"# AMD");
   await add(industry,["---","type: industry_tam_version_register",
     "entity: AI Infrastructure","related_paths:","  - 01_Companies/AMD.md","---"].join("\n"),
     "# Hardware supply chain\nThis industry note describes a model, not proven issuer earnings.");
   await add(claim,["---","type: investment_structured_claim_register","domain: company",
     "entity: AMD","event_key: AMD|FY26|OCF","original_source: https://example.test/issuer-filing",
     "claims:","  - claim_id: AMD-OCF-FY26","    metric: operating_cash_flow",
     "    period: FY26","    value: '123'","    unit: USD millions","---"].join("\n"),
     "# Structured source metadata");
   await add(macro,["---","type: macro_research_note","domain: macro",
     "entity: United States","related_claim_ids:","  - AMD-OCF-FY26","---"].join("\n"),
     "# Macro review\nAn analyst-supplied explicit claim reference.");
   const paths=[company,industry,claim,macro];
   const previous=paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"));
   const {indexer}=await import("./indexer");
   await indexer().rebuild();
   const report=await auditCrossDomain();
   expect(report).toMatchObject({
     status:"read_only_proposals",candidateCount:2,unresolvedReferences:0,
     ambiguousClaimReferences:0,canAutoWrite:false,canAutoUpdateThesis:false,
   });
   expect(report.samples).toContainEqual(expect.objectContaining({
     sourcePath:industry,targetPath:company,relation:"explicit_related_path",
   }));
   expect(report.samples).toContainEqual(expect.objectContaining({
     sourcePath:macro,targetPath:claim,relation:"unique_exact_claim_id",
   }));
   expect(paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"))).toEqual(previous);
 });
 it("holds ambiguous cross-domain claim references across two indexed register files",async()=>{
   const macro="10_Knowledge/Macro and Markets/Thailand Policy.md";
   await add(macro,["---","type: macro_research_note","entity: Thailand",
     "related_claim_ids:","  - COMMON-ID","---"].join("\n"));
   for(const symbol of ["AMD","NVDA"]){
     await add("08_Daily_Weekly/Research Indexes/"+symbol+" Claim.md",[
       "---","type: investment_structured_claim_register","entity: "+symbol,
       "domain: company","original_source: https://example.test/"+symbol,
       "claims:","  - claim_id: COMMON-ID","    metric: net_revenue",
       "    period: FY26","    value: '123'","    unit: USD millions","---",
     ].join("\n"));
   }
   const {indexer}=await import("./indexer");
   await indexer().rebuild();
   const r=await auditCrossDomain();
   expect(r).toMatchObject({
     candidateCount:0,ambiguousClaimReferences:1,samples:[],
   });
 });
 it("profiles readiness across protected archives, historical notes and macro without editing existing Vault bytes",async()=>{
   const historical="10_Knowledge/Company Research/Old Semiconductor Research.md";
   const macro="10_Knowledge/Macro and Markets/US Rates.md";
   const thesis="05_Thesis/AMD - Current Thesis.md";
   await add(historical,["---","type: knowledge_note","source_type: chatgpt_history",
     "verification: not_reverified","date: 2026-08-01","---"].join("\n"),"# Historical research");
   await add(macro,["---","type: macro_research_note","entity: United States",
     "related_paths:","  - 05_Thesis/AMD - Current Thesis.md","---"].join("\n"),"# US Rates");
   await add(thesis,["---","type: current_thesis","entity: AMD","status: draft",
     "related_claim_ids:","  - AMD-OCF-FY26","---"].join("\n"),"# Unendorsed Thesis");
   const paths=[historical,macro,thesis];
   const before=paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"));
   const {indexer}=await import("./indexer");
   await indexer().rebuild();
   const out=(await report()).metadataReadiness;
   expect(out).toMatchObject({
     status:"indexed_metadata_readiness_not_verified",scanned:3,
     eligibleNavigationSources:2,notesWithAnyReference:1,
     notesWithoutReference:1,historicalNotesWithoutEntity:1,
     canAutoWrite:false,canAutoUpdateThesis:false,
   });
   expect(out.examples.historicalWithoutEntity).toEqual([historical]);
   expect(out.byRole.thesis).toMatchObject({notes:1,editableNavigationSources:0});
   expect(paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"))).toEqual(before);
 });
 it("detects missing source, bad claim fields and unresolved wikilinks while preserving counts",async()=>{
  await add("08_Daily_Weekly/Research Indexes/Bad Claim.md",
    ["---","type: investment_structured_claim_register","domain: company","entity: AMD",
    "claims:","  - claim_id: C01","    metric: net_revenue","    value: \"123\"","---"].join("\n"),
    "# Broken\n[[07_Sources/ChatGPT/Archive/not-present.json]]");
  const a=await report();
  expect(a.claimRegisters.noSourceLocator).toBe(1);
  expect(a.claimRegisters.issueCounts.missing_source_locator).toBe(1);
  expect(a.claimRegisters.issueCounts.claim_missing_period).toBe(1);
  expect(a.claimRegisters.issueCounts.claim_missing_unit).toBe(1);
  expect(a.linkHealth.unresolvedReferences).toBe(1);
  expect(a.linkHealth.examples[0].target).toContain("not-present.json");
 });
});

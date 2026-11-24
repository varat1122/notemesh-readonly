import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {kernelCanonicalCreate} from "../../../tests/source-event-fixture";

// RQ-2 FIX A: acquisition channel vs genre vs coverage vs verification.
// AMAT (planner IN-475EA969033624A2) and BLS (saved IN-691A51101E47E345) are the
// real regression references; every text below is synthetic.
let root:string,vault:string;
const actor="oauth:rq2-provenance";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const T={timeout:60_000};
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"rq2-provenance-")));vault=path.join(root,"vault");
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","02_Industries_Themes","10_Knowledge/Company Research",
    "10_Knowledge/Macro and Markets","05_Thesis","06_Portfolio"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
async function seed(p:string,content:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),content,"utf8");
  (await import("./indexer")).reindexPath(p);
}
async function route(input:Record<string,unknown>){
  return (await import("./investment-writeback-router")).planInvestmentWriteback(input as never);
}
type Plan=Awaited<ReturnType<typeof route>>;
const step=(p:Plan,kind:string)=>p.safeEditWorkflow!.steps.find(s=>s.kind===kind)!;
const content=(p:Plan,kind:string)=>(step(p,kind).safeEditRequest!.change as {content:string}).content;
async function apply(p:Plan){
  const steps=p.safeEditWorkflow!.steps.filter(s=>s.safeEditRequest);
  await kernelCanonicalCreate(steps.map(s=>({kind:s.kind,path:s.path,content:(s.safeEditRequest!.change as {content:string}).content})),actor);
}
const review={headlineTh:"ข้อความทดสอบ AMAT รายงานรายได้ไตรมาส",translationTh:"ข้อความสมมติจากหน้านักลงทุนสัมพันธ์ของบริษัท",
  whatChangedTh:"ยังไม่ได้ตรวจเอกสารต้นฉบับฉบับเต็มของบริษัท",mechanismTh:"ผลต่อรายได้และกำไรยังต้องตรวจสอบ",
  thesisImplicationTh:"ยังไม่ปรับ Thesis",counterEvidenceTh:"ข้อมูลเป็นเพียงบางส่วนของเอกสาร",
  requiredEvidenceTh:"ตรวจเอกสารต้นฉบับและวันที่ประกาศ"};
const amat={domain:"company",entities:["AMAT"],topic:"AMAT 4QFY26 issuer release excerpt",inputFormat:"text",
  sourceKind:"issuer_release",sourceChat:"Micro 241126 assistant-read IR page (NOT user submitted)",
  extractedText:"Synthetic only: Applied Materials reported fourth-quarter fiscal 2026 results (excerpt read on the issuer website).",
  sourceLanguage:"en",sourceUrl:"https://ir.appliedmaterials.com/news-releases/synthetic-4q-fy2026",publisher:"Applied Materials (issuer IR page)",
  eventDate:"2026-11-13",publicationDate:"2026-11-13",contentTypes:["reported_fact"],entityRoles:[{entity:"AMAT",role:"primary_subject"}],
  sourceChannel:"issuer_ir_website",originalDocumentAccess:"excerpt_only",researchReview:review};

describe("RQ-2 Source provenance",()=>{
  it("AMAT: an assistant-retrieved issuer excerpt is never written as user-supplied, and its URL verifies nothing",T,async()=>{
    await seed("01_Companies/AMAT.md","# AMAT\n");
    const p=await route({...amat,acquisitionChannel:"assistant_retrieved"});
    const src=content(p,"source_intake"),rev=content(p,"canonical_review");
    for(const text of [src,rev]){
      expect(text).not.toMatch(/user[_ -]supplied|user_input_not_publisher_verified|Attributed User Source/i);
      expect(text).toMatch(/acquisition_channel: "assistant_retrieved"/);
      expect(text).toMatch(/document_coverage: "excerpt_only"/);
    }
    expect(src).toMatch(/^source_type: attributed$/m);
    expect(src).toMatch(/^source_kind: "issuer_release"$/m);
    expect(src).toMatch(/^verification: not_reverified$/m);
    expect(src).toContain('not_verified: ["acquisition_channel","publisher_authenticity","original_document_bytes","claim_truth","source_url_authority"]');
    expect(rev).toContain("Exact preserved source (acquisition: assistant_retrieved; coverage: excerpt_only)");
    expect(p.sourceCapture.originalSourceVerified).toBe(false);
    // Every downstream reader still finds the exact preserved text.
    const {preservedSubmittedText}=await import("./research-decision-v2");
    expect(preservedSubmittedText(src)).toBe(amat.extractedText);
    expect(p.safeEditWorkflow!.steps.map(s=>s.state)).toEqual(["needs_create","needs_create"]);
  });
  it("legacy user-submitted Sources keep their exact bytes whether the channel is omitted or explicit",T,async()=>{
    await seed("01_Companies/AMAT.md","# AMAT\n");
    const omitted=await route({...amat,sourceChat:"Micro 241126 user pasted excerpt"});
    const explicit=await route({...amat,sourceChat:"Micro 241126 user pasted excerpt",acquisitionChannel:"user_submitted"});
    expect(sha(content(explicit,"source_intake"))).toBe(sha(content(omitted,"source_intake")));
    expect(sha(content(explicit,"canonical_review"))).toBe(sha(content(omitted,"canonical_review")));
    expect(step(explicit,"source_intake").receiptKey).toBe(step(omitted,"source_intake").receiptKey);
    const src=content(omitted,"source_intake");
    expect(src).toMatch(/^source_type: user_supplied$/m);
    expect(src).toContain("## User-supplied original language text");
    expect(src).not.toMatch(/acquisition_channel|document_coverage/);
    // A broker PDF the user uploaded stays user-submitted broker research, with no original PDF SHA claim.
    const broker=await route({...amat,sourceKind:"broker_research",inputFormat:"pdf",sourceChat:"PDF 241126 user upload",publisher:"Synthetic Broker (user-attributed)"});
    expect(content(broker,"source_intake")).toMatch(/^source_type: user_supplied$/m);
    expect(content(broker,"source_intake")).toMatch(/^source_kind: "broker_research"$/m);
    expect(content(broker,"source_intake")).toMatch(/^attachment_status: "not_verified"$/m);
  });
  it("BLS: an already saved legacy Source is never rewritten; a contradicting channel holds the new Review",T,async()=>{
    const bls={domain:"macro",entities:["United States"],topic:"BLS October CPI release",inputFormat:"text",sourceKind:"official_macro",
      sourceChat:"Macro 111126 assistant-fetched public BLS page",extractedText:"Synthetic only: BLS October CPI release excerpt.",
      sourceLanguage:"en",sourceUrl:"https://www.bls.gov/news.release/synthetic-cpi.htm",publisher:"U.S. Bureau of Labor Statistics",
      eventDate:"2026-11-10",publicationDate:"2026-11-10",contentTypes:["reported_fact"],sourceChannel:"official_statistics_website",
      originalDocumentAccess:"excerpt_only"};
    const first=await route({...bls,captureOnly:true});
    await apply(first);
    const sourcePath=step(first,"source_intake").path,before=fs.readFileSync(path.join(vault,sourcePath));
    expect(before.toString()).toMatch(/^source_type: user_supplied$/m);
    const corrected=await route({...bls,acquisitionChannel:"assistant_retrieved",researchReview:review});
    expect(step(corrected,"source_intake")).toMatchObject({state:"verified_existing",safeEditRequest:null});
    expect(step(corrected,"canonical_review")).toMatchObject({state:"hold_quality_gate",safeEditRequest:null});
    expect(corrected.safeEditWorkflow!.qualityIssues).toContain("existing_source_acquisition_conflict_correction_required");
    expect(corrected.safeEditWorkflow!.readyForNextNews).toBe(false);
    expect(fs.readFileSync(path.join(vault,sourcePath)).equals(before)).toBe(true);
    // The same legacy client (channel omitted) is unaffected.
    const legacy=await route({...bls,researchReview:review});
    expect(legacy.safeEditWorkflow!.qualityIssues).not.toContain("existing_source_acquisition_conflict_correction_required");
  });
  it("an unknown acquisition keeps a clearly unverified Source and holds the Review",T,async()=>{
    await seed("01_Companies/AMAT.md","# AMAT\n");
    const p=await route({...amat,acquisitionChannel:"unknown"});
    const src=content(p,"source_intake");
    expect(src).toMatch(/^acquisition_channel: "unknown"$/m);
    expect(src).not.toMatch(/user_supplied/);
    expect(step(p,"canonical_review")).toMatchObject({state:"hold_quality_gate",safeEditRequest:null});
    expect(p.safeEditWorkflow!.qualityIssues).toContain("source_acquisition_unknown");
  });
  it("applying and retrying never touches protected Thesis or Portfolio and never re-creates the Source",T,async()=>{
    await seed("01_Companies/AMAT.md","# AMAT\n");
    await seed("05_Thesis/AMAT - Current Thesis.md","# Protected thesis\n");
    await seed("06_Portfolio/Holdings.md","# Protected portfolio\n");
    const protectedBytes=()=>["05_Thesis/AMAT - Current Thesis.md","06_Portfolio/Holdings.md"].map(p=>sha(fs.readFileSync(path.join(vault,p),"utf8")));
    const before=protectedBytes();
    const p=await route({...amat,acquisitionChannel:"assistant_retrieved"});
    expect(p.safeEditWorkflow!.protectedNotesTouched).toBe(false);
    expect(p.safeEditWorkflow!.steps.every(s=>!s.path.startsWith("05_Thesis/")&&!s.path.startsWith("06_Portfolio/"))).toBe(true);
    await apply(p);
    const retry=await route({...amat,acquisitionChannel:"assistant_retrieved"});
    expect(step(retry,"source_intake")).toMatchObject({state:"verified_existing",safeEditRequest:null});
    expect(retry.safeEditWorkflow!.steps.every(s=>s.safeEditRequest===null)).toBe(true);
    expect(protectedBytes()).toEqual(before);
  });
  it("a Source saved with the new template is read back by M5.6 identity, the context pack binding and the schema inspector",T,async()=>{
    await seed("01_Companies/AMAT.md","# AMAT\n");
    // Standalone discovery binds a Source by the Hub label it mentions (AMAT).
    const text="Synthetic only: AMAT (Applied Materials) reported fourth-quarter fiscal 2026 results (excerpt read on the issuer website).";
    const capture=await route({...amat,extractedText:text,acquisitionChannel:"assistant_retrieved",captureOnly:true,researchReview:undefined});
    await apply(capture);
    const sourcePath=step(capture,"source_intake").path,raw=fs.readFileSync(path.join(vault,sourcePath),"utf8");
    const again=await route({...amat,extractedText:text,acquisitionChannel:"assistant_retrieved"});
    expect(again.sourceIdentity.existingSourcePath).toBe(sourcePath);
    expect(step(again,"source_intake")).toMatchObject({state:"verified_existing",safeEditRequest:null});
    expect(again.safeEditWorkflow!.qualityIssues).not.toContain("existing_source_acquisition_conflict_correction_required");
    const pack=(await import("./investment-context")).buildInvestmentContextPack({question:"AMAT fourth-quarter fiscal 2026 results",issuers:["AMAT"],maxNotes:12,maxChars:16000});
    const item=pack.items.find(i=>i.path===sourcePath);
    expect(item?.sourceBinding).toBeDefined();
    expect(JSON.stringify(item)).toContain("AMAT (Applied Materials) reported fourth-quarter");
    const {inspectCanonicalKnowledgeMetadata}=await import("./investment-knowledge-schema");
    const {splitFrontmatter}=await import("./markdown");
    expect(inspectCanonicalKnowledgeMetadata(sourcePath,splitFrontmatter(raw).data).sourceTypeMapping).toBe("canonical");
  });
});

describe("RQ-2 Source text section parser",()=>{
  it("reads the neutral heading, keeps the legacy rule, and fails closed on a duplicate structural heading",async()=>{
    const {preservedTextSection}=await import("./research-decision-v2");
    const body=(h:string,text:string)=>`---\nx: 1\n---\n# S\n\n${h}\n\n\`\`\`text\n${text}\n\`\`\`\n`;
    expect(preservedTextSection(body("## Preserved source text","abc"))?.text).toBe("abc");
    expect(preservedTextSection(body("## User-supplied original language text","abc"))?.text).toBe("abc");
    // A legacy Source whose text mentions the new heading is read exactly as before.
    const legacyText="quoted:\n## Preserved source text\n\nmore";
    expect(preservedTextSection(body("## User-supplied original language text",legacyText))?.text).toBe(legacyText);
    // Two structural headings of the same kind remain ambiguous.
    const dup=body("## Preserved source text","a")+"\n## Preserved source text\n\n```text\nb\n```\n";
    expect(preservedTextSection(dup)).toBeNull();
  });
});

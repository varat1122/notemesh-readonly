import {afterAll,beforeAll,expect,it,vi} from "vitest";
import fs from "node:fs";
import {createHash} from "node:crypto";
import os from "node:os";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {McpAccess} from "./server";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async(run:()=>unknown)=>run()}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"m54-mcp-integration-"));
const vault=path.join(root,"vault");
process.env.DATA_DIR=root;
process.env.BASE_URL="https://m54-fixture.test";
process.env.SAFE_EDIT_ENABLED="1";
process.env.SAFE_EDIT_SINGLE_WRITER="1";
process.env.M55_REQUIRE_TYPED_REVIEW="1";
process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
const access:McpAccess={read:true,write:false,label:"oauth:m54-edit",scopes:["vault:read","vault:edit"]};
const news={domain:"company",entities:["NVDA"],topic:"Synthetic NVIDIA supply demand note",
  sourceKind:"archived_chat",inputFormat:"text",sourceChat:"Micro 251026",
  extractedText:"Synthetic test source: Nvidia supply is hypothetical; no real claims or facts.",
  completedAnalysis:"## สรุป\nข้อมูลสมมติสำหรับระบบทดสอบ ไม่ใช้ปรับ Thesis.",
  contentTypes:["reported_fact"],sourceChannel:"archived_chat",originalDocumentAccess:"not_obtained",
  researchReview:{headlineTh:"ทดสอบข้อมูล NVIDIA สำหรับระบบ",whatChangedTh:"ข้อมูลสมมติ ไม่มีเหตุการณ์จริง",
    mechanismTh:"ยังไม่มีหลักฐานด้านรายได้และกำไร",thesisImplicationTh:"ไม่เปลี่ยน Thesis",
    counterEvidenceTh:"ยังไม่ตรวจหลักฐานต้นฉบับ",requiredEvidenceTh:"ต้องตรวจข้อมูลบริษัทก่อนใช้จริง"}};
function unpack(result:any){
  expect(result.isError,JSON.stringify(result.content)).not.toBe(true);
  const outer=JSON.parse(result.content[0].text);
  return JSON.parse(outer.result.split("\n").slice(1,-1).join("\n"));
}
async function connect(){
  const {createSafeEditMcpServer}=await import("./safe-edit-server");
  const server=createSafeEditMcpServer(access),client=new Client({name:"m54-test",version:"1"});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  return {client,close:async()=>{await client.close();await server.close();}};
}
const tokenRows=(p:any)=>p.previews.map((x:any)=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}));
async function prepare(c:any,input:any){return unpack(await c.callTool({name:"prepare_canonical_writeback",arguments:input}));}
async function commit(c:any,input:any,p:any){return unpack(await c.callTool({name:"apply_canonical_writeback",arguments:{input,planId:p.planId,authorizations:tokenRows(p)}}));}

beforeAll(async()=>{
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","10_Knowledge/Industry and Concepts",
    "10_Knowledge/Macro and Markets","01_Companies","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  for(const [rel,content] of [
    ["01_Companies/NVDA.md","# NVDA fixture\n"],
    ["05_Thesis/NVDA - Current Thesis.md","# Protected thesis fixture\n"],
    ["05_Thesis/NVDA - Evidence Register.md","# Protected evidence fixture\n"],
    ["06_Portfolio/Team.md","# Protected portfolio fixture\n"]]){
    fs.writeFileSync(path.join(vault,rel),content);
    const {reindexPath}=await import("../vault/indexer");reindexPath(rel);
  }
});
afterAll(async()=>{
  (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","BASE_URL","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","M55_REQUIRE_TYPED_REVIEW"])delete process.env[k];
});

it("M54-F01 fresh Micro: one scoped preview + apply saves source/review, verifies hashes/index and protects governed notes",async()=>{
  const c=await connect();
  try{
    const tools=await c.client.listTools();
    const prepareTool=tools.tools.find(t=>t.name==="prepare_canonical_writeback");
    expect(prepareTool?.inputSchema.properties).toHaveProperty("completedAnalysis");
    expect(prepareTool?.inputSchema.properties).toHaveProperty("sourceChat");
    const p=await prepare(c.client,news);
    expect(p.phase).toBe("preview_only");expect(p.writesPerformed).toBe(false);
    expect(p.previews).toHaveLength(2);
    expect(p.steps.map((x:any)=>x.state)).toEqual(["needs_create","needs_create"]);
    for(const row of p.previews)expect(fs.existsSync(path.join(vault,row.path))).toBe(false);
    const applied=await commit(c.client,news,p);
    expect(applied).toMatchObject({status:"saved_verified",readyForNextNews:true,outcome:"saved_verified",
      interrupted:null,perDeviceSync:"unverified",protectedNotesTouched:false});
    expect(applied.receipts).toHaveLength(2);
    expect(applied.receipts.every((x:any)=>x.receipt.write==="written"&&
      x.receipt.readback==="verified"&&x.receipt.reindex==="verified")).toBe(true);
    expect(applied.steps.every((x:any)=>x.readbackVerified&&x.indexed&&x.searchable)).toBe(true);
    const retry=await prepare(c.client,news);
    expect(retry.previews).toHaveLength(0);expect(retry.steps.map((x:any)=>x.state)).toEqual(["verified_existing","verified_existing"]);
    const duplicate=await commit(c.client,news,retry);
    expect(duplicate.outcome).toBe("saved_verified");expect(duplicate.receipts).toHaveLength(0);
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected thesis fixture\n");
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Evidence Register.md"),"utf8")).toBe("# Protected evidence fixture\n");
    expect(fs.readFileSync(path.join(vault,"06_Portfolio/Team.md"),"utf8")).toBe("# Protected portfolio fixture\n");
  }finally{await c.close();}
});

it("M4 staging-only Source-first → indexed quote preflight → unresolved Review, immutable protected notes and idempotent retry",async()=>{
  // THIS TEST WRITES ONLY TO THE DISPOSABLE mkdtemp Vault. Never run against /data/vault.
  const sourceText="SYNTHETIC: NVDA FY2027 revenue guidance +20% is a fictional unverified social claim; another fictional repost claims -20%. Neither has an issuer original.";
  const raw={domain:"company",entities:["NVDA"],topic:"M4 isolated Source-first evidence fixture",
    sourceKind:"social_repost",inputFormat:"text",sourceChat:"M4 staging-only fixture",
    extractedText:sourceText,sourceLanguage:"en",captureOnly:true};
  const c=await connect();
  try{
    const sourcePreview=await prepare(c.client,raw);
    expect(sourcePreview).toMatchObject({phase:"preview_only",workflowStatus:"pending_source_capture",
      writesPerformed:false,protectedNotesTouched:false});
    expect(sourcePreview.previews).toHaveLength(1);
    const id=sourcePreview.planId;
    const rel=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
    const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
    const sourceRef=(noteHash:string)=>({intakeId:id,sourcePath:rel,sourceNoteSha256:noteHash,
      quote:"NVDA FY2027 revenue guidance +20%"});
    const {M2_POLICY}=await import("../vault/research-decision-v2");
    const decision=(noteHash:string,confirmation=false)=>({
      schemaVersion:"2.0.0-shadow",policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
      intakeId:id,domain:"company",subject:"NVDA",
      event:{classification:"unresolved",eventDate:null,publicationDate:null,relatedNotes:[],
        comparisonBasis:"Both fictional reports are unverified and contradict each other."},
      claims:[{localClaimKey:"guidance_a",entity:"NVDA",metric:"revenue guidance",
        period:"FY2027",unit:"% YoY",denominator:null,forecastVintage:null,
        value:"+20%",sourceRefs:[sourceRef(noteHash)],
        competingEvidence:[{value:"-20%",attributedTo:"fictional repost",publicationDate:null,
          sourceRef:null,independence:"unknown"}],
        epistemicStatus:confirmation?"attributed":"unresolved",
        conclusion:confirmation?"confirmed":"no_change",
        primaryEvidence:confirmation?{receiptId:"PEV-"+"F".repeat(32),
          primarySourceUrl:"https://www.sec.gov/Archives/fictional-m4-only.htm",
          verifiedValue:"+20%"}:null,
        reasoningSummary:"Fictional claims only; no official issuer guidance.",requiredEvidence:"Issuer source and matching metric/period."}],
      synthesis:{headlineTh:"ข่าวสมมติ NVDA อ้าง Guidance สวนทางกัน",
        whatChangedTh:"ข้ออ้าง +20% และ -20% ยังไม่มีเอกสารต้นฉบับ",
        mechanismTh:"ผลต่อ Earnings และ FCF ยังประเมินไม่ได้",
        thesisImplicationTh:"ไม่ปรับ Thesis หรือ Earnings",
        counterEvidenceTh:"ข้ออ้างทั้งสองไม่ใช่ Primary Evidence",
        requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและ Fiscal Period"}});
    const preflight=async(d:unknown)=>unpack(await c.client.callTool({
      name:"preflight_research_decision_v2",arguments:d as Record<string,unknown>}));
    // A preview token/expected hash is NOT a persisted Source.
    const pre=await preflight(decision(sourcePreview.steps[0].expectedSha256));
    expect(pre.status).toBe("hold_references_or_authority");
    expect(pre.errors).toContain("guidance_a:source_missing_or_not_searchable");
    expect(fs.existsSync(path.join(vault,rel))).toBe(false);
    const captured=await commit(c.client,raw,sourcePreview);
    expect(captured).toMatchObject({status:"source_saved_analysis_pending",
      protectedNotesTouched:false,perDeviceSync:"unverified"});
    expect(captured.receipts).toHaveLength(1);
    expect(captured.receipts[0].receipt).toMatchObject({
      write:"written",readback:"verified",reindex:"verified"});
    const sourceBytes=fs.readFileSync(path.join(vault,rel),"utf8");
    expect(sha(sourceBytes)).toBe(sourcePreview.steps[0].expectedSha256);
    const quote=await preflight(decision(sha(sourceBytes)));
    expect(quote).toMatchObject({status:"structurally_grounded_shadow_only",
      writesPerformed:false,sourceAuthenticityVerified:false,investmentTruthVerified:false,
      canWriteProtectedNotes:false,serverVerifiedClaimKeys:[]});
    expect(quote.sourceQuoteBindings[0].status).toBe("source_quote_bound_not_primary");
    expect(quote.warnings).toContain("competing_value_without_preserved_source");
    const forged=await preflight(decision(sha(sourceBytes),true));
    expect(forged.status).toBe("hold_references_or_authority");
    expect(forged.errors).toContain("guidance_a:primary_receipt_not_server_validated");
    const tampered=await preflight(decision("a".repeat(64)));
    expect(tampered.errors).toContain("guidance_a:source_note_sha256_mismatch");
    const review={...raw,captureOnly:undefined,existingIntakeId:id,
      contentTypes:["guidance"],sourceChannel:"social_repost",
      attributedOrigin:"Fictional social repost; publisher identity unverified",originalDocumentAccess:"not_obtained",
      researchReview:{headlineTh:"ข่าวสมมติ NVDA อ้าง Guidance FY2027 สวนทางและยังไม่ยืนยัน",
        translationTh:"แหล่งสมมติ A อ้าง FY2027 revenue guidance +20% ส่วนเพจสมมติ B อ้าง -20% โดยทั้งสองไม่มีหลักฐานบริษัท",
        whatChangedTh:"โพสต์สมมติอ้าง FY2027 revenue guidance +20% และ -20% โดยไม่มีเอกสารบริษัท จึงยัง unresolved",
        mechanismTh:"ต้องมีหลักฐานคำสั่งซื้อและยอดส่งมอบก่อนเชื่อมไป Revenue, EPS หรือ FCF",
        thesisImplicationTh:"ยังไม่ปรับ Earnings หรือ Thesis เพราะข้ออ้างยังยืนยันไม่ได้",
        counterEvidenceTh:"โพสต์ +20% ขัดกับโพสต์ -20% และไม่มี Primary Evidence",
        requiredEvidenceTh:"ต้องตรวจ Company IR/SEC และ Fiscal Period ให้ตรงกัน",
        claimAssessments:[{entity:"NVDA",metric:"revenue guidance",period:"FY2027",unit:"% YoY",
          competingValues:["+20%","-20%"],resolution:"unresolved",conclusion:"no_change"}]}};
    const reviewPreview=await prepare(c.client,review);
    expect(reviewPreview.planId).toBe(id);
    expect(reviewPreview.qualityIssues).toEqual([]);
    expect(reviewPreview.steps.map((x:any)=>x.state)).toEqual(["verified_existing","needs_create"]);
    expect(reviewPreview.previews).toHaveLength(1);
    const saved=await commit(c.client,review,reviewPreview);
    expect(saved).toMatchObject({status:"saved_verified",readyForNextNews:true,
      protectedNotesTouched:false,perDeviceSync:"unverified"});
    expect(saved.receipts).toHaveLength(1);
    expect(saved.steps.every((x:any)=>x.readbackVerified&&x.indexed&&x.searchable)).toBe(true);
    expect(fs.readFileSync(path.join(vault,rel),"utf8")).toBe(sourceBytes);
    const reviewPath=saved.steps.find((x:any)=>x.kind==="canonical_review")?.path;
    expect(reviewPath).toMatch(/^10_Knowledge\/Company Research\/Investment Review - /);
    const reviewNote=fs.readFileSync(path.join(vault,reviewPath),"utf8");
    expect(reviewNote).toContain("[[00_Inbox/ChatGPT/Investment Intake - "+id+"]]");
    expect(reviewNote).toContain("[[01_Companies/NVDA]]");
    expect((await preflight(decision(sha(sourceBytes)))).status).toBe("structurally_grounded_shadow_only");
    const retry=await prepare(c.client,review);
    expect(retry.previews).toHaveLength(0);
    expect(retry.steps.map((x:any)=>x.state)).toEqual(["verified_existing","verified_existing"]);
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected thesis fixture\n");
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Evidence Register.md"),"utf8")).toBe("# Protected evidence fixture\n");
    expect(fs.readFileSync(path.join(vault,"06_Portfolio/Team.md"),"utf8")).toBe("# Protected portfolio fixture\n");
  }finally{await c.close();}
});

it("M551 connector accepts optional claimAssessments; unresolved preview passes and caller-forged primary receipt holds",async()=>{
  const c=await connect();
  try{
    const input={...news,sourceKind:"issuer_release",contentTypes:["guidance"],
      extractedText:"SYNTHETIC: NVDA FY2027 guidance +20% vs -20%, no primary proof",
      researchReview:{...news.researchReview,claimAssessments:[{
        entity:"NVDA",metric:"revenue growth guidance",period:"FY2027",unit:"% YoY",
        competingValues:["+20%","-20%"],resolution:"unresolved",conclusion:"no_change"
      }]}};
    const unresolved=await prepare(c.client,input);
    expect(unresolved.phase).toBe("preview_only");
    expect(unresolved.qualityIssues).toEqual([]);
    expect(unresolved.steps.map((x:any)=>x.state)).toEqual(["needs_create","needs_create"]);
    const forged=await prepare(c.client,{...input,researchReview:{...input.researchReview,
      claimAssessments:[{...input.researchReview.claimAssessments[0],
        resolution:"verified_primary",conclusion:"confirmed",verifiedValue:"+20%",
        primarySourceUrl:"https://www.sec.gov/Archives/fictitious-nvda.htm",
        primaryEvidenceReceipt:"PEV-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"}]}});
    expect(forged.steps.map((x:any)=>x.state)).toEqual(["needs_create","hold_quality_gate"]);
    expect(forged.qualityIssues).toContain("primary_evidence_receipt_validation_pending");
    expect(forged.previews).toHaveLength(1);
    expect(forged.writesPerformed).toBe(false);
  }finally{await c.close();}
});

it("M56 MCP contract links a Feed Only source when later research reorders entities and changes classification",async()=>{
  for(const rel of ["01_Companies/MU.md","02_Industries_Themes/Memory.md"]){
    fs.mkdirSync(path.dirname(path.join(vault,rel)),{recursive:true});
    fs.writeFileSync(path.join(vault,rel),"# Fixture\n");
    (await import("../vault/indexer")).reindexPath(rel);
  }
  const raw={domain:"company",entities:["NVDA","MU"],topic:"Synthetic cross-issuer",inputFormat:"text",
    sourceKind:"social_repost",sourceChat:"Micro source",sourceLanguage:"en",publisher:"Original attribution",
    extractedText:"M56 synthetic multi-issuer news excerpt with unverified pricing claim",captureOnly:true};
  const reviewed={...raw,captureOnly:undefined,sourceChat:"Micro research",publisher:"Revised attribution",
    domain:"industry",entities:["MU","NVDA"],themes:["Memory"],
    entityRoles:[{entity:"MU",role:"covered_company"},{entity:"NVDA",role:"covered_company"}],
    contentTypes:["analyst_opinion"],sourceChannel:"social_repost",attributedOrigin:"Unverified origin",
    originalDocumentAccess:"not_obtained",researchReview:{headlineTh:"ข่าวจำลองหลายบริษัทสำหรับตรวจ Source Identity",
      translationTh:"เนื้อหาจำลองกล่าวถึงบริษัทสองรายและราคาโดยไม่มีหลักฐานยืนยัน",
      whatChangedTh:"เป็นข้อมูลทดสอบ ไม่ใช่เหตุการณ์เศรษฐกิจจริง",
      mechanismTh:"Pricing และ Utilization อาจกระทบ Revenue แต่ยังไม่มีหลักฐาน",
      thesisImplicationTh:"ไม่ปรับ Thesis หรือราคาเป้าหมาย",
      counterEvidenceTh:"ต้นฉบับและประมาณการยังไม่ได้ตรวจสอบ",
      requiredEvidenceTh:"ต้องตรวจ Original Source และงวดข้อมูลก่อนใช้"}};
  const c=await connect();
  try {
    const tools=await c.client.listTools(),schema=tools.tools.find(t=>t.name==="prepare_canonical_writeback")?.inputSchema;
    expect(schema?.properties).toHaveProperty("existingIntakeId");
    const first=await prepare(c.client,raw);
    expect(first.previews).toHaveLength(1);
    expect((await commit(c.client,raw,first)).status).toBe("source_saved_analysis_pending");
    const subsequent=await prepare(c.client,{...reviewed,existingIntakeId:first.planId});
    expect(subsequent.planId).toBe(first.planId);
    expect(subsequent.qualityIssues).toEqual([]);
    expect(subsequent.steps.map((x:any)=>x.state)).toEqual(["verified_existing","needs_create"]);
    expect(subsequent.previews.map((x:any)=>x.kind)).toEqual(["canonical_review"]);
    expect((await commit(c.client,{...reviewed,existingIntakeId:first.planId},subsequent)).status).toBe("saved_verified");
  }finally{await c.close();}
});

it("M55 API contract holds incomplete Memory review while preserving Source, then verifies repaired Thai Review",async()=>{
  for(const rel of ["01_Companies/MU.md","01_Companies/SK hynix.md","01_Companies/Samsung.md","02_Industries_Themes/Memory.md"]){
    fs.mkdirSync(path.dirname(path.join(vault,rel)),{recursive:true});
    fs.writeFileSync(path.join(vault,rel),"# Fixture\n");
    (await import("../vault/indexer")).reindexPath(rel);
  }
  const thai={headlineTh:"ข้อความ X อ้าง JPMorgan เกี่ยวกับหุ้น Memory",
    translationTh:"ผู้โพสต์กล่าวว่าหุ้น MU, SK hynix และ Samsung ปรับตัวลง แต่ยังไม่พบรายงานต้นฉบับ",
    whatChangedTh:"ยังไม่ยืนยันว่าเป็นข้อมูลใหม่",mechanismTh:"ราคาหน่วยความจำอาจกระทบกำไร",
    thesisImplicationTh:"ยังไม่เปลี่ยน Thesis",counterEvidenceTh:"ยังไม่มีอนุกรมราคาต้นฉบับ",
    requiredEvidenceTh:"ต้องตรวจรายงานธนาคารต้นฉบับ"};
  const base={domain:"industry",entities:["MU","SK hynix","Samsung"],topic:"Memory X repost",inputFormat:"text",
    sourceKind:"social_repost",sourceLanguage:"en",sourceChat:"MICRO 261026",sourceChannel:"social_repost",
    attributedOrigin:"J.P. Morgan",originalDocumentAccess:"excerpt_only",
    publisher:"RealNickMugalli repost",extractedText:"JPMorgan-attributed historical Memory boom/bust social repost M55 integration",
    researchReview:thai};
  const c=await connect();
  try{
    const held=await prepare(c.client,base);
    expect(held).toMatchObject({workflowStatus:"hold_research_quality"});
    expect(held.qualityIssues).toContain("content_types_missing");
    expect(held.steps.map((x:any)=>x.state)).toEqual(["needs_create","hold_quality_gate"]);
    expect(held.previews).toHaveLength(1);
    const source=await commit(c.client,base,held);
    expect(source.receipts).toHaveLength(1);
    expect(source).toMatchObject({status:"hold_research_quality",readyForNextNews:false});
    const enriched={...base,themes:["Memory"],contentTypes:["analyst_opinion","market_commentary"],
      entityRoles:base.entities.map(entity=>({entity,role:"covered_company"}))};
    const valid=await prepare(c.client,enriched);
    expect(valid.qualityIssues).toEqual([]);
    expect(valid.steps.map((x:any)=>x.state)).toEqual(["verified_existing","needs_create"]);
    expect(valid.previews[0].path).toContain("Investment Review - Memory - ");
    const applied=await commit(c.client,enriched,valid);
    expect(applied).toMatchObject({status:"saved_verified",readyForNextNews:true,protectedNotesTouched:false});
    expect(fs.readFileSync(path.join(vault,"05_Thesis/NVDA - Current Thesis.md"),"utf8")).toBe("# Protected thesis fixture\n");
  }finally{await c.close();}
});

it("M55 legacy freeform cannot obtain a Review authorization, but Source remains recoverable",async()=>{
  const legacy={...news,researchReview:undefined,sourceChannel:undefined,originalDocumentAccess:undefined,
    extractedText:"Unique M55 legacy freeform should not bypass typed quality gate"};
  const c=await connect();
  try{
    const p=await prepare(c.client,legacy);
    expect(p).toMatchObject({workflowStatus:"hold_research_quality"});
    expect(p.qualityIssues).toContain("typed_research_review_required");
    expect(p.steps.map((x:any)=>x.state)).toEqual(["needs_create","hold_quality_gate"]);
    expect(p.previews).toHaveLength(1);
    const forged=await c.client.callTool({name:"apply_canonical_writeback",arguments:{input:legacy,planId:p.planId,
      authorizations:[...tokenRows(p),{operationId:"ICW-1234567890",previewToken:"0".repeat(64),expectedHash:"0".repeat(64)}]}});
    expect(forged.isError).toBe(true);
    const a=await commit(c.client,legacy,p);
    expect(a).toMatchObject({status:"hold_research_quality",readyForNextNews:false});
    expect(a.receipts).toHaveLength(1);
    const repaired={...legacy,researchReview:news.researchReview,sourceChannel:"archived_chat",originalDocumentAccess:"not_obtained"};
    const next=await prepare(c.client,repaired);
    expect(next.steps.map((x:any)=>x.state)).toEqual(["verified_existing","needs_create"]);
    expect((await commit(c.client,repaired,next)).status).toBe("saved_verified");
  }finally{await c.close();}
});

it("M55 rollout switch preserves old M5.4 freeform behavior until deliberate cutover",async()=>{
  const original=process.env.M55_REQUIRE_TYPED_REVIEW;
  process.env.M55_REQUIRE_TYPED_REVIEW="0";
  const c=await connect();
  try{
    const input={...news,researchReview:undefined,extractedText:"M55 transition mode source"};
    const p=await prepare(c.client,input);
    expect(p.workflowStatus).toBe("pending_safe_edit");
    expect(p.steps.map((x:any)=>x.state)).toEqual(["needs_create","needs_create"]);
    expect(p.previews).toHaveLength(2);
    // No apply: compatibility test does not create even synthetic Vault notes.
  }finally{
    if(original===undefined)delete process.env.M55_REQUIRE_TYPED_REVIEW;
    else process.env.M55_REQUIRE_TYPED_REVIEW=original;
    await c.close();
  }
});

it("M54-F02 lost preview response rotates token; stale token is refused and fresh retry succeeds",async()=>{
  const input={...news,extractedText:"Synthetic unique source for token-retry test"};
  const c=await connect();
  try{
    const first=await prepare(c.client,input),second=await prepare(c.client,input);
    expect(first.planId).toBe(second.planId);
    expect(first.previews[0].previewToken).not.toBe(second.previews[0].previewToken);
    const bad=unpack(await c.client.callTool({name:"apply_canonical_writeback",arguments:{input,planId:first.planId,authorizations:tokenRows(first)}}));
    expect(bad.outcome).toBe("pending_or_blocked");
    expect(bad.interrupted).toMatch(/Invalid preview token/);
    for(const step of second.steps)expect(fs.existsSync(path.join(vault,step.path))).toBe(false);
    const outcome=await commit(c.client,input,second);
    expect(outcome.outcome).toBe("saved_verified");
  }finally{await c.close();}
});

it("M54-F03 Feed Only saves just source, then reviewed retry adds canonical review without duplicate source",async()=>{
  const input={...news,extractedText:"Synthetic Feed Only unique source",completedAnalysis:undefined,researchReview:undefined,captureOnly:true};
  const c=await connect();
  try{
    const p=await prepare(c.client,input);
    expect(p.previews).toHaveLength(1);
    const saved=await commit(c.client,input,p);
    expect(saved).toMatchObject({outcome:"source_saved_analysis_pending",status:"source_saved_analysis_pending"});
    const full={...input,captureOnly:false,completedAnalysis:"## สรุป\nSynthetic deferred review.",researchReview:news.researchReview};
    const next=await prepare(c.client,full);
    expect(next.steps.map((x:any)=>x.state)).toEqual(["verified_existing","needs_create"]);
    expect(next.previews).toHaveLength(1);
    expect((await commit(c.client,full,next)).outcome).toBe("saved_verified");
  }finally{await c.close();}
});

it("M54-F04 conflict blocks overwrite; changed analysis for one original intake does not create duplicate review",async()=>{
  const input={...news,extractedText:"Synthetic source for M54 conflict",completedAnalysis:"Original synthetic analysis"};
  const c=await connect();
  try{
    const p=await prepare(c.client,input);
    expect((await commit(c.client,input,p)).outcome).toBe("saved_verified");
    const changed=await prepare(c.client,{...input,researchReview:{...news.researchReview,headlineTh:"แก้ไขผลวิเคราะห์ NVIDIA สมมติ"}});
    expect(changed.previews).toHaveLength(0);
    expect(changed.steps.map((x:any)=>x.state)).toEqual(["verified_existing","hold_conflict"]);
  }finally{await c.close();}
});

it("M54-F05 no bypass: complete analysis and sourceChat are required, protected routes never exposed",async()=>{
  const c=await connect();
  try{
    const missing=await c.client.callTool({name:"prepare_canonical_writeback",arguments:{...news,sourceChat:undefined}});
    expect(missing.isError).toBe(true);
    const mixed=await c.client.callTool({name:"prepare_canonical_writeback",arguments:{...news,captureOnly:true}});
    expect(mixed.isError).toBe(true);
    const p=await prepare(c.client,{...news,extractedText:"Synthetic protected route test"});
    expect(p.steps.every((x:any)=>!x.path.startsWith("05_Thesis/")&&!x.path.startsWith("06_Portfolio/"))).toBe(true);
  }finally{await c.close();}
});

it("M54-F06 conflict between preview and apply stops before any batch write",async()=>{
  const input={...news,extractedText:"Synthetic source for partial-write crash recovery",completedAnalysis:"Synthetic unique partial-write analysis"};
  const c=await connect();
  try{
    const p=await prepare(c.client,input);
    const source=p.steps.find((s:any)=>s.kind==="source_intake");
    const review=p.steps.find((s:any)=>s.kind==="canonical_review");
    const external="# External review inserted after preview; must survive unchanged.\n";
    fs.writeFileSync(path.join(vault,review.path),external);
    const refused=await c.client.callTool({name:"apply_canonical_writeback",arguments:{input,planId:p.planId,authorizations:tokenRows(p)}});
    expect(refused.isError).toBe(true);
    expect(String((refused.content as Array<{text?:string}>)[0]?.text)).toMatch(/Authorization must exactly match/);
    expect(fs.existsSync(path.join(vault,source.path))).toBe(false);
    expect(fs.readFileSync(path.join(vault,review.path),"utf8")).toBe(external);
    const retry=await prepare(c.client,input);
    expect(retry.previews).toHaveLength(1);
    expect(retry.steps.map((s:any)=>s.state)).toEqual(["needs_create","hold_conflict"]);
  }finally{await c.close();}
});

it("M54-F07 fault during second create preserves verified source and refuses blind review replay",async()=>{
  const input={...news,extractedText:"Synthetic source for interrupted second create",completedAnalysis:"Synthetic partial failure analysis"};
  const c=await connect();
  try{
    const p=await prepare(c.client,input);
    const source=p.steps.find((s:any)=>s.kind==="source_intake");
    const review=p.steps.find((s:any)=>s.kind==="canonical_review");
    const link=fs.linkSync.bind(fs);
    const failure=vi.spyOn(fs,"linkSync").mockImplementation((a,b)=>{
      if(String(b).includes("Investment Review"))throw Error("Synthetic review publication failure");
      link(a,b);
    });
    const outcome=await commit(c.client,input,p);
    failure.mockRestore();
    expect(outcome).toMatchObject({outcome:"pending_or_blocked",readyForNextNews:false});
    expect(outcome.interrupted).toMatch(/Synthetic review publication failure/);
    expect(outcome.receipts).toHaveLength(1);
    expect(outcome.steps.map((s:any)=>s.state)).toEqual(["verified_existing","needs_create"]);
    expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toContain(input.extractedText);
    expect(fs.existsSync(path.join(vault,review.path))).toBe(false);
    const refused=await c.client.callTool({name:"prepare_canonical_writeback",arguments:input});
    expect(refused.isError).toBe(true);
    expect(String((refused.content as Array<{text?:string}>)[0]?.text)).toMatch(/interrupted operation/i);
  }finally{vi.restoreAllMocks();await c.close();}
});

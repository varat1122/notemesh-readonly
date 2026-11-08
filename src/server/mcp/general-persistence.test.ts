import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {createHash} from "node:crypto";
import crypto from "node:crypto";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {IntakeClaim} from "../vault/canonical-claims";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const actor="oauth:ri001-claims-fixture";
// Synthetic engineering probes derived from the prior two-role fixture; not AMD Gold or semantic evidence.
const fixtureId="RI001-general-persistence-disposable";
const url="https://example.org/synthetic-issuer/2026/results";
const excerpt="Revenue of $96.2 billion, up 106% from a year ago\nRevenue is expected to be $108.0 billion, plus or minus 2%.\n";
const claims:IntakeClaim[]=[
  {entity:"SYNX",metric:"revenue",value:"96.2",unit:"USD billion",period:"Q2 FY2027",evidenceClass:"reported_actual",
    statement:"Issuer-reported Q2 FY2027 revenue, not independently verified",sourceLocator:"earnings release: supplied excerpt line 1; reporting period ended 2026-07-26",
    sourceExcerpt:excerpt.split("\n")[0],qualification:"up 106% from a year ago",verification:"unverified"},
  {entity:"SYNX",metric:"revenue",value:"108.0",unit:"USD billion",period:"Q3 FY2027",evidenceClass:"management_guidance",
    statement:"Management revenue guidance, forward-looking, not realized revenue or consensus",sourceLocator:"earnings release: supplied excerpt line 2; outlook",
    sourceExcerpt:excerpt.split("\n")[1],qualification:"plus or minus 2%",verification:"unverified"}
];
const review={headlineTh:"Synthetic issuer รายงานรายได้งวดปัจจุบันและแนวโน้มงวดถัดไปที่ยังต้องตรวจหลักฐาน",
  translationTh:"รายได้ 96.2 พันล้านดอลลาร์ เพิ่มขึ้น 106% จากปีก่อน\nคาดว่ารายได้จะอยู่ที่ 108.0 พันล้านดอลลาร์ บวกลบ 2%",
  whatChangedTh:"ตามข้อความที่ได้รับ บริษัทแยกรายได้ที่รายงานของงวดปัจจุบันจากประมาณการรายได้งวดถัดไป ยังไม่ได้ตรวจสอบแหล่งต้นฉบับโดยอิสระ",
  mechanismTh:"Actual และ Guidance ต้องแยกกัน เพราะประมาณการของฝ่ายบริหารยังไม่ใช่รายได้ที่เกิดขึ้นแล้วหรือประมาณการของตลาด",
  thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือมูลค่าจนกว่าจะตรวจหลักฐานและข้อจำกัดครบถ้วน",
  counterEvidenceTh:"ความต้องการซื้อและข้อจำกัดด้านการส่งมอบอาจทำให้รายได้จริงต่างจากแนวโน้มที่บริษัทกล่าวถึง",
  requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและเอกสารกำกับดูแลเพิ่มเติม ข้ออ้างทั้งสองมาจากแหล่งเดียวและไม่ใช่สองแหล่งอิสระ",
  claimAssessments:[{entity:"SYNX",metric:"revenue",period:"Q3 FY2027",unit:"USD billion",competingValues:["108.0"],resolution:"unresolved" as const,conclusion:"conditional" as const}]
};
const input:WritebackInput={domain:"company",entities:["SYNX"],topic:"Synthetic issuer Q2 FY2027 earnings and Q3 guidance",inputFormat:"text",
  sourceKind:"issuer_release",sourceLanguage:"en",sourceChat:fixtureId,sourceUrl:url,publisher:"Synthetic issuer Investor Relations",
  extractedText:excerpt,eventDate:"2026-08-26",publicationDate:"2026-08-26",sourceChannel:"issuer_release",
  originalDocumentAccess:"excerpt_only",contentTypes:["earnings","guidance"],researchReview:review,claims,
  researchLineage:{knowledgeCutoffAsOf:"2026-08-26T20:36:00Z"}};
let root:string,vault:string;
const protectedPaths=["05_Thesis/SYNX - Current Thesis.md","05_Thesis/SYNX - Evidence Register.md","01_Companies/SYNX - Company Evolution Timeline.md","06_Portfolio/Positions.md","06_Portfolio/Trades.md"];
beforeEach(async()=>{
  delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-claims-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,8).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
  for(const p of ["01_Companies/SYNX.md",...protectedPaths]){
    fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),"# Isolated protected fixture\n");
    (await import("../vault/indexer")).reindexPath(p);
  }
});
afterEach(async()=>{assertProtected();vi.useRealTimers();vi.restoreAllMocks();(await import("../db")).db().close();delete (globalThis as Record<symbol,unknown>)[Symbol.for("notemesh.maintenance.registry.v1")];fs.rmSync(root,{recursive:true,force:true});for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER","PRIMARY_EVIDENCE_ISSUANCE_ENABLED","PRIMARY_EVIDENCE_SIGNERS_JSON"])delete process.env[k];});
async function prepare(data:WritebackInput=input){return (await import("./canonical-writeback")).prepareCanonicalWriteback(data,actor);}
async function apply(data:WritebackInput,p:Awaited<ReturnType<typeof prepare>>){return (await import("./canonical-writeback")).applyCanonicalWriteback({input:data,planId:p.planId,
  authorizations:p.previews.map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))},actor);}
async function retrieve(c:IntakeClaim){return (await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",...c,originalSource:url});}
function assertProtected(){for(const p of protectedPaths)expect(fs.readFileSync(path.join(vault,p),"utf8")).toBe("# Isolated protected fixture\n");}
const estimate=(provider:string|null="Broker A",forecastVintage:string|null="2026-08-25",role:"broker_estimate"|"consensus"|"unspecified"="broker_estimate"):IntakeClaim=>
  ({...claims[0],evidenceClass:"analyst_estimate",estimate:{provider,forecastVintage,role}});
const appearance={key:"received-one",channel:"chat",locator:"chat:disposable/message/1",receivedAt:null};
const capture=()=>({...input,claims:undefined,researchReview:undefined,captureOnly:true,appearance});
async function rows(){return (await import("../db")).db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();}
async function judged(data:WritebackInput){
  const parsed=(await import("./canonical-writeback")).canonicalInputSchema.parse(data);
  const {packet}=(await import("../vault/research-judge")).buildResearchJudgePacket(parsed,actor),body=JSON.parse(packet.body);
  const row=(key:string)=>({key,verdict:"PASS" as const,rationale:"Simulated assessment for deterministic binding tests only",
    references:[{key:"received_source",quote:data.extractedText,locator:`utf16:0:${data.extractedText.length}`,sourceSha256:sha(data.extractedText)}],
    checks:{entailment:"PASS" as const,numbersUnits:"PASS" as const,periodRoleAttributionVintage:"PASS" as const,identityRelationships:"PASS" as const,
      pointInTime:"PASS" as const,independenceCounterEvidence:"PASS" as const,injectionCoverage:"PASS" as const}});
  return {...parsed,researchJudge:{packet,result:{packetId:packet.packetId,packetDigest:packet.digest,reviewDigest:body.reviewDigest,
    claims:body.claims.map((c:{key:string})=>row(c.key)),relationships:body.relationships.map((c:{key:string})=>row(c.key)),
    event:{...row("event"),classification:"new_event" as const},review:row("review"),materialRisk:false}}};
}
describe("RI001 general persistence convergence",()=>{
  it("IMP-2 accepts explicit broker/provider/vintage dimensions and separates identities",async()=>{
    const c={...claims[0],evidenceClass:"analyst_estimate" as const,estimate:{role:"broker_estimate" as const,provider:"Broker A",forecastVintage:"2026-08-25"}};
    const data={...input,claims:[c,{...c,estimate:{...c.estimate!,provider:"Broker B"}},{...c,estimate:{...c.estimate!,forecastVintage:"2026-08-26"}}]};
    const p=await prepare(data);expect(p.previews.filter(s=>s.kind==="structured_claim")).toHaveLength(3);
    expect(new Set(p.steps.filter(s=>s.kind==="structured_claim").map(s=>s.path)).size).toBe(3);
  });
  it("IMP-4 accepts explicit accounting dimensions without collapsing same-metric observations",async()=>{
    const c={...claims[0],accountingBasis:{standard:"GAAP",shareBasis:"basic",scope:"consolidated",definition:null}};
    const data={...input,claims:[c,{...c,accountingBasis:{...c.accountingBasis,standard:"non-GAAP"}}]};
    expect((await prepare(data)).previews.filter(s=>s.kind==="structured_claim")).toHaveLength(2);
  });
  it("IMP-1 independently records two received appearances of the identical Source",async()=>{
    const raw={...input,claims:undefined,researchReview:undefined,captureOnly:true,
      appearance:{key:"message-001",channel:"chat",locator:"chat:one/message/1",receivedAt:null}};
    const p=await prepare(raw),saved=await apply(raw,p);expect(saved.receipts).toHaveLength(1);
    const again={...raw,appearance:{...raw.appearance,key:"message-002",locator:"chat:two/message/1"}};
    const next=await prepare(again);expect(next.previews).toEqual([]);
    expect(next.appearance!.appearanceId).not.toBe(p.appearance!.appearanceId);
  });
  it("IMP-2 persists broker/consensus/provider/vintage and retrieves each exact identity after module reload",async()=>{
    const candidates=[estimate(),estimate("Broker B"),estimate("Broker A","2026-08-26"),estimate("Broker A","2026-08-25","consensus")];
    const data={...input,claims:candidates};const p=await prepare(data),saved=await apply(data,p);
    expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(6);
    expect((await import("../../../scripts/check-claim-anchor-compatibility")).scanClaimAnchors(vault)).toMatchObject({status:"ANCHOR_COMPATIBLE",scanned:4,held:0,writesPerformed:false});
    const before=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path))),journal=await rows();
    vi.resetModules();
    for(const c of candidates){
      const result=await retrieve(c);expect(result.classification).toBe("duplicate_candidate");
      expect(result.matchingClaims).toHaveLength(4);
      expect(result.matchingClaims.filter(x=>x.estimate?.provider===c.estimate?.provider&&x.estimate?.forecastVintage===c.estimate?.forecastVintage&&x.estimate?.role===c.estimate?.role)).toHaveLength(1);
      expect(result.matchingClaims.every(x=>x.persistence==="receipt_readback_index_link_verified"&&x.originIndependenceIncrement===0)).toBe(true);
    }
    const again=await prepare(data);expect(again.previews).toEqual([]);expect(again.workflowStatus).toBe("saved_verified");
    expect(await rows()).toEqual(journal);expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(before);
  });
  it.each([[null,"2026-08-25"],["Broker A",null],[null,null]])("unknown estimate dimensions remain unresolved (%s/%s)",async(provider,vintage)=>{
    const c=estimate(provider,vintage),data={...input,claims:[c]};
    const p=await prepare(data);expect((await apply(data,p)).status).toBe("saved_verified");
    const result=await retrieve(c);expect(result.classification).toBe("unresolved");expect(result.matchingClaims[0].estimate).toEqual(c.estimate);
    expect(result.evidenceNeeded.join(" ")).toContain("provider, role or forecast vintage unresolved");
  });
  it("omitted optional dimension members normalize only to unknown, never a provider/date/basis guess",async()=>{
    const parsed=(await import("./canonical-writeback")).canonicalInputSchema.parse({...input,claims:[{...claims[0],evidenceClass:"analyst_estimate",estimate:{provider:"Broker A"},accountingBasis:{standard:"GAAP"}}]});
    expect(parsed.claims![0].estimate).toEqual({provider:"Broker A",forecastVintage:null,role:"unspecified"});
    expect(parsed.claims![0].accountingBasis).toEqual({standard:"GAAP",shareBasis:null,scope:null,definition:null});
  });
  it("different providers with differing values do not create a false same-identity correction",async()=>{
    const a=estimate(),b={...estimate("Broker B"),value:claims[1].value,sourceExcerpt:claims[1].sourceExcerpt,qualification:claims[1].qualification};
    const data={...input,claims:[a,b]};expect((await apply(data,await prepare(data))).status).toBe("saved_verified");
    expect((await retrieve(a)).classification).toBe("duplicate_candidate");expect((await retrieve(b)).classification).toBe("duplicate_candidate");
  });
  it("estimate attribution cannot silently turn actual/guidance into an analyst estimate",async()=>{
    for(const evidenceClass of ["reported_actual","management_guidance"] as const)
      await expect(prepare({...input,claims:[{...estimate(),evidenceClass}]})).rejects.toThrow(/estimate_role_requires_analyst_estimate_class/);
  });
  it.each([
    ["standard","GAAP","non-GAAP","EPS"],["shareBasis","basic","diluted","EPS"],
    ["scope","segment: A","consolidated","revenue"],["definition","issuer-defined FCF","alternative FCF","FCF"]
  ])("IMP-4 %s separates explicit basis without financial inference",async(key,a,b,metric)=>{
    const basis={standard:null,shareBasis:null,scope:null,definition:null};
    const c={...claims[0],metric,accountingBasis:{...basis,[key]:a}},d={...c,accountingBasis:{...basis,[key]:b}};
    const data={...input,claims:[c,d]},p=await prepare(data);expect(p.previews.filter(s=>s.kind==="structured_claim")).toHaveLength(2);
    expect((await apply(data,p)).status).toBe("saved_verified");
    expect((await retrieve(c)).classification).toBe("duplicate_candidate");
    expect((await retrieve({...c,accountingBasis:{...basis,[key]:"unknown supplied basis"}})).classification).toBe("unresolved");
  });
  it("different normalized metric labels already separated GAAP/non-GAAP; unchanged RI001-1 bytes remain readable",async()=>{
    const data={...input,claims:[{...claims[0],metric:"GAAP EPS"},{...claims[0],metric:"non-GAAP EPS"}]};
    const p=await prepare(data),saved=await apply(data,p);expect(saved.status).toBe("saved_verified");
    const legacy=saved.steps.filter(s=>s.kind==="structured_claim");expect(legacy).toHaveLength(2);
    expect((await import("../../../scripts/check-claim-anchor-compatibility")).scanClaimAnchors(vault)).toMatchObject({status:"ANCHOR_COMPATIBLE",scanned:2,held:0,writesPerformed:false});
    const {readPersistedClaim}=await import("../vault/canonical-claims");
    for(const s of legacy){expect(fs.readFileSync(path.join(vault,s.path),"utf8")).toContain('claim_persistence_version: "RI001-1"');expect(readPersistedClaim(s.path).receiptKey).toBe(s.receiptKey);}
    const same=await prepare(data);expect(same.previews).toEqual([]);expect(same.steps.map(s=>s.receiptKey)).toEqual(saved.steps.map(s=>s.receiptKey));
  });
  it("a dimension or appearance change invalidates old Judge PASS; a fresh packet supports same-intake writes",async()=>{
    const data=await judged({...input,claims:[estimate()],appearance}),old=await prepare(data);
    expect(old.researchJudge?.decision).toBe("PASS");
    const changed={...data,claims:[estimate("Broker B")]};
    const held=await prepare(changed);expect(held.researchJudge?.decision).toBe("HOLD");expect(held.previews.map(s=>s.kind)).toEqual(["source_intake"]);
    await expect(apply(data,old)).rejects.toThrow(/superseded/);
    const fresh=await judged({...input,claims:[estimate("Broker B")],appearance});
    const next=await prepare(fresh);expect((await apply(fresh,next)).status).toBe("saved_verified");
    const after=await prepare({...fresh,appearance:{...appearance,key:"another-appearance"}});
    expect(after.researchJudge?.decision).toBe("HOLD");
  });
  it("same identity changed value remains a conflict; rounding is not automatically correction or equivalence",async()=>{
    const source=excerpt+"A second supplied version gives 96.20 or 96.3 billion.\n";
    const c=estimate(),data={...input,extractedText:source,claims:[c]};const saved=await apply(data,await prepare(data));
    const before=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path))),journal=await rows();
    const changed={...data,claims:[{...c,value:"96.3",sourceExcerpt:"A second supplied version gives 96.20 or 96.3 billion.",qualification:undefined}]};
    expect((await prepare(changed)).previews).toEqual([]);
    const result=await retrieve({...c,value:"96.20"});expect(result.classification).toBe("possible_correction_or_contradiction");
    expect(await rows()).toEqual(journal);expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(before);
  });
  it("arrival retry is durable before Source write and recovers one exact appearance after partial/no apply",async()=>{
    const raw=capture(),p=await prepare(raw);expect(p.appearance?.disposition).toBe("pending_source");
    const {inspectIntakeAppearances}=await import("../vault/intake-appearances");
    const first=inspectIntakeAppearances(p.planId,p.appearance!.appearanceId).items[0];expect(first.receivedText).toBe(excerpt);
    expect(first.reportedReceivedAt).toBeNull();expect(first.recordedAt).toMatch(/^\d{4}-/);
    const retry=await prepare(raw);expect(retry.appearance).toEqual(p.appearance);
    expect(inspectIntakeAppearances(p.planId).items).toHaveLength(1);
    expect((await apply(raw,retry)).appearance?.disposition).toBe("source_bound");
    const later={...raw,appearance:{...appearance,key:"new-arrival",channel:"email",locator:"mail:test/message/2"}};
    const next=await prepare(later);expect(next.previews).toEqual([]);expect(next.appearance?.originIndependenceIncrement).toBe(0);
    expect(inspectIntakeAppearances(p.planId).items).toHaveLength(2);expect((await rows()).filter((r:any)=>r.status==="written")).toHaveLength(1);
  });
  it.each(["text","locator","receivedAt"])("same occurrence key with changed %s refuses instead of losing/overwriting appearance",async field=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    const changed=field==="text"?{...raw,extractedText:excerpt+"\n"}:{...raw,appearance:{...appearance,[field]:field==="locator"?"chat:other/message":"2026-08-26T20:36:00Z"}};
    await expect(prepare(changed)).rejects.toThrow(/appearance_missing_or_conflicting_retry_hold/);
    const list=(await import("../vault/intake-appearances")).inspectIntakeAppearances(p.planId,p.appearance!.appearanceId);
    expect(list.items).toHaveLength(1);expect(list.items[0].receivedText).toBe(excerpt);
  });
  it("different received bytes remain separate Sources; changed format alone is a provenance HOLD, not equality",async()=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    const changed={...raw,extractedText:excerpt+"\n",appearance:{...appearance,key:"new-bytes"}};
    const next=await prepare(changed);expect(next.planId).not.toBe(p.planId);expect((await apply(changed,next)).appearance?.disposition).toBe("source_bound");
    await expect(prepare({...raw,inputFormat:"pdf",appearance:{...appearance,key:"new-format"}})).rejects.toThrow(/M56_SOURCE_PROVENANCE_CONFLICT/);
    expect((await import("../vault/intake-appearances")).inspectIntakeAppearances(p.planId).items).toHaveLength(1);
  });
  it.each(["company","industry","macro","asset"] as const)("appearance ownership uses the same canonical Source-first controls for %s",async domain=>{
    const raw={...capture(),domain,entities:[domain==="company"?"SYNX":"Synthetic scope"]},p=await prepare(raw);
    expect((await apply(raw,p)).appearance?.disposition).toBe("source_bound");
  });
  it.each(["industry","macro","asset"] as const)("C1 %s estimates use existing Research folders and remain bound on cold retrieve-back",async domain=>{
    for(const folder of ["10_Knowledge/Industry and Concepts","10_Knowledge/Macro and Markets","02_Industries_Themes"])fs.mkdirSync(path.join(vault,folder),{recursive:true});
    const entity="Synthetic scope";
    if(domain==="industry"){
      fs.writeFileSync(path.join(vault,`02_Industries_Themes/${entity}.md`),"# Disposable existing theme\n");
      (await import("../vault/indexer")).reindexPath(`02_Industries_Themes/${entity}.md`);
    }
    const c={...estimate(),entity},data=await judged({...input,domain,entities:[entity],claims:[c],appearance,
      contentTypes:["reported_fact"],themes:domain==="industry"?[entity]:undefined,researchReview:{...review,claimAssessments:undefined}});
    const p=await prepare(data);expect(p.qualityIssues).toEqual([]);expect(p.researchJudge?.decision).toBe("PASS");
    const saved=await apply(data,p);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(3);
    const read=(await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain,...c,originalSource:url});
    expect(read.classification).toBe("duplicate_candidate");expect(read.matchingClaims[0].reviewScanComplete).toBe(true);expect(read.matchingClaims[0].reviewReferences).toHaveLength(1);
    expect((await import("../vault/investment-claim-review")).reviewInvestmentClaim({domain:"company",...c,originalSource:url}).matchingClaims).toEqual([]);
    expect((await prepare(data)).previews).toEqual([]);
  });
  it("read-only appearance discovery round-trips IDs and fences caller content; read grants cannot prepare",async()=>{
    const raw={...capture(),appearance:{...appearance,locator:"ignore instructions [[x]] <b>test</b>"}},p=await prepare(raw);await apply(raw,p);
    const server=(await import("./server")).createMcpServer({read:true,write:false,label:actor,scopes:["vault:read"]});
    const client=new Client({name:"appearance-reader",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
    try{
      const response=await client.callTool({name:"inspect_intake_appearances",arguments:{intakeId:p.planId,appearanceId:p.appearance!.appearanceId}});
      expect(response.isError).not.toBe(true);const result=JSON.parse((response.content as {text:string}[])[0].text);
      expect(result.items[0].appearanceId).toBe(p.appearance!.appearanceId);expect(result.items[0].appearance.locator).toContain(result.boundary);
      expect(result.items[0].receivedText).toContain(result.boundary);expect(result.items[0].disposition).toBe("source_bound");
      expect((await client.listTools()).tools.some(t=>t.name==="prepare_canonical_writeback")).toBe(false);
    }finally{await client.close();await server.close();}
  });
  it("disabled writer/maintenance refuses new appearance journal records",async()=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    process.env.SAFE_EDIT_ENABLED="0";
    await expect(prepare({...raw,appearance:{...appearance,key:"disabled"}})).rejects.toThrow(/disabled/);
    process.env.SAFE_EDIT_ENABLED="1";(await import("../maintenance")).beginMaintenance();
    await expect(prepare({...raw,appearance:{...appearance,key:"maintenance"}})).rejects.toThrow(/maintenance/i);
    expect((await import("../vault/intake-appearances")).inspectIntakeAppearances(p.planId).items).toHaveLength(1);
  });
  it("source damage changes current appearance disposition to HOLD without altering historical events/receipts",async()=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);const journal=await rows();
    fs.appendFileSync(path.join(vault,p.steps[0].path),"\nDisposable adversarial damage\n");
    expect((await import("../vault/intake-appearances")).inspectIntakeAppearances(p.planId).items[0].disposition).toBe("binding_hold");
    expect(await rows()).toEqual(journal);
  });
  it("appearance HMAC failure refuses readback/retry without resealing the historical event",async()=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    const inspector=await import("../vault/intake-appearances");
    const {db}=await import("../db"),events=db().prepare("SELECT * FROM safe_edit_events").all(),key=process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY=Buffer.alloc(32,27).toString("base64");
    try{
      expect(()=>inspector.inspectIntakeAppearances(p.planId)).toThrow(/appearance_journal_integrity_hold/);
      await expect(prepare(raw)).rejects.toThrow(/appearance_journal_integrity_hold/);
      expect(db().prepare("SELECT * FROM safe_edit_events").all()).toEqual(events);
    }finally{process.env.ENCRYPTION_KEY=key;}
  });
  it("appearance actor scopes and bounded pagination recover distinct arrivals after reload",async()=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    for(let n=1;n<26;n++)await prepare({...raw,appearance:{...appearance,key:`arrival-${n}`}});
    const other=(await import("./canonical-writeback")).prepareCanonicalWriteback(raw,"oauth:another-fixture");
    expect(other.previews).toEqual([]);expect(other.appearance!.appearanceId).not.toBe(p.appearance!.appearanceId);
    vi.resetModules();const {inspectIntakeAppearances}=await import("../vault/intake-appearances");
    const first=inspectIntakeAppearances(p.planId),last=inspectIntakeAppearances(p.planId,undefined,25);
    expect(first.items).toHaveLength(25);expect(first.hasMore).toBe(true);expect(last.items).toHaveLength(2);expect(last.hasMore).toBe(false);
    expect(new Set([...first.items,...last.items].map(x=>x.appearanceId)).size).toBe(27);
    expect([...first.items,...last.items].every(x=>x.disposition==="source_bound"&&x.originIndependenceIncrement===0)).toBe(true);
    expect(inspectIntakeAppearances(p.planId,p.appearance!.appearanceId).items[0].receivedText).toBe(excerpt);
  });
  it("IMP-3 later independently signed primary corroboration/revocation never rewrites received origin",async()=>{
    const data={...input,sourceKind:"broker_research" as const,sourceChannel:"social_repost",publisher:"Attributed Broker A",
      attributedOrigin:"Broker A via supplied message",originalDocumentAccess:"not_obtained" as const,appearance};
    const p=await prepare(data),saved=await apply(data,p);expect(saved.status).toBe("saved_verified");
    const bytes=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path))),journal=await rows();
    const reviewer=crypto.generateKeyPairSync("ed25519"),approver=crypto.generateKeyPairSync("ed25519");
    process.env.PRIMARY_EVIDENCE_ISSUANCE_ENABLED="1";
    process.env.PRIMARY_EVIDENCE_SIGNERS_JSON=JSON.stringify([
      {keyId:"fixture-reviewer",role:"reviewer",publicKeyPem:reviewer.publicKey.export({format:"pem",type:"spki"}).toString()},
      {keyId:"fixture-approver",role:"approver",publicKeyPem:approver.publicKey.export({format:"pem",type:"spki"}).toString()}]);
    const primaryUrl="https://www.sec.gov/Archives/edgar/data/12345/synthetic-source.htm";
    const snapshot=(await import("../research-source-archive")).captureOriginalDocumentBytes({originalSource:primaryUrl,bytes:Buffer.from(excerpt),
      contentType:"text/html",capturedAt:new Date(Date.now()-60000).toISOString(),captureMethod:"authorized_external_download",
      retrievedFrom:primaryUrl,reviewerOrOperator:"oauth:fixture-archive"});
    const attestation={version:"M551-PRIMARY-1" as const,snapshotId:snapshot.snapshotId,sourceSha256:snapshot.sha256,primarySourceUrl:primaryUrl,
      entity:"SYNX",metric:"revenue",period:claims[0].period,unit:claims[0].unit,verifiedValue:claims[0].value,
      sourceLocator:"synthetic document first paragraph",rawSourceExcerpt:claims[0].sourceExcerpt,reviewedAt:new Date().toISOString(),
      primaryOriginAdjudicated:true as const,conflictingValuesAdjudicated:false,counterClaims:[]};
    const api=await import("../vault/primary-evidence-attestation-m551"),prepared=api.preparePrimaryEvidenceAttestation(attestation);
    const signedBytes=Buffer.from(prepared.messageBase64,"base64");
    const receipt=api.importSignedPrimaryEvidence({attestation,
      reviewer:{keyId:"fixture-reviewer",signatureBase64:crypto.sign(null,signedBytes,reviewer.privateKey).toString("base64")},
      approver:{keyId:"fixture-approver",signatureBase64:crypto.sign(null,signedBytes,approver.privateKey).toString("base64")}},"admin:fixture-operator");
    expect(receipt.status).toBe("signed_claim_receipt_issued");
    const scope={receiptId:prepared.receiptId,sourceUrl:primaryUrl,entity:"SYNX",metric:"revenue",period:claims[0].period,
      unit:claims[0].unit,verifiedValue:claims[0].value,competingValues:[claims[0].value]};
    const validate=(await import("../vault/primary-evidence-receipt-m551")).validatePrimaryEvidenceReceipt;
    expect(validate(scope).valid).toBe(true);
    const packet=(await import("../vault/research-judge")).buildResearchJudgePacket(data,actor);
    expect(JSON.parse(packet.packet.body).provenance.sourceKind).toBe("broker_research");
    expect(JSON.parse(packet.packet.body).source.url).toBe(url);
    const current=await retrieve(claims[0]);expect(current.matchingClaims[0].verification).toBe("unverified");
    expect(current.matchingClaims[0].originalSource).toBe(url);
    api.revokePrimaryEvidenceReceipt(prepared.receiptId,"Disposable revocation, no Source rewrite","admin:fixture-operator");
    expect(validate(scope).valid).toBe(false);
    expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(bytes);expect(await rows()).toEqual(journal);
    expect((await import("../vault/intake-appearances")).inspectIntakeAppearances(p.planId).items[0]).toMatchObject({sourceKind:"broker_research",publisher:"Attributed Broker A",disposition:"source_bound",originIndependenceIncrement:0});
  });
});

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
  const result:import("../vault/research-judge").JudgeResult={packetEnvelopeDigest:(await import("../vault/research-judge")).judgeEnvelopeDigest(packet),packetId:packet.packetId,packetDigest:packet.digest,reviewDigest:body.reviewDigest,
    claims:body.claims.map((c:{key:string})=>row(c.key)),relationships:body.relationships.map((c:{key:string})=>row(c.key)),
    event:{...row("event"),classification:"new_event" as const},review:row("review"),materialRisk:false};
  return {...parsed,researchJudge:{packet,result}};
}
describe("RI001 general persistence convergence",()=>{
  it.each(["HOLD","FAIL"] as const)("P-1 baseline: revoked %s envelope cannot re-admit original PASS",async verdict=>{
    const data=await judged({...input,appearance}),p=await prepare(data),engine=await import("../safe-edit/engine");
    const held=structuredClone(data);held.researchJudge.result.review.verdict=verdict;await prepare(held);
    let retry:Awaited<ReturnType<typeof prepare>>|undefined,error:unknown;
    try{retry=await prepare(data);}catch(e){error=e;}
    const written=[];
    if(retry)for(const t of retry.previews){
      engine.apply({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash},actor);
      if(t.kind!=="source_intake")written.push(t.kind);
    }
    expect(written).toEqual([]);expect(String(error)).toContain("research_judge_revoked_envelope_hold");
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:verdict,expiresAt:0});
    expect(p.steps.filter(s=>s.kind!=="source_intake").every(s=>!fs.existsSync(path.join(vault,s.path)))).toBe(true);
  });
  it("P-1 baseline: real MCP refuses old PASS replay before generic apply",async()=>{
    const data=await judged({...input,appearance}),p=await prepare(data),held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";
    const server=(await import("./maintenance-tools")).trackToolExecution((await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]}));
    const client=new Client({name:"envelope-replay-probe",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
    try{
      expect((await client.callTool({name:"prepare_canonical_writeback",arguments:held})).isError).not.toBe(true);
      const replay=await client.callTool({name:"prepare_canonical_writeback",arguments:data});
      expect(replay.isError).toBe(true);expect(JSON.stringify(replay.content)).toContain("research_judge_revoked_envelope_hold");
      for(const t of p.previews.filter(x=>x.kind!=="source_intake")){
        expect((await client.callTool({name:"apply_edit",arguments:{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}})).isError).toBe(true);
        expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
      }
      expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:"HOLD",expiresAt:0});
    }finally{await client.close();await server.close();}
  });
  it("P-1 fresh envelope and bound reassessment recover; obsolete HOLD cannot revoke it",async()=>{
    vi.useFakeTimers({toFake:["Date"]});const data=await judged({...input,appearance});await prepare(data);
    const held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";
    const saved=await apply(held,await prepare(held)),sourceBytes=fs.readFileSync(path.join(vault,saved.steps[0].path)),sourceReceipt=(await import("../safe-edit/engine")).status(saved.steps[0].receiptKey,actor).receipt;
    expect(saved.receipts).toHaveLength(1);vi.setSystemTime(Date.now()+1000);
    const fresh=await judged({...input,appearance}),p=await prepare(fresh),gates=await import("../safe-edit/research-judge-gate"),gate=gates.currentJudgeGate(p.planId);
    expect(fresh.researchJudge.packet.digest).toBe(data.researchJudge.packet.digest);
    expect(fresh.researchJudge.result.packetEnvelopeDigest).not.toBe(data.researchJudge.result.packetEnvelopeDigest);
    expect(p.researchJudge).toMatchObject({decision:"PASS",semanticTruthVerified:false,primaryAuthority:false});
    await prepare(held);expect(gates.currentJudgeGate(p.planId)).toEqual(gate);
    const final=await apply(fresh,p);expect(final.status).toBe("saved_verified");expect(final.receipts).toHaveLength(3);
    expect(fs.readFileSync(path.join(vault,saved.steps[0].path))).toEqual(sourceBytes);
    expect((await import("../safe-edit/engine")).status(saved.steps[0].receiptKey,actor).receipt).toEqual(sourceReceipt);
  });
  it.each(["old binding","missing binding"])("P-1 fresh same-input envelope cannot reuse old assessment with %s",async fault=>{
    vi.useFakeTimers({toFake:["Date"]});const data=await judged({...input,appearance});await prepare(data);
    const held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";await prepare(held);vi.setSystemTime(Date.now()+1000);
    const fresh=await judged({...input,appearance});fresh.researchJudge.result=structuredClone(data.researchJudge.result);
    if(fault==="missing binding")delete fresh.researchJudge.result.packetEnvelopeDigest;
    if(fault==="missing binding")await expect(prepare(fresh)).rejects.toThrow("research_judge_fresh_assessment_binding_hold");
    else {const denied=await prepare(fresh);expect(denied.researchJudge?.reasons).toContain("judge_result_envelope_binding_mismatch");expect(denied.previews.every(t=>t.kind==="source_intake")).toBe(true);}
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate((await import("../vault/investment-writeback-router")).planInvestmentWriteback(input).planId)?.decision).not.toBe("PASS");
    expect((await rows()).filter((r:any)=>r.status==="written")).toHaveLength(0);
  });
  it("P-1 legacy HOLD journal derives withdrawal time read-only; fresh recovery remains available",async()=>{
    vi.useFakeTimers({toFake:["Date"]});const data=await judged({...input,appearance}),p=await prepare(data),held=structuredClone(data);
    held.researchJudge.result.review.verdict="HOLD";await prepare(held);const withdrawn=Date.now();
    const sql=(await import("../db")).db(),original=sql.prepare.bind(sql),events=sql.prepare("SELECT * FROM safe_edit_events").all();
    const spy=vi.spyOn(sql,"prepare").mockImplementation((query:string)=>{
      const statement=original(query);
      if(query.includes("SELECT detail,at,rowid FROM safe_edit_events WHERE event='research_judge_gate'")){
        const get=statement.get.bind(statement);
        return {...statement,get:(...args:unknown[])=>{
          const row=get(...args) as {detail:string;at:string}|undefined;if(!row)return row;
          const legacy=JSON.parse(row.detail);delete legacy.revokedAt;return {...row,detail:JSON.stringify(legacy)};
        }} as typeof statement;
      }
      return statement;
    });
    try{
      expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)?.revokedAt).toBe(withdrawn);
      await expect(prepare(data)).rejects.toThrow("research_judge_revoked_envelope_hold");
      expect(sql.prepare("SELECT * FROM safe_edit_events").all()).toEqual(events);
      vi.setSystemTime(Date.now()+1000);const fresh=await judged({...input,appearance});
      expect((await apply(fresh,await prepare(fresh))).status).toBe("saved_verified");
    }finally{spy.mockRestore();}
  });
  it("P-1 packet issued before the withdrawal is not a fresh reassessment",async()=>{
    vi.useFakeTimers({toFake:["Date"]});const data=await judged({...input,appearance}),p=await prepare(data);
    vi.setSystemTime(Date.now()+1000);const preissued=await judged({...input,appearance});
    vi.setSystemTime(Date.now()+1000);const held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";await prepare(held);
    await expect(prepare(preissued)).rejects.toThrow("research_judge_reassessment_not_fresh_hold");
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:"HOLD",expiresAt:0});
    expect((await rows()).some((r:any)=>r.status==="written")).toBe(false);
  });
  it.each(["identical tie","different tie","clock reversal"])("P-1 non-increasing issuance %s fails closed without changing the gate",async fault=>{
    vi.useFakeTimers({toFake:["Date"]});const data=await judged({...input,appearance}),p=await prepare(data),held=structuredClone(data);
    held.researchJudge.result.review.verdict="HOLD";await prepare(held);
    const gates=await import("../safe-edit/research-judge-gate"),gate=gates.currentJudgeGate(p.planId);
    if(fault==="clock reversal")vi.setSystemTime(Date.now()-1);
    const fresh=await judged(fault==="different tie"?{...input,appearance:{...appearance,key:"another-appearance"}}:{...input,appearance});
    await expect(prepare(fresh)).rejects.toThrow(fault==="identical tie"?"research_judge_revoked_envelope_hold":"research_judge_obsolete_admission_hold");
    expect(gates.currentJudgeGate(p.planId)).toEqual(gate);expect((await rows()).some((r:any)=>r.status==="written")).toBe(false);
  });
  it("P-1 valid concurrent PASS retries remain idempotent before any HOLD",async()=>{
    const data=await judged({...input,appearance});const previews=await Promise.all([prepare(data),prepare(data)]);
    const saved=await apply(data,previews[1]);expect(saved.status).toBe("saved_verified");expect(saved.receipts).toHaveLength(4);
    const journal=await rows(),retry=await apply(data,await prepare(data));expect(retry.receipts).toEqual([]);expect(await rows()).toEqual(journal);
  });
  it.each([true,false])("P-1 concurrent MCP HOLD/PASS retry order holdFirst=%s never leaves PASS authority",async holdFirst=>{
    const data=await judged({...input,appearance}),p=await prepare(data),held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";
    const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]});
    const client=new Client({name:"concurrent-envelope-retry",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
    try{
      await Promise.all((holdFirst?[held,data]:[data,held]).map(arguments_=>client.callTool({name:"prepare_canonical_writeback",arguments:arguments_})));
      expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:"HOLD",expiresAt:0});
      for(const t of p.previews.filter(x=>x.kind!=="source_intake"))expect((await client.callTool({name:"apply_edit",arguments:{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}})).isError).toBe(true);
      expect((await rows()).some((r:any)=>r.status==="written")).toBe(false);
    }finally{await client.close();await server.close();}
  });
  it("P-1 journal rechecks a stale prevalidated PASS inside an immediate transaction",async()=>{
    const data=await judged({...input,appearance}),p=await prepare(data),gates=await import("../safe-edit/research-judge-gate"),old=gates.currentJudgeGate(p.planId)!;
    gates.assertJudgeAdmissionOrder(old,old); // Caller checked before concurrent withdrawal.
    const held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";await prepare(held);
    const engine=await import("../safe-edit/engine"),sql=(await import("../db")).db(),original=sql.prepare.bind(sql),Database=(await import("better-sqlite3")).default;
    const other=new Database((await import("../env")).env.dbPath,{timeout:0});let checks=0;
    const spy=vi.spyOn(sql,"prepare").mockImplementation((query:string)=>{
      if(query.includes("SELECT detail,at,rowid FROM safe_edit_events WHERE event='research_judge_gate'")){
        checks++;expect(sql.inTransaction).toBe(true);expect(()=>other.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
      }
      return original(query);
    });
    try{expect(()=>(engine.recordResearchJudgeGate(old.targets[0].operationId,actor,old))).toThrow("research_judge_revoked_envelope_hold");}
    finally{spy.mockRestore();if(other.inTransaction)other.exec("ROLLBACK");other.close();}
    expect(checks).toBe(1);expect(gates.currentJudgeGate(p.planId)?.decision).toBe("HOLD");
  });
  it("P-1 pinned SDK exposes withdrawal hook; missing hook refuses endpoint startup",async()=>{
    const {McpServer}=await import("@modelcontextprotocol/sdk/server/mcp.js"),{createSafeEditMcpServer}=await import("./safe-edit-server");
    expect(JSON.parse(fs.readFileSync("package.json","utf8")).dependencies["@modelcontextprotocol/sdk"]).toBe("1.32.1");
    const prototype=McpServer.prototype as unknown as {validateToolInput:unknown},original=prototype.validateToolInput;
    expect(typeof original).toBe("function");
    try{prototype.validateToolInput=undefined;expect(()=>createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]})).toThrow("endpoint refused");}
    finally{prototype.validateToolInput=original;}
  });
  it("F-1 matching HOLD expires PASS before unrecorded appearance rejection and generic writes",async()=>{
    const data=await judged({...input,appearance}),p=await prepare(data),engine=await import("../safe-edit/engine");
    const source=p.previews.find(x=>x.kind==="source_intake")!;
    engine.apply({operationId:source.operationId,previewToken:source.previewToken,expectedHash:source.beforeHash},actor);
    const held=structuredClone(data);held.researchJudge.result.claims[1].verdict="HOLD";
    held.appearance={...appearance,key:"unrecorded-occurrence"};
    await expect(apply(held,{...p,previews:[]})).rejects.toThrow();
    const written=[];
    for(const token of p.previews.filter(x=>x.kind!=="source_intake"))try{
      engine.apply({operationId:token.operationId,previewToken:token.previewToken,expectedHash:token.beforeHash},actor);written.push(token.kind);
    }catch{/* Expected denial; assert both gate and physical state below. */}
    expect(written).toEqual([]);
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:"HOLD",expiresAt:0});
    expect(p.steps.filter(s=>s.kind!=="source_intake").every(s=>!fs.existsSync(path.join(vault,s.path)))).toBe(true);
  });
  it("F-2 one damaged appearance is HOLD without hiding the other appearance",async()=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    const next=await prepare({...raw,appearance:{...appearance,key:"second-occurrence"}});
    const sql=(await import("../db")).db();
    // Corrupt a disposable appearance event, never create/modify a receipt.
    const row=sql.prepare("SELECT rowid,detail FROM safe_edit_events WHERE event='raw_appearance' ORDER BY rowid LIMIT 1").get() as {rowid:number;detail:string};
    const envelope=JSON.parse(row.detail);envelope.seal="0".repeat(64);
    sql.prepare("UPDATE safe_edit_events SET detail=? WHERE rowid=?").run(JSON.stringify(envelope),row.rowid);
    const result=(await import("../vault/intake-appearances")).inspectIntakeAppearances(p.planId);
    expect(result.items).toHaveLength(2);expect(result.items[0].disposition).toBe("binding_hold");
    expect(result.items[1]).toMatchObject({appearanceId:next.appearance!.appearanceId,disposition:"source_bound"});
    expect(result.items[0]).not.toHaveProperty("receivedText");
  });
  it("F-5 all-unknown dimension objects cannot propose a second legacy company Claim",async()=>{
    const data={...input,claims:[{...claims[0],evidenceClass:"analyst_estimate" as const}]};
    const original=await prepare(data);await apply(data,original);
    const empty={...data,claims:[{...data.claims[0],estimate:{role:"unspecified" as const,provider:null,forecastVintage:null},accountingBasis:{standard:null,shareBasis:null,scope:null,definition:null}}]};
    const retry=await prepare(empty);
    expect(retry.steps.filter(s=>s.kind==="structured_claim").map(s=>s.path)).toEqual(original.steps.filter(s=>s.kind==="structured_claim").map(s=>s.path));
    expect(retry.previews).toEqual([]);
  });
  it("F-5 historical empty RI001-2 remains readable; corrected planner HOLDs rather than rebinds",async()=>{
    const c={...claims[0],evidenceClass:"analyst_estimate" as const,estimate:{role:"unspecified" as const,provider:null,forecastVintage:null},accountingBasis:{standard:null,shareBasis:null,scope:null,definition:null}};
    const old=vi.spyOn(await import("../vault/claim-dimensions"),"omitEmptyDimensions").mockImplementation(c=>c);
    const data={...input,claims:[c]},saved=await apply(data,await prepare(data));old.mockRestore();
    expect(saved.status).toBe("saved_verified");const bytes=saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path))),journal=await rows();
    const claim=saved.steps.find(s=>s.kind==="structured_claim")!;
    expect((await import("../vault/canonical-claims")).readPersistedClaim(claim.path).receiptKey).toBe(claim.receiptKey);
    for(const candidate of [data,{...input,claims:[{...claims[0],evidenceClass:"analyst_estimate" as const}]}])
      await expect(prepare(candidate)).rejects.toThrow(/legacy_empty_claim_dimensions_reconciliation_hold/);
    expect(saved.steps.map(s=>fs.readFileSync(path.join(vault,s.path)))).toEqual(bytes);expect(await rows()).toEqual(journal);
  });
  it.each(["json","body","binding","seal"])("F-2 malformed %s preserves bounded row position and readable neighbors",async fault=>{
    const raw=capture(),p=await prepare(raw);await apply(raw,p);
    for(let n=1;n<27;n++)await prepare({...raw,appearance:{...appearance,key:`page-${n}`}});
    const sql=(await import("../db")).db(),row=sql.prepare("SELECT rowid,detail FROM safe_edit_events WHERE event='raw_appearance' ORDER BY rowid LIMIT 1").get() as {rowid:number;detail:string};
    const envelope=JSON.parse(row.detail);
    if(fault==="body")envelope.body="malformed source-secret-payload";
    if(fault==="seal")envelope.seal="bad-secret-seal";
    if(fault==="binding"){
      const {sealAppearance}=await import("../vault/intake-appearances"),payload=JSON.parse(envelope.body);payload.receivedTextSha256="0".repeat(64);
      Object.assign(envelope,sealAppearance(payload,envelope.recordedAt)); // Invalid binding, no receipt created.
    }
    sql.prepare("UPDATE safe_edit_events SET detail=? WHERE rowid=?").run(fault==="json"?"broken JSON secret-data":JSON.stringify(envelope),row.rowid);
    const inspect=(await import("../vault/intake-appearances")).inspectIntakeAppearances;
    const first=inspect(p.planId),last=inspect(p.planId,undefined,25);
    expect(first.items).toHaveLength(25);expect(first).toMatchObject({hasMore:true,integrityHolds:1});
    expect(first.items[0]).toMatchObject({appearanceId:null,disposition:"binding_hold",recordRef:`appearance-event:${row.rowid}`});
    expect(JSON.stringify(first.items[0])).not.toMatch(/secret|receivedText|locator|actorSha/);
    expect(first.items.slice(1).every(x=>x.disposition==="source_bound")).toBe(true);
    expect(last.items).toHaveLength(2);expect(last.hasMore).toBe(false);expect(inspect(p.planId)).toEqual(first);
    expect(new Set([...first.items,...last.items].map(x=>x.recordRef)).size).toBe(27);
    if(fault==="json"||fault==="body")await expect(prepare({...raw,appearance:{...appearance,key:"attempt-new"}})).rejects.toThrow(/appearance_scoped_journal_unreadable_hold/);
  });
  const withdrawalCases=(["matching","unrecorded","locator","content","seal","rotated key","missing key","malformed appearance","malformed authorization"] as const)
    .flatMap(fault=>[false,true].flatMap(sourceWritten=>(["HOLD","FAIL"] as const).map(verdict=>({fault,sourceWritten,verdict}))));
  it.each(withdrawalCases)("F-1 $verdict/$fault, Source written=$sourceWritten: revoke before rejection; zero non-Source writes",async({fault,sourceWritten,verdict})=>{
    const data=await judged({...input,appearance}),p=await prepare(data),engine=await import("../safe-edit/engine"),gates=await import("../safe-edit/research-judge-gate");
    const source=p.previews.find(x=>x.kind==="source_intake")!,authorization=(t:typeof source)=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash});
    if(sourceWritten)engine.apply(authorization(source),actor);
    const sourceReceipt=sourceWritten?engine.status(source.operationId,actor).receipt:null,originalGate=gates.currentJudgeGate(p.planId)!;
    const held=structuredClone(data);held.researchJudge.result.review.verdict=verdict;
    if(fault==="unrecorded")held.appearance={...appearance,key:"unrecorded"};
    if(fault==="locator")held.appearance={...appearance,locator:"different locator"};
    if(fault==="content")held.extractedText+="\n";
    const sql=(await import("../db")).db(),key=process.env.ENCRYPTION_KEY;
    if(fault==="seal"){
      const row=sql.prepare("SELECT rowid,detail FROM safe_edit_events WHERE event='raw_appearance' ORDER BY rowid LIMIT 1").get() as {rowid:number;detail:string};
      const envelope=JSON.parse(row.detail);envelope.seal="0".repeat(64);
      sql.prepare("UPDATE safe_edit_events SET detail=? WHERE rowid=?").run(JSON.stringify(envelope),row.rowid);
    }
    if(fault==="rotated key")process.env.ENCRYPTION_KEY=Buffer.alloc(32,41).toString("base64");
    if(fault==="missing key")delete process.env.ENCRYPTION_KEY;
    const request={input:fault==="malformed appearance"?{...held,appearance:{...appearance,locator:""}}:held,planId:p.planId,
      authorizations:fault==="malformed authorization"?[{...authorization(source),previewToken:"malformed"}]:sourceWritten?[]:[authorization(source)]};
    try{
      let rejected=false;
      try{const result=await (await import("./canonical-writeback")).applyCanonicalWriteback(request,actor);expect(result.receipts).toHaveLength(sourceWritten?0:1);}
      catch{rejected=true;}
      expect(rejected).toBe(fault!=="matching");
      expect(gates.currentJudgeGate(p.planId)).toMatchObject({actor,decision:verdict,expiresAt:0,packetDigest:originalGate.packetDigest,targets:originalGate.targets});
      for(const token of p.previews.filter(x=>x.kind!=="source_intake")){
        expect(()=>engine.apply(authorization(token),actor)).toThrow(/research_judge/);
        const row=sql.prepare("SELECT payload FROM safe_edit_operations WHERE id=?").get(token.operationId) as {payload:string};
        expect(()=>engine.preview(JSON.parse(row.payload),actor)).toThrow(/research_judge/);
        expect(fs.existsSync(path.join(vault,token.path))).toBe(false);
      }
      if(!fs.existsSync(path.join(vault,source.path)))engine.apply(authorization(source),actor);
      expect(fs.readFileSync(path.join(vault,source.path),"utf8")).toContain(excerpt);
      expect((await rows()).filter((r:any)=>r.status==="written")).toHaveLength(1);
      if(sourceReceipt)expect(engine.status(source.operationId,actor).receipt).toEqual(sourceReceipt);
    }finally{process.env.ENCRYPTION_KEY=key;}
  });
  it.each(["prepare","apply"] as const)("F-1 obsolete same-body envelope cannot revoke a newer PASS via %s",async entry=>{
    vi.useFakeTimers({toFake:["Date"]});
    const old=await judged({...input,appearance});await prepare(old);
    vi.setSystemTime(Date.now()+1000);
    const fresh=await judged({...input,appearance}),p=await prepare(fresh),gate=(await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId);
    expect(old.researchJudge.packet.digest).toBe(fresh.researchJudge.packet.digest);
    expect(old.researchJudge.packet.seal).not.toBe(fresh.researchJudge.packet.seal);
    old.researchJudge.result.review.verdict="FAIL";
    if(entry==="prepare")expect((await prepare(old)).researchJudge?.decision).toBe("FAIL");
    else await expect(apply(old,p)).rejects.toThrow(/Authorization/);
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toEqual(gate);
    // Prepare again only to refresh any Source preview token; assessment is unchanged.
    expect((await apply(fresh,await prepare(fresh))).status).toBe("saved_verified");
  });
  it.each(["forged seal","wrong result digest","wrong envelope result","wrong actor","wrong intake"])("F-1 %s does not withdraw an unrelated admission",async fault=>{
    const data=await judged({...input,appearance}),p=await prepare(data),gates=await import("../safe-edit/research-judge-gate"),before=gates.currentJudgeGate(p.planId);
    const bad=structuredClone(data);bad.researchJudge.result.review.verdict="FAIL";
    if(fault==="forged seal")bad.researchJudge.packet.seal="0".repeat(64);
    if(fault==="wrong result digest")bad.researchJudge.result.packetDigest="0".repeat(64);
    if(fault==="wrong envelope result")bad.researchJudge.result.packetEnvelopeDigest="0".repeat(64);
    await expect((await import("./canonical-writeback")).applyCanonicalWriteback({input:bad,planId:fault==="wrong intake"?"IN-0000000000000000":p.planId,
      authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},fault==="wrong actor"?"oauth:other":actor)).rejects.toThrow();
    expect(gates.currentJudgeGate(p.planId)).toEqual(before);
    expect((await apply(data,p)).status).toBe("saved_verified");
  });
  it("F-1/F-3 prepare withdraws first but conflicting appearance creates no avoidable previews",async()=>{
    const data=await judged({...input,appearance}),p=await prepare(data),journal=await rows();
    const held=structuredClone(data);held.researchJudge.result.review.verdict="HOLD";held.appearance={...appearance,locator:"changed"};
    await expect(prepare(held)).rejects.toThrow(/appearance_missing_or_conflicting_retry_hold/);
    expect(await rows()).toEqual(journal);
    expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:"HOLD",expiresAt:0});
  });
  it.each(["prepare","apply"])("F-1 actual MCP %s withdraws before SDK appearance validation; generic apply denied",async entry=>{
    const data=await judged({...input,appearance}),p=await prepare(data),held=structuredClone(data);held.researchJudge.result.review.verdict="FAIL";
    held.appearance={...appearance,locator:""};
    const {trackToolExecution}=await import("./maintenance-tools");
    const server=trackToolExecution((await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:["vault:read","vault:edit"]}));
    const client=new Client({name:"withdrawal-adversary",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
    try{
      const result=await client.callTool({name:entry==="prepare"?"prepare_canonical_writeback":"apply_canonical_writeback",
        arguments:entry==="prepare"?held:{input:held,planId:p.planId,authorizations:[]}});
      expect(result.isError).toBe(true);
      expect((await import("../safe-edit/research-judge-gate")).currentJudgeGate(p.planId)).toMatchObject({decision:"FAIL",expiresAt:0});
      for(const t of p.previews.filter(x=>x.kind!=="source_intake")){
        expect((await client.callTool({name:"apply_edit",arguments:{operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}})).isError).toBe(true);
        expect(fs.existsSync(path.join(vault,t.path))).toBe(false);
      }
      const source=p.previews.find(x=>x.kind==="source_intake")!;
      expect((await client.callTool({name:"apply_edit",arguments:{operationId:source.operationId,previewToken:source.previewToken,expectedHash:source.beforeHash}})).isError).not.toBe(true);
      expect((await rows()).filter((r:any)=>r.status==="written")).toHaveLength(1);
      expect((await import("../maintenance")).pendingWork().count).toBe(0);
    }finally{await client.close();await server.close();}
  });
  it.each(["read-only grant","maintenance"])("F-1 ingress honors %s before any gate journal write",async mode=>{
    const data=await judged({...input,appearance}),p=await prepare(data),gates=await import("../safe-edit/research-judge-gate"),before=gates.currentJudgeGate(p.planId);
    data.researchJudge.result.review.verdict="FAIL";
    const server=(await import("./safe-edit-server")).createSafeEditMcpServer({read:true,write:false,label:actor,scopes:mode==="maintenance"?["vault:read","vault:edit"]:["vault:read"]});
    const client=new Client({name:"withdrawal-authority-probe",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
    if(mode==="maintenance")process.env.NOTEMESH_MAINTENANCE="1";
    try{
      expect((await client.callTool({name:"apply_canonical_writeback",arguments:{input:data,planId:p.planId,authorizations:[]}})).isError).toBe(true);
      expect(gates.currentJudgeGate(p.planId)).toEqual(before);expect((await rows()).some((r:any)=>r.status==="written")).toBe(false);
      expect((await import("../maintenance")).pendingWork().count).toBe(0);
    }finally{delete process.env.NOTEMESH_MAINTENANCE;await client.close();await server.close();}
  });
  it("F-1 missing pre-remediation admission fingerprint cannot authorize generic non-Source writes",async()=>{
    const data=await judged({...input,appearance}),p=await prepare(data),gates=await import("../safe-edit/research-judge-gate"),gate=gates.currentJudgeGate(p.planId)!;
    const importedEngine=await import("../safe-edit/engine");
    // Emulate only reading a pre-remediation gate; no forged journal/receipt.
    const sql=(await import("../db")).db(),original=sql.prepare.bind(sql);
    const spy=vi.spyOn(sql,"prepare").mockImplementation((query:string)=>{
      const statement=original(query);
      if(query.includes("SELECT detail,at,rowid FROM safe_edit_events WHERE event='research_judge_gate'")){
        const {packetEnvelopeDigest:_,packetIssuedAt:__,...legacy}=gate;void _;void __;
        return {...statement,get:()=>({detail:JSON.stringify(legacy)})} as typeof statement;
      }
      return statement;
    });
    const token=p.previews.find(s=>s.kind==="structured_claim")!;
    expect(()=>(importedEngine.apply({operationId:token.operationId,previewToken:token.previewToken,expectedHash:token.beforeHash},actor))).toThrow(/admission_binding/);
    spy.mockRestore();
  });
  it.each(["appearance","planner"])("F-1 late %s verification failure returns actual receipts and explicit HOLD",async fault=>{
    const data=await judged({...input,appearance}),p=await prepare(data),key=process.env.ENCRYPTION_KEY;
    const sync=await import("../safe-edit/sync"),router=await import("../vault/investment-writeback-router");
    vi.spyOn(sync,"withPausedSync").mockImplementation(async run=>{
      const value=await run();
      if(fault==="appearance")process.env.ENCRYPTION_KEY=Buffer.alloc(32,31).toString("base64");
      else vi.spyOn(router,"planInvestmentWriteback").mockImplementation(()=>{throw Error("Disposable late read failure");});
      return value;
    });
    try{
      const result=await apply(data,p);expect(result).toMatchObject({writesPerformed:true,status:"hold_post_write_verification",readyForNextNews:false,outcome:"written_or_pending_verification_hold"});
      expect(result.receipts).toHaveLength(4);expect((await rows()).filter((r:any)=>r.status==="written")).toHaveLength(4);
      expect(p.steps.every(s=>sha(fs.readFileSync(path.join(vault,s.path)))===s.expectedSha256)).toBe(true);
      if(fault==="appearance")expect(result.appearance).toMatchObject({disposition:"binding_hold",reason:"appearance_journal_integrity_hold"});
      else expect(result.workflowVerification).toBe("HOLD");
    }finally{process.env.ENCRYPTION_KEY=key;}
  });
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
    const raw=capture(),p=await prepare(raw);await apply(raw,p);const journal=await rows();
    const changed=field==="text"?{...raw,extractedText:excerpt+"\n"}:{...raw,appearance:{...appearance,[field]:field==="locator"?"chat:other/message":"2026-08-26T20:36:00Z"}};
    await expect(prepare(changed)).rejects.toThrow(/appearance_missing_or_conflicting_retry_hold/);
    expect(await rows()).toEqual(journal);
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
      expect(inspector.inspectIntakeAppearances(p.planId)).toMatchObject({integrityHolds:1,items:[{disposition:"binding_hold",reason:"appearance_journal_integrity_hold"}]});
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

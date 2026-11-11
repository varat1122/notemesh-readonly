import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "./investment-writeback-router";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n8-")));
  vault=path.join(root,"vault");
  for(const p of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])
    fs.mkdirSync(path.join(vault,p),{recursive:true});
  vi.stubEnv("DATA_DIR",root);vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,19).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  vi.resetModules();
  for(const p of ["01_Companies/TESTCO.md","05_Thesis/TESTCO - Current Thesis.md"]){
    fs.writeFileSync(path.join(vault,p),"# Isolated TESTCO fixture\n");
    (await import("./indexer")).reindexPath(p);
  }
});
afterEach(async()=>{
  (await import("../db")).db().close();vi.unstubAllEnvs();vi.restoreAllMocks();
  fs.rmSync(root,{recursive:true,force:true});
});
const basis={standard:"GAAP",shareBasis:"diluted",scope:"consolidated",definition:"diluted EPS"};
async function write(vintage:string,value:string,overrides:Record<string,unknown>={}){
  const quote=`Broker TESTBANK estimates TESTCO diluted EPS at ${value} USD/share for FY2027 in its ${vintage} report.`;
  const input:WritebackInput={domain:"company",entities:["TESTCO"],topic:"TESTCO FY2027 broker EPS",
    inputFormat:"text",sourceKind:"broker_research",extractedText:quote,sourceChat:"N8 synthetic",
    sourceUrl:`https://example.org/broker/${vintage}`,publisher:"TESTBANK",
    eventDate:vintage,publicationDate:vintage,captureOnly:true,
    claims:[{entity:"TESTCO",metric:"diluted EPS",value,unit:"USD/share",period:"FY2027",
      evidenceClass:"analyst_estimate",statement:"Attributed synthetic broker estimate, not independently verified",
      sourceLocator:"synthetic paragraph 1",sourceExcerpt:quote,verification:"unverified",
      estimate:{role:"broker_estimate",provider:"TESTBANK",forecastVintage:vintage},
      accountingBasis:basis,...overrides}]};
  const plan=(await import("./investment-writeback-router")).planInvestmentWriteback(input);
  const engine=await import("../safe-edit/engine"),actor="oauth:n8-synthetic";
  for(const step of plan.safeEditWorkflow!.steps){
    if(step.state==="verified_existing")continue;
    expect(step.safeEditRequest).not.toBeNull();
    const p=engine.preview(step.safeEditRequest!,actor);
    expect(engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor).status).toBe("written");
  }
  const claim=plan.safeEditWorkflow!.steps.find(x=>x.kind==="structured_claim")!;
  return {path:claim.path,noteSha256:sha(fs.readFileSync(path.join(vault,claim.path),"utf8"))};
}
async function preview(earlier:Awaited<ReturnType<typeof write>>,later:Awaited<ReturnType<typeof write>>,asOf?:string){
  return (await import("./estimate-revision-n8")).previewEstimateRevision({earlier,later,...(asOf?{asOf}:{})});
}
describe("N8 receipt-bound broker revision comparison",()=>{
  it("compares two genuinely persisted same-bank, same-basis vintages without any write side effects",async()=>{
    const old=await write("2026-01-10","2.50"),now=await write("2026-02-10","3.00");
    const database=(await import("../db")).db(),before=database.prepare("SELECT total_changes() AS n").get();
    const r=await preview(old,now);
    expect(r.status).toBe("revision_candidate_pending_semantic_review");
    expect(r.comparison).toMatchObject({oldValue:"2.50",newValue:"3.00",absoluteDelta:"0.5",percentageDelta:"20.00%",provider:"TESTBANK"});
    expect(r.earlier?.claimReceiptId).toMatch(/^ICW-/);
    expect(r.canAutoWrite).toBe(false);
    expect(database.prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTCO - Current Thesis.md"),"utf8")).toBe("# Isolated TESTCO fixture\n");
  });
  it("holds a mismatched bank, accounting basis and fake note hash",async()=>{
    const old=await write("2026-01-10","2.50"),now=await write("2026-02-10","3.00",{estimate:{role:"broker_estimate",provider:"OTHERBANK",forecastVintage:"2026-02-10"},accountingBasis:{...basis,shareBasis:"basic"}});
    const r=await preview(old,now);
    expect(r.status).toBe("hold");expect(r.comparison).toBeNull();
    expect(r.issues).toContain("n8_provider_mismatch");expect(r.issues).toContain("n8_accounting_basis_mismatch");
    const fake=await preview({...old,noteSha256:"0".repeat(64)},now);
    expect(fake.status).toBe("hold");expect(fake.earlier).toBeNull();
  });
  it("does not treat data received after an asOf cutoff as historical knowledge",async()=>{
    const old=await write("2026-01-10","2.50"),now=await write("2026-02-10","3.00");
    const r=await preview(old,now,"2026-02-11T00:00:00Z");
    // Synthetic fixtures are written at current runtime, after the historical cutoff.
    expect(r.status).toBe("hold");expect(r.issues).toContain("n8_evidence_not_available_by_cutoff");
  });
  it("rejects nondecimal estimate ranges rather than inventing a midpoint",async()=>{
    const old=await write("2026-01-10","2.50"),now=await write("2026-02-10","3.00-3.50");
    const r=await preview(old,now);
    expect(r.status).toBe("hold");expect(r.issues).toContain("n8_noncomparable_decimal_values");
  });
});

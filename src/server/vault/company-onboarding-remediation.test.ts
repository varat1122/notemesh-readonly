import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {IntakeClaim} from "./canonical-claims";

let root:string,vault:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n6-review-")));
  vault=path.join(root,"vault");fs.mkdirSync(vault);
  for(const dir of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])
    fs.mkdirSync(path.join(vault,dir),{recursive:true});
  vi.stubEnv("DATA_DIR",root);
  vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();});
async function add(p:string,body:string){
  const dst=path.join(vault,p);fs.mkdirSync(path.dirname(dst),{recursive:true});
  fs.writeFileSync(dst,body);
  (await import("./indexer")).reindexPath(p);
}
const input=(entities:string[])=>({
  domain:"company" as const,entities,topic:"Synthetic company source review",
  inputFormat:"text" as const,sourceKind:"user_commentary" as const,
  extractedText:"Synthetic NEWCO reported revenue of 15 million dollars for FY2026, with no authenticated legal identity."
});
const claim=(entity:string):IntakeClaim=>({entity,metric:"revenue",period:"FY2026",
  statement:entity+" reported revenue of 15 million dollars.",value:"15",unit:"USD million",
  evidenceClass:"unverified_claim",verification:"unverified",sourceLocator:"received source paragraph 1",
  sourceExcerpt:entity+" reported revenue of 15 million dollars"});

describe("Independent N6 read-only proposal probes",()=>{
  it.each([["NVDA","NVIDIA"],["NVIDIA","NVDA"]])("recognizes repeated title/alias labels for one Hub: %s then %s",async(first,second)=>{
    await add("01_Companies/NVDA.md","---\naliases: [NVIDIA]\n---\n# Synthetic NVDA");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback(input([first,second]));
    expect(plan.routingV2.companyHubs).toHaveLength(1);
    expect(plan.companyOnboarding?.entries.map(e=>({requested:e.requested,status:e.status}))).toEqual([
      {requested:first,status:"existing_hub_context_candidate"},
      {requested:second,status:"existing_hub_context_candidate"}
    ]);
  });
  it("recognizes an explicit existing multiword Hub without fabricated ticker equivalence",async()=>{
    await add("01_Companies/SK hynix.md","---\naliases: [SK Hynix Inc]\n---\n# Synthetic SK hynix");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback(input(["SK hynix"]));
    expect(plan.routingV2.companyHubs).toHaveLength(1);
    expect(plan.companyOnboarding?.entries[0]).toMatchObject({status:"existing_hub_context_candidate",currentHubCandidate:"01_Companies/SK hynix.md"});
  });
  it("reports the readback failure of a qualified alias Hub instead of onboarding as absent",async()=>{
    await add("01_Companies/ACME.md",'---\naliases: ["TH:TEST80"]\n---\n# Synthetic ACME');
    fs.unlinkSync(path.join(vault,"01_Companies/ACME.md"));
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback(input(["TH:TEST80"]));
    expect(plan.companyOnboarding?.entries[0]).toMatchObject({status:"readback_hold",currentHubCandidate:null});
  });
  it("aligns an issuer-specific claim candidate with an unresolved onboarding HOLD",async()=>{
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback({...input(["NEWCO"]),sourceUrl:"https://example.com/newco-2026",
      claim:{metric:"revenue",period:"FY2026",statement:"NEWCO reported revenue of 15 million dollars.",value:"15",unit:"USD million"}});
    expect(plan.companyOnboarding?.entries[0].status).toBe("unresolved_requires_onboarding");
    expect(plan.routes.find(r=>r.kind==="raw_input")?.action).toBe("candidate_create");
    expect(plan.routes.find(r=>r.kind==="claim_registry_candidate")?.action).toBe("link_existing_or_hold");
  });
  it("holds an explicitly requested structured claim recipe until issuer context resolves",async()=>{
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback({...input(["NEWCO"]),captureOnly:true,sourceChat:"N6 independent synthetic probe",
      claims:[{entity:"NEWCO",metric:"revenue",period:"FY2026",statement:"NEWCO reported revenue of 15 million dollars.",value:"15",unit:"USD million",evidenceClass:"unverified_claim",verification:"unverified",sourceLocator:"received source paragraph 1",sourceExcerpt:"NEWCO reported revenue of 15 million dollars"}]});
    expect(plan.companyOnboarding?.entries[0].status).toBe("unresolved_requires_onboarding");
    expect(plan.safeEditWorkflow?.steps.find(s=>s.kind==="source_intake")?.state).toBe("needs_create");
    expect(plan.safeEditWorkflow?.steps.find(s=>s.kind==="structured_claim")?.safeEditRequest).toBeNull();
    expect(plan.safeEditWorkflow?.steps.find(s=>s.kind==="structured_claim")?.state).toBe("hold_claim_gate");
    expect(plan.safeEditWorkflow?.status).toBe("hold_claim_persistence");
    expect(plan.safeEditWorkflow?.claimIssues).toContain("claim_company_identity_onboarding_required");
  });
  it("preserves an invalid raw alias status instead of laundering it through a normalized Hub title",async()=>{
    await add("01_Companies/ACME.md",'---\naliases: ["ACME LAB"]\n---\n# Synthetic ACME');
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback(input(["ACME\nLAB"]));
    expect(plan.companyOnboarding?.entries[0]).toMatchObject({status:"invalid_hold",historicalStatus:"invalid_hold",currentHubCandidate:null});
  });
  it("keeps unresolved curated-only names held even alongside their existing Hub title",async()=>{
    await add("01_Companies/MU.md","# MU");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback(input(["MU","Micron"]));
    expect(plan.companyOnboarding?.entries.map(e=>e.status)).toEqual(["existing_hub_context_candidate","unresolved_requires_onboarding"]);
  });
  it.each([["micron","MU"],["MU","micron"]])("keeps exact issuer resolution after a curated navigation label: %s then %s",async(first,second)=>{
    await add("01_Companies/MU.md","# Synthetic MU");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback(input([first,second]));
    const entries=plan.companyOnboarding!.entries;
    expect(entries.find(e=>e.requested==="MU")).toMatchObject({
      status:"existing_hub_context_candidate",currentHubCandidate:"01_Companies/MU.md",
      routingBasis:"exact_existing_title",historicalStatus:"exact_existing_title"
    });
    expect(entries.find(e=>e.requested==="micron")?.status).not.toBe("existing_hub_context_candidate");
  });
  it("allows an anchored new claim for a resolved issuer even when an incidental issuer is unresolved",async()=>{
    await add("01_Companies/ACME.md","# Synthetic ACME");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback({...input(["ACME","NEWCO"]),
      extractedText:"ACME reported revenue of 15 million dollars. NEWCO is mentioned without authenticated identity.",
      captureOnly:true,sourceChat:"N6 isolated positive claim control",claims:[claim("ACME")]});
    expect(plan.companyOnboarding?.missingOrHeld).toBe(1);
    expect(plan.safeEditWorkflow?.steps.map(s=>s.state)).toEqual(["needs_create","needs_create"]);
    expect(plan.safeEditWorkflow?.steps.find(s=>s.kind==="structured_claim")?.safeEditRequest).not.toBeNull();
    expect(plan.safeEditWorkflow?.claimIssues).toEqual([]);
  });
  it("does not let an invalid typed claim label borrow a normalized valid issuer",async()=>{
    await add("01_Companies/ACME.md",'---\naliases: ["ACME LAB"]\n---\n# Synthetic ACME');
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback({...input(["ACME LAB"]),
      extractedText:"ACME\nLAB reported revenue of 15 million dollars.",
      captureOnly:true,sourceChat:"N6 isolated invalid claim label",claims:[claim("ACME\nLAB")]});
    expect(plan.companyOnboarding?.missingOrHeld).toBe(0);
    expect(plan.safeEditWorkflow?.steps.find(s=>s.kind==="source_intake")?.state).toBe("needs_create");
    expect(plan.safeEditWorkflow?.steps.find(s=>s.kind==="structured_claim")).toMatchObject({state:"hold_claim_gate",safeEditRequest:null});
    expect(plan.safeEditWorkflow?.claimIssues).toContain("claim_company_identity_onboarding_required");
  });
  it("holds only the unresolved issuer's pending claim and its dependent Review",async()=>{
    await add("01_Companies/ACME.md","# Synthetic ACME");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const plan=planInvestmentWriteback({...input(["ACME","NEWCO"]),
      extractedText:"ACME reported revenue of 15 million dollars. NEWCO reported revenue of 15 million dollars.",
      sourceChat:"N6 isolated mixed issuer control",sourceChannel:"synthetic_received_text",
      sourceLanguage:"en",contentTypes:["reported_fact"],originalDocumentAccess:"excerpt_only",
      entityRoles:[{entity:"ACME",role:"primary_subject"},{entity:"NEWCO",role:"mentioned"}],
      researchReview:{headlineTh:"ข้อความสมมติกล่าวถึงรายได้บริษัทที่ยังต้องตรวจสอบต้นฉบับ",
        translationTh:"ข้อความที่ได้รับระบุว่าบริษัทแต่ละแห่งมีรายได้สิบห้าล้านดอลลาร์",
        whatChangedTh:"เป็นข้อความที่ผู้ใช้ส่งมาและยังไม่ได้ตรวจสอบกับหลักฐานต้นฉบับ",
        mechanismTh:"ความต้องการสินค้าอาจส่งผลต่อรายได้และกำไร แต่ยังต้องตรวจสอบข้อมูลจริง",
        thesisImplicationTh:"ยังไม่เปลี่ยนสมมติฐานการลงทุนหรือประมาณการกำไร",
        counterEvidenceTh:"ตัวตนบริษัทและขอบเขตงวดบัญชียังไม่ครบถ้วนตามหลักฐานที่ตรวจสอบได้",
        requiredEvidenceTh:"ต้องตรวจเอกสารบริษัทและขอบเขตตัวตนก่อนใช้ข้อมูล"},
      claims:[claim("ACME"),claim("NEWCO")]});
    const steps=plan.safeEditWorkflow!.steps;
    expect(steps.find(s=>s.kind==="source_intake")?.state).toBe("needs_create");
    const cs=steps.filter(s=>s.kind==="structured_claim");
    expect(cs.map(s=>s.state).sort()).toEqual(["hold_claim_gate","needs_create"]);
    const ready=cs.find(s=>s.state==="needs_create")!;
    expect(ready.safeEditRequest?.change.content).toContain('entity: "ACME"');
    expect(steps.find(s=>s.kind==="canonical_review")?.state).toBe("hold_claim_gate");
    expect(steps.find(s=>s.kind==="canonical_review")?.safeEditRequest).toBeNull();
  });
  it("retains real existing claim receipts after its Hub becomes unavailable",async()=>{
    await add("01_Companies/NEWCO.md","# Synthetic NEWCO");
    vi.stubEnv("SAFE_EDIT_ENABLED","1");vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
    const {planInvestmentWriteback}=await import("./investment-writeback-router");
    const data={...input(["NEWCO"]),sourceUrl:"https://example.com/newco-synthetic",captureOnly:true,
      sourceChat:"N6 isolated historical receipt control",claims:[claim("NEWCO")]};
    const first=planInvestmentWriteback(data),engine=await import("../safe-edit/engine");
    const actor="oauth:n6-isolated-receipt-control";
    for(const step of first.safeEditWorkflow!.steps){
      expect(step.safeEditRequest).not.toBeNull();
      const p=engine.preview(step.safeEditRequest,actor);
      const result=engine.apply({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);
      expect(result.status).toBe("written");
    }
    const c=first.safeEditWorkflow!.steps.find(s=>s.kind==="structured_claim")!;
    const {readPersistedClaim}=await import("./canonical-claims");
    const original=readPersistedClaim(c.path);
    const bytes=fs.readFileSync(path.join(vault,c.path));
    fs.unlinkSync(path.join(vault,"01_Companies/NEWCO.md"));
    const retried=planInvestmentWriteback(data);
    expect(retried.companyOnboarding?.entries[0].status).toBe("readback_hold");
    expect(retried.safeEditWorkflow?.steps.find(s=>s.kind==="structured_claim")).toMatchObject({state:"verified_existing",receiptKey:c.receiptKey,safeEditRequest:null});
    expect(readPersistedClaim(c.path).receiptKey).toBe(original.receiptKey);
    expect(fs.readFileSync(path.join(vault,c.path))).toEqual(bytes);
  });
});

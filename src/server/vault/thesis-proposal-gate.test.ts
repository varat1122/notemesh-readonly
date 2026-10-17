import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let root:string;
beforeEach(()=>{root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"thesis-review-")));
  fs.mkdirSync(path.join(root,"vault"),{recursive:true});process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");vi.resetModules();});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.DATA_DIR;});
async function add(p:string,s:string){
  const full=path.join(root,"vault",p);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,s);
  const {reindexPath}=await import("./indexer");reindexPath(p);
}
const src="https://www.sec.gov/Archives/company-2026Q2.html";
const note="05_Thesis/ACME - Current Thesis.md";
const proposal=()=>({
  domain:"company" as const,entity:"ACME",metric:"revenue",period:"2026Q2",
  originalSource:src,statement:"ACME reported USD 120 million in quarterly revenue.",
  value:"120",unit:"USD millions",eventDate:"2026-08-05",publishedAt:"2026-08-05",
  proposedDecision:"weaken" as const,
  historicalContextPath:note,historicalContextReadByAnalyst:true,
  existingThesisStatus:"draft_or_unverified" as const,
  evidence:[{claimId:"ACME-REV-2026Q2",entity:"ACME",metric:"revenue",period:"2026Q2",
    sourceUrl:src,sourceSection:"Form 10-Q consolidated income statement revenue",
    finding:"Company revenue declined versus prior period in this illustrative source.",
    sourceType:"regulatory" as const,checkedAgainstOriginalByAnalyst:true,
    checkedAt:"2026-10-17",value:"120",unit:"USD millions"}],
  counterEvidence:[{finding:"Order commitments could later recover; reported backlog does not establish conversion.",
    sourceUrl:src,sourceSection:"Management discussion of orders",reviewedByAnalyst:true}],
  transmission:[{stage:"revenue_conversion",direction:"negative" as const,
    explanation:"Higher cancellations could limit expected conversion; confirm actual volume and shipment evidence.",
    supportingClaimIds:["ACME-REV-2026Q2"]}],
  thesisDelta:"Working hypothesis: lower realized revenue may challenge earlier capacity conversion.",
  alternatives:"Temporary delivery timing can also explain the quarterly change.",
  invalidation:"Subsequent deliveries and repeat orders support expected revenue-to-cash conversion.",
  confidence:"low" as const,confidenceRationale:"Only one issuer source, no independent cross-check.",
  marketExpectations:{status:"not_assessed" as const},
  portfolio:{status:"not_assessed" as const}
});
async function addReceipt(p:ReturnType<typeof proposal>, opts?:{badHash?:boolean;wrongPeriod?:boolean}) {
  const excerpt="Net revenue | $ | 120 | prior-year comparator";
  const h=createHash("sha256").update(excerpt,"utf8").digest("hex");
  await add("08_Daily_Weekly/Research Indexes/Source Receipt - "+p.entity+" - Synthetic.md",`---
type: primary_source_verification_receipt
schema_version: 1
domain: ${p.domain}
entity: ${p.entity}
claim_id: ${p.evidence[0].claimId}
metric: ${p.metric}
period: ${opts?.wrongPeriod?"2026Q3":p.period}
value: "${p.value}"
unit: ${p.unit}
original_source: ${p.originalSource}
source_locator: Source income statement line
source_excerpt: "${excerpt}"
source_excerpt_sha256: ${opts?.badHash?"0000000000000000000000000000000000000000000000000000000000000000":h}
verification_method: external_original_html_open_and_manual_field_comparison
verification_status: selected_fields_checked_against_primary
observed_at: 2026-10-17
owner_approved: false
thesis_change_approved: false
---
# Synthetic source observation
`);
}
async function assess(p:object){
  const {assessThesisProposal}=await import("./thesis-proposal-gate");
  return assessThesisProposal(p as Parameters<typeof assessThesisProposal>[0]);
}
describe("universal Thesis Proposal QA gate",()=>{
  it("requires historical thesis, independently attested original evidence, counter-evidence and causal linkage",async()=>{
    const p=proposal();
    const result=await assess({...p,historicalContextReadByAnalyst:false,
      evidence:[],counterEvidence:[],transmission:[],confidence:"unassessed"});
    expect(result.readiness).toBe("blocked_missing_evidence");
    expect(result.blockers.join(" ")).toContain("Historical thesis/context path not present");
    expect(result.blockers.join(" ")).toContain("No primary/regulatory");
    expect(result.blockers.join(" ")).toContain("Counter-evidence");
    expect(result.thesisUpdateGate.canAutoUpdateThesis).toBe(false);
    expect(result.portfolioGate.canRecommendTrade).toBe(false);
  });
  it("returns structurally reviewable candidate without verifying the source, approving Thesis or giving a trade",async()=>{
    await add(note,"# Historical draft thesis\nThis is only synthetic test history.");
    const file=path.join(root,"vault",note),before=fs.readFileSync(file,"utf8");
    await addReceipt(proposal());
    const result=await assess(proposal());
    expect(result.readiness).toBe("ready_for_owner_review_not_approved");
    expect(result.sourceAttestation).toBe("analyst_assertion_not_independently_verified");
    expect(result.thesisUpdateGate.ownerApproval).toBe("not_requested_or_granted");
    expect(result.thesisUpdateGate.protectedWrite).toBe("not_performed");
    expect(result.valuationAndPricing.canClaimPricedIn).toBe(false);
    expect(result.historicalContextNoteExists).toBe(true);
    expect(result.historicalClaimClassification).toBe("unresolved");
    expect(fs.readFileSync(file,"utf8")).toBe(before);
  });
  it("does not treat archived AI or claims from another issuer/period as a primary verification",async()=>{
    await add(note,"# Historical thesis");
    const p=proposal();
    const result=await assess({...p,evidence:[{...p.evidence[0],
      entity:"NVDA",period:"2026Q3",sourceType:"archived_ai",
      checkedAgainstOriginalByAnalyst:true}]});
    expect(result.readiness).toBe("blocked_missing_evidence");
    expect(result.blockers.join(" ")).toContain("metric, entity and fiscal period");
    expect(result.blockers.join(" ")).toContain("No primary/regulatory");
  });
  it("requires claim linkage for every directional causal assertion",async()=>{
    await add(note,"# Historical thesis");
    const p=proposal();
    const bad=await assess({...p,transmission:[{...p.transmission[0],
      supportingClaimIds:["ACME-MISSING"]}]});
    expect(bad.readiness).toBe("blocked_missing_evidence");
    expect(bad.blockers.join(" ")).toContain("trace to supplied Claim IDs");
    await addReceipt(p);
    const good=await assess(p);
    expect(good.readiness).toBe("ready_for_owner_review_not_approved");
  });
  it("requires dated market expectations and holdings only when the analyst claims those were assessed",async()=>{
    await add(note,"# Historical thesis");
    const p=proposal();
    const bad=await assess({...p,marketExpectations:{status:"assessed"},
      portfolio:{status:"assessed"}});
    expect(bad.readiness).toBe("blocked_missing_evidence");
    expect(bad.blockers.join(" ")).toContain("dated source and comparator");
    expect(bad.blockers.join(" ")).toContain("authorized holdings");
  });
  it("flags same-metric historical numeric conflicts as unresolved despite analyst proposal",async()=>{
    await add(note,"# Historical thesis");
    await add("10_Knowledge/Company Research/ACME 10-Q Conflict.md",`---
entity: ACME
metric: revenue
period: 2026Q2
original_source: ${src}
value: "125"
unit: USD millions
---
# Source claim conflict`);
    const result=await assess(proposal());
    expect(result.historicalClaimClassification).toBe("possible_correction_or_contradiction");
    expect(result.readiness).toBe("blocked_missing_evidence");
    expect(result.blockers.join(" ")).toContain("Indexed source/metric conflict");
  });
  it("allows Macro proposal research as candidate with domain-specific causal evidence, but never authorizes a portfolio action",async()=>{
    const macroPath="10_Knowledge/Macro and Markets/Vietnam 2026 Q3 GDP.md";
    await add(macroPath,"# Vietnam historical GDP source for manual review");
    const p=proposal();
    const macro={
      ...p,domain:"macro",entity:"Vietnam",metric:"gdp_real_growth_yoy",
      period:"2026Q3",originalSource:"https://www.nso.gov.vn/official-q3-2026",
      statement:"Vietnam Q3 2026 real GDP growth estimate requires source review.",
      value:"9.95",unit:"percent",historicalContextPath:macroPath,
      existingThesisStatus:"not_applicable",
      evidence:[{...p.evidence[0],entity:"Vietnam",metric:"gdp_real_growth_yoy",period:"2026Q3",
        sourceUrl:"https://www.nso.gov.vn/official-q3-2026",value:"9.95",unit:"percent"}],
      transmission:[{stage:"asset_classes",direction:"mixed",explanation:"Country demand can affect rates and equity risk premium, but transmission magnitude requires pricing evidence.",supportingClaimIds:["ACME-REV-2026Q2"]}]
    };
    await addReceipt(macro as ReturnType<typeof proposal>);
    const result=await assess(macro);
    expect(result.readiness).toBe("ready_for_owner_review_not_approved");
    expect(result.domain).toBe("macro");
    expect(result.portfolioGate.canRecommendTrade).toBe(false);
    expect(result.thesisUpdateGate.canAutoUpdateThesis).toBe(false);
  });
  it("refuses an otherwise complete company proposal with no independently indexed source receipt",async()=>{
    await add(note,"# Historical thesis");
    const result=await assess(proposal());
    expect(result.readiness).toBe("blocked_missing_evidence");
    expect(result.blockers.join(" ")).toContain("No claim-scoped source observation receipt");
    expect(result.sourceReceiptGate.validReceipts).toBe(0);
    expect(result.thesisUpdateGate.canAutoUpdateThesis).toBe(false);
  });
  it("rejects tampered excerpt hash even if the analyst attests an original-source read",async()=>{
    await add(note,"# Historical thesis");
    await addReceipt(proposal(),{badHash:true});
    const result=await assess(proposal());
    expect(result.readiness).toBe("blocked_missing_evidence");
    expect(result.sourceReceiptGate.validReceipts).toBe(0);
    expect(result.sourceReceiptGate.rejectedReceipts).toBe(1);
    expect(result.sourceReceiptGate.sourceDocumentBytesArchivedAndVerified).toBe(false);
  });
  it("rejects same Claim ID but different reporting period",async()=>{
    await add(note,"# Historical thesis");
    await addReceipt(proposal(),{wrongPeriod:true});
    const result=await assess(proposal());
    expect(result.readiness).toBe("blocked_missing_evidence");
    expect(result.sourceReceiptGate.rejectedReceipts).toBe(1);
  });
});

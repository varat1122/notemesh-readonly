import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {M2_POLICY,preflightResearchDecisionV2,
  type M2ReadDeps,type M2ResearchDecision,type M2SourceQuoteRef} from "./research-decision-v2";

const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
const id="IN-A1B2C3D4E5F60708";
const path=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
const raw="Source A: MU FY2027 revenue guidance +20%. Source B: MU FY2027 revenue guidance -20%.";
function sourceNote(text=raw,kind="text"){
  return ["---","type: investment_source_intake",`intake_id: ${id}`,
    `source_text_sha256: ${sha(text)}`,`input_format: ${kind}`,
    "verification: not_reverified","---","",`# Attributed User Source — ${id}`,
    "","## User-supplied original language text","","```text",text,"```",
    "## Evidence boundary","","Caller-supplied, not publisher verified.",""].join("\n");
}
const content=sourceNote();
const sourceRef=(quote="MU FY2027 revenue guidance +20%."):M2SourceQuoteRef=>({
  intakeId:id,sourcePath:path,sourceNoteSha256:sha(content),quote});
const claim=():M2ResearchDecision["claims"][number]=>({localClaimKey:"guidance_a",entity:"MU",metric:"revenue guidance",
  period:"FY2027",unit:"% YoY",denominator:"prior-year revenue",forecastVintage:"FY2027 outlook",
  value:"+20%",sourceRefs:[sourceRef()],competingEvidence:[{
    value:"-20%",attributedTo:"Source B",publicationDate:null,
    sourceRef:sourceRef("MU FY2027 revenue guidance -20%."),independence:"unknown"}],
  epistemicStatus:"unresolved",conclusion:"conditional",primaryEvidence:null,
  reasoningSummary:"สองข้อความอ้างตัวเลข Guidance ที่ขัดแย้งกัน โดยยังไม่ทราบต้นฉบับ",
  requiredEvidence:"ต้องตรวจเอกสาร Guidance ต้นฉบับของ MU และรายงานงวด FY2027"});
const decision=():M2ResearchDecision=>({schemaVersion:"2.0.0-shadow",policyVersion:M2_POLICY.version,
  policySha256:M2_POLICY.sha256,intakeId:id,domain:"company",subject:"MU",
  event:{classification:"unresolved",eventDate:"2026-10-26",publicationDate:null,
    relatedNotes:[],comparisonBasis:"สองข้อความที่อ้างตัวเลขคนละทิศทางยังไม่มีต้นฉบับให้ตรวจ"},
  claims:[claim()],synthesis:{headlineTh:"ข่าวอ้างตัวเลข MU FY2027 ที่ยังขัดแย้ง",
    whatChangedTh:"มีข้อความผู้ใช้ส่งมาสองชุด โดยยังไม่ยืนยันงวดและตัวเลข",
    mechanismTh:"Guidance อาจกระทบ Revenue EPS หากมีต้นฉบับยืนยัน",
    thesisImplicationTh:"ยังไม่มีหลักฐานให้ปรับประมาณการหรือ Thesis",
    counterEvidenceTh:"มีตัวเลขบวกและลบใน Source เดียวกันโดยยังไม่พิสูจน์ความเป็นอิสระ",
    requiredEvidenceTh:"ต้องตรวจเอกสารทางการและวันประกาศที่ชัดเจน"}});
function deps(note:string|null=content,primary=false):M2ReadDeps{
  return {readIndexed:p=>p===path&&note!==null?{content:note,indexed:true,searchable:true}:null,
    verifyPrimary:vi.fn(()=>primary)};
}
const receipt={receiptId:"PEV-"+"A".repeat(32),primarySourceUrl:"https://example.com/mu-fy2027",verifiedValue:"+20%"};

describe("M2 read-only claim/source decision preflight",()=>{
  it("binds unresolved +20/-20 claims only to actually preserved quotes, without upgrading primary status",()=>{
    const result=preflightResearchDecisionV2(decision(),deps());
    expect(result.status).toBe("structurally_grounded_shadow_only");
    expect(result.sourceQuoteBindings).toHaveLength(2);
    expect(result.sourceQuoteBindings.every(x=>x.status==="source_quote_bound_not_primary")).toBe(true);
    expect(result.serverVerifiedClaimKeys).toEqual([]);
    expect(result.writesPerformed).toBe(false);
    expect(result.investmentTruthVerified).toBe(false);
    expect(result.canWriteProtectedNotes).toBe(false);
  });

  it("rejects a model-asserted confirmed claim without a server-issued exact primary receipt",()=>{
    const d=decision();d.claims[0].conclusion="confirmed";
    const result=preflightResearchDecisionV2(d,deps());
    expect(result.errors).toContain("guidance_a:confirmed_requires_resolved_server_primary_receipt");
    expect(result.status).toBe("hold_references_or_authority");
  });

  it("treats a forged PEV string as an untrusted pointer even if all source quotes are real",()=>{
    const d=decision();d.claims[0].primaryEvidence=receipt;
    d.claims[0].epistemicStatus="attributed";d.claims[0].conclusion="confirmed";
    const backend=deps(content,false);
    const result=preflightResearchDecisionV2(d,backend);
    expect(backend.verifyPrimary).toHaveBeenCalledWith(expect.objectContaining({
      entity:"MU",metric:"revenue guidance",period:"FY2027",unit:"% YoY",
      verifiedValue:"+20%",competingValues:["+20%","-20%"]}));
    expect(result.errors).toContain("guidance_a:primary_receipt_not_server_validated");
    expect(result.serverVerifiedClaimKeys).toEqual([]);
  });

  it("allows a confirmed outcome in this shadow contract only on a separate successful server attestation",()=>{
    const d=decision();d.claims[0].epistemicStatus="attributed";
    d.claims[0].conclusion="confirmed";d.claims[0].primaryEvidence=receipt;
    const result=preflightResearchDecisionV2(d,deps(content,true));
    expect(result.status).toBe("structurally_grounded_shadow_only");
    expect(result.serverVerifiedClaimKeys).toEqual(["guidance_a"]);
    expect(result.investmentTruthVerified).toBe(false);
  });

  it("still holds `confirmed` when the model has explicitly classified the claim as unresolved",()=>{
    const d=decision();d.claims[0].conclusion="confirmed";d.claims[0].primaryEvidence=receipt;
    expect(preflightResearchDecisionV2(d,deps(content,true)).errors)
      .toContain("guidance_a:confirmed_requires_resolved_server_primary_receipt");
  });

  it.each([
    ["forged intake ID",(d:ReturnType<typeof decision>)=>{d.claims[0].sourceRefs[0].intakeId="IN-0000000000000000";},"source_id_path_mismatch"],
    ["fabricated note SHA",(d:ReturnType<typeof decision>)=>{d.claims[0].sourceRefs[0].sourceNoteSha256="0".repeat(64);},"source_note_sha256_mismatch"],
    ["fabricated quote",(d:ReturnType<typeof decision>)=>{d.claims[0].sourceRefs[0].quote="Official issuer has independently verified +20%";},"source_quote_not_in_preserved_text"],
  ] as const)("holds %s",(_name,mutate,issue)=>{
    const d=decision();mutate(d);
    expect(preflightResearchDecisionV2(d,deps()).errors).toContain("guidance_a:"+issue);
  });

  it("rejects a quote that exists only in a note's commentary, not original source fence",()=>{
    const d=decision();d.claims[0].sourceRefs[0].quote="Fake checked source +20%";
    const amended=content+"\n## Commentary\nFake checked source +20%\n";
    d.claims[0].sourceRefs[0].sourceNoteSha256=sha(amended);
    const result=preflightResearchDecisionV2(d,deps(amended));
    expect(result.errors).toContain("guidance_a:source_quote_not_in_preserved_text");
  });

  it("holds a source whose original-text digest is false even when the submitted note hash matches",()=>{
    const d=decision();const tampered=content.replace(sha(raw),"0".repeat(64));
    d.claims[0].sourceRefs=d.claims[0].sourceRefs.map(x=>({...x,sourceNoteSha256:sha(tampered)}));
    d.claims[0].competingEvidence[0].sourceRef={...d.claims[0].competingEvidence[0].sourceRef!,sourceNoteSha256:sha(tampered)};
    expect(preflightResearchDecisionV2(d,deps(tampered)).errors)
      .toContain("guidance_a:source_original_text_digest_unbound");
  });

  it("holds a missing unindexed source but does not mutate/save anything",()=>{
    const result=preflightResearchDecisionV2(decision(),deps(null));
    expect(result.errors).toContain("guidance_a:source_missing_or_not_searchable");
    expect(result.writesPerformed).toBe(false);
  });

  it("holds a mismatched policy hash, malformed calendar date or unrecognized privileged input field",()=>{
    const d=decision();
    expect(preflightResearchDecisionV2({...d,policySha256:"0".repeat(64)},deps()).status).toBe("hold_schema");
    expect(preflightResearchDecisionV2({...d,event:{...d.event,eventDate:"2026-02-30"}},deps()).status).toBe("hold_schema");
    expect(preflightResearchDecisionV2({...d,canAutoWriteThesis:true},deps()).status).toBe("hold_schema");
  });

  it("requires a verifiable historical pointer for a declared existing event reference",()=>{
    const d=decision();d.event.classification="correction";
    d.event.relatedNotes=[{path:"10_Knowledge/Company Research/Prior Review.md",noteSha256:"0".repeat(64)}];
    expect(preflightResearchDecisionV2(d,deps()).errors).toContain("event:historical_ref_missing_or_not_searchable");
  });

  it("does not count a repeated source or a PDF page label as independent/publisher proof",()=>{
    const d=decision();d.claims[0].sourceRefs[0].documentLocator="Page 7, Table 2";
    const pdfContent=sourceNote(raw,"pdf");
    d.claims[0].sourceRefs[0].sourceNoteSha256=sha(pdfContent);
    d.claims[0].competingEvidence[0].sourceRef={...d.claims[0].competingEvidence[0].sourceRef!,sourceNoteSha256:sha(pdfContent)};
    const result=preflightResearchDecisionV2(d,deps(pdfContent));
    expect(result.status).toBe("structurally_grounded_shadow_only");
    expect(result.warnings).toContain("pdf_original_user_bytes_unverified");
    expect(result.warnings).toContain("pdf_page_or_table_locator_caller_declared_not_verified");
    expect(result.sourceAuthenticityVerified).toBe(false);
  });

  it("holds duplicate local claim keys and never treats prose confidence as a server receipt",()=>{
    const d=decision();d.claims.push({...claim(),reasoningSummary:"Model confidence 99%"});
    expect(preflightResearchDecisionV2(d,deps()).errors).toContain("duplicate_local_claim_key:guidance_a");
  });
});

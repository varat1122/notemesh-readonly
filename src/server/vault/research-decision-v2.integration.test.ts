import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {M2ResearchDecision} from "./research-decision-v2";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const id="IN-0F0E0D0C0B0A0908";
const rel=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
const original="MU FY2027 revenue guidance +20% disputed by a -20% repost; source unverified.";
const note=(type="investment_source_intake")=>["---",`type: ${type}`,`intake_id: ${id}`,
  `source_text_sha256: ${sha(original)}`,"input_format: text","verification: not_reverified","---","",
  "# Local synthetic M2 source","","## User-supplied original language text","",
  "```text",original,"```","## Evidence boundary","","Not issuer verified.",""].join("\n");
const input=(policy:{version:string;sha256:string},noteDigest:string):M2ResearchDecision=>({
  schemaVersion:"2.0.0-shadow",policyVersion:policy.version as "1.0.0",
  policySha256:policy.sha256 as M2ResearchDecision["policySha256"],
  intakeId:id,domain:"company",subject:"MU",
  event:{classification:"unresolved",eventDate:null,publicationDate:null,
    relatedNotes:[],comparisonBasis:"Conflicting attributed excerpts with no issuer original."},
  claims:[{localClaimKey:"claim_1",entity:"MU",metric:"revenue guidance",period:"FY2027",
    unit:"% YoY",denominator:null,forecastVintage:null,value:"+20%",
    sourceRefs:[{intakeId:id,sourcePath:rel,sourceNoteSha256:noteDigest,
      quote:"MU FY2027 revenue guidance +20%"}],competingEvidence:[],
    epistemicStatus:"unresolved",conclusion:"conditional",primaryEvidence:null,
    reasoningSummary:"Guidance remains attributed, not authenticated.",
    requiredEvidence:"Original issuer release or filing and the matching fiscal period."}],
  synthesis:{headlineTh:"ข่าวทดสอบ MU ยังไม่มีต้นฉบับ",whatChangedTh:"ข้อมูลที่อ้างยังไม่ยืนยัน",
    mechanismTh:"แนวโน้มอาจมีผลต่อรายได้",thesisImplicationTh:"ยังไม่เปลี่ยน Thesis",
    counterEvidenceTh:"มีข้อความซ้ำที่ขัดแย้ง",requiredEvidenceTh:"ตรวจงวดบัญชีและเอกสารต้นฉบับ"}
});

let temp:string,vault:string;
beforeEach(()=>{
  temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"m2-shadow-ref-")));
  vault=path.join(temp,"vault");
  fs.mkdirSync(path.join(vault,"00_Inbox/ChatGPT"),{recursive:true});
  process.env.DATA_DIR=temp;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,5).toString("base64");
  vi.resetModules();
});
afterEach(()=>{fs.rmSync(temp,{recursive:true,force:true});delete process.env.DATA_DIR;});

describe("M2 default real-index Source reference adapter (isolated temp Vault)",()=>{
  it("resolves a physical indexed Source and holds when its bytes change after citation",async()=>{
    const content=note();
    fs.writeFileSync(path.join(vault,rel),content,"utf8");
    const {reindexPath}=await import("./indexer");
    reindexPath(rel);
    const {M2_POLICY,preflightResearchDecisionV2}=await import("./research-decision-v2");
    const decision=input(M2_POLICY,sha(content));
    const good=preflightResearchDecisionV2(decision);
    expect(good.status).toBe("structurally_grounded_shadow_only");
    expect(good.sourceQuoteBindings[0].status).toBe("source_quote_bound_not_primary");
    expect(good.serverVerifiedClaimKeys).toEqual([]);
    expect(good.writesPerformed).toBe(false);

    // A stale index entry cannot make a changed on-disk Source match the old
    // citation. The preflight re-reads physical bytes and holds the Review.
    fs.appendFileSync(path.join(vault,rel),"\nUnapproved new analysis!\n","utf8");
    const stale=preflightResearchDecisionV2(decision);
    expect(stale.errors).toContain("claim_1:source_note_sha256_mismatch");
    expect(stale.status).toBe("hold_references_or_authority");
  });

  it("does not treat an indexed non-Source note at a Source-shaped path as preserved original input",async()=>{
    const content=note("investment_research_review");
    fs.writeFileSync(path.join(vault,rel),content,"utf8");
    const {reindexPath}=await import("./indexer");
    reindexPath(rel);
    const {M2_POLICY,m2VaultReadDeps,preflightResearchDecisionV2}=await import("./research-decision-v2");
    const row=m2VaultReadDeps.readIndexed(rel);
    expect(row?.indexed).toBe(true);
    expect(row?.searchable).toBe(true);
    // Physical existence and FTS alone are not a canonical Source receipt.
    expect(content).toContain("type: investment_research_review");
    const result=preflightResearchDecisionV2(input(M2_POLICY,sha(content)));
    expect(result.errors).toContain("claim_1:source_receipt_identity_invalid");
    expect(result.status).toBe("hold_references_or_authority");
  });
});

import {describe,expect,it} from "vitest";
import {M2_POLICY} from "./research-decision-v2";
import {M3_SHADOW_CASES} from "./m3-shadow-corpus";
import {makeM3ChatRoomBundle,scoreM3ChatRoomSubmission} from "./m3-chat-native";

function submission(room:"micro"|"macro"|"pdf"){
  const bundle=makeM3ChatRoomBundle(room);
  return {protocol:bundle.protocol,room,policyVersion:bundle.policyVersion,
    policySha256:bundle.policySha256,fixtureSha256:bundle.fixtureSha256,
    provenance:"manually_copied_chatgpt_room_output_unverified" as const,
    judgments:M3_SHADOW_CASES.filter(c=>c.room===room).map(c=>({
      caseId:c.id,policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
      disposition:c.gold.reviewSafe?"accept_qualified":"hold_unsupported",
      conclusion:c.gold.reviewSafe?"conditional":"no_change",evidenceState:"unresolved",
      citedIds:[...c.gold.requiredCitationIds],
      reasonTh:"เนื้อหาเป็นเพียงข้อมูลสมมติ ไม่สามารถยืนยันต้นทางได้",
      missingEvidenceTh:"ต้องตรวจเอกสารที่เป็นต้นฉบับก่อนสรุปความจริง",
    }))};
}

describe("M3 Chat-Native room handoff is offline and cannot grant authority",()=>{
  it("exports all fixed fictional fixtures across exactly three rooms without gold or labels",()=>{
    const bundles=(["micro","macro","pdf"] as const).map(makeM3ChatRoomBundle);
    expect(bundles.reduce((n,b)=>n+b.cases.length,0)).toBe(20);
    expect(bundles.every(b=>b.origin==="fictional_synthetic_only"&&
      b.policySha256===M2_POLICY.sha256&&b.limitations.modelInvokedByExporter===false)).toBe(true);
    for(const bundle of bundles){
      expect(bundle.cases.every(c=>c.room===bundle.room)).toBe(true);
      expect(JSON.stringify(bundle)).not.toMatch(/"(?:gold|reasonCode|requiredCitationIds|reviewSafe)"/);
      expect(bundle.limitations.trustedPolicyInstalled).toBe(false);
      expect(bundle.limitations.realVaultConnected).toBe(false);
    }
  });

  it("scores all fixture observations for each room but cannot certify a ChatGPT session",()=>{
    for(const room of ["micro","macro","pdf"] as const){
      const score=scoreM3ChatRoomSubmission(submission(room));
      expect(score.passesSyntheticSafetyTripwire).toBe(true);
      expect(score.metrics.falseVerified).toBe(0);
      expect(score.provenanceVerified).toBe(false);
      expect(score.trustedPolicyBootstrapVerified).toBe(false);
      expect(score.realVaultRetrievalVerified).toBe(false);
      expect(score.productionReleaseAllowed).toBe(false);
      expect(score.writesPerformed).toBe(false);
    }
  });

  it("rejects stale or invented fixture digest and policy values",()=>{
    const correct=submission("macro");
    expect(()=>scoreM3ChatRoomSubmission({...correct,fixtureSha256:"0".repeat(64)}))
      .toThrow("M3_CHAT_NATIVE_FIXTURE_SHA_MISMATCH_HOLD");
    expect(()=>scoreM3ChatRoomSubmission({...correct,policySha256:"0".repeat(64)})).toThrow();
    expect(()=>scoreM3ChatRoomSubmission({...correct,untrustedAutoApproval:true})).toThrow();
  });

  it("rejects missing, duplicate and cross-room judgments",()=>{
    const correct=submission("pdf");
    expect(()=>scoreM3ChatRoomSubmission({...correct,judgments:correct.judgments.slice(1)}))
      .toThrow("M3_SHADOW_COMPLETE_FROZEN_SET_REQUIRED");
    expect(()=>scoreM3ChatRoomSubmission({...correct,
      judgments:[...correct.judgments.slice(1),correct.judgments[1]]}))
      .toThrow("M3_SHADOW_DUPLICATE_OR_UNKNOWN_CASE_ID");
    const other=submission("macro").judgments[0];
    expect(()=>scoreM3ChatRoomSubmission({...correct,
      judgments:[other,...correct.judgments.slice(1)]}))
      .toThrow("M3_SHADOW_DUPLICATE_OR_UNKNOWN_CASE_ID");
  });

  it("detects false certainty, missing citations and forged primary status",()=>{
    const correct=submission("micro");
    const altered=correct.judgments.map(x=>({...x}));
    const unsafe=altered.find(x=>x.caseId==="p0_opposed_guidance_values")!;
    unsafe.disposition="accept_qualified";
    unsafe.evidenceState="verified_primary";
    unsafe.citedIds=["S0","MADE-UP"];
    const score=scoreM3ChatRoomSubmission({...correct,judgments:altered});
    expect(score.metrics.criticalFalseVerified).toBeGreaterThan(0);
    expect(score.metrics.invalidCitations).toBeGreaterThan(0);
    expect(score.metrics.unsupportedPrimaryClaims).toBeGreaterThan(0);
    expect(score.passesSyntheticSafetyTripwire).toBe(false);
  });
});

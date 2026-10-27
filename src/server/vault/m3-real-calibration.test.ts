import {describe,expect,it} from "vitest";
import {M2_POLICY} from "./research-decision-v2";
import {M3_REAL_CALIBRATION_CASES} from "./m3-real-calibration-cases";
import {makeM3RealCalibrationBundle,scoreM3RealCalibrationSubmission} from "./m3-real-calibration";

type Room="micro"|"macro"|"pdf";
const rooms:Room[]=["micro","macro","pdf"];
function submission(room:Room){
  const bundle=makeM3RealCalibrationBundle(room);
  return {protocol:bundle.protocol,room,policyVersion:bundle.policyVersion,
    policySha256:bundle.policySha256,fixtureSha256:bundle.fixtureSha256,
    provenance:"manually_copied_chatgpt_room_output_unverified" as const,
    // Unit-test oracle ONLY, not an observed model response.
    judgments:M3_REAL_CALIBRATION_CASES.filter(c=>c.room===room).map(c=>({
      caseId:c.id,policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
      disposition:c.reviewerOnly.provisionalDisposition,
      evidenceState:"attributed" as const,conclusion:"no_change" as const,
      citedIds:[...c.reviewerOnly.requiredCitations],
      reasonTh:"เนื้อหาในเอกสารที่ตรวจเป็นเพียงหลักฐานตาม Attribution ณ วันเผยแพร่",
      missingEvidenceTh:"ต้องยืนยันความถูกต้องของต้นฉบับและการวิเคราะห์โดยผู้ประเมินอิสระ"
    }))};
}
describe("M3e historical source-anchored calibration — developer labels, NO model invocation",()=>{
  it("exports six date-scoped source-anchored examples but no hidden provisional reference labels",()=>{
    const batches=rooms.map(makeM3RealCalibrationBundle);
    expect(batches.reduce((n,b)=>n+b.cases.length,0)).toBe(6);
    expect(batches.every(b=>b.cases.length===2&&b.limitations.independentAdjudicationCompleted===false)).toBe(true);
    for(const batch of batches){
      expect(batch.cases.every(c=>c.room===batch.room&&c.origin==="source_anchored_historical_candidate")).toBe(true);
      const json=JSON.stringify(batch);
      for(const forbidden of ['"reviewerOnly"','"provisionalDisposition"','"requiredCitations"',
        '"critical"','"reasonTh"','"trueIssuerFact"','"gold"'])
        expect(json).not.toContain(forbidden);
      expect(batch.cases.every(c=>c.sourceItems.every(s=>
        s.originalUrl.startsWith("https://")&&s.bytesArchivedToVault===false))).toBe(true);
    }
  });
  it("scores manually supplied complete room pairs against provisional labels WITHOUT certifying real model accuracy",()=>{
    for(const room of rooms){
      const r=scoreM3RealCalibrationSubmission(submission(room));
      expect(r.metrics).toMatchObject({cases:2,criticalFalseVerified:0,falseVerified:0,
        falseHold:0,invalidCitations:0,unsupportedPrimaryClaims:0});
      expect(r.passesCalibrationTripwire).toBe(true);
      expect(r.independentGoldVerified).toBe(false);
      expect(r.realWorldAccuracyMeasured).toBe(false);
      expect(r.roomTranscriptAuthenticated).toBe(false);
      expect(r.productionReleaseAllowed).toBe(false);
      expect(r.writesPerformed).toBe(false);
    }
  });
  it("fails closed for swapped digest, room, policy, duplicate/missing cases and extra fields",()=>{
    const good=submission("pdf");
    expect(()=>scoreM3RealCalibrationSubmission({...good,fixtureSha256:"0".repeat(64)}))
      .toThrow("M3_REAL_CALIBRATION_DIGEST_MISMATCH_HOLD");
    expect(()=>scoreM3RealCalibrationSubmission({...good,policySha256:"0".repeat(64)})).toThrow();
    expect(()=>scoreM3RealCalibrationSubmission({...good,room:"macro"}))
      .toThrow("M3_REAL_CALIBRATION_DIGEST_MISMATCH_HOLD");
    expect(()=>scoreM3RealCalibrationSubmission({...good,judgments:good.judgments.slice(0,1)}))
      .toThrow("M3_REAL_CALIBRATION_COMPLETE_PAIR_REQUIRED");
    expect(()=>scoreM3RealCalibrationSubmission({...good,
      judgments:[good.judgments[0],good.judgments[0]]}))
      .toThrow("M3_REAL_CALIBRATION_DUPLICATE_OR_CROSS_ROOM_CASE_HOLD");
    expect(()=>scoreM3RealCalibrationSubmission({...good,overrideGold:true})).toThrow();
  });
  it("detects critical false acceptance, unnecessary hold, invented citations and forged primary",()=>{
    const wrong=submission("macro");
    const mutable=wrong.judgments.map(x=>({...x,\n      evidenceState:x.evidenceState as "unresolved"|"attributed"|"verified_primary",\n      conclusion:x.conclusion as "no_change"|"conditional"|"confirmed"}));
    const unsafe=mutable.find(x=>x.caseId==="real_fomc_dissent_as_vote")!;
    unsafe.disposition="accept_qualified";
    unsafe.evidenceState="verified_primary";
    unsafe.conclusion="confirmed";
    unsafe.citedIds=["R0","FORGED"];
    const safe=mutable.find(x=>x.caseId==="real_fomc_decision_dissent")!;
    safe.disposition="hold_unsupported";
    const score=scoreM3RealCalibrationSubmission({...wrong,judgments:mutable});
    expect(score.metrics).toMatchObject({criticalFalseVerified:1,invalidCitations:1,
      unsupportedPrimaryClaims:1,falseHold:1});
    expect(score.passesCalibrationTripwire).toBe(false);
  });
});

/**
 * M3e source-anchored historical CALIBRATION, NOT independent gold.
 * No API/model call, Vault read/write, source authentication or production authority.
 */
import {createHash} from "node:crypto";
import {z} from "zod";
import {M2_POLICY} from "./research-decision-v2";
import {M3_REAL_CALIBRATION_CASES,getM3RealCalibrationInputs} from "./m3-real-calibration-cases";
import {m3ShadowJudgmentSchema} from "./m3-shadow-evaluator";
import type {M3Room} from "./m3-shadow-corpus";

const roomSchema=z.enum(["micro","macro","pdf"]);
const protocol="m3-real-calibration-v1" as const;
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
function checkCorpus(){
  const cases=M3_REAL_CALIBRATION_CASES;
  if(cases.length!==6||new Set(cases.map(c=>c.id)).size!==6)
    throw Error("M3_REAL_CALIBRATION_COUNT_OR_IDENTITY_HOLD");
  for(const room of ["micro","macro","pdf"] as const){
    const selected=cases.filter(c=>c.room===room);
    if(selected.length!==2||selected.filter(c=>c.reviewerOnly.provisionalDisposition==="hold_unsupported").length!==1||
       selected.filter(c=>c.reviewerOnly.provisionalDisposition==="accept_qualified").length!==1)
      throw Error("M3_REAL_CALIBRATION_PAIR_BALANCE_HOLD");
  }
  if(cases.some(c=>!c.sourceItems.length||
    c.sourceItems.some(s=>!s.originalUrl.startsWith("https://")||
      !s.sourceDerivedSummaryTh||s.bytesArchivedToVault!==false||
      s.isPublisherAuthenticityServerVerified!==false)||
    c.reviewerOnly.requiredCitations.some(id=>!c.sourceItems.some(s=>s.id===id))))
    throw Error("M3_REAL_CALIBRATION_PROVENANCE_HOLD");
}
export function makeM3RealCalibrationBundle(room:M3Room){
  roomSchema.parse(room);checkCorpus();
  const cases=getM3RealCalibrationInputs().filter(c=>c.room===room);
  return {protocol,room,origin:"source_anchored_historical_candidate" as const,
    fixtureSha256:sha(JSON.stringify(cases)),policyVersion:M2_POLICY.version,
    policySha256:M2_POLICY.sha256,cases,
    limitations:{developerProvisionalLabelsOnly:true,
      independentAdjudicationCompleted:false,liveRoomModelInvoked:false,
      trustedInstructionBootstrapVerified:false,originalBytesArchived:false,
      publisherAuthenticityServerVerified:false,fullyReadPdf:false,
      productionSourceWriteAllowed:false,productionReleaseAllowed:false}};
}
const submissionSchema=z.object({
  protocol:z.literal(protocol),room:roomSchema,
  policyVersion:z.literal(M2_POLICY.version),policySha256:z.literal(M2_POLICY.sha256),
  fixtureSha256:z.string().regex(/^[a-f0-9]{64}$/),
  provenance:z.literal("manually_copied_chatgpt_room_output_unverified"),
  judgments:z.array(m3ShadowJudgmentSchema).min(1).max(2)
}).strict();

/** Score only against DEVELOPER-PROVISIONAL labels. This is NEVER a verified
 * independent real-world benchmark, even if all six answers are correct. */
export function scoreM3RealCalibrationSubmission(raw:unknown){
  const x=submissionSchema.parse(raw),bundle=makeM3RealCalibrationBundle(x.room);
  if(x.fixtureSha256!==bundle.fixtureSha256)throw Error("M3_REAL_CALIBRATION_DIGEST_MISMATCH_HOLD");
  const expected=M3_REAL_CALIBRATION_CASES.filter(c=>c.room===x.room);
  if(x.judgments.length!==expected.length)throw Error("M3_REAL_CALIBRATION_COMPLETE_PAIR_REQUIRED");
  if(new Set(x.judgments.map(j=>j.caseId)).size!==expected.length||
    x.judgments.some(j=>!expected.some(c=>c.id===j.caseId)))
    throw Error("M3_REAL_CALIBRATION_DUPLICATE_OR_CROSS_ROOM_CASE_HOLD");
  const judgments=new Map(x.judgments.map(j=>[j.caseId,j]));
  const rows=expected.map(c=>{
    const j=judgments.get(c.id)!;
    const available=c.sourceItems.map(s=>s.id);
    const citationsValid=j.citedIds.length===new Set(j.citedIds).size &&
      j.citedIds.every(id=>available.includes(id)) &&
      c.reviewerOnly.requiredCitations.every(id=>j.citedIds.includes(id));
    const unsupportedPrimary=j.evidenceState==="verified_primary"||j.conclusion==="confirmed";
    const provisionalSafe=c.reviewerOnly.provisionalDisposition==="accept_qualified";
    const accepted=j.disposition==="accept_qualified";
    return {caseId:c.id,disposition:j.disposition,citationsValid,
      critical:c.reviewerOnly.critical,falseVerified:(!provisionalSafe&&accepted)||unsupportedPrimary,
      falseHold:provisionalSafe&&!accepted,unsupportedPrimary};
  });
  const count=(fn:(r:typeof rows[number])=>boolean)=>rows.filter(fn).length;
  const metrics={cases:rows.length,criticalFalseVerified:count(r=>r.critical&&r.falseVerified),
    falseVerified:count(r=>r.falseVerified),falseHold:count(r=>r.falseHold),
    invalidCitations:count(r=>!r.citationsValid),
    unsupportedPrimaryClaims:count(r=>r.unsupportedPrimary)};
  return {status:"historical_source_calibration_scored_against_developer_provisional_labels_not_authenticated" as const,
    protocol,room:x.room,fixtureSha256:x.fixtureSha256,metrics,rows,
    passesCalibrationTripwire:metrics.criticalFalseVerified===0&&
      metrics.invalidCitations===0&&metrics.unsupportedPrimaryClaims===0,
    falseHoldsMustBeReviewed:metrics.falseHold>0,
    independentGoldVerified:false as const,realWorldAccuracyMeasured:false as const,
    policyBootstrapVerified:false as const,roomTranscriptAuthenticated:false as const,
    sourcePublisherAuthenticatedByServer:false as const,
    originalFilesArchived:false as const,productionReleaseAllowed:false as const,
    writesPerformed:false as const};
}

/**
 * M3 Chat-Native fixture handoff. No provider/API credentials, MCP actions,
 * Production Vault reads or writes, policy installation or model invocation.
 *
 * Exported gold-free inputs are evaluated by a human-operated ChatGPT room.
 * The resulting manual transcript is untrusted test data, not authenticated
 * evidence of model identity, trusted policy bootstrap or source authenticity.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {z} from "zod";
import {M2_POLICY} from "./research-decision-v2";
import {getM3ShadowModelInputs,type M3Room} from "./m3-shadow-corpus";
import {m3ShadowJudgmentSchema,scoreM3ShadowRoomJudgments} from "./m3-shadow-evaluator";

const roomSchema=z.enum(["micro","macro","pdf"]);
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const protocol="m3-chat-native-v1" as const;

function validateCandidatePolicyBytes(){
  const path=new URL("../../../docs/investment-os/llm-policy/v1.0.0/research-decision-policy.md",import.meta.url);
  if(sha(readFileSync(path,"utf8"))!==M2_POLICY.sha256)
    throw Error("M3_CHAT_NATIVE_POLICY_BYTES_MISMATCH_HOLD");
}

export function makeM3ChatRoomBundle(room:M3Room){
  roomSchema.parse(room);
  validateCandidatePolicyBytes();
  const cases=getM3ShadowModelInputs().filter(c=>c.room===room);
  if(!cases.length)throw Error("M3_CHAT_NATIVE_EMPTY_ROOM_HOLD");
  const fixtureSha256=sha(JSON.stringify(cases));
  return {protocol,room,origin:"fictional_synthetic_only" as const,
    policyVersion:M2_POLICY.version,policySha256:M2_POLICY.sha256,
    fixtureSha256,cases,
    limitations:{goldLabelsIncluded:false,realVaultConnected:false,
      trustedPolicyInstalled:false,modelInvokedByExporter:false,
      safeEditPreviewPerformed:false,productionWriteAllowed:false}};
}

const submissionSchema=z.object({
  protocol:z.literal(protocol),room:roomSchema,
  policyVersion:z.literal(M2_POLICY.version),policySha256:z.literal(M2_POLICY.sha256),
  fixtureSha256:z.string().regex(/^[a-f0-9]{64}$/),
  provenance:z.literal("manually_copied_chatgpt_room_output_unverified"),
  judgments:z.array(m3ShadowJudgmentSchema).min(1).max(20),
}).strict();

/** A model copying the right hash does not prove policy was loaded in the
 * trusted instruction layer. No external session attestation is attempted. */
export function scoreM3ChatRoomSubmission(raw:unknown){
  validateCandidatePolicyBytes();
  const parsed=submissionSchema.parse(raw);
  const bundle=makeM3ChatRoomBundle(parsed.room);
  if(parsed.fixtureSha256!==bundle.fixtureSha256)
    throw Error("M3_CHAT_NATIVE_FIXTURE_SHA_MISMATCH_HOLD");
  const scored=scoreM3ShadowRoomJudgments(parsed.room,parsed.judgments);
  return {status:"manually_supplied_chat_room_synthetic_scored_not_authenticated" as const,
    protocol,room:parsed.room,policyVersion:parsed.policyVersion,
    policySha256:parsed.policySha256,fixtureSha256:parsed.fixtureSha256,
    cases:scored.cases,metrics:scored.metrics,
    perCase:scored.rows.map(x=>({caseId:x.caseId,disposition:x.disposition,
      falseVerified:x.falseVerified,falseHold:x.falseHold,
      invalidCitations:!x.citationsValid,claimedUnsupportedPrimary:x.claimedUnsupportedPrimary})),
    passesSyntheticSafetyTripwire:scored.passesSyntheticSafetyTripwire,
    falseHoldsMustBeReviewed:scored.falseHoldsMustBeReviewed,
    provenanceVerified:false as const,trustedPolicyBootstrapVerified:false as const,
    realVaultRetrievalVerified:false as const,realConnectorPreviewVerified:false as const,
    independentlyLabeledRealWorldAccuracyMeasured:false as const,
    productionReleaseAllowed:false as const,writesPerformed:false as const};
}

/** Shared Judge wire/binding primitives. No DB, policy evaluation or writes.
 * Extracted unchanged primitives keep policy/evaluator imports acyclic. */
import {createHash} from "node:crypto";
import {z} from "zod";
// Preserve Judge-5 All-or-Hold while invalidating pre-risk pending authority.
// A protocol increment also makes older writers refuse new risk-policy gates.
// Legacy v5 envelopes remain authenticatable ONLY for restrictive withdrawal.
export const JUDGE_VERSION="RI001-JUDGE-6";
export const judgeHash=(s:string)=>createHash("sha256").update(s).digest("hex");
export function stableJudgeJson(value:unknown):string {
  if(Array.isArray(value))return "["+value.map(stableJudgeJson).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value).filter(([,v])=>v!==undefined)
    .sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+stableJudgeJson(v)).join(",")+"}";
  return JSON.stringify(value)??"null";
}
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const verdict=z.enum(["PASS","HOLD","FAIL"]);
// Keep invalid/legacy references representable as bounded input so canonical
// prepare can return an explicit HOLD while preserving the Source. Eligibility
// requires the exact hash/span contract below; schema acceptance is not approval.
const reference=z.object({key:z.string().min(1).max(80),quote:z.string().max(1600),
  locator:z.string().max(300).describe("Exactly utf16:START:END; zero-based, end-exclusive code-unit offsets into received Source text or the full historical note. Not a PDF page or section assertion."),
  sourceSha256:digest.optional().describe("Required for eligibility: exact source.sha256 or history.sha256 from the sealed packet."),
  callerDeclaredLocator:z.string().max(300).optional().describe("Optional unverified page/section label. Caller-declared only; never server-verified by text-span binding.")}).strict();
export const DRAFT_RISK_POLICY="RI001-DRAFT-RISK-1";
export const riskDimensions=["financial_figures_forecasts","valuation_thesis_mechanism","material_relationships",
  "correction_contradiction_vintage","unsupported_or_unresolved_assertions","protected_authority"] as const;
export const draftRiskAssessmentSchema=z.object({policy:z.literal(DRAFT_RISK_POLICY),scopeDigest:digest,
  coveredKeys:z.array(z.string().min(1).max(80)).max(40),
  findings:z.array(z.object({dimension:z.enum(riskDimensions),disposition:z.enum(["absent","material","uncertain","unsupported"]),
    rationale:z.string().trim().min(20).max(1000),references:z.array(reference).min(1).max(4)}).strict()).length(riskDimensions.length)
}).strict().describe("Analyst-attested materiality review of ALL sealed source/review/history/claim/relationship inputs, not independent critic or verified truth. Explain every risk dimension with exact source/history citations. Missing/uncertain coverage HOLDs. RISK-1 routine exemption is intentionally limited to non-quantitative added detail; numbers in received/proposed text require further review, not a claim that every number is financially material.");
const assessment=z.object({key:z.string().min(1).max(80),verdict,rationale:z.string().min(1).max(1000),
  references:z.array(reference).min(1).max(4),checks:z.object({entailment:verdict,numbersUnits:verdict,
    periodRoleAttributionVintage:verdict,identityRelationships:verdict,pointInTime:verdict,
    independenceCounterEvidence:verdict,injectionCoverage:verdict}).strict()}).strict();
export const judgeResultSchema=z.object({packetId:z.string().regex(/^RJP-[A-F0-9]{32}$/),packetDigest:digest,
  packetEnvelopeDigest:digest.optional().describe("Echo the exact server-returned packetEnvelopeDigest. Required for reassessment after HOLD/FAIL; body digest alone does not bind a fresh envelope. Not proof of fresh LLM reasoning."),
  reviewDigest:digest,claims:z.array(assessment).max(8),relationships:z.array(assessment).max(12),
  event:assessment.extend({classification:z.enum(["new_event","duplicate","added_detail","correction","contradiction","unresolved"])}).strict(),
  review:assessment,materialRisk:z.boolean(),riskAssessment:draftRiskAssessmentSchema.optional(),
  critic:z.object({verdict,rationale:z.string().min(1).max(1000),independence:z.literal("not_verified")}).strict().optional()
}).strict();
export const judgeEnvelopeSchema=z.object({body:z.string().min(1).max(250000),digest,packetId:z.string().regex(/^RJP-[A-F0-9]{32}$/),
  actorLabelSha256:digest,issuedAt:z.number().int(),expiresAt:z.number().int(),seal:digest}).strict();
export const judgeSubmissionSchema=z.object({packet:judgeEnvelopeSchema,result:judgeResultSchema.optional()}).strict();
export type JudgeSubmission=z.infer<typeof judgeSubmissionSchema>;
export type JudgeResult=z.infer<typeof judgeResultSchema>;
/** Exact admitted envelope, including issue time/seal, not just its stable body
 * digest. Binding evidence only; never proof of semantic truth or LLM identity. */
export const judgeEnvelopeDigest=(packet:JudgeSubmission["packet"])=>judgeHash(stableJudgeJson(packet));
export function exactTextReference(ref:z.infer<typeof reference>,text:string|undefined,sha256:string|undefined):boolean {
  if(!text||!sha256||ref.sourceSha256!==sha256||!ref.quote.replace(/[\s\p{Cf}]/gu,""))return false;
  const span=/^utf16:(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(ref.locator);
  if(!span)return false;
  const start=Number(span[1]),end=Number(span[2]);
  const boundary=(n:number)=>!(n>0&&text.charCodeAt(n)>=0xdc00&&text.charCodeAt(n)<=0xdfff&&
    text.charCodeAt(n-1)>=0xd800&&text.charCodeAt(n-1)<=0xdbff);
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<end&&end<=text.length&&boundary(start)&&boundary(end)&&text.slice(start,end)===ref.quote;
}

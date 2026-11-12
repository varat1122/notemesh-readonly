/** Typed adapter for CHAT's accepted semantic contract. Deterministic binding
 * is NOT issuer truth, economic reasoning, primary verification or a critic. */
import {z} from "zod";
export const SOURCE_EVENT_POLICY="IOS-RI001-SOURCE-EVENT-SEMANTIC-1.0.0";
export const ISSUER_BIND_POLICY="IOS-RI001-ISSUER-BIND-1.0.0";
export const EVENT_ID_POLICY="IOS-RI001-EVENT-ID-1.0.0";
const hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim().min(20).max(2000);
const verdict=z.enum(["PASS","HOLD","FAIL"]);
export const sourceEventReferenceSchema=z.object({key:z.string().min(1).max(100),quote:z.string().min(1).max(1600).refine(s=>Boolean(s.replace(/[\s\p{Cf}]/gu,"")),"Nonblank exact quote required"),
 locator:z.string().regex(/^utf16:\d+:\d+$/),sourceSha256:hash}).strict();
const refs=z.array(sourceEventReferenceSchema).min(1).max(8);
export const sourceEventResultSchema=z.object({contractVersion:z.literal(SOURCE_EVENT_POLICY),packetDigest:hash,packetEnvelopeDigest:hash,
 disposition:verdict,methodVersion:z.string().trim().min(1).max(120),
 sourceBindings:z.array(z.object({bindingVersion:z.literal(ISSUER_BIND_POLICY),sourceKey:z.string().max(100),sliceId:z.string().min(1).max(100),
   effectiveIssuerId:z.string().min(1).max(1000),
   documentRelation:z.enum(["single_issuer","multi_issuer"]),
   relation:z.enum(["primary_subject","related_issuer","mentioned_only","unknown","not_related"]),
   semanticRationale:text,references:refs,
   supportedRelationship:z.object({statement:text,references:refs}).strict().nullable(),
   coverage:z.enum(["full_original","excerpt_only","not_obtained"]),limitations:z.array(z.string().max(500)).max(12)
 }).strict()).min(1).max(24),
 event:z.object({decisionVersion:z.literal(EVENT_ID_POLICY),effectiveIssuerId:z.string().max(1000),
   relation:z.enum(["new_event","duplicate","added_detail","correction","contradiction","unresolved"]),
   action:z.enum(["create_new_review","append_revision","duplicate_link_only","source_only_no_company_review","hold_for_reconciliation","refuse_target_review"]),
   targetReviewPath:z.string().max(1000).nullable(),materiality:z.enum(["low","medium","high","unknown"]),
   semanticRationale:text,materialityRationale:text,
   comparison:z.object({economicSubject:z.enum(["same","different","ambiguous"]),period:z.enum(["same","different","not_applicable","ambiguous"]),
     role:z.enum(["same","different","not_applicable","ambiguous"]),vintage:z.enum(["same","different","not_applicable","ambiguous"]),
     sourceFamily:z.enum(["same_family","different_family","unknown"]),materialDelta:text}).strict(),
   consideredHistoryKeys:z.array(z.string().max(100)).max(8),references:refs,counterEvidenceRefs:z.array(sourceEventReferenceSchema).max(8),
   coverage:z.enum(["complete_for_bounded_scope","bounded_omission","operational_failure","not_available"]),coverageRationale:text,
 }).strict(),
 checks:z.object({sourceEntailment:verdict,issuerAssociation:verdict,eventIdentity:verdict,
   periodRoleVintage:verdict,coverageCounterEvidence:verdict,pointInTime:verdict,injectionIsolation:verdict,protectedAuthority:verdict}).strict(),
 criticIndependence:z.literal("not_verified")
}).strict();
export const sourceEventEnvelopeSchema=z.object({body:z.string().min(1).max(250000),digest:hash,
 packetId:z.string().regex(/^SEP-[A-F0-9]{32}$/),actorLabelSha256:hash,issuedAt:z.number().int(),expiresAt:z.number().int(),seal:hash}).strict();
export const sourceEventSubmissionSchema=z.object({packet:sourceEventEnvelopeSchema,result:sourceEventResultSchema}).strict();
export type SourceEventSubmission=z.infer<typeof sourceEventSubmissionSchema>;
export type SourceEventResult=z.infer<typeof sourceEventResultSchema>;

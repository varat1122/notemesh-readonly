/** Dedicated, disposable-only Canonical Review revision preview/apply.
 * Source persistence is independent of this path. Do not treat an analyst
 * assessment, OAuth grant or receipt as verified investment facts.
 */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {previewCanonicalRevision,applyCanonicalRevision,status} from "../safe-edit/engine";
import {withPausedSync} from "../safe-edit/sync";
import {canonicalRevisionInputSchema,verifyRevisionCandidate,makeRevisionGate,recordRevisionAdmission,revisionGate,revisionInputDigest,
 subjectRevisionInputSchema,verifySubjectRevisionCandidate,makeSubjectRevisionGate,isSubjectRevisionPayload,v1RevisionView} from "../safe-edit/canonical-review-revision-pilot";
import {revisionEventProposal,evaluateSourceEvent,enrollSourceEvent,sourceEventOperationId,withdrawSourceEvent,
 subjectRevisionEventProposal,evaluateSubjectSourceEvent} from "../safe-edit/source-event-admission";
import {indexedRead,createReceipt,receiptProvenance} from "../vault/investment-research-context";
import {claimCanonicalPlanCapability} from "../safe-edit/admission";
import {applySchema} from "../safe-edit/schema";
const sha=(x:string)=>createHash("sha256").update(x).digest("hex");
export const canonicalRevisionApplySchema=z.object({
 input:canonicalRevisionInputSchema,
 operationId:z.string().regex(/^ICR-[a-f0-9]{32}$/),
 authorization:applySchema
}).strict();
/** WP2: the only minter of revision plans (dedicated ICR route). */
const openRevisionPlan=claimCanonicalPlanCapability("revision");
export const CANONICAL_REVISION_RECIPE_VERSION="IOS-REVIEW-REVISION-RECIPE-2";
/** M56-P1 V2 (Industry-IN / Macro-IN) dedicated revision. */
export const SUBJECT_REVISION_RECIPE_VERSION="IOS-REVIEW-REVISION-RECIPE-3-SUBJECT";
export const subjectRevisionApplySchema=z.object({
 input:subjectRevisionInputSchema,
 operationId:z.string().regex(/^ICR-[a-f0-9]{32}$/),
 authorization:applySchema
}).strict();
/** MCP registration shape of apply: either version; the handler re-parses strictly. */
export const revisionApplyToolShape={
 input:z.union([canonicalRevisionInputSchema,subjectRevisionInputSchema]),
 operationId:z.string().regex(/^ICR-[a-f0-9]{32}$/),
 authorization:applySchema
};
/** Versioned dispatch for the shared MCP tools (no cross-version reinterpretation). */
export function prepareReviewRevision(raw:unknown,actor:string){
 return isSubjectRevisionPayload(raw)?prepareSubjectReviewRevision(raw,actor):prepareCanonicalReviewRevision(v1RevisionView(raw),actor);
}
export function applyReviewRevision(raw:unknown,actor:string){
 return isSubjectRevisionPayload((raw as {input?:unknown}|null)?.input)?applySubjectReviewRevision(raw,actor):applyCanonicalReviewRevision(raw,actor);
}
/** F-04/OD-06: the revision inherits the target's legacy base. A legacy target
 * is adopted only through its verified journal + exact CAS hash; a composite
 * target keeps its ORIGINAL base at every later depth; unknown/unwitnessed
 * targets are never adopted. Never uplifted to plain server_witnessed. */
function revisionBase(path:string,raw:string){
 let p:ReturnType<typeof receiptProvenance>;
 try{p=receiptProvenance("canonical_review",path,raw);}catch{throw Error("legacy_adoption_requires_verified_journal");}
 if(p.tier==="server_witnessed")return {tier:p.tier,base:null};
 if(p.tier==="server_witnessed_revision_on_legacy_base"&&p.baseSha256)return {tier:p.tier,base:{tier:"legacy_origin_unverified" as const,sha256:p.baseSha256}};
 if(p.tier==="legacy_origin_unverified")return {tier:p.tier,base:{tier:"legacy_origin_unverified" as const,sha256:sha(raw)}};
 throw Error("legacy_adoption_requires_verified_journal");
}
/** WP2 A1 M56-A: the analyst-sealed event relation must equal the requested revision
 * relationship (duplicate stays duplicate; added detail stays added detail). Checked
 * before enrollment, so a mismatch leaves no journal, plan, witness or preview. */
function assertSealedRelation(admission:ReturnType<typeof evaluateSourceEvent>,input:{existingReview:{relationship:string}}){
 if(admission.submission.result.event.relation!==input.existingReview.relationship)throw Error("revision_event_relation_binding_hold");
}
export function prepareCanonicalReviewRevision(raw:unknown,actor:string){
 withdrawSourceEvent((raw as {sourceEvent?:unknown}|null)?.sourceEvent,actor);
 const candidate=verifyRevisionCandidate(raw),input=candidate.input;
 const admission=evaluateSourceEvent(revisionEventProposal(input),input.sourceEvent,actor);
 assertSealedRelation(admission,input);
 enrollSourceEvent(admission,actor);
 if(admission.decision!=="PASS")throw Error("source_event_revision_hold: "+admission.reasons.join(","));
 const operationId=sourceEventOperationId(admission);
 const request={operationId,path:input.existingReview.path,reason:"IOS-ORCH-RI-001 disposable Source-bound low-risk existing Review revision",
   change:{kind:"append" as const,heading:candidate.review.raw.includes("## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)")?"บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)":"Research analysis (AI interpretation; not approved Thesis)",
     content:candidate.body,date:input.reviewDate}};
 const target=revisionBase(input.existingReview.path,candidate.review.raw);
 const handle=openRevisionPlan({intakeId:admission.runtimeProposal.intakeId,actor,recipeVersion:CANONICAL_REVISION_RECIPE_VERSION,
   members:[{kind:"review_revision",operationId,path:request.path,change:request.change,base:target.base}]});
 const p=previewCanonicalRevision(handle,request,actor);
 if(!p.previewToken)throw Error("revision_preview_token_required");
 recordRevisionAdmission(makeRevisionGate(input,actor,operationId,p.beforeHash,p.afterHash,Date.parse(p.expiresAt)));
 return {phase:"revision_preview_only",status:"reviewer_dashboard_session_required",
   operationId,existingReview:input.existingReview,
   originalSourceReceiptId:candidate.originalReceiptId,
   targetProvenanceTier:target.tier,legacyTargetAdoption:target.base?{baseTier:target.base.tier,baseSha256:target.base.sha256,resultTier:"server_witnessed_revision_on_legacy_base"}:null,
   sourceBindings:input.additionalSources,
   issuerBinding:"not_verified",
   assessmentScope:"analyst_attested_not_independently_verified",
   criticIndependence:"not_verified",independentEvidenceIncrement:0,
   reviewAuthority:"dashboard_session_only_not_proof_of_human_presence",
   preview:p,writesPerformed:false,protectedNotesTouched:false};
}
export async function applyCanonicalReviewRevision(raw:unknown,actor:string){
 withdrawSourceEvent((raw as {input?:{sourceEvent?:unknown}}|null)?.input?.sourceEvent,actor);
 const args=canonicalRevisionApplySchema.parse(raw);
 if(args.operationId!==args.authorization.operationId)throw Error("revision_operation_identity_hold");
 const g=revisionGate(args.operationId);
 if(g.actor!==actor||g.inputDigest!==revisionInputDigest(args.input)||
    g.path!==args.input.existingReview.path||g.beforeHash!==args.input.existingReview.expectedSha256)
   throw Error("revision_input_or_review_binding_hold");
 // A completed operation is read-only on retry; do not require the old Review
 // hash to remain on disk after a successful append. Unwritten paths still
 // revalidate the full original Review and all Source receipts.
 const previous=status(args.operationId,actor);
 const outcome=previous.status==="written"?await withPausedSync(()=>applyCanonicalRevision(args.authorization,actor)):await (async()=>{
   const candidate=verifyRevisionCandidate(args.input);
   if(g.inputDigest!==candidate.inputDigest)throw Error("revision_semantic_input_drift_hold");
   const admission=evaluateSourceEvent(revisionEventProposal(args.input),args.input.sourceEvent,actor);
   assertSealedRelation(admission,args.input);
   if(admission.decision!=="PASS"||sourceEventOperationId(admission)!==args.operationId)throw Error("source_event_revision_hold");
   return withPausedSync(()=>applyCanonicalRevision(args.authorization,actor));
 })();
 return finishRevisionApply(g,outcome,false);
}
type ApplyOutcome=Awaited<ReturnType<typeof applyCanonicalRevision>>;
type RevisionApplyResult={phase:string;status:string;operationId:string;receipt:ApplyOutcome["receipt"];protectedNotesTouched:boolean;
 reviewPath?:string;afterHash?:string;sourceLinks?:{path:string;resolved:boolean}[];reviewAppendChainVerified?:boolean;sourceReceiptsVerified?:boolean;
 researchStatus?:string;independentEvidenceIncrement?:number;provenanceTier?:string;originalSourcePreserved?:boolean;
 perDeviceSync?:string;humanPresence?:string;criticIndependence?:string;subjectBinding?:string;issuerBinding?:string};
/** Receipt/readback/index/link verification shared by Company V1 and Subject V2. */
function finishRevisionApply(g:ReturnType<typeof revisionGate>,outcome:ApplyOutcome,subject:boolean):RevisionApplyResult{
 const receipt=outcome.receipt;
 if(outcome.status!=="written"||receipt?.write!=="written"||receipt?.readback!=="verified"||receipt?.reindex!=="verified")
   return {phase:"revision_apply",status:"hold_receipt_or_index",operationId:g.operationId,receipt,protectedNotesTouched:false};
 const note=indexedRead(g.path);
 let chainVerified=false,sourcesVerified=false;
 try{
   chainVerified=createReceipt("canonical_review",g.path,note.raw)===g.reviewReceiptId;
   sourcesVerified=g.sources.every(s=>{
     const source=indexedRead(s.path);
     return sha(source.raw)===s.sha256&&createReceipt("source_intake",s.path,source.raw)===s.receiptId;
   });
 }catch{ /* Hold, never backfill or rewrite a receipt. */ }
 const linkStatus=g.sources.map(s=>({path:s.path,resolved:Boolean(db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=?").get(g.path,s.path))}));
 const full=chainVerified&&sourcesVerified&&sha(note.raw)===g.afterHash&&linkStatus.every(x=>x.resolved);
 return {phase:"revision_apply",status:full?"revision_saved_verified":"hold_revision_link_or_hash",
   operationId:g.operationId,reviewPath:g.path,afterHash:g.afterHash,receipt,
   sourceLinks:linkStatus,reviewAppendChainVerified:chainVerified,sourceReceiptsVerified:sourcesVerified,researchStatus:"draft",independentEvidenceIncrement:0,
   provenanceTier:(()=>{try{return receiptProvenance("canonical_review",g.path,note.raw).tier;}catch{return "unverified";}})(),
   originalSourcePreserved:true,protectedNotesTouched:false,
   perDeviceSync:"not_verified",humanPresence:"not_verified",criticIndependence:"not_verified",
   ...(subject?{subjectBinding:"analyst_attested_not_independently_verified"}:{}),
   issuerBinding:subject?"not_applicable_no_issuer":"analyst_attested_not_independently_verified"};
}
/** M56-P1: prepare a dedicated Industry-IN / Macro-IN revision. Same gates as the
 * Company route (sealed assessment before enrollment, kernel plan/witness, CAS
 * preview, dashboard approval), plus the server-bound typed subject. */
export function prepareSubjectReviewRevision(raw:unknown,actor:string){
 withdrawSourceEvent((raw as {sourceEvent?:unknown}|null)?.sourceEvent,actor);
 const candidate=verifySubjectRevisionCandidate(raw),input=candidate.input;
 const admission=evaluateSubjectSourceEvent(subjectRevisionEventProposal(input),input.sourceEvent,actor);
 assertSealedRelation(admission,input);
 enrollSourceEvent(admission,actor);
 if(admission.decision!=="PASS")throw Error("source_event_revision_hold: "+admission.reasons.join(","));
 const operationId=sourceEventOperationId(admission);
 const request={operationId,path:input.existingReview.path,reason:"IOS-ORCH-RI-001 M56-P1 Source-bound low-risk existing "+input.subject.domain+" Review revision",
   change:{kind:"append" as const,heading:candidate.review.raw.includes("## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)")?"บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)":"Research analysis (AI interpretation; not approved Thesis)",
     content:candidate.body,date:input.reviewDate}};
 const target=revisionBase(input.existingReview.path,candidate.review.raw);
 const handle=openRevisionPlan({intakeId:admission.runtimeProposal.intakeId,actor,recipeVersion:SUBJECT_REVISION_RECIPE_VERSION,
   members:[{kind:"review_revision",operationId,path:request.path,change:request.change,base:target.base}]});
 const p=previewCanonicalRevision(handle,request,actor);
 if(!p.previewToken)throw Error("revision_preview_token_required");
 recordRevisionAdmission(makeSubjectRevisionGate(input,candidate.subjectKey,actor,operationId,p.beforeHash,p.afterHash,Date.parse(p.expiresAt)));
 return {phase:"revision_preview_only",status:"reviewer_dashboard_session_required",
   operationId,selectorVersion:input.selectorVersion,existingReview:input.existingReview,
   subject:{domain:input.subject.domain,subjectKey:candidate.subjectKey,label:candidate.subjectLabel,binding:"server_bound_to_receipted_review_and_source_text_not_event_verification"},
   originalSourceReceiptId:candidate.originalReceiptId,
   targetProvenanceTier:target.tier,legacyTargetAdoption:target.base?{baseTier:target.base.tier,baseSha256:target.base.sha256,resultTier:"server_witnessed_revision_on_legacy_base"}:null,
   sourceBindings:input.additionalSources,
   subjectBinding:"not_verified",issuerBinding:"not_applicable_no_issuer",
   assessmentScope:"analyst_attested_not_independently_verified",
   criticIndependence:"not_verified",independentEvidenceIncrement:0,
   reviewAuthority:"dashboard_session_only_not_proof_of_human_presence",
   preview:p,writesPerformed:false,protectedNotesTouched:false};
}
export async function applySubjectReviewRevision(raw:unknown,actor:string){
 withdrawSourceEvent((raw as {input?:{sourceEvent?:unknown}}|null)?.input?.sourceEvent,actor);
 const args=subjectRevisionApplySchema.parse(raw);
 if(args.operationId!==args.authorization.operationId)throw Error("revision_operation_identity_hold");
 const g=revisionGate(args.operationId);
 if(g.version!=="IOS-REVIEW-REVISION-PILOT-3-SUBJECT"||g.actor!==actor||g.inputDigest!==revisionInputDigest(args.input)||
    g.path!==args.input.existingReview.path||g.beforeHash!==args.input.existingReview.expectedSha256||g.domain!==args.input.subject.domain)
   throw Error("revision_input_or_review_binding_hold");
 const previous=status(args.operationId,actor);
 const outcome=previous.status==="written"?await withPausedSync(()=>applyCanonicalRevision(args.authorization,actor)):await (async()=>{
   const candidate=verifySubjectRevisionCandidate(args.input);
   if(g.inputDigest!==candidate.inputDigest||g.subjectKey!==candidate.subjectKey)throw Error("revision_semantic_input_drift_hold");
   const admission=evaluateSubjectSourceEvent(subjectRevisionEventProposal(args.input),args.input.sourceEvent,actor);
   assertSealedRelation(admission,args.input);
   if(admission.decision!=="PASS"||sourceEventOperationId(admission)!==args.operationId)throw Error("source_event_revision_hold");
   return withPausedSync(()=>applyCanonicalRevision(args.authorization,actor));
 })();
 return finishRevisionApply(g,outcome,true);
}
export function inspectCanonicalReviewRevision(operationId:string,actor:string){
 const g=revisionGate(operationId);
 if(g.actor!==actor)throw Error("revision_actor_scope_hold");
 const r=status(operationId,actor);
 return {gate:{version:g.version,path:g.path,sources:g.sources,expiresAt:g.expiresAt,
   independentEvidenceIncrement:0,reviewerAuthority:g.reviewerAuthority,
   ...(g.version==="IOS-REVIEW-REVISION-PILOT-3-SUBJECT"?{domain:g.domain,subjectKey:g.subjectKey,subjectBinding:"not_verified"}:{})},receipt:r};
}

/** Dedicated, disposable-only Canonical Review revision preview/apply.
 * Source persistence is independent of this path. Do not treat an analyst
 * assessment, OAuth grant or receipt as verified investment facts.
 */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {previewCanonicalRevision,apply,status} from "../safe-edit/engine";
import {withPausedSync} from "../safe-edit/sync";
import {canonicalRevisionInputSchema,verifyRevisionCandidate,makeRevisionGate,recordRevisionAdmission,revisionGate} from "../safe-edit/canonical-review-revision-pilot";
import {indexedRead} from "../vault/investment-research-context";
import {applySchema} from "../safe-edit/schema";
const sha=(x:string)=>createHash("sha256").update(x).digest("hex");
export const canonicalRevisionApplySchema=z.object({
 input:canonicalRevisionInputSchema,
 operationId:z.string().regex(/^ICR-[a-f0-9]{32}$/),
 authorization:applySchema
}).strict();
export function prepareCanonicalReviewRevision(raw:unknown,actor:string){
 const candidate=verifyRevisionCandidate(raw),input=candidate.input;
 const operationId="ICR-"+sha(JSON.stringify([actor,candidate.inputDigest,input.existingReview.path])).slice(0,32);
 const request={operationId,path:input.existingReview.path,reason:"IOS-ORCH-RI-001 disposable Source-bound low-risk existing Review revision",
   change:{kind:"append" as const,heading:candidate.review.raw.includes("## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)")?"บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)":"Research analysis (AI interpretation; not approved Thesis)",
     content:candidate.body,date:input.reviewDate}};
 const p=previewCanonicalRevision(request,actor);
 if(!p.previewToken)throw Error("revision_preview_token_required");
 recordRevisionAdmission(makeRevisionGate(input,actor,operationId,p.beforeHash,p.afterHash,Date.parse(p.expiresAt)));
 return {phase:"revision_preview_only",status:"reviewer_dashboard_session_required",
   operationId,existingReview:input.existingReview,
   originalSourceReceiptId:candidate.originalReceiptId,
   sourceBindings:input.additionalSources,
   assessmentScope:"analyst_attested_not_independently_verified",
   criticIndependence:"not_verified",independentEvidenceIncrement:0,
   reviewAuthority:"dashboard_session_only_not_proof_of_human_presence",
   preview:p,writesPerformed:false,protectedNotesTouched:false};
}
export async function applyCanonicalReviewRevision(raw:unknown,actor:string){
 const args=canonicalRevisionApplySchema.parse(raw),candidate=verifyRevisionCandidate(args.input);
 if(args.operationId!==args.authorization.operationId)throw Error("revision_operation_identity_hold");
 const g=revisionGate(args.operationId);
 if(g.actor!==actor||g.inputDigest!==candidate.inputDigest||
    g.path!==args.input.existingReview.path||g.beforeHash!==args.input.existingReview.expectedSha256)
   throw Error("revision_input_or_review_binding_hold");
 const outcome=await withPausedSync(()=>apply(args.authorization,actor));
 const receipt=outcome.receipt;
 if(outcome.status!=="written"||receipt?.write!=="written"||receipt?.readback!=="verified"||receipt?.reindex!=="verified")
   return {phase:"revision_apply",status:"hold_receipt_or_index",operationId:g.operationId,receipt,protectedNotesTouched:false};
 const note=indexedRead(g.path);
 const linkStatus=g.sources.map(s=>({path:s.path,resolved:Boolean(db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=?").get(g.path,s.path))}));
 const full=sha(note.raw)===g.afterHash&&linkStatus.every(x=>x.resolved);
 return {phase:"revision_apply",status:full?"revision_saved_verified":"hold_revision_link_or_hash",
   operationId:g.operationId,reviewPath:g.path,afterHash:g.afterHash,receipt,
   sourceLinks:linkStatus,researchStatus:"draft",independentEvidenceIncrement:0,
   originalSourcePreserved:true,protectedNotesTouched:false,
   perDeviceSync:"not_verified",humanPresence:"not_verified",criticIndependence:"not_verified"};
}
export function inspectCanonicalReviewRevision(operationId:string,actor:string){
 const g=revisionGate(operationId);
 if(g.actor!==actor)throw Error("revision_actor_scope_hold");
 const r=status(operationId,actor);
 return {gate:{version:g.version,path:g.path,sources:g.sources,expiresAt:g.expiresAt,
   independentEvidenceIncrement:0,reviewerAuthority:g.reviewerAuthority},receipt:r};
}

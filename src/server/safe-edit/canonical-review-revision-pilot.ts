/** IOS-ORCH-RI-001: disposable, fail-closed Canonical Review revision admission.
 * This cannot authorize production writes; C1's add-only guard stays intact.
 * Server receipts/hash binding is not semantic equivalence or independent review.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {env} from "../env";
import {c1Pilot} from "../c1-pilot";
import {indexedRead,createReceipt} from "../vault/investment-research-context";
import {existingReviewSelectionSchema} from "../vault/canonical-review-reuse";
import {sourceEventSubmissionSchema} from "../vault/source-event-contract";

const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const sourcePath=z.string().regex(/^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/);
const source=z.object({path:sourcePath,sha256:digest,receiptId:z.string().regex(/^ICW-[a-f0-9]{32}$/)}).strict();
const trim=(n:number)=>z.string().trim().min(1).max(n);
export const canonicalRevisionInputSchema=z.object({
 existingReview:existingReviewSelectionSchema,
 entity:trim(120),
 additionalSources:z.array(source).min(1).max(12),
 reviewDate:z.string().date(),
 methodVersion:trim(100),
 analystAssessment:z.object({
   disposition:z.enum(["PASS","HOLD","FAIL"]),
   eventRelation:z.enum(["duplicate","added_detail","correction","contradiction"]),
   materiality:z.enum(["low","material","unresolved"]),
   assessment:trim(4000),counterEvidence:trim(4000),requiredEvidence:trim(4000),
   criticIndependence:z.literal("not_verified"),
   independentEvidenceIncrement:z.literal(0)
 }).strict(),
 revisionText:trim(12000),
 sourceEvent:sourceEventSubmissionSchema.optional()
}).strict();
export type CanonicalRevisionInput=z.infer<typeof canonicalRevisionInputSchema>;
type BoundSource={path:string;sha256:string;receiptId:string};
type Gate={
 version:"IOS-REVIEW-REVISION-PILOT-2";operationId:string;actor:string;path:string;
 beforeHash:string;afterHash:string;reviewReceiptId:string;
 sources:BoundSource[];inputDigest:string;expiresAt:number;
 researchStatus:"draft";independentEvidenceIncrement:0;reviewerAuthority:"dashboard_session_required";
};
const gateEvent="canonical_review_revision_pilot";
export const isCanonicalCompanyReview=(p:string)=>/^10_Knowledge\/Company Research\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/.test(p);

export function assertRevisionPilot(){
 if(process.env.IOS_C1_REVISION_PILOT!=="synthetic"||c1Pilot())throw Error("revision_pilot_isolated_scope_required");
 if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_SERVICE_ID)throw Error("revision_pilot_railway_identity_refused");
 const root=fs.realpathSync(env.dataDir),tmp=fs.realpathSync(os.tmpdir());
 if(!root.startsWith(tmp+path.sep)||!path.basename(root).startsWith("ios-revision-pilot-")||
    fs.lstatSync(env.dataDir).isSymbolicLink())throw Error("revision_pilot_disposable_path_required");
}
const enablePilot=assertRevisionPilot;
export function revisionInputDigest(input:CanonicalRevisionInput){const clean={...input};delete clean.sourceEvent;return hash(JSON.stringify(clean));}
function checkSource(s:BoundSource){
 const note=indexedRead(s.path);
 const fm=note.fm;
 if(fm.type!=="investment_source_intake"||fm.intake_id!==s.path.match(/(IN-[A-F0-9]{16})\.md$/)?.[1])
   throw Error("revision_source_identity_hold");
 if(hash(note.raw)!==s.sha256||createReceipt("source_intake",s.path,note.raw)!==s.receiptId)
   throw Error("revision_source_receipt_hash_hold");
 return note;
}
function checkOriginalSource(review:ReturnType<typeof indexedRead>){
 const parentSource=review.fm.original_source_path;
 if(typeof parentSource!=="string"||!sourcePath.safeParse(parentSource).success)throw Error("revision_original_source_path_hold");
 const original=indexedRead(parentSource);
 const receipt=createReceipt("source_intake",parentSource,original.raw);
 if(!receipt||!review.raw.includes("[["+parentSource.slice(0,-3)+"]]"))throw Error("revision_original_source_link_hold");
 return {path:parentSource,receipt};
}
/** Durable route identity also applies when the pilot flag has been removed. */
export function hasRevisionAdmission(operationId:string):boolean{
 return Boolean(db().prepare("SELECT 1 FROM safe_edit_events WHERE event=? AND operation_id=? LIMIT 1").get(gateEvent,operationId));
}
/** Receipts authenticate preserved bytes, NOT issuer/event association. Do not
 * infer that association from ticker strings or caller-authored metadata. */
export function revisionReviewEvidence(g:Gate){
 const additionalSourceEvidence=g.sources.map(s=>{
   const note=checkSource(s);
   return {...s,intakeId:note.fm.intake_id as string,
     locator:{path:s.path,wholeNoteSha256:s.sha256},fullReceiptedText:note.raw,
     issuerBinding:"not_verified" as const};
 });
 const evidence={revisionEvidence:g,additionalSourceEvidence,issuerBinding:"not_verified" as const,
   issuerWarning:"Source receipts verify bytes only. Association with this Review's issuer and economic event is NOT VERIFIED. Dashboard approval does not verify it; real-use issuer correctness remains blocked."};
 return {...evidence,reviewedEvidenceDigest:hash(JSON.stringify(evidence))};
}
export function verifyRevisionCandidate(raw:unknown){
 enablePilot();
 const input=canonicalRevisionInputSchema.parse(raw),e=input.existingReview;
 if(!isCanonicalCompanyReview(e.path))throw Error("revision_review_scope_hold");
 const review=indexedRead(e.path),fm=review.fm,expectedId=e.path.match(/(IN-[A-F0-9]{16})\.md$/)?.[1];
 if(fm.type!=="investment_research_review"||fm.intake_id!==expectedId||
    fm.status!=="analyst_review_not_user_endorsed"||
    fm.verification!=="not_reverified")throw Error("revision_draft_review_required");
 const subject=e.path.match(/^10_Knowledge\/Company Research\/Investment Review - ([^/]+) - IN-/)?.[1];
 if(!subject||subject.toUpperCase()!==input.entity.toUpperCase())throw Error("revision_issuer_scope_hold");
 if(hash(review.raw)!==e.expectedSha256||
    createReceipt("canonical_review",e.path,review.raw)!==e.receiptId)throw Error("revision_review_receipt_hash_hold");
 const {path:parentSource,receipt}=checkOriginalSource(review);
 const paths=new Set<string>([parentSource]);
 for(const s of input.additionalSources){
   if(paths.has(s.path))throw Error("revision_duplicate_source_path_hold");
   checkSource(s);paths.add(s.path);
 }
 if(input.analystAssessment.eventRelation!==e.relationship)throw Error("revision_relationship_drift_hold");
 // Material, unresolved, correction and contradiction HOLD; only routine
 // added-detail can be simulated in disposable isolation and reviewed in dashboard.
 if(input.analystAssessment.disposition!=="PASS"||
    input.analystAssessment.materiality!=="low"||
    e.relationship!=="added_detail")throw Error("revision_material_or_unresolved_hold");
 const cite=input.additionalSources.map(s=>"- [["+s.path.slice(0,-3)+"]] — attributed Source, receipt "+s.receiptId+"; not independent corroboration").join("\n");
 const body=[
   "### Source-linked evidence addendum (Draft, not endorsed)",
   "Analyst method: "+input.methodVersion+"; event relation proposal: "+e.relationship+"; assessment date: "+input.reviewDate,
   "Source comparison basis: "+e.comparisonBasis,
   "",
   "New attributed Source appearances (source bytes preserved separately):",
   cite,
   "",
   "Analyst assessment (not primary evidence):",
   input.analystAssessment.assessment,
   "",
   "Contrary evidence / uncertainty:",
   input.analystAssessment.counterEvidence,
   "",
   "What to verify:",
   input.analystAssessment.requiredEvidence,
   "",
   input.revisionText,
   "",
   "Trust boundary: research_status=draft; usage_tier=historical_analysis_only;",
   "independent_evidence_increment=0; comparator_eligible=false;",
   "critic_independence=not_verified; owner_thesis_authority=false.",
   "No Thesis, Evidence Register, Company Timeline or Portfolio authorization."
 ].join("\n");
 return {input,review,originalReceiptId:receipt,sourcePaths:[...paths],body,
   inputDigest:revisionInputDigest(input)};
}
const seal=(g:Gate)=>createHmac("sha256",env.encryptionKey).update("ios-review-revision-pilot-v2\0"+JSON.stringify(g)).digest("hex");
export function recordRevisionAdmission(g:Gate){
 enablePilot();
 const prepared=db().prepare("SELECT actor,payload,before_hash,after_hash,status,expires FROM safe_edit_operations WHERE id=?").get(g.operationId) as
 {actor:string;payload:string;before_hash:string;after_hash:string;status:string;expires:number}|undefined;
 if(!prepared||prepared.actor!==g.actor||prepared.before_hash!==g.beforeHash||
   prepared.after_hash!==g.afterHash||prepared.status!=="preview"||prepared.expires!==g.expiresAt||
   JSON.parse(prepared.payload).path!==g.path)throw Error("revision_preview_binding_hold");
 if(db().prepare("SELECT 1 FROM safe_edit_events WHERE event=? AND operation_id=?").get(gateEvent,g.operationId))
   throw Error("revision_admission_replay_hold");
 db().prepare("INSERT INTO safe_edit_events VALUES(?,?,?,?,?)").run(new Date().toISOString(),g.operationId,g.actor,gateEvent,JSON.stringify({body:g,seal:seal(g)}));
}
export function makeRevisionGate(input:CanonicalRevisionInput,actor:string,operationId:string,beforeHash:string,afterHash:string,expiresAt:number):Gate{
 return {version:"IOS-REVIEW-REVISION-PILOT-2",operationId,actor,path:input.existingReview.path,
   beforeHash,afterHash,reviewReceiptId:input.existingReview.receiptId,
   sources:input.additionalSources, inputDigest:revisionInputDigest(input),
   expiresAt,researchStatus:"draft",independentEvidenceIncrement:0,reviewerAuthority:"dashboard_session_required"};
}
export function revisionGate(operationId:string):Gate{
 enablePilot();
 const rows=db().prepare("SELECT actor,detail FROM safe_edit_events WHERE event=? AND operation_id=? LIMIT 2").all(gateEvent,operationId) as {actor:string;detail:string}[];
 if(rows.length!==1)throw Error("revision_missing_or_conflicting_admission_hold");
 const wrapped=JSON.parse(rows[0].detail) as {body:Gate;seal:string};
 const g=wrapped.body;
 if(!g||g.version!=="IOS-REVIEW-REVISION-PILOT-2"||!isCanonicalCompanyReview(g.path)||!digest.safeParse(wrapped.seal).success||
    !timingSafeEqual(Buffer.from(seal(g),"hex"),Buffer.from(wrapped.seal,"hex"))||g.actor!==rows[0].actor)
    throw Error("revision_admission_seal_or_actor_hold");
 return g;
}
export function assertRevisionGate(operationId:string,path:string,before:string,after:string,actor:string){
 const g=revisionGate(operationId);
 if(g.actor!==actor||g.path!==path||g.beforeHash!==hash(before)||g.afterHash!==hash(after)||g.expiresAt<=Date.now())
   throw Error("revision_exact_diff_actor_or_expiry_hold");
 const review=indexedRead(path);
 if(hash(review.raw)!==g.beforeHash||createReceipt("canonical_review",path,review.raw)!==g.reviewReceiptId)
   throw Error("revision_current_review_receipt_hold");
 checkOriginalSource(review);
 for(const s of g.sources)checkSource(s);
 return g;
}

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
import {c1Pilot,revisionPilotRequired} from "../c1-pilot";
import {indexedRead,createReceipt} from "../vault/investment-research-context";
import {existingReviewSelectionSchema} from "../vault/canonical-review-reuse";
import {sourceEventSubmissionSchema,sourceEventEnvelopeSchema,sourceEventReferenceSchema} from "../vault/source-event-contract";
import {exactTextReference} from "../vault/research-judge-contract";
import {preservedSubmittedText} from "../vault/research-decision-v2";

const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const sourcePath=z.string().regex(/^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/);
const source=z.object({path:sourcePath,sha256:digest,receiptId:z.string().regex(/^ICW-[a-f0-9]{32}$/)}).strict();
const trim=(n:number)=>z.string().trim().min(1).max(n);
const analystAssessmentSchema=z.object({
   disposition:z.enum(["PASS","HOLD","FAIL"]),
   eventRelation:z.enum(["duplicate","added_detail","correction","contradiction"]),
   materiality:z.enum(["low","material","unresolved"]),
   assessment:trim(4000),counterEvidence:trim(4000),requiredEvidence:trim(4000),
   criticIndependence:z.literal("not_verified"),
   independentEvidenceIncrement:z.literal(0)
 }).strict();
export const canonicalRevisionInputSchema=z.object({
 existingReview:existingReviewSelectionSchema,
 entity:trim(120),
 additionalSources:z.array(source).min(1).max(12),
 reviewDate:z.string().date(),
 methodVersion:trim(100),
 analystAssessment:analystAssessmentSchema,
 revisionText:trim(12000),
 sourceEvent:sourceEventSubmissionSchema.optional()
}).strict();
export type CanonicalRevisionInput=z.infer<typeof canonicalRevisionInputSchema>;
/* M56-P1 (Owner-approved Phase 1): dedicated revision of existing Industry-IN and
 * Macro-IN canonical Reviews. Additive and versioned: the Company-IN V1 input,
 * semantic contract, gate and behaviour stay unchanged. The subject is a typed
 * Industry Hub or an explicit Macro scope bound to the receipted Review and the
 * exact Source text, never a fabricated issuer. Placed here (not
 * source-event-contract.ts) because the V2 input embeds its V2 assessment. */
export const SUBJECT_REVIEW_SELECTOR_VERSION="M56-REVIEW-SELECTOR-2";
export const SUBJECT_SOURCE_EVENT_POLICY="IOS-RI001-SUBJECT-SOURCE-EVENT-SEMANTIC-2.0.0";
export const SUBJECT_BIND_POLICY="IOS-RI001-SUBJECT-BIND-2.0.0";
export const SUBJECT_EVENT_ID_POLICY="IOS-RI001-SUBJECT-EVENT-ID-2.0.0";
const verdict=z.enum(["PASS","HOLD","FAIL"]),rationale=z.string().trim().min(20).max(2000);
const refs=z.array(sourceEventReferenceSchema).min(1).max(8);
const same=z.enum(["same","different","not_applicable","ambiguous"]);
export const subjectSourceEventResultSchema=z.object({contractVersion:z.literal(SUBJECT_SOURCE_EVENT_POLICY),packetDigest:digest,packetEnvelopeDigest:digest,
 disposition:verdict,methodVersion:z.string().trim().min(1).max(120),
 sourceBindings:z.array(z.object({bindingVersion:z.literal(SUBJECT_BIND_POLICY),sourceKey:z.string().max(100),sliceId:z.string().min(1).max(100),
   domain:z.enum(["industry","macro"]),effectiveSubjectId:z.string().min(1).max(400),
   relation:z.enum(["primary_subject","related_subject","mentioned_only","unknown","not_related"]),
   semanticRationale:rationale,references:refs,
   coverage:z.enum(["full_original","excerpt_only","not_obtained"]),limitations:z.array(z.string().max(500)).max(12)
 }).strict()).min(1).max(24),
 event:z.object({decisionVersion:z.literal(SUBJECT_EVENT_ID_POLICY),effectiveSubjectId:z.string().max(400),
   relation:z.enum(["new_event","duplicate","added_detail","correction","contradiction","unresolved"]),
   action:z.enum(["append_revision","duplicate_link_only","source_only_no_review","hold_for_reconciliation","refuse_target_review"]),
   targetReviewPath:z.string().max(1000).nullable(),materiality:z.enum(["low","medium","high","unknown"]),
   semanticRationale:rationale,materialityRationale:rationale,
   comparison:z.object({economicSubject:z.enum(["same","different","ambiguous"]),geography:same,metric:same,unit:same,period:same,role:same,vintage:same,
     sourceFamily:z.enum(["same_family","different_family","unknown"]),materialDelta:rationale}).strict(),
   consideredHistoryKeys:z.array(z.string().max(100)).max(16),references:refs,counterEvidenceRefs:z.array(sourceEventReferenceSchema).max(8),
   coverage:z.enum(["complete_for_bounded_scope","bounded_omission","operational_failure","not_available"]),coverageRationale:rationale,
 }).strict(),
 checks:z.object({sourceEntailment:verdict,subjectAssociation:verdict,eventIdentity:verdict,periodRoleVintage:verdict,unitMetricGeography:verdict,
   coverageCounterEvidence:verdict,pointInTime:verdict,injectionIsolation:verdict,protectedAuthority:verdict}).strict(),
 criticIndependence:z.literal("not_verified")
}).strict();
export const subjectSourceEventSubmissionSchema=z.object({packet:sourceEventEnvelopeSchema,result:subjectSourceEventResultSchema}).strict();
export type SubjectSourceEventSubmission=z.infer<typeof subjectSourceEventSubmissionSchema>;
const subjectEvidence=z.array(sourceEventReferenceSchema).min(1).max(6);
const industrySubject=z.object({domain:z.literal("industry"),hubPath:z.string().max(300).regex(/^02_Industries_Themes\/[^/]+\.md$/),
 topic:trim(200),period:trim(80).nullable(),evidence:subjectEvidence}).strict();
const macroSubject=z.object({domain:z.literal("macro"),geography:trim(120),topic:trim(200),period:trim(80),
 role:z.enum(["policy_decision","indicator_release","market_event","forecast_or_guidance","commentary"]),vintage:trim(80).nullable(),
 evidence:subjectEvidence}).strict();
export const subjectRevisionInputSchema=z.object({
 selectorVersion:z.literal(SUBJECT_REVIEW_SELECTOR_VERSION),
 existingReview:z.object({path:z.string().max(700),intakeId:z.string().regex(/^IN-[A-F0-9]{16}$/),expectedSha256:digest,
   receiptId:z.string().regex(/^ICW-[a-f0-9]{32}$/),reviewScope:z.enum(["industry","macro"]),originalSourcePath:sourcePath,
   relationship:z.enum(["duplicate","added_detail","correction","contradiction"]),comparisonBasis:z.string().trim().min(40).max(2000)}).strict()
   .describe("Exact existing Industry-IN or Macro-IN Draft Review: path, IN-ID, whole-note SHA-256, server receipt, scope and original Source. Revalidated at prepare and apply."),
 entity:z.enum(["industry","macro"]).describe("V2: the subject domain label (must equal subject.domain); never an issuer."),
 subject:z.discriminatedUnion("domain",[industrySubject,macroSubject])
   .describe("Typed subject: the Review's single declared Industry Hub, or an explicit macro geography/topic/period/role/vintage, each with exact original-Source text references. Not an issuer and not event verification."),
 additionalSources:z.array(source).min(1).max(12),
 reviewDate:z.string().date(),
 methodVersion:trim(100),
 analystAssessment:analystAssessmentSchema,
 revisionText:trim(12000),
 sourceEvent:subjectSourceEventSubmissionSchema.optional()
}).strict();
export type SubjectRevisionInput=z.infer<typeof subjectRevisionInputSchema>;
/** MCP registration of the dedicated revision tools (one tool, two versions; tool
 * count is fixed). Company-IN V1 public ABI is kept: the descriptor stays an object
 * whose required fields equal the original V1 set and whose V1 property schemas are
 * unchanged (existingReview/sourceEvent gain a V2 alternative; selectorVersion/subject
 * are new optional keys). The refinement below re-validates every call strictly per
 * version AT THE SDK VALIDATION STAGE: unversioned input against the exact V1 schema
 * (ignoring only the V2-only keys, as the SDK formerly stripped unknown keys), and
 * selectorVersion M56-REVIEW-SELECTOR-2 input against the strict V2 schema. A payload
 * is never reinterpreted across versions. */
export const revisionToolInputShape={
 selectorVersion:z.literal(SUBJECT_REVIEW_SELECTOR_VERSION).optional().describe("Absent: Company-IN V1. M56-REVIEW-SELECTOR-2: Industry-IN/Macro-IN V2."),
 existingReview:z.union([existingReviewSelectionSchema,subjectRevisionInputSchema.shape.existingReview]),
 // Byte-identical to the V1 property (no added description). V2 sends its domain label here.
 entity:trim(120),
 subject:subjectRevisionInputSchema.shape.subject.optional().describe("V2 only: typed Industry Hub or explicit macro scope with exact original-Source quotes."),
 additionalSources:z.array(source).min(1).max(12),
 reviewDate:z.string().date(),
 methodVersion:trim(100),
 analystAssessment:analystAssessmentSchema,
 revisionText:trim(12000),
 sourceEvent:z.union([sourceEventSubmissionSchema,subjectSourceEventSubmissionSchema]).optional()
};
export const isSubjectRevisionPayload=(raw:unknown)=>typeof raw==="object"&&raw!==null&&"selectorVersion" in raw;
/** The Company V1 view of a shared-tool payload: drops only the V2-only keys that the
 * SDK silently stripped before M56-P1 (they were unknown to the V1 shape). */
export function v1RevisionView(raw:unknown):unknown{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return raw;
 const {subject:_subject,...rest}=raw as Record<string,unknown>;void _subject;return rest;
}
export const revisionToolInputSchema=z.object(revisionToolInputShape).superRefine((value,ctx)=>{
 const r=isSubjectRevisionPayload(value)?subjectRevisionInputSchema.safeParse(value):canonicalRevisionInputSchema.safeParse(v1RevisionView(value));
 if(!r.success)for(const issue of r.error.issues)ctx.addIssue({code:"custom",message:issue.message,path:issue.path});
});
type BoundSource={path:string;sha256:string;receiptId:string};
type CompanyGate={
 version:"IOS-REVIEW-REVISION-PILOT-2";operationId:string;actor:string;path:string;
 beforeHash:string;afterHash:string;reviewReceiptId:string;
 sources:BoundSource[];inputDigest:string;expiresAt:number;
 researchStatus:"draft";independentEvidenceIncrement:0;reviewerAuthority:"dashboard_session_required";
};
type SubjectGate=Omit<CompanyGate,"version">&{version:"IOS-REVIEW-REVISION-PILOT-3-SUBJECT";domain:"industry"|"macro";subjectKey:string};
type Gate=CompanyGate|SubjectGate;
const gateEvent="canonical_review_revision_pilot";
const companyReviewPath=/^10_Knowledge\/Company Research\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/;
const subjectReviewPath={industry:/^10_Knowledge\/Industry and Concepts\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/,
 macro:/^10_Knowledge\/Macro and Markets\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/};
export const isSubjectReviewPath=(p:string)=>subjectReviewPath.industry.test(p)||subjectReviewPath.macro.test(p);
/** Every IN canonical Review served ONLY by the dedicated revision route: Company
 * (V1) and, since M56-P1, Industry/Macro (V2). The historical export name is kept
 * because the Safe Edit engine imports it; it never widens the generic route. */
export const isManagedCanonicalReview=(p:string)=>companyReviewPath.test(p)||isSubjectReviewPath(p);
export const isCanonicalCompanyReview=isManagedCanonicalReview;

export function assertRevisionPilot(){
 // OD-04+OD-06 (WP2): OFF mode has the dedicated ICR route wherever the
 // generic canonical route is refused (all OFF); C1 never; the disposable
 // pilot keeps its isolation checks.
 if(!revisionPilotRequired()&&!c1Pilot())return;
 if(process.env.IOS_C1_REVISION_PILOT!=="synthetic"||c1Pilot())throw Error("revision_pilot_isolated_scope_required");
 if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_SERVICE_ID)throw Error("revision_pilot_railway_identity_refused");
 const root=fs.realpathSync(env.dataDir),tmp=fs.realpathSync(os.tmpdir());
 if(!root.startsWith(tmp+path.sep)||!path.basename(root).startsWith("ios-revision-pilot-")||
    fs.lstatSync(env.dataDir).isSymbolicLink())throw Error("revision_pilot_disposable_path_required");
}
const enablePilot=assertRevisionPilot;
export function revisionInputDigest(input:CanonicalRevisionInput|SubjectRevisionInput){const clean={...input};delete clean.sourceEvent;return hash(JSON.stringify(clean));}
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
type SourceEvidence=BoundSource&{intakeId:string;locator:{path:string;wholeNoteSha256:string};fullReceiptedText:string;
 issuerBinding?:"not_verified";subjectBinding?:"not_verified"};
/** One static shape for both versions (Company V1 keys/bytes unchanged). */
export type RevisionReviewEvidence={revisionEvidence:Gate;additionalSourceEvidence:SourceEvidence[];issuerBinding?:"not_verified";issuerWarning?:string;
 subjectBinding?:"not_verified";subjectWarning?:string;reviewedEvidenceDigest:string};
export function revisionReviewEvidence(g:Gate):RevisionReviewEvidence{
 if(g.version==="IOS-REVIEW-REVISION-PILOT-3-SUBJECT"){
   const additionalSourceEvidence=g.sources.map(s=>{
     const note=checkSource(s);
     return {...s,intakeId:note.fm.intake_id as string,locator:{path:s.path,wholeNoteSha256:s.sha256},fullReceiptedText:note.raw,
       subjectBinding:"not_verified" as const};
   });
   const evidence={revisionEvidence:g,additionalSourceEvidence,subjectBinding:"not_verified" as const,
     subjectWarning:"Source receipts verify bytes only. Association with this Review's "+g.domain+" subject ("+g.subjectKey+") and economic event is NOT VERIFIED. Dashboard approval does not verify it."};
   return {...evidence,reviewedEvidenceDigest:hash(JSON.stringify(evidence))};
 }
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
 if(!companyReviewPath.test(e.path))throw Error("revision_review_scope_hold");
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
 // added-detail, or (WP2 A1 M56-A) a link-only duplicate of the same event, may
 // be prepared and reviewed in the dashboard. Neither is new evidence.
 const duplicate=e.relationship==="duplicate";
 if(input.analystAssessment.disposition!=="PASS"||
    input.analystAssessment.materiality!=="low"||
    (e.relationship!=="added_detail"&&!duplicate))throw Error("revision_material_or_unresolved_hold");
 const cite=input.additionalSources.map(s=>"- [["+s.path.slice(0,-3)+"]] — attributed Source, receipt "+s.receiptId+"; not independent corroboration").join("\n");
 const body=[
   duplicate?"### Duplicate Source link (link only; same event already covered; not new evidence or a new event)":
     "### Source-linked evidence addendum (Draft, not endorsed)",
   "Analyst method: "+input.methodVersion+"; event relation proposal: "+e.relationship+"; assessment date: "+input.reviewDate,
   "Source comparison basis: "+e.comparisonBasis,
   "",
   duplicate?"Duplicate attributed Source appearances (link only; source bytes preserved separately):":
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
const fold=(s:string)=>s.normalize("NFC").replace(/\p{Cf}/gu,"").replace(/\s+/g," ").trim().toLowerCase();
function originalSourceText(path:string){
 const n=indexedRead(path),part=preservedSubmittedText(n.raw);
 const text=part===null?undefined:[part,part+"\n"].find(t=>hash(t)===n.fm.source_text_sha256);
 if(!text)throw Error("revision_subject_source_text_hold");
 return {text,sha256:hash(text)};
}
/** M56-P1 V2 candidate: every binding is server-checked against the receipted Draft
 * Review, its original Source and the exact Source text; the semantic relation
 * remains analyst-attested (sealed separately) and is never inferred here. */
export function verifySubjectRevisionCandidate(raw:unknown){
 enablePilot();
 const input=subjectRevisionInputSchema.parse(raw),e=input.existingReview,s=input.subject;
 if(s.domain!==e.reviewScope||input.entity!==s.domain||!subjectReviewPath[s.domain].test(e.path))throw Error("revision_subject_domain_scope_hold");
 const review=indexedRead(e.path),fm=review.fm,id=e.path.match(/(IN-[A-F0-9]{16})\.md$/)?.[1];
 if(id!==e.intakeId||fm.type!=="investment_research_review"||fm.intake_id!==id||fm.status!=="analyst_review_not_user_endorsed"||
    fm.verification!=="not_reverified"||fm.research_status!=="draft"||fm.usage_tier!=="historical_analysis_only")throw Error("revision_draft_review_required");
 if(fm.review_scope!==s.domain)throw Error("revision_subject_domain_scope_hold");
 if(fm.original_source_path!==e.originalSourcePath)throw Error("revision_original_source_path_hold");
 if(hash(review.raw)!==e.expectedSha256||createReceipt("canonical_review",e.path,review.raw)!==e.receiptId)throw Error("revision_review_receipt_hash_hold");
 const {path:parentSource,receipt}=checkOriginalSource(review);
 const original=originalSourceText(parentSource);
 if(s.evidence.some(ref=>ref.key!=="original_source"||!exactTextReference(ref,original.text,original.sha256)))throw Error("revision_subject_evidence_hold");
 const quoted=fold(s.evidence.map(ref=>ref.quote).join("\n"));
 let subjectKey:string,subjectLabel:string;
 if(s.domain==="industry"){
   // One exact, indexed Hub declared by the server-receipted Review; never a headline topic.
   const hubs=Array.isArray(fm.industry_hubs)?fm.industry_hubs:[];
   if(hubs.length!==1)throw Error("revision_subject_ambiguous_hold");
   if(hubs[0]!==s.hubPath||!db().prepare("SELECT 1 FROM notes WHERE path=?").get(s.hubPath))throw Error("revision_subject_binding_hold");
   subjectKey="industry:"+s.hubPath;subjectLabel="Industry Hub "+s.hubPath.slice("02_Industries_Themes/".length,-3)+" — "+s.topic+(s.period?" — "+s.period:"");
 }else{
   // Geography and period must be stated by the Source itself, not inferred.
   if(!quoted.includes(fold(s.geography))||!quoted.includes(fold(s.period)))throw Error("revision_macro_subject_unsupported_hold");
   subjectKey="macro:"+hash(JSON.stringify([fold(s.geography),fold(s.topic),fold(s.period),s.role,s.vintage===null?null:fold(s.vintage)])).slice(0,32);
   subjectLabel="Macro "+s.geography+" — "+s.topic+" — "+s.period+" ("+s.role+(s.vintage?", vintage "+s.vintage:"")+")";
 }
 const paths=new Set<string>([parentSource]);
 for(const src of input.additionalSources){
   if(paths.has(src.path))throw Error("revision_duplicate_source_path_hold");
   checkSource(src);paths.add(src.path);
 }
 if(input.analystAssessment.eventRelation!==e.relationship)throw Error("revision_relationship_drift_hold");
 const duplicate=e.relationship==="duplicate";
 if(input.analystAssessment.disposition!=="PASS"||input.analystAssessment.materiality!=="low"||
    (e.relationship!=="added_detail"&&!duplicate))throw Error("revision_material_or_unresolved_hold");
 // A new forecast/guidance detail is never routine; only a link-only duplicate of it may proceed.
 if(s.domain==="macro"&&s.role==="forecast_or_guidance"&&!duplicate)throw Error("revision_material_or_unresolved_hold");
 const cite=input.additionalSources.map(src=>"- [["+src.path.slice(0,-3)+"]] — attributed Source, receipt "+src.receiptId+"; not independent corroboration").join("\n");
 const body=[
   duplicate?"### Duplicate Source link (link only; same event already covered; not new evidence or a new event)":
     "### Source-linked evidence addendum (Draft, not endorsed)",
   "Analyst method: "+input.methodVersion+"; event relation proposal: "+e.relationship+"; assessment date: "+input.reviewDate,
   "Subject ("+SUBJECT_REVIEW_SELECTOR_VERSION+", server-bound to the receipted Review and Source text, not an issuer): "+subjectLabel,
   "Source comparison basis: "+e.comparisonBasis,
   "",
   duplicate?"Duplicate attributed Source appearances (link only; source bytes preserved separately):":
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
   "No Thesis, Evidence Register, Evolution Timeline, Decision, Portfolio or Trade authorization."
 ].join("\n");
 return {input,review,originalReceiptId:receipt,sourcePaths:[...paths],body,subjectKey,subjectLabel,
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
export function makeSubjectRevisionGate(input:SubjectRevisionInput,subjectKey:string,actor:string,operationId:string,beforeHash:string,afterHash:string,expiresAt:number):Gate{
 return {version:"IOS-REVIEW-REVISION-PILOT-3-SUBJECT",operationId,actor,path:input.existingReview.path,
   beforeHash,afterHash,reviewReceiptId:input.existingReview.receiptId,
   sources:input.additionalSources,inputDigest:revisionInputDigest(input),
   expiresAt,researchStatus:"draft",independentEvidenceIncrement:0,reviewerAuthority:"dashboard_session_required",
   domain:input.subject.domain,subjectKey};
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
 const scoped=g?.version==="IOS-REVIEW-REVISION-PILOT-2"?companyReviewPath.test(g.path):
   g?.version==="IOS-REVIEW-REVISION-PILOT-3-SUBJECT"&&subjectReviewPath[g.domain]?.test(g.path);
 if(!g||!scoped||!digest.safeParse(wrapped.seal).success||
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

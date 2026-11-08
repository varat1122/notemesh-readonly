/**
 * M5.4: one scoped Safe Edit handoff for a complete canonical intake.
 * Preview is read-only to the Vault. Apply uses the existing per-note Safe Edit
 * CAS journal, OAuth actor, lock, backup, sync pause, and SHA verification.
 * A Source/optional Claims/Review sequence is intentionally recoverable, not falsely advertised as atomic:
 * a failed review never rolls back or overwrites a successfully saved source.
 */
import { z } from "zod";
import {intakeClaimsSchema,researchLineageSchema} from "../vault/canonical-claims";
import {researchReviewSchema} from "./research-review-schema";
import { planInvestmentWriteback } from "../vault/investment-writeback-router";
import { apply, preview, previewCanonicalReview, recordResearchJudgeGate, recordCanonicalAppearance, status } from "../safe-edit/engine";
import {appearanceSchema,canonicalAppearance,requireAppearance} from "../vault/intake-appearances";
import { withPausedSync } from "../safe-edit/sync";
import {JUDGE_VERSION,judgeSubmissionSchema,evaluateResearchJudge} from "../vault/research-judge";
import {RESEARCH_STATE_POLICY} from "../vault/research-state";
import {currentJudgeGate} from "../safe-edit/research-judge-gate";

const nonempty = z.string().min(1);
const canonicalBaseSchema = z.object({
  domain: z.enum(["company", "industry", "macro", "asset"]),
  entities: z.array(z.string().min(1).max(120)).min(1).max(6),
  topic: nonempty.max(250),
  inputFormat: z.enum(["text", "screenshot", "pdf", "mixed"]),
  sourceKind: z.enum(["broker_research", "issuer_release", "regulatory_filing", "news_media",
    "user_commentary", "archived_chat", "social_repost", "industry_research", "official_macro", "unknown"]),
  extractedText: nonempty.max(12000),
  sourceChat: nonempty.max(120),
  appearance:appearanceSchema.optional(),
  existingIntakeId:z.string().regex(/^IN-[A-F0-9]{16}$/).optional(),
  completedAnalysis: nonempty.max(30000).optional(),
  researchReview: researchReviewSchema,
  sourceChannel:z.string().max(80).optional(),
  attributedOrigin:z.string().max(160).optional(),
  originalDocumentAccess:z.enum(["full_original","excerpt_only","not_obtained"]).optional(),
  captureOnly: z.boolean().optional(),
  sourceLanguage: z.string().max(35).nullable().optional(),
  sourceUrl: z.string().max(1000).nullable().optional(),
  publisher: z.string().max(160).nullable().optional(),
  eventDate: z.string().nullable().optional(),
  publicationDate: z.string().nullable().optional(),
  rawAttachmentPath: z.string().max(600).nullable().optional(),
  rawAttachmentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  rawAttachmentContentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]).nullable().optional(),
  focus: z.enum(["earnings", "broker", "tam", "macro", "thesis", "general"]).optional(),
  claims:intakeClaimsSchema,
  researchLineage:researchLineageSchema,
  researchJudge:judgeSubmissionSchema.optional().describe("Opt-in Chat-first semantic gate. Supply the exact server-sealed packet and typed analyst-attested result. HOLD/FAIL preserves Source only. Once admitted, this intake cannot silently return to a legacy ungated writer. PASS never grants primary authority."),
  claim: z.object({metric: nonempty.max(140), period: nonempty.max(120), statement: z.string().min(8).max(2500),
    value: z.string().max(150).optional(), unit: z.string().max(80).optional()}).optional(),
  contentTypes: z.array(z.enum(["reported_fact", "earnings", "guidance", "industry_data", "macro_data",
    "policy", "broker_rating", "broker_price_target", "broker_estimate", "analyst_opinion",
    "market_commentary", "portfolio_snapshot", "other"])).max(12).optional(),
  entityRoles: z.array(z.object({entity: nonempty.max(120),
    role: z.enum(["primary_subject", "covered_company", "supplier", "customer", "competitor", "mentioned"])})).max(12).optional(),
  themes: z.array(nonempty.max(120)).max(12).optional(),
  brokerUpdate: z.object({
    bank: nonempty.max(120), reportDate: z.string().max(10).optional(),
    priorBank: z.string().max(120).optional(), priorReportDate: z.string().max(10).optional(),
    rating: z.string().max(80).optional(), priorRating: z.string().max(80).optional(),
    targetPrice: z.string().max(80).optional(), priorTargetPrice: z.string().max(80).optional(),
    currency: z.string().max(20).optional(), priorCurrency: z.string().max(20).optional(),
    targetHorizon: z.string().max(80).optional(), priorTargetHorizon: z.string().max(80).optional(),
    estimateChanges: z.array(z.object({metric: nonempty.max(120),period: nonempty.max(120),
      oldValue:z.string().max(80),newValue:z.string().max(80),unit:z.string().max(60)})).max(12).optional(),
  }).optional(),
}).strict();
export const canonicalInputShape = canonicalBaseSchema.shape;
export const canonicalInputSchema = canonicalBaseSchema.superRefine((v,ctx)=>{
  if(v.captureOnly===true && (v.completedAnalysis!==undefined||v.researchReview!==undefined))
    ctx.addIssue({code:"custom",message:"Feed Only cannot include analysis or researchReview"});
  if(v.captureOnly!==true && !v.completedAnalysis&&!v.researchReview)
    ctx.addIssue({code:"custom",message:"Completed analysis or typed researchReview is required outside Feed Only"});
});

export const canonicalAuthorizationSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const canonicalApplySchema = z.object({
  input: canonicalInputSchema,
  planId: z.string().regex(/^IN-[A-F0-9]{16}$/),
  authorizations: z.array(canonicalAuthorizationSchema).max(10),
}).strict();

function planned(input: z.infer<typeof canonicalInputSchema>,actor:string) {
  const {researchJudge,...clean}=input;
  const plan = planInvestmentWriteback(clean);
  const workflow = plan.safeEditWorkflow;
  if(!workflow) throw Error("No canonical Safe Edit recipe; sourceChat and analysis/capture mode are required");
  // The shared workflow gates both read-only recipes and Safe Edit, without
  // an environment-variable bypass for untyped completedAnalysis.
  for(const step of workflow.steps){
    const allowed = step.kind === "source_intake" ? /^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/ :
      step.kind==="structured_claim" ? /^10_Knowledge\/(Company Research|Industry and Concepts|Macro and Markets)\/Investment Claim - ICL-[A-F0-9]{32}\.md$/ :
      /^10_Knowledge\/(Company Research|Industry and Concepts|Macro and Markets)\/Investment Review - [^/]+\.md$/;
    if(!allowed.test(step.path) || (step.safeEditRequest &&
      (step.safeEditRequest.path !== step.path || step.safeEditRequest.change.kind !== "create")))
      throw Error("Canonical recipe attempted an out-of-scope edit");
  }
  let judge:ReturnType<typeof evaluateResearchJudge>|null=null;
  if(researchJudge)try{judge=evaluateResearchJudge(clean,researchJudge,actor);}catch{
    judge={decision:"HOLD",reasons:["judge_packet_or_input_binding_hold"],criticRequired:false,criticStatus:"not_evaluated",
      packetId:researchJudge.packet.packetId,packetDigest:researchJudge.packet.digest,resultDigest:null,history:[],retrieval:null,scopeWitness:null,expiresAt:0,
      trust:{actorLabelSha256:"",actorProvenance:"not_established",session:"not_exposed",modelVersion:"not_exposed",judgeIdentity:"analyst_attested_unverified"},semanticTruthVerified:false,primaryAuthority:false};
  }
  const enrolled=currentJudgeGate(plan.planId);
  if((judge&&judge.decision!=="PASS")||(!researchJudge&&enrolled)){
    for(const step of workflow.steps)if(step.kind!=="source_intake"&&step.state==="needs_create"){
      step.state="hold_research_judge";step.safeEditRequest=null;
    }
    workflow.status="hold_research_judge";workflow.readyForNextNews=false;
  }
  return {plan,workflow,judge,enrolled};
}

export function prepareCanonicalWriteback(raw:unknown,actor:string) {
  const input=canonicalInputSchema.parse(raw);
  const {plan,workflow,judge,enrolled}=planned(input,actor);
  const previews=[];
  // Admit the exact Source first, then record semantic eligibility in the
  // existing event journal before ANY Claim/Review preview can be issued.
  const source=workflow.steps.find(s=>s.kind==="source_intake")!;
  if(input.researchJudge&&judge&&(source.state==="needs_create"||source.state==="verified_existing")){
    if(source.state==="needs_create"){
      const p=preview(source.safeEditRequest,actor);
      previews.push({kind:source.kind,expectedSha256:source.expectedSha256,...p});
    }
    recordResearchJudgeGate(source.receiptKey,actor,{version:JUDGE_VERSION,researchStatePolicy:RESEARCH_STATE_POLICY,intakeId:plan.planId,actor,decision:judge.decision,
      packetDigest:judge.packetDigest,resultDigest:judge.resultDigest,expiresAt:judge.expiresAt,history:judge.history,retrieval:judge.retrieval,scopeWitness:judge.scopeWitness,
      targets:workflow.steps.map(s=>({path:s.path,sha256:s.expectedSha256,operationId:s.receiptKey,kind:s.kind,
        eligible:s.state==="needs_create"||s.state==="verified_existing"}))});
  }
  for(const step of workflow.steps) {
    if(step.state!=="needs_create")continue;
    if(previews.some(p=>p.kind===step.kind&&p.path===step.path))continue;
    if(!step.safeEditRequest) throw Error("Missing add-only recipe");
    const p=(step.kind==="canonical_review"?previewCanonicalReview:preview)(step.safeEditRequest,actor);
    if(!p.previewToken) throw Error("Safe Edit did not issue a fresh preview token");
    previews.push({kind:step.kind,expectedSha256:step.expectedSha256,...p});
  }
  const appearancePayload=canonicalAppearance(input,source,plan.planId,actor);
  const appearance=appearancePayload?recordCanonicalAppearance(appearancePayload,actor):null;
  return {phase:"preview_only",appearance,planId:plan.planId,workflowStatus:workflow.status,researchJudge:judge??(enrolled?{decision:"HOLD",reasons:["enrolled_intake_requires_judge_contract"]}:null),
    qualityIssues:workflow.qualityIssues,claimIssues:workflow.claimIssues,lineageIssues:workflow.lineageIssues,claimInterpretationBoundary:workflow.claimInterpretationBoundary,readyForNextNews:workflow.readyForNextNews,
    archiveProvenanceStatus:workflow.archiveProvenanceStatus,archiveProvenanceReason:workflow.archiveProvenanceReason,
    steps:workflow.steps.map(({kind,path,state,expectedSha256,receiptKey,researchTrust})=>({kind,path,state,expectedSha256,receiptKey,researchTrust})),
    previews,protectedNotesTouched:false,perDeviceSync:"unverified",writesPerformed:false,
    next:"Review exact diffs and authorize apply_canonical_writeback with these tokens; no Vault notes have been written."};
}

export async function applyCanonicalWriteback(raw:unknown,actor:string) {
  const args=canonicalApplySchema.parse(raw);
  const {plan,workflow,judge,enrolled}=planned(args.input,actor);
  if(plan.planId!==args.planId) throw Error("Plan identity mismatch; original source or chronology changed");
  const appearancePayload=canonicalAppearance(args.input,workflow.steps.find(s=>s.kind==="source_intake")!,plan.planId,actor);
  if(appearancePayload)requireAppearance(appearancePayload);
  // Apply can receive a newer HOLD/FAIL without another prepare. Revoke the
  // matching bundle authority before any await or write (even if the submitted
  // token set is refused below), otherwise generic apply could retain its old
  // PASS. This only expires the old envelope; it does not approve new targets
  // or attest the changed input. Source preservation remains independently
  // eligible. An obsolete packet must not revoke a newer assessment of a
  // different scope. The journal enforces the original Source/actor binding.
  if(enrolled&&judge&&judge.decision!=="PASS"&&enrolled.packetDigest===judge.packetDigest){
    const source=enrolled.targets.find(t=>t.kind==="source_intake");
    if(!source)throw Error("research_judge_source_admission_hold");
    recordResearchJudgeGate(source.operationId,actor,{...enrolled,decision:judge.decision,expiresAt:0});
  }
  if(judge?.decision==="PASS"&&(!enrolled||enrolled.version!==JUDGE_VERSION||enrolled.researchStatePolicy!==RESEARCH_STATE_POLICY||enrolled.packetDigest!==judge.packetDigest||enrolled.resultDigest!==judge.resultDigest||enrolled.decision!=="PASS"))
    throw Error("research_judge_prepare_required_or_superseded");
  const pending=workflow.steps.filter(s=>s.state==="needs_create");
  const ids=pending.map(s=>s.receiptKey);
  if(new Set(args.authorizations.map(a=>a.operationId)).size!==args.authorizations.length||
    args.authorizations.length!==ids.length||
    args.authorizations.some(a=>!ids.includes(a.operationId)))
    throw Error("Authorization must exactly match the pending canonical steps; no partial or extra operation authorization");
  // Check every authorization and immutable after hash before writing the first
  // note. Tokens are checked by the Safe Edit engine again at apply time.
  for(const step of pending){
    const r=status(step.receiptKey,actor);
    if(r.path!==step.path||r.afterHash!==step.expectedSha256||r.status!=="preview")
      throw Error("Stale or mismatched canonical preview; prepare again and inspect the new diff");
  }
  const receipts:unknown[]=[];
  let interrupted:string|null=null;
  if(pending.length) {
    try {
      await withPausedSync(()=>{
        for(const step of pending) {
          const a=args.authorizations.find(x=>x.operationId===step.receiptKey)!;
          try {
            // Sync pause is asynchronous: archive state may have changed since
            // admission. Revalidate immediately before each canonical write.
            // A safe Source may survive; never use a stale Review authorization.
            const current=planned(args.input,actor).workflow.steps.find(s=>s.kind===step.kind&&s.path===step.path);
            if(current?.state!=="needs_create"||current.receiptKey!==step.receiptKey||
              current.expectedSha256!==step.expectedSha256)
              throw Error("Canonical state or archive provenance changed; prepare again");
            receipts.push(apply(a,actor));
          }
          catch(e) {interrupted=e instanceof Error?e.message:"Safe Edit operation failed";break;}
        }
      });
    } catch(e) {interrupted=e instanceof Error?e.message:"Sync guard refused write";}
  }
  // Re-plan from the unchanged source input; trust disk hash/FTS readback, not
  // mere Safe Edit success or a stale pre-write plan.
  const after=planned(args.input,actor).workflow;
  return {phase:"apply_verified_or_pending",appearance:appearancePayload?requireAppearance(appearancePayload):null,planId:plan.planId,
    status:after.status,readyForNextNews:after.readyForNextNews,researchJudge:judge??(enrolled?{decision:"HOLD",reasons:["enrolled_intake_requires_judge_contract"]}:null),
    qualityIssues:after.qualityIssues,claimIssues:after.claimIssues,lineageIssues:after.lineageIssues,claimInterpretationBoundary:after.claimInterpretationBoundary,
    archiveProvenanceStatus:after.archiveProvenanceStatus,archiveProvenanceReason:after.archiveProvenanceReason,
    steps:after.steps.map(({kind,path,state,receiptKey,readbackVerified,indexed,searchable,researchTrust})=>
      ({kind,path,state,receiptKey,readbackVerified,indexed,searchable,researchTrust})),
    receipts,interrupted,protectedNotesTouched:false,perDeviceSync:"unverified",
    outcome:after.status==="saved_verified"?"saved_verified":
      after.status==="source_saved_analysis_pending"?"source_saved_analysis_pending":"pending_or_blocked",
    note:"Partial source writes are retained and independently verifiable; retry only pending steps after a fresh preview. Device Sync is not proven."};
}

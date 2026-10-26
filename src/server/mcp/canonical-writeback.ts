/**
 * M5.4: one scoped Safe Edit handoff for a complete canonical intake.
 * Preview is read-only to the Vault. Apply uses the existing per-note Safe Edit
 * CAS journal, OAuth actor, lock, backup, sync pause, and SHA verification.
 * A pair is intentionally recoverable, not falsely advertised as atomic:
 * a failed review never rolls back or overwrites a successfully saved source.
 */
import { z } from "zod";
import { planInvestmentWriteback } from "../vault/investment-writeback-router";
import { apply, preview, status } from "../safe-edit/engine";
import { withPausedSync } from "../safe-edit/sync";

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
  existingIntakeId:z.string().regex(/^IN-[A-F0-9]{16}$/).optional(),
  completedAnalysis: nonempty.max(30000).optional(),
  researchReview: z.object({
    headlineTh:nonempty.max(500),translationTh:z.string().max(30000).optional(),
    whatChangedTh:nonempty.max(6000),mechanismTh:nonempty.max(6000),
    thesisImplicationTh:nonempty.max(6000),counterEvidenceTh:nonempty.max(6000),
    requiredEvidenceTh:nonempty.max(6000),
    claimAssessments:z.array(z.object({
      entity:nonempty.max(120).optional(),
      metric:nonempty.max(140),period:nonempty.max(120),unit:nonempty.max(80),
      competingValues:z.array(nonempty.max(150)).min(1).max(8),
      resolution:z.enum(["unresolved","verified_primary"]),
      conclusion:z.enum(["no_change","conditional","confirmed"]),
      primaryEvidenceReceipt:z.string().max(500).optional(),
      primarySourceUrl:z.string().url().max(2000).optional(),
      verifiedValue:nonempty.max(150).optional()
    }).strict()).max(24).optional()
  }).strict().optional(),
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
  authorizations: z.array(canonicalAuthorizationSchema).max(2),
}).strict();

function planned(input: z.infer<typeof canonicalInputSchema>) {
  const plan = planInvestmentWriteback(input);
  const workflow = plan.safeEditWorkflow;
  if(!workflow) throw Error("No canonical Safe Edit recipe; sourceChat and analysis/capture mode are required");
  // M5.5 applies to every canonical Safe Edit Review, including older callers
  // that still submit only completedAnalysis. Preserve Source capture; never
  // issue a review preview for an untyped analysis. M5.3 read-only planning
  // remains available for migration/diagnostics, not as a bypass in M5.4.
  // Deploy in compatibility mode first, update the linked caller, then set
  // M55_REQUIRE_TYPED_REVIEW=1 for a verified production cutover. Typed payloads
  // are always quality-gated regardless of the flag. Never silently switch an
  // old active caller to Source-only during the initial code deployment.
  if(process.env.M55_REQUIRE_TYPED_REVIEW==="1"&&input.captureOnly!==true&&!input.researchReview){
    const review=workflow.steps.find(s=>s.kind==="canonical_review");
    if(review){review.state="hold_quality_gate";review.safeEditRequest=null;}
    workflow.status="hold_research_quality";
    workflow.qualityIssues=[...new Set([...workflow.qualityIssues,"typed_research_review_required"])];
    workflow.readyForNextNews=false;
    workflow.analysisComplete=false;
  }
  for(const step of workflow.steps){
    const allowed = step.kind === "source_intake" ? /^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/ :
      /^10_Knowledge\/(Company Research|Industry and Concepts|Macro and Markets)\/Investment Review - [^/]+\.md$/;
    if(!allowed.test(step.path) || (step.safeEditRequest &&
      (step.safeEditRequest.path !== step.path || step.safeEditRequest.change.kind !== "create")))
      throw Error("Canonical recipe attempted an out-of-scope edit");
  }
  return {plan,workflow};
}

export function prepareCanonicalWriteback(raw:unknown,actor:string) {
  const input=canonicalInputSchema.parse(raw);
  const {plan,workflow}=planned(input);
  const previews=[];
  for(const step of workflow.steps) {
    if(step.state!=="needs_create")continue;
    if(!step.safeEditRequest) throw Error("Missing add-only recipe");
    const p=preview(step.safeEditRequest,actor);
    if(!p.previewToken) throw Error("Safe Edit did not issue a fresh preview token");
    previews.push({kind:step.kind,expectedSha256:step.expectedSha256,...p});
  }
  return {phase:"preview_only",planId:plan.planId,workflowStatus:workflow.status,
    qualityIssues:workflow.qualityIssues,
    steps:workflow.steps.map(({kind,path,state,expectedSha256,receiptKey})=>({kind,path,state,expectedSha256,receiptKey})),
    previews,protectedNotesTouched:false,perDeviceSync:"unverified",writesPerformed:false,
    next:"Review exact diffs and authorize apply_canonical_writeback with these tokens; no Vault notes have been written."};
}

export async function applyCanonicalWriteback(raw:unknown,actor:string) {
  const args=canonicalApplySchema.parse(raw);
  const {plan,workflow}=planned(args.input);
  if(plan.planId!==args.planId) throw Error("Plan identity mismatch; original source or chronology changed");
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
          try {receipts.push(apply(a,actor));}
          catch(e) {interrupted=e instanceof Error?e.message:"Safe Edit operation failed";break;}
        }
      });
    } catch(e) {interrupted=e instanceof Error?e.message:"Sync guard refused write";}
  }
  // Re-plan from the unchanged source input; trust disk hash/FTS readback, not
  // mere Safe Edit success or a stale pre-write plan.
  const after=planned(args.input).workflow;
  return {phase:"apply_verified_or_pending",planId:plan.planId,
    status:after.status,readyForNextNews:after.readyForNextNews,
    qualityIssues:after.qualityIssues,
    steps:after.steps.map(({kind,path,state,receiptKey,readbackVerified,indexed,searchable})=>
      ({kind,path,state,receiptKey,readbackVerified,indexed,searchable})),
    receipts,interrupted,protectedNotesTouched:false,perDeviceSync:"unverified",
    outcome:after.status==="saved_verified"?"saved_verified":
      after.status==="source_saved_analysis_pending"?"source_saved_analysis_pending":"pending_or_blocked",
    note:"Partial source writes are retained and independently verifiable; retry only pending steps after a fresh preview. Device Sync is not proven."};
}

import {judgeDraftRisk} from "../vault/research-draft-risk";
import {existingReviewSelectionSchema} from "../vault/canonical-review-reuse";
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
import { apply, preview, previewCanonicalSource, previewCanonicalReview, recordResearchJudgeGate, recordCanonicalAppearance, status } from "../safe-edit/engine";
import {appearanceSchema,canonicalAppearance,requireAppearance,checkAppearanceRetry,appearanceReadback} from "../vault/intake-appearances";
import { withPausedSync } from "../safe-edit/sync";
import {JUDGE_VERSION,DRAFT_RISK_POLICY,draftRiskAssessmentSchema,judgeSubmissionSchema,evaluateResearchJudge,verifyResearchJudgeEnvelope,judgeEnvelopeDigest,judgeHash,stableJudgeJson} from "../vault/research-judge";
import {RESEARCH_STATE_POLICY} from "../vault/research-state";
import {currentJudgeGate,assertJudgeAdmissionOrder} from "../safe-edit/research-judge-gate";
import {c1Pilot} from "../c1-pilot";
import {recordPilotAssessment,pilotRestriction,pilotAdmissionSummary} from "../safe-edit/c1-pilot-review";

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
  existingReview:existingReviewSelectionSchema.optional(),
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

/** Restrictive withdrawal uses the exact previously admitted envelope, NOT the
 * new appearance, planner, tokens or caller-derived target paths. This remains
 * possible if the encryption key is unavailable/rotated: the existing journal
 * fingerprint authenticates only this withdrawal, never a new PASS. Legacy
 * gates have no fingerprint: require the original HMAC/key/time contract instead. */
function revokeMatchingJudge(raw:unknown,actor:string,planId?:unknown,forced?:"HOLD"|"FAIL"){
  if(!raw||typeof raw!=="object")return;
  let submitted=(raw as {researchJudge?:unknown}).researchJudge;
  // Malformed new risk evidence must not hide a matching restrictive result
  // behind SDK validation. Strip ONLY that field for authenticated withdrawal;
  // missing risk evidence is restrictive under the new policy, never PASS.
  if(submitted&&typeof submitted==="object"&&"result" in submitted){
    const result=submitted.result;
    if(result&&typeof result==="object"&&"riskAssessment" in result&&!draftRiskAssessmentSchema.safeParse(result.riskAssessment).success)
      submitted={...submitted,result:{...result,riskAssessment:undefined}};
  }
  const parsed=judgeSubmissionSchema.safeParse(submitted);
  if(!parsed.success)return;
  const {packet,result}=parsed.data;
  let body;try{body=JSON.parse(packet.body);}catch{return;}
  const intakeId=body?.source?.intakeId;
  if(typeof intakeId!=="string"||!/^IN-[A-F0-9]{16}$/.test(intakeId)||(planId!==undefined&&planId!==intakeId))return;
  const gate=currentJudgeGate(intakeId);
  if(!gate||gate.actor!==actor||packet.actorLabelSha256!==judgeHash(actor)||gate.packetDigest!==packet.digest||
    packet.digest!==judgeHash(packet.body)||packet.packetId!=="RJP-"+packet.digest.slice(0,32).toUpperCase()||
    ![JUDGE_VERSION,"RI001-JUDGE-5"].includes(body.version)||body.researchStatePolicy!==RESEARCH_STATE_POLICY||
    gate.version!==body.version||gate.researchStatePolicy!==body.researchStatePolicy)return;
  const envelopeDigest=judgeEnvelopeDigest(packet),legacy=!gate.packetEnvelopeDigest&&gate.packetIssuedAt==null;
  if(legacy){
    // Digest equality alone is caller-controlled. Authenticate the server seal
    // before accepting any legacy withdrawal; current policy/actor/time apply.
    try{body=verifyResearchJudgeEnvelope(packet,actor,true);}catch{return;}
    if(!result||body.source.sha256!==judgeHash(body.source.text))return;
  }else if(gate.packetEnvelopeDigest!==envelopeDigest||gate.packetIssuedAt!==packet.issuedAt)return;
  let decision=forced;
  if(result){
    if(result.packetDigest!==packet.digest||result.packetId!==packet.packetId||result.reviewDigest!==body.reviewDigest||
      (result.packetEnvelopeDigest!==undefined&&result.packetEnvelopeDigest!==envelopeDigest))return;
    const exact=(actual:{key:string}[],expected:{key:string}[])=>Array.isArray(expected)&&actual.length===expected.length&&
      new Set(actual.map(x=>x.key)).size===actual.length&&expected.every(e=>actual.some(a=>a.key===e.key));
    // A truncated required bundle is itself HOLD, never permission to retain
    // the prior PASS. Result/packet/actor binding above must still be exact.
    if(!exact(result.claims,body.claims)||!exact(result.relationships,body.relationships)||result.event.key!=="event"||result.review.key!=="review")decision="HOLD";
    const statuses=[...result.claims,...result.relationships,result.event,result.review].flatMap(x=>[x.verdict,...Object.values(x.checks)]);
    if(statuses.includes("FAIL"))decision="FAIL";
    else if(statuses.includes("HOLD")||result.materialRisk||["correction","contradiction","unresolved"].includes(result.event.classification)||
      (result.critic&&result.critic.verdict!=="PASS"))decision="HOLD";
    if(body.riskPolicy===DRAFT_RISK_POLICY){
      const risk=judgeDraftRisk(body,result,envelopeDigest);
      if(risk.decision==="FAIL")decision="FAIL";
      else if(risk.decision==="HOLD"&&decision!=="FAIL")decision="HOLD";
    }else if(result.event.classification==="added_detail"&&decision!=="FAIL")decision="HOLD";
  }
  if(!decision)return;
  const source=gate.targets.find(t=>t.kind==="source_intake");
  if(!source)throw Error("research_judge_source_admission_hold");
  // Append newly authenticated withdrawal evidence; never rewrite the legacy
  // event or upgrade its PASS. This identity also keeps repeated withdrawals
  // idempotent without relying on same-millisecond legacy journal ordering.
  recordResearchJudgeGate(source.operationId,actor,{...gate,...(legacy?{packetEnvelopeDigest:envelopeDigest,packetIssuedAt:packet.issuedAt}:{}),decision:gate.decision==="FAIL"?"FAIL":decision,expiresAt:0,
    resultDigest:result?judgeHash(stableJudgeJson(result)):null},{current:gate,...(legacy?{sourceTextSha256:body.source.sha256}:{})});
}
/** Restrictive admission hook also used before the MCP SDK validates the rest
 * of a canonical request. This never prepares targets or issues authority. */
export function withdrawCanonicalJudge(tool:string,raw:unknown,actor:string){
  if(tool==="prepare_canonical_writeback")revokeMatchingJudge(raw,actor);
  else if(tool==="apply_canonical_writeback"&&raw&&typeof raw==="object"){
    const request=raw as {input?:unknown;planId?:unknown};
    // A missing outer planId is an SDK error, not permission to discard a
    // withdrawal scoped by an authenticated packet. A supplied mismatch still
    // cannot target another intake.
    revokeMatchingJudge(request.input,actor,request.planId);
  }
}

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
      packetEnvelopeDigest:null,packetIssuedAt:null,resultEnvelopeDigest:null,riskPolicy:DRAFT_RISK_POLICY,
      trust:{actorLabelSha256:"",actorProvenance:"not_established",session:"not_exposed",modelVersion:"not_exposed",judgeIdentity:"analyst_attested_unverified"},semanticTruthVerified:false,primaryAuthority:false};
  }
  const enrolled=currentJudgeGate(plan.planId);
  if((judge&&judge.decision!=="PASS")||(!researchJudge&&(enrolled||c1Pilot()))||
    pilotRestriction(plan.planId,judge?.packetEnvelopeDigest,judge?.packetIssuedAt)){
    for(const step of workflow.steps)if(step.kind!=="source_intake"&&step.state==="needs_create"){
      step.state="hold_research_judge";step.safeEditRequest=null;
    }
    workflow.status="hold_research_judge";workflow.readyForNextNews=false;
  }
  return {plan,workflow,judge,enrolled};
}

export function prepareCanonicalWriteback(raw:unknown,actor:string) {
  withdrawCanonicalJudge("prepare_canonical_writeback",raw,actor);
  const input=canonicalInputSchema.parse(raw);
  const {plan,workflow,judge,enrolled}=planned(input,actor);
  if(judge&&judge.decision!=="PASS")revokeMatchingJudge(input,actor,plan.planId,judge.decision);
  const previews=[];
  // Admit the exact Source first, then record semantic eligibility in the
  // existing event journal before ANY Claim/Review preview can be issued.
  const source=workflow.steps.find(s=>s.kind==="source_intake")!;
  const appearancePayload=canonicalAppearance(input,source,plan.planId,actor);
  if(appearancePayload)checkAppearanceRetry(appearancePayload);
  let currentAssessment=true;
  if(judge?.packetEnvelopeDigest)try{assertJudgeAdmissionOrder(enrolled,judge);}catch(error){
    if(judge.decision==="PASS")throw error;
    currentAssessment=false; // Return HOLD diagnostics, never replace newer authority.
  }
  // Invalid packets cannot replace a currently admitted assessment. A matching
  // withdrawal has already expired it above, retaining its exact targets.
  if(input.researchJudge&&judge&&currentAssessment&&(!enrolled||judge.packetEnvelopeDigest)&&
    !(enrolled&&judge.decision!=="PASS"&&judge.packetEnvelopeDigest===enrolled.packetEnvelopeDigest)&&
    (source.state==="needs_create"||source.state==="verified_existing")){
    if(source.state==="needs_create"){
      const p=previewCanonicalSource(source.safeEditRequest,actor);
      previews.push({kind:source.kind,expectedSha256:source.expectedSha256,...p});
    }
    recordResearchJudgeGate(source.receiptKey,actor,{version:JUDGE_VERSION,researchStatePolicy:RESEARCH_STATE_POLICY,riskPolicy:judge.riskPolicy,intakeId:plan.planId,actor,decision:judge.decision,
      packetEnvelopeDigest:judge.packetEnvelopeDigest,packetIssuedAt:judge.packetIssuedAt,resultEnvelopeDigest:judge.resultEnvelopeDigest,
      packetDigest:judge.packetDigest,resultDigest:judge.resultDigest,expiresAt:judge.decision==="PASS"?judge.expiresAt:0,history:judge.history,retrieval:judge.retrieval,scopeWitness:judge.scopeWitness,
      targets:workflow.steps.map(s=>({path:s.path,sha256:s.expectedSha256,operationId:s.receiptKey,kind:s.kind,
        eligible:s.state==="needs_create"||s.state==="verified_existing"}))});
  }
  if(c1Pilot()&&input.researchJudge){const current=currentJudgeGate(plan.planId);if(current?.decision==="PASS"&&current.packetEnvelopeDigest===judge?.packetEnvelopeDigest&&current.resultDigest===judge?.resultDigest)recordPilotAssessment(current,input.researchJudge);}
  for(const step of workflow.steps) {
    if(step.state!=="needs_create")continue;
    if(previews.some(p=>p.kind===step.kind&&p.path===step.path))continue;
    if(!step.safeEditRequest) throw Error("Missing add-only recipe");
    const p=(step.kind==="source_intake"?previewCanonicalSource:step.kind==="canonical_review"?previewCanonicalReview:preview)(step.safeEditRequest,actor);
    if(!p.previewToken) throw Error("Safe Edit did not issue a fresh preview token");
    previews.push({kind:step.kind,expectedSha256:step.expectedSha256,...p});
  }
  const appearance=appearancePayload?recordCanonicalAppearance(appearancePayload,actor):null;
  return {phase:"preview_only",appearance,planId:plan.planId,reviewReuse:plan.reviewReuse,workflowStatus:workflow.status,researchJudge:judge??(enrolled?{decision:"HOLD",reasons:["enrolled_intake_requires_judge_contract"]}:null),
    ...(c1Pilot()?{pilotAdmission:pilotAdmissionSummary(plan.planId,judge?.packetEnvelopeDigest,judge?.packetIssuedAt)}:{}),
    qualityIssues:workflow.qualityIssues,claimIssues:workflow.claimIssues,lineageIssues:workflow.lineageIssues,claimInterpretationBoundary:workflow.claimInterpretationBoundary,readyForNextNews:workflow.readyForNextNews,
    archiveProvenanceStatus:workflow.archiveProvenanceStatus,archiveProvenanceReason:workflow.archiveProvenanceReason,
    steps:workflow.steps.map(({kind,path,state,expectedSha256,receiptKey,researchTrust})=>({kind,path,state,expectedSha256,receiptKey,researchTrust})),
    previews,protectedNotesTouched:false,perDeviceSync:"unverified",writesPerformed:false,
    next:c1Pilot()?"Restricted disposable C1: Source may persist. Non-Source requires the authenticated dashboard's explicit bundle/semantic review at approvalUrl, backend Judge PASS and fresh exact tokens. No human presence or independent critic is established.":"Review exact diffs and authorize apply_canonical_writeback with these tokens; no Vault notes have been written."};
}

export async function applyCanonicalWriteback(raw:unknown,actor:string) {
  withdrawCanonicalJudge("apply_canonical_writeback",raw,actor);
  const args=canonicalApplySchema.parse(raw);
  const {plan,workflow,judge,enrolled}=planned(args.input,actor);
  if(plan.planId!==args.planId) throw Error("Plan identity mismatch; original source or chronology changed");
  if(enrolled&&judge&&enrolled.actor!==actor)throw Error("Operation belongs to another OAuth client");
  if(judge&&judge.decision!=="PASS")revokeMatchingJudge(args.input,actor,plan.planId,judge.decision);
  const appearancePayload=canonicalAppearance(args.input,workflow.steps.find(s=>s.kind==="source_intake")!,plan.planId,actor);
  if(appearancePayload)requireAppearance(appearancePayload);
  // A PASS still requires a fresh matching admission, including the envelope.
  if(judge?.decision==="PASS"&&(!enrolled||enrolled.version!==JUDGE_VERSION||enrolled.researchStatePolicy!==RESEARCH_STATE_POLICY||enrolled.packetDigest!==judge.packetDigest||enrolled.packetEnvelopeDigest!==judge.packetEnvelopeDigest||enrolled.resultDigest!==judge.resultDigest||enrolled.decision!=="PASS"))
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
  let writeAttempts=0;
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
            writeAttempts++;receipts.push(apply(a,actor));
          }
          catch(e) {interrupted=e instanceof Error?e.message:"Safe Edit operation failed";break;}
        }
      });
    } catch(e) {interrupted=e instanceof Error?e.message:"Sync guard refused write";}
  }
  // Re-plan from the unchanged source input; trust disk hash/FTS readback, not
  // mere Safe Edit success or a stale pre-write plan.
  let after=workflow,afterReuse=plan.reviewReuse,workflowVerificationHold=false;
  try{const verified=planned(args.input,actor);after=verified.workflow;afterReuse=verified.plan.reviewReuse;}catch{workflowVerificationHold=true;}
  const appearance=appearancePayload?appearanceReadback(appearancePayload):null;
  const verificationHold=workflowVerificationHold||appearance?.disposition==="binding_hold";
  return {phase:"apply_verified_or_pending",appearance,planId:plan.planId,reviewReuse:afterReuse,
    ...(c1Pilot()?{pilotAdmission:pilotAdmissionSummary(plan.planId,judge?.packetEnvelopeDigest,judge?.packetIssuedAt)}:{}),
    status:verificationHold?"hold_post_write_verification":after.status,readyForNextNews:!verificationHold&&after.readyForNextNews,researchJudge:judge??(enrolled?{decision:"HOLD",reasons:["enrolled_intake_requires_judge_contract"]}:null),
    qualityIssues:after.qualityIssues,claimIssues:after.claimIssues,lineageIssues:after.lineageIssues,claimInterpretationBoundary:after.claimInterpretationBoundary,
    archiveProvenanceStatus:after.archiveProvenanceStatus,archiveProvenanceReason:after.archiveProvenanceReason,
    steps:after.steps.map(({kind,path,state,receiptKey,readbackVerified,indexed,searchable,researchTrust})=>
      ({kind,path,state:workflowVerificationHold?"post_write_verification_hold":state,receiptKey,
        readbackVerified:!workflowVerificationHold&&readbackVerified,indexed:!workflowVerificationHold&&indexed,searchable:!workflowVerificationHold&&searchable,researchTrust})),
    receipts,interrupted,writesPerformed:receipts.length>0?true:writeAttempts>0?"unknown":false,
    writeAttempts,completedWriteReceipts:receipts.length,unverifiedWriteAttempts:writeAttempts-receipts.length,
    workflowVerification:workflowVerificationHold?"HOLD":"readback_completed",protectedNotesTouched:false,perDeviceSync:"unverified",
    outcome:verificationHold?"written_or_pending_verification_hold":after.status==="saved_verified"?"saved_verified":
      after.status==="source_saved_analysis_pending"?"source_saved_analysis_pending":"pending_or_blocked",
    note:"Partial source writes are retained and independently verifiable; retry only pending steps after a fresh preview. Device Sync is not proven."};
}

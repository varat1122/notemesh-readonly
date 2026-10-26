/**
 * M5.3: deterministic, add-only Safe Edit recipe for a completed research item.
 * This is NOT a writer. The authenticated Safe Edit tools must preview and
 * apply each proposed operation, followed by a fresh readback/search check.
 */
import { createHash } from "node:crypto";
import { db } from "../db";
import { readNote } from "./notes";
import { searchVault } from "./queries";
import type { WritebackInput, WritebackPlan } from "./investment-writeback-router";
import {renderThaiResearchM55,validateResearchM55} from "./research-quality-m55";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const yaml=(s:string|null|undefined)=>s==null?"null":JSON.stringify(s);
const unique=<T>(items:T[])=>[...new Set(items)];
const wiki=(path:string)=>`[[${path.slice(0,-3)}]]`;
function safeSubject(s:string){
  return s.normalize("NFC").replace(/[^\p{L}\p{N} ._-]/gu," ")
    .replace(/\s+/g," ").replace(/^\.+|\.+$/g,"").trim().slice(0,66)||"Cross Theme";
}
function originalFence(original:string){
  const max=Math.max(2,...[...(original.match(/`+/g)??[])].map(x=>x.length));
  const fence="`".repeat(max+1);
  return `${fence}text\n${original}${original.endsWith("\n")?"":"\n"}${fence}\n`;
}
export interface CanonicalSafeEditStep {
  kind:"source_intake"|"canonical_review";
  path:string;
  expectedSha256:string;
  receiptKey:string;
  state:"needs_create"|"verified_existing"|"hold_conflict"|"hold_event_review"|"hold_index_repair"|"hold_quality_gate";
  readbackVerified:boolean;
  indexed:boolean;
  searchable:boolean;
  safeEditRequest:{
    operationId:string;path:string;reason:string;
    change:{kind:"create";content:string};
  }|null;
}
export interface CanonicalSafeEditWorkflow {
  version:"M5.3-recipe";
  status:"pending_safe_edit"|"saved_verified"|"pending_source_capture"|
    "source_saved_analysis_pending"|"hold_source_event_review"|
    "hold_conflict_or_index"|"hold_research_quality";
  sourceChat:string;
  steps:CanonicalSafeEditStep[];
  readyForNextNews:boolean;
  analysisComplete:boolean;
  writesPerformedByPlanner:false;
  protectedNotesTouched:false;
  sourcePreservation:"text_input"|"text_only_binary_not_verified"|"text_plus_verified_user_attachment";
  perDeviceSync:"unverified";
  instructions:string[];
  qualityIssues:string[];
}

function inspect(path:string,content:string,tag:string){
  const indexed=Boolean(db().prepare("SELECT 1 FROM notes WHERE path=? LIMIT 1").get(path));
  const fts=Boolean(db().prepare("SELECT 1 FROM notes_fts WHERE path=? LIMIT 1").get(path));
  let existing:string|null=null;
  try {existing=readNote(path).content;}catch{/* Not written or cannot be read. */}
  const hashOK=existing!==null&&sha(existing)===sha(content);
  let searchable=false;
  if(indexed&&fts){
    try {searchable=searchVault(tag,{limit:50}).hits.some(x=>x.path===path);}catch{/* Fail closed. */}
  }
  return {exists:existing!==null,indexed:indexed&&fts,hashOK,searchable};
}
function toStep(kind:CanonicalSafeEditStep["kind"],path:string,content:string,tag:string,
  hold:boolean):CanonicalSafeEditStep{
  const check=inspect(path,content,tag),digest=sha(content);
  const state:CanonicalSafeEditStep["state"]=check.exists?
    !check.hashOK?"hold_conflict":!check.indexed||!check.searchable?"hold_index_repair":"verified_existing":
    hold?"hold_event_review":"needs_create";
  // Operation IDs are deterministic across model retries but never reused for
  // changed content. A changed existing note is a conflict, not an overwrite.
  const operationId="ICW-"+sha([kind,path,digest].join("\n")).slice(0,32);
  return {kind,path,expectedSha256:digest,receiptKey:operationId,state,
    readbackVerified:check.hashOK,indexed:check.indexed,searchable:check.searchable,
    safeEditRequest:state==="needs_create"?{operationId,path,
      reason:"M5.3 attributed investment source/review: add-only; no Thesis, Evidence Register, Portfolio or automatic Company Timeline edits",
      change:{kind:"create",content}}:null};
}

export function buildCanonicalSafeEditWorkflow(
  input:WritebackInput,plan:WritebackPlan
):CanonicalSafeEditWorkflow{
  const analysis=input.completedAnalysis?.trim();
  const sourceChat=input.sourceChat?.trim();
  const captureOnly=input.captureOnly===true;
  if((!analysis&&!input.researchReview&&!captureOnly)||(analysis&&analysis.length>30000)||!sourceChat||sourceChat.length>120)
    throw Error("M5.3 requires sourceChat and either captureOnly or completedAnalysis before a Safe Edit recipe");
  const rawPath=plan.routes.find(x=>x.kind==="raw_input")?.path;
  if(!rawPath)throw Error("A deterministic source path is required");
  // Stable from explicit caller scope, not from mutable index/search results.
  const subject=input.researchReview?plan.routingV2.preferredReviewSubject:plan.domain==="industry"?input.themes?.[0]??"Cross Theme":
    plan.domain==="company"&&input.entities.length===1?input.entities[0]:
    plan.domain==="macro"?input.entities[0]:
    plan.domain==="asset"?"Asset Research":"Cross Theme";
  // M5.5 typed contracts route by the resolved *primary* subject role, not
  // by the count of incidental company mentions. Preserve the legacy freeform
  // path algorithm for compatibility with already-issued historical receipts.
  const folder=plan.domain==="macro"?"10_Knowledge/Macro and Markets":
    plan.domain==="company"&&(input.researchReview?
      plan.routingV2.reviewScope==="company":input.entities.length===1)?"10_Knowledge/Company Research":
      "10_Knowledge/Industry and Concepts";
  const reviewPath=`${folder}/Investment Review - ${safeSubject(subject)} - ${plan.planId}.md`;
  const tag="InvestmentIntake"+plan.planId.slice(3);
  const event=plan.chronology.eventDate,published=plan.chronology.publicationDate;
  const attachment=plan.sourceCapture.attachmentVerified?"hash_readback_verified_user_bytes":"not_verified";
  const proposedSourceContent=[
    "---","type: investment_source_intake","source_type: user_supplied",
    "verification: not_reverified","status: user_input_not_publisher_verified",
    `intake_id: ${yaml(plan.planId)}`,`source_chat: ${yaml(sourceChat)}`,
    `source_kind: ${yaml(plan.sourceKind)}`,`input_format: ${yaml(plan.inputFormat)}`,
    `source_language: ${yaml(plan.sourceLanguage)}`,`attributed_publisher: ${yaml(input.publisher)}`,
    `source_url: ${yaml(input.sourceUrl)}`,`event_date: ${yaml(event)}`,
    `published_at: ${yaml(published)}`,`attachment_status: ${yaml(attachment)}`,
    `attachment_path: ${yaml(plan.sourceCapture.rawAttachmentPath)}`,
    `source_text_sha256: ${sha(input.extractedText)}`,"---","",
    `# Attributed User Source — ${plan.planId}`,"",
    `Source token: ${tag}`,"",
    "## User-supplied original language text","",
    originalFence(input.extractedText),
    "## Evidence boundary","",
    "The submitted text and attribution are preserved, but issuer/broker authenticity and claim truth were not independently verified by this receipt.",""
  ].join("\n");
  // M5.6: a proven prior Source receipt is immutable. Do not regenerate it
  // with today's publisher label, sourceChat or classification and then call
  // the changed whole-note hash a conflict; link its exact readback bytes.
  let sourceContent=proposedSourceContent;
  if(plan.sourceIdentity.existingSourcePath){
    if(plan.sourceIdentity.existingSourcePath!==rawPath)throw Error("M56_SOURCE_PATH_MISMATCH");
    sourceContent=readNote(rawPath).content;
    if(sha(sourceContent)!==plan.sourceIdentity.existingSourceSha256)
      throw Error("M56_SOURCE_CHANGED_DURING_PLAN");
  }
  const companyLinks=plan.routingV2.companyHubs.map(x=>`- ${wiki(x.path)} — ${x.role??"mentioned"}, caller-declared`);
  const themeLinks=plan.routingV2.industryHubs.map(x=>`- ${wiki(x.path)} — existing industry context`);
  const qualityIssues=input.researchReview?validateResearchM55({
    domain:plan.domain,subject,contentTypes:input.contentTypes??[],
    resolvedSubjectPath:plan.routingV2.reviewScope==="industry"?plan.routingV2.industryHubs[0]?.path:
      plan.routingV2.reviewScope==="company"?plan.routingV2.companyHubs[0]?.path:undefined,
    companyHubPaths:plan.routingV2.companyHubs.map(x=>x.path),
    industryHubPaths:plan.routingV2.industryHubs.map(x=>x.path),
    sourceChannel:input.sourceChannel??"",
    attributedOrigin:input.attributedOrigin,
    originalDocumentAccess:input.originalDocumentAccess,sourceLanguage:plan.sourceLanguage
  },input.researchReview):[];
  const broker=input.brokerUpdate;
  const brokerLines=broker?[
    "## Attributed broker version (not independently verified)","",
    `- Bank: ${broker.bank}; report: ${broker.reportDate??"unknown"}; prior bank: ${broker.priorBank??"unknown"}; prior report: ${broker.priorReportDate??"unknown"}`,
    `- Rating: ${broker.priorRating??"unknown"} → ${broker.rating??"unknown"}`,
    `- PT: ${broker.priorTargetPrice??"unknown"} ${broker.priorCurrency??""} → ${broker.targetPrice??"unknown"} ${broker.currency??""}; version classification: ${plan.routingV2.brokerRevision.status}`,
    ...plan.routingV2.brokerRevision.estimateRows.map(row=>
      `- ${row.metric} ${row.period}: ${row.oldValue} → ${row.newValue} ${row.unit} (attributed vintages)`),
    ""
  ]:[];
  const reviewContent=[
    "---","type: investment_research_review","source_type: chatgpt_analysis",
    "verification: not_reverified","status: analyst_review_not_user_endorsed",
    `intake_id: ${yaml(plan.planId)}`,`source_chat: ${yaml(sourceChat)}`,
    `source_kind: ${yaml(plan.sourceKind)}`,`attributed_publisher: ${yaml(input.publisher)}`,
    ...(input.researchReview?[
      `source_channel: ${yaml(input.sourceChannel??plan.sourceKind)}`,
      `attributed_origin: ${yaml(input.attributedOrigin??input.publisher)}`,
      `original_document_access: ${yaml(input.originalDocumentAccess??"not_obtained")}`
    ]:[]),
    `event_date: ${yaml(event)}`,`published_at: ${yaml(published)}`,
    `review_scope: ${yaml(plan.routingV2.reviewScope)}`,
    `content_types: ${JSON.stringify(unique(input.contentTypes??[]))}`,
    ...(input.researchReview?[
      `company_hubs: ${JSON.stringify(plan.routingV2.companyHubs.map(x=>x.path))}`,
      `industry_hubs: ${JSON.stringify(plan.routingV2.industryHubs.map(x=>x.path))}`
    ]:[]),
    `original_source_path: ${yaml(rawPath)}`,"---","",
    `# Investment Review — ${safeSubject(subject)} — ${plan.planId}`,"",
    `Source token: ${tag}`,"",
    "## Source provenance","",
    `- Exact user-supplied source: ${wiki(rawPath)}`,
    `- Original publication/source authentication: not verified by this workflow`,
    `- Event date: ${event??"unknown"}; publication date: ${published??"unknown"}`,
    "","## Research analysis (AI interpretation; not approved Thesis)","",
    input.researchReview?renderThaiResearchM55(input.researchReview):analysis??"Analysis pending.","",
    ...brokerLines,
    "## Canonical knowledge links","",
    ...companyLinks,...themeLinks,
    ...(companyLinks.length||themeLinks.length?[]:["- No existing Company/Industry Hub was resolved; owner review of entity mapping required."]),
    "","## Ingestion safety","",
    "- Linked companies are not independent new events or verified customer/supplier relationships.",
    "- This note does not change Current Thesis, Evidence Register, Portfolio or Company Evolution Timeline.",
    "- Duplicate, pricing, market expectation and broker versions still require original-source adjudication.",""
  ].join("\n");
  const hasSourceMatch=plan.sourceEventReview.status==="possible_same_source_event_candidates"||
    plan.exactClaimReview.classification==="duplicate_candidate";
  // A previously imported generic review with the same intake ID must be
  // reconciled before adding a second canonically located review.
  const legacy=plan.routes.find(x=>x.kind==="research_review")?.path;
  const otherCanonical=db().prepare(`SELECT path FROM notes WHERE json_valid(frontmatter)=1
    AND json_extract(frontmatter,'$.intake_id')=? AND path<>? AND path<>? LIMIT 1`)
    .get(plan.planId,rawPath,reviewPath) as {path:string}|undefined;
  const legacyConflict=Boolean(legacy&&legacy!==reviewPath&&
    db().prepare("SELECT 1 FROM notes WHERE path=? LIMIT 1").get(legacy))||Boolean(otherCanonical);
  const sourceStep=toStep("source_intake",rawPath,sourceContent,tag,false);
  const reviewStep=captureOnly?null:toStep("canonical_review",reviewPath,reviewContent,tag,hasSourceMatch||legacyConflict);
  if(reviewStep&&qualityIssues.length){
    reviewStep.state="hold_quality_gate";
    reviewStep.safeEditRequest=null;
  }
  const steps=reviewStep?[sourceStep,reviewStep]:[sourceStep];
  const saved=steps.every(x=>x.state==="verified_existing");
  const blocked=steps.some(x=>x.state==="hold_conflict"||x.state==="hold_index_repair");
  const reviewHeld=reviewStep?.state==="hold_event_review";
  const qualityHeld=reviewStep?.state==="hold_quality_gate";
  return {
    version:"M5.3-recipe",status:blocked?"hold_conflict_or_index":
      captureOnly?(saved?"source_saved_analysis_pending":"pending_source_capture"):
      qualityHeld?"hold_research_quality":
      saved?"saved_verified":
      reviewHeld?"hold_source_event_review":"pending_safe_edit",
    sourceChat,steps,readyForNextNews:saved&&!qualityHeld,analysisComplete:!captureOnly&&saved&&!qualityHeld,writesPerformedByPlanner:false,
    qualityIssues,
    protectedNotesTouched:false,
    sourcePreservation:plan.inputFormat==="text"?"text_input":
      plan.sourceCapture.attachmentVerified?"text_plus_verified_user_attachment":"text_only_binary_not_verified",
    perDeviceSync:"unverified",
    instructions:[
      "For each needs_create step, call the existing Safe Edit preview_edit tool with the exact safeEditRequest, then apply_edit using its token and beforeHash, in source-then-review order; never assume this read-only recipe wrote anything.",
      "For captureOnly, save and verify just the attributed raw Source. Return source_saved_analysis_pending, not a completed Research Review. Later retry the SAME source with completedAnalysis to create the linked review without duplicating the Source.",
      "After each apply, require receipt.write/readback/reindex all verified. Retry by re-running this planner and checking hashes; never overwrite a changed note.",
      "If hold_event_review, reconcile original economic event/source and old broker vintage before a new canonical review. Preserve the raw source independently.",
      "Run this planner again after writes: only saved_verified and readyForNextNews=true prove server file/readback/search index for both required notes. For screenshot/PDF without a hash-verified attachment this is TEXT-ONLY preservation; per-device Obsidian Sync still unverified.",
      "Existing Company/Industry Hub links are bidirectional Obsidian backlinks; this workflow does not imply a material Company Timeline update or revise protected files."
    ]
  };
}

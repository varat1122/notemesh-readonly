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
import {sourceArchiveReviewLines} from "./source-archive-provenance-p0";
import {planClaimNotes,lineageMetadata,readPersistedClaim,claimInterpretationBoundary} from "./canonical-claims";
import {revalidateHistoricalArchive} from "./canonical-archive-revalidation";

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
  kind:"source_intake"|"canonical_review"|"structured_claim";
  path:string;
  expectedSha256:string;
  receiptKey:string;
  state:"needs_create"|"verified_existing"|"hold_conflict"|"hold_event_review"|"hold_index_repair"|"hold_quality_gate"|"hold_archive_provenance"|"hold_archive_drift"|"hold_claim_gate"|"hold_review_lineage"|"hold_research_judge";
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
    "hold_conflict_or_index"|"hold_research_quality"|"hold_archive_provenance"|"hold_archive_drift"|"hold_claim_persistence"|"hold_review_lineage"|"hold_research_judge";
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
  claimIssues:string[];
  lineageIssues:string[];
  claimInterpretationBoundary:typeof claimInterpretationBoundary;
  archiveProvenanceStatus:WritebackPlan["sourceCapture"]["archiveProvenanceStatus"];
  archiveProvenanceReason:WritebackPlan["sourceCapture"]["archiveProvenanceReason"];
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
  const claimNotes=planClaimNotes(input,plan.planId,rawPath);
  const {metadata:researchLineage,issues:lineageIssues}=captureOnly?{metadata:{},issues:[]}:lineageMetadata(input,reviewPath,rawPath,claimNotes);
  const claimIssues=[...new Set(claimNotes.flatMap(c=>c.issues))];
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
    originalDocumentAccess:input.originalDocumentAccess,sourceLanguage:plan.sourceLanguage,
    sourceKind:plan.sourceKind,entityScope:plan.entityScope
  },input.researchReview,input.extractedText):captureOnly?[]:["typed_research_review_required"];
  const sourceArchiveLines=sourceArchiveReviewLines(plan.sourceCapture.originalSourceArchive);
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
  const renderReview=(legacy=false)=>[
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
    `original_source_path: ${yaml(rawPath)}`,
    ...(claimNotes.length?[`claim_ids: ${JSON.stringify(claimNotes.map(c=>c.id))}`,`claim_paths: ${JSON.stringify(claimNotes.map(c=>c.path))}`,"origin_independence_increment: 0"]:[]),
    ...Object.entries(researchLineage).map(([k,v])=>`${k}: ${JSON.stringify(v)}`),"---","",
    (legacy?`# Investment Review — ${safeSubject(subject)} — ${plan.planId}`:`# บทวิเคราะห์การลงทุน — ${safeSubject(subject)} — ${plan.planId}`),"",
    `Source token: ${tag}`,"",
    (legacy?"## Source provenance":"## ที่มาของต้นฉบับ"),"",
    `- Exact user-supplied source: ${wiki(rawPath)}`,
    `- Original publication/source authentication: not verified by this workflow`,
    ...sourceArchiveLines,
    `- Event date: ${event??"unknown"}; publication date: ${published??"unknown"}`,
    "",(legacy?"## Research analysis (AI interpretation; not approved Thesis)":"## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)"),"",
    input.researchReview?renderThaiResearchM55(input.researchReview,legacy):analysis??"Analysis pending.","",
    ...brokerLines.map(line=>!legacy&&line.startsWith("## ")?"## ข้อมูลโบรกเกอร์ที่อ้างถึง (ยังไม่ได้ตรวจสอบโดยอิสระ)":line),
    (legacy?"## Canonical knowledge links":"## การเชื่อมโยงความรู้"),"",
    ...companyLinks,...themeLinks,
    ...claimNotes.map(c=>`- ${wiki(c.path)} — ${c.id} (ข้ออ้างที่ยังไม่ยืนยัน ไม่ใช่หลักฐานอิสระเพิ่ม)`),
    ...(companyLinks.length||themeLinks.length?[]:["- No existing Company/Industry Hub was resolved; owner review of entity mapping required."]),
    "",(legacy?"## Ingestion safety":"## ขอบเขตความปลอดภัยในการบันทึก"),"",
    "- Linked companies are not independent new events or verified customer/supplier relationships.",
    "- This note does not change Current Thesis, Evidence Register, Portfolio or Company Evolution Timeline.",
    "- Duplicate, pricing, market expectation and broker versions still require original-source adjudication.",""
  ].join("\n");
  const reviewContent=renderReview();
  const sourceStep=toStep("source_intake",rawPath,sourceContent,tag,false);
  // After Source-only capture the original Source receipt itself appears in
  // exact URL/date discovery. Never hold its first linked Research Review merely
  // because it found its own immutable, independently re-read Source. Another
  // Source path, an incomplete candidate scan, or an independent claim duplicate
  // must still be reviewed. No semantic duplicate is auto-adjudicated here.
  const ownSourceReceipt=plan.sourceIdentity.existingSourcePath===rawPath&&
    sourceStep.state==="verified_existing";
  const ownClaimPaths=new Set(unique([...claimNotes.map(c=>c.path),...plan.sourceEventReview.candidatePaths]).flatMap(p=>{try{
    const saved=readPersistedClaim(p);return saved.intakeId===plan.planId&&saved.sourcePath===rawPath?[p]:[];
  }catch{return [];}}));
  const otherSourceCandidate=plan.sourceEventReview.candidatePaths.some(p=>p!==rawPath&&!ownClaimPaths.has(p));
  const hasSourceMatch=(plan.sourceEventReview.status==="possible_same_source_event_candidates"&&
      (!ownSourceReceipt||otherSourceCandidate||plan.sourceEventReview.scanTruncated))||
    plan.exactClaimReview.classification==="duplicate_candidate";
  // A previously imported generic review with the same intake ID must be
  // reconciled before adding a second canonically located review.
  const legacy=plan.routes.find(x=>x.kind==="research_review")?.path;
  const otherCanonical=db().prepare(`SELECT path FROM notes WHERE json_valid(frontmatter)=1
    AND json_extract(frontmatter,'$.intake_id')=? AND path<>? AND path<>? ${claimNotes.map(()=>"AND path<>?").join(" ")} LIMIT 1`)
    .get(plan.planId,rawPath,reviewPath,...claimNotes.map(c=>c.path)) as {path:string}|undefined;
  const legacyConflict=Boolean(legacy&&legacy!==reviewPath&&
    db().prepare("SELECT 1 FROM notes WHERE path=? LIMIT 1").get(legacy))||Boolean(otherCanonical);
  const reviewStep=captureOnly?null:toStep("canonical_review",reviewPath,reviewContent,tag,hasSourceMatch||legacyConflict);
  const archiveHold=plan.sourceCapture.archiveProvenanceStatus==="HOLD";
  if(reviewStep&&(reviewStep.state==="hold_conflict"||archiveHold&&reviewStep.state==="verified_existing")){
    const historical=revalidateHistoricalArchive(reviewPath,reviewContent,plan.sourceCapture.originalSourceArchive,archiveHold)??
      revalidateHistoricalArchive(reviewPath,renderReview(true),plan.sourceCapture.originalSourceArchive,archiveHold);
    if(historical){
      const check=inspect(reviewPath,historical.content,tag);
      reviewStep.state=!check.hashOK?"hold_conflict":!check.indexed||!check.searchable?"hold_index_repair":historical.state;
      reviewStep.expectedSha256=sha(historical.content);
      reviewStep.receiptKey=historical.receiptKey;
      reviewStep.readbackVerified=check.hashOK;
      reviewStep.indexed=check.indexed;reviewStep.searchable=check.searchable;
      reviewStep.safeEditRequest=null;
    }
  }
  // Current provenance HOLD blocks new Review, while Source capture is independent.
  if(reviewStep&&archiveHold&&(reviewStep.state==="needs_create"||reviewStep.state==="verified_existing")){
    reviewStep.state="hold_archive_provenance";reviewStep.safeEditRequest=null;
  }
  // Whole-note SHA and FTS prove bytes/indexing, but NOT Obsidian graph integrity.
  // A canonical Review must have a real resolved backlink to its immutable
  // Source. An FTS-fresh note with a stale/missing link index is not ready.
  if(reviewStep?.state==="verified_existing"||reviewStep?.state==="hold_archive_drift"){
    const hasResolvedSourceLink=Boolean(db().prepare(
      "SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1"
    ).get(reviewPath,rawPath));
    if(!hasResolvedSourceLink){
      reviewStep.state="hold_index_repair";
      reviewStep.safeEditRequest=null;
    }
  }
  if(reviewStep&&qualityIssues.length){
    // Keep an existing conflict, index-repair or event-review hold visible.
    // qualityIssues carries the additional quality blocker without erasing
    // the repair action already established by byte/link inspection.
    if(reviewStep.state==="needs_create"||reviewStep.state==="verified_existing")
      reviewStep.state="hold_quality_gate";
    reviewStep.safeEditRequest=null;
  }
  const claimSteps=claimNotes.map(c=>{
    const step=toStep("structured_claim",c.path,c.content,tag,false);
    if(hasSourceMatch&&step.state==="needs_create"){
      step.state="hold_event_review";step.safeEditRequest=null;
      claimIssues.push("claim_source_event_reconciliation_required");
    }
    if((c.issues.length||!["needs_create","verified_existing"].includes(sourceStep.state))&&(step.state==="needs_create"||step.state==="verified_existing")){step.state="hold_claim_gate";step.safeEditRequest=null;}
    if(step.state==="verified_existing")try{readPersistedClaim(c.path);}catch{step.state="hold_index_repair";step.safeEditRequest=null;claimIssues.push("claim_receipt_readback_index_link_unverified");}
    return step;
  });
  const claimHeld=claimSteps.some(s=>s.state!=="needs_create"&&s.state!=="verified_existing");
  if(reviewStep&&claimHeld){if(reviewStep.state==="needs_create"||reviewStep.state==="verified_existing")reviewStep.state="hold_claim_gate";reviewStep.safeEditRequest=null;}
  if(reviewStep?.state==="verified_existing")for(const c of claimNotes){
    if(!db().prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=?").get(reviewPath,c.path)){
      reviewStep.state="hold_index_repair";reviewStep.safeEditRequest=null;claimIssues.push("review_claim_link_missing");
    }
  }
  // A lineage failure never prevents independent Source/Claim readback and
  // never authorizes replacement of a historical Review or receipt.
  if(reviewStep&&lineageIssues.length){reviewStep.state="hold_review_lineage";reviewStep.safeEditRequest=null;}
  const steps=reviewStep?[sourceStep,...claimSteps,reviewStep]:[sourceStep,...claimSteps];
  const saved=steps.every(x=>x.state==="verified_existing");
  const blocked=steps.some(x=>x.state==="hold_conflict"||x.state==="hold_index_repair");
  const reviewHeld=reviewStep?.state==="hold_event_review";
  const qualityHeld=reviewStep?.state==="hold_quality_gate";
  const archiveState=reviewStep?.state==="hold_archive_drift"||reviewStep?.state==="hold_archive_provenance"?reviewStep.state:null;
  return {
    version:"M5.3-recipe",status:lineageIssues.length?"hold_review_lineage":blocked?"hold_conflict_or_index":
      (reviewHeld||claimSteps.some(s=>s.state==="hold_event_review"))&&claimHeld?"hold_source_event_review":claimHeld?"hold_claim_persistence":captureOnly?(saved?"source_saved_analysis_pending":"pending_source_capture"):
      archiveState??(qualityHeld?"hold_research_quality":
      saved?"saved_verified":
      reviewHeld?"hold_source_event_review":"pending_safe_edit"),
    sourceChat,steps,readyForNextNews:saved&&!(captureOnly&&claimNotes.length)&&!qualityHeld&&!archiveHold&&!archiveState,analysisComplete:!captureOnly&&saved&&!qualityHeld&&!archiveHold&&!archiveState,writesPerformedByPlanner:false,
    lineageIssues,claimInterpretationBoundary,qualityIssues,claimIssues:[...new Set(claimIssues)],archiveProvenanceStatus:plan.sourceCapture.archiveProvenanceStatus,
    archiveProvenanceReason:plan.sourceCapture.archiveProvenanceReason,
    protectedNotesTouched:false,
    sourcePreservation:plan.inputFormat==="text"?"text_input":
      plan.sourceCapture.attachmentVerified?"text_plus_verified_user_attachment":"text_only_binary_not_verified",
    perDeviceSync:"unverified",
    instructions:[
      "Use prepare_canonical_writeback then apply_canonical_writeback for Source → requested Claims → Review; runtime-lineage Reviews cannot be admitted through generic preview_edit. Fresh prepare renews expired owner authorization without backdating analysis; never assume this read-only recipe wrote anything.",
      "For captureOnly, save and verify the attributed raw Source and any explicitly requested unverified Claims. Return source_saved_analysis_pending, not a completed Research Review. Later retry the SAME source with typed researchReview to create the linked review without duplicating the Source.",
      "After each apply, require receipt.write/readback/reindex all verified, plus the indexed canonical Review→Source Obsidian link. Retry by re-running this planner and checking hashes; never overwrite a changed note.",
      "If hold_event_review, reconcile original economic event/source and old broker vintage before new Claims or a canonical Review. A new appearance is not independent evidence; semantic materiality/correction requires reviewer adjudication. Preserve the raw source independently.",
      "If hold_review_lineage, preserve all receipts and Source/Claims; inspect lineageIssues and use a separately authorized reconciliation for ambiguous/invalid historical chronology. Never edit the journal to clear HOLD.",
      "Run this planner again after writes: only saved_verified and readyForNextNews=true prove server file/readback/search index for all requested notes. For screenshot/PDF without a hash-verified attachment this is TEXT-ONLY preservation; per-device Obsidian Sync still unverified.",
      "Existing Company/Industry Hub links are bidirectional Obsidian backlinks; this workflow does not imply a material Company Timeline update or revise protected files."
    ]
  };
}

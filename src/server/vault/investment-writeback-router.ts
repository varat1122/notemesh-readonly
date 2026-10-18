/**
 * Read-only intake routing for multilingual user-supplied investment material.
 * ChatGPT/another analyst supplies text it actually extracted from a
 * screenshot/PDF; this service CANNOT see, archive or independently verify
 * the attachment unless a separate archive/write receipt says otherwise.
 * Never edits the vault or upgrades protected investment decisions.
 */
import { createHash } from "node:crypto";
import { db } from "../db";
import { buildInvestmentContextPack, type Focus } from "./investment-context";
import { reviewInvestmentClaim, type Domain, type ReviewClass } from "./investment-claim-review";
import { inspectUserAttachment, type AttachmentType } from "../user-attachment-vault";
import { buildCoordinatedWriteback, type CoordinatedWriteback } from "./investment-writeback-coordination";
import { composeWritebackDrafts, type DraftPacket } from "./investment-writeback-drafts";

export type IntakeFormat = "text"|"screenshot"|"pdf"|"mixed";
export type IntakeSource = "broker_research"|"issuer_release"|"regulatory_filing"|"news_media"|"user_commentary"|"archived_chat"|"unknown";
export interface WritebackInput {
  domain:Domain;
  entities:string[];
  topic:string;
  inputFormat:IntakeFormat;
  sourceKind:IntakeSource;
  extractedText:string;
  analysisText?:string|null; // Explicit analyst-authored interpretation, never inferred by the server
  sourceLanguage?:string|null;
  sourceUrl?:string|null;
  publisher?:string|null;
  eventDate?:string|null;
  publicationDate?:string|null;
  rawAttachmentPath?:string|null;
  rawAttachmentSha256?:string|null;
  rawAttachmentContentType?:AttachmentType|null;
  claim?:{metric:string;period:string;statement:string;value?:string;unit?:string};
  focus?:Focus;
}
type Route={kind:"raw_input"|"research_review"|"company_timeline_candidate"|"industry_context_candidate"|"claim_registry_candidate";
  action:"candidate_create"|"candidate_append_after_review"|"link_existing_or_hold";
  path:string|null;reason:string;requiresReview:boolean};
export interface WritebackPlan {
  status:"read_only_plan_not_written";
  coordination:CoordinatedWriteback;
  safeEditDrafts:DraftPacket;
  planId:string;
  entityScope:string[];
  domain:Domain;
  inputFormat:IntakeFormat;
  sourceKind:IntakeSource;
  sourceLanguage:string|null;
  sourceCapture:{
    textDigest:string;
    extractedTextIsOriginalBinary:false;
    rawAttachmentPath:string|null;
    attachmentVerified:boolean;
    originalSourceVerified:false;
    preservation:"needs_safe_edit_raw_capture"|"stored_original_user_bytes";
  };
  chronology:{
    eventDate:string|null;publicationDate:string|null;
    importedAt:"not_yet_written";
  };
  historical:{
    source:"bounded_lexical_context_not_exhaustive";
    selected:number;
    paths:string[];
    missing:string[];
  };
  exactClaimReview:{status:"not_checked_missing_exact_fields"|"checked_indexed_claim_candidates";
    classification:ReviewClass|null;matchingClaimPaths:string[];scanTruncated:boolean|null};
  routes:Route[];
  gates:{
    fullSourceRead:boolean;
    attachmentArchived:boolean;
    duplicateAdjudicated:boolean;
    sourceIndependenceVerified:boolean;
    canAutoUpdateThesis:false;
    protectedThesisApprovalRequired:true;
    canAutoWrite:false;
  };
  warnings:string[];
  nextActions:string[];
}
const T=(s:string)=>s.trim().normalize("NFC");
const validDate=(s:string|null|undefined)=>{
  if(!s)return null;
  if(!/^\d{4}-\d\d-\d\d$/.test(s))throw Error("eventDate/publicationDate must be YYYY-MM-DD or null");
  const d=new Date(s+"T00:00:00Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error("invalid calendar date");
  return s;
};
const safeTicker=(v:string)=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,17}$/.test(v)?v.toUpperCase():null;
const MAX_TEXT=12000;
export function planInvestmentWriteback(input:WritebackInput):WritebackPlan{
  if(!input.entities.length||input.entities.length>6||input.entities.some(x=>T(x).length<1||x.length>120))
    throw Error("Provide 1-6 nonempty declared entities or domains, never infer an issuer from co-mentions");
  if(!T(input.topic)||input.topic.length>250)throw Error("topic must be 1-250 characters");
  if(!T(input.extractedText)||input.extractedText.length>MAX_TEXT)
    throw Error("Provide faithful extractedText, 1 to 12000 characters");
  if(input.analysisText&&input.analysisText.length>14000)throw Error("analysisText max 14000 characters");
  if(input.sourceUrl&&input.sourceUrl.length>1000)throw Error("sourceUrl too long");
  if(input.rawAttachmentPath&&input.rawAttachmentPath.length>600)throw Error("attachment path too long");
  if(Boolean(input.rawAttachmentSha256)!==Boolean(input.rawAttachmentContentType))
    throw Error("rawAttachmentSha256 and rawAttachmentContentType must be supplied together");
  const attachment=input.rawAttachmentSha256&&input.rawAttachmentContentType?
    inspectUserAttachment({sha256:input.rawAttachmentSha256,contentType:input.rawAttachmentContentType}):null;
  if(attachment&&input.rawAttachmentPath&&attachment.path!==input.rawAttachmentPath)
    throw Error("raw_attachment_path_digest_mismatch");
  const verifiedAttachment=Boolean(attachment?.byteReadbackVerified);
  const actualAttachmentPath=attachment?.path??input.rawAttachmentPath??null;
  const eventDate=validDate(input.eventDate);
  const publicationDate=validDate(input.publicationDate);
  const text=T(input.extractedText);
  const entities=[...new Set(input.entities.map(T))];
  const digest=createHash("sha256").update([
    "investment_os_intake_v2_exact_user_text",input.domain,input.inputFormat,input.sourceKind,
    ...entities.map(x=>x.toLowerCase()),T(input.sourceUrl||""),T(input.rawAttachmentSha256||""),
    // Hash exact UTF-8 user-supplied text, including leading/trailing whitespace.
    // Idempotency MUST NOT merge two distinct byte-level original captures.
    input.extractedText
  ].join("\n")).digest("hex");
  const planId="IN-"+digest.slice(0,16).toUpperCase();
  const rawPath="00_Inbox/ChatGPT/Investment Intake - "+planId+".md";
  // Same digest is a stable idempotency key across repeated routing calls.
  const subject=entities.length===1?safeTicker(entities[0]):null;
  const researchFolder=input.domain==="macro"?"10_Knowledge/Macro and Markets":
    input.domain==="company"&&subject?"10_Knowledge/Company Research":
    "10_Knowledge/Industry and Concepts";
  const reviewPath=researchFolder+"/Investment Review - "+(subject??"Cross Theme")+" - "+planId+".md";
  const timelinePath=subject&&input.domain==="company"?
    "08_Daily_Weekly/Research Indexes/Company Evolution - "+subject+".md":null;
  const exists=(path:string)=>Boolean(db().prepare("SELECT 1 FROM notes WHERE path=? LIMIT 1").get(path));
  const rawExists=exists(rawPath),reviewExists=exists(reviewPath),timelineExists=timelinePath?exists(timelinePath):false;
  const focus=input.focus??(input.sourceKind==="broker_research"?"broker":input.domain==="macro"?"macro":"general");
  const pack=buildInvestmentContextPack({
    question:(T(input.topic)+" "+entities.join(" ")+" "+text.slice(0,450)).slice(0,1150),
    issuers:input.domain==="company"?entities.map(safeTicker).filter((x):x is string=>!!x).slice(0,6):[],
    industry:input.domain==="company"?undefined:entities.join(" / ").slice(0,140),
    focus,maxNotes:10,maxChars:8500
  });
  const claim=input.claim;
  const claimReady=Boolean(claim&&T(claim.metric)&&T(claim.period)&&T(claim.statement).length>=8&&
    claim.value?.trim()&&claim.unit?.trim()&&input.sourceUrl?.trim()&&entities.length===1);
  let classification:ReviewClass|null=null,matched:string[]=[],truncated:boolean|null=null;
  if(claimReady&&claim){
    const c=reviewInvestmentClaim({
      domain:input.domain,entity:entities[0],metric:claim.metric,period:claim.period,
      statement:claim.statement,originalSource:input.sourceUrl!,value:claim.value,unit:claim.unit,
      eventDate, publishedAt:publicationDate,focus,maxCandidates:8
    });
    classification=c.classification;
    matched=[...new Set(c.matchingClaims.map(x=>x.path))].slice(0,8);
    truncated=c.metadataScan.truncated;
  }
  const duplicates=classification==="duplicate_candidate";
  const warnings=[
    "Input and any source labels are user/analyst supplied; no issuer, broker report, translation or number independently verified.",
    "Input language is only caller-declared; do not silently translate, paraphrase or claim unreadable screenshot portions were extracted.",
    verifiedAttachment?"Original user attachment bytes are already preserved in the Vault and hash-readback verified; this is not publisher verification or OCR.":"Image/PDF binary is NOT verified by this router without matching archived user attachment digest; transcription is not original bytes.",
    "Do not promote broker PT to company guidance, forecast to realized earnings, or announced investments to completed spending.",
    "Dates are supplied, not inferred from the chat date. Owner-approved thesis and market price-in require separate evidence.",
    "Historical pointers are bounded lexical discovery; missed prior broker PTs, same-event reposts and counter-evidence remain possible."
  ];
  if(input.sourceKind==="broker_research")
    warnings.push("Broker model/version dedup requires exact bank, report date, prior same-bank PT, EPS vintage and actual report; 'reiterates' is not a new PT raise.");
  if(input.sourceKind==="issuer_release"||input.sourceKind==="regulatory_filing")
    warnings.push("Source URL supplied is not proof that the original was fetched or verified.");
  if(!input.sourceUrl)warnings.push("Original source URL absent; screenshots and snippets are attributed inputs, not independently validated source records.");
  if(input.inputFormat!=="text"&&!verifiedAttachment)
    warnings.push("No verified, matching original image/PDF attachment bytes; call scoped Safe Edit store_user_attachment first.");
  const routes:Route[]=[
    {kind:"raw_input",action:rawExists?"link_existing_or_hold":"candidate_create",path:rawPath,
      reason:rawExists?"A note with the deterministic intake ID already exists; inspect identity/hash before linking.":"Preserve exact supplied text and attribution with a traceable link to actual image/PDF if available.",requiresReview:true},
    {kind:"research_review",action:reviewExists?"link_existing_or_hold":"candidate_create",path:reviewPath,
      reason:"Separate sourced statements, user input, broker/management commentary, AI interpretation, contrary evidence, event chronology and thesis delta.",requiresReview:true}
  ];
  if(timelinePath)
    routes.push({kind:"company_timeline_candidate",
      action:timelineExists&&!duplicates?"candidate_append_after_review":"link_existing_or_hold",
      path:timelinePath,requiresReview:true,
      reason:duplicates?"Exact numeric claim duplicate candidate: link existing event, no repeated timeline proof.":
        timelineExists?"Timeline exists; append only when dated source/event dedup and materiality confirmed.":
        "No canonical company timeline indexed; never invent one from a partial screenshot."});
  else routes.push({kind:"industry_context_candidate",action:"link_existing_or_hold",path:null,requiresReview:true,
    reason:"Multi-issuer, non-ticker or macro item: identify existing relevant Industry/Macro notes before any additive update."});
  if(claimReady&&!duplicates)
    routes.push({kind:"claim_registry_candidate",action:"candidate_create",path:null,requiresReview:true,
      reason:"Claim-level metric/period/units submitted, but original source and historical duplicates require verification before a unique canonical claim ID."});
  const needed=[
    "Preserve user text verbatim in a non-protected raw intake note using separately authorized Safe Edit and verify its receipt.",
    verifiedAttachment?"Link the hash-verified original user attachment in the raw intake note; preserve original language and distinguish source attribution.":"For screenshot/PDF, archive its actual bytes with Safe Edit store_user_attachment and inspect it before claiming raw attachment preservation.",
    "Read selected historical notes in full; confirm same event, same broker/model vintage, report date, primary provenance and conflicting evidence.",
    duplicates?"Link the already registered matching Claim ID; do not add a second structured metric or mark an old event as new.":
      "Resolve duplicate/new/added_detail/correction/unresolved before writing an event or new structured claim.",
    "Draft independent research analysis in the same input language where appropriate, using clearly attributed source and AI interpretation.",
    "Preview/approve/apply one non-protected write at a time; verify readback, reindex, links, retry identity and rollback capability.",
    "Propose protected Thesis/Evidence Register or Portfolio revisions only through separate owner-approval workflow."
  ];
  const coordination=buildCoordinatedWriteback({
    planId,inputFormat:input.inputFormat,rawAttachmentVerified:verifiedAttachment,
    eventDate,duplicateCandidate:duplicates,duplicateAdjudicated:false,
    sourceIndependenceVerified:false,routes,
  });
  const [rawStep,reviewStep]=coordination.steps;
  const safeEditDrafts=composeWritebackDrafts({
    planId,domain:input.domain,entities,topic:input.topic,
    inputFormat:input.inputFormat,sourceKind:input.sourceKind,
    sourceLanguage:input.sourceLanguage??null,extractedText:input.extractedText,
    analysisText:input.analysisText??null,publisher:input.publisher??null,
    sourceUrl:input.sourceUrl??null,eventDate,publicationDate,
    attachmentPath:actualAttachmentPath,attachmentVerified:verifiedAttachment,
    rawRoute:{...routes[0],operationId:rawStep.operationId,holdReasons:rawStep.holdReasons},
    reviewRoute:{...routes[1],operationId:reviewStep.operationId,holdReasons:reviewStep.holdReasons},
  });
  return {
    status:"read_only_plan_not_written",planId,entityScope:entities,domain:input.domain,
    inputFormat:input.inputFormat,sourceKind:input.sourceKind,
    sourceLanguage:input.sourceLanguage?T(input.sourceLanguage):null,
    sourceCapture:{
      textDigest:digest,extractedTextIsOriginalBinary:false,
      rawAttachmentPath:actualAttachmentPath,
      attachmentVerified:verifiedAttachment,originalSourceVerified:false,
      preservation:verifiedAttachment?"stored_original_user_bytes":"needs_safe_edit_raw_capture"
    },
    chronology:{eventDate,publicationDate,importedAt:"not_yet_written"},
    historical:{source:"bounded_lexical_context_not_exhaustive",
      selected:pack.selected,paths:pack.items.map(x=>x.path),missing:pack.incomplete},
    exactClaimReview:{status:claimReady?"checked_indexed_claim_candidates":"not_checked_missing_exact_fields",
      classification,matchingClaimPaths:matched,scanTruncated:truncated},
    routes,gates:{
      fullSourceRead:false,attachmentArchived:verifiedAttachment,duplicateAdjudicated:false,
      sourceIndependenceVerified:false,canAutoUpdateThesis:false,
      protectedThesisApprovalRequired:true,canAutoWrite:false},
    warnings,nextActions:needed,coordination,safeEditDrafts,
  };
}

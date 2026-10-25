/**
 * Read-only intake routing for multilingual user-supplied investment material.
 * ChatGPT/another analyst supplies text it actually extracted from a
 * screenshot/PDF; this service CANNOT see, archive or independently verify
 * the attachment unless a separate archive/write receipt says otherwise.
 * Never edits the vault or upgrades protected investment decisions.
 */
import { createHash } from "node:crypto";
import { readNote } from "./notes";
import { db } from "../db";
import { buildInvestmentContextPack, type Focus } from "./investment-context";
import { reviewInvestmentClaim, type Domain, type ReviewClass } from "./investment-claim-review";
import { inspectUserAttachment, type AttachmentType } from "../user-attachment-vault";
import { planCanonicalRoutingV2, type RoutingV2, type ContentType, type EntityTag,
  type BrokerUpdate } from "./investment-routing-v2";
import { buildCanonicalSafeEditWorkflow, type CanonicalSafeEditWorkflow } from "./canonical-writeback-workflow";

export type IntakeFormat = "text"|"screenshot"|"pdf"|"mixed";
export type IntakeSource = "broker_research"|"issuer_release"|"regulatory_filing"|"news_media"|"user_commentary"|"archived_chat"|"social_repost"|"industry_research"|"official_macro"|"unknown";
export interface WritebackInput {
  domain:Domain;
  entities:string[];
  topic:string;
  inputFormat:IntakeFormat;
  sourceKind:IntakeSource;
  extractedText:string;
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
  /** Optional M5.2 caller-declared labels; never silently treat them as verified facts. */
  contentTypes?:ContentType[];
  entityRoles?:EntityTag[];
  themes?:string[];
  brokerUpdate?:BrokerUpdate;
  /** M5.3: supply ONLY finished, source-separated analysis to obtain a Safe Edit recipe. */
  sourceChat?:string;
  completedAnalysis?:string;
  captureOnly?:boolean;
}
type Route={kind:"raw_input"|"research_review"|"company_timeline_candidate"|"industry_context_candidate"|"claim_registry_candidate";
  action:"candidate_create"|"candidate_append_after_review"|"link_existing_or_hold";
  path:string|null;reason:string;requiresReview:boolean};
export interface WritebackPlan {
  status:"read_only_plan_not_written";
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
  historicalEventReview:{
    status:"possible_same_event_candidates"|"none_selected_not_proof_new";
    candidatePaths:string[];
    duplicateAdjudicated:false;
  };
  sourceEventReview:{
    status:"possible_same_source_event_candidates"|"no_structured_match_not_proof_new"|"insufficient_identity";
    candidatePaths:string[];
    criteria:"same_explicit_company_event_date_and_canonical_source_url"|"same_explicit_unscoped_event_date_and_canonical_source_url";
    scanTruncated:boolean;
    duplicateAdjudicated:false;
  };
  exactClaimReview:{status:"not_checked_missing_exact_fields"|"checked_indexed_claim_candidates";
    classification:ReviewClass|null;matchingClaimPaths:string[];scanTruncated:boolean|null};
  routingV2:RoutingV2;
  safeEditWorkflow?:CanonicalSafeEditWorkflow;
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

/** Structured same-source/event discovery, not a source verification or duplicate verdict.
 * Accept only exact issuer + asserted original event date + canonical URL.
 * File modified/imported dates never identify an economic event.
 */
function canonicalSourceUrl(value:string):string|null{
  try {
    const u=new URL(value.replace(/[),.;]+$/g,""));
    if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return null;
    u.hash="";
    for(const k of [...u.searchParams.keys()])
      if(/^utm_|^(?:fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();
    return u.toString();
  }catch{return null;}
}
function relatedIssuer(f:Record<string,unknown>,issuer:string):boolean{
  const names=[f.company,f.entity,f.ticker,f.issuer].flatMap(v=>Array.isArray(v)?v:[v]);
  return names.some(v=>typeof v==="string"&&v.trim().toUpperCase()===issuer.trim().toUpperCase());
}
function sourceEventCandidates(issuers:string[],sourceUrl:string|null|undefined,eventDate:string|null){
  const empty={candidatePaths:[] as string[],scanTruncated:false};
  const wanted=sourceUrl?canonicalSourceUrl(sourceUrl):null;
  if(!wanted||!eventDate)return empty;
  const max=25000;
  const rows=db().prepare("SELECT path,frontmatter FROM notes WHERE frontmatter IS NOT NULL ORDER BY path LIMIT ?")
    .all(max+1) as {path:string;frontmatter:string|null}[];
  const paths:string[]=[];
  for(const {path,frontmatter} of rows.slice(0,max)){
    let fm:Record<string,unknown>;
    try {fm=JSON.parse(frontmatter||"null") as Record<string,unknown>;}catch{continue;}
    if(!fm||typeof fm!=="object"||Array.isArray(fm))continue;
    const declaredIssuer=[fm.company,fm.entity,fm.ticker,fm.issuer]
      .flatMap(x=>Array.isArray(x)?x:[x]).some(x=>typeof x==="string"&&x.trim().length>0);
    // For a thematic Macro/Industry raw receipt without issuer metadata,
    // matching exact URL + economic event date is still a source-event
    // candidate. Never merge a differently tagged issuer by co-mention.
    if(declaredIssuer&&!issuers.some(issuer=>relatedIssuer(fm,issuer)))continue;
    // A report imported on this day can discuss an entirely different event.
    if(fm.event_date!==eventDate)continue;
    const declared=[fm.original_source,fm.source_url,fm.primary_url].some(
      v=>typeof v==="string"&&canonicalSourceUrl(v)===wanted);
    let inDocument=false;
    if(!declared){
      try {
        const raw=readNote(path).content;
        const urls=raw.match(/https?:\/\/[^\s<>"'\x60]+/g)||[];
        inDocument=urls.some(url=>canonicalSourceUrl(url)===wanted);
      }catch{continue;}
    }
    if(declared||inDocument)paths.push(path);
  }
  return {candidatePaths:paths.slice(0,12),scanTruncated:rows.length>max||paths.length>12};
}

export function planInvestmentWriteback(input:WritebackInput):WritebackPlan{
  if(!input.entities.length||input.entities.length>6||input.entities.some(x=>T(x).length<1||x.length>120))
    throw Error("Provide 1-6 nonempty declared entities or domains, never infer an issuer from co-mentions");
  if(!T(input.topic)||input.topic.length>250)throw Error("topic must be 1-250 characters");
  if(!T(input.extractedText)||input.extractedText.length>MAX_TEXT)
    throw Error("Provide faithful extractedText, 1 to 12000 characters");
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
  if(input.themes?.some(x=>!T(x)||x.length>120)||input.themes&&input.themes.length>12)
    throw Error("Provide up to 12 nonempty themes of at most 120 characters");
  if(input.entityRoles?.length && (input.entityRoles.length>12||input.entityRoles.some(x=>
    !T(x.entity)||x.entity.length>120||!entities.some(e=>e.toLowerCase()===T(x.entity).toLowerCase()))))
    throw Error("Entity roles must refer to explicitly declared entities (maximum 12)");
  if(input.brokerUpdate?.estimateChanges && input.brokerUpdate.estimateChanges.length>12)
    throw Error("At most 12 attributed broker estimate changes per plan");
  if((input.completedAnalysis!==undefined||input.captureOnly===true) && (!input.sourceChat?.trim()||input.sourceChat.length>120))
    throw Error("M5.3 captureOnly/completedAnalysis requires sourceChat (1-120)");
  if(input.captureOnly===true&&input.completedAnalysis!==undefined)
    throw Error("captureOnly and completedAnalysis are mutually exclusive");
  if(input.completedAnalysis!==undefined && (!T(input.completedAnalysis)||input.completedAnalysis.length>30000))
    throw Error("M5.3 completedAnalysis must be 1-30000 characters");
  const routingV2=planCanonicalRoutingV2({...input,entities});
  const legacyDigest=createHash("sha256").update([
    "investment_os_intake_v1",input.domain,input.inputFormat,input.sourceKind,
    ...entities.map(x=>x.toLowerCase()),T(input.sourceUrl||""),T(input.rawAttachmentSha256||""),
    // Preserve older IDs only for a stored raw intake with matching dates.
    text
  ].join("\n")).digest("hex");
  const legacyPlanId="IN-"+legacyDigest.slice(0,16).toUpperCase();
  const legacyRawPath="00_Inbox/ChatGPT/Investment Intake - "+legacyPlanId+".md";
  const old=db().prepare("SELECT frontmatter FROM notes WHERE path=? LIMIT 1").get(legacyRawPath) as
    {frontmatter:string|null}|undefined;
  let compatibleLegacy=false;
  if(old?.frontmatter){
    try{
      const fm=JSON.parse(old.frontmatter) as Record<string,unknown>;
      const recordedEvent=typeof fm.event_date==="string"?fm.event_date:null;
      const recordedPublished=typeof fm.published_at==="string"?fm.published_at:null;
      compatibleLegacy=recordedEvent===eventDate&&recordedPublished===publicationDate;
    }catch{/* Invalid old metadata must not collide with a new dated intake. */}
  }
  // v2 includes separate economic event and publication dates so unchanged
  // extracted text cannot alias two distinct events. An already-saved v1 raw
  // note keeps its original path if and only if both declared dates match.
  const digest=compatibleLegacy?legacyDigest:createHash("sha256").update([
    "investment_os_intake_v2",legacyDigest,eventDate??"unknown_event_date",
    publicationDate??"unknown_publication_date"
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
  // A deterministic intake marker is added only after a reviewed Timeline
  // append. Repeated submission of identical source text must not propose
  // a second Timeline event even when a new research note already exists.
  const timelineRecorded=Boolean(timelinePath && timelineExists &&
    readNote(timelinePath).content.includes("<!-- investment-intake:"+planId+" -->"));
  const focus=input.focus??(input.sourceKind==="broker_research"?"broker":input.domain==="macro"?"macro":"general");
  const pack=buildInvestmentContextPack({
    question:(T(input.topic)+" "+entities.join(" ")+" "+text.slice(0,450)).slice(0,1150),
    issuers:[...new Set([
      ...routingV2.companyHubs.map(x=>x.path.slice("01_Companies/".length,-3)),
      ...(input.domain==="company"?entities.map(x=>safeTicker(x)).filter((x):x is string=>!!x):[])
    ])].filter(x=>/^[A-Z][A-Z0-9.-]{0,11}$/.test(x)).slice(0,6),
    industry:routingV2.industryHubs.length?
      routingV2.industryHubs.map(x=>x.label).join(" / ").slice(0,140):
      input.domain==="company"?undefined:entities.join(" / ").slice(0,140),
    focus,maxNotes:10,maxChars:8500
  });
  // Only high-scoring, issuer-scoped Company Research excerpts are candidate
  // prior events; legacy archived AI is NOT a verified fact or duplicate verdict.
  // No similarity score by itself establishes identical original source/vintage.
  const candidateEventPaths=pack.items.filter(x=>
    input.domain==="company" && x.role==="research" &&
    x.path.startsWith("10_Knowledge/Company Research/") && x.score>=110
  ).slice(0,4).map(x=>x.path);
  // The same broker/industry source can mention several declared companies.
  // Reconcile all already-resolved issuer identities by exact URL/event date,
  // never counting co-mentions or raw message repetitions as independent proof.
  const sourceIssuers=[...new Set([
    ...(subject?[subject]:[]),
    ...routingV2.companyHubs.map(x=>x.path.slice("01_Companies/".length,-3))
  ])];
  const sourceMatches=sourceEventCandidates(sourceIssuers,input.sourceUrl,eventDate);
  const sameSourceEvent=sourceMatches.candidatePaths.length>0;
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
  if(routingV2.unresolvedEntities.length||routingV2.unresolvedThemes.length)
    warnings.push("M5.2 hub links use only existing indexed titles or explicit aliases; unresolved names must be adjudicated, never created or mapped by guesswork.");
  if(input.brokerUpdate)
    warnings.push("M5.2 broker PT/estimate old→new figures are caller-declared; same bank and dated versions are necessary but not independent verification or consensus.");
  if(input.sourceKind==="issuer_release"||input.sourceKind==="regulatory_filing")
    warnings.push("Source URL supplied is not proof that the original was fetched or verified.");
  if(!input.sourceUrl)warnings.push("Original source URL absent; screenshots and snippets are attributed inputs, not independently validated source records.");
  if(candidateEventPaths.length)warnings.push("Matching-title historical research candidates require same original event/source/date review before creating a new distinct analysis; selection is not a deduplication verdict.");
  if(sameSourceEvent)warnings.push("Existing issuer/date/original-URL source records found: review original event and provenance before creating a second Timeline entry. This is NOT a verified duplicate classification.");
  if(input.inputFormat!=="text"&&!verifiedAttachment)
    warnings.push("No verified, matching original image/PDF attachment bytes; call scoped Safe Edit store_user_attachment first.");
  const routes:Route[]=[
    {kind:"raw_input",action:rawExists?"link_existing_or_hold":"candidate_create",path:rawPath,
      reason:rawExists?"A note with the deterministic intake ID already exists; inspect identity/hash before linking.":"Preserve exact supplied text and attribution with a traceable link to actual image/PDF if available.",requiresReview:true},
    {kind:"research_review",action:reviewExists?"link_existing_or_hold":"candidate_create",path:reviewPath,
      reason:candidateEventPaths.length?
        "Possible prior event research exists: inspect original source, event date, metric and period before creating a distinct analysis; never count reposts twice.":
        "Separate sourced statements, user input, broker/management commentary, AI interpretation, contrary evidence, event chronology and thesis delta.",requiresReview:true}
  ];
  if(timelinePath)
    routes.push({kind:"company_timeline_candidate",
      action:timelineExists&&!duplicates&&!timelineRecorded&&!sameSourceEvent?"candidate_append_after_review":"link_existing_or_hold",
      path:timelinePath,requiresReview:true,
      reason:timelineRecorded?"Intake ID already recorded in this Timeline; do not append the same text a second time.":
        sameSourceEvent?"Same declared issuer, event date, and original source URL already referenced by existing notes: inspect candidatePaths and do NOT add a new Timeline event until source-level adjudication.":
        duplicates?"Exact numeric claim duplicate candidate: link existing event, no repeated timeline proof.":
        timelineExists?"Timeline exists; append only when dated source/event dedup and materiality confirmed; include <!-- investment-intake:"+planId+" --> in the approved append for idempotent retries.":
        "No canonical company timeline indexed; never invent one from a partial screenshot."});
  else routes.push({kind:"industry_context_candidate",action:"link_existing_or_hold",
    path:routingV2.industryHubs.length===1?routingV2.industryHubs[0].path:null,requiresReview:true,
    reason:"Multi-issuer, non-ticker or macro item: use existing indexed Industry/Macro hubs only after dated source/event review; this is a link candidate, not an auto-append."});
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
  const plan:WritebackPlan={
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
    historicalEventReview:{
      status:candidateEventPaths.length?"possible_same_event_candidates":"none_selected_not_proof_new",
      candidatePaths:candidateEventPaths,duplicateAdjudicated:false
    },
    sourceEventReview:{
      status:!input.sourceUrl||!eventDate?"insufficient_identity":
        sameSourceEvent?"possible_same_source_event_candidates":"no_structured_match_not_proof_new",
      candidatePaths:sourceMatches.candidatePaths,
      criteria:sourceIssuers.length?"same_explicit_company_event_date_and_canonical_source_url":
        "same_explicit_unscoped_event_date_and_canonical_source_url",
      scanTruncated:sourceMatches.scanTruncated,duplicateAdjudicated:false
    },
    exactClaimReview:{status:claimReady?"checked_indexed_claim_candidates":"not_checked_missing_exact_fields",
      classification,matchingClaimPaths:matched,scanTruncated:truncated},
    routingV2,
    routes,gates:{
      fullSourceRead:false,attachmentArchived:verifiedAttachment,duplicateAdjudicated:false,
      sourceIndependenceVerified:false,canAutoUpdateThesis:false,
      protectedThesisApprovalRequired:true,canAutoWrite:false},
    warnings,nextActions:needed
  };
  if(input.completedAnalysis!==undefined||input.captureOnly===true)
    plan.safeEditWorkflow=buildCanonicalSafeEditWorkflow(input,plan);
  return plan;
}

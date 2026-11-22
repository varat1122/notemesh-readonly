/**
 * M5.6.2: read-only, evidence-bounded proposal to link a second source receipt
 * into an existing Research Review. It never adjudicates semantic equivalence
 * automatically and never writes a Vault note.
 *
 * WP2 M56-A (Owner Scope Amendment A1): a canonical Review is never changed by a
 * generic Safe Edit append (OD-04+OD-06). The proposal is a partial recipe for
 * the DEDICATED Canonical Review revision route as a link-only DUPLICATE
 * (prepare/apply_canonical_review_revision: analyst assessment + sealed Source-event
 * assessment relation=duplicate/action=duplicate_link_only + authenticated
 * dashboard approval + server plan/witness + CAS + durable receipt/readback).
 * The extra Source is an additional attributed receipt, never independent
 * confirmation or a new economic event (independentEvidenceIncrement stays 0).
 *
 * M56-P1 (Owner-approved Phase 1): an existing server-receipted Industry-IN or
 * Macro-IN Draft Review gets the V2 subject recipe: the SAME registered tools
 * (prepare_source_event_packet, source_event_result_contract contract=subject_v2,
 * prepare/apply_canonical_review_revision) selected by selectorVersion M56-REVIEW-SELECTOR-2.
 * The planner never infers the macro subject or an analyst judgement; historical
 * non-IN Reviews stay read-only.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {readNote} from "./notes";
import {createReceipt} from "./investment-research-context";
import {SUBJECT_REVIEW_SELECTOR_VERSION} from "../safe-edit/canonical-review-revision-pilot";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const sourcePath=/^00_Inbox\/ChatGPT\/Investment Intake - (IN-[A-F0-9]{16})\.md$/;
const reviewPath=/^10_Knowledge\/(?:Company Research|Industry and Concepts|Macro and Markets)\/Investment Review - [^/]+\.md$/;
const wiki=(p:string)=>`[[${p.slice(0,-3)}]]`;
// The dedicated revision route admits Company Research Reviews only.
const companyReview=/^10_Knowledge\/Company Research\/Investment Review - ([^/]+) - IN-[A-F0-9]{16}\.md$/;
const subjectReview={industry:/^10_Knowledge\/Industry and Concepts\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/,
 macro:/^10_Knowledge\/Macro and Markets\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/};
export const M56_REVISION_METHOD="M56-SOURCE-LINK-ICR-1";
function indexed(path:string){
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path=? AND json_valid(frontmatter)=1").get(path) as
    {frontmatter:string}|undefined;
  if(!row)throw Error("M56_RELATION_NOTE_NOT_INDEXED: " + path);
  const fm=JSON.parse(row.frontmatter) as Record<string,unknown>;
  const content=readNote(path).content;
  if(!db().prepare("SELECT 1 FROM notes_fts WHERE path=? LIMIT 1").get(path))
    throw Error("M56_RELATION_NOTE_NOT_SEARCHABLE: " + path);
  return {fm,content};
}
function sourceFamily(value:unknown):string|null{
  if(typeof value!=="string")return null;
  try {
    const url=new URL(value);
    if(!["https:","http:"].includes(url.protocol))return null;
    const parts=url.hostname.toLowerCase().split(".");
    return parts.length>=2?parts.slice(-2).join("."):null;
  }catch{return null;}
}
export interface DuplicateSourceLinkInput {
  reviewPath:string;
  additionalSourcePath:string;
  eventAnchor:string;
  comparisonBasis:string;
  linkedOnDate:string;
}
export function planDuplicateSourceLinkM56(input:DuplicateSourceLinkInput){
  if(!reviewPath.test(input.reviewPath)||!sourcePath.test(input.additionalSourcePath))
    throw Error("M56_RELATION_PATH_OUT_OF_SCOPE");
  if(!/^[a-z0-9][a-z0-9-]{7,119}$/.test(input.eventAnchor)||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.linkedOnDate)||
    new Date(input.linkedOnDate+"T00:00:00Z").toISOString().slice(0,10)!==input.linkedOnDate)
    throw Error("M56_RELATION_EVENT_KEY_OR_DATE_INVALID");
  if(input.comparisonBasis.trim().length<40||input.comparisonBasis.length>1000)
    throw Error("M56_RELATION_COMPARISON_BASIS_REQUIRED");
  const review=indexed(input.reviewPath),other=indexed(input.additionalSourcePath);
  if(review.fm.type!=="investment_research_review"||other.fm.type!=="investment_source_intake")
    throw Error("M56_RELATION_NOTE_TYPE_MISMATCH");
  const primaryPath=review.fm.original_source_path;
  if(typeof primaryPath!=="string"||!sourcePath.test(primaryPath)||primaryPath===input.additionalSourcePath)
    throw Error("M56_RELATION_PRIMARY_SOURCE_MISSING");
  const primary=indexed(primaryPath);
  if(primary.fm.type!=="investment_source_intake"||
    review.fm.intake_id!==primary.fm.intake_id||!review.content.includes(wiki(primaryPath)))
    throw Error("M56_RELATION_REVIEW_SOURCE_PROVENANCE_MISMATCH");
  const date=primary.fm.event_date;
  if(typeof date!=="string"||date!==other.fm.event_date||
    primary.fm.published_at!==other.fm.published_at)
    throw Error("M56_RELATION_CHRONOLOGY_MISMATCH");
  const firstFamily=sourceFamily(primary.fm.source_url),secondFamily=sourceFamily(other.fm.source_url);
  if(!firstFamily||firstFamily!==secondFamily)
    throw Error("M56_RELATION_ORIGIN_FAMILY_UNRESOLVED: do not infer same report across publishers");
  const domain=subjectReview.industry.test(input.reviewPath)?"industry" as const:subjectReview.macro.test(input.reviewPath)?"macro" as const:null;
  if(!review.content.includes("## Source provenance")&&!(domain&&review.content.includes("## ที่มาของต้นฉบับ")))throw Error("M56_RELATION_SOURCE_SECTION_MISSING");
  const eventKey="EV-"+sha([date,input.eventAnchor].join("\n")).slice(0,16).toUpperCase();
  const opId="ILK-"+sha([input.reviewPath,input.additionalSourcePath,eventKey].join("\n")).slice(0,32);
  // This is a reference update, not a second research verdict, event, claim or
  // independently verified source. Original metadata and existing prose stay.
  const content=[
    `M5.6 cross-language source relation (${eventKey}) — review reference addition only:`,
    `- Additional attributed source: ${wiki(input.additionalSourcePath)} (intake ${other.fm.intake_id}; language ${other.fm.source_language??"unknown"})`,
    `- Existing reference source: ${wiki(primaryPath)} (intake ${primary.fm.intake_id}; language ${primary.fm.source_language??"unknown"})`,
    `- Relationship: caller-proposed same-event coverage; same publication date ${date}, publisher family ${firstFamily}.`,
    `- Comparison basis (caller interpretation, not issuer proof): ${input.comparisonBasis.trim()}`,
    "- Evidence weight: this is an additional Source Receipt, **not independent confirmation** and not a new economic event, EPS/PT forecast, or approved Thesis change.",
    "- Original report/issuer authenticity and any substantive correction remain separately unverified; no protected record is modified."
  ].join("\n");
  const common={eventKey,existingReviewPath:input.reviewPath,primarySourcePath:primaryPath,
    additionalSourcePath:input.additionalSourcePath,reviewVersionSha256:sha(review.content),writePerformed:false as const,
    safeEditRequest:null,proposalId:opId};
  const subject=input.reviewPath.match(companyReview)?.[1];
  if(!subject&&!domain)return {...common,status:"hold_dedicated_revision_route_unavailable" as const,canonicalReviewRevision:null,
    reason:"M56_HISTORICAL_OR_UNSUPPORTED_REVIEW_READ_ONLY: generic canonical appends are refused (OD-04+OD-06); only Company-IN (V1) and Industry-IN/Macro-IN (V2) Draft Reviews have a dedicated revision route"};
  if(domain&&(review.fm.review_scope!==domain||review.fm.status!=="analyst_review_not_user_endorsed"||review.fm.verification!=="not_reverified"||
     review.fm.research_status!=="draft"||review.fm.usage_tier!=="historical_analysis_only"))
    return {...common,status:"hold_draft_review_required" as const,canonicalReviewRevision:null,
      reason:"M56_SUBJECT_DRAFT_REVIEW_REQUIRED: only a "+domain+"-scoped server Draft Review is eligible"};
  const hubs=domain==="industry"&&Array.isArray(review.fm.industry_hubs)?review.fm.industry_hubs.filter((h):h is string=>typeof h==="string"):[];
  if(domain==="industry"&&(hubs.length!==1||(review.fm.industry_hubs as unknown[]).length!==1))
    return {...common,status:"hold_subject_ambiguous" as const,canonicalReviewRevision:null,
      reason:"M56_SUBJECT_AMBIGUOUS: the Review must declare exactly one Industry Hub"};
  let reviewReceiptId:string,sourceReceiptId:string;
  try{
    reviewReceiptId=createReceipt("canonical_review",input.reviewPath,review.content);
    sourceReceiptId=createReceipt("source_intake",input.additionalSourcePath,other.content);
  }catch{
    return {...common,status:"hold_receipt_unverified" as const,canonicalReviewRevision:null,
      reason:"M56_RELATION_RECEIPT_UNVERIFIED: the Review and the additional Source need verified canonical receipts"};
  }
  // OD-10 F-4: idempotency only after the domain and receipt checks above, and
  // labelled for what it is: the verified Review's text already references the
  // Source. No receipt attests that link itself.
  if(review.content.includes(wiki(input.additionalSourcePath)))
    return {...common,status:"already_linked" as const,linkEvidence:"text_reference_only" as const,canonicalReviewRevision:null};
  if(domain)return {...common,status:"requires_dedicated_review_revision_v2" as const,routeVersion:SUBJECT_REVIEW_SELECTOR_VERSION,
    // Partial SubjectRevisionInput (V2): the caller adds subject, analystAssessment and
    // the sealed subject sourceEvent, then prepare_canonical_review_revision with the same V2 input.
    canonicalReviewRevision:{selectorVersion:SUBJECT_REVIEW_SELECTOR_VERSION,
      existingReview:{path:input.reviewPath,intakeId:review.fm.intake_id as string,expectedSha256:sha(review.content),receiptId:reviewReceiptId,
        reviewScope:domain,originalSourcePath:primaryPath,relationship:"duplicate" as const,comparisonBasis:input.comparisonBasis.trim()},
      entity:domain,reviewDate:input.linkedOnDate,methodVersion:M56_REVISION_METHOD,
      additionalSources:[{path:input.additionalSourcePath,sha256:sha(other.content),receiptId:sourceReceiptId}],
      revisionText:content},
    // Nothing is pre-filled: null/[] fail the V2 schema until the analyst supplies them.
    requiredCompletion:{subject:domain==="industry"
        ?{domain,hubPath:hubs[0],topic:null,period:null,evidence:[]}
        :{domain,geography:null,topic:null,period:null,role:null,vintage:null,evidence:[]},
      subjectRule:domain==="industry"
        ?"hubPath is the Review's single declared Industry Hub; topic/period and >=1 exact original-Source quote are analyst-supplied"
        :"geography, topic, period, role and vintage are analyst-supplied; geography and period must appear verbatim in the exact original-Source quotes",
      analystAssessment:{disposition:"<analyst-selected: PASS | HOLD | FAIL>",
      eventRelation:"<analyst-selected: duplicate | added_detail | correction | contradiction>",
      materiality:"<analyst-selected: low | material | unresolved>",
      criticIndependence:"not_verified",independentEvidenceIncrement:0},
      admissibleOnThisRoute:"disposition=PASS, eventRelation=duplicate, materiality=low only, when the analyst so concludes; any other conclusion means this route is not used",
      sourceEvent:"After the analyst (not the server or this planner) fills subject and analystAssessment: call prepare_source_event_packet with {kind:\"revise\",input:<the completed V2 revision input, selectorVersion "+SUBJECT_REVIEW_SELECTOR_VERSION+">}; read the V2 result contract with source_event_result_contract {contract:\"subject_v2\"}; the analyst attests a matching result with event.relation=duplicate and event.action=duplicate_link_only; supply {packet,result} as input.sourceEvent. Nothing is pre-approved."},
    next:"Then call prepare_canonical_review_revision with that same V2 input (unchanged selectorVersion "+SUBJECT_REVIEW_SELECTOR_VERSION+", entity, subject and sourceEvent), obtain authenticated dashboard approval of the exact previewed diff, then call apply_canonical_review_revision with {input:<the same V2 input>,operationId,authorization:{operationId,previewToken,expectedHash}} from that preview. independentEvidenceIncrement stays 0. Generic preview_edit/apply_edit of a canonical Review is refused."};
  return {...common,status:"requires_dedicated_review_revision" as const,
    // Partial CanonicalRevisionInput: the caller adds analystAssessment and the sealed
    // sourceEvent, then prepare_canonical_review_revision; nothing here is applied.
    canonicalReviewRevision:{
      existingReview:{path:input.reviewPath,expectedSha256:sha(review.content),receiptId:reviewReceiptId,
        relationship:"duplicate" as const,comparisonBasis:input.comparisonBasis.trim()},
      entity:subject!,reviewDate:input.linkedOnDate,methodVersion:M56_REVISION_METHOD,
      additionalSources:[{path:input.additionalSourcePath,sha256:sha(other.content),receiptId:sourceReceiptId}],
      revisionText:content},
    // M56 links the SAME event's duplicate coverage: relation "duplicate" with the
    // contract's link-only action. If the analyst finds genuinely new detail, M56 is
    // the wrong tool: use the ordinary added_detail revision instead (never relabel).
    // OD-10 F-5: no judgement is pre-filled. The placeholders fail the revision
    // schema if copied forward; the analyst selects each value. Only
    // PASS/duplicate/low is admissible here, otherwise this route is not used.
    requiredCompletion:{analystAssessment:{disposition:"<analyst-selected: PASS | HOLD | FAIL>",
      eventRelation:"<analyst-selected: duplicate | added_detail | correction | contradiction>",
      materiality:"<analyst-selected: low | material | unresolved>",
      criticIndependence:"not_verified",independentEvidenceIncrement:0},
      admissibleOnThisRoute:"disposition=PASS, eventRelation=duplicate, materiality=low only, when the analyst so concludes; any other conclusion means this route is not used",
      sourceEvent:"prepare_source_event_packet(kind=revise) + analyst-attested result with event.relation=duplicate, event.action=duplicate_link_only"},
    next:"Complete analystAssessment + sourceEvent, call prepare_canonical_review_revision, obtain authenticated dashboard approval of the exact diff, then apply_canonical_review_revision. Generic preview_edit/apply_edit of a canonical Review is refused."};
}

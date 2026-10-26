/**
 * M5.6.2: read-only, evidence-bounded proposal to link a second source receipt
 * into an existing Research Review. It never adjudicates semantic equivalence
 * automatically and never writes a Vault note. Authorized Safe Edit must
 * preview and CAS-apply its exact append recipe separately.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {readNote} from "./notes";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const sourcePath=/^00_Inbox\/ChatGPT\/Investment Intake - (IN-[A-F0-9]{16})\.md$/;
const reviewPath=/^10_Knowledge\/(?:Company Research|Industry and Concepts|Macro and Markets)\/Investment Review - [^/]+\.md$/;
const wiki=(p:string)=>`[[${p.slice(0,-3)}]]`;
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
  if(review.content.includes(wiki(input.additionalSourcePath)))
    return {status:"already_linked" as const,eventKey:"EV-"+sha([date,input.eventAnchor].join("\n")).slice(0,16).toUpperCase(),
      existingReviewPath:input.reviewPath,additionalSourcePath:input.additionalSourcePath,
      safeEditRequest:null,reviewVersionSha256:sha(review.content),writePerformed:false};
  if(!review.content.includes("## Source provenance"))throw Error("M56_RELATION_SOURCE_SECTION_MISSING");
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
  return {status:"requires_safe_edit_preview" as const,eventKey,existingReviewPath:input.reviewPath,
    primarySourcePath:primaryPath,additionalSourcePath:input.additionalSourcePath,
    reviewVersionSha256:sha(review.content),writePerformed:false,
    safeEditRequest:{operationId:opId,path:input.reviewPath,
      reason:"M5.6 candidate same-event cross-language Source Receipt link; append references only, no new proof or protected mutations",
      change:{kind:"append" as const,heading:"Source provenance",date:input.linkedOnDate,content}}};
}

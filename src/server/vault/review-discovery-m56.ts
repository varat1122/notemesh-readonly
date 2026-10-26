/** M5.6.3: bounded read-only discovery and explicit revision proposals.
 * Similarity is a retrieval hint, never a duplicate verdict or evidence vote.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {readNote} from "./notes";

const sourcePattern=/^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/;
const reviewPattern=/^10_Knowledge\/(?:Company Research|Industry and Concepts|Macro and Markets)\/Investment Review - [^/]+\.md$/;
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const safeDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
function indexed(path:string){
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path=? AND json_valid(frontmatter)=1").get(path) as {frontmatter:string}|undefined;
  if(!row||!db().prepare("SELECT 1 FROM notes_fts WHERE path=? LIMIT 1").get(path))throw Error("M56_DISCOVERY_NOTE_NOT_INDEXED: "+path);
  return {fm:JSON.parse(row.frontmatter) as Record<string,unknown>,content:readNote(path).content};
}
function origin(url:unknown){
  if(typeof url!=="string")return null;
  try{const u=new URL(url);return ["http:","https:"].includes(u.protocol)?u.hostname.toLowerCase().replace(/^www\.|^th\./,""):null;}catch{return null;}
}
function string(v:unknown){return typeof v==="string"?v.trim():"";}
export function discoverNearDuplicateSourcesM56(input:{sourcePath:string;eventAnchor:string;maxCandidates?:number}){
  if(!sourcePattern.test(input.sourcePath))throw Error("M56_DISCOVERY_SOURCE_PATH_OUT_OF_SCOPE");
  if(!/^[a-z0-9][a-z0-9-]{7,119}$/.test(input.eventAnchor))throw Error("M56_DISCOVERY_EVENT_ANCHOR_REQUIRED");
  const limit=input.maxCandidates??12;
  if(!Number.isInteger(limit)||limit<1||limit>30)throw Error("M56_DISCOVERY_LIMIT_INVALID");
  const anchor=indexed(input.sourcePath);
  if(anchor.fm.type!=="investment_source_intake")throw Error("M56_DISCOVERY_SOURCE_TYPE_MISMATCH");
  const rows=db().prepare("SELECT path,frontmatter FROM notes WHERE path LIKE '00_Inbox/ChatGPT/Investment Intake - IN-%' ORDER BY path LIMIT 25001").all() as {path:string;frontmatter:string|null}[];
  const candidates=[] as {path:string;intakeId:string;signals:string[];caveats:string[];candidateClass:string;score:number}[];
  for(const row of rows.slice(0,25000)){
    if(row.path===input.sourcePath||!sourcePattern.test(row.path))continue;
    let fm:Record<string,unknown>;
    try{fm=JSON.parse(row.frontmatter||"null") as Record<string,unknown>;}catch{continue;}
    if(!fm||fm.type!=="investment_source_intake")continue;
    const signals:string[]=[],caveats:string[]=[];
    if(string(fm.source_text_sha256)&&fm.source_text_sha256===anchor.fm.source_text_sha256)signals.push("exact_original_text_digest");
    if(string(fm.event_date)&&fm.event_date===anchor.fm.event_date)signals.push("same_asserted_event_date");
    if(string(fm.published_at)&&fm.published_at===anchor.fm.published_at)signals.push("same_asserted_publication_date");
    if(origin(fm.source_url)&&origin(fm.source_url)===origin(anchor.fm.source_url))signals.push("same_publisher_url_family");
    if(string(fm.source_language)&&string(anchor.fm.source_language)&&fm.source_language!==anchor.fm.source_language)signals.push("different_source_languages");
    if(string(fm.event_date)&&string(anchor.fm.event_date)&&fm.event_date!==anchor.fm.event_date)caveats.push("different_event_dates");
    if(string(fm.published_at)&&string(anchor.fm.published_at)&&fm.published_at!==anchor.fm.published_at)caveats.push("different_publication_dates");
    const exact=signals.includes("exact_original_text_digest");
    const dated=signals.includes("same_asserted_event_date")&&signals.includes("same_asserted_publication_date");
    const family=signals.includes("same_publisher_url_family");
    if(!exact&&!(dated&&family))continue;
    const score=exact?100:dated&&family?65:0;
    candidates.push({path:row.path,intakeId:string(fm.intake_id),signals,caveats,score,
      candidateClass:exact?"exact_text_candidate":"same_date_publisher_family_candidate"});
  }
  candidates.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  return {status:"candidate_discovery_only" as const,sourcePath:input.sourcePath,eventAnchor:input.eventAnchor,
    candidates:candidates.slice(0,limit),scanTruncated:rows.length>25000||candidates.length>limit,
    evaluatedCount:Math.min(rows.length,25000),writePerformed:false,
    semanticDuplicateVerified:false,
    warning:"Dates/publisher family and text digest are retrieval signals only. Check actual claims, event, units, source independence and provenance before any link; never auto-merge or count as independent evidence."};
}

export function planReviewRevisionM56(input:{reviewPath:string;eventAnchor:string;changeType:"added_detail"|"correction"|"contradiction"|"supersession";comparisonBasis:string;proposedChange:string;sourcePaths:string[];proposalDate:string}){
  if(!reviewPattern.test(input.reviewPath)||!input.sourcePaths.length||input.sourcePaths.length>12||input.sourcePaths.some(p=>!sourcePattern.test(p)))throw Error("M56_REVISION_PATH_OUT_OF_SCOPE");
  if(!/^[a-z0-9][a-z0-9-]{7,119}$/.test(input.eventAnchor)||!safeDate(input.proposalDate))throw Error("M56_REVISION_ANCHOR_OR_DATE_INVALID");
  if(input.comparisonBasis.trim().length<40||input.comparisonBasis.length>2000||input.proposedChange.trim().length<40||input.proposedChange.length>4000)throw Error("M56_REVISION_REASON_REQUIRED");
  const review=indexed(input.reviewPath);
  if(review.fm.type!=="investment_research_review")throw Error("M56_REVISION_REVIEW_TYPE_MISMATCH");
  const sources=input.sourcePaths.map(path=>({path,...indexed(path)}));
  if(sources.some(x=>x.fm.type!=="investment_source_intake"))throw Error("M56_REVISION_SOURCE_TYPE_MISMATCH");
  if(!sources.some(s=>s.path===review.fm.original_source_path||review.content.includes(`[[${s.path.slice(0,-3)}]]`)))throw Error("M56_REVISION_NO_EXISTING_PROVENANCE_LINK");
  const currentSha256=hash(review.content);
  const proposalId="RVP-"+hash([input.reviewPath,currentSha256,input.eventAnchor,input.changeType,...input.sourcePaths].join("\n")).slice(0,24).toUpperCase();
  const evidenceChangeLogProposal={proposalId,reviewPath:input.reviewPath,previousVersionSha256:currentSha256,
    eventAnchor:input.eventAnchor,changeType:input.changeType,proposalDate:input.proposalDate,
    sourceReceipts:sources.map(x=>({path:x.path,intakeId:x.fm.intake_id,sourceTextSha256:x.fm.source_text_sha256,
      publicationDate:x.fm.published_at,eventDate:x.fm.event_date})),
    comparisonBasis:input.comparisonBasis.trim(),proposedChange:input.proposedChange.trim(),
    evidenceStatus:"proposal_unverified",thesisImpact:"not_authorized",reviewLineage:"revision_proposed_not_applied"};
  return {status:"owner_approval_required" as const,proposalId,existingReviewVersionSha256:currentSha256,
    evidenceChangeLogProposal,reviewVersioning:{currentReviewPath:input.reviewPath,currentSha256,
      nextVersion:"unassigned_until_approved_cas_write",supersedesReviewPath:input.changeType==="supersession"?input.reviewPath:null},
    safeEditRequest:null,writePerformed:false,protectedNotesTouched:false,
    requiredGates:["original_claim_comparison","reviewer_approval","new_revision_preview","compare_and_swap_before_hash","readback_and_search_index_verification"],
    warning:"No protected Evidence Register, Thesis, Timeline or Portfolio write. Supersession is a proposal, never an automatic overwrite."};
}

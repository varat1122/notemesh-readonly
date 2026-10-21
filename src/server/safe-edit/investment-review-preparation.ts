/**
 * One real-Vault, READ-ONLY handoff for the Investment OS North Star.
 *
 * The model does semantic investment reasoning AFTER it sees the original
 * user/issuer source and issuer-scoped historical context. This function
 * only prepares canonical paths, source/version identity and retrieved notes
 * for the EXISTING authorized write_investment_graph_bundle MCP action.
 * It does not invent analysis, execute model APIs, preview/apply or write.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {resolveNotePath,readVaultFile} from "../vault/paths";
import {extractStructure,splitFrontmatter} from "../vault/markdown";
import {buildInvestmentContextPack,type Focus} from "../vault/investment-context";

const BASE="08_Daily_Weekly/Research Indexes/";
const SAFE=/^[\p{L}\p{N} _./()-]+\.md$/u;
const ISSUER=/^[A-Z][A-Z0-9.-]{0,11}$/;
const EVENT=/^[\p{L}\p{N}_. -]{4,140}$/u;
const PATHS=["07_Sources/","10_Knowledge/","08_Daily_Weekly/"];
const sha=(raw:string)=>createHash("sha256").update(raw,"utf8").digest("hex");
const canonical=(p:string)=>p.length<=350&&SAFE.test(p)&&
  !p.startsWith("/")&&!p.includes("//")&&!p.includes("/./")&&
  !p.includes("\\")&&p.split("/").every(x=>x!=="."&&x!==".."&&x.trim()===x);
export interface PrepareReviewInput{
  issuer:string;
  eventKey:string;
  period:string;
  sourcePath:string;
  question:string;
  focus?:Focus;
  industry?:string;
}
function indexed(p:string):string{
  if(!canonical(p))throw Error("review_handoff_invalid_canonical_path_hold");
  const row=db().prepare("SELECT path FROM notes WHERE path=?").get(p) as
    {path:string}|undefined;
  if(!row||row.path!==p)throw Error("review_handoff_canonical_anchor_not_indexed_hold");
  return readVaultFile(resolveNotePath(p));
}
function meta(raw:string):Record<string,unknown>{
  const f=splitFrontmatter(raw);
  if(f.invalid||!f.fmOffset||!f.data||typeof f.data!=="object")
    throw Error("review_handoff_source_metadata_missing_hold");
  return f.data;
}
export function prepareRealInvestmentReviewHandoff(input:PrepareReviewInput){
  const issuer=input.issuer?.trim().toUpperCase()??"";
  if(!ISSUER.test(issuer)||!EVENT.test(input.eventKey)||
    !input.period?.trim()||input.period.length>100||
    !input.question?.trim()||input.question.trim().length<3||
    input.question.length>1200||input.industry && input.industry.length>140)
    throw Error("review_handoff_issuer_event_or_query_invalid_hold");
  const sourcePath=input.sourcePath;
  if(!canonical(sourcePath)||!PATHS.some(p=>sourcePath.startsWith(p)))
    throw Error("review_handoff_original_source_out_of_scope_hold");
  const sourceRaw=indexed(sourcePath);
  const source=meta(sourceRaw);
  const sourceIndex=db().prepare(`SELECT n.frontmatter,n.size,f.body
    FROM notes AS n JOIN notes_fts AS f ON f.rowid=n.rowid WHERE n.path=?`)
    .get(sourcePath) as {frontmatter:string|null;size:number;body:string}|undefined;
  if(!sourceIndex||sourceIndex.body!==splitFrontmatter(sourceRaw).body||
    sourceIndex.frontmatter!==JSON.stringify(source)||
    sourceIndex.size!==Buffer.byteLength(sourceRaw,"utf8"))
    throw Error("review_handoff_source_physical_index_mismatch_hold");
  if(source.entity!==issuer||source.event_key!==input.eventKey||
    !["primary","attributed","user_supplied"].includes(String(source.source_type))||
    typeof source.period==="string" && source.period!==input.period)
    throw Error("review_handoff_original_source_issuer_event_mismatch_hold");

  const timelinePath=BASE+"Company Evolution - "+issuer+".md";
  const companyPath="01_Companies/"+issuer+".md";
  const analysisPath=BASE+"Investment Review - "+issuer+" - "+input.eventKey+".md";
  if(!canonical(analysisPath)||!canonical(timelinePath))
    throw Error("review_handoff_noncanonical_analysis_destination_hold");
  const timelineRaw=indexed(timelinePath);
  const evolution=meta(timelineRaw);
  // Living Company Evolution was historically indexed with "company: TICKER".
  // Preserve canonical identity checks without rewriting protected history.
  // If both fields are declared they MUST agree; a conflicting alias holds.
  if((evolution.entity!==undefined&&evolution.entity!==issuer)||
    (evolution.company!==undefined&&evolution.company!==issuer)||
    (evolution.entity!==issuer&&evolution.company!==issuer))
    throw Error("review_handoff_living_timeline_wrong_issuer_hold");
  indexed(companyPath);
  const sourceVersion=sha(sourceRaw);
  const headings=extractStructure(splitFrontmatter(timelineRaw).body).headings
    .filter(h=>h.level<=4).map(h=>({text:h.text,level:h.level})).slice(0,15);
  if(!headings.length)throw Error("review_handoff_living_timeline_heading_missing_hold");
  const existingAnalysis=db().prepare("SELECT 1 FROM notes WHERE path=?")
    .get(analysisPath);
  const eventMarker="<!-- investment-os-event:"+input.eventKey+" -->";
  const knownMarker=timelineRaw.includes(eventMarker);
  // Retrieve real indexed issuer history, with prior unverified Analysis
  // explicitly kept distinct from primary sources and endorsed thesis.
  const pack=buildInvestmentContextPack({
    question:input.question,issuers:[issuer],
    focus:input.focus??"general",industry:input.industry,
    maxNotes:12,maxChars:13000,
  });
  const sourceLines=splitFrontmatter(sourceRaw).body;
  const capped=sourceLines.slice(0,5000);
  const ready=!existingAnalysis&&!knownMarker;
  return {
    status:ready?"real_vault_review_context_prepared_no_write":
      "existing_event_or_analysis_requires_duplicate_review_no_write",
    writeAllowedByPreparation:false as const,
    issuer,eventKey:input.eventKey,
    originalSource:{
      path:sourcePath,sha256:sourceVersion,
      declaredSourceType:String(source.source_type),
      declaredVerification:typeof source.verification==="string"?source.verification:null,
      declaredEventDate:typeof source.event_date==="string"?source.event_date:null,
      declaredPublishedAt:typeof source.published_at==="string"?source.published_at:null,
      excerpt:capped,excerptTruncated:sourceLines.length>capped.length,
      independentlyAuthenticated:false as const,
    },
    canonical:{
      sourcePath,companyPath,timelinePath,analysisPath,
      existingTimelineHeadings:headings,
      proposedWriteFields:ready?{
        issuer,eventKey:input.eventKey,period:input.period,
        sourcePath,analysisPath,timelinePath,
        expectedSourceSha256:sourceVersion,
      }:null,
      requiredAnalysisSourceMetadata:{source_path:sourcePath,source_sha256:sourceVersion},
    },
    existingAnalysisAtProposedPath:!!existingAnalysis,
    timelineEventMarkerAlreadyPresent:knownMarker,
    historicalContext:pack,
    nextAction:ready?
      "AI must review all relevant history and original source, determine fact versus hypothesis, cite only grounded links, then provide an explicit unverified draft to separately host-authorized write_investment_graph_bundle":
      "Review existing event/analysis and classify duplicate, added detail, correction or contradiction before any new write",
    unverifiedAnalysisIsNotIndependentEvidence:true as const,
    thesisAndEvidenceRegisterAreReferencesOnly:true as const,
    modelAnalysisPerformedByThisTool:false as const,
    vaultModified:false as const,
    mobileSyncVerified:false as const,
  };
}

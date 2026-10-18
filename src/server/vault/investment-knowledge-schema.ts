/**
 * Read-time compatibility adapter for old and new Investment_OS Markdown.
 * It never mutates source notes, guesses event dates, authenticates a publisher,
 * promotes archived AI evidence, or authorizes protected Thesis edits.
 *
 * Input must already be parsed by the shared hardened splitFrontmatter parser.
 */
export interface SchemaInspection {
  status: "read_time_adapter_only";
  role: "structured_claim" | "source_receipt" | "source" | "industry" | "company" | "timeline" |
    "thesis" | "evidence_register" | "review" | "historical_analysis" | "navigation" | "archive" | "method" | "other";
  declaredSourceType: string | null;
  rawSourceType: string | null;
  normalizedSourceType: string | null;
  sourceTypeMapping: "canonical" | "legacy_alias" | "unmapped" | "missing";
  independenceAssessment: "not_independent_archived_ai" | "not_independent_derivative_summary" | "not_assessed";
  declaredVerification: string | null;
  originalSource: string | null;
  sourceUrlAlias: string | null;
  eventDate: string | null;
  publishedAt: string | null;
  importedAt: string | null;
  legacyDate: string | null;
  legacyImportedOn: string | null;
  sourceHashScope: "unverified_full_document_hash_declared" | "excerpt_only" | "none";
  claimCount: number;
  claimIssues: string[];
  warnings: string[];
  canAutoUpdateThesis: false;
}

type Data = Record<string, unknown>;
const asText = (x:unknown):string|null =>
  typeof x==="string"&&x.trim() ? x.trim() : null;
const SOURCE_TYPES=new Set([
  "primary","regulatory","transcript","broker","analyst","secondary",
  "attributed","user_supplied","archived_ai",
]);
const LEGACY_SOURCE_ALIASES:Record<string,"archived_ai"|"user_supplied">={
  chatgpt_export:"archived_ai",
  chatgpt_history:"archived_ai",
  chatgpt_analysis:"archived_ai",
  archived_ai_navigation:"archived_ai",
  user_supplied_chatgpt_summary:"user_supplied",
  user_supplied_chat_summary:"user_supplied",
  user_supplied_chat_archive_summary:"user_supplied",
};
function roleOfNote(path:string, fm:Data):SchemaInspection["role"] {
  const t=asText(fm.type);
  if(t==="primary_source_verification_receipt")return "source_receipt";
  if(t==="investment_source_capture")return "source"; // user-supplied capture; NOT verified issuer material
  if(t==="investment_structured_claim_register")return "structured_claim";
  // Source archive path always wins: an old archive can have type research_note.
  if(path.startsWith("07_Sources/ChatGPT/")||t==="chatgpt_archive")return "archive";
  if(t==="current_thesis"||t==="thesis"||/^05_Thesis\/.*Current Thesis/i.test(path))return "thesis";
  if(/Evidence Register/i.test(path))return "evidence_register";
  if(t==="company_evolution_timeline"||t==="investment_evolution_master"||/Company Evolution - |00_Investment_Evolution_Master/.test(path))return "timeline";
  if(t==="primary_ir_evidence_review"||/^08_Daily_Weekly\/Research Indexes\/Primary Evidence - /.test(path))return "source";
  if(t==="industry_tam_version_register"||t==="concept_hub"||t==="investment_economic_transmission_graph"||
    /^02_Industries_Themes\/|^03_Concepts\/|00_Industry_TAM_|00_AI_Infrastructure_Economic_Transmission/.test(path))return "industry";
  if(t==="company"||path.startsWith("01_Companies/"))return "company";
  // Historical extracted knowledge is a derivative analysis, not a new issuer source.
  if(t==="knowledge_note"&&["chatgpt_history","chatgpt_export","chatgpt_analysis"].includes(asText(fm.source_type)??""))
    return "historical_analysis";
  if(["knowledge_index","company_history_index","topic_history_index","macro_hub",
      "chat_transcript_index","historical_navigation_redirect"].includes(t??""))return "navigation";
  if(["news_thesis_review","investment_review","research_note","preferred_research_note",
      "research_update","macro_research_note","dated_evidence_review","research_synthesis",
      "research_map","import_review"].includes(t??""))return "review";
  if(t==="research_workflow"||path.startsWith("09_Templates/"))return "method";
  return "other";
}
function strictDate(x:unknown): string|null {
  const v=asText(x);
  if(!v||!/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.test(v))return null;
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v)!;
  const year=Number(m[1]), month=Number(m[2]),day=Number(m[3]);
  const iso=new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10);
  if(iso!==v.slice(0,10))return null;
  if(v.length===10)return v;
  if(!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v))return null;
  return Number.isNaN(Date.parse(v))?null:v;
}
const hash=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/i.test(x);
const isObj=(x:unknown):x is Data=>x!==null&&typeof x==="object"&&!Array.isArray(x);

/**
 * A narrow, non-blocking diagnostic. Warnings signal what NOT to infer.
 * Claim issues apply only to explicitly structured claim registers; a legacy
 * narrative is never declared invalid merely for lacking machine-readable IDs.
 */
export function inspectCanonicalKnowledgeMetadata(path:string,fm:Data):SchemaInspection {
  const role=roleOfNote(path,fm);
  const warnings:string[]=[];
  const claimIssues:string[]=[];
  const sourceRaw=asText(fm.source_type);
  const rawSourceType=sourceRaw;
  const declaredSourceType=sourceRaw&&SOURCE_TYPES.has(sourceRaw.toLowerCase())?
    sourceRaw.toLowerCase():null;
  const alias=sourceRaw?LEGACY_SOURCE_ALIASES[sourceRaw.toLowerCase()]??null:null;
  const normalizedSourceType=declaredSourceType??alias;
  const sourceTypeMapping:SchemaInspection["sourceTypeMapping"]=
    declaredSourceType?"canonical":alias?"legacy_alias":sourceRaw?"unmapped":"missing";
  // Do NOT treat a derivative chat summary as independent issuer evidence.
  // A primary declaration is still unassessed until the actual source is read.
  const independenceAssessment:SchemaInspection["independenceAssessment"]=
    normalizedSourceType==="archived_ai"||(!normalizedSourceType&&role==="archive")
      ?"not_independent_archived_ai":
    sourceRaw!==null&&["user_supplied_chatgpt_summary","user_supplied_chat_summary",
      "user_supplied_chat_archive_summary"].includes(sourceRaw.toLowerCase())
      ?"not_independent_derivative_summary":"not_assessed";
  if(sourceRaw&&!declaredSourceType&&!alias)
    warnings.push(sourceRaw==="unverified"?"source_type_misused_for_verification":"unmapped_legacy_source_type");
  if(alias)warnings.push("legacy_source_alias_retained_raw_provenance");
  const dateFields=["event_date","published_at","received_at","imported_at","verified_at"] as const;
  for(const field of dateFields){
    if(fm[field]!==undefined&&fm[field]!==null&&strictDate(fm[field])===null)
      warnings.push("invalid_"+field);
  }
  const eventDate=strictDate(fm.event_date);
  const publishedAt=strictDate(fm.published_at);
  const importedAt=strictDate(fm.imported_at);
  const legacyDate=strictDate(fm.date);
  const legacyImportedOn=strictDate(fm.imported_on);
  if(!eventDate&&legacyDate)warnings.push("legacy_date_is_not_event_date");
  if(!importedAt&&legacyImportedOn)warnings.push("legacy_imported_on_not_inferred");
  const originalSource=asText(fm.original_source);
  const sourceUrlAlias=asText(fm.source_url);
  if(sourceUrlAlias&&!originalSource)warnings.push("source_url_not_confirmed_original");
  const fullHash=hash(fm.original_source_sha256);
  const excerptHash=hash(fm.source_excerpt_sha256);
  if(asText(fm.original_source_sha256)&&!fullHash)warnings.push("invalid_original_source_hash");
  if(asText(fm.source_excerpt_sha256)&&!excerptHash)warnings.push("invalid_source_excerpt_hash");
  const sourceHashScope:SchemaInspection["sourceHashScope"]=fullHash?"unverified_full_document_hash_declared":
    excerptHash?"excerpt_only":"none";
  if(sourceHashScope==="excerpt_only")
    warnings.push("excerpt_hash_does_not_verify_original_bytes");
  if(fullHash)warnings.push("full_document_hash_is_note_declared_not_reverified");
  const claims=Array.isArray(fm.claims)?fm.claims:[];
  if(role==="structured_claim"){
    if(!asText(fm.domain))claimIssues.push("missing_domain");
    if(!asText(fm.entity))claimIssues.push("missing_top_level_entity");
    if(!originalSource&&!sourceUrlAlias)claimIssues.push("missing_source_locator");
    if(!asText(fm.event_key))warnings.push("missing_event_key_needs_resolution");
    if(!claims.length)claimIssues.push("missing_claims");
    for(let i=0;i<Math.min(claims.length,100);i++){
      const c=claims[i], tag="claim_"+i+"_";
      if(!isObj(c)){claimIssues.push(tag+"not_object");continue;}
      if(!asText(c.claim_id))claimIssues.push(tag+"missing_claim_id");
      if(!asText(c.metric))claimIssues.push(tag+"missing_metric");
      if(!asText(c.period))claimIssues.push(tag+"missing_period");
      if(!asText(c.unit))claimIssues.push(tag+"missing_unit");
      if(!asText(c.value))claimIssues.push(tag+"missing_literal_value");
      if(!asText(c.entity)&&!asText(fm.entity))claimIssues.push(tag+"missing_entity");
      if(!asText(c.original_source)&&!asText(c.source_url)&&!originalSource&&!sourceUrlAlias)
        claimIssues.push(tag+"missing_source");
      // A child issuer intentionally overrides the parent. Never silently
      // attribute the child claim to the parent issuer for matching.
      if(asText(c.entity)&&asText(fm.entity)&&c.entity!==fm.entity)
        warnings.push(tag+"explicit_different_issuer_do_not_inherit");
    }
    if(claims.length>100)warnings.push("claims_audit_truncated_at_100");
  }
  if(role==="source_receipt"&&excerptHash&&!fullHash)
    warnings.push("receipt_is_audit_metadata_not_independent_evidence");
  if(role==="thesis"&&asText(fm.status)!=="owner_approved")
    warnings.push("thesis_not_owner_approved_by_status");
  return {
    status:"read_time_adapter_only",role,declaredSourceType,rawSourceType,
    normalizedSourceType,sourceTypeMapping,independenceAssessment,
    declaredVerification:asText(fm.verification),
    originalSource,sourceUrlAlias,eventDate,publishedAt,importedAt,
    legacyDate,legacyImportedOn,sourceHashScope,
    claimCount:claims.length,claimIssues:claimIssues.slice(0,35),
    warnings:[...new Set(warnings)].slice(0,20),canAutoUpdateThesis:false,
  };
}

import {macroHistoryScopeSchema,type MacroHistoryScope} from "./macro-source-scope";
import {preservedSubmittedText,preservedTextSection} from "./research-decision-v2";
import {discoverStandaloneSources,type StandaloneSourceBinding,type StandaloneSourceScan} from "./standalone-source-context";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {historyCutoffSchema,RetrievalObserver,type RetrievalCoverage} from "./investment-retrieval-coverage";
import { searchVault, judgeExclusionSql, type JudgeSelectionPolicy } from "./queries";
import { db } from "../db";
import { readNote } from "./notes";
import { resolveNotePath, resolveFolderPath } from "./paths";
import { splitFrontmatter, extractStructure } from "./markdown";
import { inspectCanonicalKnowledgeMetadata, type SchemaInspection } from "./investment-knowledge-schema";
import { hubIdentityKey, indexedHubAliases, indexedTopLevelHubs } from "./investment-routing-v2";
import { receiptVersionAt, discoverCanonicalResearch, isCanonicalResearchPath, isReceiptedReviewPath, publicationWindow, type ContextBundle, type CanonicalResearchScan } from "./investment-research-context";
import { canonicalHttpSourceUrl } from "../source-url";

export type Focus = "earnings" | "broker" | "tam" | "macro" | "thesis" | "general";
export type Role = "rules" | "thesis" | "evidence_register" | "timeline" | "company" | "industry" | "source" | "research" | "archive";
export interface Input { historyCutoff?:string; macroScope?:MacroHistoryScope; question: string; issuers?: string[]; intakeId?: string; industry?: string; focus?: Focus; maxNotes?: number; maxChars?: number }
export interface IssuerResolution {
  requested:string;contextKey:string|null;hubPath:string|null;
  status:"exact_existing_title"|"indexed_alias"|"unresolved"|"ambiguous_hold"|"readback_hold"|"index_limit_hold"|"invalid_hold";
}
export interface IssuerCoverage {requested:string;contextKey:string|null;selectedRoles:Role[];missingRoles:Role[]}
export interface ResearchCoverage {
  requested:string;contextKey:string|null;
  scope:"bounded_issuer_research_candidates";
  canonicalReview:Coverage;counterEvidence:Coverage;historicalComparator:Coverage;
  chronology:CanonicalResearchScan["chronology"];latestReviewPaths:string[];
}
interface Coverage {scopeDefinition?:CanonicalResearchScan["scopeDefinition"]|null;finding?:"FOUND"|"NOT_FOUND_WITHIN_VERIFIED_SCOPE"|"SCAN_INCOMPLETE";status:"FOUND"|"NOT_FOUND"|"SCAN_INCOMPLETE";paths:string[];scanComplete:boolean;reasons:string[]}
export interface IdentityHoldDiscovery {
  requested:string;resolutionStatus:IssuerResolution["status"];mappingVerified:false;
  basis:"literal_historical_candidates_only";candidatePaths:string[];scanComplete:boolean;reasons:string[];
}
export interface MacroCoverage {scope:string;subjectEvidence:Coverage;counterEvidence:Coverage}
type DeclaredDate={status:"DECLARED"|"UNKNOWN";value:string|null};
export interface ResearchChronology {eventDate:DeclaredDate;publicationDate:DeclaredDate;analysisDate:DeclaredDate;importDate:DeclaredDate}
export interface Item { citationSpans:{start:number;end:number;excerptStart:number;excerptEnd:number}[]; pointInTime?:ReturnType<typeof receiptVersionAt>&{cutoff:string}; sourceBinding?:StandaloneSourceBinding; researchTrust:SchemaInspection["researchTrust"]; contentSha256:string; path: string; role: Role; evidenceUse:"historical_context_only"|"unverified_candidate"; declaredVerification: string|null; declaredSourceType:string|null; declaredEventDate: string|null; declaredPublishedAt: string|null; chronology:ResearchChronology;matchedMacroScopes:string[];score: number; excerpt: string; line: number; truncated: boolean; counterEvidenceExcerptIncluded: boolean; schemaCompatibility: SchemaInspection }
export interface ResearchFallback {
 status:"bounded_discovery_not_selected_evidence";truncated:boolean;
  candidates:{path:string;intakeId:string|null;kind:"source_intake"|"canonical_review"|"historical_related"|"related_context";sha256:string|null;
  receiptId:string|null;bindingStatus:"receipt_bound"|"HOLD";researchTrust:Item["researchTrust"];
  eventDate:string|null;publicationDate:string|null;reason:"outside_selected_context"|"canonical_read_limit"|"declared_multi_issuer_relation"|"pit_not_selected_or_unverified"|"macro_country_unattributed"|"other_issuer_literal_mention";issuerAttribution?:"not_established";
  countryAttribution?:"not_established";literalMention?:string;
  accessStatus?:"AVAILABLE_NOT_RETRIEVED";metadataBasis?:"index_only_unverified"}[];
 instructions:string;
}
export interface Pack { discovery:ContextDiscovery; researchFallback:ResearchFallback;standaloneSources:StandaloneSourceScan[]; retrieval:RetrievalCoverage; status: "retrieval_only_not_verified"; question: string; issuers: string[]; issuerResolution:IssuerResolution[];issuerCoverage:IssuerCoverage[];identityHoldDiscovery:IdentityHoldDiscovery[];macroCoverage:MacroCoverage[];researchCoverage:ResearchCoverage[];contextBundles:ContextBundle[];focus: Focus; industry: string|null; items: Item[]; considered: number; selected: number; excerptChars: number; incomplete: string[]; omitted: string[]; warnings: string[] }

/** Diagnostic-only observed path ledger. Helpers also scan metadata internally;
 * their unreturned exclusions are NOT reconstructed, counted or "rescued" here.
 * Existing operational witness and Judge admission retain their own contracts. */
type PitReason="pit_after_cutoff"|"pit_receipt_unverified"|"pit_publication_after_cutoff"|"pit_read_limit";
type DiscoveryReason=PitReason|"industry_scope_excluded"|"issuer_scope_excluded"|"fts_window_truncated"|
  "restricted_low_trust"|"receipt_binding_unverified"|"legacy_review_scope_unverified"|
  "readback_failed"|"note_budget"|"excerpt_budget"|"role_quota"|"explicit_scope_exclusion"|
  "no_candidate_in_completed_scope"|"scope_scan_incomplete"|"not_selected_in_bounded_context"|
  "canonical_read_limit"|"canonical_not_admitted"|"issuer_identity_conflict"|"issuer_lexical_window_not_returned"|
  "declared_multi_issuer_relation"|"historical_primary_subject"|"historical_joint_subject"|
  "joint_subject_unconfirmed"|"declared_company_identity_unresolved"|"question_term_fts_window_truncated"|"historical_context_slot"|
  "macro_country_unattributed"|"historical_context_cap"|"source_family_duplicate"|"other_issuer_literal_mention"|OptionalHistoryFailure;
type OptionalHistoryFailure="optional_history_metadata_drift"|"optional_history_missing_file"|
  "optional_history_permission_denied"|"optional_history_io_error"|"optional_history_read_error";
function optionalHistoryReadError(e:unknown):OptionalHistoryFailure{
  const code=(e as {code?:unknown})?.code;
  return code==="ENOENT"?"optional_history_missing_file":code==="EACCES"||code==="EPERM"?"optional_history_permission_denied":
    code==="EIO"?"optional_history_io_error":"optional_history_read_error";
}
type Terminal="PIT_HOLD"|"SELECTED"|"FALLBACK_EXPOSED"|"OMITTED_BUDGET"|"RESTRICTED"|"READBACK_HOLD"|"OTHER_EXCLUDED";
export interface ContextDiscovery {
  version:1;scope:"observed_bounded_context_paths";countsStatus:"COUNTS_UNRECONCILED";
  coverage_incomplete:true;uniqueDiscoveredPaths:null;unobservedStages:string[];
  questionTermTruncation:{limit:30;queries:string[];unobservedCandidatePaths:null;unobservedCandidateCount:null};
  rawFtsHits:number;observedUniquePaths:number;observedPathsTruncated:boolean;
  observedTerminalCounts:Record<Terminal,number>;detailsTruncated:boolean;reasons:DiscoveryReason[];
  paths:{path:string;disposition:Terminal;reasons:DiscoveryReason[]}[];
}
class ContextObserver extends RetrievalObserver {
  private observed=new Map<string,Set<DiscoveryReason>>();
  private discoveryReasons=new Set<DiscoveryReason>(["scope_scan_incomplete"]);
  private overflow=false;
  private rawFtsHits=0;
  private questionWindows=new Set<string>();
  questionWindow(query:string,total:number,returned:number){
    if(total>returned){this.questionWindows.add(query);this.discoveryReasons.add("question_term_fts_window_truncated");}
  }
  questionTruncation(){return {limit:30 as const,queries:[...this.questionWindows].sort(),unobservedCandidatePaths:null,unobservedCandidateCount:null};}
  observePath(path:string,reason?:DiscoveryReason){
    if(!this.observed.has(path)){
      if(this.observed.size>=2048){this.overflow=true;return;}
      this.observed.set(path,new Set());
    }
    if(reason){this.observed.get(path)!.add(reason);this.discoveryReasons.add(reason);}
  }
  override read<T>(stage:Parameters<RetrievalObserver["read"]>[0],path:string,run:()=>T):T{
    this.observePath(path);
    try{return super.read(stage,path,run);}catch(e){this.observePath(path,"readback_failed");throw e;}
  }
  override search<T>(stage:Parameters<RetrievalObserver["search"]>[0],query:string,folder:string|undefined,run:()=>T):T{
    const result=super.search(stage,query,folder,run);
    // Existing helper searches return path arrays; public FTS returns SearchPage.
    const page=result as {hits?:{path:string}[];total?:number};
    const rows:Array<{path?:unknown}>=Array.isArray(result)?result:page?.hits??[];
    this.rawFtsHits+=rows.length;
    for(const row of rows)if(typeof row.path==="string")this.observePath(row.path);
    if(typeof page?.total==="number"&&page.total>rows.length)this.discoveryReasons.add("fts_window_truncated");
    return result;
  }
  finish(items:Item[],fallback:ResearchFallback):ContextDiscovery{
    const selected=new Set(items.map(x=>x.path)),exposed=new Set(fallback.candidates.map(x=>x.path));
    for(const path of [...selected,...exposed])this.observePath(path);
    const counts:Record<Terminal,number>={PIT_HOLD:0,SELECTED:0,FALLBACK_EXPOSED:0,OMITTED_BUDGET:0,RESTRICTED:0,READBACK_HOLD:0,OTHER_EXCLUDED:0};
    const paths:ContextDiscovery["paths"]=[];
    for(const [path,reasons] of this.observed){
      const disposition:Terminal=reasons.has("readback_failed")?"READBACK_HOLD":[...reasons].some(r=>r.startsWith("pit_"))?"PIT_HOLD":selected.has(path)?"SELECTED":exposed.has(path)?"FALLBACK_EXPOSED":
        ["note_budget","excerpt_budget","role_quota","historical_context_cap"].some(r=>reasons.has(r as DiscoveryReason))?"OMITTED_BUDGET":
        ["receipt_binding_unverified","legacy_review_scope_unverified","restricted_low_trust"].some(r=>reasons.has(r as DiscoveryReason))?"RESTRICTED":"OTHER_EXCLUDED";
      if(disposition==="OTHER_EXCLUDED"&&!reasons.size)reasons.add("not_selected_in_bounded_context");
      counts[disposition]++;
      if(paths.length<64)paths.push({path,disposition,reasons:[...reasons].sort()});
    }
    return {version:1,scope:"observed_bounded_context_paths",countsStatus:"COUNTS_UNRECONCILED",coverage_incomplete:true,
      uniqueDiscoveredPaths:null,unobservedStages:["helper_metadata_discovery_and_exclusions","hub_index_discovery"],
      questionTermTruncation:this.questionTruncation(),rawFtsHits:this.rawFtsHits,observedUniquePaths:this.observed.size,observedPathsTruncated:this.overflow,
      observedTerminalCounts:counts,detailsTruncated:this.observed.size>paths.length||this.overflow,reasons:[...this.discoveryReasons].sort(),paths};
  }
}

function resolveIssuers(requested:string[],observer:RetrievalObserver,hubs:ReturnType<typeof indexedTopLevelHubs>):IssuerResolution[]{
  if(!requested.length)return [];
  // Same indexed Company Hub/alias contract as M5.2. A sentinel prevents an
  // incomplete index scan from establishing a falsely unique mapping.
  return requested.map(label=>{
    const result=(status:IssuerResolution["status"],contextKey:string|null=null,hubPath:string|null=null):IssuerResolution=>
      ({requested:label,status,contextKey,hubPath});
    if(!label||label.length>120||/[\\/]/.test(label)||[...label].some(c=>c.charCodeAt(0)<32)||label==="..")return result("invalid_hold");
    if(hubs.length>3000)return result("index_limit_hold");
    const wanted=hubIdentityKey(label);
    // Count title AND alias collisions. An exact title cannot excuse a second
    // Hub claiming the same alias. Never derive ADR/DR/market aliases by syntax.
    const candidates=hubs.filter(h=>hubIdentityKey(h.title)===wanted||
      indexedHubAliases(h.frontmatter).some(a=>hubIdentityKey(a)===wanted));
    if(candidates.length>1)return result("ambiguous_hold");
    if(!candidates.length)return result("unresolved");
    const hub=candidates[0];
    try{
      observer.read("issuer_identity",hub.path,()=>{
        const actual=JSON.stringify(splitFrontmatter(readNote(hub.path).content).data);
        const aliases=(fm:string|null)=>JSON.stringify([...new Set(indexedHubAliases(fm).map(hubIdentityKey))].sort());
        if(aliases(actual)!==aliases(hub.frontmatter))throw Error("readback_hold");
      });
    }catch{return result("readback_hold");}
    return result(hubIdentityKey(hub.title)===wanted?"exact_existing_title":"indexed_alias",hub.title,hub.path);
  });
}
function scopeKeys(r:IssuerResolution):string[]{
  if(r.contextKey)return [...new Set([r.requested,r.contextKey])];
  // Unmapped plain tickers retain literal historical discovery, explicitly
  // unresolved. Qualified/invalid identifiers never become unscoped queries.
  return r.status==="unresolved"&&/^[A-Z][A-Z0-9.-]{0,11}$/.test(r.requested)?[r.requested]:[];
}
function discoverDuringIdentityHold(resolutions:IssuerResolution[],observer:RetrievalObserver,policy?:JudgeSelectionPolicy):IdentityHoldDiscovery[]{
  return resolutions.filter(r=>["ambiguous_hold","readback_hold","index_limit_hold"].includes(r.status)&&
    /^[A-Z][A-Z0-9.-]{0,11}$/.test(r.requested)).map(r=>{
    const result:IdentityHoldDiscovery={requested:r.requested,resolutionStatus:r.status,mappingVerified:false,
      basis:"literal_historical_candidates_only",candidatePaths:[],scanComplete:true,reasons:[]};
    const folder="10_Knowledge/Company Research";
    if(!folderExists(folder)){
      result.scanComplete=false;result.reasons.push("literal_folder_unavailable");return result;
    }
    try{
      const found=observer.search("literal_discovery",r.requested,folder,()=>searchVault(r.requested,{folder,limit:31},policy));
      if(found.total>30){result.scanComplete=false;result.reasons.push("literal_search_limit");}
      const candidates=found.hits.slice(0,30).filter(h=>namedIssuers(h.path).includes(r.requested));
      if(candidates.length>12){result.scanComplete=false;result.reasons.push("literal_read_limit");}
      for(const h of candidates.slice(0,12))try{
        observer.read("literal_discovery",h.path,()=>{
          const raw=readNote(h.path).content;
          if(Buffer.byteLength(raw)>100000||JSON.stringify(splitFrontmatter(raw).data)!==JSON.stringify(indexedMetadata(h.path)))throw Error("unreadable");
          result.candidatePaths.push(h.path);
        });
      }catch{result.scanComplete=false;result.reasons.push("literal_readback_unavailable");}
    }catch{result.scanComplete=false;result.reasons.push("literal_search_unavailable");}
    result.reasons=[...new Set(result.reasons)];return result;
  });
}

export function roleOf(path: string): Role {
  if (path.includes("Evidence and Update Rules")) return "rules";
  if (/^05_Thesis\/.*Current Thesis/i.test(path)) return "thesis";
  if (/^05_Thesis\/.*Evidence Register/i.test(path)) return "evidence_register";
  if (/Company Evolution - |00_Investment_Evolution_Master/.test(path)) return "timeline";
  if (path.startsWith("01_Companies/")) return "company";
  if (/^02_Industries_Themes\/|^03_Concepts\/|TAM_Vintage|Economic_Transmission/.test(path)) return "industry";
  if (/Primary Evidence - |07_Sources\/Company Filings\/|07_Sources\/Earnings\//.test(path)) return "source";
  if (path.startsWith("07_Sources/ChatGPT/")) return "archive";
  return "research";
}
const genericTitleCode=(s:string)=>/^(?:P\d+|F\d+|Q\d+(?:FY\d+)?|FY\d+|USD|GDP|EPS|FCF|OCF|ROIC|BOM|TAM|GPU|CPU|CPO|NPO|ROI|CEO|CFO|IR|US|AI|DC|HBM|DRAM|CAPEX)$/.test(s);
const base: Record<Role, number> = { rules: 40, thesis: 100, evidence_register: 95, timeline: 85, company: 65, industry: 65, source: 87, research: 35, archive: 8 };
const quota: Partial<Record<Role, number>> = { rules: 1, thesis: 2, evidence_register: 2, timeline: 3, company: 3, industry: 3, source: 4, archive: 1 };
function terms(s: string): string[] {
  return [...new Set((s.match(/[\p{L}\p{N}][\p{L}\p{N}_.-]{1,35}/gu) || []).map(x=>x.toUpperCase()))].slice(0,10);
}
// Scope the candidate set before ranking. A ticker mentioned as a broker
// in somebody else's research is not evidence about the issuer's business.
function namedIssuers(path: string): string[] {
  const file=path.split("/").at(-1)??"";
  if(path.startsWith("01_Companies/")){const t=file.match(/^([A-Z][A-Z0-9.-]{0,11})\.md$/)?.[1];return t?[t]:[];}
  if(path.startsWith("05_Thesis/")){const t=file.match(/^([A-Z][A-Z0-9.-]{0,11}) - (?:Current Thesis|Evidence Register)/)?.[1];return t?[t]:[];}
  const structured=file.match(/^(?:Company Evolution - |Company - |Primary Evidence - )([A-Z][A-Z0-9.-]{0,11})(?:\s|\.md)/)?.[1];
  if(structured)return [structured];
  // Many Company Research titles list the covered issuer before a broker.
  // E.g. "ASML - JPM Q3 Preview" concerns ASML, not the bank JPM.
  // Reject obvious generic metric acronyms and source/vintage IDs; this is a
  // conservative title heuristic, not proof of an issuer's legal identity.
  if(path.startsWith("10_Knowledge/Company Research/")){
    // Archived company research declares company tags in frontmatter. Their
    // order is not primary attribution; historicalScope checks title subjects.
    // A title like "CrowdStrike × CLEAR" otherwise returns CLEAR as the first
    // all-caps token and incorrectly excludes the CRWD research event.
    const indexed=db().prepare("SELECT frontmatter FROM notes WHERE path=?").get(path) as
      {frontmatter:string|null}|undefined;
    if(indexed?.frontmatter){
      try {
        const fm=JSON.parse(indexed.frontmatter) as Record<string,unknown>;
        const declared=Array.isArray(fm.company)?fm.company:[fm.company];
        const tagged=declared.filter((v):v is string=>typeof v==="string")
          .map(v=>v.trim().toUpperCase()).filter(v=>/^[A-Z][A-Z0-9.-]{0,11}$/.test(v));
        if(tagged.length)return [...new Set(tagged)];
      }catch{/* Invalid legacy metadata falls back to conservative filename inference. */}
    }
    const codes=[...file.matchAll(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,7})(?=[^A-Za-z0-9]|$)/g)]
      .map(x=>x[1]).filter(x=>!genericTitleCode(x));
    return codes.slice(0,1);
  }
  return [];
}
function primaryTitleIssuer(path:string,knownHubLabels:Set<string>):string|null{
  if(!path.startsWith("10_Knowledge/Company Research/"))return null;
  const file=(path.split("/").at(-1)??"").replace(/^\d{4}-\d{2}-\d{2} - /,"");
  const prefix=file.match(/^([A-Z][A-Z0-9.-]{0,11}) - (.*)$/);
  if(!prefix)return null;
  // AI etc can also be real ticker/alias labels. Use the SAME bounded Hub
  // inventory; never erase a registered label with a global acronym stoplist.
  if(!genericTitleCode(prefix[1])||knownHubLabels.has(hubIdentityKey(prefix[1])))return prefix[1];
  const subject=prefix[2].match(/^([A-Z][A-Z0-9.-]{0,11})(?=\s|\.md$)/)?.[1];
  return subject&&(!genericTitleCode(subject)||knownHubLabels.has(hubIdentityKey(subject)))?subject:null;
}
function jointTitleIssuers(path:string,knownHubLabels:Set<string>):string[]{
  const file=(path.split("/").at(-1)??"").replace(/^\d{4}-\d{2}-\d{2} - /,"");
  const joint=file.match(/^([A-Z][A-Z0-9.-]{0,11})\s+(?:×|x|X|&|\+|vs\.?|and)\s+([A-Z][A-Z0-9.-]{0,11})(?=\s|\.md$)/);
  // Explicit title grammar only, not economic equivalence or an inferred alias.
  return joint&&joint.slice(1).every(label=>!genericTitleCode(label)||knownHubLabels.has(hubIdentityKey(label)))?joint.slice(1):[];
}
const STOP_SCOPE = new Set(["AND","THE","WITH","FROM","FOR","MARKET","MARKETS","MACRO","ECONOMY","ECONOMIC","INDUSTRY","GLOBAL","FINANCIAL","COMPANY","RESEARCH","STOCK","EQUITY","WHAT","IS","ARE","HOW","LATEST","OFFICIAL","POLICY","OVERVIEW","HISTORICAL","ARCHIVE"]);
function topicTerms(s: string): string[] { return terms(s).filter(t=>!STOP_SCOPE.has(t)); }
function issuerTokenInTitle(path: string, issuers: string[]) {
  const name=path.split("/").at(-1)?.toUpperCase()??"";
  return issuers.some(t=>name.split(/[^A-Z0-9]+/).includes(t));
}
// When user asks about a *country*, a casual mention in a Japan/US
// headline is not sufficient relevance for a country-specific macro brief.
// Retain topic-named notes and explicit country-tagged metadata; broader
// regional documents require separate query/review rather than silent mixing.
// DELTA-01 C1: closed, reviewed country identity aliases (canonical key -> forms).
// Identity spellings only: no agency/institution/person inference (Fed, FOMC,
// BLS or a governor's name never establishes a country).
const MACRO_SCOPE_ALIASES:Readonly<Record<string,readonly string[]>>={
  "UNITED STATES":["US","U.S.","USA","U.S.A.","สหรัฐฯ","สหรัฐอเมริกา"],
};
const upperNfc=(s:string)=>s.trim().normalize("NFC").toUpperCase();
/** Canonical scope key for a closed alias, else null (the label is used as before). */
function canonicalMacroScope(label:string):string|null{
  const k=upperNfc(label);
  for(const [key,forms] of Object.entries(MACRO_SCOPE_ALIASES))if(k===key||forms.some(f=>upperNfc(f)===k))return key;
  return null;
}
const isBoundary=(c:string|undefined)=>!c||!/[\p{L}\p{N}]/u.test(c);
function boundaryAt(hay:string,needle:string):boolean{
  for(let at=hay.indexOf(needle);at>=0;at=hay.indexOf(needle,at+1))if(isBoundary(hay[at-1])&&isBoundary(hay[at+needle.length]))return true;
  return false;
}
function aliasInTitle(file:string,form:string):boolean{
  // Thai has no word spaces. The closed Thai forms carry "ฯ"/"อเมริกา", so the
  // UAE name ("สหรัฐอาหรับเอมิเรตส์") never matches a bare "สหรัฐ" prefix.
  if(/\p{Script=Thai}/u.test(form))return file.includes(form);
  // Latin forms are case-sensitive: "us"/"Us" are words; USD, AUS, USMCA fail the boundary.
  return boundaryAt(file,form);
}
const GEOGRAPHY_FIELDS=["country","geography","region"] as const;
const declaredValues=(fm:Record<string,unknown>,keys:readonly string[])=>
  keys.flatMap(k=>Array.isArray(fm[k])?fm[k] as unknown[]:[fm[k]]).filter(x=>x!==undefined&&x!==null);
function explicitMacroScope(path: string, topic: string, current?:Record<string,unknown>, identityAliases=false): boolean {
  const file=(path.split("/").at(-1)||"").normalize("NFC"),title=file.toUpperCase();
  const t=topic.normalize("NFC").toUpperCase();
  const forms=identityAliases?MACRO_SCOPE_ALIASES[t]??[]:[];
  const titled=boundaryAt(title,t)||forms.some(f=>aliasInTitle(file,f));
  // Legacy literal contract (source-bound macroScope history): unchanged.
  if(titled&&!identityAliases)return true;
  try {
    const fm=current??indexedMetadata(path);
    const same=(x:unknown)=>typeof x==="string"&&[t,...forms.map(upperNfc)].includes(upperNfc(x));
    if(declaredValues(fm,["country","entity","geography","region"]).some(same))return true;
    // C1: a title match yields to explicit declared geography. Any declared
    // country/geography/region naming something else (or not a plain label)
    // is a conflict or ambiguity: fail closed instead of admitting by title.
    return titled&&declaredValues(fm,GEOGRAPHY_FIELDS).length===0;
  }catch{return false;}
}
/** Macro subjects named in the question (any 1..3 consecutive topic words) and
 * verifiable in the index. Strong evidence: a declared country/entity/geography/
 * region or source-bound macro_subject label, the subject of a canonical Macro
 * Review title, or an existing Theme Hub title/alias (02_Industries_Themes). Title
 * evidence (only when no strong subject exists): a Macro note title segment that
 * starts with those words, so "Bureau" inside "China National Bureau of
 * Statistics" is not a subject. Declaration/title only, never geographic truth. */
function questionMacroSubjects(question:string,exclusion:string,excluded:readonly string[]):{scopes:string[];basis:"declared"|"title"|null;limited:boolean}{
  const words=topicTerms(question);
  if(!words.length)return {scopes:[],basis:null,limited:false};
  const rows=db().prepare(`SELECT path,frontmatter FROM notes WHERE (path LIKE '10_Knowledge/Macro and Markets/%' OR
    (json_valid(frontmatter)=1 AND (json_type(frontmatter,'$.country') IS NOT NULL OR json_type(frontmatter,'$.entity') IS NOT NULL OR
    json_type(frontmatter,'$.geography') IS NOT NULL OR json_type(frontmatter,'$.region') IS NOT NULL OR json_type(frontmatter,'$.macro_subject') IS NOT NULL)))${exclusion} LIMIT 5001`)
    .all(...excluded) as {path:string;frontmatter:string|null}[];
  if(rows.length>5000)return {scopes:[],basis:null,limited:true};
  const strong=new Map<string,string>(),titled=new Map<string,string>();
  const key=(s:string)=>topicTerms(s).join(" ");
  const add=(label:unknown)=>{if(typeof label!=="string"||!label.trim()||label.length>120)return;
    const k=key(label);if(k)strong.set(k,label.trim().normalize("NFC").toUpperCase());};
  for(const row of rows){
    const base=row.path.split("/").at(-1)!.replace(/\.md$/,"");
    add(/^10_Knowledge\/Macro and Markets\/Investment Review - (.+) - IN-[A-F0-9]{16}\.md$/.exec(row.path)?.[1]);
    if(row.path.startsWith("10_Knowledge/Macro and Markets/"))for(const segment of base.split(" - ")){
      // Structural labels, dates and receipt IDs name no subject.
      if(/^(?:Investment Review|Claim Register|Investment Intake|\d{4}-\d{2}-\d{2}|IN-[A-F0-9]{16})$/i.test(segment.trim()))continue;
      // Every leading 1..3 topic-word prefix of the segment, kept in its original
      // spelling so the scope still matches the title literally.
      const raw=segment.trim().split(/\s+/);let terms=0;
      for(let i=0;i<raw.length&&terms<3;i++){
        if(!topicTerms(raw[i]).length)continue;terms++;
        const phrase=raw.slice(0,i+1).join(" "),k=key(phrase);
        if(k&&!titled.has(k))titled.set(k,phrase.normalize("NFC").toUpperCase());
      }
    }
    let fm:unknown;try{fm=row.frontmatter?JSON.parse(row.frontmatter):null;}catch{continue;}
    if(!fm||typeof fm!=="object"||Array.isArray(fm))continue;
    const f=fm as Record<string,unknown>;
    for(const v of [f.country,f.entity,f.geography,f.region].flatMap(x=>Array.isArray(x)?x:[x]))add(v);
    if(f.macro_subject&&typeof f.macro_subject==="object")add((f.macro_subject as {label?:unknown}).label);
  }
  // Existing Theme Hubs (top-level 02_Industries_Themes notes) and their aliases.
  for(const hub of indexedTopLevelHubs("02_Industries_Themes/")){add(hub.title);for(const alias of indexedHubAliases(hub.frontmatter))add(alias);}
  // Longest first, non-overlapping positions in the question.
  const pick=(index:Map<string,string>)=>{
    const taken=new Set<number>(),found:string[]=[];
    for(let n=Math.min(3,words.length);n>=1;n--)for(let i=0;i+n<=words.length;i++){
      const span=[...Array(n).keys()].map(j=>i+j);if(span.some(j=>taken.has(j)))continue;
      const hit=index.get(words.slice(i,i+n).join(" "));
      if(hit&&!found.includes(hit)){found.push(hit);span.forEach(j=>taken.add(j));}
    }
    return found;
  };
  const declared=pick(strong);
  if(declared.length)return {scopes:declared,basis:"declared",limited:false};
  const titles=pick(titled);
  return {scopes:titles,basis:titles.length?"title":null,limited:false};
}
function indexedMetadata(path:string):Record<string,unknown>{
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path = ?").get(path) as {frontmatter:string|null}|undefined;
  try{
    const fm:unknown=row?.frontmatter?JSON.parse(row.frontmatter):null;
    return fm&&typeof fm==="object"&&!Array.isArray(fm)?fm as Record<string,unknown>:{};
  }catch{return {};}
}
/** Declared origin only (exact canonical source URL, else original source path,
 * else original source label). Never inferred from titles, feeds or dates. */
function sourceFamilyKey(path:string):string|null{
  const fm=indexedMetadata(path),text=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;
  const url=canonicalHttpSourceUrl(text(fm.source_url));
  if(url)return "url:"+url;
  const original=text(fm.original_source_path);
  if(original)return "path:"+original;
  const label=text(fm.original_source);
  return label?"source:"+label:null;
}
function historicalOnly(path:string,fm:Record<string,unknown>):boolean{
  if(inspectCanonicalKnowledgeMetadata(path,fm).researchTrust?.usage_tier==="historical_analysis_only")return true;
  const schema=inspectCanonicalKnowledgeMetadata(path,fm);
  return path.startsWith("07_Sources/ChatGPT/")||schema.role==="archive"||
    schema.independenceAssessment!=="not_assessed";
}
function exists(path: string): boolean {
  try { return fs.existsSync(resolveNotePath(path)); } catch { return false; }
}
function folderExists(path:string):boolean{
  try{return fs.statSync(resolveFolderPath(path)).isDirectory();}catch{return false;}
}
// Section hints only, never a factual determination that a claim is adverse.
const COUNTER_SECTION=/^\s*#{1,6}\s+.*(counter[- ]?evidence|contradict|invalidation|\brisk|\badverse|\bdownside|\bstress|ข้อขัดแย้ง|ข้อโต้แย้ง|ความเสี่ยง)/i;
function selectedLines(raw: string, search: string[], max: number, role: Role, reserveCounter=false,sourceOffset=0,lineOffset=0,priority:string[]=[],bodyOnly=false) {
  const lines=raw.split(/\r?\n/),offsets:number[]=[];
  let cursor=0;
  for(const text of lines){offsets.push(cursor+sourceOffset);cursor+=text.length;if(raw[cursor]==="\r")cursor++;if(raw[cursor]==="\n")cursor++;}
  // Reuse the existing Markdown heading parser (ATX, Setext, code/comment
  // exclusion). Never treat the next Setext title as this section's evidence.
  const parsed=splitFrontmatter(raw);
  // DELTA-01 C4: YAML metadata is already returned as declared fields; the
  // excerpt window starts in the note body whenever the body has content.
  // Offsets/lines still index the exact original bytes (only the start moves).
  const bodyStart=bodyOnly&&parsed.fmOffset>0&&lines.slice(parsed.fmOffset).some(s=>/[\p{L}\p{N}]/u.test(s))?parsed.fmOffset:0;
  // Requested issuer labels outrank generic question words (case-sensitive, whole token).
  const priorityRe=priority.map(label=>new RegExp(`(^|[^\\p{L}\\p{N}])${label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?=$|[^\\p{L}\\p{N}])`,"u"));
  let index=bodyStart,maxHits=0;
  for(let i=bodyStart;i<Math.min(lines.length,1200);i++){
    const lower=lines[i].toLowerCase(),hits=search.filter(t=>t.length>1&&lower.includes(t.toLowerCase())).length+
      100*priorityRe.filter(r=>r.test(lines[i])).length;
    if(hits>maxHits){index=i;maxHits=hits;}
  }
  // The best line must fall inside the 12-line window (a >15 threshold hid lines 12-15).
  const start=index-bodyStart>11?Math.max(bodyStart,index-2):bodyStart,firstEnd=Math.min(lines.length,start+12);
  const headings=extractStructure(parsed.body).headings.map(h=>({...h,line:h.line+parsed.fmOffset-1}));
  const headingLines=new Set<number>();
  for(const h of headings){
    headingLines.add(h.line);
    if(!/^ {0,3}#{1,6}(?:\s|$)/.test(lines[h.line]))headingLines.add(h.line+1);
  }
  const counterHeading=["thesis","evidence_register","source","research"].includes(role)
    ?headings.find(h=>h.line<1200&&COUNTER_SECTION.test("# "+h.text)):undefined;
  const counter=counterHeading?.line??-1;
  const boundary=counterHeading?headings.find(h=>h.line>counter&&h.level<=counterHeading.level)?.line:undefined;
  const end=counter<0?0:Math.min(lines.length,counter+8,boundary??lines.length);
  // Reference definitions (including continuation destinations/titles) are
  // metadata, not rendered counter text. Conservative omission, never trust.
  const hidden=new Set<number>();
  let comment=false;
  for(let i=Math.max(0,counter+1);i<end;i++){
    if(comment||lines[i].includes("<!--")){
      hidden.add(i);comment=!lines[i].includes("-->");continue;
    }
    const definition=/^ {0,3}\[(?:\\.|[^\]\\])+\]:\s*(.*)$/.exec(lines[i]);
    if(!definition)continue;
    hidden.add(i);
    let tail=definition[1],next=i+1;
    if(!tail.trim()&&next<end&&lines[next].trim()){hidden.add(next);tail=lines[next++].trim();}
    const inlineTitle=/^(?:<[^>]*>|\S+)\s+(["'(])/.exec(tail);
    const title=inlineTitle?tail.slice(inlineTitle.index+inlineTitle[0].length-1):
      next<end&&/^\s*["'(]/.test(lines[next])?lines[next++].trim():null;
    if(title){
      if(!inlineTitle)hidden.add(next-1);
      const close=title[0]==="("?")":title[0];
      if(!title.slice(1).includes(close)){
        while(next<end&&lines[next].trim()){hidden.add(next);if(lines[next++].includes(close))break;}
      }
    }
    i=next-1;
  }
  const body=counter<0?-1:lines.findIndex((s,i)=>i>counter&&i<end&&!headingLines.has(i)&&!hidden.has(i)&&
    /[\p{L}\p{N}]/u.test(s)&&!/^\s*(?:\x60\x60\x60|~~~)/.test(s));
  // Carry source offsets while constructing/clipping the visible excerpt.
  // Synthetic labels and separators have no source offset and cannot be cited.
  type Piece={text:string;start?:number};
  const length=(p:Piece[])=>p.reduce((n,x)=>n+x.text.length,0);
  const clip=(p:Piece[],budget:number):Piece[]=>{
    const out:Piece[]=[];let remaining=Math.max(0,budget);
    for(const piece of p){if(!remaining)break;const text=piece.text.slice(0,remaining);out.push({...piece,text});remaining-=text.length;}
    return out;
  };
  const block=(from:number,to:number,label:string):Piece[]=>[{text:label},...lines.slice(from,to).flatMap((text,i)=>
    [...(i?[{text:"\n"}]:[]),{text,start:offsets[from+i]}])];
  const label="[Source lines "+(start+1+lineOffset)+"-"+(firstEnd+lineOffset)+"]\n";
  let pieces=block(start,firstEnd,label),line=start+1,reallocated=false;
  const evidenceEnd=counter>=start&&body>=0&&body<firstEnd?label.length+lines.slice(start,body+1).join("\n").length:Infinity;
  const headingLast=counter<0?-1:counter+(headingLines.has(counter+1)&&!/^ {0,3}#{1,6}(?:\s|$)/.test(lines[counter])?1:0);
  const headingEnd=counter>=start&&headingLast<firstEnd?label.length+lines.slice(start,headingLast+1).join("\n").length:Infinity;
  if(counter>=0&&body>=0&&evidenceEnd>max&&max>=700&&(counter<start||counter>=firstEnd||headingEnd<=max)){
    const section=(to:number)=>block(counter,to,"\n\n[Counter-evidence / risk section: source lines "+(counter+1+lineOffset)+"-"+(to+lineOffset)+"]\n");
    const minimum=section(body+1);
    const available=reserveCounter?Math.min(max,Math.max(length(minimum),Math.floor(max*0.4))):max-length(pieces);
    if(length(minimum)<=available){
      let to=body+1;while(to<end&&length(section(to+1))<=available)to++;
      const addition=section(to),room=max-length(addition),marker="\n[excerpt clipped]\n";
      if(length(pieces)>room){
        pieces=room>=label.length+marker.length?[...clip(pieces,room-marker.length),{text:marker}]:[];
        if(!pieces.length)line=counter+1;
      }
      pieces.push(...addition);reallocated=true;
    }
  }
  const total=length(pieces),visible=clip(pieces,max);
  const fullLine=(i:number)=>i>=0&&visible.some(p=>p.start===offsets[i]&&p.text===lines[i]);
  const included=counter>=0&&body>=0&&fullLine(counter)&&fullLine(headingLast)&&fullLine(body);
  const missing=counter>=0&&!included;
  let excerptOffset=0;
  const spans=visible.flatMap(p=>{
    const excerptStart=excerptOffset;excerptOffset+=p.text.length;
    return p.start===undefined||!p.text.trim()?[]:[{start:p.start,end:p.start+p.text.length,excerptStart,excerptEnd:excerptOffset}];
  });
  const citationSpans=[...new Map(spans.map(s=>[s.start+":"+s.end,s])).values()].slice(0,64);
  return {excerpt:visible.map(p=>p.text).join(""),line:line+lineOffset,citationSpans,
    truncated:reallocated||missing||start>0||firstEnd<lines.length||length(visible)<total,
    counterEvidenceExcerptIncluded:included,counterEvidenceMissing:missing};
}

function declared(raw: string, notePath: string) {
  const f = splitFrontmatter(raw).data as Record<string,unknown>;
  const schema=inspectCanonicalKnowledgeMetadata(notePath,f);
  const date=(value:string|null):DeclaredDate=>({status:value?"DECLARED":"UNKNOWN",value});
  return {researchTrust:schema.researchTrust,declaredVerification:typeof f.verification==="string"?f.verification:null,declaredEventDate:schema.eventDate,declaredPublishedAt:schema.publishedAt,
    declaredSourceType:typeof f.source_type==="string"?f.source_type.slice(0,80):typeof f.source_tier==="string"?f.source_tier.slice(0,80):null,
    chronology:{eventDate:date(schema.eventDate),publicationDate:date(schema.publishedAt),analysisDate:date(schema.analysisDate),importDate:date(schema.importedAt)},schemaCompatibility:schema};
}
export function buildInvestmentContextPack(req: Input,judgePolicy?:JudgeSelectionPolicy): Pack {
  const exclusion=judgeExclusionSql(judgePolicy),excluded=judgePolicy?.excludedPaths??[];
  const question = req.question.trim().slice(0,1200);
  if (question.length<3) throw new Error("Question must contain at least 3 characters");
  const historyCutoff=req.historyCutoff===undefined?undefined:historyCutoffSchema.parse(req.historyCutoff);
  const hubs=indexedTopLevelHubs("01_Companies/");
  // Narrow, explicit attribution syntax only. Preserve the original question
  // and count mentions outside this leading source clause as subjects; a firm
  // mentioned in both roles still remains an issuer. No issuer-name rules.
  const attribution=/^\s*according to\s+[^,\n!?;:]{1,160},\s*/i.exec(question);
  const subjectQuestion=question.slice(attribution?.[0].length??0);
  // Question text is unchanged. Only literal, indexed Hub titles/aliases may
  // supply an omitted scope; the existing collision/readback gate still runs.
  // Short ticker-like labels require exact case; ordinary words must not become
  // a ticker by uppercasing the whole question. Explicit [] and macro opt out.
  const inferred=req.issuers===undefined&&req.focus!=="macro"&&!req.macroScope?hubs.flatMap(h=>
    [h.title,...indexedHubAliases(h.frontmatter)].filter(label=>{
      if(label.length<2||label.length>120)return false;
      // Existing ambiguous metric/acronym labels need a leading subject or
      // explicit ticker notation, even when a real Hub has that same title.
      if(genericTitleCode(label)&&!subjectQuestion.startsWith(label+" ")&&!subjectQuestion.includes("$"+label))return false;
      const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,/^[A-Z0-9.-]{1,5}$/.test(label)?"u":"iu").test(subjectQuestion);
    })):[];
  const allRequested=[...new Set((req.issuers??inferred).map(s=>s.trim().toUpperCase()))];
  if(req.issuers===undefined&&allRequested.length>6)throw Error("question_issuer_scope_limit");
  const requestedIssuers = allRequested.slice(0,6);
  if(req.intakeId&&(!/^IN-[A-F0-9]{16}$/.test(req.intakeId)||!requestedIssuers.length))throw Error("Intake scope requires a valid intake ID and issuer scope");
  const observer=new ContextObserver();
  const issuerResolution=resolveIssuers(requestedIssuers,observer,hubs);
  const identityHoldDiscovery=discoverDuringIdentityHold(issuerResolution,observer,judgePolicy);
  const issuers=[...new Set(issuerResolution.flatMap(scopeKeys).map(x=>x.toUpperCase()))];
  const contextKeys=[...new Set(issuerResolution.flatMap(r=>r.contextKey?[r.contextKey]:scopeKeys(r)))];
  const issuerScoped=requestedIssuers.length>0;
  const focus = req.focus||"general";
  const verifiedMacro=req.macroScope===undefined?undefined:macroHistoryScopeSchema.parse(req.macroScope);
  if(verifiedMacro&&(issuerScoped||focus!=="macro"||req.intakeId))throw Error("macro_history_scope_contract_hold");
  // RQ-2: a country or agency is not a company. Under macro focus an issuer with no
  // indexed Company Hub would otherwise create phantom Company/Thesis obligations.
  if(focus==="macro"&&req.issuers?.length&&issuerResolution.some(r=>r.status==="unresolved"))
    throw Error("macro_issuer_scope_hold: issuers must be indexed Company Hubs; pass a country or topic as industry or macroScope");
  const maxNotes = Math.min(16,Math.max(5,req.maxNotes??11));
  const budget = Math.min(18000,Math.max(4500,req.maxChars??12000));
  const pool = new Map<string,number>();
  const limits=new Set<string>();
  const subjectScopes=contextKeys.map(key=>{
    const resolved=issuerResolution.filter(r=>r.contextKey===key);
    const aliases=resolved[0]?.hubPath?[...new Set(indexedHubAliases(JSON.stringify(indexedMetadata(resolved[0].hubPath)))
      .map(alias=>alias.trim().normalize("NFC")))].sort():[];
    return {key,resolved,aliases};
  });
  // Reuse the same collision/readback checks for filename aliases. A Hub's
  // declaration alone cannot authorize an alias also claimed by another Hub.
  const aliasResolution=resolveIssuers([...new Set(subjectScopes.flatMap(scope=>scope.aliases.slice(0,12)))],observer,hubs);
  const researchScans=subjectScopes.map(({key,resolved,aliases})=>{
    const checked=aliasResolution.filter(r=>aliases.slice(0,12).includes(r.requested));
    const subjects=resolved.length?[...resolved.flatMap(scopeKeys),...checked.filter(r=>r.contextKey===key).map(r=>r.requested)]:undefined;
    const scan=discoverCanonicalResearch(key,req.intakeId,subjects,observer,judgePolicy,historyCutoff);
    if(aliases.length>12){scan.complete=false;scan.reasons.push("legacy_subject_alias_limit");}
    if(checked.some(r=>r.contextKey!==key)){scan.complete=false;scan.reasons.push("legacy_subject_alias_unresolved");}
    if(!scan.complete){scan.chronology="SCAN_INCOMPLETE";scan.latestReviewPaths=[];}
    return scan;
  });
  const canonicalReviews=new Map(researchScans.flatMap(scan=>scan.reviews.map(review=>[review.path,review] as const)));
  const deferredReviews=new Map(researchScans.flatMap(scan=>scan.deferredReviews.map(review=>[review.path,review] as const)));
  for(const path of deferredReviews.keys())observer.observePath(path,"canonical_read_limit");
  const boundSources=new Map(researchScans.flatMap(scan=>scan.reviews.flatMap(review=>review.bundle.status==="BOUND_SOURCE_REVIEW"&&review.bundle.sourcePath
    ?[[review.bundle.sourcePath,scan.contextKey] as const]:[])));
  for(const scan of researchScans){
    for(const reason of scan.reasons)limits.add(`${scan.contextKey}: ${reason}`);
    for(const [i,review] of scan.reviews.entries()){
      // Discover canonical Reviews before broad lexical windows can hide them.
      // Ranking is publication-based context priority, never event equivalence.
      pool.set(review.path,195-i*3);
      if(review.bundle.status==="HOLD"){
        observer.observePath(review.path,review.legacy?"legacy_review_scope_unverified":"receipt_binding_unverified");
        observer.observePath(review.path,"restricted_low_trust");
      }
      if(review.bundle.status==="BOUND_SOURCE_REVIEW"&&review.bundle.sourcePath)pool.set(review.bundle.sourcePath,194-i*3);
    }
  }
  const standalone=discoverStandaloneSources([...(verifiedMacro?[{contextKey:verifiedMacro.key,labels:[verifiedMacro.label],macroScope:verifiedMacro}]:[]),...subjectScopes.filter(s=>s.resolved.some(r=>["exact_existing_title","indexed_alias"].includes(r.status))).map(s=>({contextKey:s.key,
    labels:[s.key,...s.resolved.map(r=>r.requested),...aliasResolution.filter(r=>r.contextKey===s.key).map(r=>r.requested)]}))],[...new Set(researchScans.flatMap(scan=>scan.reviews.map(r=>`00_Inbox/ChatGPT/Investment Intake - ${r.intakeId}.md`)))],observer,judgePolicy,req.intakeId);
  for(const scan of standalone.scans)for(const reason of scan.reasons)limits.add(`${scan.contextKey}: ${reason}`);
  for(const path of standalone.bindings.keys())pool.set(path,120);
  const search=(query:string,opts:Parameters<typeof searchVault>[1])=>{
    const result=observer.search("search",query,opts?.folder,()=>searchVault(query,opts,judgePolicy));
    if(result.total>result.hits.length)limits.add("Search window truncated: "+query);
    return result;
  };
  const macroScope = !issuerScoped && focus==="macro";
  // RQ-2: with neither industry nor macroScope, the leading question words are a
  // macro scope only if an indexed note declares that subject. A generic first
  // word ("Bureau") must not become a title filter that admits another country's
  // agency and drops the requested one; without a declared subject, HOLD instead.
  const implicitMacro=macroScope&&!verifiedMacro&&req.industry===undefined;
  const inferredMacro=implicitMacro?questionMacroSubjects(question,exclusion,excluded):null;
  if(inferredMacro?.limited)limits.add("Macro subject index truncated; question text was not used as a macro scope.");
  if(implicitMacro&&!inferredMacro?.scopes.length)limits.add("Macro subject not established from the question text: no declared subject, Theme Hub or Macro note title names it, so no macro evidence was admitted. Supply industry (country/topic) or macroScope for scoped macro retrieval.");
  if(inferredMacro?.basis==="title")limits.add(`Macro scope ${inferredMacro.scopes.join(" / ")} taken from Macro note titles only (no declared country metadata); verify the subject before analysis.`);
  // Country/topic-only questions do not inherit company-thesis obligations.
  // Prefer the explicitly supplied scope over incidental query terms.
  // Explicit separators split scopes; preserve multiword names and do not
  // guess country aliases or split "and" inside a country's proper name.
  // DELTA-01 C1: closed identity aliases resolve to one canonical scope key
  // (never for a source-bound macroScope, whose key stays exact).
  const requestedMacroScopes=verifiedMacro?[verifiedMacro.key]:!macroScope?[]:implicitMacro?[...new Set((inferredMacro?.scopes??[]).map(s=>canonicalMacroScope(s)??s))]:
    [...new Set((req.industry??"").split(/[/;|,]/).map(x=>canonicalMacroScope(x)??topicTerms(x).join(" ")).filter(Boolean))];
  const macroScopes=requestedMacroScopes.slice(0,4);
  const generatedSource=(p:string)=>p.startsWith("00_Inbox/ChatGPT/Investment Intake - ");
  const matchesMacroScope=(p:string,scope:string,current?:Record<string,unknown>)=>{
    if(verifiedMacro&&generatedSource(p)){
      const b=standalone.bindings.get(p);
      return b?.macroScope?.key===scope&&(!current||JSON.stringify(current.macro_subject)===JSON.stringify(b.macroScope));
    }
    return explicitMacroScope(p,scope,current,!verifiedMacro);
  };
  if(requestedMacroScopes.length>4)limits.add("Macro scope limit: only the first four explicit scopes searched; remaining scopes were not assessed.");
  const needed = [
    "10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md",
    ...(issuers.length?["08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md"]:[]),
    ...contextKeys.flatMap(t=>[
      "01_Companies/"+t+".md",
      "08_Daily_Weekly/Research Indexes/Company Evolution - "+t+".md",
      "05_Thesis/"+t+" - Current Thesis.md",
      "05_Thesis/"+t+" - Evidence Register.md",
    ]),
  ];
  const absent: string[] = [];
  const available=(p:string)=>!excluded.includes(p)&&(exists(p)||!!db().prepare("SELECT 1 FROM notes WHERE path=?").get(p));
  for (const p of needed) { if (available(p)) pool.set(p,120); else absent.push(p); }
  // Historical Company indexes exist in two legacy locations. Neither is a
  // current/approved Thesis, but both provide routes back to dated prior
  // conversations. A missing newer index must not hide the older one or be
  // reported as missing when the other location is present.
  for (const ticker of contextKeys) {
    const candidates=[
      "08_Daily_Weekly/Research Indexes/Company - "+ticker+".md",
      "10_Knowledge/Indexes/Company - "+ticker+".md"
    ];
    const present=candidates.filter(available);
    if(present.length) for(const p of present)pool.set(p,120);
    else absent.push("No legacy Company Index found for "+ticker+" (both known locations checked).");
  }
  const linkedIndustryPaths=new Set<string>();
  // Retrieve existing, explicitly resolved Industry Hubs linked from the
  // issuer's canonical Timeline. A generic earnings query may contain no
  // industry search term, but the company already has a curator-reviewed
  // cross-link. Trust only the indexed exact resolved_path (not co-mentions).
  // If the caller explicitly provided industry scope, respect that choice.
  if(issuers.length && !req.industry){
    for(const ticker of contextKeys){
      const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - "+ticker+".md";
      if(!available(timeline))continue;
      const rows=db().prepare(
        "SELECT DISTINCT resolved_path FROM links WHERE source_path=? AND resolved_path LIKE ? ORDER BY resolved_path LIMIT 12"
      ).all(timeline,"02_Industries_Themes/%.md") as {resolved_path:string|null}[];
      for(const row of rows){
        const target=row.resolved_path;
        if(target && target.startsWith("02_Industries_Themes/") &&
           roleOf(target)==="industry" && available(target)){
          pool.set(target,Math.max(pool.get(target)||0,116));
          linkedIndustryPaths.add(target);
        }
      }
    }
  }
  // Explicit issuer-source discovery: a broad "NVDA" lexical query can be
  // flooded by archived chat and miss the actual issuer IR reviews. Never
  // let search-result popularity determine whether primary documents exist.
  for (const ticker of contextKeys) {
    const prefix = "08_Daily_Weekly/Research Indexes/Primary Evidence - "+ticker+" ";
    const matches = db().prepare(`SELECT path FROM notes WHERE substr(path,1,?)=?${exclusion} ORDER BY path DESC LIMIT 13`)
      .all(prefix.length,prefix,...excluded) as {path:string}[];
    if(matches.length>12)limits.add("Primary-source filename window truncated: "+ticker);
    for (const note of matches.slice(0,12)) if(available(note.path)) pool.set(note.path,115);
  }
  const searchTerms = issuerScoped&&!issuers.length?[]:[...new Set([...issuers,...topicTerms(req.industry||""),...terms(question)])].slice(0,12);
  const failed: string[] = [];
  const macroSubjectPaths = new Set<string>();
  let macroSubjectRequested=false;
  const macroSubjectByScope=new Map(macroScopes.map(scope=>[scope,new Set<string>()]));
  // DELTA-01 C1b: Macro notes that a scoped subject query returned, but whose
  // title/metadata attribute no country. Pointer candidates only, never items.
  const unattributedMacro=new Map<string,string>();
  if(macroScope){
    const scopeWords=new Set(macroScopes.flatMap(x=>[...x.split(" "),...(MACRO_SCOPE_ALIASES[x]??[]).map(upperNfc)]));
    const subject=topicTerms(question).filter(x=>!scopeWords.has(x)&&x.length>=3)
      .filter(x=>!/^\d+$|^(?:THIRD|QUARTER|COMPARISON|COMPARE)$/.test(x)).slice(0,5);
    macroSubjectRequested=subject.length>0;
    for(const scope of macroScopes){
      const folder="10_Knowledge/Macro and Markets";
      // Closed identity aliases only (never for a source-bound macroScope).
      const aliases=verifiedMacro?[]:MACRO_SCOPE_ALIASES[scope]??[];
      // Country-only discovery keeps differing risk vocabulary eligible.
      // Subject hits rank higher but never become a blanket admission filter.
      if(folderExists(folder))try{
        for(const h of search(scope,{limit:100,folder}).hits)if(matchesMacroScope(h.path,scope))pool.set(h.path,22);
      }catch{failed.push(scope);}
      // FTS tokenizes "U.S." and Thai forms differently; only plain Latin forms are queried.
      for(const word of subject)for(const form of [scope,...aliases.filter(f=>/^[A-Z]{2,3}$/.test(f))])try{
        const hits=[...search(form+" "+word,{limit:100}).hits,
          ...(folderExists(folder)?search(form+" "+word,{limit:100,folder}).hits:[])];
        for(const h of hits)if(matchesMacroScope(h.path,scope)){
          macroSubjectPaths.add(h.path);macroSubjectByScope.get(scope)!.add(h.path);
          if(h.path.startsWith(folder+"/"))pool.set(h.path,60);
        }else if(aliases.length&&h.path.startsWith(folder+"/")&&!unattributedMacro.has(h.path)){
          // Pointers only for scopes with a reviewed identity set (closed aliases).
          unattributedMacro.set(h.path,scope);
        }
      }catch{failed.push(form+" "+word);}
      const candidatePaths=db().prepare(`SELECT path FROM notes WHERE instr(upper(path),?)>0${exclusion} ORDER BY path DESC LIMIT 151`)
        .all(scope,...excluded) as {path:string}[];
      if(candidatePaths.length>150)limits.add("Macro filename window truncated: "+scope);
      const windows=candidatePaths.slice(0,150);
      // Alias forms: case-sensitive (instr), restricted to the same two folders.
      for(const form of aliases){
        const rows=db().prepare(`SELECT path FROM notes WHERE (substr(path,1,?)=? OR substr(path,1,21)='02_Industries_Themes/') AND instr(path,?)>0${exclusion} ORDER BY path DESC LIMIT 151`)
          .all(folder.length+1,folder+"/",form,...excluded) as {path:string}[];
        if(rows.length>150)limits.add("Macro filename window truncated: "+form);
        windows.push(...rows.slice(0,150));
      }
      for(const r of windows)if((r.path.startsWith(folder+"/")||r.path.startsWith("02_Industries_Themes/"))&&
        matchesMacroScope(r.path,scope)&&available(r.path))pool.set(r.path,Math.max(pool.get(r.path)||0,macroSubjectPaths.has(r.path)?60:22));
    }
  }
  const industryMatches = new Set<string>();
  if(issuers.length && req.industry){
    for(const topic of topicTerms(req.industry).slice(0,5)){
      try{for(const hit of search(topic,{limit:100}).hits)industryMatches.add(hit.path);}
      catch{failed.push(topic);}
    }
  }
  // A generic term such as "earnings" must not quietly pull another issuer's
  // news into a company-specific pack. First discover exact issuer matches.
  const issuerPaths = new Set<string>();
  const historicalIssuerPaths=new Set<string>();
  const historicalSubjects=new Map<string,string[]>();
  const titleSubjectPaths=new Set<string>();
  const jointSubjects=new Map<string,string[]>();
  const relatedHistory=new Map<string,string[]>();
  // Alias equivalence is limited to existing caller-resolved, readback-checked
  // contexts. Unresolved literal ticker discovery remains explicitly unverified.
  const labelContexts=new Map<string,string>();
  for(const r of [...issuerResolution,...aliasResolution])for(const label of scopeKeys(r))
    labelContexts.set(hubIdentityKey(label),r.contextKey??label);
  const knownHubLabels=new Set(hubs.flatMap(h=>[h.title,...indexedHubAliases(h.frontmatter)]).map(hubIdentityKey));
  const identity=(label:string)=>labelContexts.get(hubIdentityKey(label))??hubIdentityKey(label);
  const historicalScope=(path:string,names:string[])=>{
    const fm=indexedMetadata(path),raw=Array.isArray(fm.company)?fm.company:typeof fm.company==="string"?[fm.company]:names;
    const labels=raw.filter((x):x is string=>typeof x==="string");
    const ids=[...new Set(labels.map(identity))];
    const contexts=(labels:string[])=>[...new Set(labels.flatMap(x=>labelContexts.has(hubIdentityKey(x))?[labelContexts.get(hubIdentityKey(x))!]:[]))];
    const declaredScopes=contexts(labels);
    const title=primaryTitleIssuer(path,knownHubLabels),titleId=title?identity(title):null;
    const joint=jointTitleIssuers(path,knownHubLabels),titleLabels=joint.length?joint:title?[title]:[];
    const titleIds=titleLabels.map(identity);
    const knownDeclared=labels.filter(label=>knownHubLabels.has(hubIdentityKey(label))||labelContexts.has(hubIdentityKey(label)));
    // Unknown names are not proven aliases OR proven conflicts. Preserve an
    // explicit title's low-trust history, without adding a name-to-Hub mapping.
    const conflict=titleIds.length>0&&knownDeclared.length>0&&!titleIds.some(id=>ids.includes(id));
    const jointSupported=joint.length>0&&titleIds.every(id=>ids.includes(id));
    const kind=jointSupported?"joint":!joint.length&&titleId?"primary":null;
    const scopes=kind?contexts(titleLabels):titleLabels.length?[]:ids.length<=1?declaredScopes:[];
    return {scopes,kind,joint,conflict,jointUnconfirmed:joint.length>0&&!jointSupported,
      unresolved:knownDeclared.length<labels.length,
      related:!conflict&&!scopes.length&&declaredScopes.length>0&&(ids.length>1||titleLabels.length>0),declaredScopes};
  };
  const resolvedContexts=new Set(issuerResolution.filter(r=>r.contextKey&&["exact_existing_title","indexed_alias"].includes(r.status)).map(r=>r.contextKey));
  // DELTA-01 C3: literal FTS hits for a requested label that has NO Company Hub.
  // Only used to expose other issuers' notes as metadata-only pointers.
  const unresolvedLabels=new Set(issuerResolution.filter(r=>r.status==="unresolved").flatMap(scopeKeys).map(x=>x.toUpperCase()));
  const literalHits=new Map<string,Set<string>>();
  const relatedContext=new Map<string,string>();
  for (const ticker of issuers) {
    try {
      for (const h of search(ticker,{limit:100}).hits){
        issuerPaths.add(h.path);
        if(unresolvedLabels.has(ticker)){if(!literalHits.has(ticker))literalHits.set(ticker,new Set());literalHits.get(ticker)!.add(h.path);}
      }
    } catch { failed.push(ticker); }
  }
  for (const term of searchTerms) {
    try {
      const page=search(term,{limit:30});observer.questionWindow(term,page.total,page.hits.length);
      for (const [i,h] of page.hits.entries()) {
        // FTS cannot bypass failed canonical readback, the scoped read bound,
        // or an explicitly requested intake. Source pairing is receipt-bound.
        if(issuerScoped&&isCanonicalResearchPath(h.path)&&!canonicalReviews.has(h.path)){observer.observePath(h.path,deferredReviews.has(h.path)?"canonical_read_limit":"canonical_not_admitted");continue;}
        if((issuerScoped||verifiedMacro)&&h.path.startsWith("00_Inbox/ChatGPT/Investment Intake - ")&&!boundSources.has(h.path)&&!standalone.bindings.has(h.path)){observer.observePath(h.path,"receipt_binding_unverified");continue;}
        const role=roleOf(h.path);
        const scopedIssuerNames=namedIssuers(h.path);
        const hs=issuers.length&&h.path.startsWith("10_Knowledge/Company Research/")&&!canonicalReviews.has(h.path)?historicalScope(h.path,scopedIssuerNames):null;
        if(hs?.conflict){observer.observePath(h.path,"issuer_identity_conflict");continue;}
        if(hs?.unresolved)observer.observePath(h.path,"declared_company_identity_unresolved");
        if(hs?.jointUnconfirmed)observer.observePath(h.path,"joint_subject_unconfirmed");
        if(hs?.related){relatedHistory.set(h.path,hs.declaredScopes);observer.observePath(h.path,"declared_multi_issuer_relation");observer.observePath(h.path,"restricted_low_trust");continue;}
        if(hs?.scopes.length)historicalSubjects.set(h.path,hs.scopes);
        if(hs?.kind&&hs.scopes.length){
          titleSubjectPaths.add(h.path);observer.observePath(h.path,hs.kind==="joint"?"historical_joint_subject":"historical_primary_subject");
          if(hs.kind==="joint")jointSubjects.set(h.path,hs.joint);
        }
        if(issuers.length && scopedIssuerNames.length &&
          !scopedIssuerNames.some(t=>issuers.includes(t))&&!historicalSubjects.has(h.path)){
          observer.observePath(h.path,"issuer_scope_excluded");
          // C3: another issuer's note that literally mentions an unresolved label.
          // Pointer only: no issuer identity, relationship, coverage or primary status.
          // No pointers under PIT (titles could leak post-cutoff notes) and none
          // into intake/Thesis/Portfolio paths.
          const mention=[...literalHits].find(([,paths])=>paths.has(h.path))?.[0];
          if(mention&&!historyCutoff&&relatedContext.size<4&&!relatedContext.has(h.path)&&!/^(?:00_Inbox|05_Thesis|06_Portfolio)\//.test(h.path)){
            relatedContext.set(h.path,mention);observer.observePath(h.path,"other_issuer_literal_mention");
          }
          continue;
        }
        if(issuers.length && role==="research" && !pool.has(h.path)){
          if(!h.path.startsWith("10_Knowledge/Company Research/")){observer.observePath(h.path,"explicit_scope_exclusion");continue;}
          if(req.industry && !industryMatches.has(h.path)){
            // Industry FTS is enrichment, not proof of absence of issuer history.
            // Retain only a resolved issuer's declared historical candidate;
            // do not bypass canonical receipt/read bounds or industry Hub rules.
            if(!hs?.kind||!hs.scopes.some(scope=>resolvedContexts.has(scope))){observer.observePath(h.path,"industry_scope_excluded");continue;}
            historicalIssuerPaths.add(h.path);observer.observePath(h.path,"restricted_low_trust");
          }
        }
        if(issuers.length && role==="industry" && req.industry &&
          !industryMatches.has(h.path)){observer.observePath(h.path,"industry_scope_excluded");continue;}
        // For generic company queries, a canonical Industry Hub merely
        // mentioning the issuer is NOT a business linkage. Require either
        // a resolved link from its own Company Timeline or clear title-topic
        // alignment with the user's stated query. This constraint applies
        // to curated 02_Industries hubs; 03_Concepts retain their prior scope.
        if(issuers.length && role==="industry" && !req.industry &&
           h.path.startsWith("02_Industries_Themes/") &&
           !linkedIndustryPaths.has(h.path)){
          const title=(h.path.split("/").at(-1)||"").replace(/\.md$/i,"").toUpperCase();
          const titleWords=new Set(title.split(/[^\p{L}\p{N}]+/u));
          const explicitWords=question.toUpperCase().split(/[^\p{L}\p{N}]+/u)
            .filter(w=>w.length>=4&&!issuers.includes(w));
          if(!explicitWords.some(w=>titleWords.has(w))){observer.observePath(h.path,"industry_scope_excluded");continue;}
        }
        if(issuers.length && !issuerPaths.has(h.path) &&
          role!=="industry" && role!=="rules" && !pool.has(h.path)){observer.observePath(h.path,"issuer_lexical_window_not_returned");continue;}
        if(macroScope){
          // One shared word (e.g. "revenue") must not pull an unrelated issuer.
          if(!macroScopes.some(scope=>matchesMacroScope(h.path,scope)))continue;
          if(role==="company"||role==="thesis"||role==="evidence_register"||
            (role==="timeline" && scopedIssuerNames.length>0)||
            h.path.startsWith("10_Knowledge/Company Research/"))continue;
        }
        pool.set(h.path,Math.max(pool.get(h.path)||0, 30-i));
        if (pool.size>200) break;
      }
    } catch { failed.push(term); }
  }
  // DELTA-01 C1b: bounded, labelled pointers only (never items, admission,
  // coverage or evidence weight). A note declaring ANY geography, or whose title
  // names another declared geography label, stays excluded (wrong-country
  // protection). No pointers under PIT: titles could leak post-cutoff notes.
  const macroPointers=new Map<string,string>();
  if(macroScope&&!historyCutoff&&unattributedMacro.size){
    const rows=db().prepare(`SELECT frontmatter FROM notes WHERE json_valid(frontmatter)=1 AND (json_type(frontmatter,'$.country') IS NOT NULL OR
      json_type(frontmatter,'$.geography') IS NOT NULL OR json_type(frontmatter,'$.region') IS NOT NULL)${exclusion} LIMIT 5001`).all(...excluded) as {frontmatter:string}[];
    if(rows.length>5000)limits.add("Macro geography label index truncated; country-unattributed pointers withheld.");
    else{
      const known=new Set<string>();
      for(const row of rows){try{for(const v of declaredValues(JSON.parse(row.frontmatter) as Record<string,unknown>,GEOGRAPHY_FIELDS))
        if(typeof v==="string"&&v.trim()&&v.length<=120)known.add(upperNfc(v));}catch{/* invalid metadata names nothing */}}
      for(const forms of Object.entries(MACRO_SCOPE_ALIASES))for(const f of [forms[0],...forms[1]])known.add(upperNfc(f));
      for(const [p,scope] of unattributedMacro){
        if(macroPointers.size>=4)break;
        if(pool.has(p)||generatedSource(p)||declaredValues(indexedMetadata(p),GEOGRAPHY_FIELDS).length)continue;
        const own=new Set([scope,...(MACRO_SCOPE_ALIASES[scope]??[])].map(upperNfc));
        const title=(p.split("/").at(-1)||"").normalize("NFC").toUpperCase();
        if([...known].some(l=>!own.has(l)&&(/\p{Script=Thai}/u.test(l)?title.includes(l):boundaryAt(title,l))))continue;
        macroPointers.set(p,scope);observer.observePath(p,"macro_country_unattributed");
      }
    }
  }
  const macroRiskPaths=new Set<string>();
  const macroReadReasons=new Map(macroScopes.map(scope=>[scope,[] as string[]]));
  const macroCandidates=new Map(macroScopes.map(scope=>[scope,[...pool.keys()].filter(p=>roleOf(p)!=="rules"&&matchesMacroScope(p,scope))]));
  for(const [scope,paths] of macroCandidates){
    // A bounded section scan, not an inference about semantic risk. Admit all
    // country candidates to ranking, including unread/unmarked background.
    const reasons=macroReadReasons.get(scope)!;
    if(paths.length>24)reasons.push("counter_read_limit");
    for(const p of [...paths].sort().slice(0,24))try{
      observer.read("macro_counter",p,()=>{
        const raw=readNote(p).content;
        if(Buffer.byteLength(raw)>100000)throw Error("read_limit");
        const parsed=splitFrontmatter(raw);
        const sourceBinding=standalone.bindings.get(p);
        if(sourceBinding&&createHash("sha256").update(raw).digest("hex")!==sourceBinding.sourceSha256)throw Error("standalone_source_selection_changed");
        if(!matchesMacroScope(p,scope,parsed.data))throw Error("scope_readback");
        const lines=parsed.body.split(/\r?\n/);
        if(lines.length>1200)reasons.push("counter_line_limit");
        if(lines.slice(0,1200).some(line=>COUNTER_SECTION.test(line)))macroRiskPaths.add(p);
      });
    }catch{reasons.push("counter_readback_unavailable");}
  }
  // Promote same-event research whose headline contains the user's specific
  // subject (e.g. CrowdStrike + CLEAR), not older ticker-only summaries.
  // The ranking is a discovery hint, never a deduplication or source verdict.
  const subjectTerms=topicTerms(question).filter(t=>t.length>=4 && !/^[0-9]/.test(t) &&
    !issuers.includes(t) && !/^(?:HISTORICAL|ARCHIVE|RE-INGEST|UPDATE|LATEST|NEW|EVENT|TEST|VERIFY|SOURCE|CLAIM|NEWS|RESEARCH)$/.test(t));
  for(const path of pool.keys())observer.observePath(path);
  const rank = [...pool].map(([path,boost])=>{
    const role=roleOf(path);
    const historical=historicalOnly(path,indexedMetadata(path));
    const companyBonus=issuerTokenInTitle(path,issuers)?22:0;
    const title=(path.split("/").at(-1)??"").normalize("NFC").toUpperCase();
    const eventTitleMatches=subjectTerms.filter(term=>title.split(/[^\p{L}\p{N}]+/u).includes(term)).length;
    const specificEventBonus=issuers.length && role==="research"
      ? Math.min(3,eventTitleMatches)*35:0;
    const macroBonus=macroScope && macroScopes.length ?
      (macroScopes.some(scope=>matchesMacroScope(path,scope))?25:0) +
      (path.startsWith("10_Knowledge/Macro and Markets/")?25:0) +
      (macroSubjectPaths.has(path)?32:0) +
      (macroRiskPaths.has(path)?85:0):0;
    const focusBonus=focus==="tam"&&/TAM|Industries|Concepts/.test(path)?20:
      focus==="broker"&&/Broker|Evolution|Research/.test(path)?17:
      focus==="earnings"&&/Primary Evidence|Event_Lineage/.test(path)?20:0;
    // Company-event reconciliation also consumes these scores. Preserve its
    // historical research discovery; de-rank AI recaps only in macro scope.
    const publication=inspectCanonicalKnowledgeMetadata(path,indexedMetadata(path)).publishedAt;
    return {path,role,historical,publication,score:base[role]+boost+companyBonus+focusBonus+macroBonus+specificEventBonus-(role==="archive"?45:macroScope&&historical?70:0)};
  }).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  // Build stable relevance cohorts from each highest remaining score. Unlike
  // fixed buckets, a one-point difference at a bucket edge does not defeat
  // chronology. Dates rank like roles within ten points of that anchor only.
  // Unknown dates never borrow import/analysis/file time or imply event order.
  for(let start=0;start<rank.length;){
    let end=start+1;
    while(end<rank.length&&rank[start].score-rank[end].score<=10)end++;
    const group=rank.slice(start,end).sort((a,b)=>base[b.role]-base[a.role]||
      (publicationWindow(b.publication)?.[0]??-Infinity)-(publicationWindow(a.publication)?.[0]??-Infinity)||
      b.score-a.score||a.path.localeCompare(b.path));
    rank.splice(start,group.length,...group);start=end;
  }
  // Reserve bounded subject/counter slots per explicitly requested scope.
  // Paths stay separate, with per-scope attribution; no country/event merge.
  const reserve=[...macroScopes.map(scope=>(rank.find(r=>macroCandidates.get(scope)?.includes(r.path)&&macroSubjectPaths.has(r.path))??
      rank.find(r=>macroCandidates.get(scope)?.includes(r.path)))?.path),
    ...macroScopes.map(scope=>rank.find(r=>macroCandidates.get(scope)?.includes(r.path)&&macroRiskPaths.has(r.path)&&!macroSubjectPaths.has(r.path))?.path)];
  const priority=[...new Set(reserve.filter((p):p is string=>!!p))];
  if(macroScope)rank.sort((a,b)=>(priority.includes(a.path)?priority.indexOf(a.path):priority.length)-(priority.includes(b.path)?priority.indexOf(b.path):priority.length));
  // Keep one issuer-grounded historical analysis in the bounded role mix.
  // Heading relevance/chronology still rank within the role; no issuer, intake,
  // target path or financial conclusion is special-cased. No extra reads.
  if(issuerScoped&&(focus==="earnings"||focus==="general")){
    const historical=rank.find(r=>r.path.startsWith("10_Knowledge/Company Research/")&&
      (canonicalReviews.has(r.path)||historicalSubjects.has(r.path)));
    if(historical){rank.splice(rank.indexOf(historical),1);rank.unshift(historical);observer.observePath(historical.path,"historical_context_slot");}
  }
  const items: Item[] = [];
  const counterExcerptMissing=new Set<string>();
  const pitAccepted=new Map<string,ReturnType<typeof receiptVersionAt>&{cutoff:string}>();
  const pitHolds=new Map<string,PitReason>();
  let pitReads=0;
  const pitHold=(path:string,reason:PitReason)=>{pitHolds.set(path,reason);observer.observePath(path,reason);};
  for(const scan of researchScans)for(const excluded of scan.pitExcluded??[])pitHold(excluded.path,excluded.reason);
  // Archived chat excerpts are a last resort and may repeat one issuer event.
  // Prefer current Thesis, original-source review and company evolution unless
  // the question explicitly asks to inspect archival history.
  const archivalRequested=/archiv|chatgpt|historical|ประวัติแชต|ย้อนหลัง|แชตเก่า/i.test(question);
  const substantialNonArchives=rank.filter(r=>!r.historical&&!["rules","timeline"].includes(r.role)).length;
  const allowArchived=archivalRequested||substantialNonArchives<2;
  const roleCounts=new Map<Role,number>();
  let remaining=budget;
  const omitted: string[]=[];
  let historicalCount=0;
  // DELTA-01 C2: macro historical analysis that is scope-matched AND subject- or
  // counter-section-matched is relevant context (<=3); other archives/recaps stay
  // background (<=1). Same note/excerpt budgets; evidenceUse stays
  // historical_context_only and declared trust is untouched. An explicit archival
  // request keeps its existing, uncapped behaviour.
  let relevantHistoricalCount=0;
  const relevantCapped:string[]=[],familyDuplicates:string[]=[];
  const selectedFamilies=new Set<string>();
  const historicalRelevant=(path:string)=>(macroSubjectPaths.has(path)||macroRiskPaths.has(path))&&
    macroScopes.some(scope=>macroCandidates.get(scope)?.includes(path));
  const macroBackgroundCounts=new Map<string,number>();
  const optionalFailures=new Map<string,OptionalHistoryFailure>();
  for (const row of rank) {
    // Company history and protected drafts must remain discoverable even when
    // derived from AI. Only raw archives / macro recaps share this fallback cap.
    const archivalSelection=row.role==="archive"||macroScope&&row.historical&&row.role==="research";
    // Only where archives are already admissible (scarce non-archive evidence);
    // history never displaces substantial non-archive evidence.
    const relevantHistory=macroScope&&allowArchived&&!archivalRequested&&archivalSelection&&row.role==="research"&&historicalRelevant(row.path);
    if(relevantHistory){
      if(relevantHistoricalCount>=3){observer.observePath(row.path,"historical_context_cap");relevantCapped.push(row.path);omitted.push(row.path);continue;}
    }else if (archivalSelection && (!allowArchived || !archivalRequested&&historicalCount>=1)) {observer.observePath(row.path,"explicit_scope_exclusion");omitted.push(row.path);continue;}
    // Same-origin history: one selected item per declared source family.
    const family=macroScope&&archivalSelection&&!generatedSource(row.path)?sourceFamilyKey(row.path):null;
    if(family&&selectedFamilies.has(family)){observer.observePath(row.path,"source_family_duplicate");familyDuplicates.push(row.path);omitted.push(row.path);continue;}
    if (items.length>=maxNotes||remaining<250) {observer.observePath(row.path,items.length>=maxNotes?"note_budget":"excerpt_budget");omitted.push(row.path);continue;}
    const matchedMacroScopes=macroScopes.filter(scope=>matchesMacroScope(row.path,scope));
    const background=macroScope&&macroSubjectRequested&&row.role!=="rules"&&!macroSubjectPaths.has(row.path)&&!macroRiskPaths.has(row.path);
    if(background&&matchedMacroScopes.every(scope=>(macroBackgroundCounts.get(scope)||0)>=1)){observer.observePath(row.path,"explicit_scope_exclusion");omitted.push(row.path);continue;}
    const n=roleCounts.get(row.role)||0;
    if(n>=(quota[row.role]??4)){observer.observePath(row.path,"role_quota");omitted.push(row.path);continue;}
    // Optional, unreceipted historical enrichment must pass scope readback
    // BEFORE selected-evidence admission. A rejected candidate is visible in
    // discovery/coverage, not misreported as a required operational failure.
    // Canonical/receipt-bound paths and all existing required reads stay strict.
    if(historyCutoff){
      if(!isReceiptedReviewPath(row.path)&&!/^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/.test(row.path)){
        pitHold(row.path,"pit_receipt_unverified");continue;
      }
      if(pitReads>=16){pitHold(row.path,"pit_read_limit");continue;}
      pitReads++;
    }
    let optionalRaw:string|undefined;
    if((historicalIssuerPaths.has(row.path)||jointSubjects.has(row.path))&&!canonicalReviews.has(row.path)&&!standalone.bindings.has(row.path)){
      let rejection:OptionalHistoryFailure|undefined;
      try{
        // existsSync in the generic reader may hide EACCES as "not found".
        // This metadata-only stat retains the native error without another read.
        fs.statSync(resolveNotePath(row.path));
        optionalRaw=readNote(row.path).content;
        if(JSON.stringify(splitFrontmatter(optionalRaw).data)!==JSON.stringify(indexedMetadata(row.path)))rejection="optional_history_metadata_drift";
      }catch(e){rejection=optionalHistoryReadError(e);}
      if(rejection){optionalFailures.set(row.path,rejection);observer.observePath(row.path,"readback_failed");observer.observePath(row.path,rejection);continue;}
    }
    try {
      observer.read("selection",row.path,()=>{
        const raw=optionalRaw??readNote(row.path).content;
        const current=splitFrontmatter(raw).data;
        if(historyCutoff){
          // No physical reread. Current indexed metadata/body and the exact
          // server-receipted version must agree before eligibility is asserted.
          const indexed=db().prepare("SELECT f.body FROM notes n JOIN notes_fts f ON f.rowid=n.rowid AND f.path=n.path WHERE n.path=?").get(row.path) as {body:string}|undefined;
          if(JSON.stringify(current)!==JSON.stringify(indexedMetadata(row.path))||indexed?.body!==splitFrontmatter(raw).body)throw Error("pit_index_readback_mismatch");
          let version:ReturnType<typeof receiptVersionAt>;
          try{version=receiptVersionAt(row.path,raw);}catch(e){
            if(!(e instanceof Error)||!["pit_receipt_unverified","create_receipt_unverified","receipt_store_missing"].includes(e.message))throw e;
            pitHold(row.path,"pit_receipt_unverified");return;
          }
          if(Date.parse(version.knownAt)>Date.parse(historyCutoff)){pitHold(row.path,"pit_after_cutoff");return;}
          const publication=publicationWindow(inspectCanonicalKnowledgeMetadata(row.path,current).publishedAt);
          if(publication&&publication[0]>Date.parse(historyCutoff)){pitHold(row.path,"pit_publication_after_cutoff");return;}
          pitAccepted.set(row.path,{...version,cutoff:historyCutoff});
        }
        const joint=jointSubjects.get(row.path);
        if(joint){
          const body=splitFrontmatter(raw).body;
          // Reuse the existing selected read: each declared joint subject must
          // occur literally in the physical body. Optional bytes/metadata were
          // validated together above, with or without industry enrichment.
          // Required paths retain strict readback. This is not semantic proof.
          if(optionalRaw===undefined&&JSON.stringify(current)!==JSON.stringify(indexedMetadata(row.path)))throw Error("joint_scope_readback");
          if(!joint.every(label=>new RegExp(`(^|[^\\p{L}\\p{N}])${label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?=$|[^\\p{L}\\p{N}])`,"iu").test(body))){
            observer.observePath(row.path,"joint_subject_unconfirmed");return;
          }
        }
        if(macroScope&&row.role!=="rules"&&!matchedMacroScopes.some(scope=>matchesMacroScope(row.path,scope,current)))throw Error("macro_scope_readback");
        const sourceBinding=standalone.bindings.get(row.path);
        if(sourceBinding&&createHash("sha256").update(raw).digest("hex")!==sourceBinding.sourceSha256)throw Error("standalone_source_selection_changed");
        const original=sourceBinding?preservedSubmittedText(raw):null;
        // Allocation depends only on the requested budget, never the number of
        // unselected discoveries (which must not spuriously change a witness).
        let sourceOffset=0,lineOffset=0;
        if(original!==null){
          const section=preservedTextSection(raw);
          if(!section)throw Error("source_excerpt_offset_unavailable");
          sourceOffset=section.offset;
          if(raw.slice(sourceOffset,sourceOffset+original.length)!==original)throw Error("source_excerpt_offset_unavailable");
          lineOffset=raw.slice(0,sourceOffset).split("\n").length-1;
        }
        const {counterEvidenceMissing,...excerpt}=selectedLines(original??raw,searchTerms,Math.min(2000,remaining,macroScope?Math.floor(budget/Math.max(2,macroScopes.length*2)):issuerScoped?Math.max(700,Math.floor(budget/maxNotes)):2000),row.role,issuerScoped,sourceOffset,lineOffset,
          issuerScoped?issuers:[],original===null);
        if(counterEvidenceMissing)counterExcerptMissing.add(row.path);
        if(!excerpt.excerpt.trim()){observer.observePath(row.path,"excerpt_budget");omitted.push(row.path);return;}
        const historical=titleSubjectPaths.has(row.path)||historicalIssuerPaths.has(row.path)||canonicalReviews.get(row.path)?.legacy||row.historical||historicalOnly(row.path,splitFrontmatter(raw).data);
        items.push({...(historyCutoff?{pointInTime:pitAccepted.get(row.path)}:{}),...(standalone.bindings.has(row.path)?{sourceBinding:standalone.bindings.get(row.path)}:{}),contentSha256:createHash("sha256").update(raw).digest("hex"),path:row.path,role:row.role,matchedMacroScopes:matchedMacroScopes.filter(scope=>matchesMacroScope(row.path,scope,current)),evidenceUse:historical?"historical_context_only":"unverified_candidate",...declared(raw,row.path),score:row.score,...excerpt});
        if(archivalSelection){if(relevantHistory)relevantHistoricalCount++;else historicalCount++;}
        if(family)selectedFamilies.add(family);
        if(background)for(const scope of matchedMacroScopes)macroBackgroundCounts.set(scope,(macroBackgroundCounts.get(scope)||0)+1);
        roleCounts.set(row.role,n+1);remaining-=excerpt.excerpt.length;
      });
    } catch {/* Operational failure is retained in retrieval, never a quota omission. */}
  }
  const roles=new Set(items.map(x=>x.role));
  const retrieval=observer.snapshot({...(historyCutoff?{historyCutoff}:{}),...(verifiedMacro?{macroScope:verifiedMacro}:{}),question,issuers:requestedIssuers,intakeId:req.intakeId,industry:req.industry,focus,maxNotes,maxChars:budget},items.length,omitted.length);
  const incomplete=[...absent,...limits];
  if(counterExcerptMissing.size)incomplete.push("Counter-evidence section found but readable evidence is missing from the bounded excerpt: "+[...counterExcerptMissing].join(", "));
  if(historyCutoff)incomplete.push("Point-in-time exact-current-version retrieval only; no older version reconstruction or complete historical corpus proven. Publication remains a declaration; server known-at receipt is not publisher or semantic verification.");
  if(pitHolds.size)incomplete.push("Point-in-time eligibility HOLD: "+[...new Set(pitHolds.values())].join(", ")+"; excluded paths remain incomplete historical coverage.");
  const questionTruncation=observer.questionTruncation();
  const questionReasons=questionTruncation.queries.length?["question_term_fts_window_truncated","unobserved_candidates_unknown"]:[];
  if(questionReasons.length)incomplete.push("Question-term FTS window truncated (limit 30): "+questionTruncation.queries.join(", ")+". Unobserved candidate paths/count are unknown; omitted history may include counter-evidence. No per-path absence or complete recall established.");
  for(const reason of new Set(optionalFailures.values()))incomplete.push("Optional historical readback HOLD: "+reason+"; see discovery paths (bounded/truncation flagged). Required retrieval status is separate; affected historical coverage remains incomplete.");
  if(relatedHistory.size)incomplete.push("Related multi-issuer history retained as bounded metadata-only pointers, not selected evidence or primary issuer attribution; inspect exact notes before analysis.");
  if(retrieval.status==="operational_hold")incomplete.push("Operational retrieval failure: see retrieval counts and bounded failure records.");
  for(const scan of researchScans)for(const review of scan.reviews)if(review.bundle.status==="HOLD")
    incomplete.push(`${review.intakeId}: Source/Review context binding HOLD (${review.bundle.reason}); no alternate Source inferred.`);
  for(const discovery of identityHoldDiscovery)incomplete.push(`${discovery.requested}: identity HOLD; ${discovery.candidatePaths.length} literal historical candidates retained separately, not issuer mappings or duplicate adjudication. ${discovery.reasons.join(", ")}`);
  for(const r of issuerResolution)if(!r.contextKey)
    incomplete.push(`${r.requested}: issuer context ${r.status}; no alias expansion or security/listing equivalence established.`);
  const issuerCoverage=issuerResolution.map(r=>{
    const keys=scopeKeys(r).map(x=>x.toUpperCase());
    const selectedRoles=[...new Set(items.filter(x=>x.path===r.hubPath||namedIssuers(x.path).some(t=>keys.includes(t)))
      .map(x=>x.role))];
    const missingRoles=(["company","thesis","evidence_register","timeline","source"] as Role[]).filter(role=>!selectedRoles.includes(role));
    for(const role of missingRoles)incomplete.push(`${r.requested}: no ${role} selected for this issuer scope.`);
    return {requested:r.requested,contextKey:r.contextKey,selectedRoles,missingRoles};
  });
  const coverage=(paths:string[],complete:boolean,reasons:string[],canonicalScope=false):Coverage=>({
    // Only the completed exact canonical identity scan supports this explicit
    // absence finding; never extend it to all historical/macro evidence.
    ...(canonicalScope?{finding:paths.length?"FOUND" as const:complete?"NOT_FOUND_WITHIN_VERIFIED_SCOPE" as const:"SCAN_INCOMPLETE" as const}:{}),
    status:paths.length?"FOUND":complete?"NOT_FOUND":"SCAN_INCOMPLETE",paths,scanComplete:complete,
    reasons:[...new Set([...reasons,...(canonicalScope&&!paths.length&&complete?["no_candidate_in_completed_scope"]:[])])]
  });
  const macroCoverage:MacroCoverage[]=macroScopes.map(scope=>{
    const selected=items.filter(item=>item.matchedMacroScopes.includes(scope));
    const paths=macroCandidates.get(scope)??[];
    const reasons=[...questionReasons,...(macroReadReasons.get(scope)??[]),...(limits.size||failed.length?["retrieval_window_incomplete"]:[]),
      ...(selected.some(x=>counterExcerptMissing.has(x.path))?["counter_evidence_excerpt_missing"]:[]),
      ...(paths.some(p=>!selected.some(x=>x.path===p))||selected.some(x=>x.truncated)?["excerpt_or_selection_incomplete"]:[])];
    const complete=!reasons.length;
    return {scope,subjectEvidence:coverage(selected.filter(x=>macroSubjectByScope.get(scope)?.has(x.path)).map(x=>x.path),complete,reasons),
      counterEvidence:coverage(selected.filter(x=>x.counterEvidenceExcerptIncluded).map(x=>x.path),complete,reasons)};
  });
  const researchCoverage:ResearchCoverage[]=issuerResolution.map(r=>{
    const key=r.contextKey??scopeKeys(r)[0];
    const scan=researchScans.find(s=>s.contextKey===key);
    const scopedItems=items.filter(x=>scan?.reviews.some(review=>review.path===x.path)||historicalSubjects.get(x.path)?.includes(key)||namedIssuers(x.path).some(t=>scopeKeys(r).map(k=>k.toUpperCase()).includes(t)));
    // PIT coverage must use the same exact-version admission as selected text.
    // Unverified/unread/future discoveries remain unknown, never comparator
    // anchors. The bounded PIT scan still cannot certify complete history.
    const eligibleReviews=scan?.reviews.filter(review=>!historyCutoff||pitAccepted.has(review.path))??[];
    const selectedReviews=eligibleReviews.filter(review=>!review.legacy&&items.some(item=>item.path===review.path));
    const omittedReviews=eligibleReviews.some(review=>!items.some(item=>item.path===review.path));
    const canonicalComplete=!!r.contextKey&&!!scan?.complete&&!omittedReviews&&!historyCutoff;
    const reasons=[...(historyCutoff?["point_in_time_bounded_versions"]:[]),...(scan?.reasons??[]),...(!r.contextKey?["issuer_scope_unresolved"]:[]),...(omittedReviews?["selection_budget"]:[])];
    // Counter-evidence is an excerpt/heading witness, not a semantic claim
    // that no contrary evidence exists anywhere in the Vault or externally.
    const candidatePaths=rank.filter(x=>(!historyCutoff||pitAccepted.has(x.path))&&(historicalSubjects.get(x.path)?.includes(key)||namedIssuers(x.path).some(t=>scopeKeys(r).map(k=>k.toUpperCase()).includes(t)))).map(x=>x.path);
    const excerptIncomplete=candidatePaths.some(p=>!scopedItems.some(x=>x.path===p))||scopedItems.some(x=>x.truncated);
    const optionalReasons=[...new Set([...optionalFailures].filter(([path])=>candidatePaths.includes(path)).map(([,reason])=>reason))];
    const related=[...relatedHistory.values()].some(scopes=>scopes.includes(key));
    const contextComplete=canonicalComplete&&!limits.size&&!failed.length&&!excerptIncomplete&&!optionalReasons.length&&!related;
    const contextReasons=[...reasons,...questionReasons,...optionalReasons,...(related?["related_history_not_selected"]:[]),...(limits.size||failed.length?["retrieval_window_incomplete"]:[]),...(excerptIncomplete?["excerpt_or_selection_incomplete"]:[]),
      ...(scopedItems.some(x=>counterExcerptMissing.has(x.path))?["counter_evidence_excerpt_missing"]:[])];
    const windows=eligibleReviews.map(review=>publicationWindow(review.publishedAt));
    const eligibleLatest=eligibleReviews.filter((_,i)=>windows[i]&&windows.every((w,j)=>i===j||w&&windows[i]![0]>w[1]));
    const latest=historyCutoff?(eligibleLatest.length===1?eligibleLatest[0]:undefined):scan?.reviews.find(review=>scan.latestReviewPaths.includes(review.path));
    const latestWindow=publicationWindow(latest?.publishedAt??null);
    const earlier=scopedItems.filter(item=>{
      if(item.role!=="research"||item.path===latest?.path)return false;
      const window=publicationWindow(item.schemaCompatibility.publishedAt);
      return latestWindow&&window&&window[1]<latestWindow[0];
    }).map(x=>x.path);
    const orderKnown=historyCutoff?eligibleLatest.length===1:scan?.chronology==="LATEST_BY_DECLARED_PUBLICATION";
    const undatedComparator=scopedItems.some(item=>item.role==="research"&&item.path!==latest?.path&&!publicationWindow(item.schemaCompatibility.publishedAt));
    return {requested:r.requested,contextKey:r.contextKey,scope:"bounded_issuer_research_candidates",
      canonicalReview:{...coverage(selectedReviews.map(x=>x.path),canonicalComplete,reasons,true),scopeDefinition:scan?.scopeDefinition??null},
      counterEvidence:coverage(scopedItems.filter(x=>x.counterEvidenceExcerptIncluded).map(x=>x.path),contextComplete,contextReasons),
      historicalComparator:coverage(earlier,contextComplete&&!!orderKnown&&!undatedComparator,
        [...contextReasons,...(!orderKnown||undatedComparator?["publication_order_unresolved"]:[])]),
      chronology:historyCutoff?"SCAN_INCOMPLETE":scan?.chronology??"SCAN_INCOMPLETE",latestReviewPaths:historyCutoff?[]:scan?.latestReviewPaths??[]};
  });
  if(issuerScoped){
    if(!roles.has("thesis"))incomplete.push("No Current Thesis selected; owner-endorsed thesis is unknown.");
    if(!roles.has("evidence_register"))incomplete.push("No Evidence Register selected; prior claims may be missing.");
    if(!roles.has("source"))incomplete.push("No original issuer/filing source selected; primary claim verification required.");
    incomplete.push("Server-verified primary evidence not established by retrieval; source filenames, roles and metadata cannot replace exact-scope PEV validation.");
    if(!roles.has("industry"))incomplete.push("No industry/TAM source selected; supply-chain effects may be incomplete.");
    for(const label of new Set(relatedContext.values())){
      const n=[...relatedContext.values()].filter(x=>x===label).length;
      incomplete.push(`${label}: ${n} related-context pointer(s) to other issuers' notes that literally mention ${label} (no Company Hub). Metadata-only; not ${label} issuer evidence, a supplier/customer relationship, coverage or a primary source. Read the exact note before use.`);
    }
  }else if(macroScope){
    if(macroSubjectRequested&&!macroSubjectPaths.size)
      incomplete.push("No subject-matched macro evidence found within the retrieval bound; country-only context is not subject coverage.");
    if(!items.some(x=>x.role!=="rules" && x.role!=="timeline"))
      incomplete.push("No country/theme-specific macro evidence selected; research coverage is incomplete.");
    incomplete.push("Server-verified primary macro/statistical evidence not established by retrieval; verify the official data release and exact-scope PEV before analysis.");
    const scoped=items.filter(x=>x.matchedMacroScopes.length);
    if(scoped.length&&scoped.every(x=>x.evidenceUse==="historical_context_only"))
      incomplete.push("Every selected scope-matched macro item is historical_context_only (archived or AI analysis): no current primary or unverified-candidate macro evidence was selected. Treat them as dated viewpoints, not fresh facts or independent origins.");
    if(relevantCapped.length)incomplete.push(`Relevant historical macro context bounded to 3 items; ${relevantCapped.length} further subject/counter-evidence candidate(s) omitted (discovery reason historical_context_cap).`);
    if(familyDuplicates.length)incomplete.push(`Same-source-family historical duplicates omitted (${familyDuplicates.length}); one item per declared source URL/original source kept.`);
    if(macroPointers.size)incomplete.push(`Country-unattributed macro notes returned by scoped subject queries exposed as ${macroPointers.size} metadata-only pointer(s): neither title nor declared metadata attributes them to the requested scope. Not selected evidence, admission or coverage; read the exact note before use.`);
  }
  if(failed.length)incomplete.push("Search failed on terms: "+failed.join(", "));
  // Expose already discovered receipt-bound research omitted by note/excerpt
  // budgets. No extra scan, changed ranking, borrowed event dates, or implicit
  // insertion into the Judge's selected-history witness. Missing ≠ nonexistent.
  const fallback=new Map<string,ResearchFallback["candidates"][number]>();
  const remember=(candidate:ResearchFallback["candidates"][number])=>{
    if(!items.some(i=>i.path===candidate.path))fallback.set(candidate.path,historyCutoff?
      {...candidate,sha256:null,receiptId:null,bindingStatus:"HOLD",reason:"pit_not_selected_or_unverified",accessStatus:"AVAILABLE_NOT_RETRIEVED",metadataBasis:"index_only_unverified"}:candidate);
  };
  // Prioritize unread canonical diagnostics, then related historical pointers.
  // Same 12-entry bound; overflow is explicit, never an admission/read bypass.
  for(const c of deferredReviews.values())remember({path:c.path,intakeId:c.intakeId,kind:"canonical_review",
    sha256:null,receiptId:null,bindingStatus:"HOLD",researchTrust:null,eventDate:null,publicationDate:c.publishedAt,
    reason:c.reason,accessStatus:"AVAILABLE_NOT_RETRIEVED",metadataBasis:"index_only_unverified"});
  for(const path of relatedHistory.keys())remember({path,intakeId:null,kind:"historical_related",
    sha256:null,receiptId:null,bindingStatus:"HOLD",researchTrust:null,eventDate:null,publicationDate:null,
    reason:"declared_multi_issuer_relation",issuerAttribution:"not_established",accessStatus:"AVAILABLE_NOT_RETRIEVED",metadataBasis:"index_only_unverified"});
  for(const scan of researchScans)for(const {bundle:b} of scan.reviews){
    remember({path:b.reviewPath,intakeId:b.intakeId,kind:"canonical_review",sha256:b.reviewSha256,receiptId:b.reviewReceiptId,
      bindingStatus:b.status==="BOUND_SOURCE_REVIEW"?"receipt_bound":"HOLD",researchTrust:b.researchTrust,
      eventDate:b.eventDate,publicationDate:b.publishedAt,reason:"outside_selected_context"});
    if(b.status==="BOUND_SOURCE_REVIEW"&&b.sourcePath)remember({path:b.sourcePath,intakeId:b.intakeId,kind:"source_intake",
      sha256:b.sourceSha256,receiptId:b.sourceReceiptId,bindingStatus:"receipt_bound",
      researchTrust:inspectCanonicalKnowledgeMetadata(b.sourcePath,indexedMetadata(b.sourcePath)).researchTrust,
      eventDate:b.eventDate,publicationDate:b.publishedAt,reason:"outside_selected_context"});
  }
  for(const [path,b] of standalone.bindings)remember({path,intakeId:b.intakeId,kind:"source_intake",sha256:b.sourceSha256,
    receiptId:b.sourceReceiptId,bindingStatus:"receipt_bound",researchTrust:inspectCanonicalKnowledgeMetadata(path,indexedMetadata(path)).researchTrust,
    eventDate:b.eventDate,publicationDate:b.publicationDate,reason:"outside_selected_context"});
  // DELTA-01 C1b/C3 pointers come last so they never displace existing candidates.
  const pointer={intakeId:null,kind:"related_context" as const,sha256:null,receiptId:null,bindingStatus:"HOLD" as const,researchTrust:null,
    eventDate:null,publicationDate:null,accessStatus:"AVAILABLE_NOT_RETRIEVED" as const,metadataBasis:"index_only_unverified" as const};
  for(const path of macroPointers.keys())remember({...pointer,path,reason:"macro_country_unattributed",countryAttribution:"not_established"});
  for(const [path,label] of relatedContext)remember({...pointer,path,reason:"other_issuer_literal_mention",issuerAttribution:"not_established",literalMention:label});
  const researchFallback:ResearchFallback={status:"bounded_discovery_not_selected_evidence",truncated:fallback.size>12,
    candidates:[...fallback.values()].slice(0,12),instructions:"Read exact paths/intakeId before reasoning; these candidates were NOT selected or semantically assessed. Publication order may be unknown. Receipts prove persistence, not event equivalence, primary truth, independence or comparator eligibility. Any changed assessment requires a fresh packet."};
  const discovery=observer.finish(items,researchFallback);
  // Ledger observability limitations stay in discovery, not pack-wide gaps.
  // Specific failed reads, missing roles and bounded evidence gaps remain above.
  return {
    discovery,researchFallback,
    standaloneSources:historyCutoff?standalone.scans.map(scan=>({...scan,paths:scan.paths.filter(p=>pitAccepted.has(p)),complete:false,reasons:[...scan.reasons,"point_in_time_bounded_versions"]})):standalone.scans,retrieval,status:"retrieval_only_not_verified",question,issuers:requestedIssuers,issuerResolution,issuerCoverage,identityHoldDiscovery,macroCoverage,researchCoverage,
    contextBundles:researchScans.flatMap(scan=>scan.reviews.map(review=>{
      const b=review.bundle;return historyCutoff&&(!pitAccepted.has(b.reviewPath)||!b.sourcePath||!pitAccepted.has(b.sourcePath))?
        {...b,status:"HOLD" as const,reason:"pit_not_selected_or_unverified"}:b;
    })),focus,industry:req.industry?.slice(0,140)||null,
    items,considered:rank.length,selected:items.length,excerptChars:budget-remaining,
    incomplete,omitted:omitted.slice(0,15),
    warnings:[
      "Receipted standalone Sources establish literal mentions of resolved Hub labels only, not primary subject, event equivalence or independent evidence; Source receipts do not authenticate publishers or claims.",
      "Bounded FTS5 lexical discovery, not semantic recall or full Vault coverage. Missing/omitted notes may contain counter-evidence.",
      "Verification fields are note-declared metadata, NOT freshly reverified primary facts. File modified time is NOT event date.",
      "Event/publication/analysis/import dates are separate declarations; missing or invalid dates are UNKNOWN. Nearby relevance scores use declared publication for display ordering only; overlapping/unknown dates do not establish latest or event order.",
      "Macro scopes retain separate source paths and declared country/topic attribution. Risk headings and country-background slots are bounded discovery hints, not semantic counter-evidence verification.",
      "An archived AI repost is not independent corroboration; deduplicate issuer+source+metric+fiscal period.",
      "Hub title/alias readback is issuer-context discovery only, not security/listing equivalence or primary verification. ADR, DR, exchange, prices and claim identities are not rewritten.",
      "Source/Review bundles are separate intake bindings, not merged economic events. Write receipts establish historical write/readback/index only; neither receipt nor retrieval verifies a claim. Latest uses declared publication chronology, not file time or event date.",
      "Use full original notes and current external filings/consensus for investment decisions. This tool is read-only.",
      "Contradiction/risk sections are discoverability hints, not exhaustive counter-evidence verification. Original context must be read in full where material.",
    ]
  };
}

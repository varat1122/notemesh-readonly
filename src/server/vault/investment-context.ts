import fs from "node:fs";
import { searchVault } from "./queries";
import { db } from "../db";
import { readNote } from "./notes";
import { resolveNotePath, resolveFolderPath } from "./paths";
import { splitFrontmatter } from "./markdown";
import { inspectCanonicalKnowledgeMetadata, type SchemaInspection } from "./investment-knowledge-schema";
import { hubIdentityKey, indexedHubAliases, indexedTopLevelHubs } from "./investment-routing-v2";
import { discoverCanonicalResearch, isCanonicalResearchPath, publicationWindow, type ContextBundle, type CanonicalResearchScan } from "./investment-research-context";

export type Focus = "earnings" | "broker" | "tam" | "macro" | "thesis" | "general";
export type Role = "rules" | "thesis" | "evidence_register" | "timeline" | "company" | "industry" | "source" | "research" | "archive";
export interface Input { question: string; issuers?: string[]; intakeId?: string; industry?: string; focus?: Focus; maxNotes?: number; maxChars?: number }
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
interface Coverage {status:"FOUND"|"NOT_FOUND"|"SCAN_INCOMPLETE";paths:string[];scanComplete:boolean;reasons:string[]}
export interface IdentityHoldDiscovery {
  requested:string;resolutionStatus:IssuerResolution["status"];mappingVerified:false;
  basis:"literal_historical_candidates_only";candidatePaths:string[];scanComplete:boolean;reasons:string[];
}
export interface MacroCoverage {scope:string;subjectEvidence:Coverage;counterEvidence:Coverage}
type DeclaredDate={status:"DECLARED"|"UNKNOWN";value:string|null};
export interface ResearchChronology {eventDate:DeclaredDate;publicationDate:DeclaredDate;analysisDate:DeclaredDate;importDate:DeclaredDate}
export interface Item { path: string; role: Role; evidenceUse:"historical_context_only"|"unverified_candidate"; declaredVerification: string|null; declaredSourceType:string|null; declaredEventDate: string|null; declaredPublishedAt: string|null; chronology:ResearchChronology;matchedMacroScopes:string[];score: number; excerpt: string; line: number; truncated: boolean; counterEvidenceExcerptIncluded: boolean; schemaCompatibility: SchemaInspection }
export interface Pack { status: "retrieval_only_not_verified"; question: string; issuers: string[]; issuerResolution:IssuerResolution[];issuerCoverage:IssuerCoverage[];identityHoldDiscovery:IdentityHoldDiscovery[];macroCoverage:MacroCoverage[];researchCoverage:ResearchCoverage[];contextBundles:ContextBundle[];focus: Focus; industry: string|null; items: Item[]; considered: number; selected: number; excerptChars: number; incomplete: string[]; omitted: string[]; warnings: string[] }

function resolveIssuers(requested:string[]):IssuerResolution[]{
  if(!requested.length)return [];
  // Same indexed Company Hub/alias contract as M5.2. A sentinel prevents an
  // incomplete index scan from establishing a falsely unique mapping.
  const hubs=indexedTopLevelHubs("01_Companies/");
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
      const actual=JSON.stringify(splitFrontmatter(readNote(hub.path).content).data);
      const aliases=(fm:string|null)=>JSON.stringify([...new Set(indexedHubAliases(fm).map(hubIdentityKey))].sort());
      if(aliases(actual)!==aliases(hub.frontmatter))return result("readback_hold");
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
function discoverDuringIdentityHold(resolutions:IssuerResolution[]):IdentityHoldDiscovery[]{
  return resolutions.filter(r=>["ambiguous_hold","readback_hold","index_limit_hold"].includes(r.status)&&
    /^[A-Z][A-Z0-9.-]{0,11}$/.test(r.requested)).map(r=>{
    const result:IdentityHoldDiscovery={requested:r.requested,resolutionStatus:r.status,mappingVerified:false,
      basis:"literal_historical_candidates_only",candidatePaths:[],scanComplete:true,reasons:[]};
    const folder="10_Knowledge/Company Research";
    if(!folderExists(folder)){
      result.scanComplete=false;result.reasons.push("literal_folder_unavailable");return result;
    }
    try{
      const found=searchVault(r.requested,{folder,limit:31});
      if(found.total>30){result.scanComplete=false;result.reasons.push("literal_search_limit");}
      const candidates=found.hits.slice(0,30).filter(h=>namedIssuers(h.path).includes(r.requested));
      if(candidates.length>12){result.scanComplete=false;result.reasons.push("literal_read_limit");}
      for(const h of candidates.slice(0,12))try{
        const raw=readNote(h.path).content;
        if(Buffer.byteLength(raw)>100000||JSON.stringify(splitFrontmatter(raw).data)!==JSON.stringify(indexedMetadata(h.path)))throw Error("unreadable");
        result.candidatePaths.push(h.path);
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
    // Archived company research declares its primary company in frontmatter.
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
      .map(x=>x[1]).filter(x=>!/^(?:P\d+|F\d+|Q\d+|FY\d+|USD|GDP|EPS|FCF|OCF|ROIC|BOM|TAM|GPU|CPU|CPO|NPO|ROI|CEO|CFO|IR|US|AI|DC)$/.test(x));
    return codes.slice(0,1);
  }
  return [];
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
function explicitMacroScope(path: string, topic: string, current?:Record<string,unknown>): boolean {
  const title=(path.split("/").at(-1)||"").normalize("NFC").toUpperCase();
  const t=topic.normalize("NFC").toUpperCase();
  const isBoundary=(c:string|undefined)=>!c||!/[\p{L}\p{N}]/u.test(c);
  for(let at=title.indexOf(t);at>=0;at=title.indexOf(t,at+1)){
    if(isBoundary(title[at-1])&&isBoundary(title[at+t.length]))return true;
  }
  try {
    const fm=current??indexedMetadata(path);
    const fields=[fm.country,fm.entity,fm.geography,fm.region].flatMap(x=>Array.isArray(x)?x:[x]);
    return fields.some(x=>typeof x==="string"&&x.trim().normalize("NFC").toUpperCase()===t);
  }catch{return false;}
}
function indexedMetadata(path:string):Record<string,unknown>{
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path = ?").get(path) as {frontmatter:string|null}|undefined;
  try{
    const fm:unknown=row?.frontmatter?JSON.parse(row.frontmatter):null;
    return fm&&typeof fm==="object"&&!Array.isArray(fm)?fm as Record<string,unknown>:{};
  }catch{return {};}
}
function historicalOnly(path:string,fm:Record<string,unknown>):boolean{
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
function selectedLines(raw: string, search: string[], max: number, role: Role) {
  const lines = raw.split(/\r?\n/);
  let index = 0, maxHits = 0;
  for (let i = 0; i < Math.min(lines.length, 1200); i++) {
    const lower = lines[i].toLowerCase();
    const hits = search.filter(t => t.length > 1 && lower.includes(t.toLowerCase())).length;
    if (hits > maxHits) { index = i; maxHits = hits; }
  }
  const start = index > 15 ? Math.max(0,index-2) : 0;
  const firstEnd = Math.min(lines.length,start+12);
  let excerpt = `[Source lines ${start+1}-${firstEnd}]\n` + lines.slice(start,firstEnd).join("\n");
  let counterEvidenceExcerptIncluded = false;
  let counterHeading:string|null=null;
  // Anchor contradictory evidence even when the highest lexical match is in
  // a note's introduction. Source line labels prevent disjoint snippets from
  // appearing to be one continuous quotation.
  if ((role==="thesis" || role==="evidence_register" || role==="source" || role==="research") && max>=700) {
    const counter = lines.findIndex((s,i) => i < 1200 && COUNTER_SECTION.test(s));
    counterHeading=counter>=0?lines[counter]:null;
    if (counter>=0 && (counter<start || counter>=firstEnd)) {
      const secondEnd = Math.min(lines.length,counter+8);
      const addition = `\n\n[Counter-evidence / risk section: source lines ${counter+1}-${secondEnd}]\n` +
        lines.slice(counter,secondEnd).join("\n");
      const space = max-excerpt.length;
      if (space>100) {
        excerpt += addition.slice(0,space);
        counterEvidenceExcerptIncluded = true;
      }
    } else if(counter>=start && counter<firstEnd) {
      counterEvidenceExcerptIncluded = true;
    }
  }
  const clipped=excerpt.slice(0,max);
  return {
    excerpt:clipped,line:start+1,
    truncated:start>0 || firstEnd<lines.length || clipped.length<excerpt.length,
    counterEvidenceExcerptIncluded:counterEvidenceExcerptIncluded&&counterHeading!==null&&clipped.includes(counterHeading),
  };
}
function declared(raw: string, notePath: string) {
  const f = splitFrontmatter(raw).data as Record<string,unknown>;
  const schema=inspectCanonicalKnowledgeMetadata(notePath,f);
  const date=(value:string|null):DeclaredDate=>({status:value?"DECLARED":"UNKNOWN",value});
  return {declaredVerification:typeof f.verification==="string"?f.verification:null,declaredEventDate:schema.eventDate,declaredPublishedAt:schema.publishedAt,
    declaredSourceType:typeof f.source_type==="string"?f.source_type.slice(0,80):typeof f.source_tier==="string"?f.source_tier.slice(0,80):null,
    chronology:{eventDate:date(schema.eventDate),publicationDate:date(schema.publishedAt),analysisDate:date(schema.analysisDate),importDate:date(schema.importedAt)},schemaCompatibility:schema};
}
export function buildInvestmentContextPack(req: Input): Pack {
  const question = req.question.trim().slice(0,1200);
  if (question.length<3) throw new Error("Question must contain at least 3 characters");
  const requestedIssuers = [...new Set((req.issuers||[]).map(s=>s.trim().toUpperCase()))].slice(0,6);
  if(req.intakeId&&(!/^IN-[A-F0-9]{16}$/.test(req.intakeId)||!requestedIssuers.length))throw Error("Intake scope requires a valid intake ID and issuer scope");
  const issuerResolution=resolveIssuers(requestedIssuers);
  const identityHoldDiscovery=discoverDuringIdentityHold(issuerResolution);
  const issuers=[...new Set(issuerResolution.flatMap(scopeKeys).map(x=>x.toUpperCase()))];
  const contextKeys=[...new Set(issuerResolution.flatMap(r=>r.contextKey?[r.contextKey]:scopeKeys(r)))];
  const issuerScoped=requestedIssuers.length>0;
  const focus = req.focus||"general";
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
  const aliasResolution=resolveIssuers([...new Set(subjectScopes.flatMap(scope=>scope.aliases.slice(0,12)))]);
  const researchScans=subjectScopes.map(({key,resolved,aliases})=>{
    const checked=aliasResolution.filter(r=>aliases.slice(0,12).includes(r.requested));
    const subjects=resolved.length?[...resolved.flatMap(scopeKeys),...checked.filter(r=>r.contextKey===key).map(r=>r.requested)]:undefined;
    const scan=discoverCanonicalResearch(key,req.intakeId,subjects);
    if(aliases.length>12){scan.complete=false;scan.reasons.push("legacy_subject_alias_limit");}
    if(checked.some(r=>r.contextKey!==key)){scan.complete=false;scan.reasons.push("legacy_subject_alias_unresolved");}
    if(!scan.complete){scan.chronology="SCAN_INCOMPLETE";scan.latestReviewPaths=[];}
    return scan;
  });
  const canonicalReviews=new Map(researchScans.flatMap(scan=>scan.reviews.map(review=>[review.path,review] as const)));
  const boundSources=new Map(researchScans.flatMap(scan=>scan.reviews.flatMap(review=>review.bundle.status==="BOUND_SOURCE_REVIEW"&&review.bundle.sourcePath
    ?[[review.bundle.sourcePath,scan.contextKey] as const]:[])));
  for(const scan of researchScans){
    for(const reason of scan.reasons)limits.add(`${scan.contextKey}: ${reason}`);
    for(const [i,review] of scan.reviews.entries()){
      // Discover canonical Reviews before broad lexical windows can hide them.
      // Ranking is publication-based context priority, never event equivalence.
      pool.set(review.path,195-i*3);
      if(review.bundle.status==="BOUND_SOURCE_REVIEW"&&review.bundle.sourcePath)pool.set(review.bundle.sourcePath,194-i*3);
    }
  }
  const search=(query:string,opts:Parameters<typeof searchVault>[1])=>{
    const result=searchVault(query,opts);
    if(result.total>result.hits.length)limits.add("Search window truncated: "+query);
    return result;
  };
  const macroScope = !issuerScoped && focus==="macro";
  // Country/topic-only questions do not inherit company-thesis obligations.
  // Prefer the explicitly supplied scope over incidental query terms.
  // Explicit separators split scopes; preserve multiword names and do not
  // guess country aliases or split "and" inside a country's proper name.
  const requestedMacroScopes=macroScope?[...new Set((req.industry??topicTerms(question)[0]??"").split(/[/;|,]/)
    .map(x=>topicTerms(x).join(" ")).filter(Boolean))]:[];
  const macroScopes=requestedMacroScopes.slice(0,4);
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
  for (const p of needed) { if (exists(p)) pool.set(p,120); else absent.push(p); }
  // Historical Company indexes exist in two legacy locations. Neither is a
  // current/approved Thesis, but both provide routes back to dated prior
  // conversations. A missing newer index must not hide the older one or be
  // reported as missing when the other location is present.
  for (const ticker of contextKeys) {
    const candidates=[
      "08_Daily_Weekly/Research Indexes/Company - "+ticker+".md",
      "10_Knowledge/Indexes/Company - "+ticker+".md"
    ];
    const present=candidates.filter(exists);
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
      if(!exists(timeline))continue;
      const rows=db().prepare(
        "SELECT DISTINCT resolved_path FROM links WHERE source_path=? AND resolved_path LIKE ? ORDER BY resolved_path LIMIT 12"
      ).all(timeline,"02_Industries_Themes/%.md") as {resolved_path:string|null}[];
      for(const row of rows){
        const target=row.resolved_path;
        if(target && target.startsWith("02_Industries_Themes/") &&
           roleOf(target)==="industry" && exists(target)){
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
    const matches = db().prepare("SELECT path FROM notes WHERE substr(path,1,?)=? ORDER BY path DESC LIMIT 13")
      .all(prefix.length,prefix) as {path:string}[];
    if(matches.length>12)limits.add("Primary-source filename window truncated: "+ticker);
    for (const note of matches.slice(0,12)) if(exists(note.path)) pool.set(note.path,115);
  }
  const searchTerms = issuerScoped&&!issuers.length?[]:[...new Set([...issuers,...topicTerms(req.industry||""),...terms(question)])].slice(0,12);
  const failed: string[] = [];
  const macroSubjectPaths = new Set<string>();
  let macroSubjectRequested=false;
  const macroSubjectByScope=new Map(macroScopes.map(scope=>[scope,new Set<string>()]));
  if(macroScope){
    const scopeWords=new Set(macroScopes.flatMap(x=>x.split(" ")));
    const subject=topicTerms(question).filter(x=>!scopeWords.has(x)&&x.length>=3)
      .filter(x=>!/^\d+$|^(?:THIRD|QUARTER|COMPARISON|COMPARE)$/.test(x)).slice(0,5);
    macroSubjectRequested=subject.length>0;
    for(const scope of macroScopes){
      const folder="10_Knowledge/Macro and Markets";
      // Country-only discovery keeps differing risk vocabulary eligible.
      // Subject hits rank higher but never become a blanket admission filter.
      if(folderExists(folder))try{
        for(const h of search(scope,{limit:100,folder}).hits)if(explicitMacroScope(h.path,scope))pool.set(h.path,22);
      }catch{failed.push(scope);}
      for(const word of subject)try{
        const hits=[...search(scope+" "+word,{limit:100}).hits,
          ...(folderExists(folder)?search(scope+" "+word,{limit:100,folder}).hits:[])];
        for(const h of hits)if(explicitMacroScope(h.path,scope)){
          macroSubjectPaths.add(h.path);macroSubjectByScope.get(scope)!.add(h.path);
          if(h.path.startsWith(folder+"/"))pool.set(h.path,60);
        }
      }catch{failed.push(scope+" "+word);}
      const candidatePaths=db().prepare("SELECT path FROM notes WHERE instr(upper(path),?)>0 ORDER BY path DESC LIMIT 151")
        .all(scope) as {path:string}[];
      if(candidatePaths.length>150)limits.add("Macro filename window truncated: "+scope);
      for(const r of candidatePaths.slice(0,150))if((r.path.startsWith(folder+"/")||r.path.startsWith("02_Industries_Themes/"))&&
        explicitMacroScope(r.path,scope)&&exists(r.path))pool.set(r.path,Math.max(pool.get(r.path)||0,macroSubjectPaths.has(r.path)?60:22));
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
  for (const ticker of issuers) {
    try {
      for (const h of search(ticker,{limit:100}).hits) issuerPaths.add(h.path);
    } catch { failed.push(ticker); }
  }
  for (const term of searchTerms) {
    try {
      for (const [i,h] of search(term,{limit:30}).hits.entries()) {
        // FTS cannot bypass failed canonical readback, the scoped read bound,
        // or an explicitly requested intake. Source pairing is receipt-bound.
        if(issuerScoped&&isCanonicalResearchPath(h.path)&&!canonicalReviews.has(h.path))continue;
        if(issuerScoped&&h.path.startsWith("00_Inbox/ChatGPT/Investment Intake - ")&&!boundSources.has(h.path))continue;
        const role=roleOf(h.path);
        const scopedIssuerNames=namedIssuers(h.path);
        if(issuers.length && scopedIssuerNames.length &&
          !scopedIssuerNames.some(t=>issuers.includes(t)))continue;
        if(issuers.length && role==="research" && !pool.has(h.path) &&
          (!h.path.startsWith("10_Knowledge/Company Research/") ||
           (req.industry && !industryMatches.has(h.path))))continue;
        if(issuers.length && role==="industry" && req.industry &&
          !industryMatches.has(h.path))continue;
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
          if(!explicitWords.some(w=>titleWords.has(w)))continue;
        }
        if(issuers.length && !issuerPaths.has(h.path) &&
          role!=="industry" && role!=="rules" && !pool.has(h.path)) continue;
        if(macroScope){
          // One shared word (e.g. "revenue") must not pull an unrelated issuer.
          if(!macroScopes.some(scope=>explicitMacroScope(h.path,scope)))continue;
          if(role==="company"||role==="thesis"||role==="evidence_register"||
            (role==="timeline" && scopedIssuerNames.length>0)||
            h.path.startsWith("10_Knowledge/Company Research/"))continue;
        }
        pool.set(h.path,Math.max(pool.get(h.path)||0, 30-i));
        if (pool.size>200) break;
      }
    } catch { failed.push(term); }
  }
  const macroRiskPaths=new Set<string>();
  const macroReadReasons=new Map(macroScopes.map(scope=>[scope,[] as string[]]));
  const macroCandidates=new Map(macroScopes.map(scope=>[scope,[...pool.keys()].filter(p=>roleOf(p)!=="rules"&&explicitMacroScope(p,scope))]));
  for(const [scope,paths] of macroCandidates){
    // A bounded section scan, not an inference about semantic risk. Admit all
    // country candidates to ranking, including unread/unmarked background.
    const reasons=macroReadReasons.get(scope)!;
    if(paths.length>24)reasons.push("counter_read_limit");
    for(const p of [...paths].sort().slice(0,24))try{
      const raw=readNote(p).content;
      if(Buffer.byteLength(raw)>100000)throw Error("read_limit");
      const parsed=splitFrontmatter(raw);
      if(!explicitMacroScope(p,scope,parsed.data))throw Error("scope_readback");
      const lines=parsed.body.split(/\r?\n/);
      if(lines.length>1200)reasons.push("counter_line_limit");
      if(lines.slice(0,1200).some(line=>COUNTER_SECTION.test(line)))macroRiskPaths.add(p);
    }catch{reasons.push("counter_readback_unavailable");}
  }
  // Promote same-event research whose headline contains the user's specific
  // subject (e.g. CrowdStrike + CLEAR), not older ticker-only summaries.
  // The ranking is a discovery hint, never a deduplication or source verdict.
  const subjectTerms=topicTerms(question).filter(t=>t.length>=4 && !/^[0-9]/.test(t) &&
    !issuers.includes(t) && !/^(?:HISTORICAL|ARCHIVE|RE-INGEST|UPDATE|LATEST|NEW|EVENT|TEST|VERIFY|SOURCE|CLAIM|NEWS|RESEARCH)$/.test(t));
  const rank = [...pool].map(([path,boost])=>{
    const role=roleOf(path);
    const historical=historicalOnly(path,indexedMetadata(path));
    const companyBonus=issuerTokenInTitle(path,issuers)?22:0;
    const title=(path.split("/").at(-1)??"").normalize("NFC").toUpperCase();
    const eventTitleMatches=subjectTerms.filter(term=>title.split(/[^\p{L}\p{N}]+/u).includes(term)).length;
    const specificEventBonus=issuers.length && role==="research"
      ? Math.min(3,eventTitleMatches)*35:0;
    const macroBonus=macroScope && macroScopes.length ?
      (macroScopes.some(scope=>explicitMacroScope(path,scope))?25:0) +
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
  const items: Item[] = [];
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
  const macroBackgroundCounts=new Map<string,number>();
  for (const row of rank) {
    // Company history and protected drafts must remain discoverable even when
    // derived from AI. Only raw archives / macro recaps share this fallback cap.
    const archivalSelection=row.role==="archive"||macroScope&&row.historical&&row.role==="research";
    if (archivalSelection && (!allowArchived || !archivalRequested&&historicalCount>=1)) {omitted.push(row.path);continue;}
    if (items.length>=maxNotes||remaining<250) {omitted.push(row.path);continue;}
    const matchedMacroScopes=macroScopes.filter(scope=>explicitMacroScope(row.path,scope));
    const background=macroScope&&macroSubjectRequested&&row.role!=="rules"&&!macroSubjectPaths.has(row.path)&&!macroRiskPaths.has(row.path);
    if(background&&matchedMacroScopes.every(scope=>(macroBackgroundCounts.get(scope)||0)>=1)){omitted.push(row.path);continue;}
    const n=roleCounts.get(row.role)||0;
    if(n>=(quota[row.role]??4)){omitted.push(row.path);continue;}
    try {
      const raw=readNote(row.path).content;
      const current=splitFrontmatter(raw).data;
      if(macroScope&&row.role!=="rules"&&!matchedMacroScopes.some(scope=>explicitMacroScope(row.path,scope,current)))throw Error("macro_scope_readback");
      const excerpt=selectedLines(raw,searchTerms,Math.min(2000,remaining,macroScope?Math.floor(budget/Math.max(2,macroScopes.length*2)):2000),row.role);
      if(!excerpt.excerpt.trim())continue;
      const historical=canonicalReviews.get(row.path)?.legacy||row.historical||historicalOnly(row.path,splitFrontmatter(raw).data);
      items.push({path:row.path,role:row.role,matchedMacroScopes:matchedMacroScopes.filter(scope=>explicitMacroScope(row.path,scope,current)),evidenceUse:historical?"historical_context_only":"unverified_candidate",...declared(raw,row.path),score:row.score,...excerpt});
      if(archivalSelection)historicalCount++;
      if(background)for(const scope of matchedMacroScopes)macroBackgroundCounts.set(scope,(macroBackgroundCounts.get(scope)||0)+1);
      roleCounts.set(row.role,n+1);remaining-=excerpt.excerpt.length;
    } catch {omitted.push(row.path);}
  }
  const roles=new Set(items.map(x=>x.role));
  const incomplete=[...absent,...limits];
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
  const coverage=(paths:string[],complete:boolean,reasons:string[]):Coverage=>({
    status:paths.length?"FOUND":complete?"NOT_FOUND":"SCAN_INCOMPLETE",paths,scanComplete:complete,reasons:[...new Set(reasons)]
  });
  const macroCoverage:MacroCoverage[]=macroScopes.map(scope=>{
    const selected=items.filter(item=>item.matchedMacroScopes.includes(scope));
    const paths=macroCandidates.get(scope)??[];
    const reasons=[...(macroReadReasons.get(scope)??[]),...(limits.size||failed.length?["retrieval_window_incomplete"]:[]),
      ...(paths.some(p=>!selected.some(x=>x.path===p))||selected.some(x=>x.truncated)?["excerpt_or_selection_incomplete"]:[])];
    const complete=!reasons.length;
    return {scope,subjectEvidence:coverage(selected.filter(x=>macroSubjectByScope.get(scope)?.has(x.path)).map(x=>x.path),complete,reasons),
      counterEvidence:coverage(selected.filter(x=>x.counterEvidenceExcerptIncluded).map(x=>x.path),complete,reasons)};
  });
  const researchCoverage:ResearchCoverage[]=issuerResolution.map(r=>{
    const key=r.contextKey??scopeKeys(r)[0];
    const scan=researchScans.find(s=>s.contextKey===key);
    const scopedItems=items.filter(x=>scan?.reviews.some(review=>review.path===x.path)||namedIssuers(x.path).some(t=>scopeKeys(r).map(k=>k.toUpperCase()).includes(t)));
    const selectedReviews=scan?.reviews.filter(review=>!review.legacy&&items.some(item=>item.path===review.path))??[];
    const omittedReviews=scan?.reviews.some(review=>!items.some(item=>item.path===review.path))??false;
    const canonicalComplete=!!r.contextKey&&!!scan?.complete&&!omittedReviews;
    const reasons=[...(scan?.reasons??[]),...(!r.contextKey?["issuer_scope_unresolved"]:[]),...(omittedReviews?["selection_budget"]:[])];
    // Counter-evidence is an excerpt/heading witness, not a semantic claim
    // that no contrary evidence exists anywhere in the Vault or externally.
    const candidatePaths=rank.filter(x=>namedIssuers(x.path).some(t=>scopeKeys(r).map(k=>k.toUpperCase()).includes(t))).map(x=>x.path);
    const excerptIncomplete=candidatePaths.some(p=>!scopedItems.some(x=>x.path===p))||scopedItems.some(x=>x.truncated);
    const contextComplete=canonicalComplete&&!limits.size&&!failed.length&&!excerptIncomplete;
    const contextReasons=[...reasons,...(limits.size||failed.length?["retrieval_window_incomplete"]:[]),...(excerptIncomplete?["excerpt_or_selection_incomplete"]:[])];
    const latest=scan?.reviews.find(review=>scan.latestReviewPaths.includes(review.path));
    const latestWindow=publicationWindow(latest?.publishedAt??null);
    const earlier=scopedItems.filter(item=>{
      if(item.role!=="research"||item.path===latest?.path)return false;
      const window=publicationWindow(item.schemaCompatibility.publishedAt);
      return latestWindow&&window&&window[1]<latestWindow[0];
    }).map(x=>x.path);
    const orderKnown=scan?.chronology==="LATEST_BY_DECLARED_PUBLICATION";
    const undatedComparator=scopedItems.some(item=>item.role==="research"&&item.path!==latest?.path&&!publicationWindow(item.schemaCompatibility.publishedAt));
    return {requested:r.requested,contextKey:r.contextKey,scope:"bounded_issuer_research_candidates",
      canonicalReview:coverage(selectedReviews.map(x=>x.path),canonicalComplete,reasons),
      counterEvidence:coverage(scopedItems.filter(x=>x.counterEvidenceExcerptIncluded).map(x=>x.path),contextComplete,contextReasons),
      historicalComparator:coverage(earlier,contextComplete&&!!orderKnown&&!undatedComparator,
        [...contextReasons,...(!orderKnown||undatedComparator?["publication_order_unresolved"]:[])]),
      chronology:scan?.chronology??"SCAN_INCOMPLETE",latestReviewPaths:scan?.latestReviewPaths??[]};
  });
  if(issuerScoped){
    if(!roles.has("thesis"))incomplete.push("No Current Thesis selected; owner-endorsed thesis is unknown.");
    if(!roles.has("evidence_register"))incomplete.push("No Evidence Register selected; prior claims may be missing.");
    if(!roles.has("source"))incomplete.push("No original issuer/filing source selected; primary claim verification required.");
    incomplete.push("Server-verified primary evidence not established by retrieval; source filenames, roles and metadata cannot replace exact-scope PEV validation.");
    if(!roles.has("industry"))incomplete.push("No industry/TAM source selected; supply-chain effects may be incomplete.");
  }else if(macroScope){
    if(macroSubjectRequested&&!macroSubjectPaths.size)
      incomplete.push("No subject-matched macro evidence found within the retrieval bound; country-only context is not subject coverage.");
    if(!items.some(x=>x.role!=="rules" && x.role!=="timeline"))
      incomplete.push("No country/theme-specific macro evidence selected; research coverage is incomplete.");
    incomplete.push("Server-verified primary macro/statistical evidence not established by retrieval; verify the official data release and exact-scope PEV before analysis.");
  }
  if(failed.length)incomplete.push("Search failed on terms: "+failed.join(", "));
  return {
    status:"retrieval_only_not_verified",question,issuers:requestedIssuers,issuerResolution,issuerCoverage,identityHoldDiscovery,macroCoverage,researchCoverage,
    contextBundles:researchScans.flatMap(scan=>scan.reviews.map(review=>review.bundle)),focus,industry:req.industry?.slice(0,140)||null,
    items,considered:rank.length,selected:items.length,excerptChars:budget-remaining,
    incomplete,omitted:omitted.slice(0,15),
    warnings:[
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

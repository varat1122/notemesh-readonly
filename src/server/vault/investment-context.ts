import fs from "node:fs";
import { searchVault } from "./queries";
import { db } from "../db";
import { resolveNotePath } from "./paths";
import { splitFrontmatter,extractStructure } from "./markdown";
import { inspectCanonicalKnowledgeMetadata, type SchemaInspection } from "./investment-knowledge-schema";
import {companyIdentityResolver} from "./investment-routing-v2";
import {analysisAsOfMs,normalizeAsOf,readContextVersion,selectedLines,createContextManifest,sha256,contextDeclaredMetadata,type ContextManifest} from "./context-provenance";

export type Focus = "earnings" | "broker" | "tam" | "macro" | "thesis" | "general";
export type Role = "rules" | "thesis" | "evidence_register" | "timeline" | "company" | "industry" | "source" | "research" | "archive";
export interface Input { question: string; issuers?: string[]; industry?: string; focus?: Focus; maxNotes?: number; maxChars?: number; asOf?:string }
export interface Item { path: string; role: Role; declaredVerification: string|null; declaredEventDate: string|null; declaredPublishedAt: string|null; declaredAnalysisAsOf?:string|null; declaredComparatorEligible?:boolean|null; score: number; excerpt: string; line: number; truncated: boolean; counterEvidenceExcerptIncluded: boolean; schemaCompatibility: SchemaInspection; provenanceSummary:ReturnType<typeof contextDeclaredMetadata>["provenanceSummary"] }
export interface AnalyticalComparator { issuer:string;status:"selected"|"hold";path:string|null;eventDate:string|null;analysisAsOf:string|null;reason:string }
export interface Pack { status: "retrieval_only_not_verified"; question: string; issuers: string[]; focus: Focus; industry: string|null; items: Item[]; considered: number; selected: number; excerptChars: number; incomplete: string[]; omitted: string[]; warnings: string[];
  analyticalComparators:AnalyticalComparator[];
  manifest:ContextManifest;entityResolution:{requested:string;canonical:string;path:string|null;resolution:string}[];
  decisions:{path:string|null;decision:string;reason:string;score?:number}[];discoveryTruncated:boolean }

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
    // An explicit canonical Review subject outranks incidental legacy company
    // tags. In particular, NET INCOME is not a second covered company.
    const canonical=file.match(/^Investment Review - ([A-Z][A-Z0-9.]{0,11}) - /)?.[1]??
      file.match(/^\d{4}-\d{2}-\d{2} - ([A-Z][A-Z0-9.]{0,11})\s+[—–-]\s+/)?.[1];
    if(canonical)return [canonical];
    // Archived company research declares its primary company in frontmatter.
    // A title like "CrowdStrike × CLEAR" otherwise returns CLEAR as the first
    // all-caps token and incorrectly excludes the CRWD research event.
    const indexed=db().prepare("SELECT frontmatter FROM notes WHERE path=?").get(path) as
      {frontmatter:string|null}|undefined;
    if(indexed?.frontmatter){
      try {
        const fm=JSON.parse(indexed.frontmatter) as Record<string,unknown>;
        const explicit=[fm.entity,fm.ticker].flatMap(x=>Array.isArray(x)?x:[x])
          .filter((x):x is string=>typeof x==="string"&&/^[A-Z][A-Z0-9.-]{0,11}$/.test(x));
        if(explicit.length)return [...new Set(explicit)];
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
const STOP_SCOPE = new Set(["AND","THE","WITH","FROM","FOR","MARKET","MARKETS","MACRO","ECONOMY","ECONOMIC","INDUSTRY","GLOBAL","FINANCIAL","COMPANY","RESEARCH","STOCK","EQUITY","AND"]);
function topicTerms(s: string): string[] { return terms(s).filter(t=>!STOP_SCOPE.has(t)); }
function issuerTokenInTitle(path: string, issuers: string[]) {
  const name=path.split("/").at(-1)?.toUpperCase()??"";
  return issuers.some(t=>name.split(/[^A-Z0-9]+/).includes(t));
}
// When user asks about a *country*, a casual mention in a Japan/US
// headline is not sufficient relevance for a country-specific macro brief.
// Retain topic-named notes and explicit country-tagged metadata; broader
// regional documents require separate query/review rather than silent mixing.
function explicitMacroScope(path: string, topic: string): boolean {
  const title=(path.split("/").at(-1)||"").normalize("NFC").toUpperCase();
  const t=topic.normalize("NFC").toUpperCase();
  const isBoundary=(c:string|undefined)=>!c||!/[\p{L}\p{N}]/u.test(c);
  for(let at=title.indexOf(t);at>=0;at=title.indexOf(t,at+1)){
    if(isBoundary(title[at-1])&&isBoundary(title[at+t.length]))return true;
  }
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path = ?").get(path) as {frontmatter:string|null}|undefined;
  if(!row?.frontmatter)return false;
  try {
    const fm=JSON.parse(row.frontmatter) as Record<string,unknown>;
    const fields=[fm.country,fm.entity,fm.geography,fm.region].flatMap(x=>Array.isArray(x)?x:[x]);
    return fields.some(x=>typeof x==="string"&&x.trim().normalize("NFC").toUpperCase()===t);
  }catch{return false;}
}
function hasDeclaredMacroPrimary(path:string):boolean {
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path = ?").get(path) as {frontmatter:string|null}|undefined;
  if(!row?.frontmatter)return false;
  try {
    const fm=JSON.parse(row.frontmatter) as Record<string,unknown>;
    const tier=(typeof fm.source_type==="string"?fm.source_type:typeof fm.source_tier==="string"?fm.source_tier:"").toLowerCase();
    const source=[fm.original_source,fm.primary_url,fm.source_url].find(x=>typeof x==="string"&&/^https:\/\//.test(x));
    return tier==="primary"&&typeof source==="string";
  }catch{return false;}
}
function exists(path: string): boolean {
  try { return fs.existsSync(resolveNotePath(path)); } catch { return false; }
}

function declared(raw: string, notePath: string) {
  const f = splitFrontmatter(raw).data as Record<string,unknown>;
  return { ...contextDeclaredMetadata(f),schemaCompatibility: inspectCanonicalKnowledgeMetadata(notePath,f) };
}
export function buildInvestmentContextPack(req: Input): Pack {
  const question = req.question.trim().slice(0,1200);
  if (question.length<3) throw new Error("Question must contain at least 3 characters");
  const retrievalStartedAt=new Date().toISOString(),asOf=normalizeAsOf(req.asOf,retrievalStartedAt);
  const versions=new Map<string,ReturnType<typeof readContextVersion>>();
  const exclusions=new Map<string,string>();
  const version=(path:string)=>{
    if(versions.has(path))return versions.get(path)!;
    if(exclusions.has(path))throw Error(exclusions.get(path));
    try{const v=readContextVersion(path,asOf);versions.set(path,v);return v;}
    catch(e){exclusions.set(path,e instanceof Error?e.message:"unreadable");throw e;}
  };
  const eligible=(path:string)=>{try{version(path);return true;}catch{return false;}};
  const resolve=companyIdentityResolver(eligible,path=>JSON.stringify(version(path).fm));
  // Infer only an exact whole-query Hub/alias, never all-caps source prose.
  const exactQuery=!req.issuers?.length?resolve(question):null;
  const requested=req.issuers?.length?req.issuers:exactQuery?[question]:[];
  const entityResolution=requested.map(name=>{
    const found=resolve(name);
    if(found)return found;
    const canonical=name.trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9.-]{0,11}$/.test(canonical))throw Error("Unsupported or unresolved company identifier: "+name);
    return {requested:name,canonical,path:null,resolution:"unresolved_exact_identifier"};
  });
  const issuers=[...new Set(entityResolution.map(x=>x.canonical))].slice(0,6);
  const canonicalName=(name:string)=>resolve(name)?.canonical??name.toUpperCase();
  const named=(path:string)=>namedIssuers(path).map(canonicalName);
  const focus = req.focus||"general";
  const maxNotes = Math.min(16,Math.max(5,req.maxNotes??11));
  const budget = Math.min(18000,Math.max(4500,req.maxChars??12000));
  const pool = new Map<string,number>();
  const decisions:Pack["decisions"]=[];
  let discoveryTruncated=false;
  const add=(path:string,score:number)=>{
    if(pool.has(path))pool.set(path,Math.max(pool.get(path)!,score));
    else if(pool.size<240)pool.set(path,score);
    else discoveryTruncated=true;
  };
  const macroScope = issuers.length===0 && focus==="macro";
  // Country/topic-only questions do not inherit company-thesis obligations.
  // Prefer the explicitly supplied scope over incidental query terms.
  const primaryTopic=topicTerms(req.industry||question)[0]??null;
  const needed = [
    "10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md",
    ...(issuers.length?["08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md"]:[]),
    ...issuers.flatMap(t=>[
      "01_Companies/"+t+".md",
      "08_Daily_Weekly/Research Indexes/Company Evolution - "+t+".md",
      "05_Thesis/"+t+" - Current Thesis.md",
      "05_Thesis/"+t+" - Evidence Register.md",
    ]),
  ];
  const absent: string[] = [];
  for (const p of needed) { if (exists(p)) add(p,120); else absent.push(p); }

  // Comparator eligibility is opt-in; economic event_date is independent of
  // the whole Review's analytical knowledge horizon. Legacy/partial metadata
  // excludes that candidate only, never a valid current baseline beside it.
  const latestCanonicalReviews=new Map<string,string>();
  const analyticalComparators:AnalyticalComparator[]=[];
  const comparatorWarnings:string[]=[];
  for(const ticker of issuers){
    const prefix="10_Knowledge/Company Research/Investment Review - "+ticker+" - ";
    const rows=db().prepare(
      "SELECT path FROM notes WHERE substr(path,1,?)=? ORDER BY path LIMIT 241"
    ).all(prefix.length,prefix) as {path:string}[];
    const comparator:AnalyticalComparator={issuer:ticker,status:"hold",path:null,eventDate:null,analysisAsOf:null,reason:"no_valid_analytical_comparator"};
    analyticalComparators.push(comparator);
    if(rows.length>240){discoveryTruncated=true;comparator.reason="bounded_comparator_scan_incomplete";continue;}
    const dated:{path:string;analysisAsOf:string;at:number;eventDate:string|null}[]=[];
    let metadataGaps=0;
    for(const row of rows){
      // RET-02 also checks analysis_as_of as availability; a future Review's
      // filename/content must not enter ordinary historical context either.
      if(!exists(row.path)||!eligible(row.path))continue;
      const fm=version(row.path).fm;
      if(fm.type!=="investment_research_review")continue;
      const at=analysisAsOfMs(fm.analysis_as_of);
      const reason=fm.comparator_eligible===false?"explicitly_comparator_ineligible":
        fm.comparator_eligible!==true?"comparator_eligibility_not_declared_or_invalid":
        at===null?"missing_or_invalid_analysis_as_of":null;
      if(reason){
        if(reason!=="explicitly_comparator_ineligible")metadataGaps++;
        decisions.push({path:row.path,decision:"comparator_excluded",reason});
        continue;
      }
      dated.push({path:row.path,analysisAsOf:fm.analysis_as_of as string,at:at!,
        eventDate:contextDeclaredMetadata(fm).declaredEventDate});
    }
    if(metadataGaps)comparatorWarnings.push(`Canonical comparator metadata incomplete for ${ticker}: ${metadataGaps} readable Review(s) lack explicit eligibility or valid analysis_as_of. They remain historical context and do not disable valid comparators.`);
    if(!dated.length)continue;
    dated.sort((a,b)=>b.at-a.at||a.path.localeCompare(b.path));
    if(dated[1]?.at===dated[0].at){comparator.reason="ambiguous_latest_analysis_as_of";continue;}
    Object.assign(comparator,{status:"selected",path:dated[0].path,eventDate:dated[0].eventDate,
      analysisAsOf:dated[0].analysisAsOf,reason:"latest_eligible_analysis_as_of"});
    latestCanonicalReviews.set(ticker,dated[0].path);
    add(dated[0].path,220);
  }
  // Historical Company indexes exist in two legacy locations. Neither is a
  // current/approved Thesis, but both provide routes back to dated prior
  // conversations. A missing newer index must not hide the older one or be
  // reported as missing when the other location is present.
  for (const ticker of issuers) {
    const candidates=[
      "08_Daily_Weekly/Research Indexes/Company - "+ticker+".md",
      "10_Knowledge/Indexes/Company - "+ticker+".md"
    ];
    const present=candidates.filter(exists);
    if(present.length) for(const p of present)add(p,120);
    else absent.push("No legacy Company Index found for "+ticker+" (both known locations checked).");
  }
  const linkedIndustryPaths=new Set<string>();
  // Retrieve existing, explicitly resolved Industry Hubs linked from the
  // issuer's canonical Timeline. A generic earnings query may contain no
  // industry search term, but the company already has a curator-reviewed
  // cross-link. Trust only the indexed exact resolved_path (not co-mentions).
  // If the caller explicitly provided industry scope, respect that choice.
  if(issuers.length && !req.industry){
    for(const ticker of issuers){
      const timeline="08_Daily_Weekly/Research Indexes/Company Evolution - "+ticker+".md";
      if(!exists(timeline)||asOf&&!eligible(timeline))continue;
      const rows=db().prepare(
        "SELECT DISTINCT target,resolved_path FROM links WHERE source_path=? AND resolved_path LIKE ? ORDER BY resolved_path LIMIT 12"
      ).all(timeline,"02_Industries_Themes/%.md") as {target:string;resolved_path:string|null}[];
      const actualLinks=asOf?new Set(extractStructure(version(timeline).content).links):null;
      for(const row of rows){
        if(actualLinks&&!actualLinks.has(row.target))continue;
        const target=row.resolved_path;
        if(target && target.startsWith("02_Industries_Themes/") &&
           roleOf(target)==="industry" && exists(target)){
          add(target,116);
          linkedIndustryPaths.add(target);
        }
      }
    }
  }
  // Explicit issuer-source discovery: a broad "NVDA" lexical query can be
  // flooded by archived chat and miss the actual issuer IR reviews. Never
  // let search-result popularity determine whether primary documents exist.
  for (const ticker of issuers) {
    const prefix = "08_Daily_Weekly/Research Indexes/Primary Evidence - "+ticker+" ";
    const matches = db().prepare("SELECT path FROM notes WHERE substr(path,1,?)=? ORDER BY path DESC LIMIT 12")
      .all(prefix.length,prefix) as {path:string}[];
    for (const note of matches) if(exists(note.path)) add(note.path,115);
  }
  const subjectTerms=topicTerms(question.replace(/[-_]/g," ")).filter(t=>t.length>=4 && !/^[0-9]/.test(t) &&
    !issuers.map(x=>x.toUpperCase()).includes(t) && !/^(?:HISTORICAL|ARCHIVE|RE-INGEST|UPDATE|LATEST|NEW|EVENT|TEST|VERIFY|SOURCE|CLAIM|NEWS|RESEARCH)$/.test(t));
  const titleMatches=(path:string)=>{
    const titleWords=new Set((path.split("/").at(-1)??"").toUpperCase().split(/[^\p{L}\p{N}]+/u));
    return subjectTerms.filter(t=>titleWords.has(t));
  };
  const searchTerms = [...new Set([...issuers,...topicTerms(req.industry||""),...terms(question)])].slice(0,12);
  const failed: string[] = [];
  const macroSubjectPaths = new Set<string>();
  if(macroScope && primaryTopic){
    const subject=topicTerms(question).filter(x=>x!==primaryTopic && x.length>=3)
      .filter(x=>!/^(?:WHAT|IS|ARE|THE|HOW|FOR|LATEST|OFFICIAL|THIRD|QUARTER|POLICY|2026|AND|MARKETS)$/.test(x)).slice(0,5);
    for(const word of subject){
      try{
        const page=searchVault(primaryTopic+" "+word,{limit:100});if(page.total>100)discoveryTruncated=true;
        for(const h of page.hits)
          if(explicitMacroScope(h.path,primaryTopic))macroSubjectPaths.add(h.path);
      }catch{failed.push(primaryTopic+" "+word);}
    }
    // Direct indexed filename discovery avoids losing relevant country-titled
    // macro notes to the FTS relevance cutoff of the first 30 chat articles.
    const candidatePaths=db().prepare("SELECT path FROM notes WHERE instr(upper(path),?)>0 ORDER BY path DESC LIMIT 150")
      .all(primaryTopic) as {path:string}[];
    for(const r of candidatePaths){
      if((r.path.startsWith("10_Knowledge/Macro and Markets/")||r.path.startsWith("02_Industries_Themes/"))&&
         explicitMacroScope(r.path,primaryTopic) && exists(r.path))
        add(r.path,macroSubjectPaths.has(r.path)?60:22);
    }
  }
  const industryMatches = new Set<string>();
  if(issuers.length && req.industry){
    for(const topic of topicTerms(req.industry).slice(0,5)){
      try{const page=searchVault(topic,{limit:100});if(page.total>100)discoveryTruncated=true;
        for(const hit of page.hits)industryMatches.add(hit.path);}
      catch{failed.push(topic);}
    }
  }
  // A bounded title/metadata pass complements FTS. Scope and subject relevance
  // are evaluated BEFORE its cap, so unrelated high-frequency hits cannot
  // suppress an explicitly subject-named Review. No issuer/note special case.
  if(issuers.length&&subjectTerms.length){
    const prefix="10_Knowledge/Company Research/";
    const indexed=db().prepare("SELECT path FROM notes WHERE substr(path,1,?)=? ORDER BY path LIMIT 3001")
      .all(prefix.length,prefix) as {path:string}[];
    if(indexed.length>3000)discoveryTruncated=true;
    const scoped=indexed.slice(0,3000).filter(r=>named(r.path).some(x=>issuers.includes(x))&&(!req.industry||industryMatches.has(r.path)))
      .map(r=>({...r,hits:titleMatches(r.path).length})).filter(r=>r.hits>0)
      .sort((a,b)=>b.hits-a.hits||a.path.localeCompare(b.path));
    if(scoped.length>80)discoveryTruncated=true;
    for(const r of scoped.slice(0,80))add(r.path,80);
  }
  // A generic term such as "earnings" must not quietly pull another issuer's
  // news into a company-specific pack. First discover exact issuer matches.
  const issuerPaths = new Set<string>();
  for (const ticker of issuers) {
    try {
      const page=searchVault(ticker,{limit:100});if(page.total>100)discoveryTruncated=true;
      for (const h of page.hits) issuerPaths.add(h.path);
    } catch { failed.push(ticker); }
  }
  for (const term of searchTerms) {
    try {
      const page=searchVault(term,{limit:30});if(page.total>30)discoveryTruncated=true;
      for (const [i,h] of page.hits.entries()) {
        const role=roleOf(h.path);
        const scopedIssuerNames=named(h.path);
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
          if(!primaryTopic || !explicitMacroScope(h.path,primaryTopic))continue;
          if(role==="company"||role==="thesis"||role==="evidence_register"||
            (role==="timeline" && scopedIssuerNames.length>0)||
            h.path.startsWith("10_Knowledge/Company Research/"))continue;
        }
        add(h.path,30-i);
      }
    } catch { failed.push(term); }
  }
  // Promote same-event research whose headline contains the user's specific
  // subject (e.g. CrowdStrike + CLEAR), not older ticker-only summaries.
  // The ranking is a discovery hint, never a deduplication or source verdict.
  const rank = [...pool].filter(([path])=>{
    if(eligible(path))return true;
    // Excluded future filenames/snippets are themselves potential leakage.
    decisions.push({path:asOf?null:path,decision:"excluded",reason:asOf?"cutoff_or_unverifiable_current_version":"unreadable_current_version"});
    return false;
  }).map(([path,boost])=>{
    const role=roleOf(path);
    const companyBonus=issuerTokenInTitle(path,issuers)?22:0;
    const eventTitleMatches=titleMatches(path).length;
    const specificEventBonus=issuers.length && role==="research"
      ? Math.min(3,eventTitleMatches)*35:0;
    const macroBonus=macroScope && primaryTopic ?
      (explicitMacroScope(path,primaryTopic)?25:0) +
      (path.startsWith("10_Knowledge/Macro and Markets/")?25:0) +
      (macroSubjectPaths.has(path)?32:0) +
      // Ranking priority only: this note DECLARES a primary original URL.
      // It is not an independent or fresh verification of the claim.
      (hasDeclaredMacroPrimary(path)?65:0):0;
    const focusBonus=focus==="tam"&&/TAM|Industries|Concepts/.test(path)?20:
      focus==="broker"&&/Broker|Evolution|Research/.test(path)?17:
      focus==="earnings"&&/Primary Evidence|Event_Lineage/.test(path)?20:0;
    return {path,role,score:base[role]+boost+companyBonus+focusBonus+macroBonus+specificEventBonus-(role==="archive"?45:0),
      reason:`role=${role}; discoveryBoost=${boost}; titleSubjectMatches=${eventTitleMatches}; companyBonus=${companyBonus}; focusBonus=${focusBonus}; subjectBonus=${specificEventBonus}`};
  }).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  const items: Item[] = [];
  // Archived chat excerpts are a last resort and may repeat one issuer event.
  // Prefer current Thesis, original-source review and company evolution unless
  // the question explicitly asks to inspect archival history.
  const archivalRequested=/archiv|chatgpt|historical|ประวัติแชต|ย้อนหลัง|แชตเก่า/i.test(question);
  const substantialNonArchives=rank.filter(r=>!["archive","rules","timeline"].includes(r.role)).length;
  const allowArchived=archivalRequested||substantialNonArchives<2;
  const roleCounts=new Map<Role,number>();
  let remaining=budget;
  const omitted: string[]=[];
  for (const row of rank) {
    const omit=(reason:string)=>{omitted.push(row.path);decisions.push({path:row.path,decision:"omitted",reason,score:row.score});};
    if (row.role==="archive" && !allowArchived) {omit("archive_fallback_not_needed");continue;}
    if (items.length>=maxNotes) {omit("maxNotes");continue;}
    if (remaining<250) {omit("maxChars");continue;}
    const n=roleCounts.get(row.role)||0;
    const mandatoryLatestReview=[...latestCanonicalReviews.values()].includes(row.path);
    if(!mandatoryLatestReview&&n>=(quota[row.role]??4)){omit("role_quota:"+row.role);continue;}
    try {
      const raw=version(row.path).content;
      const excerpt=selectedLines(raw,searchTerms,Math.min(2000,remaining),row.role);
      if(!excerpt.excerpt.trim())continue;
      items.push({path:row.path,role:row.role,...declared(raw,row.path),score:row.score,...excerpt});
      decisions.push({path:row.path,decision:"selected",reason:row.reason,score:row.score});
      roleCounts.set(row.role,n+1);remaining-=excerpt.excerpt.length;
    } catch {omit("read_failed");}
  }
  const roles=new Set(items.map(x=>x.role));
  const incomplete=[...absent];
  for(const comparator of analyticalComparators){
    if(comparator.status==="selected"&&!items.some(x=>x.path===comparator.path)){
      comparator.status="hold";comparator.path=null;comparator.eventDate=null;comparator.analysisAsOf=null;comparator.reason="comparator_excluded_by_context_budget";
    }
    if(comparator.status==="hold")incomplete.push("Analytical comparator HOLD for "+comparator.issuer+": "+comparator.reason+"; eligible analytical chronology must be explicit and uniquely latest, never inferred from event/import/mtime.");
  }
  if(issuers.length){
    if(!roles.has("thesis"))incomplete.push("No Current Thesis selected; owner-endorsed thesis is unknown.");
    if(!roles.has("evidence_register"))incomplete.push("No Evidence Register selected; prior claims may be missing.");
    if(!roles.has("source"))incomplete.push("No original issuer/filing source selected; primary claim verification required.");
    if(!roles.has("industry"))incomplete.push("No industry/TAM source selected; supply-chain effects may be incomplete.");
  }else if(macroScope){
    if(!items.some(x=>x.role!=="rules" && x.role!=="timeline"))
      incomplete.push("No country/theme-specific macro evidence selected; research coverage is incomplete.");
    if(!items.some(x=>hasDeclaredMacroPrimary(x.path)))
      incomplete.push("No source-declared primary macro/statistical evidence selected; verify the official data release before analysis.");
  }
  if(failed.length)incomplete.push("Search failed on terms: "+failed.join(", "));
  if(discoveryTruncated)incomplete.push("Candidate discovery hit a bounded search/index cap; omitted candidates may exist outside the inspected set.");
  const warnings=[
      "Bounded FTS5 lexical discovery, not semantic recall or full Vault coverage. Missing/omitted notes may contain counter-evidence.",
      asOf?"Cutoff uses current filesystem version (including ctime) and declared availability. Future/unverifiable versions are excluded without exposing their filenames. It cannot reconstruct earlier bytes or authenticate historical clocks.":
        "No as-of/knowledge-cutoff filter is applied. Manifest hashes/excerpts describe this observation, not a durable full-note archive.",
      "Verification fields are note-declared metadata, NOT freshly reverified primary facts. File modified time is NOT event date.",
      "Analytical comparators require comparator_eligible=true and a unique latest valid analysis_as_of. Economic event_date may be null and is never used to rank analytical knowledge. Legacy/incomplete notes remain historical context; declarations are not approval.",
      ...comparatorWarnings,
      ...incomplete.filter(x=>x.startsWith("Analytical comparator HOLD")),
      "An archived AI repost is not independent corroboration; deduplicate issuer+source+metric+fiscal period.",
      "Use full original notes and current external filings/consensus for investment decisions. This tool is read-only.",
      "Contradiction/risk sections are discoverability hints, not exhaustive counter-evidence verification. Original context must be read in full where material.",
      "Manifest retains exact excerpts and current-byte hashes; note-declared versions and producer/policy assertions are not authenticated. Date-only availability is conservatively end-of-day UTC."
    ];
  for(const item of items){
    const fm=version(item.path).fm,primary=named(item.path);
    const tags=(Array.isArray(fm.company)?fm.company:[fm.company]).filter((x):x is string=>typeof x==="string");
    if(primary.length&&tags.some(x=>!primary.includes(canonicalName(x))))
      warnings.push("entity_metadata_disagrees_with_primary_subject: "+item.path+"; incidental legacy company tags were not used as primary issuer identity.");
  }
  const retrievedAt=new Date().toISOString();
  if(retrievedAt<retrievalStartedAt)throw Error("Clock moved backwards during context retrieval");
  const manifest=createContextManifest({format:"ios-context-manifest/1",retrievalStartedAt,retrievedAt,asOf,method:"bounded_fts5_and_subject_index",
    query:{question,issuers,focus,industry:req.industry?.slice(0,140)||null,maxNotes,maxChars:budget},selectionTerms:searchTerms,
    entityBindings:entityResolution.map(binding=>({...binding,
      contentSha256:binding.path?version(binding.path).contentSha256:null,
      fileVersionAt:binding.path?version(binding.path).fileVersionAt:null,observedAt:retrievedAt})),
    entries:items.map(item=>{const v=version(item.path);return {path:item.path,identity:typeof v.fm.intake_id==="string"?v.fm.intake_id:item.path,
      role:item.role,metadata:contextDeclaredMetadata(v.fm),contentSha256:v.contentSha256,excerptSha256:sha256(item.excerpt),bytes:v.bytes,
      fileVersionAt:v.fileVersionAt,declaredAvailabilityAt:v.declaredAvailabilityAt,observedAt:retrievedAt,
      excerptBase64:Buffer.from(item.excerpt).toString("base64"),line:item.line,truncated:item.truncated};}),
    coverage:{considered:pool.size,selected:items.length,excerptChars:budget-remaining,candidateLimit:240,discoveryTruncated},
    limitations:warnings});
  return {
    status:"retrieval_only_not_verified",question,issuers,focus,industry:req.industry?.slice(0,140)||null,
    items,considered:pool.size,selected:items.length,excerptChars:budget-remaining,
    incomplete,omitted:omitted.slice(0,15),warnings,manifest,entityResolution,decisions,discoveryTruncated,analyticalComparators
  };
}

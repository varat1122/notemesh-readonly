import fs from "node:fs";
import { searchVault } from "./queries";
import { db } from "../db";
import { readNote } from "./notes";
import { resolveNotePath } from "./paths";
import { splitFrontmatter } from "./markdown";
import { inspectCanonicalKnowledgeMetadata, type SchemaInspection } from "./investment-knowledge-schema";

export type Focus = "earnings" | "broker" | "tam" | "macro" | "thesis" | "general";
export type Role = "rules" | "thesis" | "evidence_register" | "timeline" | "company" | "industry" | "source" | "analysis" | "capture" | "research" | "archive";
export interface Input { question: string; issuers?: string[]; industry?: string; focus?: Focus; maxNotes?: number; maxChars?: number }
export interface Item { path: string; role: Role; declaredVerification: string|null; declaredSourceType: string|null; declaredIndependentEvidence: boolean|null; declaredEventKey: string|null; declaredEventDate: string|null; declaredPublishedAt: string|null; score: number; excerpt: string; line: number; truncated: boolean; counterEvidenceExcerptIncluded: boolean; schemaCompatibility: SchemaInspection }
export interface Pack { status: "retrieval_only_not_verified"; question: string; issuers: string[]; focus: Focus; industry: string|null; items: Item[]; considered: number; selected: number; excerptChars: number; incomplete: string[]; omitted: string[]; warnings: string[] }

export function roleOf(path: string): Role {
  if (path.includes("Evidence and Update Rules")) return "rules";
  if (/^05_Thesis\/.*Current Thesis/i.test(path)) return "thesis";
  if (/^05_Thesis\/.*Evidence Register/i.test(path)) return "evidence_register";
  if (path.startsWith("08_Daily_Weekly/Research Indexes/Investment Review - ")) return "analysis";
  if (/Company Evolution - |00_Investment_Evolution_Master/.test(path)) return "timeline";
  if (path.startsWith("01_Companies/")) return "company";
  if (/^02_Industries_Themes\/|^03_Concepts\/|TAM_Vintage|Economic_Transmission/.test(path)) return "industry";
  if (/Primary Evidence - |07_Sources\/Company Filings\/|07_Sources\/Earnings\//.test(path)) return "source";
  if(path.startsWith("07_Sources/ChatGPT/")){
    const m=indexedNoteMeta(path);
    // This is the saved user submission, not a verified company filing.
    if(m?.type==="research_note" && m?.source_type==="user_supplied" &&
      typeof m.entity==="string")return "capture";
    return "archive";
  }
  return "research";
}
const base: Record<Role, number> = { rules: 40, thesis: 100, evidence_register: 95, timeline: 85, company: 65, industry: 65, source: 87, analysis: 45, capture: 24, research: 35, archive: 8 };
const quota: Partial<Record<Role, number>> = { rules: 1, thesis: 2, evidence_register: 2, timeline: 3, company: 3, industry: 3, source: 4, analysis: 2, capture: 2, archive: 1 };
function terms(s: string): string[] {
  return [...new Set((s.match(/[\p{L}\p{N}][\p{L}\p{N}_.-]{1,35}/gu) || []).map(x=>x.toUpperCase()))].slice(0,10);
}
// Scope the candidate set before ranking. A ticker mentioned as a broker
// in somebody else's research is not evidence about the issuer's business.
function namedIssuers(path: string): string[] {
  const file=path.split("/").at(-1)??"";
  if(path.startsWith("01_Companies/")){const t=file.match(/^([A-Z][A-Z0-9.-]{0,11})\.md$/)?.[1];return t?[t]:[];}
  if(path.startsWith("05_Thesis/")){const t=file.match(/^([A-Z][A-Z0-9.-]{0,11}) - (?:Current Thesis|Evidence Register)/)?.[1];return t?[t]:[];}
  const structured=file.match(/^(?:Company Evolution - |Company - |Primary Evidence - |Investment Review - )([A-Z][A-Z0-9.-]{0,11})(?:\s|\.md)/)?.[1];
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
function indexedNoteMeta(path:string):Record<string,unknown>|null{
  const row=db().prepare("SELECT frontmatter FROM notes WHERE path=?")
    .get(path) as {frontmatter:string|null}|undefined;
  if(!row?.frontmatter)return null;
  try{
    const v=JSON.parse(row.frontmatter) as Record<string,unknown>;
    return v && typeof v==="object"&&!Array.isArray(v)?v:null;
  }catch{return null;}
}
function historicalAIReview(path:string,issuer:string|null=null):boolean{
  if(!path.startsWith("08_Daily_Weekly/Research Indexes/Investment Review - "))return false;
  const m=indexedNoteMeta(path);
  return !!m && m.type==="investment_review" && typeof m.entity==="string" &&
    (!issuer || m.entity.toUpperCase()===issuer) &&
    m.source_type==="archived_ai" && m.independent_evidence===false &&
    ["unverified","not_reverified"].includes(String(m.verification)) &&
    typeof m.analysis_origin==="string" && m.analysis_origin.length>0 && m.status==="draft";
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
  // Anchor contradictory evidence even when the highest lexical match is in
  // a note's introduction. Source line labels prevent disjoint snippets from
  // appearing to be one continuous quotation.
  if ((role==="thesis" || role==="evidence_register" || role==="source" || role==="research") && max>=700) {
    const counter = lines.findIndex((s,i) => i < 1200 &&
      /^\s*#{1,6}\s+.*(counter[- ]?evidence|contradict|invalidation|ข้อขัดแย้ง|ข้อโต้แย้ง|ความเสี่ยง)/i.test(s));
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
    counterEvidenceExcerptIncluded,
  };
}
function dateOf(v: unknown) { return typeof v==="string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null; }
function declared(raw: string, notePath: string) {
  const f = splitFrontmatter(raw).data as Record<string,unknown>;
  return { declaredVerification:typeof f.verification==="string"?f.verification:null,
    declaredSourceType:typeof f.source_type==="string"?f.source_type:null,
    declaredIndependentEvidence:typeof f.independent_evidence==="boolean"?f.independent_evidence:null,
    declaredEventKey:typeof f.event_key==="string"?f.event_key:null, declaredEventDate:dateOf(f.event_date), declaredPublishedAt:dateOf(f.published_at), schemaCompatibility: inspectCanonicalKnowledgeMetadata(notePath,f) };
}
export function buildInvestmentContextPack(req: Input): Pack {
  const question = req.question.trim().slice(0,1200);
  if (question.length<3) throw new Error("Question must contain at least 3 characters");
  const issuers = [...new Set((req.issuers||[]).map(s=>s.trim().toUpperCase()).filter(t=>/^[A-Z][A-Z0-9.-]{0,11}$/.test(t)))].slice(0,6);
  const focus = req.focus||"general";
  const maxNotes = Math.min(16,Math.max(5,req.maxNotes??11));
  const budget = Math.min(18000,Math.max(4500,req.maxChars??12000));
  const pool = new Map<string,number>();
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
  for (const p of needed) { if (exists(p)) pool.set(p,120); else absent.push(p); }
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
    for(const ticker of issuers){
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
  for (const ticker of issuers) {
    const prefix = "08_Daily_Weekly/Research Indexes/Primary Evidence - "+ticker+" ";
    const matches = db().prepare("SELECT path FROM notes WHERE substr(path,1,?)=? ORDER BY path DESC LIMIT 12")
      .all(prefix.length,prefix) as {path:string}[];
    for (const note of matches) if(exists(note.path)) pool.set(note.path,115);
  }
  // Discover the newest issuer-scoped saved Analysis even when a new
  // question has no lexical overlap with its old causal hypotheses.
  for(const ticker of issuers){
    const prefix="08_Daily_Weekly/Research Indexes/Investment Review - "+ticker+" - ";
    const rows=db().prepare(`SELECT path FROM notes
      WHERE substr(path,1,?)=? ORDER BY COALESCE(modified,mtime) DESC, path DESC LIMIT 20`)
      .all(prefix.length,prefix) as {path:string}[];
    let found=0;
    for(const row of rows){
      if(!historicalAIReview(row.path,ticker)||!exists(row.path))continue;
      pool.set(row.path,Math.max(pool.get(row.path)||0,75-found*5));
      if(++found>=2)break;
    }
  }
  const searchTerms = [...new Set([...issuers,...topicTerms(req.industry||""),...terms(question)])].slice(0,12);
  const failed: string[] = [];
  const macroSubjectPaths = new Set<string>();
  if(macroScope && primaryTopic){
    const subject=topicTerms(question).filter(x=>x!==primaryTopic && x.length>=3)
      .filter(x=>!/^(?:WHAT|IS|ARE|THE|HOW|FOR|LATEST|OFFICIAL|THIRD|QUARTER|POLICY|2026|AND|MARKETS)$/.test(x)).slice(0,5);
    for(const word of subject){
      try{
        for(const h of searchVault(primaryTopic+" "+word,{limit:100}).hits)
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
        pool.set(r.path,Math.max(pool.get(r.path)||0,macroSubjectPaths.has(r.path)?60:22));
    }
  }
  const industryMatches = new Set<string>();
  if(issuers.length && req.industry){
    for(const topic of topicTerms(req.industry).slice(0,5)){
      try{for(const hit of searchVault(topic,{limit:100}).hits)industryMatches.add(hit.path);}
      catch{failed.push(topic);}
    }
  }
  // A generic term such as "earnings" must not quietly pull another issuer's
  // news into a company-specific pack. First discover exact issuer matches.
  const issuerPaths = new Set<string>();
  for (const ticker of issuers) {
    try {
      for (const h of searchVault(ticker,{limit:100}).hits) issuerPaths.add(h.path);
    } catch { failed.push(ticker); }
  }
  for (const term of searchTerms) {
    try {
      for (const [i,h] of searchVault(term,{limit:30}).hits.entries()) {
        const role=roleOf(h.path);
        const scopedIssuerNames=namedIssuers(h.path);
        if(issuers.length && scopedIssuerNames.length &&
          !scopedIssuerNames.some(t=>issuers.includes(t)))continue;
        if(role==="capture" && issuers.length &&
          !issuers.includes(String(indexedNoteMeta(h.path)?.entity??"").toUpperCase()))continue;
        if(role==="analysis" && !historicalAIReview(h.path,
          issuers.length===1?issuers[0]:null))continue;
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
        pool.set(h.path,Math.max(pool.get(h.path)||0, 30-i));
        if (pool.size>200) break;
      }
    } catch { failed.push(term); }
  }
  // Promote same-event research whose headline contains the user's specific
  // subject (e.g. CrowdStrike + CLEAR), not older ticker-only summaries.
  // The ranking is a discovery hint, never a deduplication or source verdict.
  const subjectTerms=topicTerms(question).filter(t=>t.length>=4 && !/^[0-9]/.test(t) &&
    !issuers.includes(t) && !/^(?:HISTORICAL|ARCHIVE|RE-INGEST|UPDATE|LATEST|NEW|EVENT|TEST|VERIFY|SOURCE|CLAIM|NEWS|RESEARCH)$/.test(t));
  const rank = [...pool].map(([path,boost])=>{
    const role=roleOf(path);
    const companyBonus=issuerTokenInTitle(path,issuers)?22:0;
    const title=(path.split("/").at(-1)??"").normalize("NFC").toUpperCase();
    const eventTitleMatches=subjectTerms.filter(term=>title.split(/[^\p{L}\p{N}]+/u).includes(term)).length;
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
    return {path,role,score:base[role]+boost+companyBonus+focusBonus+macroBonus+specificEventBonus-(role==="archive"?45:0)};
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
    if (row.role==="archive" && !allowArchived) {omitted.push(row.path);continue;}
    if (items.length>=maxNotes||remaining<250) {omitted.push(row.path);continue;}
    const n=roleCounts.get(row.role)||0;
    if(n>=(quota[row.role]??4)){omitted.push(row.path);continue;}
    try {
      const raw=readNote(row.path).content;
      const excerpt=selectedLines(raw,searchTerms,Math.min(2000,remaining),row.role);
      if(!excerpt.excerpt.trim())continue;
      if(row.role==="analysis" && !historicalAIReview(row.path,issuers.length===1?issuers[0]:null))continue;
      if(row.role==="capture" && issuers.length &&
        !issuers.includes(String(indexedNoteMeta(row.path)?.entity??"").toUpperCase()))continue;
      items.push({path:row.path,role:row.role,...declared(raw,row.path),score:row.score,...excerpt});
      roleCounts.set(row.role,n+1);remaining-=excerpt.excerpt.length;
    } catch {omitted.push(row.path);}
  }
  const roles=new Set(items.map(x=>x.role));
  const incomplete=[...absent];
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
  return {
    status:"retrieval_only_not_verified",question,issuers,focus,industry:req.industry?.slice(0,140)||null,
    items,considered:rank.length,selected:items.length,excerptChars:budget-remaining,
    incomplete,omitted:omitted.slice(0,15),
    warnings:[
      "Bounded FTS5 lexical discovery, not semantic recall or full Vault coverage. Missing/omitted notes may contain counter-evidence.",
      "Verification fields are note-declared metadata, NOT freshly reverified primary facts. File modified time is NOT event date.",
      "A saved Investment Review and archived AI repost are historical analysis, never independent issuer evidence; deduplicate issuer+source+metric+fiscal period.",
      "User-supplied source captures are records of supplied text, not authenticated primary issuer documents.",
      "Use full original notes and current external filings/consensus for investment decisions. This tool is read-only.",
      "Contradiction/risk sections are discoverability hints, not exhaustive counter-evidence verification. Original context must be read in full where material.",
    ]
  };
}

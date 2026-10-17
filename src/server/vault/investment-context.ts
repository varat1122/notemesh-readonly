import fs from "node:fs";
import { searchVault } from "./queries";
import { readNote } from "./notes";
import { resolveNotePath } from "./paths";
import { splitFrontmatter } from "./markdown";

export type Focus = "earnings" | "broker" | "tam" | "macro" | "thesis" | "general";
export type Role = "rules" | "thesis" | "evidence_register" | "timeline" | "company" | "industry" | "source" | "research" | "archive";
export interface Input { question: string; issuers?: string[]; industry?: string; focus?: Focus; maxNotes?: number; maxChars?: number }
export interface Item { path: string; role: Role; declaredVerification: string|null; declaredEventDate: string|null; declaredPublishedAt: string|null; score: number; excerpt: string; line: number; truncated: boolean }
export interface Pack { status: "retrieval_only_not_verified"; question: string; issuers: string[]; focus: Focus; industry: string|null; items: Item[]; considered: number; selected: number; excerptChars: number; incomplete: string[]; omitted: string[]; warnings: string[] }

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
function exists(path: string): boolean {
  try { return fs.existsSync(resolveNotePath(path)); } catch { return false; }
}
function selectedLines(raw: string, search: string[], max: number) {
  const lines = raw.split(/\r?\n/);
  let index = 0, maxHits = 0;
  for (let i = 0; i < Math.min(lines.length, 1200); i++) {
    const lower = lines[i].toLowerCase();
    const hits = search.filter(t => t.length > 1 && lower.includes(t.toLowerCase())).length;
    if (hits > maxHits) { index = i; maxHits = hits; }
  }
  const start = index > 15 ? Math.max(0, index-2) : 0;
  const full = lines.slice(start,start+22).join("\n");
  return { excerpt: full.slice(0,max), line: start+1, truncated: start>0 || start+22<lines.length || full.length>max };
}
function dateOf(v: unknown) { return typeof v==="string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null; }
function declared(raw: string) {
  const f = splitFrontmatter(raw).data as Record<string,unknown>;
  return { declaredVerification:typeof f.verification==="string"?f.verification:null, declaredEventDate:dateOf(f.event_date), declaredPublishedAt:dateOf(f.published_at) };
}
export function buildInvestmentContextPack(req: Input): Pack {
  const question = req.question.trim().slice(0,1200);
  if (question.length<3) throw new Error("Question must contain at least 3 characters");
  const issuers = [...new Set((req.issuers||[]).map(s=>s.trim().toUpperCase()).filter(t=>/^[A-Z][A-Z0-9.-]{0,11}$/.test(t)))].slice(0,6);
  const focus = req.focus||"general";
  const maxNotes = Math.min(16,Math.max(5,req.maxNotes??11));
  const budget = Math.min(18000,Math.max(4500,req.maxChars??12000));
  const pool = new Map<string,number>();
  const needed = [
    "10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md",
    "08_Daily_Weekly/Research Indexes/00_Investment_Evolution_Master.md",
    ...issuers.flatMap(t=>[
      "01_Companies/"+t+".md",
      "08_Daily_Weekly/Research Indexes/Company Evolution - "+t+".md",
      "08_Daily_Weekly/Research Indexes/Company - "+t+".md",
      "05_Thesis/"+t+" - Current Thesis.md",
      "05_Thesis/"+t+" - Evidence Register.md",
    ]),
  ];
  const absent: string[] = [];
  for (const p of needed) { if (exists(p)) pool.set(p,120); else absent.push(p); }
  const searchTerms = [...new Set([...issuers,...terms(question),...terms(req.industry||"")])].slice(0,10);
  const failed: string[] = [];
  for (const term of searchTerms) {
    try {
      for (const [i,h] of searchVault(term,{limit:30}).hits.entries()) {
        pool.set(h.path,Math.max(pool.get(h.path)||0, 30-i));
        if (pool.size>200) break;
      }
    } catch { failed.push(term); }
  }
  const rank = [...pool].map(([path,boost])=>{
    const role=roleOf(path), basename=path.split("/").at(-1)?.toUpperCase()||"";
    const companyBonus=issuers.some(t=>basename.includes(t))?22:0;
    const focusBonus=focus==="tam"&&/TAM|Industries|Concepts/.test(path)?20:
      focus==="broker"&&/Broker|Evolution|Research/.test(path)?17:
      focus==="earnings"&&/Primary Evidence|Event_Lineage/.test(path)?20:0;
    return {path,role,score:base[role]+boost+companyBonus+focusBonus-(role==="archive"?45:0)};
  }).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  const items: Item[] = [];
  const roleCounts=new Map<Role,number>();
  let remaining=budget;
  const omitted: string[]=[];
  for (const row of rank) {
    if (items.length>=maxNotes||remaining<250) {omitted.push(row.path);continue;}
    const n=roleCounts.get(row.role)||0;
    if(n>=(quota[row.role]??4)){omitted.push(row.path);continue;}
    try {
      const raw=readNote(row.path).content;
      const excerpt=selectedLines(raw,searchTerms,Math.min(2000,remaining));
      if(!excerpt.excerpt.trim())continue;
      items.push({path:row.path,role:row.role,...declared(raw),score:row.score,...excerpt});
      roleCounts.set(row.role,n+1);remaining-=excerpt.excerpt.length;
    } catch {omitted.push(row.path);}
  }
  const roles=new Set(items.map(x=>x.role));
  const incomplete=[...absent];
  if(!roles.has("thesis"))incomplete.push("No Current Thesis selected; owner-endorsed thesis is unknown.");
  if(!roles.has("evidence_register"))incomplete.push("No Evidence Register selected; prior claims may be missing.");
  if(!roles.has("source"))incomplete.push("No original issuer/filing source selected; primary claim verification required.");
  if(!roles.has("industry"))incomplete.push("No industry/TAM source selected; supply-chain effects may be incomplete.");
  if(failed.length)incomplete.push("Search failed on terms: "+failed.join(", "));
  return {
    status:"retrieval_only_not_verified",question,issuers,focus,industry:req.industry?.slice(0,140)||null,
    items,considered:rank.length,selected:items.length,excerptChars:budget-remaining,
    incomplete,omitted:omitted.slice(0,15),
    warnings:[
      "Bounded FTS5 lexical discovery, not semantic recall or full Vault coverage. Missing/omitted notes may contain counter-evidence.",
      "Verification fields are note-declared metadata, NOT freshly reverified primary facts. File modified time is NOT event date.",
      "An archived AI repost is not independent corroboration; deduplicate issuer+source+metric+fiscal period.",
      "Use full original notes and current external filings/consensus for investment decisions. This tool is read-only.",
    ]
  };
}

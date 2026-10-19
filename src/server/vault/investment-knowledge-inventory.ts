/**
 * Vault-wide read-only knowledge audit over the current SQLite index.
 * This is an index metadata survey, NOT primary-source re-verification,
 * semantic duplicate adjudication, or a migration.
 *
 * Bounded output: full indexed rows (up to 10k) are scanned, but only
 * aggregate counters and short, deterministic samples leave this function.
 */
import { db } from "../db";
import { indexer } from "./indexer";
import { inspectCanonicalKnowledgeMetadata } from "./investment-knowledge-schema";
import { planHistoricalLinkReview, type LinkReviewNote } from "./historical-link-review";

type FM = Record<string,unknown>;
type Row = {path:string;frontmatter:string|null};
const MAX_ROWS=10_000, MAX_SAMPLES=6, MAX_GROUPS=8;
const fieldNames=["type","source_type","verification","event_date","published_at",
  "received_at","imported_at","imported_on","date","entity","original_source",
  "source_url","claims","event_key","source_excerpt_sha256","original_source_sha256"] as const;
const bump=(obj:Record<string,number>,key:string)=>{obj[key]=(obj[key]||0)+1;};
const push=(obj:Record<string,string[]>,key:string,path:string)=>{
  const xs=obj[key]??(obj[key]=[]);
  if(xs.length<MAX_SAMPLES)xs.push(path);
};
const s=(x:unknown):string|null=>typeof x==="string"&&x.trim()?x.trim():null;
type Group = {key:string; count:number; paths:string[]};
function candidates(map:Map<string,string[]>):{totalGroups:number; samples:Group[]} {
  const groups=[...map].filter(([,v])=>v.length>1)
    .sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
  return {totalGroups:groups.length,samples:groups.slice(0,MAX_GROUPS).map(([k,paths])=>({
    key:k.slice(0,230),count:paths.length,paths:paths.slice(0,MAX_SAMPLES),
  }))};
}
export function auditVaultKnowledgeIndex() {
  const indexReady=indexer().ready;
  const database=db();
  // Query the *entire* current notes index before aggregating; a report on a
  // partially rebuilt index must explicitly say so.
  const rows=database.prepare("SELECT path,frontmatter FROM notes ORDER BY path LIMIT ?")
    .all(MAX_ROWS+1) as Row[];
  const capped=rows.length>MAX_ROWS;
  const scanned=rows.slice(0,MAX_ROWS);
  const roleCounts:Record<string,number>={};
  const folderCounts:Record<string,number>={};
  const fieldPresence:Record<string,number>={};
  const verificationCounts:Record<string,number>={};
  const sourceTypes:Record<string,number>={};
  const normalizedSourceTypes:Record<string,number>={};
  const sourceTypeMappings:Record<string,number>={};
  const independenceStatuses:Record<string,number>={};
  const rawSourceTypes:Record<string,number>={};
  const unmappedRoleTypes:Record<string,number>={};
  const warningCounts:Record<string,number>={};
  const claimIssueCounts:Record<string,number>={};
  const warningSamples:Record<string,string[]>={};
  const claimIssueSamples:Record<string,string[]>={};
  const eventGroups=new Map<string,string[]>();
  const claimGroups=new Map<string,string[]>();
  const historicalLinkNotes:LinkReviewNote[]=[];
  let invalidIndexedFrontmatter=0, structuredClaimNotes=0, declaredClaims=0;
  let possibleMissingSource=0, noKnownPrimaryHash=0;
  for(const row of scanned){
    let fm:FM={};
    try {
      const raw=row.frontmatter?JSON.parse(row.frontmatter):{};
      if(raw&&typeof raw==="object"&&!Array.isArray(raw))fm=raw as FM;
      else invalidIndexedFrontmatter++;
    }catch{invalidIndexedFrontmatter++;}
    const inspect=inspectCanonicalKnowledgeMetadata(row.path,fm);
    // An entity in legacy frontmatter is only note-declared metadata.
    // It is never inferred from the note title or treated as verified fact.
    historicalLinkNotes.push({path:row.path,entity:s(fm.entity),role:inspect.role});
    bump(roleCounts,inspect.role);
    if(inspect.role==="other")bump(unmappedRoleTypes,s(fm.type)??"(not_declared)");
    bump(folderCounts,row.path.split("/")[0]||"(root)");
    for(const f of fieldNames)if(fm[f]!==undefined&&fm[f]!==null)bump(fieldPresence,f);
    bump(verificationCounts,inspect.declaredVerification??"(not_declared)");
    bump(sourceTypes,inspect.declaredSourceType??(s(fm.source_type)?"(unmapped_legacy_type)":"(not_declared)"));
    bump(normalizedSourceTypes,inspect.normalizedSourceType??"(unresolved)");
    bump(sourceTypeMappings,inspect.sourceTypeMapping);
    bump(independenceStatuses,inspect.independenceAssessment);
    bump(rawSourceTypes,s(fm.source_type)??"(not_declared)");
    for(const warning of inspect.warnings){
      // Strip claim indices so counts are stable across a register.
      const key=warning.replace(/^claim_\d+_/,"claim_");
      bump(warningCounts,key);push(warningSamples,key,row.path);
    }
    for(const issue of inspect.claimIssues){
      const key=issue.replace(/^claim_\d+_/,"claim_");
      bump(claimIssueCounts,key);push(claimIssueSamples,key,row.path);
    }
    if(inspect.role!=="structured_claim")continue;
    structuredClaimNotes++;
    declaredClaims+=inspect.claimCount;
    const topEntity=s(fm.entity);
    const source=s(fm.original_source)??s(fm.source_url);
    if(!source)possibleMissingSource++;
    if(inspect.sourceHashScope==="none")noKnownPrimaryHash++;
    const event=s(fm.event_key);
    if(event&&topEntity){
      const key=topEntity+"|"+event;
      const paths=eventGroups.get(key)??[];
      paths.push(row.path);eventGroups.set(key,paths);
    }
    const claims=Array.isArray(fm.claims)?fm.claims:[];
    for(const claim of claims.slice(0,100)){
      if(!claim||typeof claim!=="object"||Array.isArray(claim))continue;
      const v=claim as FM, entity=s(v.entity)??topEntity;
      const metric=s(v.metric), period=s(v.period);
      // Do not conflate a mirrored source family: source URLs must be exact.
      const claimSource=s(v.original_source)??s(v.source_url)??source;
      if(!entity||!metric||!period||!claimSource)continue;
      const key=JSON.stringify([entity,metric,period,claimSource,s(v.unit)??null]);
      const paths=claimGroups.get(key)??[];
      if(!paths.includes(row.path))paths.push(row.path);
      claimGroups.set(key,paths);
    }
  }
  const linkRows=database.prepare(
    "SELECT source_path AS source,target FROM links WHERE resolved_path IS NULL ORDER BY source_path,target LIMIT ?"
  ).all(MAX_SAMPLES) as {source:string;target:string}[];
  const linksTotal=(database.prepare("SELECT COUNT(*) AS n FROM links WHERE resolved_path IS NULL")
    .get() as {n:number}).n;
  const orphanRows=database.prepare(
    "SELECT n.path FROM notes n WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.resolved_path=n.path) ORDER BY n.path LIMIT ?"
  ).all(MAX_SAMPLES) as {path:string}[];
  const orphanTotal=(database.prepare(
    "SELECT COUNT(*) AS n FROM notes n WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.resolved_path=n.path)"
  ).get() as {n:number}).n;
  const linked=database.prepare(
    "SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1"
  );
  const historicalReview=planHistoricalLinkReview(
    historicalLinkNotes,
    indexReady&&!capped,
    (source,target)=>Boolean(linked.get(source,target)),
  );
  const toTop=(obj:Record<string,number>,limit=15)=>Object.fromEntries(
    Object.entries(obj).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit));
  const sortedSamples=(cnt:Record<string,number>,samples:Record<string,string[]>,limit=12)=>{
    const selected=Object.keys(toTop(cnt,limit));return Object.fromEntries(selected.map(k=>[k,samples[k]]));
  };
  return {
    status:indexReady&&!capped?"indexed_metadata_audit_complete_not_verified":"partial_index_snapshot_do_not_claim_full_coverage",
    scannedNotes:scanned.length,
    indexedNotes:(database.prepare("SELECT COUNT(*) AS n FROM notes").get() as {n:number}).n,
    indexReady,scanLimit:MAX_ROWS,scanTruncated:capped,
    scope:"indexed_markdown_frontmatter_and_indexed_wikilinks_only",
    roleCounts,folderCounts:toTop(folderCounts,20),fieldPresence,
    verificationCounts:toTop(verificationCounts,16),sourceTypeCounts:toTop(sourceTypes,16),
    rawSourceTypeCounts:toTop(rawSourceTypes,20),unknownRoleTypeCounts:toTop(unmappedRoleTypes,20),
    normalizedSourceTypeCounts:toTop(normalizedSourceTypes,20),
    sourceTypeMappingCounts:toTop(sourceTypeMappings,10),
    independenceAssessmentCounts:toTop(independenceStatuses,10),
    claimRegisters:{notes:structuredClaimNotes,declaredClaimRows:declaredClaims,
      noSourceLocator:possibleMissingSource,noOriginalBytesHashDeclared:noKnownPrimaryHash,
      issueCounts:toTop(claimIssueCounts,18),
      issueSamples:sortedSamples(claimIssueCounts,claimIssueSamples)},
    legacyWarnings:{counts:toTop(warningCounts,18),
      samples:sortedSamples(warningCounts,warningSamples)},
    duplicateCandidates:{sameEventKey:candidates(eventGroups),sameExactSourceMetricPeriod:candidates(claimGroups)},
    linkHealth:{unresolvedReferences:linksTotal,examples:linkRows,
      orphanNotes:orphanTotal,orphanExamples:orphanRows.map(x=>x.path),
      historicalReview},
    invalidIndexedFrontmatter,
    notes:[
      "Audit covers only the currently indexed metadata; note body truth and unindexed/missing raw original files are not verified.",
      "A repeated event key or claim in separate review/register notes is only a duplicate candidate, not a proven error or independent evidence.",
      "Legacy date fields are not automatically event dates; source_type aliases outside canonical vocabulary require manual mapping.",
      "Counts of missing claim-specific fields only apply to structured claim registers, not every archived chat or concept note.",
      "Unresolved archive JSON/ZIP links may be external references absent from the server, not safe to repair by inventing files.",
      "Historical link suggestions require EXACT declared entity metadata and a complete index. Co-mentions, aliases, shared tickers in prose and relation direction have not been independently validated.",
      "Review the entire source note and its proposed target, then use the existing one-note Safe Edit preview/diff/approval workflow; no bulk repair or automatic historical link mutation is authorized.",
      "No Obsidian note, original source, protected Thesis, Evidence Register or Portfolio was modified by this audit.",
    ],
  };
}

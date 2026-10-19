/**
 * Read-only compatibility bridge for legacy Investment_OS metadata.
 *
 * The live Vault has historical notes declaring company: ["ASML"], topic
 * classification in theme, and pre-existing Obsidian wikilinks. A new field
 * called entity or related_paths is NOT a prerequisite to an already useful
 * historical note. This module never rewrites or "repairs" that content.
 */
import type {SchemaInspection} from "./investment-knowledge-schema";

export interface LegacyNavigationNote {
  path:string;
  role:SchemaInspection["role"];
  metadata:Record<string,unknown>;
}
type Origin="company"|"companies"|"ticker";
export interface LegacyLinkCandidate {
  sourcePath:string;
  targetPath:string;
  declaredCompany:string;
  declaredField:Origin;
  proposedWikilink:string;
  reason:"single_explicit_legacy_company_matches_existing_unique_hub";
  provenance:"legacy_frontmatter_not_primary_verified";
  requiresHumanReview:true;
  canAutoWrite:false;
}
export interface LegacyNavigationReview {
  status:"read_only_proposals"|"incomplete_index_hold";
  indexedNotesConsidered:number;
  declaredFieldCounts:Record<"company"|"companies"|"ticker"|"theme"|
    "related_notes"|"source_records"|"related_paths"|"related_claim_ids",number>;
  eligibleHistoricalAndReviewNotes:number;
  singleLegacyCompanyCandidates:number;
  alreadyLinkedToHub:number;
  unresolvedCanonicalHub:number;
  ambiguousOrConflictingLegacyCompany:number;
  invalidLegacyCompany:number;
  withAnyExistingOutgoingLinks:number;
  withoutExistingOutgoingLinks:number;
  sampleTruncated:boolean;
  samples:LegacyLinkCandidate[];
  canAutoWrite:false;
  canAutoUpdateThesis:false;
}
const MAX_ROWS=10_000,MAX_SAMPLES=8;
const SOURCE_ROLES=new Set<SchemaInspection["role"]>(["historical_analysis","review"]);
const PROTECTED=/^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i;
const LEGACY_FIELDS=["company","companies","ticker","theme","related_notes",
  "source_records","related_paths","related_claim_ids"] as const;
const safeCode=(value:unknown):string|null=>
  typeof value==="string"&&/^[A-Z][A-Z0-9.-]{0,11}$/.test(value.trim())?
    value.trim():null;
type Declared={kind:"absent"}|{kind:"invalid"}|{kind:"multi"}|{kind:"single";value:string};
function parseField(v:unknown):Declared {
  if(v===null||v===undefined)return {kind:"absent"};
  if(Array.isArray(v)){
    if(v.length>1)return {kind:"multi"};
    if(v.length===0)return {kind:"absent"};
    const value=safeCode(v[0]);
    return value?{kind:"single",value}:{kind:"invalid"};
  }
  const value=safeCode(v);
  return value?{kind:"single",value}:{kind:"invalid"};
}
export function reviewLegacyCompanyNavigation(
  notes:readonly LegacyNavigationNote[],completeIndex:boolean,
  alreadyLinked:(source:string,target:string)=>boolean,
  hasOutgoing:(source:string)=>boolean,
):LegacyNavigationReview {
  const counts=Object.fromEntries(LEGACY_FIELDS.map(k=>[k,0])) as LegacyNavigationReview["declaredFieldCounts"];
  const result:LegacyNavigationReview={
    status:completeIndex&&notes.length<=MAX_ROWS?"read_only_proposals":"incomplete_index_hold",
    indexedNotesConsidered:notes.length,declaredFieldCounts:counts,
    eligibleHistoricalAndReviewNotes:0,singleLegacyCompanyCandidates:0,
    alreadyLinkedToHub:0,unresolvedCanonicalHub:0,
    ambiguousOrConflictingLegacyCompany:0,invalidLegacyCompany:0,
    withAnyExistingOutgoingLinks:0,withoutExistingOutgoingLinks:0,
    sampleTruncated:false,samples:[],canAutoWrite:false,canAutoUpdateThesis:false,
  };
  if(result.status!=="read_only_proposals")return result;
  const hubs=new Map<string,string[]>();
  for(const note of notes){
    for(const field of LEGACY_FIELDS)
      if(note.metadata[field]!==undefined&&note.metadata[field]!==null)counts[field]++;
    if(note.role!=="company")continue;
    const m=/^01_Companies\/([A-Z][A-Z0-9.-]{0,11})\.md$/.exec(note.path);
    if(!m)continue;
    const group=hubs.get(m[1])??[];
    group.push(note.path);hubs.set(m[1],group);
  }
  // Deterministic paths; no recency heuristic and never prefer thesis
  // because the destination may still be unendorsed.
  for(const n of notes.slice().sort((a,b)=>a.path.localeCompare(b.path))){
    if(!SOURCE_ROLES.has(n.role)||PROTECTED.test(n.path))continue;
    result.eligibleHistoricalAndReviewNotes++;
    if(hasOutgoing(n.path))result.withAnyExistingOutgoingLinks++;
    else result.withoutExistingOutgoingLinks++;
    // Existing canonical-entity records are handled by the stricter PR #64
    // planner, not double-counted as legacy-metadata opportunities.
    if(n.metadata.entity!==undefined&&n.metadata.entity!==null)continue;
    const candidates: {field:Origin; parsed:Declared}[]=[
      {field:"company",parsed:parseField(n.metadata.company)},
      {field:"companies",parsed:parseField(n.metadata.companies)},
      {field:"ticker",parsed:parseField(n.metadata.ticker)},
    ];
    const provided=candidates.filter(c=>c.parsed.kind!=="absent");
    if(!provided.length)continue;
    if(provided.some(c=>c.parsed.kind==="multi")){
      result.ambiguousOrConflictingLegacyCompany++;continue;
    }
    if(provided.some(c=>c.parsed.kind==="invalid")){
      result.invalidLegacyCompany++;continue;
    }
    const singleton=provided.filter((c):c is {field:Origin;parsed:{kind:"single";value:string}}=>
      c.parsed.kind==="single");
    if(new Set(singleton.map(c=>c.parsed.value)).size!==1){
      result.ambiguousOrConflictingLegacyCompany++;continue;
    }
    const identifier=singleton[0].parsed.value;
    const matching=hubs.get(identifier);
    if(!matching||matching.length!==1){
      result.unresolvedCanonicalHub++;continue;
    }
    const target=matching[0];
    if(alreadyLinked(n.path,target)){result.alreadyLinkedToHub++;continue;}
    result.singleLegacyCompanyCandidates++;
    if(result.samples.length<MAX_SAMPLES)result.samples.push({
      sourcePath:n.path,targetPath:target,declaredCompany:identifier,
      declaredField:singleton[0].field,proposedWikilink:`[[${target.slice(0,-3)}]]`,
      reason:"single_explicit_legacy_company_matches_existing_unique_hub",
      provenance:"legacy_frontmatter_not_primary_verified",
      requiresHumanReview:true,canAutoWrite:false,
    });
  }
  result.sampleTruncated=result.singleLegacyCompanyCandidates>result.samples.length;
  return result;
}

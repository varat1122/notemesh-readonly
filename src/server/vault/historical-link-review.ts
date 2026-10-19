/**
 * Deterministic, read-only review suggestions for connecting old investment
 * notes to existing company knowledge. Only an EXACT explicitly declared
 * frontmatter entity shared by both notes is considered. A common entity is
 * a navigation hint, NOT independent evidence or a factual relationship.
 *
 * Never edits the Vault, picks between equally ranked targets, creates a
 * backlink automatically, or changes Thesis/Portfolio/Source contents.
 */
import type { SchemaInspection } from "./investment-knowledge-schema";
export type LinkRole = SchemaInspection["role"];
export interface LinkReviewNote {
  path:string;
  entity:string|null;
  role:LinkRole;
}
export interface HistoricalLinkSuggestion {
  sourcePath:string;
  targetPath:string;
  declaredEntity:string;
  reason:"same_declared_entity_candidate_only";
  proposedWikilink:string;
  change:"preview_existing_note_via_safe_edit";
  requiresHumanReview:true;
  canAutoWrite:false;
}
export interface HistoricalLinkReview {
  status:"read_only_proposals"|"incomplete_index_hold";
  candidatesFound:number;
  ambiguousTopRankGroups:number;
  sampleTruncated:boolean;
  samples:HistoricalLinkSuggestion[];
  canAutoWrite:false;
  canAutoUpdateThesis:false;
}
const HUB_PRIORITY:LinkRole[]=["thesis","company","timeline","evidence_register"];
const SOURCE_ROLES=new Set<LinkRole>(["historical_analysis","review"]);
const MAX_SAMPLES=8;
const explicitEntity=(value:string|null):string|null=>{
  if(!value)return null;
  const v=value.trim().normalize("NFC");
  // Do not infer entities from multi-company prose or fuzzy aliases.
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(v)?v.toLocaleLowerCase("en"):null;
};
const permittedSource=(p:string)=>
  !/^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i.test(p);
const safeTarget=(p:string)=>
  p.toLowerCase().endsWith(".md")&&!p.includes("[")&&!p.includes("]")&&
  !p.includes("|")&&!/[\r\n]/.test(p);

/**
 * All input must come from the CURRENT completed SQLite index. An incomplete
 * index cannot safely establish uniqueness or whether a link already exists.
 * Caller performs existence checks against indexed resolved links only.
 */
export function planHistoricalLinkReview(
  notes:readonly LinkReviewNote[],
  indexComplete:boolean,
  alreadyLinked:(source:string,target:string)=>boolean,
):HistoricalLinkReview {
  const hold:HistoricalLinkReview={
    status:"incomplete_index_hold",candidatesFound:0,ambiguousTopRankGroups:0,
    sampleTruncated:false,samples:[],canAutoWrite:false,canAutoUpdateThesis:false,
  };
  if(!indexComplete)return hold;
  const groups=new Map<string,LinkReviewNote[]>();
  for(const note of notes){
    const key=explicitEntity(note.entity);
    if(!key||!HUB_PRIORITY.includes(note.role)||!safeTarget(note.path))continue;
    const group=groups.get(key)??[];
    group.push(note);groups.set(key,group);
  }
  // Stable paths make independent audits reproducible across a rebuild.
  for(const group of groups.values())
    group.sort((a,b)=>HUB_PRIORITY.indexOf(a.role)-HUB_PRIORITY.indexOf(b.role)||
      a.path.localeCompare(b.path));
  let candidatesFound=0,ambiguousTopRankGroups=0;
  const samples:HistoricalLinkSuggestion[]=[];
  const sources=notes.filter(n=>SOURCE_ROLES.has(n.role)&&permittedSource(n.path))
    .slice().sort((a,b)=>a.path.localeCompare(b.path));
  for(const source of sources){
    const key=explicitEntity(source.entity);
    if(!key)continue;
    const group=(groups.get(key)??[]).filter(n=>n.path!==source.path);
    if(!group.length)continue;
    const topRole=group[0].role;
    const top=group.filter(n=>n.role===topRole);
    // Two Current Thesis files for the same entity are NOT resolved by a
    // guess based on filenames or dates. Flag for manual entity/path review.
    if(top.length!==1){ambiguousTopRankGroups++;continue;}
    const target=top[0];
    if(alreadyLinked(source.path,target.path))continue;
    candidatesFound++;
    if(samples.length<MAX_SAMPLES){
      samples.push({
        sourcePath:source.path,targetPath:target.path,
        declaredEntity:source.entity!.trim().normalize("NFC"),
        reason:"same_declared_entity_candidate_only",
        proposedWikilink:`[[${target.path.slice(0,-3)}]]`,
        change:"preview_existing_note_via_safe_edit",
        requiresHumanReview:true,canAutoWrite:false,
      });
    }
  }
  return {
    status:"read_only_proposals",candidatesFound,ambiguousTopRankGroups,
    sampleTruncated:candidatesFound>samples.length,samples,
    canAutoWrite:false,canAutoUpdateThesis:false,
  };
}

/**
 * Deterministic, read-only triage of old Investment_OS note metadata.
 *
 * A "priority" is the order for a HUMAN to inspect provenance/navigation.
 * It is not business materiality, investment significance, evidence validity,
 * permission to edit the Vault, or confirmation that a file is missing.
 *
 * Works on the entire COMPLETED index, never picks from the first eight
 * suggestions of a different planner and never reads source prose as orders.
 */
import type {SchemaInspection} from "./investment-knowledge-schema";

export interface TriageNote {
  path:string;
  role:SchemaInspection["role"];
  metadata:Record<string,unknown>;
}
type Kind=
  |"declared_source_path_not_indexed"
  |"explicit_event_date_needs_review"
  |"declared_source_path_without_resolved_link"
  |"invalid_source_records_metadata"
  |"conflicting_single_company_metadata"
  |"legacy_company_hub_navigation_candidate";
type Band="P1_provenance_or_chronology"|"P2_attribution_or_scope"|"P3_navigation_only";
export interface ReviewPriorityItem {
  sourcePath:string;
  targetPath:string|null;
  priority:Band;
  kind:Kind;
  reason:"indexed_metadata_review_only_not_a_verified_error";
  requiresFullNoteAndSourceReview:true;
  canAutoWrite:false;
}
export interface KnowledgeReviewPriority {
  status:"review_queue_index_complete_not_verified"|"incomplete_index_hold";
  indexedNotesConsidered:number;
  eligibleSourceNotes:number;
  notesWithAtLeastOneFinding:number;
  findingsTotal:number;
  countsByKind:Record<Kind,number>;
  countsByPriority:Record<Band,number>;
  sampledFindings:number;
  sampleTruncated:boolean;
  samples:ReviewPriorityItem[];
  recommendations:string[];
  canAutoWrite:false;
  canAutoUpdateThesis:false;
}
const MAX_NOTES=10_000,MAX_REFS=40,MAX_SAMPLE_PER_KIND=4;
const KIND_ORDER:Kind[]=[
  "declared_source_path_not_indexed",
  "explicit_event_date_needs_review",
  "declared_source_path_without_resolved_link",
  "invalid_source_records_metadata",
  "conflicting_single_company_metadata",
  "legacy_company_hub_navigation_candidate",
];
const priority=(kind:Kind):Band=>
  kind==="declared_source_path_not_indexed"||kind==="explicit_event_date_needs_review"?
    "P1_provenance_or_chronology":
  kind==="declared_source_path_without_resolved_link"||
    kind==="invalid_source_records_metadata"||
    kind==="conflicting_single_company_metadata"?
    "P2_attribution_or_scope":"P3_navigation_only";
const BANDS:Band[]=[
  "P1_provenance_or_chronology","P2_attribution_or_scope","P3_navigation_only",
];
const RECOMMENDATIONS=[
  "P1: Inspect indexed source-path availability and exact event-date provenance in full notes before proposing metadata corrections; do not fabricate raw archives or infer dates from imports.",
  "P2: Inspect exact existing original-source links, malformed legacy fields and conflicting company identifiers; do not treat note classifications or historical AI as independent investment evidence.",
  "P3: Check whether a missing exact canonical company-hub navigation link actually helps research; do not bulk add links based on mention counts or shared themes.",
  "Use separately authorized one-note Safe Edit preview/diff/approval/readback for any future approved change. No batch apply, automatic source rewrites or protected Thesis/Portfolio edits.",
];
const emptyCounts=()=>Object.fromEntries(KIND_ORDER.map(k=>[k,0])) as Record<Kind,number>;
const emptyBands=()=>Object.fromEntries(BANDS.map(k=>[k,0])) as Record<Band,number>;
const eligibility=(n:TriageNote)=>
  (n.role==="historical_analysis"||n.role==="review")&&
  !/^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i.test(n.path);
const validPath=(v:string)=>
  v.length>3&&v.length<=350&&v.endsWith(".md")&&
  !v.startsWith("/")&&!v.includes("\\")&&
  !["[","]","|","#","^"].some(k=>v.includes(k))&&
  !/[\r\n\0]/.test(v)&&
  !v.split("/").some(s=>!s||s==="."||s===".."||s.startsWith("."));
const code=(v:unknown):string|null=>
  typeof v==="string"&&/^[A-Z][A-Z0-9.-]{0,11}$/.test(v)?v:null;
function declaredCodes(v:unknown):null|string[] {
  if(v===undefined||v===null)return [];
  if(typeof v==="string")return code(v)?[v]:null;
  if(!Array.isArray(v)||v.length>MAX_REFS)return null;
  const values:string[]=[];
  for(const item of v){const id=code(item);if(!id)return null;values.push(id);}
  return values;
}
const isCalendar=(v:string)=> {
  if(!/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(v))return false;
  const date=v.slice(0,10),d=new Date(date+"T00:00:00Z");
  if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==date)return false;
  if(v.length===10)return true;
  if(!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v))return false;
  return !Number.isNaN(Date.parse(v));
};

/**
 * Presence in the SQLite note index is NOT proof that archived original bytes
 * are present. Missing from this index means manual availability review.
 */
export function planKnowledgeReviewPriorities(
  notes:readonly TriageNote[],
  indexComplete:boolean,
  hasResolvedLink:(source:string,target:string)=>boolean,
):KnowledgeReviewPriority {
  const countsByKind=emptyCounts(),countsByPriority=emptyBands();
  const out:KnowledgeReviewPriority={
    status:indexComplete&&notes.length<=MAX_NOTES?
      "review_queue_index_complete_not_verified":"incomplete_index_hold",
    indexedNotesConsidered:notes.length,eligibleSourceNotes:0,
    notesWithAtLeastOneFinding:0,findingsTotal:0,
    countsByKind,countsByPriority,sampledFindings:0,
    sampleTruncated:false,samples:[],recommendations:RECOMMENDATIONS,
    canAutoWrite:false,canAutoUpdateThesis:false,
  };
  if(out.status==="incomplete_index_hold")return out;
  const allPaths=new Set(notes.map(n=>n.path));
  const byKind=new Map<Kind,ReviewPriorityItem[]>();
  const sorted=notes.slice().sort((a,b)=>a.path.localeCompare(b.path));
  const canonicalHubs=new Set(notes.filter(n=>n.role==="company"&&
    /^01_Companies\/[A-Z][A-Z0-9.-]{0,11}\.md$/.test(n.path)).map(n=>n.path));
  for(const note of sorted){
    if(!eligibility(note))continue;
    out.eligibleSourceNotes++;
    let noteHasFinding=false;
    const emit=(kind:Kind,targetPath:string|null)=>{
      // Deduplicate by (note, category). The sample path is the first exact
      // matching declared target, not a guessed "most relevant" source.
      const group=byKind.get(kind)??[];
      countsByKind[kind]++;
      countsByPriority[priority(kind)]++;
      out.findingsTotal++;
      noteHasFinding=true;
      if(group.length<MAX_SAMPLE_PER_KIND){
        group.push({sourcePath:note.path,targetPath,priority:priority(kind),kind,
          reason:"indexed_metadata_review_only_not_a_verified_error",
          requiresFullNoteAndSourceReview:true,canAutoWrite:false});
      }
      byKind.set(kind,group);
    };
    const fm=note.metadata;
    const raw=fm.source_records;
    if(raw!==undefined&&raw!==null){
      if(!Array.isArray(raw)||raw.length>MAX_REFS||
        raw.some(v=>typeof v!=="string"||!validPath(v))){
        emit("invalid_source_records_metadata",null);
      }else{
        const unique=[...new Set(raw as string[])].sort();
        const missing=unique.find(p=>!allPaths.has(p));
        if(missing)emit("declared_source_path_not_indexed",missing);
        const disconnected=unique.find(p=>allPaths.has(p)&&
          !hasResolvedLink(note.path,p));
        if(disconnected)emit("declared_source_path_without_resolved_link",disconnected);
      }
    }
    // Only flag an explicitly declared event_date. Legacy date, imported_on
    // and date in a filename are NEVER silently treated as event dates.
    if(fm.event_date!==undefined&&fm.event_date!==null&&
      (typeof fm.event_date!=="string"||!isCalendar(fm.event_date)))
      emit("explicit_event_date_needs_review",null);
    if(fm.entity===undefined||fm.entity===null){
      const declarations=[fm.company,fm.companies,fm.ticker]
        .map(declaredCodes).filter(v=>v!==null&&v.length>0) as string[][];
      // Multi-company topical notes are legitimate: do not "fix" them by
      // arbitrarily choosing a main company or declaring them erroneous.
      const singleton=declarations.filter(v=>v.length===1);
      if(singleton.length>=2&&new Set(singleton.map(v=>v[0])).size>1){
        emit("conflicting_single_company_metadata",null);
      }else if(declarations.length&&declarations.every(v=>v.length===1)&&
        new Set(declarations.map(v=>v[0])).size===1){
        const ticker=declarations[0][0];
        const hub=`01_Companies/${ticker}.md`;
        if(canonicalHubs.has(hub)&&!hasResolvedLink(note.path,hub))
          emit("legacy_company_hub_navigation_candidate",hub);
      }
    }
    if(noteHasFinding)out.notesWithAtLeastOneFinding++;
  }
  out.samples=KIND_ORDER.flatMap(kind=>byKind.get(kind)??[]);
  out.sampledFindings=out.samples.length;
  out.sampleTruncated=out.findingsTotal>out.sampledFindings;
  return out;
}

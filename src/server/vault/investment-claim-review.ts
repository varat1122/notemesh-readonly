import { db } from "../db";
import { buildInvestmentContextPack, type Focus } from "./investment-context";

/**
 * Deterministic, read-only intake triage. This is NOT a model's judgment of
 * factual accuracy, independent corroboration or approval to change a Thesis.
 * Only explicit, matching structured claim records can produce a dedup delta.
 */
export type Domain = "company" | "industry" | "macro" | "asset";
export type ReviewClass =
  | "duplicate_candidate" | "possible_correction_or_contradiction"
  | "confirmation_candidate_not_independent" | "added_detail_candidate"
  | "unresolved";
export interface IncomingClaim {
  domain: Domain;
  entity: string;
  metric: string;
  period: string;
  originalSource: string;
  statement: string;
  eventDate?: string | null;
  publishedAt?: string | null;
  value?: string;
  unit?: string;
  focus?: Focus;
  maxCandidates?: number;
}
interface IndexedRow { path:string; frontmatter:string|null }
interface StructuredRecord {
  path:string; claimId:string|null; originalSource:string|null;
  metric:string; period:string; value:string|null; unit:string|null;
  verification:string|null; explicit:boolean;
}
export interface ClaimReview {
  status:"review_only_not_verified";
  classification:ReviewClass;
  domain:Domain; entity:string; metric:string; period:string;
  eventDate:string|null; publishedAt:string|null;
  originalSource:string;
  matchingClaims:StructuredRecord[];
  relatedEventClaims:StructuredRecord[];
  sourceLinkedUnstructuredPaths:string[];
  metadataScan:{indexedNotesWithMetadata:number;notesScanned:number;truncated:boolean;eligibleEntityNotes:number};
  possibleHistoricalPaths:{path:string;role:string;declaredVerification:string|null;line:number}[];
  evidenceNeeded:string[];
  suggestedThesisAction:"maintain_pending_review";
  canAutoUpdateThesis:false;
  caveats:string[];
}
const trim=(x:string)=>x.trim().normalize("NFC");
const norm=(x:string)=>trim(x).toLowerCase().replace(/\s+/g," ");
function sourceKey(src:string){
  const value=trim(src);
  try {
    const u=new URL(value);
    if(!["https:","http:"].includes(u.protocol)) return norm(value);
    u.hash="";
    for(const k of [...u.searchParams.keys()]) if(/^utm_|^(?:fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    // URL paths and query values may be case-sensitive. Only the host and
    // scheme are case-insensitive; URL already normalizes those fields.
    u.searchParams.sort();
    return u.toString();
  } catch {return norm(value);}
}
function stringOrNull(x:unknown):string|null {
  return typeof x==="string" && x.trim()?trim(x):typeof x==="number" && Number.isFinite(x)?String(x):null;
}
function sameEntity(f:Record<string,unknown>,incoming:IncomingClaim):boolean{
  const parts=[f.entity,f.ticker,f.canonical_entity,f.issuer,f.country,f.industry,f.asset]
    .flatMap(v=>Array.isArray(v)?v:[v]).map(stringOrNull).filter((v):v is string=>v!==null);
  return parts.some(v=>norm(v)===norm(incoming.entity));
}
function record(raw:Record<string,unknown>,path:string,verification:string|null):StructuredRecord|null{
  const metric=stringOrNull(raw.metric),period=stringOrNull(raw.period);
  if(!metric||!period)return null;
  return {
    path,
    claimId:stringOrNull(raw.claim_id),
    originalSource:stringOrNull(raw.original_source)||stringOrNull(raw.source_url)||stringOrNull(raw.primary_url),
    metric,period,value:stringOrNull(raw.value)||stringOrNull(raw.claim_value),
    unit:stringOrNull(raw.unit),verification,explicit:true
  };
}
function amountEqual(a:string|null,b:string|null):boolean|null {
  if(a===null||b===null)return null;
  // Never infer comparison from unequal formatting or currency units.
  return norm(a)===norm(b);
}
export function reviewInvestmentClaim(input:IncomingClaim):ClaimReview{
  const entity=trim(input.entity),metric=trim(input.metric),period=trim(input.period);
  const statement=trim(input.statement), originalSource=trim(input.originalSource);
  if(!entity||!metric||!period||!originalSource||statement.length<8)
    throw Error("entity, metric, reporting period, original source and meaningful claim statement are required");
  if(entity.length>140||metric.length>140||period.length>120||originalSource.length>1000||statement.length>2500)
    throw Error("Claim input exceeds its bounded length");
  for(const date of [input.eventDate,input.publishedAt]){
    if(date===undefined||date===null)continue;
    const validShape=/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date);
    const day=date.slice(0,10);
    const parsedDay=new Date(day+"T00:00:00.000Z");
    if(!validShape||Number.isNaN(Date.parse(date))||
       Number.isNaN(parsedDay.getTime())||parsedDay.toISOString().slice(0,10)!==day)
      throw Error("Dates must be valid ISO calendar dates or offset-aware timestamps; unknown dates are null");
  }
  const limit=Math.min(12,Math.max(1,input.maxCandidates??8));
  const selected:StructuredRecord[]=[];
  const sourceLinkedUnstructuredPaths:string[]=[];
  const MAX_METADATA_SCAN=25000;
  const indexedNotesWithMetadata=(db().prepare("SELECT COUNT(*) AS n FROM notes WHERE frontmatter IS NOT NULL").get() as {n:number}).n;
  const rows=db().prepare("SELECT path, frontmatter FROM notes WHERE frontmatter IS NOT NULL ORDER BY path LIMIT ?")
    .all(MAX_METADATA_SCAN) as IndexedRow[];
  let eligibleEntityNotes=0;
  for(const row of rows){
    let fm:Record<string,unknown>;
    try{fm=JSON.parse(row.frontmatter??"null") as Record<string,unknown>}catch{continue;}
    if(!fm||typeof fm!=="object"||Array.isArray(fm)||!sameEntity(fm,input))continue;
    eligibleEntityNotes++;
    const noteSource=stringOrNull(fm.original_source)||stringOrNull(fm.source_url)||stringOrNull(fm.primary_url);
    const claims=Array.isArray(fm.claims)?fm.claims:[fm];
    let hasComparableStructuredRecord=false;
    for(const raw of claims){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))continue;
      // Nested claims inherit explicit note-level source/date fields, but a
      // child naming another issuer must not be matched to the note's ticker.
      const child=raw as Record<string,unknown>;
      const childIdentity=[child.entity,child.ticker,child.issuer,child.country,child.industry,child.asset]
        .flatMap(v=>Array.isArray(v)?v:[v]).map(stringOrNull).filter((v):v is string=>v!==null);
      if(childIdentity.length && !childIdentity.some(v=>norm(v)===norm(entity)))continue;
      const merged={...fm,...child};
      if(!sameEntity(merged,input))continue;
      const v=record(merged,row.path,stringOrNull(merged.verification));
      if(!v||norm(v.period)!==norm(period))continue;
      hasComparableStructuredRecord=true;
      if(norm(v.metric)!==norm(metric)&&(!v.originalSource||sourceKey(v.originalSource)!==sourceKey(originalSource)))continue;
      selected.push(v);
    }
    // A Note with a matching primary URL but no comparable claim is worth a
    // manual look. It is NOT a duplicate or confirmation classification.
    if(noteSource && sourceKey(noteSource)===sourceKey(originalSource) &&
       !hasComparableStructuredRecord && sourceLinkedUnstructuredPaths.length<12){
      sourceLinkedUnstructuredPaths.push(row.path);
    }
  }
  const strict=selected.filter(x=>norm(x.metric)===norm(metric));
  const sameSource=strict.filter(x=>x.originalSource&&sourceKey(x.originalSource)===sourceKey(originalSource));
  const matchedSourceSamePeriodOtherMetric=selected.filter(x=>norm(x.metric)!==norm(metric)&&x.originalSource&&sourceKey(x.originalSource)===sourceKey(originalSource));
  const otherSource=strict.filter(x=>x.originalSource&&sourceKey(x.originalSource)!==sourceKey(originalSource));
  // Numerical equality/conflict requires explicit, identical unit strings
  // on both sides. Missing unit is never proof of an equivalent metric.
  const comparable=(a:StructuredRecord)=>!!input.unit&&!!a.unit&&norm(a.unit)===norm(input.unit);
  const exact=sameSource.filter(comparable).map(a=>amountEqual(a.value,input.value??null));
  let classification:ReviewClass="unresolved";
  // A single conflicting same-source record prevents a misleading 'duplicate'
  // conclusion even when another record repeats the expected number.
  if(exact.some(v=>v===false))classification="possible_correction_or_contradiction";
  else if(exact.some(v=>v===true))classification="duplicate_candidate";
  else if(otherSource.some(v=>comparable(v)&&amountEqual(v.value,input.value??null)===true))
    classification="confirmation_candidate_not_independent";
  // A new metric can only be an added detail when the *requested* metric is
  // absent for this entity/event. If the metric already exists but is
  // incomparable due to missing/mismatched units, remain unresolved. Without
  // this guard, any nearby row (e.g. accounts_receivable in a 10-Q containing
  // OCF) incorrectly turned a unit mismatch into an "added detail".
  else if(!strict.length && matchedSourceSamePeriodOtherMetric.length)
    classification="added_detail_candidate";
  const scoped=buildInvestmentContextPack({
    question:statement.slice(0,1100),
    issuers:input.domain==="company"?[entity]:[],
    industry:input.domain==="company"?undefined:entity,
    focus:input.focus??(input.domain==="macro"?"macro":"general"),
    maxNotes:Math.min(16,Math.max(5,limit+2)),maxChars:10000
  });
  const paths=[...new Set(selected.map(x=>x.path))];
  const possible=[...scoped.items.map(x=>({path:x.path,role:x.role,declaredVerification:x.declaredVerification,line:x.line}))]
    .filter(x=>!paths.includes(x.path)).slice(0,limit);
  const evidenceNeeded=[
    "Read full original sources, verify numerical units and period; indexed metadata is not primary-source verification.",
    "Reconcile candidate paths and claim IDs at original-source/event/metric/reporting-period level.",
    "Check independent counter-evidence and date/vintage; do not promote archived AI or repeat issuer press releases.",
    "Use a separate human-reviewed Safe Edit preview and Change Log before any Protected Thesis modification."
  ];
  if(classification==="unresolved")evidenceNeeded.unshift("No conclusive structured claim match; do not infer this is a new event or a novel claim.");
  if(sourceLinkedUnstructuredPaths.length)
    evidenceNeeded.unshift("A prior note cites the same original source but lacks a comparable structured claim; read the whole note before deciding novelty.");
  if(indexedNotesWithMetadata>rows.length)
    evidenceNeeded.unshift("Metadata scan capped before full coverage; unresolved historical claims could be outside the scanned range.");
  return {
    status:"review_only_not_verified",classification,domain:input.domain,
    entity,metric,period,eventDate:input.eventDate??null,publishedAt:input.publishedAt??null,
    originalSource,matchingClaims:strict.slice(0,limit),
    relatedEventClaims:matchedSourceSamePeriodOtherMetric.slice(0,limit),
    sourceLinkedUnstructuredPaths,
    metadataScan:{indexedNotesWithMetadata,notesScanned:rows.length,
      truncated:indexedNotesWithMetadata>rows.length,eligibleEntityNotes},
    possibleHistoricalPaths:possible,
    evidenceNeeded,suggestedThesisAction:"maintain_pending_review",canAutoUpdateThesis:false,
    caveats:[
      "Classification is a candidate from exact, explicitly structured indexed metadata; it is not an adjudicated fact.",
      "matchingClaims contains same-metric candidate records only; relatedEventClaims contains separate metrics from the same original source and period and is NOT metric corroboration.",
      "Matching URLs preserve case-sensitive paths; ambiguous source identifiers and unit-free values remain unresolved.",
      "Metadata scan limits and note-level source links are reported; absence of metadata is not absence of historical facts.",
      "Unstructured archives and truncated context results can contain missed duplicates or contradictions.",
      "A matching statement from a different URL is not automatically an independent confirmation.",
      "No live filing, current valuation, price, consensus, customer evidence or portfolio records are fetched by this tool.",
      "This tool performs no Vault mutation, verification upgrade, numeric estimate revision or thesis update."
    ]
  };
}

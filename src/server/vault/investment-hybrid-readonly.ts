/**
 * RI-011: bounded, read-only candidate reconciliation over existing NoteMesh
 * structured claims and vault full-text search. It is not a source verifier,
 * semantic deduplicator, writeback recipe, authorization, or thesis engine.
 */
import { reviewInvestmentClaim, type IncomingClaim } from "./investment-claim-review";
import { searchVault } from "./queries";
import { readNoteRange } from "./notes";
import { db } from "../db";

type Unit = { kind:string; scale:bigint };
const UNITS:Readonly<Record<string,Unit>> = {
  "usd million":{kind:"USD",scale:1000000n},"usd millions":{kind:"USD",scale:1000000n},
  "usd mn":{kind:"USD",scale:1000000n},"usd billion":{kind:"USD",scale:1000000000n},
  "usd billions":{kind:"USD",scale:1000000000n},"usd bn":{kind:"USD",scale:1000000000n},
  "eur million":{kind:"EUR",scale:1000000n},"eur millions":{kind:"EUR",scale:1000000n},
  "eur billion":{kind:"EUR",scale:1000000000n},"eur billions":{kind:"EUR",scale:1000000000n},
  "vnd trillion":{kind:"VND",scale:1000000000000n},"vnd trillions":{kind:"VND",scale:1000000000000n},
  "percent":{kind:"percent",scale:1n},"%":{kind:"percent",scale:1n},
};

/** Exact scaled integer arithmetic; no floats, FX, bps, or accounting-basis conversion. */
export function normalizedAmount(value:unknown,unit:unknown):{kind:string;amount:bigint}|null{
  if(typeof value!=="string"||typeof unit!=="string"||value.length>90)return null;
  const u=UNITS[unit.trim().toLowerCase().replace(/\s+/g," ")];
  if(!u)return null;
  const v=value.trim();
  if(!/^[+-]?(?:(?:0|[1-9]\d*)|(?:[1-9]\d{0,2}(?:,\d{3})+))(?:\.\d{1,12})?$/.test(v))return null;
  const negative=v.startsWith("-");
  const digits=v.replace(/^[+-]/,"").replace(/,/g,"");
  const [whole,fraction=""]=digits.split(".");
  if(whole.length+fraction.length>65)return null;
  const numerator=BigInt(whole+fraction)*(negative?-1n:1n);
  const full=numerator*u.scale*10n**BigInt(12-fraction.length);
  return {kind:u.kind,amount:full};
}

/** URL paths are case-sensitive. Host case and tracking parameters are not. */
export function comparableSource(s:unknown):string|null{
  if(typeof s!=="string"||s.length>1000)return null;
  try{
    const u=new URL(s);
    if(u.protocol!=="https:"||u.username||u.password||!u.hostname)return null;
    u.hash="";
    for(const k of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();
    return u.toString();
  }catch{return null;}
}


/** Untrusted indexed frontmatter: provenance hints, NOT source authentication. */
type Provenance = {
  metadataState:"indexed"|"indexed_no_frontmatter"|"invalid_metadata"|"not_indexed";
  recordType:string|null; declaredVerification:string|null;
  declaredSourceType:string|null; declaredSourceKind:string|null;
  eventDate:string|null; publicationDate:string|null; receivedDate:string|null;
  originalDocumentAccess:string|null; sourceUrl:string|null;
  linkedSourcePath:string|null; linkedSourceIndexed:boolean;
  linkedIntakeIdMatches:boolean|null; linkedSourceTextSha256Present:boolean;
  originalDocumentVerifiedThisRun:false; linkedSourceReadThisRun:false;
  bodyLabeledSourceUrls:string[]; bodyUrlLookupTruncated:boolean;
};
function provenanceFor(notePath:string):Provenance{
  const q=db().prepare("SELECT frontmatter FROM notes WHERE path=?");
  const row=q.get(notePath) as {frontmatter:string|null}|undefined;
  const result:Provenance={
    metadataState:!row?"not_indexed":"indexed_no_frontmatter",
    recordType:null,declaredVerification:null,declaredSourceType:null,declaredSourceKind:null,
    eventDate:null,publicationDate:null,receivedDate:null,originalDocumentAccess:null,
    sourceUrl:null,linkedSourcePath:null,linkedSourceIndexed:false,linkedIntakeIdMatches:null,
    linkedSourceTextSha256Present:false,originalDocumentVerifiedThisRun:false,linkedSourceReadThisRun:false,
    bodyLabeledSourceUrls:[],bodyUrlLookupTruncated:true
  };
  if(!row?.frontmatter)return result;
  let fm:Record<string,unknown>;
  try{
    const data=JSON.parse(row.frontmatter) as unknown;
    if(!data||typeof data!=="object"||Array.isArray(data))throw Error("invalid");
    fm=data as Record<string,unknown>;
  }catch{return {...result,metadataState:"invalid_metadata"};}
  // Preserve declared text exactly (bounded); never treat labels as verified.
  const val=(x:unknown,max=300)=>typeof x==="string"&&x.trim()&&x.length<=max?x.trim():null;
  result.metadataState="indexed";
  result.recordType=val(fm.type);
  result.declaredVerification=val(fm.verification);
  result.declaredSourceType=val(fm.source_type);
  result.declaredSourceKind=val(fm.source_kind);
  result.eventDate=val(fm.event_date,70);
  result.publicationDate=val(fm.published_at,70);
  result.receivedDate=val(fm.received_at,70);
  result.originalDocumentAccess=val(fm.original_document_access);
  result.sourceUrl=val(fm.source_url,1000)??val(fm.original_source,1000)??val(fm.primary_url,1000);
  const sourcePath=val(fm.original_source_path,600);
  if(sourcePath){
    result.linkedSourcePath=sourcePath;
    const linked=q.get(sourcePath) as {frontmatter:string|null}|undefined;
    result.linkedSourceIndexed=!!linked;
    if(linked?.frontmatter){
      try{
        const parsed=JSON.parse(linked.frontmatter) as unknown;
        if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)){
          const linkedFm=parsed as Record<string,unknown>;
          const reviewId=val(fm.intake_id,140),sourceId=val(linkedFm.intake_id,140);
          if(reviewId&&sourceId)result.linkedIntakeIdMatches=reviewId===sourceId;
          result.linkedSourceTextSha256Present=typeof linkedFm.source_text_sha256==="string"&&
            /^[a-f0-9]{64}$/i.test(linkedFm.source_text_sha256);
        }
      }catch{/* invalid linked metadata is not a verified provenance chain */}
    }
  }
  return result;
}


/** Attributed Source URLs explicitly labelled *inside* old note text.
 * No fetch and no authority assertion: these are follow-up locators only. */
function labeledSourceUrls(body:string):string[]{
  const urls:string[]=[];
  const pattern=/(?:Issuer primary URL|Original company IR source|Original source|Source)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(https:\/\/[^\s<>)]+)/gi;
  for(const match of body.slice(0,12000).matchAll(pattern)){
    const candidate=match[1].replace(/[.,;]+$/,"");
    try{
      const url=new URL(candidate);
      if(url.protocol!=="https:"||url.username||url.password||!url.hostname||candidate.length>1000)continue;
      if(!urls.includes(candidate))urls.push(candidate);
      if(urls.length===3)break;
    }catch{/* untrusted malformed locator: leave absent */}
  }
  return urls;
}

/** Lowercasing can expand a character (for example, İ -> i + combining dot).
 * Locate against the complete lowercase text, then map back to original UTF-16
 * offsets before slicing or computing line locators. Contextual lowercase forms
 * such as final sigma retain their length, so they keep the original match semantics. */
function originalOffsetForLowercaseIndex(text:string,index:number):number{
  let originalOffset=0,lowerOffset=0;
  for(const point of text){
    const nextLowerOffset=lowerOffset+point.toLowerCase().length;
    if(index<nextLowerOffset)return originalOffset;
    lowerOffset=nextLowerOffset;
    originalOffset+=point.length;
  }
  return text.length;
}

function insideSurrogatePair(text:string,offset:number):boolean{
  const before=text.charCodeAt(offset-1),after=text.charCodeAt(offset);
  return before>=0xd800&&before<=0xdbff&&after>=0xdc00&&after<=0xdfff;
}

export interface HybridInput extends IncomingClaim { searchQueries?:string[]; maxFtsHits?:number }
export type HybridState = "HOLD_ORIGINAL_SOURCE_IDENTITY"|"HOLD_CONFLICTING_CANDIDATES"|"HOLD_CANDIDATE_COVERAGE"|"HOLD_METADATA_COVERAGE"|
  "POSSIBLE_CORRECTION_OR_CONTRADICTION"|"DUPLICATE_CANDIDATE"|
  "UNIT_EQUIVALENCE_CANDIDATE"|"HOLD_UNIT_OR_VALUE_BASIS"|
  "ADDED_DETAIL_CANDIDATE"|"HISTORICAL_NOTE_CANDIDATE"|"UNRESOLVED_NEEDS_ORIGINAL";

export function hybridClaimPreview(input:HybridInput){
  const existing=reviewInvestmentClaim({...input,maxCandidates:12}); // inspect the maximum exposed metadata; never verified by this operation
  // At the 12-row response cap we cannot prove an omitted contrary record is absent.
  const candidateCapReached=existing.matchingClaims.length>=12;
  const metadataCapReached=existing.metadataScan.truncated;
  const source=comparableSource(input.originalSource);
  const sameDocument=existing.matchingClaims.filter(row=>source!==null&&comparableSource(row.originalSource)===source);
  const exactUnit=(a:string|null,b:string|undefined)=>typeof a==="string"&&typeof b==="string"&&a.trim().toLowerCase()===b.trim().toLowerCase();
  let exactMatches=0,normalizedMatches=0,conflicts=0,unknown=0;
  for(const row of sameDocument){
    const a=normalizedAmount(input.value,input.unit),b=normalizedAmount(row.value,row.unit);
    if(!a||!b||a.kind!==b.kind){unknown++;continue;}
    if(a.amount===b.amount){if(exactUnit(row.unit,input.unit))exactMatches++;else normalizedMatches++;}
    else conflicts++;
  }
  let state:HybridState;
  if(!source)state="HOLD_ORIGINAL_SOURCE_IDENTITY";
  // The upstream classifier processes *all* indexed matches before slicing its
  // response. Honour a source conflict even if the conflicting row was omitted.
  else if(existing.classification==="possible_correction_or_contradiction")state="HOLD_CONFLICTING_CANDIDATES";
  else if(conflicts&&(exactMatches||normalizedMatches))state="HOLD_CONFLICTING_CANDIDATES";
  else if(conflicts)state="POSSIBLE_CORRECTION_OR_CONTRADICTION";
  else if(metadataCapReached)state="HOLD_METADATA_COVERAGE";
  else if(candidateCapReached)state="HOLD_CANDIDATE_COVERAGE";
  // Mixed same-source records with unknown/missing units are not safely
  // classifiable as duplicates even if one other row matches exactly.
  else if(unknown)state="HOLD_UNIT_OR_VALUE_BASIS";
  else if(exactMatches)state="DUPLICATE_CANDIDATE";
  else if(normalizedMatches)state="UNIT_EQUIVALENCE_CANDIDATE";
  else if(existing.classification==="added_detail_candidate")state="ADDED_DETAIL_CANDIDATE";
  else state="UNRESOLVED_NEEDS_ORIGINAL";

  // FTS can discover old notes even when no structured claim exists. Queries
  // are literal, bounded, and not treated as evidence of a same economic event.
  // Retrieval aliases are discovery aids ONLY: never rewrite the period in
  // structured identity or infer that separate fiscal vintages are equal.
  const compactPeriod=input.period.trim().replace(/\s+/g,"");
  const fyFull=compactPeriod.match(/^FY20(\d{2})Q([1-4])$/i);
  const fyShort=compactPeriod.match(/^FY(\d{2})Q([1-4])$/i);
  const periodAliases=[...(fyFull?[`FY${fyFull[1]}Q${fyFull[2]}`]:[]),
    ...(fyShort?[`FY20${fyShort[1]}Q${fyShort[2]}`]:[])];
  const queries=[...new Set((input.searchQueries??[]).concat([
    `${input.entity} ${input.period}`,
    ...periodAliases.map(p=>`${input.entity} ${p}`),
    `${input.entity} ${input.metric}`
  ]).map(q=>q.trim()).filter(q=>q.length>=3&&q.length<=120))].slice(0,5);
  const requestedLimit=Math.min(10,Math.max(1,input.maxFtsHits??6));
  const results:{path:string;title:string;query:string;snippet:string;readExcerpt:string;modified:string;readbackMatchFound:boolean;readbackTruncated:boolean;readbackStartLine:number|null;readbackEndLine:number|null;provenance:Provenance}[]=[];
  const seen=new Set<string>();
  const coverage:{query:string;total:number;selected:number;represented:number;error?:string}[]=[];
  // A single broad query previously monopolized the global candidate budget:
  // later exact metric/period queries had no opportunity to contribute hits.
  // Keep searches bounded, but interleave their first-ranked candidates.
  const pages=queries.map(query=>{
    try{
      const page=searchVault(query,{limit:requestedLimit,context:true});
      coverage.push({query,total:page.total,selected:0,represented:0});
      return {query,hits:page.hits};
    }catch{
      coverage.push({query,total:0,selected:0,represented:0,error:"query_not_available"});
      return {query,hits:[] as ReturnType<typeof searchVault>["hits"]};
    }
  });
  const selected:{query:string;hit:(typeof pages)[number]["hits"][number];queryIndex:number}[]=[];
  for(let rank=0;rank<requestedLimit&&selected.length<requestedLimit;rank++){
    for(let index=0;index<pages.length&&selected.length<requestedLimit;index++){
      const hit=pages[index].hits[rank];
      if(!hit||seen.has(hit.path))continue;
      seen.add(hit.path);
      coverage[index].selected++;
      selected.push({query:pages[index].query,hit,queryIndex:index});
    }
  }
  // A hit selected by query A also covers query B when its path appears in
  // both result pages. Count represented paths, not only query ownership.
  for(let i=0;i<pages.length;i++)coverage[i].represented=pages[i].hits.filter(hit=>seen.has(hit.path)).length;
  for(const {query,hit} of selected){
    // FTS provides a location-aware snippet; reading just the first lines
    // of a long note is not enough to rule out historical claims.
    let readExcerpt=hit.snippet.slice(0,800),readbackMatchFound=false,readbackTruncated=true;
    let readbackStartLine:number|null=null,readbackEndLine:number|null=null;
    let bodyLabeledSourceUrls:string[]=[],bodyUrlLookupTruncated=true;
    try{
      const chunk=readNoteRange(hit.path,{limit:2000});
      readbackTruncated=chunk.hasMore||!!chunk.truncatedForSize;
      bodyUrlLookupTruncated=readbackTruncated||chunk.content.length>12000;
      bodyLabeledSourceUrls=labeledSourceUrls(chunk.content);
      const lower=chunk.content.toLowerCase();
      const scoped=[compactPeriod,...periodAliases].map(x=>x.toLowerCase());
      const demanded=scoped.find(term=>term.length>0&&query.toLowerCase().includes(term));
      const terms=demanded?[demanded]:hit.matches.slice().reverse();
      const found=terms.map(term=>({term,index:lower.indexOf(term.toLowerCase())}))
        .find(x=>x.index>=0);
      if(found){
        const matchOffset=originalOffsetForLowercaseIndex(chunk.content,found.index);
        let offset=Math.max(0,matchOffset-240);
        if(insideSurrogatePair(chunk.content,offset))offset--;
        let end=Math.min(chunk.content.length,offset+800);
        if(insideSurrogatePair(chunk.content,end))end--;
        readExcerpt=chunk.content.slice(offset,end);readbackMatchFound=true;
        readbackStartLine=chunk.offset+1+chunk.content.slice(0,offset).split("\n").length-1;
        readbackEndLine=readbackStartLine+readExcerpt.split("\n").length-1;
      }
    }catch{/* stale index or unreadable note; retain the FTS candidate only */}
    results.push({path:hit.path,title:hit.title,query,snippet:hit.snippet.slice(0,320),readExcerpt,modified:hit.modified,
      readbackMatchFound,readbackTruncated,readbackStartLine,readbackEndLine,
      provenance:{...provenanceFor(hit.path),bodyLabeledSourceUrls,bodyUrlLookupTruncated}});
  }
  // These are deterministic integrity warnings, not a broker/issuer truth verdict.
  type LineageWarning={path:string;reason:"linked_intake_id_mismatch"|"linked_source_not_indexed"};
  const lineageWarnings=results.flatMap<LineageWarning>(x=>{
    const p=x.provenance;
    if(p.linkedIntakeIdMatches===false)return [{path:x.path,reason:"linked_intake_id_mismatch" as const}];
    if(p.linkedSourcePath&&!p.linkedSourceIndexed)return [{path:x.path,reason:"linked_source_not_indexed" as const}];
    return [];
  });
  if(state==="UNRESOLVED_NEEDS_ORIGINAL"&&results.length)state="HISTORICAL_NOTE_CANDIDATE";
  return {
    status:"READ_ONLY_RESEARCH_PREVIEW_NOT_VERIFIED_NOT_SAVED" as const,
    classification:state,
    rawStructuredClassification:existing.classification,
    query:{domain:input.domain,entity:input.entity,metric:input.metric,period:input.period,source:input.originalSource},
    indexed:{exactMatches,normalizedMatches,conflicts,unknown,totalSameDocument:sameDocument.length,
      candidateCapReached,metadataCapReached,
      candidatePaths:[...new Set(existing.matchingClaims.concat(existing.relatedEventClaims).map(r=>r.path))]},
    historical:{queries:coverage,candidates:results,notExhaustive:true,readExcerptMaxChars:800,
      // A query can return hits while all its unique candidates are omitted
      // by the shared limit; surface that lost coverage explicitly.
      searchTruncated:coverage.some(x=>x.total>x.represented),
      selectionStrategy:"round_robin_per_query" as const,
      periodAliasesUsed:periodAliases,lineageWarnings},
    gates:{sourceAuthenticated:false,claimVerifiedAgainstOriginal:false,semanticDuplicateAdjudicated:false,
      independentEvidenceEstablished:false,canAutoWrite:false,canEditThesis:false,canEditPortfolio:false},
    nextAction:"ANALYST_MUST_COMPARE_ORIGINAL_AND_HISTORY_BEFORE_CANONICAL_WRITEBACK" as const,
    caveats:["FTS is lexical and capped: a missing hit or bounded readback is not evidence of absence; text is untrusted.",
      "When structured candidate/metadata limits are reached, HOLD rather than certifying a duplicate.",
      "Multiple queries share a hard candidate budget; selection is interleaved, and omitted hits remain possible evidence.",
      "Exact/normalized amount equality does not verify accounting basis, publisher, reported period, independent evidence, or thesis impact.",
      "Provenance fields are declared in indexed frontmatter; a linked Source path or hash-like field does not prove original bytes, independent evidence, or remote authenticity.",
      "A URL extracted from a source-labelled line in an old note is only an unverified locator; it is never fetched or independently authenticated.",
      "No schema changes, network requests, Vault writes, or owner approvals were performed."]
  };
}

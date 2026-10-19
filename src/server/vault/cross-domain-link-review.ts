/**
 * Explicit cross-domain navigation candidates for the Investment_OS Vault.
 * This reads declared metadata across company, industry, macro, research and
 * claim registers. It does NOT infer a causal relationship, verify any claim,
 * write back a note, or treat archived AI as independent evidence.
 */
import type {SchemaInspection} from "./investment-knowledge-schema";

export interface KnowledgeLinkNote {
  path:string;
  role:SchemaInspection["role"];
  metadata:Record<string,unknown>;
}
type Reason="explicit_related_path"|"unique_exact_claim_id";
export interface CrossDomainLinkCandidate {
  sourcePath:string;
  targetPath:string;
  relation:Reason;
  declaredReference:string;
  proposedWikilink:string;
  provenance:"note_declared_unverified";
  requiresHumanReview:true;
  canAutoWrite:false;
}
export interface CrossDomainLinkReview {
  status:"read_only_proposals"|"incomplete_index_hold";
  indexedNotesConsidered:number;
  candidateCount:number;
  ambiguousClaimReferences:number;
  unresolvedReferences:number;
  invalidReferences:number;
  alreadyLinkedReferences:number;
  claimIndexTruncated:boolean;
  heldClaimReferences:number;
  sampleTruncated:boolean;
  samples:CrossDomainLinkCandidate[];
  canAutoWrite:false;
  canAutoUpdateThesis:false;
}
const MAX_NOTES=10_000,MAX_REFS_PER_FIELD=40,MAX_SAMPLES=8;
const excludedSource=(path:string,role:SchemaInspection["role"])=>
  role==="archive"||role==="method"||role==="source_receipt"||
  /^(?:05_Thesis|06_Portfolio|07_Sources|09_Templates)(?:\/|$)/i.test(path);
const validPath=(path:string)=>
  path.length<=350&&path.endsWith(".md")&&!path.startsWith("/")&&
  !path.includes("\\")&&!["[","]","|","#","^"].some(ch=>path.includes(ch))&&
  !/[\r\n\0]/.test(path)&&
  !path.split("/").some(part=>part==="."||part===".."||part.startsWith(".")||!part);
const validClaimId=(id:string)=>
  id.length<=120&&/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(id);
function field(metadata:Record<string,unknown>,name:string,
  valid:(x:string)=>boolean):{values:string[];invalid:number}{
  const raw=metadata[name];
  if(raw===undefined||raw===null)return {values:[],invalid:0};
  if(!Array.isArray(raw)||raw.length>MAX_REFS_PER_FIELD)
    return {values:[],invalid:1};
  let invalid=0;
  const values:string[]=[];
  for(const value of raw) {
    if(typeof value!=="string"||!valid(value)||value!==value.trim()){
      invalid++;continue;
    }
    if(!values.includes(value))values.push(value);
  }
  return {values,invalid};
}
const text=(v:unknown):string|null=>
  typeof v==="string"&&v.trim()?v.trim().normalize("NFC"):null;

/** Always pass ALL indexed notes. A partial index cannot prove uniqueness. */
export function planCrossDomainLinkReview(
  notes:readonly KnowledgeLinkNote[],
  indexComplete:boolean,
  alreadyLinked:(source:string,target:string)=>boolean,
):CrossDomainLinkReview {
  const empty:CrossDomainLinkReview={
    status:"incomplete_index_hold",indexedNotesConsidered:notes.length,
    candidateCount:0,ambiguousClaimReferences:0,unresolvedReferences:0,
    invalidReferences:0,alreadyLinkedReferences:0,
    claimIndexTruncated:false,heldClaimReferences:0,
    sampleTruncated:false,samples:[],canAutoWrite:false,canAutoUpdateThesis:false,
  };
  if(!indexComplete||notes.length>MAX_NOTES)return empty;
  const byPath=new Map<string,KnowledgeLinkNote>();
  // Count every declared occurrence, not merely unique file paths. Two
  // instances of one Claim ID inside a single register are still ambiguous.
  const claimOwners=new Map<string,{path:string;occurrences:number}>();
  let claimIndexTruncated=false;
  for(const n of notes) {
    if(!validPath(n.path))continue;
    byPath.set(n.path,n);
    if(n.role!=="structured_claim")continue;
    const raw=n.metadata.claims;
    if(!Array.isArray(raw))continue;
    if(raw.length>100){claimIndexTruncated=true;continue;}
    for(const v of raw) {
      if(!v||typeof v!=="object"||Array.isArray(v))continue;
      const id=text((v as Record<string,unknown>).claim_id);
      if(!id||!validClaimId(id))continue;
      const claim=claimOwners.get(id);
      if(claim)claim.occurrences++;
      else claimOwners.set(id,{path:n.path,occurrences:1});
    }
  }
  const sorted=notes.slice().sort((a,b)=>a.path.localeCompare(b.path));
  const samples:CrossDomainLinkCandidate[]=[];
  const seen=new Set<string>();
  let candidateCount=0,ambiguousClaimReferences=0,unresolvedReferences=0;
  let invalidReferences=0,alreadyLinkedReferences=0,heldClaimReferences=0;
  for(const n of sorted) {
    if(excludedSource(n.path,n.role)||!byPath.has(n.path))continue;
    const direct=field(n.metadata,"related_paths",validPath);
    const claims=field(n.metadata,"related_claim_ids",validClaimId);
    invalidReferences+=direct.invalid+claims.invalid;
    const proposals:{path:string;relation:Reason;ref:string}[]=[];
    for(const p of direct.values) {
      if(!byPath.has(p)){unresolvedReferences++;continue;}
      proposals.push({path:p,relation:"explicit_related_path",ref:p});
    }
    for(const id of claims.values) {
      // One oversized indexed register means uniqueness across ALL indexed
      // register rows cannot be established, so every Claim-ID candidate holds.
      if(claimIndexTruncated){heldClaimReferences++;continue;}
      const owner=claimOwners.get(id);
      if(!owner){unresolvedReferences++;continue;}
      if(owner.occurrences!==1){ambiguousClaimReferences++;continue;}
      proposals.push({path:owner.path,relation:"unique_exact_claim_id",ref:id});
    }
    for(const proposed of proposals) {
      if(proposed.path===n.path)continue;
      const key=JSON.stringify([n.path,proposed.path]);
      if(seen.has(key))continue;
      seen.add(key);
      if(alreadyLinked(n.path,proposed.path)){alreadyLinkedReferences++;continue;}
      candidateCount++;
      if(samples.length<MAX_SAMPLES)samples.push({
        sourcePath:n.path,targetPath:proposed.path,
        relation:proposed.relation,declaredReference:proposed.ref,
        proposedWikilink:`[[${proposed.path.slice(0,-3)}]]`,
        provenance:"note_declared_unverified",
        requiresHumanReview:true,canAutoWrite:false,
      });
    }
  }
  return {
    status:"read_only_proposals",indexedNotesConsidered:notes.length,
    candidateCount,ambiguousClaimReferences,unresolvedReferences,
    invalidReferences,alreadyLinkedReferences,claimIndexTruncated,heldClaimReferences,
    sampleTruncated:candidateCount>samples.length,samples,
    canAutoWrite:false,canAutoUpdateThesis:false,
  };
}

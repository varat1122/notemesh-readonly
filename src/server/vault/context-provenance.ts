import fs from "node:fs";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {resolveNotePath,openVaultFile,MAX_INDEX_BYTES,hasNul,isLfsPointerHead} from "./paths";
import {splitFrontmatter} from "./markdown";
import {env} from "../env";

export function selectedLines(raw: string, search: string[], max: number, role: string) {
  const lines = raw.split(/\r?\n/);
  const frontmatterEnd=lines[0]==="---"?lines.indexOf("---",1):-1;
  const bodyStart=frontmatterEnd>=0?frontmatterEnd+1:0;
  let index = bodyStart, maxHits = 0;
  for (let i = bodyStart; i < Math.min(lines.length, 1200); i++) {
    const lower = lines[i].toLowerCase();
    const hits = search.filter(t => t.length > 1 && lower.includes(t.toLowerCase())).length;
    if (hits > maxHits) { index = i; maxHits = hits; }
  }
  const start = index > bodyStart+15 ? Math.max(bodyStart,index-2) : bodyStart;
  const firstEnd = Math.min(lines.length,start+12);
  let excerpt = `[Source lines ${start+1}-${firstEnd}]\n` + lines.slice(start,firstEnd).join("\n");
  let counterContentEnd:number|null = null;
  // Anchor contradictory evidence even when the highest lexical match is in
  // a note's introduction. Source line labels prevent disjoint snippets from
  // appearing to be one continuous quotation.
  if ((role==="thesis" || role==="evidence_register" || role==="source" || role==="research") && max>=700) {
    const counter = lines.findIndex((s,i) => i < 1200 &&
      /^\s*#{1,6}\s+.*(counter[- ]?evidence|contradict|invalidation|ข้อขัดแย้ง|ข้อโต้แย้ง|ความเสี่ยง)/i.test(s));
    let evidenceLine=-1;
    if(counter>=0)for(let i=counter+1;i<Math.min(lines.length,counter+8);i++){
      if(/^\s*#{1,6}\s/.test(lines[i]))break;
      if(lines[i].trim()){evidenceLine=i;break;}
    }
    if (counter>=0 && (counter<start || counter>=firstEnd)) {
      const secondEnd = Math.min(lines.length,counter+8);
      const addition = `\n\n[Counter-evidence / risk section: source lines ${counter+1}-${secondEnd}]\n` +
        lines.slice(counter,secondEnd).join("\n");
      const space = max-excerpt.length;
      if (space>100) {
        if(evidenceLine>=0)counterContentEnd=excerpt.length+
          `\n\n[Counter-evidence / risk section: source lines ${counter+1}-${secondEnd}]\n`.length+
          lines.slice(counter,evidenceLine+1).join("\n").length;
        excerpt += addition.slice(0,space);
      }
    } else if(counter>=start && evidenceLine>=0 && evidenceLine<firstEnd) {
      counterContentEnd=`[Source lines ${start+1}-${firstEnd}]\n`.length+
        lines.slice(start,evidenceLine+1).join("\n").length;
    }
  }
  const clipped=excerpt.slice(0,max);
  return {
    excerpt:clipped,line:start+1,
    truncated:start>0 || firstEnd<lines.length || clipped.length<excerpt.length,
    counterEvidenceExcerptIncluded:counterContentEnd!==null&&counterContentEnd<=clipped.length,
  };
}

export const instantSchema=z.string().datetime({offset:true});
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const reference=z.object({reference:z.string().min(1).max(600),version:z.string().max(120).optional(),sha256:digest.optional()}).strict();
const producer=z.object({kind:z.enum(["llm","human_analyst","quant_engine","data_adapter"]),
  id:z.string().min(1).max(160),model:z.string().max(160).optional(),method:z.string().max(160).optional(),version:z.string().max(160).optional()}).strict();
const provenanceSummarySchema=z.object({policy:reference.optional(),protocol:reference.optional(),schema:reference.optional(),
  producer:producer.optional(),asOf:instantSchema.nullable().optional(),contextId:z.string().max(100).nullable(),
  coverage:z.string().max(2000).optional(),limitations:z.array(z.string().max(1000)).max(20).optional(),
  status:z.literal("note_declared_not_reverified")}).strict();
const declaredMetadataSchema=z.object({declaredVerification:z.string().max(500).nullable(),declaredEventDate:z.string().max(80).nullable(),
  declaredPublishedAt:z.string().max(80).nullable(),provenanceSummary:provenanceSummarySchema.nullable(),
  declaredAnalysisAsOf:z.string().max(80).nullable().optional(),declaredComparatorEligible:z.boolean().nullable().optional()}).strict();
export function contextDeclaredMetadata(fm:Record<string,unknown>){
  const date=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}/.test(v)?v:null;
  const parsed=researchProvenanceSchema.safeParse(fm.research_provenance);
  let provenanceSummary:z.infer<typeof provenanceSummarySchema>|null=null;
  if(parsed.success){const {context,...p}=parsed.data;provenanceSummary={...p,contextId:context?.id??null,status:"note_declared_not_reverified"};}
  return {declaredVerification:typeof fm.verification==="string"?fm.verification:null,
    declaredEventDate:date(fm.event_date),declaredPublishedAt:date(fm.published_at),provenanceSummary,
    // Absent legacy fields stay absent: do not manufacture semantics or alter
    // the metadata representation of pre-existing context manifests.
    ...(fm.type==="investment_research_review"&&fm.analysis_as_of!==undefined?
      {declaredAnalysisAsOf:analysisAsOfMs(fm.analysis_as_of)!==null?fm.analysis_as_of as string:null}:{}),
    ...(fm.type==="investment_research_review"&&fm.comparator_eligible!==undefined?
      {declaredComparatorEligible:typeof fm.comparator_eligible==="boolean"?fm.comparator_eligible:null}:{})};
}
export const sha256=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
function stable(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+":"+stable(v)).join(",")+"}";
  return JSON.stringify(value);
}
export function normalizeAsOf(value:string|undefined,now=new Date().toISOString()){
  if(value===undefined)return null;
  const parsed=instantSchema.parse(value),ms=Date.parse(parsed);
  if(ms>Date.parse(now))throw Error("asOf must not be later than retrieved time");
  return new Date(ms).toISOString();
}
function availableDate(value:unknown):number|null{
  if(typeof value!=="string")return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const d=Date.parse(value+"T23:59:59.999Z");
    return Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===value?d:null;
  }
  return instantSchema.safeParse(value).success?Date.parse(value):null;
}
/** Declared knowledge horizon of the whole analytical Review, NOT an economic
 * event or import time. Date-only precision is conservatively end-of-day UTC. */
export const analysisAsOfMs=(value:unknown):number|null=>availableDate(value);
export const analysisAsOfSchema=z.string().max(80).refine(value=>analysisAsOfMs(value)!==null,
  "analysisAsOf must be a valid YYYY-MM-DD or ISO timestamp with timezone");
export class ContextExclusion extends Error{}
/** Current bytes and a conservative filesystem-version bound, NOT a historical
 * snapshot. ctime catches edits/sync even if mtime is copied/backdated. */
export function readContextVersion(notePath:string,asOf:string|null){
  const abs=resolveNotePath(notePath),{fd,stat,head}=openVaultFile(abs);
  try{
    if(stat.size>MAX_INDEX_BYTES||hasNul(head)||isLfsPointerHead(head))throw new ContextExclusion("unreadable_or_unindexed_size");
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),current=fs.lstatSync(abs);
    if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||
      current.ino!==stat.ino||current.dev!==stat.dev||current.ctimeMs!==stat.ctimeMs)
      throw new ContextExclusion("version_changed_during_read");
    const content=bytes.toString("utf8");
    if(!Buffer.from(content).equals(bytes))throw new ContextExclusion("invalid_utf8");
    const fm=splitFrontmatter(content).data as Record<string,unknown>;
    const times:number[]=[];
    const research=fm.research_provenance as ResearchProvenance|undefined;
    const availability=[...["known_at","available_at","received_at","received_on","published_at","publication_date",
      "review_date","created_at","updated_at","updated","imported_at","imported_on"].map(field=>fm[field]),
      research?.asOf,research?.context?.retrievedAt,
      fm.type==="investment_research_review"?fm.analysis_as_of:undefined];
    for(const value of availability){
      if(value==null)continue;
      const n=availableDate(value);
      if(n===null){if(asOf)throw new ContextExclusion("unusable_availability_metadata");}
      else times.push(n);
    }
    const versionMs=Math.max(stat.mtimeMs,stat.ctimeMs,stat.birthtimeMs||0);
    const declaredMs=times.length?Math.max(...times):null;
    if(asOf&&(versionMs>Date.parse(asOf)||declaredMs!==null&&declaredMs>Date.parse(asOf)))
      throw new ContextExclusion("after_cutoff_current_version_or_availability");
    return {content,fm,contentSha256:sha256(bytes),bytes:bytes.length,
      fileVersionAt:new Date(Math.ceil(versionMs)).toISOString(),
      declaredAvailabilityAt:declaredMs===null?null:new Date(declaredMs).toISOString()};
  }finally{fs.closeSync(fd);}
}

export const contextEntrySchema=z.object({
  role:z.enum(["rules","thesis","evidence_register","timeline","company","industry","source","research","archive"]),path:z.string().min(1).max(600),identity:z.string().min(1).max(600),
  metadata:declaredMetadataSchema,
  contentSha256:digest,excerptSha256:digest,bytes:z.number().int().nonnegative(),
  fileVersionAt:instantSchema,declaredAvailabilityAt:instantSchema.nullable(),
  observedAt:instantSchema,excerptBase64:z.string().max(12000),line:z.number().int().positive(),
  truncated:z.boolean()
}).strict();
const manifestPayloadSchema=z.object({
  format:z.literal("ios-context-manifest/1"),retrievalStartedAt:instantSchema,retrievedAt:instantSchema,asOf:instantSchema.nullable(),
  method:z.literal("bounded_fts5_and_subject_index"),
  query:z.object({question:z.string().max(1200),issuers:z.array(z.string().max(120)).max(6),
    industry:z.string().max(140).nullable(),focus:z.string().max(20),maxNotes:z.number().int().min(5).max(16),
    maxChars:z.number().int().min(4500).max(18000)}).strict(),
  selectionTerms:z.array(z.string().min(1).max(120)).max(12),
  entityBindings:z.array(z.object({requested:z.string().max(120),canonical:z.string().max(120),path:z.string().max(600).nullable(),
    resolution:z.string().max(80),contentSha256:digest.nullable(),fileVersionAt:instantSchema.nullable(),observedAt:instantSchema}).strict()).max(6),
  entries:z.array(contextEntrySchema).max(16),
  coverage:z.object({considered:z.number().int().min(0).max(240),selected:z.number().int().min(0).max(16),
    excerptChars:z.number().int().nonnegative().max(18000),candidateLimit:z.literal(240),discoveryTruncated:z.boolean()}).strict(),
  limitations:z.array(z.string().max(1000)).max(40)
}).strict();
export const contextManifestSchema=manifestPayloadSchema.extend({id:z.string().regex(/^CTX-[a-f0-9]{64}$/),
  attestation:z.object({kind:z.literal("current_server_key_hmac_sha256"),mac:digest}).strict()}).strict();
export type ContextManifest=z.infer<typeof contextManifestSchema>;
function attest(id:string){
  // Domain-separated key derivation from existing server key material. No new
  // secret, database table or Vault mutation. Key/origin/Vault relocation
  // invalidates old attestations; the bytes/digests remain auditable.
  const key=createHmac("sha256",env.encryptionKey).update("ios-context-manifest-key/v1").digest();
  return createHmac("sha256",key).update(JSON.stringify([env.baseUrl,env.vaultDir,id])).digest("hex");
}
export function createContextManifest(payload:z.infer<typeof manifestPayloadSchema>):ContextManifest{
  const checked=manifestPayloadSchema.parse(payload);
  const id="CTX-"+sha256(stable(checked));
  return {...checked,id,attestation:{kind:"current_server_key_hmac_sha256",mac:attest(id)}};
}
export function verifyContextManifest(value:unknown){
  const m=contextManifestSchema.parse(value),{id,attestation,...payload}=m;
  if(createContextManifest(payload).id!==id)throw Error("CONTEXT_MANIFEST_DIGEST_MISMATCH");
  if(!timingSafeEqual(Buffer.from(attestation.mac,"hex"),Buffer.from(attest(id),"hex")))
    throw Error("CONTEXT_MANIFEST_ATTESTATION_MISMATCH");
  if(Date.parse(m.retrievedAt)>Date.now()||Date.parse(m.retrievalStartedAt)>Date.parse(m.retrievedAt)||m.asOf&&Date.parse(m.asOf)>Date.parse(m.retrievalStartedAt))
    throw Error("CONTEXT_MANIFEST_TIME_INVALID");
  if(new Set(m.entries.map(e=>e.path)).size!==m.entries.length||m.coverage.selected!==m.entries.length||m.coverage.considered<m.coverage.selected||
    m.coverage.excerptChars!==m.entries.reduce((n,e)=>n+Buffer.from(e.excerptBase64,"base64").toString("utf8").length,0)||m.entries.length>m.query.maxNotes||
    m.coverage.excerptChars>m.query.maxChars)throw Error("CONTEXT_MANIFEST_COVERAGE_MISMATCH");
  let remaining=m.query.maxChars;
  for(const binding of m.entityBindings){
    if(binding.observedAt!==m.retrievedAt)throw Error("CONTEXT_ENTITY_OBSERVATION_MISMATCH");
    if(binding.path){
      const current=readContextVersion(binding.path,m.asOf);
      if(current.contentSha256!==binding.contentSha256||current.fileVersionAt!==binding.fileVersionAt)
        throw Error("CONTEXT_VERSION_CHANGED: "+binding.path);
    }else if(binding.contentSha256!==null||binding.fileVersionAt!==null)throw Error("CONTEXT_UNRESOLVED_ENTITY_CANNOT_HAVE_VERSION");
  }
  for(const e of m.entries){
    const excerptBytes=Buffer.from(e.excerptBase64,"base64"),excerpt=excerptBytes.toString("utf8");
    if(excerptBytes.toString("base64")!==e.excerptBase64||!Buffer.from(excerpt).equals(excerptBytes)||excerpt.length>2000)throw Error("CONTEXT_EXCERPT_ENCODING_INVALID");
    if(e.observedAt!==m.retrievedAt||sha256(excerpt)!==e.excerptSha256)throw Error("CONTEXT_EXCERPT_BINDING_MISMATCH");
    const current=readContextVersion(e.path,m.asOf);
    if(stable(e.metadata)!==stable(contextDeclaredMetadata(current.fm)))throw Error("CONTEXT_DECLARED_METADATA_MISMATCH");
    if(e.identity!==(typeof current.fm.intake_id==="string"?current.fm.intake_id:e.path))throw Error("CONTEXT_IDENTITY_MISMATCH");
    if(current.contentSha256!==e.contentSha256||current.bytes!==e.bytes||
      current.fileVersionAt!==e.fileVersionAt||current.declaredAvailabilityAt!==e.declaredAvailabilityAt)
      throw Error("CONTEXT_VERSION_CHANGED: "+e.path);
    const selected=selectedLines(current.content,m.selectionTerms,Math.min(2000,remaining),e.role);
    if(excerpt!==selected.excerpt||e.line!==selected.line||e.truncated!==selected.truncated)
      throw Error("CONTEXT_EXCERPT_NOT_FROM_SOURCE: "+e.path);
    remaining-=excerpt.length;
  }
  return m;
}
export const researchProvenanceSchema=z.object({
  policy:reference.optional(),protocol:reference.optional(),schema:reference.optional(),
  producer:producer.optional(),
  asOf:instantSchema.nullable().optional(),context:contextManifestSchema.optional(),
  coverage:z.string().max(2000).optional(),limitations:z.array(z.string().max(1000)).max(20).optional()
}).strict();
export type ResearchProvenance=z.infer<typeof researchProvenanceSchema>;
export function validateResearchProvenance(value:unknown){
  const p=researchProvenanceSchema.parse(value);
  const asOf=normalizeAsOf(p.asOf??undefined);
  if(p.context){
    verifyContextManifest(p.context);
    if(asOf&&asOf!==p.context.asOf)throw Error("PROVENANCE_CONTEXT_CUTOFF_MISMATCH");
  }
  return p;
}

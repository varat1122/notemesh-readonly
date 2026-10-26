/**
 * M5.6 source receipt identity. Research classification and entity order must
 * never determine whether the same preserved source is captured twice.
 * Existing M5.3/M5.4 intake IDs stay in place; no Vault migration is implied.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {readNote} from "./notes";

const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const idFromPath=(path:string)=>/^00_Inbox\/ChatGPT\/Investment Intake - (IN-[A-F0-9]{16})\.md$/.exec(path)?.[1];
function canonicalUrl(url:string|null|undefined){
  if(!url?.trim())return null;
  try {
    const u=new URL(url.trim().replace(/[),.;]+$/g,""));
    if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return url.trim();
    u.hash="";
    for(const k of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();
    return u.toString();
  }catch{return url.trim();}
}
function sourceFence(text:string){
  const max=Math.max(2,...[...(text.match(/`+/g)??[])].map(x=>x.length));
  const fence="`".repeat(max+1);
  return `${fence}text\n${text}${text.endsWith("\n")?"":"\n"}${fence}\n`;
}
export interface SourceIdentityInput {
  extractedText:string;
  inputFormat:string;
  sourceKind:string;
  sourceUrl?:string|null;
  rawAttachmentSha256?:string|null;
  verifiedAttachmentPath?:string|null;
  eventDate:string|null;
  publicationDate:string|null;
  existingIntakeId?:string;
}
export interface SourceIdentityResolution {
  planId:string;
  existingSourcePath:string|null;
  existingSourceSha256:string|null;
  mode:"new_v3"|"linked_existing"|"explicit_existing";
  textSha256:string;
}
const value=(fm:Record<string,unknown>,key:string)=>typeof fm[key]==="string"?fm[key] as string:null;
export function resolveSourceIdentityM56(input:SourceIdentityInput):SourceIdentityResolution {
  const textSha256=sha(input.extractedText);
  const requestedUrl=canonicalUrl(input.sourceUrl);
  const rows=db().prepare(`SELECT path,frontmatter FROM notes WHERE path LIKE '00_Inbox/ChatGPT/Investment Intake - IN-%'
    AND json_valid(frontmatter)=1 AND json_extract(frontmatter,'$.type')='investment_source_intake'
    AND json_extract(frontmatter,'$.source_text_sha256')=? ORDER BY path LIMIT 101`).all(textSha256) as
    {path:string;frontmatter:string}[];
  if(rows.length>100)throw Error("M56_SOURCE_CANDIDATES_TRUNCATED: manual reconciliation required");
  const matching:{path:string;id:string;contentHash:string}[]=[];
  let provenanceConflict=false;
  for(const row of rows){
    const id=idFromPath(row.path);
    if(!id)continue;
    let fm:Record<string,unknown>;
    try {fm=JSON.parse(row.frontmatter) as Record<string,unknown>;}catch{continue;}
    if(value(fm,"intake_id")!==id||canonicalUrl(value(fm,"source_url"))!==requestedUrl||
      value(fm,"event_date")!==input.eventDate||
      value(fm,"published_at")!==input.publicationDate)continue;
    // An attached source is not interchangeable with a text-only receipt.
    // Legacy receipts do not record attachment SHA: hold rather than silently
    // attributing a different original binary to an old note.
    const attached=Boolean(input.rawAttachmentSha256);
    const storedVerified=value(fm,"attachment_status")==="hash_readback_verified_user_bytes";
    if(attached||storedVerified){
      if(!attached||!storedVerified||!input.verifiedAttachmentPath||
        value(fm,"attachment_path")!==input.verifiedAttachmentPath){
        provenanceConflict=true;
        continue;
      }
    }
    let content:string;
    try {content=readNote(row.path).content;}catch{continue;}
    if(!content.includes(sourceFence(input.extractedText)))continue;
    if(value(fm,"source_kind")!==input.sourceKind||value(fm,"input_format")!==input.inputFormat){
      provenanceConflict=true;
      continue;
    }
    matching.push({path:row.path,id,contentHash:sha(content)});
  }
  if(input.existingIntakeId){
    if(!/^IN-[A-F0-9]{16}$/.test(input.existingIntakeId))throw Error("M56_INVALID_EXISTING_INTAKE_ID");
    const exact=matching.find(x=>x.id===input.existingIntakeId);
    if(!exact)throw Error("M56_EXISTING_INTAKE_PROVENANCE_MISMATCH: no Source may be created");
    return {planId:exact.id,existingSourcePath:exact.path,existingSourceSha256:exact.contentHash,
      mode:"explicit_existing",textSha256};
  }
  if(provenanceConflict)throw Error("M56_SOURCE_PROVENANCE_CONFLICT: review source kind, format or attachment before a new receipt");
  if(matching.length>1)throw Error("M56_AMBIGUOUS_EXISTING_SOURCE: supply exact existingIntakeId; no Source may be created");
  if(matching.length===1){const exact=matching[0];return {planId:exact.id,existingSourcePath:exact.path,
    existingSourceSha256:exact.contentHash,
    mode:"linked_existing",textSha256};}
  // New receipts use only original-source identity, never analyst classifications,
  // publisher label, entity order, translation, or Review prose.
  const digest=sha(["investment_os_source_v3",textSha256,
    requestedUrl??"",input.rawAttachmentSha256??"",input.eventDate??"unknown_event_date",
    input.publicationDate??"unknown_publication_date"].join("\n"));
  return {planId:"IN-"+digest.slice(0,16).toUpperCase(),existingSourcePath:null,existingSourceSha256:null,
    mode:"new_v3",textSha256};
}

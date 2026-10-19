/**
 * Read-only historical link handoff for the separately authorized Safe Edit
 * capability. A human must choose the EXACT source line and inspect both
 * current notes. This module never calls preview/apply or mutates the Vault.
 */
import {createHash} from "node:crypto";
import {db} from "../db";
import {indexer} from "./indexer";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {planHistoricalLinkReview,type LinkReviewNote} from "./historical-link-review";
import {splitFrontmatter} from "./markdown";
import {resolveNotePath,withVaultFile} from "./paths";
import {change as safeEditChange} from "../safe-edit/schema";

const MAX_ROWS=10_000;
const MAX_SAFE_EDIT_BYTES=100_000;
const sha256=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const normalizedEntity=(value:unknown)=>
  typeof value==="string"?value.trim().normalize("NFC").toLocaleLowerCase("en"):null;
type Input={sourcePath:string;targetPath:string;anchorLine:string};
type Row={path:string;frontmatter:string|null};
const roleOf=(row:Row):LinkReviewNote=>{
  let parsed:Record<string,unknown>={};
  try {
    const value=row.frontmatter?JSON.parse(row.frontmatter):{};
    if(value&&typeof value==="object"&&!Array.isArray(value))parsed=value;
  }catch{/* Invalid indexed metadata cannot supply a trusted candidate. */}
  return {
    path:row.path,
    entity:typeof parsed.entity==="string"?parsed.entity:null,
    role:inspectCanonicalKnowledgeMetadata(row.path,parsed).role,
  };
};
function currentText(rel:string,maxBytes:number) {
  return withVaultFile(resolveNotePath(rel),({stat,read})=>{
    if(!stat.isFile()||stat.nlink!==1||stat.size>maxBytes)
      throw Error("historical_link_note_not_safe_for_readonly_handoff");
    const bytes=read();
    if(bytes.length>maxBytes||bytes.includes(0))
      throw Error("historical_link_note_not_safe_for_readonly_handoff");
    const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    const parsed=splitFrontmatter(text);
    if(parsed.invalid)throw Error("historical_link_invalid_frontmatter");
    return {text,parsed,hash:sha256(bytes)};
  });
}

export function prepareHistoricalLinkEdit(input:Input) {
  if(!input||typeof input.sourcePath!=="string"||typeof input.targetPath!=="string"||
    typeof input.anchorLine!=="string"||
    input.sourcePath.length>350||input.targetPath.length>350||
    input.anchorLine.length<8||input.anchorLine.length>2000||
    !input.anchorLine.trim()||/[\r\n\0]/.test(input.anchorLine))
    throw Error("historical_link_invalid_selection");
  // Fail closed if source enumeration or link resolution is incomplete.
  if(!indexer().ready)throw Error("historical_link_index_not_ready");
  const d=db();
  const rows=d.prepare("SELECT path,frontmatter FROM notes ORDER BY path LIMIT ?")
    .all(MAX_ROWS+1) as Row[];
  if(rows.length>MAX_ROWS)throw Error("historical_link_index_truncated");
  const notes=rows.map(roleOf);
  const already=d.prepare("SELECT 1 FROM links WHERE source_path=? AND resolved_path=? LIMIT 1");
  const proposal=planHistoricalLinkReview(
    notes,true,(source,target)=>Boolean(already.get(source,target)),input.sourcePath,
  );
  const selected=proposal.samples.find(s=>s.targetPath===input.targetPath);
  if(proposal.candidatesFound!==1||!selected)
    throw Error("historical_link_candidate_not_verified");

  // Read actual on-disk bytes, not the potentially stale FTS excerpt.
  // Safe Edit separately rechecks the source version at preview/apply.
  const source=currentText(input.sourcePath,MAX_SAFE_EDIT_BYTES);
  const target=currentText(input.targetPath,1_000_000);
  const currentSource=inspectCanonicalKnowledgeMetadata(input.sourcePath,source.parsed.data);
  const currentTarget=inspectCanonicalKnowledgeMetadata(input.targetPath,target.parsed.data);
  if(currentSource.role!==notes.find(n=>n.path===input.sourcePath)?.role||
    currentTarget.role!==notes.find(n=>n.path===input.targetPath)?.role||
    normalizedEntity(source.parsed.data.entity)!==normalizedEntity(selected.declaredEntity)||
    normalizedEntity(target.parsed.data.entity)!==normalizedEntity(selected.declaredEntity))
    throw Error("historical_link_metadata_changed_since_index");

  const body=source.parsed.body;
  const bodyLines=body.split(/\r?\n/);
  const matching=bodyLines.filter(line=>line===input.anchorLine);
  if(matching.length!==1||source.text.indexOf(input.anchorLine)!==
    source.text.lastIndexOf(input.anchorLine))
    throw Error("historical_link_anchor_not_unique_or_outside_body");
  // Never anchor a generated edit in code, YAML, or other structure that a
  // link reviewer has not explicitly validated as normal prose.
  let fence:{ch:string;len:number}|null=null;
  let inProse=false;
  for(const line of bodyLines) {
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(marker) {
      if(!fence)fence={ch:marker[1][0],len:marker[1].length};
      else if(marker[1][0]===fence.ch&&marker[1].length>=fence.len)fence=null;
      continue;
    }
    if(line===input.anchorLine&&!fence&&
      !line.includes("`")&&!line.includes("<!--")&&!line.includes("-->")&&
      !/^\s*[|<>]/.test(line))
      inProse=true;
  }
  if(!inProse)throw Error("historical_link_anchor_not_plain_prose");
  if(body.includes(selected.proposedWikilink))
    throw Error("historical_link_already_present_on_disk");
  const eol=source.text.includes("\r\n")?"\r\n":"\n";
  const addition="Related note (navigation only; not independent evidence): "+selected.proposedWikilink;
  const candidate=safeEditChange.parse({
    kind:"replace",oldText:input.anchorLine,
    newText:input.anchorLine+eol+addition,
  });
  if(Buffer.byteLength(source.text,"utf8")+Buffer.byteLength(eol+addition,"utf8")>
    MAX_SAFE_EDIT_BYTES)throw Error("historical_link_safe_edit_size_limit");
  return {
    status:"read_only_safe_edit_handoff_needs_review" as const,
    sourcePath:input.sourcePath,targetPath:input.targetPath,
    declaredEntity:selected.declaredEntity,
    sourceSha256:source.hash,targetSha256:target.hash,
    reasoning:"Exact matching declared entity is a navigation candidate only; read and approve both notes.",
    safeEditTemplate:{
      path:input.sourcePath,
      reason:"Human-reviewed historical navigation link; no source or thesis verification claimed",
      change:candidate,
    },
    operationId:"generate_new_unique_id_in_separate_safe_edit_preview" as const,
    requiresHumanReview:true as const,
    previewRecorded:false as const,
    vaultModified:false as const,
    canAutoWrite:false as const,
    canAutoUpdateThesis:false as const,
  };
}

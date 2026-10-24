import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSetting } from "../db";
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { db } from "../db";
import { env } from "../env";
import { assertHeadroom } from "../vault/disk";
import { resolveNotePath, toVaultRelative, openNoFollow, assertDescriptorInVault } from "../vault/paths";
import { reindexPath } from "../vault/indexer";
import { recordLocalModification } from "../vault/modified";
import { splitFrontmatter, extractStructure } from "../vault/markdown";
import { audit } from "../audit";
import { inProcessDrWriterFence } from "../backup/writer-fence";
import { previewSchema, applySchema, operationId as idSchema, type PreviewInput } from "./schema";

export const sha256 = (s:string|Buffer) => crypto.createHash("sha256").update(s).digest("hex");
// Internal transaction context, never accepted from MCP input.
export const gitPilotContext = new AsyncLocalStorage<{base:string}>();
function gitPilotGuard(p:PreviewInput) {
  if(getSetting("sync_backend")!=="git") return;
  if(!gitPilotContext.getStore() || process.env.GIT_SAFE_WRITEBACK_PILOT!=="1" ||
    p.path!=="PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md" || p.change.kind!=="create")
    throw Error("Git Safe Edit requires the scoped pilot transaction");
}
export function recordGitPilot(id:string,actor:string,detail:Record<string,unknown>) {
  return inProcessDrWriterFence.withWriteSync(()=>{
    const r=owned(id,actor), receipt=r.receipt?JSON.parse(r.receipt):{};
    receipt.gitPilot={...receipt.gitPilot,...detail};
    store().prepare("UPDATE safe_edit_operations SET receipt=? WHERE id=?").run(JSON.stringify(receipt),id);
    log(id,actor,"git_pilot",detail);
  },"protected_safe_edits");
}
const MAX_BYTES = 100_000;
const TTL = 30 * 60_000;
export function assertEnabled() {
  if (process.env.SAFE_EDIT_ENABLED !== "1") throw Error("Safe Edit is disabled; administrator deployment review required");
  if (process.env.SAFE_EDIT_SINGLE_WRITER !== "1") throw Error("Safe Edit requires a single replica and an exclusive server vault writer");
  if (process.platform !== "linux") throw Error("Safe Edit requires Linux descriptor-anchored atomic writes");
}
interface RecordRow {
  id:string; actor:string; payload:string; before_text:string; after_text:string;
  before_hash:string; after_hash:string; token_hash:string; expires:number;
  status:string; approval:string|null; receipt:string|null;
}
function store() {
  const d=db();
  d.exec(`CREATE TABLE IF NOT EXISTS safe_edit_operations (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload TEXT NOT NULL,
    before_text TEXT NOT NULL, after_text TEXT NOT NULL, before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL, token_hash TEXT NOT NULL, expires INTEGER NOT NULL,
    status TEXT NOT NULL, approval TEXT, receipt TEXT);
    CREATE TABLE IF NOT EXISTS safe_edit_events (
      at TEXT NOT NULL, operation_id TEXT NOT NULL, actor TEXT NOT NULL,
      event TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS safe_edit_claims (
      event_key TEXT NOT NULL, delta_hash TEXT NOT NULL, path TEXT NOT NULL, verification TEXT NOT NULL,
      operation_id TEXT NOT NULL, PRIMARY KEY(event_key,delta_hash,path));`);
  return d;
}
function log(id:string, actor:string, event:string, detail:Record<string,unknown>={}) {
  store().prepare("INSERT INTO safe_edit_events VALUES(?,?,?,?,?)").run(new Date().toISOString(),id,actor,event,JSON.stringify(detail));
  audit(`safe_edit_${event}`,{operationId:id,actor,scopes:["vault:read","vault:edit"],...detail});
}
function row(id:string) {
  const r=store().prepare("SELECT * FROM safe_edit_operations WHERE id=?").get(idSchema.parse(id)) as RecordRow|undefined;
  if(!r) throw Error("Unknown operation");
  return r;
}
function owned(id:string, actor:string) {
  const r=row(id); if(r.actor!==actor) throw Error("Operation belongs to another OAuth client"); return r;
}
function target(p:string) {
  // Reject traversal before normalization, including paths that stay in root.
  if(p.split(/[\\/]/).includes("..")) throw Error("Traversal is not allowed");
  const abs=resolveNotePath(p), rel=toVaultRelative(abs);
  if(!rel.endsWith(".md")) throw Error("Only Markdown notes can be edited");
  if(/^(07_Sources|06_Portfolio)(\/|$)/i.test(rel)) throw Error("Source archives and portfolio records are protected; save a separate correction/review");
  if(!fs.statSync(path.dirname(abs)).isDirectory()) throw Error("Parent folder must already exist");
  return {abs,rel};
}
function read(abs:string):string|null {
  let fd:number;
  try{fd=openNoFollow(abs);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT") return null;throw e;}
  try {
    const stat=fs.fstatSync(fd); if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_BYTES) throw Error("Note must be a regular unlinked Markdown file of at most 100 KB");
    const bytes=fs.readFileSync(fd);
    if(bytes.length>MAX_BYTES||bytes.includes(0)) throw Error("Invalid note size or binary content");
    return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  } finally {fs.closeSync(fd);}
}
function document(s:string) {
  if(Buffer.byteLength(s)>MAX_BYTES||s.includes("\0")||Buffer.from(s,"utf8").toString("utf8")!==s) throw Error("Content must be valid UTF-8 Markdown of at most 100 KB");
  if(s.startsWith("\uFEFF")) throw Error("UTF-8 BOM requires manual normalization before editing");
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(s);
  if(/^---\r?\n/.test(s)&&!match) throw Error("Unclosed YAML frontmatter");
  if(match) {
    const parsed=parseDocument(match[1],{uniqueKeys:true});
    if(parsed.errors.length) throw Error("Invalid or duplicate YAML frontmatter keys");
    const value=parsed.toJS({maxAliasCount:20});
    const fm=splitFrontmatter(s); if(fm.invalid) throw Error("Invalid YAML mapping");
    if(Array.isArray(value) || typeof value!=="object" || value===null) throw Error("Frontmatter must be a mapping");
  }
  return splitFrontmatter(s);
}
function eventKey(e:NonNullable<PreviewInput["evidence"]>) {
  return sha256(JSON.stringify([e.entity,e.event,e.period,e.originalSource].map(x=>x.trim().normalize("NFC").toLowerCase())));
}
function checkEvidence(input:PreviewInput,before:string) {
  const e=input.evidence;
  if(input.path.startsWith("05_Thesis/")&&!e&&input.change.kind!=="rollback") throw Error("Thesis edits require a structured evidence review");
  if(!e) return;
  if(e.classification==="duplicate") throw Error("Duplicate evidence cannot mutate living knowledge");
  if(e.classification==="confirmation"&&(!e.independent||e.sourceType==="archived_ai")) throw Error("Confirmation requires independent evidence; archived AI is not independent");
  if(e.verification==="verified_against_primary"&&(!e.primaryUrl||!e.verified_at||e.sourceType!=="primary")) throw Error("Primary verification requires a dated primary source actually reviewed");
  if(e.sourceType==="archived_ai"&&e.verification==="verified_against_primary") throw Error("Archived AI cannot be upgraded to verified fact");
  const previous=store().prepare("SELECT verification,delta_hash FROM safe_edit_claims WHERE event_key=? AND path=?").all(eventKey(e),input.path) as {verification:string;delta_hash:string}[];
  if(previous.some(r=>r.delta_hash===sha256(e.delta.trim()))) throw Error("Duplicate event and delta already recorded");
  if(previous.length&&e.classification==="new_event") throw Error("Known event: classify as added_detail, correction, contradiction or unresolved");
  const fm=splitFrontmatter(before).data;
  if(fm.verification==="not_reverified"&&input.change.kind==="frontmatter"&&input.change.properties.verification==="verified_against_primary"&&e.verification!=="verified_against_primary") throw Error("Not-reverified evidence cannot be promoted without primary verification");
  for(const rel of e.relatedPaths) {
    const resolved=resolveNotePath(rel);
    if(!fs.existsSync(resolved)) throw Error("Related evidence path does not exist");
  }
  if(/Current Thesis\.md$/.test(input.path)&&input.change.kind!=="rollback") {
    const stem=input.path.replace(/Current Thesis\.md$/,"");
    for(const suffix of ["Evidence Register.md","Change Log.md"]) {
      const p=stem+suffix;
      if(!e.relatedPaths.includes(p)) throw Error("Current Thesis requires linked Evidence Register and Change Log");
      const content=read(resolveNotePath(p));
      if(!content?.includes(eventKey(e))) throw Error("Record this event key in Evidence Register and Change Log before updating Current Thesis");
    }
  }
}
function exactReplace(before:string,oldText:string,newText:string) {
  const at=before.indexOf(oldText);
  if(at<0||before.indexOf(oldText,at+1)>=0) throw Error("Exact text must match once; missing or ambiguous match");
  const bodyStart=before.length-document(before).body.length;
  if(at<bodyStart) throw Error("Use update_frontmatter for metadata; body replacement cannot change YAML");
  return before.slice(0,at)+newText+before.slice(at+oldText.length);
}
function frontmatter(before:string,props:Record<string,unknown>) {
  document(before);
  const m=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(before);
  const doc=parseDocument(m?.[1]??"",{uniqueKeys:true});
  for(const [key,value] of Object.entries(props)) doc.set(key,value);
  // YAML CST retains comments and unknown keys; only allowlisted properties enter.
  return `---\n${doc.toString()}---\n${m?before.slice(m[0].length):before}`;
}
function calculate(input:PreviewInput,before:string,actor:string):string {
  const c=input.change;
  if(c.kind==="replace") return exactReplace(before,c.oldText,c.newText);
  if(c.kind==="frontmatter") {
    const current=document(before).data.verification;
    if(c.properties.verification==="verified_against_primary"&&current!=="verified_against_primary"&&input.evidence?.verification!=="verified_against_primary") throw Error("Verification upgrade requires primary evidence review");
    return frontmatter(before,c.properties);
  }
  if(c.kind==="create") return c.content;
  if(c.kind==="rollback") {
    const old=owned(c.operationId,actor), previous=JSON.parse(old.payload) as PreviewInput;
    if(old.status!=="written"||previous.path!==input.path||old.after_hash!==sha256(before)) throw Error("Rollback version conflict or wrong target");
    if(previous.change.kind==="create") throw Error("Rollback never deletes a created note; use a correction");
    const saved=fs.readFileSync(backupPath(old.id));
    if(sha256(saved)!==old.before_hash) throw Error("Backup checksum mismatch");
    return new TextDecoder("utf-8",{fatal:true}).decode(saved);
  }
  const structure=extractStructure(document(before).body);
  const headings=structure.headings.filter(h=>h.text===c.heading);
  if(headings.length!==1) throw Error("Section heading must match exactly once outside code fences");
  const lines=document(before).body.split("\n"), h=headings[0];
  const next=structure.headings.find(n=>n.line>h.line&&n.level<=h.level);
  const index=next?next.line-1:lines.length;
  const review=input.evidence ? `\n<!-- evidence-event-key:${eventKey(input.evidence)} -->\n\n`+"```json\n"+JSON.stringify(input.evidence,null,2)+"\n```\n" : "";
  const append=`\n### ${c.date} · ${input.operationId}\n\n${c.content}\n${review}\n<!-- safe-edit:${input.operationId} -->\n`;
  if(before.includes(`<!-- safe-edit:${input.operationId} -->`)) throw Error("Operation already appended");
  const prefix=before.slice(0,before.length-document(before).body.length);
  lines.splice(index,0,append);
  return prefix+lines.join("\n");
}
// A complete, lossless diff (including final newline via JSON strings). The UI
// renders text, never HTML from notes. Exact before/after hashes bind approval.
function diff(before:string,after:string) {
  const a=before.split("\n"),b=after.split("\n");let start=0,end=0;
  while(start<a.length&&start<b.length&&a[start]===b[start]) start++;
  while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end]) end++;
  return {startLine:start+1,removed:a.slice(start,a.length-end),added:b.slice(start,b.length-end),
    beforeEndsWithNewline:before.endsWith("\n"),afterEndsWithNewline:after.endsWith("\n")};
}
function warnings(before:string,after:string) {
  const a=extractStructure(document(before).body),b=extractStructure(document(after).body);
  const warnings:string[]=[];
  for(const link of b.links) {
    const target=link.split("#")[0]; if(!target) continue;
    const exists=store().prepare("SELECT 1 FROM notes WHERE path=? OR path LIKE ? LIMIT 1").get(target.endsWith(".md")?target:`${target}.md`,`%/${target}.md`);
    if(!exists) warnings.push(`Unresolved wikilink: ${target}`);
  }
  for(const link of a.links) if(!b.links.some(x=>x===link)) warnings.push(`Removed wikilink: ${link}`);
  for(const line of after.split("\n")) if(line.trim().startsWith("|")&&line.split("|").length<3) throw Error("Malformed Markdown table row");
  if(warnings.length>100) throw Error("Too many link warnings; split or repair note");
  return [...new Set(warnings)];
}
function publicPreview(r:RecordRow) {
  const input=JSON.parse(r.payload) as PreviewInput;
  return {operationId:r.id,path:input.path,reason:input.reason,status:r.status,
    beforeHash:r.before_hash,afterHash:r.after_hash,expiresAt:new Date(r.expires).toISOString(),
    diff:diff(r.before_text,r.after_text),warnings:warnings(r.before_text,r.after_text),
    evidenceEventKey:input.evidence?eventKey(input.evidence):null,
    requiresAdminApproval:requiresApproval(r),approved:Boolean(r.approval),
    approvalUrl:`${env.baseUrl}/api/safe-edit-approval?id=${r.id}`};
}
function requiresApproval(r:RecordRow) {
  const p=JSON.parse(r.payload) as PreviewInput;
  if(p.path==="PILOT_001_GIT_SAFE_WRITEBACK_2026-10-24.md") return true;
  // Protect all thesis changes, including first creation and rollback; never
  // infer investment approval from an OAuth grant or model-supplied boolean.
  return p.path.startsWith("05_Thesis/") || [r.before_text,r.after_text].some(text=>{
    const data=document(text).data;
    return data.user_endorsed===true || data.user_endorsed==="true" || data.status==="user_endorsed";
  });
}
export function preview(input:unknown,actor:string) {
  return inProcessDrWriterFence.withWriteSync(()=>previewUnderFence(input,actor), "protected_safe_edits");
}
function previewUnderFence(input:unknown,actor:string) {
  assertEnabled();const p=previewSchema.parse(input);gitPilotGuard(p);const t=target(p.path);p.path=t.rel;
  if(store().prepare("SELECT 1 FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? AND status='writing' LIMIT 1").get(p.path)) throw Error("This path has an interrupted operation; administrator recovery required");
  const before=read(t.abs);
  if(p.change.kind==="create"?before!==null:before===null) throw Error("Create never overwrites; other edits require an existing note");
  if(getSetting("sync_backend")==="git" && store().prepare("SELECT 1 FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? AND id<>? AND status<>'preview' LIMIT 1").get(p.path,p.operationId))
    throw Error("Git pilot already attempted; manual reconciliation required");
  const existing=store().prepare("SELECT * FROM safe_edit_operations WHERE id=?").get(p.operationId) as RecordRow|undefined;
  if(existing) {
    if(existing.actor!==actor||existing.payload!==JSON.stringify(p)) throw Error("Operation ID reused for different input or actor");
    return {...publicPreview(existing),previewToken:null,retry:"Use original preview token; it is never stored in plaintext"};
  }
  const size=store().prepare("SELECT count(*) AS n,coalesce(sum(length(CAST(before_text||after_text AS BLOB))),0) AS bytes FROM safe_edit_operations").get() as {n:number;bytes:number};
  if(size.n>=1000||size.bytes+200_000>20_000_000) throw Error("Safe Edit journal quota reached; administrator archival required");
  document(before??"");checkEvidence(p,before??"");
  const after=calculate(p,before??"",actor);
  const afterMetadata=document(after).data,beforeMetadata=document(before??"").data;
  if(afterMetadata.verification==="verified_against_primary"&&beforeMetadata.verification!=="verified_against_primary") {
    if(p.evidence?.verification!=="verified_against_primary" || ["archived_ai","chatgpt_analysis"].includes(String(afterMetadata.source_type))) throw Error("Primary verification cannot be asserted by note content without a primary evidence review");
  }
  warnings(before??"",after);
  // Body operations cannot silently introduce metadata or rewrite provenance.
  if(p.change.kind==="replace"||p.change.kind==="append") {
    if(JSON.stringify(document(before??"").data)!==JSON.stringify(document(after).data)) throw Error("Body edit changed metadata");
  }
  if(after===before) throw Error("No change");
  if(p.change.kind==="create") {
    const match=store().prepare("SELECT path FROM notes WHERE lower(title)=lower(?) LIMIT 1").get(path.basename(p.path,".md"));
    if(match) throw Error("An existing note has the same title; inspect before creating");
    const paths=store().prepare("SELECT path FROM notes WHERE size=?").all(Buffer.byteLength(after)) as {path:string}[];
    for(const item of paths) if(read(resolveNotePath(item.path))===after) throw Error("Identical note content already exists");
  }
  assertHeadroom(Buffer.byteLength(after)+Buffer.byteLength(before??"")*3+32_000);
  const token=crypto.randomBytes(32).toString("hex"),expires=Date.now()+TTL;
  store().prepare("INSERT INTO safe_edit_operations VALUES(?,?,?,?,?,?,?,?,?,'preview',NULL,NULL)").run(p.operationId,actor,JSON.stringify(p),before??"",after,sha256(before??""),sha256(after),sha256(token),expires);
  log(p.operationId,actor,"preview",{path:p.path,beforeHash:sha256(before??""),afterHash:sha256(after),reason:p.reason});
  return {...publicPreview(row(p.operationId)),previewToken:token};
}
export function adminPreview(id:string) {
  return inProcessDrWriterFence.withWriteSync(()=>{ assertEnabled();return publicPreview(row(id)); }, "protected_safe_edits");
}
export function approve(id:string,adminId:string,afterHash:string) {
  return inProcessDrWriterFence.withWriteSync(()=>approveUnderFence(id,adminId,afterHash), "protected_safe_edits");
}
function approveUnderFence(id:string,adminId:string,afterHash:string) {
  assertEnabled();const r=row(id);
  if(r.status!=="preview"||Date.now()>r.expires||afterHash!==r.after_hash) throw Error("Approval expired or does not match the reviewed diff");
  store().prepare("UPDATE safe_edit_operations SET approval=? WHERE id=? AND status='preview'").run(`admin:${adminId}`,id);
  log(id,`admin:${adminId}`,"approved",{afterHash});return {approved:true};
}
function backupDir() {
  const dir=path.join(env.dataDir,"safe-edit-backups");
  try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST") throw e;}
  const stat=fs.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory()) throw Error("Unsafe backup directory");
  return dir;
}
function backupPath(id:string) {return path.join(backupDir(),`${idSchema.parse(id)}.md`);}
function durable(file:string,content:string) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function syncDir(dir:string) {const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function backup(r:RecordRow,p:PreviewInput) {
  const name=backupPath(r.id);
  if(fs.existsSync(name)) {if(sha256(fs.readFileSync(name))!==r.before_hash) throw Error("Existing backup checksum mismatch");}
  else durable(name,r.before_text);
  const manifest=path.join(backupDir(),`${r.id}.json`);
  const value=JSON.stringify({operationId:r.id,path:p.path,actor:r.actor,scopes:["vault:read","vault:edit"],at:new Date().toISOString(),beforeHash:r.before_hash,afterHash:r.after_hash,reason:p.reason});
  if(!fs.existsSync(manifest)) durable(manifest,value);
  syncDir(backupDir());
}
// All names used after opening the directory are anchored to that descriptor,
// not a re-resolved ancestor. create uses link(2) for no-clobber publication.
function atomic(r:RecordRow,p:PreviewInput) {
  const {abs}=target(p.path),dir=path.dirname(abs);
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  let temp="";
  try {
    assertDescriptorInVault(fd);
    const anchored=`/proc/self/fd/${fd}`,dest=path.join(anchored,path.basename(abs));
    if(sha256(read(abs)??"")!==r.before_hash||(p.change.kind==="create"&&fs.existsSync(dest))) throw Error("Version conflict before atomic write");
    temp=path.join(anchored,`.safe-edit-${r.id}-${crypto.randomBytes(8).toString("hex")}.tmp`);
    durable(temp,r.after_text);
    if(sha256(read(abs)??"")!==r.before_hash) throw Error("Version conflict before publish");
    const current=fs.statSync(dir),opened=fs.fstatSync(fd);
    if(current.ino!==opened.ino||current.dev!==opened.dev) throw Error("Parent folder changed during edit");
    if(p.change.kind==="create") fs.linkSync(temp,dest);
    else fs.renameSync(temp,dest);
    fs.fsyncSync(fd);
  } finally {if(temp) fs.rmSync(temp,{force:true});fs.closeSync(fd);}
}
export function status(id:string,actor:string) {
  return inProcessDrWriterFence.withWriteSync(()=>statusUnderFence(id,actor), "protected_safe_edits");
}
function statusUnderFence(id:string,actor:string) {
  const r=owned(id,actor);
  return {operationId:id,status:r.status,path:(JSON.parse(r.payload) as PreviewInput).path,
    beforeHash:r.before_hash,afterHash:r.after_hash,receipt:r.receipt?JSON.parse(r.receipt):null};
}
/** Internal readback only: prove current bytes through this actor's durable
 * append receipts. No snapshots or other clients' history leave the engine.
 * Unjournaled, replace/rollback, ambiguous, partial or cross-client changes hold.
 */
export function verifyWrittenAppendHistory(id:string,actor:string,currentText:string){
  return inProcessDrWriterFence.withWriteSync(()=>{
    const first=owned(id,actor),initial=previewSchema.parse(JSON.parse(first.payload));
    const validate=(r:RecordRow)=>{
      const p=previewSchema.parse(JSON.parse(r.payload));
      const s=statusUnderFence(r.id,actor),receipt=s.receipt;
      if(r.actor!==actor||p.path!==initial.path||p.change.kind!=="append"||
        s.status!=="written"||!receipt||receipt.operationId!==r.id||
        receipt.path!==p.path||receipt.beforeHash!==r.before_hash||
        receipt.afterHash!==r.after_hash||receipt.write!=="written"||
        receipt.readback!=="verified"||receipt.reindex!=="verified"||
        sha256(r.before_text)!==r.before_hash||sha256(r.after_text)!==r.after_hash||
        r.before_hash===r.after_hash||
        (requiresApproval(r)&&!r.approval)||
        calculate(p,r.before_text,actor)!==r.after_text)
        throw Error("graph_readback_timeline_append_history_invalid_hold");
    };
    validate(first);
    const rows=store().prepare(`SELECT * FROM safe_edit_operations
      WHERE actor=? AND json_extract(payload,'$.path')=? AND status='written'`)
      .all(actor,initial.path) as RecordRow[];
    let tip=first.after_hash,text=first.after_text,count=0;
    const seen=new Set([first.id]),currentHash=sha256(currentText);
    while(tip!==currentHash){
      const next=rows.filter(r=>r.before_hash===tip&&!seen.has(r.id));
      if(next.length!==1||++count>1000)
        throw Error("graph_readback_timeline_append_history_missing_or_ambiguous_hold");
      validate(next[0]);
      if(next[0].before_text!==text)
        throw Error("graph_readback_timeline_append_snapshot_mismatch_hold");
      seen.add(next[0].id);tip=next[0].after_hash;text=next[0].after_text;
    }
    if(text!==currentText)
      throw Error("graph_readback_timeline_append_snapshot_mismatch_hold");
    return {operationAfterHash:first.after_hash,currentAfterHash:currentHash,
      subsequentAuthenticatedAppendCount:count};
  }, "protected_safe_edits");
}
export function apply(input:unknown,actor:string) {
  return inProcessDrWriterFence.withWriteSync(()=>applyUnderFence(input,actor), "protected_safe_edits");
}
function applyUnderFence(input:unknown,actor:string) {
  assertEnabled();const args=applySchema.parse(input),r=owned(args.operationId,actor);
  gitPilotGuard(JSON.parse(r.payload));
  if(!crypto.timingSafeEqual(Buffer.from(sha256(args.previewToken),"hex"),Buffer.from(r.token_hash,"hex"))||args.expectedHash!==r.before_hash) throw Error("Invalid preview token or expected hash");
  if(r.status==="written") return status(r.id,actor);
  if(Date.now()>r.expires) throw Error("Preview expired; review a fresh diff");
  if(requiresApproval(r)&&!r.approval) throw Error("Explicit admin approval of this exact thesis diff is required; open approvalUrl");
  const p=JSON.parse(r.payload) as PreviewInput;
  if(r.status==="writing") throw Error("Interrupted write: inspect receipt and backup; do not replay without recovery review");
  // Cross-process lock deliberately has no stale timeout. A crash requires
  // administrator recovery, rather than silently racing an unknown writer.
  const lock=path.join(env.dataDir,"safe-edit.lock");
  fs.mkdirSync(lock,{mode:0o700});
  try {
    const {abs}=target(p.path),current=read(abs);
    if((p.change.kind==="create"?current!==null:current===null)||sha256(current??"")!==r.before_hash) throw Error("Version conflict: re-preview; another writer changed this note");
    checkEvidence(p,current??"");
    document(r.after_text);assertHeadroom(Buffer.byteLength(r.before_text)*2+Buffer.byteLength(r.after_text)+64_000);
    backup(r,p);
    const receipt={operationId:r.id,path:p.path,beforeHash:r.before_hash,afterHash:r.after_hash,
      writtenAt:null as string|null,write:"pending",readback:"pending",reindex:"pending",
      sync:"unverified",remoteSync:"unverified",mobileSync:"unverified",backup:`safe-edit-backups/${r.id}.md`,
      approval:r.approval,review:p.evidence??null,
      ...(r.receipt?{gitPilot:JSON.parse(r.receipt).gitPilot}:{})};
    store().prepare("UPDATE safe_edit_operations SET status='writing',receipt=? WHERE id=?").run(JSON.stringify(receipt),r.id);
    log(r.id,actor,"write_started",{path:p.path,beforeHash:r.before_hash,afterHash:r.after_hash});
    try {
      atomic(r,p);
      receipt.write="written";receipt.writtenAt=new Date().toISOString();
      if(sha256(read(abs)??"")!==r.after_hash) throw Error("Readback hash mismatch; backup retained");
      receipt.readback="verified";
      recordLocalModification(p.path);reindexPath(p.path);
      const indexed=store().prepare("SELECT mtime,size FROM notes WHERE path=?").get(p.path) as {mtime:number;size:number}|undefined;
      receipt.reindex=indexed?.size===Buffer.byteLength(r.after_text)&&indexed.mtime===Math.round(fs.statSync(abs).mtimeMs)?"verified":"unverified";
      store().transaction(()=>{
        if(p.evidence) store().prepare("INSERT OR IGNORE INTO safe_edit_claims VALUES(?,?,?,?,?)").run(eventKey(p.evidence),sha256(p.evidence.delta.trim()),p.path,p.evidence.verification,r.id);
        store().prepare("UPDATE safe_edit_operations SET status='written',receipt=? WHERE id=?").run(JSON.stringify(receipt),r.id);
        log(r.id,actor,"written",{path:p.path,beforeHash:r.before_hash,afterHash:r.after_hash});
      })();
    } catch(e) {
      // A rename may have happened even when fsync/readback/index fails.
      // Persist truthful stages; never roll over a concurrent device edit.
      if(sha256(read(abs)??"")===r.after_hash) {receipt.write="written";receipt.writtenAt??=new Date().toISOString();}
      store().prepare("UPDATE safe_edit_operations SET receipt=? WHERE id=?").run(JSON.stringify(receipt),r.id);
      log(r.id,actor,"interrupted",{path:p.path,write:receipt.write});throw e;
    }
    return status(r.id,actor);
  } catch(e) {log(r.id,actor,"refused",{path:p.path});throw e;}
  finally {fs.rmdirSync(lock);}
}

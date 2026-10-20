/**
 * OFFLINE, read-only coverage check against a segregated Vault + SQLite copy.
 *
 * NEVER use this as a Production Vault reader or a DR/issuer/independence
 * certification. The supplied snapshot MUST already exist: this function
 * does not capture, copy, freeze, checkpoint, restore or mutate any file.
 * SQLite opens read-only, and no output includes original note prose.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {TextDecoder} from "node:util";
import Database from "better-sqlite3";
import {extractStructure,splitFrontmatter} from "./markdown";

const MAX_FILES=15_000,MAX_INDEX_ROWS=10_000,MAX_DEPTH=32;
const MAX_MARKDOWN_BYTES=1_000_000,MAX_TOTAL_MARKDOWN_BYTES=512*1024*1024;
const MAX_SAMPLES=12;
type IndexedNote={
  rowid:number;path:string;frontmatter:string|null;
  mtime:number;size:number;
};
type IndexedAttachment={path:string;mtime:number;size:number};
type Reason=
  |"physical_note_not_indexed"|"indexed_note_absent_on_disk"
  |"physical_attachment_not_indexed"|"indexed_attachment_absent_on_disk"
  |"unsafe_or_symlink_path"|"snapshot_note_oversized"
  |"index_note_version_mismatch"|"index_note_frontmatter_mismatch"
  |"index_note_body_mismatch"|"index_note_links_mismatch"
  |"index_note_missing_fts"|"index_attachment_version_mismatch"
  |"invalid_markdown_bytes_or_frontmatter"|"index_orphan_fts_or_link";
const VALID_NOTE=/^[^\\\0\r\n]+\.md$/i;
function safeRelative(rel:string){
  return Boolean(rel)&&rel.length<=1024&&!path.isAbsolute(rel)&&
    !rel.includes("\\")&&!rel.split("/").some(x=>
      !x||x==="."||x===".."||x.startsWith("."));
}
function ownedRoot(abs:string,label:string){
  if(!path.isAbsolute(abs))throw Error("snapshot_absolute_path_required");
  const info=fs.lstatSync(abs);
  if(info.isSymbolicLink())throw Error("snapshot_symlink_root_refused:"+label);
  return fs.realpathSync(abs);
}
export type OfflineSnapshotIssue={reason:Reason;path:string};
export function verifyOfflineSnapshotCoverage(snapshotRoot:string) {
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID||
    process.env.RAILWAY_SERVICE_ID)
    throw Error("snapshot_acceptance_refused_inside_railway_runtime");
  if(typeof snapshotRoot!=="string"||!path.isAbsolute(snapshotRoot))
    throw Error("snapshot_absolute_path_required");
  const root=ownedRoot(snapshotRoot,"snapshot");
  const live=path.resolve(process.env.DATA_DIR??"./data");
  if(root===live||root.startsWith(live+path.sep)||live.startsWith(root+path.sep))
    throw Error("snapshot_acceptance_live_data_directory_refused");
  const vault=path.join(root,"vault"),databaseFile=path.join(root,"app.sqlite");
  if(!fs.lstatSync(vault).isDirectory()||fs.lstatSync(vault).isSymbolicLink())
    throw Error("snapshot_vault_directory_invalid");
  if(!fs.lstatSync(databaseFile).isFile()||
    fs.lstatSync(databaseFile).isSymbolicLink())
    throw Error("snapshot_sqlite_file_invalid");
  if(fs.realpathSync(vault)!==vault||fs.realpathSync(databaseFile)!==databaseFile)
    throw Error("snapshot_symlinked_asset_refused");
  const issues:OfflineSnapshotIssue[]=[];
  const counts:Record<string,number>={};
  const issue=(reason:Reason,p:string)=>{
    counts[reason]=(counts[reason]??0)+1;
    if(issues.length<MAX_SAMPLES)issues.push({reason,path:p});
  };
  // Ignore hidden Obsidian/config entries exactly as the existing indexer
  // does. Every non-hidden symlink, even to a directory, is a HOLD.
  const physicalNotes=new Map<string,string>(),physicalAttachments=new Map<string,string>();
  let fileCount=0;
  function walk(dir:string,parts:string[],depth:number){
    if(depth>MAX_DEPTH)throw Error("snapshot_scan_depth_exceeded_hold");
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(entry.name.startsWith("."))continue;
      const rel=[...parts,entry.name].join("/");
      fileCount++;
      if(fileCount>MAX_FILES)throw Error("snapshot_scan_file_limit_exceeded_hold");
      if(!safeRelative(rel)){issue("unsafe_or_symlink_path",rel.slice(0,300));continue;}
      const abs=path.join(dir,entry.name);
      if(entry.isSymbolicLink()){issue("unsafe_or_symlink_path",rel);continue;}
      if(entry.isDirectory()){walk(abs,[...parts,entry.name],depth+1);continue;}
      if(!entry.isFile()){issue("unsafe_or_symlink_path",rel);continue;}
      if(VALID_NOTE.test(rel))physicalNotes.set(rel,abs);
      else physicalAttachments.set(rel,abs);
    }
  }
  walk(vault,[],0);

  // fileMustExist + read-only ensures even SQLite/WAL is never created here.
  const d=new Database(databaseFile,{readonly:true,fileMustExist:true});
  try{
    d.pragma("query_only=ON");
    return d.transaction(()=>{
      const quick=(d.pragma("quick_check") as {quick_check:string}[])
        .every(r=>r.quick_check==="ok");
      if(!quick)throw Error("snapshot_sqlite_quick_check_failed_hold");
      const indexed=d.prepare(
        "SELECT rowid,path,frontmatter,mtime,size FROM notes ORDER BY path LIMIT ?"
      ).all(MAX_INDEX_ROWS+1) as IndexedNote[];
      if(indexed.length>MAX_INDEX_ROWS)throw Error("snapshot_index_row_cap_exceeded_hold");
      const attachments=d.prepare(
        "SELECT path,mtime,size FROM attachments ORDER BY path LIMIT ?"
      ).all(MAX_FILES+1) as IndexedAttachment[];
      if(attachments.length>MAX_FILES)throw Error("snapshot_attachment_row_cap_exceeded_hold");
      const notePaths=new Set(indexed.map(x=>x.path));
      const attachmentPaths=new Set(attachments.map(x=>x.path));
      for(const p of physicalNotes.keys())
        if(!notePaths.has(p))issue("physical_note_not_indexed",p);
      for(const p of physicalAttachments.keys())
        if(!attachmentPaths.has(p))issue("physical_attachment_not_indexed",p);
      const manifest=createHash("sha256").update("investment-os-offline-markdown-v1\n");
      const utf8=new TextDecoder("utf-8",{fatal:true});
      let checkedNotes=0,readBytes=0;
      const findBody=d.prepare("SELECT body FROM notes_fts WHERE rowid=?");
      const findLinks=d.prepare(
        "SELECT target FROM links WHERE source_path=? ORDER BY target"
      );
      for(const row of indexed){
        if(!safeRelative(row.path)||!VALID_NOTE.test(row.path)){
          issue("unsafe_or_symlink_path",row.path);continue;
        }
        const p=physicalNotes.get(row.path);
        if(!p){issue("indexed_note_absent_on_disk",row.path);continue;}
        const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        try{
          const before=fs.fstatSync(fd);
          if(!before.isFile()||before.nlink!==1){
            issue("unsafe_or_symlink_path",row.path);continue;
          }
          if(before.size>MAX_MARKDOWN_BYTES){
            issue("snapshot_note_oversized",row.path);continue;
          }
          readBytes+=before.size;
          if(readBytes>MAX_TOTAL_MARKDOWN_BYTES)
            throw Error("snapshot_scan_byte_limit_exceeded_hold");
          const bytes=fs.readFileSync(fd);
          const after=fs.fstatSync(fd);
          if(bytes.length!==before.size||after.size!==before.size||
            after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs){
            issue("index_note_version_mismatch",row.path);continue;
          }
          const digest=createHash("sha256").update(bytes).digest("hex");
          manifest.update(JSON.stringify([row.path,digest])+"\n");
          checkedNotes++;
          if(Math.round(after.mtimeMs)!==row.mtime||bytes.length!==row.size)
            issue("index_note_version_mismatch",row.path);
          let decoded:string;
          try{decoded=utf8.decode(bytes);}
          catch{issue("invalid_markdown_bytes_or_frontmatter",row.path);continue;}
          if(bytes.includes(0)){
            issue("invalid_markdown_bytes_or_frontmatter",row.path);continue;
          }
          const parsed=splitFrontmatter(decoded);
          if(parsed.invalid){
            issue("invalid_markdown_bytes_or_frontmatter",row.path);continue;
          }
          const meta=Object.keys(parsed.data).length?
            JSON.stringify(parsed.data):null;
          if(meta!==row.frontmatter)issue("index_note_frontmatter_mismatch",row.path);
          const body=findBody.get(row.rowid) as {body:string}|undefined;
          if(!body)issue("index_note_missing_fts",row.path);
          else if(body.body!==parsed.body)
            issue("index_note_body_mismatch",row.path);
          const indexedTargets=(findLinks.all(row.path) as {target:string}[])
            .map(x=>x.target);
          const actualTargets=[...new Set(extractStructure(parsed.body).links)].sort();
          if(JSON.stringify(actualTargets)!==JSON.stringify(indexedTargets))
            issue("index_note_links_mismatch",row.path);
        }finally{fs.closeSync(fd);}
      }
      let checkedAttachments=0;
      for(const row of attachments){
        if(!safeRelative(row.path)){
          issue("unsafe_or_symlink_path",row.path);continue;
        }
        const p=physicalAttachments.get(row.path);
        if(!p){issue("indexed_attachment_absent_on_disk",row.path);continue;}
        const st=fs.lstatSync(p);
        if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1){
          issue("unsafe_or_symlink_path",row.path);continue;
        }
        checkedAttachments++;
        if(Math.round(st.mtimeMs)!==row.mtime||st.size!==row.size)
          issue("index_attachment_version_mismatch",row.path);
      }
      const orphanFts=(d.prepare(
        "SELECT COUNT(*) AS n FROM notes_fts f "+
        "WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.rowid=f.rowid)"
      ).get() as {n:number}).n;
      const orphanLinks=(d.prepare(
        "SELECT COUNT(*) AS n FROM links l "+
        "WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.path=l.source_path)"
      ).get() as {n:number}).n;
      if(orphanFts||orphanLinks)
        issue("index_orphan_fts_or_link",
          `orphan_fts=${orphanFts};orphan_links=${orphanLinks}`);
      const failures=Object.values(counts).reduce((a,b)=>a+b,0);
      return {
        status:failures===0?
          "snapshot_markdown_index_reconciled_not_originals_verified" as const:
          "snapshot_coverage_hold" as const,
        scope:"isolated_snapshot_physical_markdown_bytes_fts_links_and_attachment_metadata" as const,
        scannedPhysicalNotes:physicalNotes.size,
        indexedMarkdownNotes:indexed.length,
        comparedMarkdownNotes:checkedNotes,
        scannedPhysicalAttachments:physicalAttachments.size,
        indexedAttachments:attachments.length,
        checkedAttachmentMetadata:checkedAttachments,
        indexOrphanFtsRows:orphanFts,indexOrphanLinkRows:orphanLinks,
        issueCounts:counts,issueSamples:issues,issueSampleTruncated:failures>issues.length,
        markdownContentManifestSha256:manifest.digest("hex"),
        markdownBytesRead:readBytes,
        sqliteQuickCheckPassed:true as const,
        // Deliberately do not imply frozen source storage, immutable mount,
        // independent issuer attribution, full archival originals or restore.
        immutableMountVerified:false as const,
        sourceOriginalArchiveCoverageVerified:false as const,
        attachmentBytesVerified:false as const,
        originalSourceIndependenceVerified:false as const,
        investmentClaimFactsVerified:false as const,
        reviewerAuthenticated:false as const,
        approvedVaultChanges:0 as const,
        canAutoWrite:false as const,
        canAutoUpdateThesis:false as const,
        disasterRecoveryAccepted:false as const,
        nextStep:"A clean report reconciles indexed Markdown/links and attachment metadata inside the supplied offline copy ONLY. Independently prove snapshot isolation, raw-original archive bytes and hashes, cross-device synchronization, and DR restore before any Production acceptance." as const,
      };
    })();
  }finally{d.close();}
}

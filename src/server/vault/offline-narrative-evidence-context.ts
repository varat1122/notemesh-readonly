/**
 * PR #85: read-only lexical retrieval of old prose with exact note-line
 * citations from a segregated, physically/index-reconciled snapshot.
 *
 * Search terms and output snippets are UNTRUSTED TEXT. Never infer duplicate,
 * claim correctness, publisher authenticity, causal earnings or Thesis impact
 * from FTS, imported dates, related wording or historical archived AI.
 * No network, no write, no MCP, no Production Vault access.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {splitFrontmatter} from "./markdown";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";

const SHA=/^[a-f0-9]{64}$/;
const MAX_NOTES=10_000,MAX_HITS=80,MAX_SHOW=12;
const MAX_NOTE_BYTES=100_000,MAX_SNIPPET_CHARS=300;
const digest=(v:Buffer|string)=>createHash("sha256").update(v).digest("hex");
type IndexedRow={path:string;title:string;frontmatter:string|null;
  mtime:number;size:number;body:string};
type EvidenceSnippet={
  line:number;excerpt:string;truncated:boolean;
  matchedTerms:string[];quoteKind:"untrusted_historical_note_text";
};
function term(v:unknown,max=60):v is string{
  return typeof v==="string"&&v.trim().length>=2&&
    v.length<=max&&/^[\p{L}\p{N}][\p{L}\p{N} _./-]*$/u.test(v)&&
    !/[\r\n\0]/.test(v);
}
function ftsLiteral(x:string):string{
  // All tokens are FTS phrase operands, never user-supplied FTS grammar.
  return '"'+x.replace(/"/g,'""')+'"';
}
function safePath(rel:string){
  return rel.length<=350&&rel.endsWith(".md")&&!path.isAbsolute(rel)&&
    !rel.includes("\\")&&!rel.split("/").some(s=>
      !s||s==="."||s===".."||s.startsWith("."));
}
function protectedPath(p:string){
  return /^(?:05_Thesis|06_Portfolio|09_Templates)(?:\/|$)/i.test(p)||
    /(?:^|\/)[^/]*(?:current[\s_-]*thesis|evidence[\s_-]*register|portfolio)[^/]*\.md$/i.test(p);
}
function readExactBody(root:string,row:IndexedRow) {
  if(!safePath(row.path)||protectedPath(row.path))
    throw Error("narrative_candidate_protected_or_unsafe_path_hold");
  const full=path.join(root,"vault",...row.path.split("/"));
  if(fs.realpathSync(full)!==full)
    throw Error("narrative_note_symlink_path_hold");
  const fd=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const a=fs.fstatSync(fd);
    if(!a.isFile()||a.nlink!==1||a.size>MAX_NOTE_BYTES||
      a.size!==row.size||Math.round(a.mtimeMs)!==row.mtime)
      throw Error("narrative_note_index_version_mismatch_hold");
    const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd);
    if(b.size!==a.size||b.mtimeMs!==a.mtimeMs||
      b.ctimeMs!==a.ctimeMs||bytes.length!==a.size||bytes.includes(0))
      throw Error("narrative_note_bytes_changed_during_read_hold");
    const fullText=new TextDecoder("utf8",{fatal:true}).decode(bytes);
    const parsed=splitFrontmatter(fullText);
    if(parsed.invalid||parsed.body!==row.body)
      throw Error("narrative_note_fts_body_stale_hold");
    const indexed=Object.keys(parsed.data).length?
      JSON.stringify(parsed.data):null;
    if(indexed!==row.frontmatter)
      throw Error("narrative_note_index_frontmatter_stale_hold");
    return {parsed,noteSha256:digest(bytes)};
  }finally{fs.closeSync(fd);}
}
function snippets(body:string,offset:number,words:string[]){
  const lines=body.split("\n");
  const found:EvidenceSnippet[]=[];
  let fenced=false,htmlComment=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].replace(/\r$/,"");
    if(/^ {0,3}(?:\u0060{3,}|~{3,})/.test(line)){
      fenced=!fenced;continue;
    }
    if(line.includes("<!--"))htmlComment=true;
    if(fenced||htmlComment){
      if(line.includes("-->"))htmlComment=false;
      continue;
    }
    if(!line.trim()||/^\s*(?:<|>|\||[-*] \[[ xX]\])/.test(line))
      continue;
    const normalized=line.normalize("NFC").toLocaleLowerCase("en");
    const hits=words.filter(x=>normalized.includes(x));
    if(!hits.length)continue;
    const text=line.slice(0,MAX_SNIPPET_CHARS);
    const trimmed=line.length>MAX_SNIPPET_CHARS;
    // Avoid asserting a hit if all matching words are beyond truncation.
    const visible=text.normalize("NFC").toLocaleLowerCase("en");
    const matched=hits.filter(x=>visible.includes(x));
    if(!matched.length)continue;
    found.push({
      line:offset+i+1,excerpt:text,truncated:trimmed,
      matchedTerms:matched,
      quoteKind:"untrusted_historical_note_text" as const,
    });
    if(found.length>=2)break;
  }
  return found;
}
export type OfflineNarrativeRequest={
  snapshotRoot:string;expectedMarkdownManifestSha256:string;
  entity:string;keywords:string[];
};
export function retrieveOfflineNarrativeEvidence(req:OfflineNarrativeRequest){
  if(!req||typeof req!=="object"||!SHA.test(req.expectedMarkdownManifestSha256)||
    !term(req.entity,24)||!Array.isArray(req.keywords)||
    req.keywords.length<1||req.keywords.length>6||
    !req.keywords.every(w=>term(w)))
    throw Error("narrative_search_requires_bounded_entity_and_keywords");
  const words=[...new Set([req.entity,...req.keywords]
    .map(w=>w.trim().normalize("NFC").toLocaleLowerCase("en")))];
  const start=verifyOfflineSnapshotCoverage(req.snapshotRoot);
  if(start.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
    start.markdownContentManifestSha256!==req.expectedMarkdownManifestSha256)
    throw Error("narrative_snapshot_manifest_or_index_stale_hold");
  const root=fs.realpathSync(req.snapshotRoot);
  const db=new Database(path.join(root,"app.sqlite"),{
    readonly:true,fileMustExist:true,
  });
  try{
    db.pragma("query_only=ON");
    return db.transaction(()=>{
      const noteCount=(db.prepare("SELECT COUNT(*) AS n FROM notes")
        .get() as {n:number}).n;
      if(noteCount>MAX_NOTES)
        throw Error("narrative_index_scope_exceeds_cap_hold");
      // OR broadens lexical recall, without claiming complete semantic coverage.
      // FTS5 safely accepts quoted string operands via parameter binding.
      const query=words.map(ftsLiteral).join(" OR ");
      const matches=db.prepare(
        "SELECT n.path,n.title,n.frontmatter,n.mtime,n.size,f.body "+
        "FROM notes_fts AS f JOIN notes AS n ON n.rowid=f.rowid "+
        "WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts), n.path LIMIT ?"
      ).all(query,MAX_HITS+1) as IndexedRow[];
      let skippedProtected=0,scannedSelected=0;
      const picked: Array<{
        path:string;title:string;noteSha256:string;
        role:string;sourceType:string|null;independence:string;
        eventKey:string|null;eventDate:string|null;
        publishedAt:string|null;importedAt:string|null;
        declaredSourceUrl:string|null;declaredSourceHash:string|null;
        exactLineCitations:EvidenceSnippet[];
        sameDeclaredSourceFamilyAsOtherNotes:boolean;
        sourceFamilyDeclarationKey:string|null;
        retrievalMeaning:"lexical_mention_not_fact_verification";
      }>=[];
      for(const row of matches.slice(0,MAX_HITS)){
        if(!safePath(row.path)||protectedPath(row.path)){
          skippedProtected++;continue;
        }
        scannedSelected++;
        // The FTS row is only a candidate; verify exact physical bytes and
        // index text before letting any excerpt reach an analyst.
        const note=readExactBody(root,row);
        const inspect=inspectCanonicalKnowledgeMetadata(row.path,note.parsed.data);
        const excerpts=snippets(note.parsed.body,note.parsed.fmOffset,words);
        if(excerpts.length===0)continue;
        const raw=note.parsed.data;
        const plain=(x:unknown)=>typeof x==="string"&&x.length<=600?x:null;
        const originalUrl=plain(raw.original_source)??plain(raw.source_url);
        const originalHash=plain(raw.original_source_sha256);
        const family=originalUrl&&originalHash&&SHA.test(originalHash)?
          digest(originalUrl+"\0"+originalHash):null;
        picked.push({
          path:row.path,title:row.title,noteSha256:note.noteSha256,
          role:inspect.role,sourceType:inspect.normalizedSourceType,
          independence:inspect.independenceAssessment,
          eventKey:plain(raw.event_key),
          eventDate:inspect.eventDate,publishedAt:inspect.publishedAt,
          importedAt:inspect.importedAt,
          declaredSourceUrl:originalUrl,
          declaredSourceHash:originalHash&&SHA.test(originalHash)?originalHash:null,
          exactLineCitations:excerpts,
          sameDeclaredSourceFamilyAsOtherNotes:false,
          sourceFamilyDeclarationKey:family,
          retrievalMeaning:"lexical_mention_not_fact_verification",
        });
      }
      const families=new Map<string,number>();
      for(const item of picked){
        if(item.sourceFamilyDeclarationKey)
          families.set(item.sourceFamilyDeclarationKey,
            (families.get(item.sourceFamilyDeclarationKey)??0)+1);
      }
      for(const item of picked)
        item.sameDeclaredSourceFamilyAsOtherNotes=Boolean(
          item.sourceFamilyDeclarationKey&&
          (families.get(item.sourceFamilyDeclarationKey)??0)>1);
      const final=verifyOfflineSnapshotCoverage(req.snapshotRoot);
      if(final.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
        final.markdownContentManifestSha256!==start.markdownContentManifestSha256)
        throw Error("narrative_snapshot_changed_after_readback_hold");
      return {
        status:"offline_lexical_history_packet_requires_analyst_review" as const,
        query:{entity:req.entity,keywords:req.keywords},
        scope:{
          indexedNotes:noteCount,
          scannedFtsHits:matches.length,
          candidateLimit:MAX_HITS,
          matchingFtsHitsTruncated:matches.length>MAX_HITS,
          protectedCandidatesExcluded:skippedProtected,
          selectedPhysicalNotesVerified:scannedSelected,
          returnedExcerptNotes:Math.min(picked.length,MAX_SHOW),
          returnedExcerptNotesTruncated:picked.length>MAX_SHOW,
          physicalMarkdownManifestSha256:start.markdownContentManifestSha256,
          historicalProseSemanticallyExhaustive:false as const,
          completeCrossDeviceHistoryVerified:false as const,
          checkedPrimarySourceAuthenticity:false as const,
          queriedFtsWithBoundedLiteralPhrases:true as const,
        },
        references:picked.slice(0,MAX_SHOW).map(item=>({
          ...item,
          // Do not leak cross-document digest as a provenance assertion.
          sourceFamilyDeclarationKey:item.sourceFamilyDeclarationKey,
        })),
        classification:"lexical_context_not_new_or_duplicate_proof" as const,
        confidence:"only_exact_indexed_phrase_and_physical_excerpts_matched" as const,
        thesisImpactVerified:false as const,
        issuerClaimsVerified:false as const,
        ownerApprovalGranted:false as const,
        canAutoWrite:false as const,canAutoUpdateThesis:false as const,
        vaultModified:false as const,
        nextStep:"Read the cited lines and original sources; reconcile event dates, claim IDs, disagreement and Current Thesis before making any fundamental investment claim.",
      };
    })();
  }finally{db.close();}
}

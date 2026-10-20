/**
 * OFFLINE original-source blob byte integrity + indexed note-locator crosswalk.
 *
 * Source registry metadata is a claim about capture, not external attribution.
 * No publisher requests, independent fact verification, archive modification,
 * Vault writes, automated thesis changes or backup/restore acceptance.
 *
 * Only use against an already segregated, consistent snapshot. The PR #74
 * physical Markdown/SQLite reconciler must first pass on that same copy.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";

const MAX_RECORDS=10_000,MAX_BLOBS=10_000,MAX_BLOB_BYTES=8*1024*1024;
const MAX_BYTES=256*1024*1024,MAX_NOTES=10_000,MAX_SAMPLES=10;
const HEX64=/^[0-9a-f]{64}$/;
type SourceRow={
  snapshot_id:string;original_source:string;source_key:string;sha256:string;
  byte_length:number;revision:number;captured_at:string;content_type:string;
  capture_method:string;retrieved_from:string;operator_label:string;
};
type NoteRow={path:string;frontmatter:string|null};
type Reason=
  |"invalid_source_registry_metadata"
  |"original_blob_missing"|"original_blob_hash_mismatch"
  |"original_blob_unsafe_type_or_size"|"unregistered_source_archive_blob"
  |"unsafe_source_archive_entry"|"source_archive_capacity_exceeded";
type Issue={reason:Reason;identifier:string};
const digest=(data:Buffer)=>createHash("sha256").update(data).digest("hex");

function canonicalUrl(raw:string):string|null {
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||!url.hostname||url.username||url.password||url.port)
      return null;
    url.hash="";
    for(const key of [...url.searchParams.keys()])
      if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  }catch{return null;}
}
function regularDir(p:string){
  const st=fs.lstatSync(p);
  return st.isDirectory()&&!st.isSymbolicLink()&&fs.realpathSync(p)===p;
}
const sourcePath=(root:string,hash:string)=>path.join(
  root,"source-archive","blobs",hash.slice(0,2),hash+".bin"
);
const string=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;

/**
 * Returns bounded metadata results; never include original file bytes or
 * untrusted source URLs in the response.
 */
export function verifyOfflineSourceArchiveCoverage(snapshotRoot:string) {
  const coverage=verifyOfflineSnapshotCoverage(snapshotRoot);
  if(coverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
    throw Error("offline_source_archive_requires_clean_markdown_snapshot_hold");
  const root=fs.realpathSync(snapshotRoot);
  const sqlite=path.join(root,"app.sqlite");
  const d=new Database(sqlite,{readonly:true,fileMustExist:true});
  try{
    d.pragma("query_only=ON");
    return d.transaction(()=>{
      const issues:Issue[]=[];
      const issueCounts:Partial<Record<Reason,number>>={};
      const fail=(reason:Reason,identifier:string)=>{
        issueCounts[reason]=(issueCounts[reason]??0)+1;
        if(issues.length<MAX_SAMPLES)issues.push({
          reason,identifier:identifier.slice(0,220),
        });
      };
      const rows=d.prepare(
        "SELECT snapshot_id,original_source,source_key,sha256,byte_length,"+
        "revision,captured_at,content_type,capture_method,retrieved_from,"+
        "operator_label FROM source_snapshots ORDER BY source_key,revision LIMIT ?"
      ).all(MAX_RECORDS+1) as SourceRow[];
      if(rows.length>MAX_RECORDS)
        throw Error("offline_source_registry_count_limit_hold");
      const validRows:SourceRow[]=[];
      const expected=new Map<string,{byteLength:number;sourceKeys:Set<string>}>();
      const bySource=new Map<string,Set<string>>();
      const revisions=new Map<string,number>();
      let invalidRecords=0;
      for(const row of rows){
        const validHash=typeof row.sha256==="string"&&HEX64.test(row.sha256);
        const key=typeof row.source_key==="string"?canonicalUrl(row.original_source):null;
        const next=(revisions.get(row.source_key)??0)+1;
        const valid=validHash&&key===row.source_key&&
          typeof row.snapshot_id==="string"&&HEX64.test(row.snapshot_id)&&
          typeof row.byte_length==="number"&&Number.isSafeInteger(row.byte_length)&&
          row.byte_length>=16&&row.byte_length<=MAX_BLOB_BYTES&&
          row.revision===next&&
          typeof row.captured_at==="string"&&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(row.captured_at)&&
          Number.isFinite(Date.parse(row.captured_at))&&
          typeof row.operator_label==="string"&&row.operator_label.trim().length>0&&
          ["authorized_external_download","authorized_manual_upload"].includes(row.capture_method)&&
          Boolean(canonicalUrl(row.retrieved_from));
        if(!valid){
          invalidRecords++;fail("invalid_source_registry_metadata",
            validHash?row.sha256:"row:"+String(validRows.length));
          continue;
        }
        revisions.set(row.source_key,row.revision);
        validRows.push(row);
        const prev=expected.get(row.sha256);
        if(prev&&prev.byteLength!==row.byte_length){
          fail("invalid_source_registry_metadata",row.sha256);
          invalidRecords++;
        }else if(prev)prev.sourceKeys.add(row.source_key);
        else expected.set(row.sha256,{byteLength:row.byte_length,sourceKeys:new Set([row.source_key])});
        const family=bySource.get(row.source_key)??new Set<string>();
        family.add(row.sha256);bySource.set(row.source_key,family);
      }
      const archive=path.join(root,"source-archive");
      const blobs=path.join(archive,"blobs");
      let found=0,hashChecked=0,verifiedBytes=0;
      const present=new Set<string>();
      if(fs.existsSync(archive)){
        if(!regularDir(archive))throw Error("offline_source_archive_root_unsafe_hold");
        for(const name of fs.readdirSync(archive)){
          if(name!=="blobs")fail("unsafe_source_archive_entry",name);
        }
        if(fs.existsSync(blobs)){
          if(!regularDir(blobs))throw Error("offline_source_blob_root_unsafe_hold");
          for(const prefix of fs.readdirSync(blobs).sort()){
            const dir=path.join(blobs,prefix);
            if(!/^[0-9a-f]{2}$/.test(prefix)||!regularDir(dir)){
              fail("unsafe_source_archive_entry",prefix);continue;
            }
            for(const name of fs.readdirSync(dir).sort()){
              found++;
              if(found>MAX_BLOBS)throw Error("offline_source_blob_count_limit_hold");
              const match=/^([0-9a-f]{64})\.bin$/.exec(name);
              if(!match||match[1].slice(0,2)!==prefix){
                fail("unsafe_source_archive_entry",prefix+"/"+name);continue;
              }
              const hash=match[1],meta=expected.get(hash);
              const filepath=path.join(dir,name);
              const stat=fs.lstatSync(filepath);
              if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
                stat.size<16||stat.size>MAX_BLOB_BYTES){
                fail("original_blob_unsafe_type_or_size",hash);continue;
              }
              if(!meta){fail("unregistered_source_archive_blob",hash);continue;}
              present.add(hash);
              if(stat.size!==meta.byteLength){
                fail("original_blob_unsafe_type_or_size",hash);continue;
              }
              if(verifiedBytes+stat.size>MAX_BYTES){
                fail("source_archive_capacity_exceeded",hash);break;
              }
              const fd=fs.openSync(filepath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
              try{
                const before=fs.fstatSync(fd);
                const bytes=fs.readFileSync(fd);
                const after=fs.fstatSync(fd);
                if(!before.isFile()||before.nlink!==1||
                  bytes.length!==meta.byteLength||
                  before.size!==after.size||before.mtimeMs!==after.mtimeMs||
                  before.ctimeMs!==after.ctimeMs){
                  fail("original_blob_unsafe_type_or_size",hash);continue;
                }
                verifiedBytes+=bytes.length;
                if(digest(bytes)!==hash)
                  fail("original_blob_hash_mismatch",hash);
                else hashChecked++;
              }finally{fs.closeSync(fd);}
            }
          }
        }
      }
      for(const hash of expected.keys()){
        if(!present.has(hash))fail("original_blob_missing",hash);
      }
      // This crosswalk uses explicit note-declared locators and FULL-DOCUMENT
      // hashes only. A declared excerpt hash is NEVER a full-original match.
      // An exact registry match proves only stored byte integrity, not that
      // the issuer is real, the claim correct, or two notes independent.
      const notes=d.prepare(
        "SELECT path,frontmatter FROM notes ORDER BY path LIMIT ?"
      ).all(MAX_NOTES+1) as NoteRow[];
      if(notes.length>MAX_NOTES)throw Error("offline_source_note_index_limit_hold");
      const crosswalk={
        notesWithExplicitSourceLocator:0,
        notesWithLocatorAndRegisteredOriginal:0,
        notesWithLocatorButNoRegisteredOriginal:0,
        noteDeclaredFullHashesMatchingRegisteredVersion:0,
        noteDeclaredFullHashesNotMatchingRegisteredVersion:0,
        noteDeclaredFullHashWithoutLocator:0,
        derivativeOrArchivedAiNotesWithLocators:0,
        noteDeclaredExcerptHashesNotFullDocumentProof:0,
      };
      const reviewSamples:{path:string;kind:string}[]=[];
      const review=(path:string,kind:string)=>{
        if(reviewSamples.length<MAX_SAMPLES)reviewSamples.push({path,kind});
      };
      for(const row of notes){
        if(!row.frontmatter)continue;
        let fm:Record<string,unknown>;
        try{
          const raw=JSON.parse(row.frontmatter) as unknown;
          if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("bad");
          fm=raw as Record<string,unknown>;
        }catch{throw Error("offline_source_indexed_metadata_invalid_hold");}
        const inspection=inspectCanonicalKnowledgeMetadata(row.path,fm);
        const locator=string(fm.original_source)??string(fm.source_url);
        const normalized=locator?canonicalUrl(locator):null;
        const fullHash=string(fm.original_source_sha256);
        if(string(fm.source_excerpt_sha256))
          crosswalk.noteDeclaredExcerptHashesNotFullDocumentProof++;
        if(locator){
          crosswalk.notesWithExplicitSourceLocator++;
          if(inspection.independenceAssessment!=="not_assessed")
            crosswalk.derivativeOrArchivedAiNotesWithLocators++;
          const family=normalized?bySource.get(normalized):undefined;
          if(family&&family.size){
            crosswalk.notesWithLocatorAndRegisteredOriginal++;
            if(fullHash){
              if(family.has(fullHash.toLowerCase()))
                crosswalk.noteDeclaredFullHashesMatchingRegisteredVersion++;
              else{
                crosswalk.noteDeclaredFullHashesNotMatchingRegisteredVersion++;
                review(row.path,"declared_full_hash_not_matching_archived_version");
              }
            }
          }else{
            crosswalk.notesWithLocatorButNoRegisteredOriginal++;
            review(row.path,"declared_locator_not_in_offline_archive_registry");
          }
        }else if(fullHash){
          crosswalk.noteDeclaredFullHashWithoutLocator++;
          review(row.path,"full_hash_declared_without_source_locator");
        }
      }
      const archiveIssues=Object.values(issueCounts).reduce((s,v)=>s+(v??0),0);
      const referenceGaps=
        crosswalk.notesWithLocatorButNoRegisteredOriginal+
        crosswalk.noteDeclaredFullHashesNotMatchingRegisteredVersion+
        crosswalk.noteDeclaredFullHashWithoutLocator;
      const status=archiveIssues>0?
        "offline_archive_bytes_integrity_hold" as const:
        validRows.length===0?
          "offline_no_original_source_snapshots_unverified" as const:
        referenceGaps>0?
          "offline_archive_bytes_intact_provenance_review_pending" as const:
          "offline_archived_bytes_intact_not_publisher_verified" as const;
      return {
        status,
        scope:"offline_registered_source_snapshots_hash_integrity_and_explicit_note_locator_crosswalk" as const,
        markdownSnapshotCoverage:"reconciled_offline_bytes_only" as const,
        sourceSnapshotRecords:rows.length,validSourceSnapshotRecords:validRows.length,
        distinctRegisteredSourceUrls:bySource.size,
        distinctRegisteredBlobHashes:expected.size,
        visibleBlobFiles:found,hashMatchedBlobs:hashChecked,
        inspectedBlobBytes:verifiedBytes,
        invalidRegistryRows:invalidRecords,
        issueCounts,issueSamples:issues,issueSampleTruncated:archiveIssues>issues.length,
        noteReferenceCrosswalk:crosswalk,
        unresolvedDeclaredNoteReferenceCount:referenceGaps,
        noteReferenceReviewSamples:reviewSamples,
        noteReferenceSampleTruncated:
          crosswalk.notesWithLocatorButNoRegisteredOriginal+
          crosswalk.noteDeclaredFullHashesNotMatchingRegisteredVersion+
          crosswalk.noteDeclaredFullHashWithoutLocator>reviewSamples.length,
        declaredCaptureMetadataAuthenticated:false as const,
        publisherIdentityVerified:false as const,
        originalSourceIndependenceVerified:false as const,
        investmentClaimFactsVerified:false as const,
        excerptHashAcceptedAsOriginalHash:false as const,
        originalSourceCoverageComplete:false as const,
        immutableSnapshotVerified:false as const,
        disasterRecoveryAccepted:false as const,
        ownerApprovalGranted:false as const,
        canAutoWrite:false as const,
        canAutoUpdateThesis:false as const,
        nextStep:"Read issuer originals independently, reconcile exact claim/period/unit and source identity, and audit raw ChatGPT/export archives separately. A byte hash match is not proof of publisher authenticity or investment thesis validity. No Vault or blob was changed." as const,
      };
    })();
  }finally{d.close();}
}

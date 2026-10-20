/**
 * PR #84: offline-only Historical Intelligence / Change Detection.
 *
 * The new event is UNVERIFIED USER INPUT; the old records are indexed
 * metadata from an already-separated, physically reconciled Vault copy.
 * Even an exhaustive index scan is not an exhaustive SEMANTIC search.
 *
 * No original publisher auth, internet, Safe Edit, MCP, credentials, changes
 * to the Vault, or "new verified fact" conclusions.
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {classifyHistoricalClaim,type ClaimEvidence} from "./historical-change-classifier";

const SHA=/^[a-f0-9]{64}$/;
const MAX_NOTES=10_000,MAX_CLAIMS=20_000,MAX_LEXICAL=12;
type Row={path:string;title:string;frontmatter:string|null;mtime:number;size:number};
type Meta=Record<string,unknown>;
const t=(v:unknown):string|null=>typeof v==="string"&&
  v.trim()&&v.trim().length<=300&&!/[\r\n\0]/.test(v)?v.trim():null;
const hash=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
const object=(v:unknown):v is Meta=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function meta(row:Row):Meta{
  if(!row.frontmatter)return {};
  const parsed=JSON.parse(row.frontmatter) as unknown;
  if(!object(parsed))throw Error("offline_historical_index_frontmatter_invalid");
  return parsed;
}
function claimOf(row:Row,m:Meta,c:Meta,independence:ClaimEvidence["independence"]):ClaimEvidence{
  const source=t(c.original_source)??t(c.source_url)??
    t(m.original_source)??t(m.source_url);
  const rawHash=t(c.original_source_sha256)??
    t(m.original_source_sha256);
  return {
    notePath:row.path,claimId:t(c.claim_id),
    entity:t(c.entity)??t(m.entity),metric:t(c.metric),
    period:t(c.period),unit:t(c.unit),value:t(c.value),
    eventKey:t(c.event_key)??t(m.event_key),
    originalSourceSha256:rawHash&&SHA.test(rawHash)?rawHash:null,
    sourceUrl:source,sourceType:t(c.source_type)??t(m.source_type),
    eventDate:t(c.event_date)??t(m.event_date),
    publishedAt:t(c.published_at)??t(m.published_at),
    importedAt:t(c.imported_at)??t(m.imported_at),
    verification:t(c.verification)??t(m.verification),
    independence,
  };
}
function indexDigest(rows:Row[]):string{
  const h=createHash("sha256").update("investment-os-offline-historical-index-v1\n");
  for(const r of rows)h.update(JSON.stringify([
    r.path,r.title,r.frontmatter,r.mtime,r.size])+"\n");
  return h.digest("hex");
}
function readRows(db:Database.Database):Row[]{
  const rows=db.prepare("SELECT path,title,frontmatter,mtime,size FROM notes ORDER BY path LIMIT ?")
    .all(MAX_NOTES+1) as Row[];
  if(rows.length>MAX_NOTES)
    throw Error("offline_historical_index_truncated_hold");
  return rows;
}
export type OfflineHistorySearchRequest={
  snapshotRoot:string;expectedMarkdownManifestSha256:string;
  incoming:{
    entity:string;metric:string;period:string;unit:string;value:string;
    eventKey:string;claimId?:string|null;sourceUrl?:string|null;
    originalSourceSha256?:string|null;sourceType?:string|null;
    eventDate?:string|null;publishedAt?:string|null;importedAt?:string|null;
  };
};
export function reviewHistoricalChangeOffline(req:OfflineHistorySearchRequest){
  if(!req||typeof req!=="object"||!object(req.incoming)||
    typeof req.snapshotRoot!=="string"||
    !SHA.test(req.expectedMarkdownManifestSha256))
    throw Error("offline_historical_input_or_expected_manifest_invalid");
  // The manifest must be obtained independently from an earlier coverage
  // scan, not a value inferred from the import date or file name.
  const start=verifyOfflineSnapshotCoverage(req.snapshotRoot);
  if(start.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
    start.markdownContentManifestSha256!==req.expectedMarkdownManifestSha256)
    throw Error("offline_historical_snapshot_coverage_or_manifest_hold");
  const root=fs.realpathSync(req.snapshotRoot);
  const dbPath=path.join(root,"app.sqlite");
  const db=new Database(dbPath,{readonly:true,fileMustExist:true});
  try{
    db.pragma("query_only=ON");
    return db.transaction(()=>{
      const rows=readRows(db),startIndexDigest=indexDigest(rows);
      let structured=0,unstructured=0,missingFields=0;
      const previous:ClaimEvidence[]=[];
      for(const row of rows){
        const fm=meta(row);
        const schema=inspectCanonicalKnowledgeMetadata(row.path,fm);
        const claims=Array.isArray(fm.claims)?fm.claims:[];
        if(claims.length>100)throw Error("offline_historical_claims_per_note_limit_hold");
        if(!claims.length){
          unstructured++;
          continue;
        }
        for(const c of claims){
          if(!object(c)){missingFields++;continue;}
          if(++structured>MAX_CLAIMS)
            throw Error("offline_historical_claim_volume_limit_hold");
          const entry=claimOf(row,fm,c,schema.independenceAssessment);
          if(!entry.entity||!entry.metric||!entry.period||
            !entry.unit||!entry.value||!entry.eventKey)
            missingFields++;
          previous.push(entry);
        }
      }
      const source=req.incoming;
      const input:ClaimEvidence={
        notePath:"_user_input_not_in_vault.md",
        entity:t(source.entity),metric:t(source.metric),
        period:t(source.period),unit:t(source.unit),
        value:t(source.value),eventKey:t(source.eventKey),
        claimId:t(source.claimId),
        originalSourceSha256:t(source.originalSourceSha256)&&
          SHA.test(t(source.originalSourceSha256)!)?
          t(source.originalSourceSha256):null,
        sourceUrl:t(source.sourceUrl),sourceType:t(source.sourceType),
        eventDate:t(source.eventDate),publishedAt:t(source.publishedAt),
        importedAt:t(source.importedAt),verification:null,
        independence:/^(?:archived_ai|chatgpt_export|chatgpt_history|chatgpt_analysis)$/i
          .test(source.sourceType??"")?
          "not_independent_archived_ai":"not_assessed",
      };
      // FTS is ONLY a lexical recall hint. It cannot establish an event
      // match, novelty, publisher authenticity or claim-level corroboration.
      let lexicalPaths:string[]=[];
      if(input.entity&&/^[a-zA-Z][a-zA-Z0-9.-]{1,19}$/.test(input.entity)){
        const query='"'+input.entity.replace(/[.]/g," ")+'"';
        const matches=db.prepare(
          "SELECT n.path FROM notes_fts JOIN notes n ON n.rowid=notes_fts.rowid "+
          "WHERE notes_fts MATCH ? ORDER BY n.path LIMIT ?"
        ).all(query,MAX_LEXICAL+1) as {path:string}[];
        lexicalPaths=matches.map(x=>x.path);
      }
      const report=classifyHistoricalClaim(input,previous,{
        scannedNotes:rows.length,completeIndexScan:true,
      });
      const end=readRows(db);
      if(indexDigest(end)!==startIndexDigest)
        throw Error("offline_historical_index_changed_during_scan_hold");
      const finalCoverage=verifyOfflineSnapshotCoverage(req.snapshotRoot);
      if(finalCoverage.status!=="snapshot_markdown_index_reconciled_not_originals_verified"||
        finalCoverage.markdownContentManifestSha256!==start.markdownContentManifestSha256)
        throw Error("offline_historical_snapshot_changed_during_scan_hold");
      return {
        status:"offline_structured_historical_comparison_needs_review" as const,
        sourceKind:"user_supplied_unverified_incoming_claim" as const,
        classification:report.classification,
        reviewQueue:report.reviewQueue,
        comparison:report,
        scope:{
          scannedIndexedNotes:rows.length,
          structuredClaimRecordsScanned:structured,
          notesWithoutStructuredClaims:unstructured,
          incompleteStructuredClaims:missingFields,
          scannedPhysicalNotes:start.scannedPhysicalNotes,
          physicalMarkdownManifestSha256:start.markdownContentManifestSha256,
          noteMetadataIndexDigest:hash(startIndexDigest),
          allIndexRowsEnumerated:true as const,
          allLegacyProseSemanticallyCompared:false as const,
          allSourceOriginalsAuthenticated:false as const,
          completeVaultHistoryAcrossDevicesVerified:false as const,
        },
        lexicalHistoryHints:lexicalPaths.slice(0,MAX_LEXICAL),
        lexicalHintsTruncated:lexicalPaths.length>MAX_LEXICAL,
        independentPrimaryEvidenceVerified:false as const,
        existingThesisCompared:false as const,
        valuationOrPortfolioConclusionSupported:false as const,
        ownerApprovalGranted:false as const,
        canAutoWrite:false as const,canAutoUpdateThesis:false as const,
        vaultModified:false as const,
        nextStep:"Read the matched original notes and source editions, check claim context/counterevidence and owner review before proposing any Thesis or Vault edit.",
      };
    })();
  }finally{db.close();}
}

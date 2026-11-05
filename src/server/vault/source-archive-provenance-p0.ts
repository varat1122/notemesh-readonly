import {inspectOriginalSourceHistory,inspectOriginalSourceSnapshot,
  normalizedArchiveSource,sha256} from "../research-source-archive";

/** URL correlation only. Archive sequence is not publisher/event chronology.
 * Read at most 100 metadata rows and hash one stored document (maximum 8 MiB).
 * Never fall back to an older intact version if the selected one is damaged. */
export interface SourceArchiveProvenance {
  snapshotId:string;sourceUrl:string;originalSource:string;retrievedFrom:string;
  sha256:string;byteLength:number;revision:number;capturedAt:string;contentType:string;
  responseEtag:string|null;responseLastModified:string|null;
  archiveStatus:"ARCHIVED_BYTES_INTACT";
  selection:"HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION";
  association:"URL_ONLY_NOT_TRANSCRIPTION_OR_EVENT_PROOF";
  changesObserved:boolean;
  chronology:{eventDate:string|null;publicationDate:string|null;
    captureRelation:"AFTER_PUBLICATION_DAY"|"BEFORE_PUBLICATION_DAY"|"SAME_DAY_ORDER_UNKNOWN"|"PUBLICATION_UNKNOWN";
    originalEventVersionVerified:false};
  publisherAuthenticityVerified:false;originalDocumentSignatureVerified:false;
  claimVerification:"NOT_ESTABLISHED_BY_ARCHIVE";independentEvidenceIncrement:0;
}
type ArchiveWitness={
  status:"ABSENT"|"HOLD"|"ARCHIVED_BYTES_INTACT";
  reason:"no_source_url"|"no_archive"|"history_limit"|"metadata_invalid"|
    "selected_snapshot_missing_or_corrupt"|"archive_unavailable"|"url_correlated_snapshot";
  snapshot:SourceArchiveProvenance|null;
};
export function inspectSourceArchiveProvenance(sourceUrl:string|null|undefined,
  eventDate:string|null,publicationDate:string|null):ArchiveWitness {
  if(!sourceUrl)return {status:"ABSENT",reason:"no_source_url",snapshot:null};
  try{
    const history=inspectOriginalSourceHistory(sourceUrl,false);
    if(history.limitReached)return {status:"HOLD",reason:"history_limit",snapshot:null};
    const selected=history.snapshots.at(-1);
    if(!selected)return {status:"ABSENT",reason:"no_archive",snapshot:null};
    if(!Number.isSafeInteger(selected.byteLength)||selected.byteLength<16||selected.byteLength>8*1024*1024||
      !Number.isSafeInteger(selected.revision)||selected.revision<1||
      !/^[a-f0-9]{64}$/.test(selected.snapshotId)||!Number.isFinite(Date.parse(selected.capturedAt))||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(selected.capturedAt)||
      new Date(selected.capturedAt).toISOString().slice(0,19)!==selected.capturedAt.slice(0,19)||
      [selected.originalSource,selected.retrievedFrom,selected.contentType,
        selected.responseEtag,selected.responseLastModified].some(s=>s!==null&&(typeof s!=="string"||s.length>4096))||
      normalizedArchiveSource(selected.originalSource)!==normalizedArchiveSource(sourceUrl)||
      selected.snapshotId!==sha256(Buffer.from(normalizedArchiveSource(sourceUrl)+"\n"+selected.sha256)))
      return {status:"HOLD",reason:"metadata_invalid",snapshot:null};
    const checked=inspectOriginalSourceSnapshot(selected.snapshotId);
    if(!checked||checked.archiveStatus!=="intact_stored_bytes"||
      // Bind the byte readback to the metadata selected by the URL query.
      Object.keys(selected).some(k=>k!=="archiveStatus"&&
        selected[k as keyof typeof selected]!==checked[k as keyof typeof checked]))
      return {status:"HOLD",reason:"selected_snapshot_missing_or_corrupt",snapshot:null};
    const captureDay=checked.capturedAt.slice(0,10);
    return {status:"ARCHIVED_BYTES_INTACT",reason:"url_correlated_snapshot",snapshot:{
      snapshotId:checked.snapshotId,sourceUrl:normalizedArchiveSource(sourceUrl),originalSource:checked.originalSource,
      retrievedFrom:checked.retrievedFrom,sha256:checked.sha256,byteLength:checked.byteLength,
      revision:checked.revision,capturedAt:checked.capturedAt,contentType:checked.contentType,
      responseEtag:checked.responseEtag,responseLastModified:checked.responseLastModified,
      archiveStatus:"ARCHIVED_BYTES_INTACT",selection:"HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION",
      association:"URL_ONLY_NOT_TRANSCRIPTION_OR_EVENT_PROOF",changesObserved:history.changesObserved,
      chronology:{eventDate,publicationDate,captureRelation:!publicationDate?"PUBLICATION_UNKNOWN":
        captureDay>publicationDate?"AFTER_PUBLICATION_DAY":captureDay<publicationDate?
          "BEFORE_PUBLICATION_DAY":"SAME_DAY_ORDER_UNKNOWN",originalEventVersionVerified:false},
      publisherAuthenticityVerified:false,originalDocumentSignatureVerified:false,
      claimVerification:"NOT_ESTABLISHED_BY_ARCHIVE",independentEvidenceIncrement:0
    }};
  }catch{return {status:"HOLD",reason:"archive_unavailable",snapshot:null};}
}

// Quote untrusted metadata as one inert Markdown line; no injected wikilinks,
// headings, HTML or control characters. Keep the exact values in structured output.
const display=(s:string|null)=>JSON.stringify(s).replace(/[<>[\]`*_]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
export function sourceArchiveReviewLines(snapshot:SourceArchiveProvenance|null):string[]{
  // Preserve pre-integration Review bytes when no archive is associated.
  if(!snapshot)return [];
  return [
    `- Original-byte archive: ${snapshot.archiveStatus}; snapshot ${snapshot.snapshotId}; SHA-256 ${snapshot.sha256}; ${snapshot.byteLength} bytes`,
    `- Archive URL: ${display(snapshot.originalSource)}; retrieved from ${display(snapshot.retrievedFrom)}; intake URL ${display(snapshot.sourceUrl)}`,
    `- Archive sequence revision: ${snapshot.revision}; captured ${display(snapshot.capturedAt)}; content type ${display(snapshot.contentType)}; changed bytes observed: ${snapshot.changesObserved?"yes":"no"}`,
    `- Publisher revision hints (unverified): ETag ${display(snapshot.responseEtag)}; Last-Modified ${display(snapshot.responseLastModified)}`,
    `- Archive chronology: event ${display(snapshot.chronology.eventDate)}; publication ${display(snapshot.chronology.publicationDate)}; capture relation ${snapshot.chronology.captureRelation}`,
    "- Archive association: URL correlation only, not proof that the transcription matches these bytes. Archive sequence/capture time does not establish the original event version or publisher revision.",
    "- Archive limitation: publisher authenticity/signature and claim truth are NOT verified by the byte archive; claim-level primary receipts remain required. No Review verification or evidence independence is added."
  ];
}

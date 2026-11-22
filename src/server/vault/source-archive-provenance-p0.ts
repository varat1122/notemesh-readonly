import {inspectOriginalSourceHistory,inspectOriginalSourceSnapshot,
  normalizedArchiveSource,sha256,type DocumentSnapshot} from "../research-source-archive";
import {archiveEligibleUrl,legacyCanonicalSourceUrlN1c} from "../source-url";
import {db} from "../db";

/** Public summary contains only validated scalars/enums and opaque digests.
 * Raw archive URLs, response headers and arbitrary MIME strings stay internal. */
export interface SourceArchiveProvenance {
  snapshotId:string;sourceUrlSha256:string;sha256:string;byteLength:number;
  revision:number;capturedAt:string;metadataSha256:string;bindingSha256:string;
  legacyBlockSha256:string;
  archiveStatus:"ARCHIVED_BYTES_INTACT";
  integrityScope:"SELECTED_SNAPSHOT_ONLY";
  olderSnapshotsByteChecked:false;
  selection:"HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION";
  association:"URL_ONLY_NOT_TRANSCRIPTION_OR_EVENT_PROOF";
  changesObserved:boolean;
  publisherRevisionHintsPresent:boolean;
  chronology:{eventDate:string|null;publicationDate:string|null;
    captureRelation:"ORDER_UNKNOWN_TIMEZONE"|"PUBLICATION_UNKNOWN";
    originalEventVersionVerified:false};
  publisherAuthenticityVerified:false;originalDocumentSignatureVerified:false;
  claimVerification:"NOT_ESTABLISHED_BY_ARCHIVE";independentEvidenceIncrement:0;
}
export type ArchiveWitness={
  status:"ABSENT"|"HOLD"|"ARCHIVED_BYTES_INTACT";
  reason:"no_source_url"|"not_archivable"|"no_archive"|"history_limit"|"legacy_alias_scan_limit"|"metadata_invalid"|
    "selected_snapshot_missing_or_corrupt"|"archive_unavailable"|"legacy_url_binding"|"url_correlated_snapshot";
  snapshot:SourceArchiveProvenance|null;
};
const digest=(s:string)=>sha256(Buffer.from(s));
// Compatibility comparison ONLY: hash the old rendering internally. Never
// return/render its raw strings. Old bytes/receipts are not retroactively edited.
function legacyBlockHash(s:DocumentSnapshot,url:string,event:string|null,published:string|null,changed:boolean){
  const display=(v:string|null)=>JSON.stringify(v).replace(/[<>[\]`*_]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
  const relation=!published?"PUBLICATION_UNKNOWN":s.capturedAt.slice(0,10)>published?"AFTER_PUBLICATION_DAY":
    s.capturedAt.slice(0,10)<published?"BEFORE_PUBLICATION_DAY":"SAME_DAY_ORDER_UNKNOWN";
  return digest([
    `- Original-byte archive: ARCHIVED_BYTES_INTACT; snapshot ${s.snapshotId}; SHA-256 ${s.sha256}; ${s.byteLength} bytes`,
    `- Archive URL: ${display(s.originalSource)}; retrieved from ${display(s.retrievedFrom)}; intake URL ${display(url)}`,
    `- Archive sequence revision: ${s.revision}; captured ${display(s.capturedAt)}; content type ${display(s.contentType)}; changed bytes observed: ${changed?"yes":"no"}`,
    `- Publisher revision hints (unverified): ETag ${display(s.responseEtag)}; Last-Modified ${display(s.responseLastModified)}`,
    `- Archive chronology: event ${display(event)}; publication ${display(published)}; capture relation ${relation}`,
    "- Archive association: URL correlation only, not proof that the transcription matches these bytes. Archive sequence/capture time does not establish the original event version or publisher revision.",
    "- Archive limitation: publisher authenticity/signature and claim truth are NOT verified by the byte archive; claim-level primary receipts remain required. No Review verification or evidence independence is added."
  ].join("\n"));
}
export function inspectSourceArchiveProvenance(sourceUrl:string|null|undefined,
  eventDate:string|null,publicationDate:string|null):ArchiveWitness {
  if(!sourceUrl?.trim())return {status:"ABSENT",reason:"no_source_url",snapshot:null};
  const canonical=archiveEligibleUrl(sourceUrl);
  if(!canonical)return {status:"ABSENT",reason:"not_archivable",snapshot:null};
  try{
    // Compare only the known pre-N1c keys of this input's plain/fragment forms.
    // At most two exact indexed reads; never reinterpret or migrate old keys.
    const legacyKeys=new Set([legacyCanonicalSourceUrlN1c(sourceUrl),
      legacyCanonicalSourceUrlN1c(sourceUrl.trim().split("#",1)[0]+"#")]);
    for(const key of legacyKeys)if(key&&key!==canonical&&
      db().prepare("SELECT 1 FROM source_snapshots WHERE source_key=? LIMIT 1").get(key))
      return {status:"HOLD",reason:"legacy_url_binding",snapshot:null};
    const history=inspectOriginalSourceHistory(canonical,false);
    if(history.limitReached)return {status:"HOLD",reason:"history_limit",snapshot:null};
    const selected=history.snapshots.at(-1);
    if(!selected)return {status:"ABSENT",reason:"no_archive",snapshot:null};
    if(!Number.isSafeInteger(selected.byteLength)||selected.byteLength<16||selected.byteLength>8*1024*1024||
      !Number.isSafeInteger(selected.revision)||selected.revision<1||
      !/^[a-f0-9]{64}$/.test(selected.snapshotId)||!Number.isFinite(Date.parse(selected.capturedAt))||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(selected.capturedAt)||
      new Date(selected.capturedAt).toISOString().slice(0,19)!==selected.capturedAt.slice(0,19)||
      [selected.originalSource,selected.retrievedFrom,selected.contentType,selected.captureMethod,
        selected.responseEtag,selected.responseLastModified].some(s=>s!==null&&(typeof s!=="string"||s.length>4096))||
      normalizedArchiveSource(selected.originalSource)!==canonical||
      selected.snapshotId!==digest(canonical+"\n"+selected.sha256))
      return {status:"HOLD",reason:"metadata_invalid",snapshot:null};
    const checked=inspectOriginalSourceSnapshot(selected.snapshotId);
    if(!checked||checked.archiveStatus!=="intact_stored_bytes"||
      Object.keys(selected).some(k=>k!=="archiveStatus"&&
        selected[k as keyof typeof selected]!==checked[k as keyof typeof checked]))
      return {status:"HOLD",reason:"selected_snapshot_missing_or_corrupt",snapshot:null};
    // Exact metadata remains bound even though it is not public model text.
    const metadataSha256=digest(JSON.stringify([checked.snapshotId,checked.originalSource,checked.retrievedFrom,
      checked.sha256,checked.byteLength,checked.revision,checked.capturedAt,checked.contentType,
      checked.captureMethod,checked.responseEtag,checked.responseLastModified]));
    const bindingSha256=digest(JSON.stringify(["archive-provenance-v2",canonical,eventDate,publicationDate,
      metadataSha256,history.changesObserved]));
    return {status:"ARCHIVED_BYTES_INTACT",reason:"url_correlated_snapshot",snapshot:{
      snapshotId:checked.snapshotId,sourceUrlSha256:digest(canonical),sha256:checked.sha256,
      byteLength:checked.byteLength,revision:checked.revision,capturedAt:checked.capturedAt,
      metadataSha256,bindingSha256,legacyBlockSha256:legacyBlockHash(checked,canonical,eventDate,publicationDate,history.changesObserved),
      archiveStatus:"ARCHIVED_BYTES_INTACT",integrityScope:"SELECTED_SNAPSHOT_ONLY",olderSnapshotsByteChecked:false,
      selection:"HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION",association:"URL_ONLY_NOT_TRANSCRIPTION_OR_EVENT_PROOF",
      changesObserved:history.changesObserved,publisherRevisionHintsPresent:!!(checked.responseEtag||checked.responseLastModified),
      chronology:{eventDate,publicationDate,captureRelation:publicationDate?"ORDER_UNKNOWN_TIMEZONE":"PUBLICATION_UNKNOWN",
        originalEventVersionVerified:false},publisherAuthenticityVerified:false,originalDocumentSignatureVerified:false,
      claimVerification:"NOT_ESTABLISHED_BY_ARCHIVE",independentEvidenceIncrement:0
    }};
  }catch(e){return {status:"HOLD",reason:e instanceof Error&&e.message==="source_archive_legacy_url_binding"?
    "legacy_url_binding":e instanceof Error&&e.message==="source_archive_alias_scan_limit"?"legacy_alias_scan_limit":"archive_unavailable",snapshot:null};}
}

export function sourceArchiveReviewLines(s:SourceArchiveProvenance|null):string[]{
  if(!s)return [];
  // No untrusted string is interpolated here: only validated digests, numbers,
  // timestamp, caller-validated dates and fixed enums. No raw header/URL/MIME.
  return [
    `- Archive provenance v2: ${s.archiveStatus}; binding SHA-256 ${s.bindingSha256}`,
    `- Archive snapshot: ${s.snapshotId}; SHA-256 ${s.sha256}; ${s.byteLength} bytes; sequence revision ${s.revision}`,
    `- Archive URL binding: SHA-256 ${s.sourceUrlSha256}; exact metadata SHA-256 ${s.metadataSha256}`,
    `- Archive capture: ${s.capturedAt}; publisher revision hints present: ${s.publisherRevisionHintsPresent?"yes":"no"}`,
    `- Archive chronology: event ${s.chronology.eventDate??"unknown"}; publication ${s.chronology.publicationDate??"unknown"}; ${s.chronology.captureRelation}; original event version unverified`,
    "- Archive integrity scope: SELECTED_SNAPSHOT_ONLY; older revisions not byte-checked; URL association is not transcription or event-version proof",
    "- Archive limitation: publisher authenticity/signature and claim truth are NOT verified; claim-level primary receipts remain required; no Review verification or evidence independence added"
  ];
}

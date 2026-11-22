import { captureOriginalDocumentBytes, type DocumentArchiveInput } from "./research-source-archive";

/**
 * Separate write-scoped, explicitly authorized ingestion from the read-only
 * NoteMesh research tools. The allowlist is an operator-controlled server
 * setting, NOT an argument. Redirects, HTTP and oversized responses fail closed.
 *
 * The output proves archived HTTP bytes and transport URL only, not that the
 * publishing entity authored the content or that a financial claim is correct.
 */
const MAX_BYTES=8*1024*1024;
const defaultHosts=["www.sec.gov","ir.amd.com","www.nso.gov.vn"];
const types=new Set(["text/html","application/xhtml+xml","application/pdf","text/plain",
  "application/xml","text/xml","application/json"]);
export interface SourceFetchInput { url:string;operator:string }
export interface SourceFetchResult {
  status:"archived_fetched_bytes_unverified_publisher";
  archiveSnapshotId:string;originalSource:string;sha256:string;byteLength:number;
  revision:number;capturedAt:string;contentType:string;
  publisherAuthenticityVerified:false;fullRevisionHistoryComplete:false;
  vaultModified:false;
}
export function trustedHttpsUrl(input:string):URL{
  if(input.length>2000)throw new Error("source_url_too_long");
  let u:URL;
  try{u=new URL(input);}catch{throw new Error("source_url_invalid");}
  if(u.protocol!=="https:"||u.username||u.password||u.port||!u.hostname||
     u.hash||/\s/.test(input))throw new Error("source_url_not_standard_https");
  const hosts=(process.env.SOURCE_ARCHIVE_ALLOWED_HOSTS||defaultHosts.join(","))
    .split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  // Exact only — no suffix matching; a compromised .sec.gov.evil.tld host
  // must not be able to become a private-network fetch primitive.
  if(!hosts.includes(u.hostname.toLowerCase()))throw new Error("source_host_not_allowlisted");
  return u;
}
export async function fetchAndArchiveOfficialSource(
  input:SourceFetchInput,
  transport:typeof fetch=fetch
):Promise<SourceFetchResult>{
  const u=trustedHttpsUrl(input.url);
  const ua=process.env.SOURCE_ARCHIVE_USER_AGENT?.trim();
  if(!ua||ua.length<15||ua.length>250)
    throw new Error("SOURCE_ARCHIVE_USER_AGENT required: configure real authorized organizational contact before external download");
  if(!input.operator||input.operator.length>160||!/^oauth:/.test(input.operator))
    throw new Error("source_archive_requires_authenticated_oauth_operator");
  const response=await transport(u.toString(),{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    signal:AbortSignal.timeout(12000),
    headers:{"User-Agent":ua,"Accept":"text/html, application/pdf, application/xml, text/plain, application/json"}
  });
  if(response.status>=300&&response.status<400)throw new Error("source_http_redirect_blocked");
  if(!response.ok)throw new Error("source_http_status_"+response.status);
  const type=response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()||"";
  if(!types.has(type))throw new Error("source_content_type_not_supported");
  const knownSize=response.headers.get("content-length");
  if(knownSize!==null&&(+knownSize>MAX_BYTES||!Number.isFinite(+knownSize)))
    throw new Error("source_document_size_limit");
  if(!response.body)throw new Error("source_response_has_no_body");
  const reader=response.body.getReader();
  let total=0;
  const chunks:Buffer[]=[];
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(!value)continue;
      total+=value.byteLength;
      if(total>MAX_BYTES)throw new Error("source_document_size_limit");
      chunks.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks,total);
  if(bytes.length<16)throw new Error("source_document_invalid_size");
  // HTTP 200 + provider body is not independent proof of issuer authorship.
  const capture:DocumentArchiveInput={
    originalSource:u.toString(),bytes,
    contentType:type==="application/xhtml+xml"?"text/html":type as DocumentArchiveInput["contentType"],
    capturedAt:new Date().toISOString(),
    captureMethod:"authorized_external_download",retrievedFrom:u.toString(),
    reviewerOrOperator:input.operator,
    responseEtag:response.headers.get("etag"),
    responseLastModified:response.headers.get("last-modified")
  };
  const record=captureOriginalDocumentBytes(capture);
  return {status:"archived_fetched_bytes_unverified_publisher",
    archiveSnapshotId:record.snapshotId,originalSource:record.originalSource,
    sha256:record.sha256,byteLength:record.byteLength,revision:record.revision,
    capturedAt:record.capturedAt,contentType:record.contentType,
    publisherAuthenticityVerified:false,fullRevisionHistoryComplete:false,vaultModified:false};
}

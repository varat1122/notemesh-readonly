import { createHash } from "node:crypto";
import { db } from "../db";

/**
 * READ-ONLY consistency and integrity check for audit receipts saved as Notes.
 *
 * A cryptographically matching excerpt hash proves only the stored excerpt
 * has not changed relative to its stored digest. The receipt, its reviewer,
 * the source publication and any actual issuer filing are NOT authenticated
 * by this function. Do not label it "verified original source".
 */
export interface ReceiptScope {
  claimId:string;domain:string;entity:string;metric:string;period:string;
  originalSource:string;value?:string|null;unit?:string|null;
}
export type ReceiptCandidate = {
  path:string;
  claimId:string;
  sourceLocator:string;
  observedAt:string;
  excerptSha256:string;
  storedSourceDocumentSha256:string|null;
  status:"consistent_stored_excerpt_only";
  externalSourceFetchedThisCall:false;
};
export interface SourceReceiptGateResult {
  status:"receipt_metadata_and_excerpt_integrity_only";
  matchingReceipts:ReceiptCandidate[];
  rejectedReceipts:Array<{path:string;reason:string}>;
  returnedRows:number;
  truncated:boolean;
  externalSourceFetchedThisCall:false;
  sourceDocumentBytesArchivedAndVerified:false;
  receiptReviewerIdentityCryptographicallyVerified:false;
  sourceIndependenceVerified:false;
  canApproveThesis:false;
}
type NoteRow={path:string;frontmatter:string|null};
type Obj=Record<string,unknown>;
const text=(v:unknown):string|null=>typeof v==="string"&&v.trim()?v.trim():null;
function sameUrl(a:string,b:string):boolean{
  try{
    const x=new URL(a),y=new URL(b);
    if(x.protocol!=="https:"||y.protocol!=="https:")return false;
    for(const u of [x,y]){
      u.hash="";
      for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
      u.searchParams.sort();
    }
    return x.toString()===y.toString();
  }catch{return false;}
}
function dateOkay(v:unknown):v is string{
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
}
const method=new Set(["external_original_html_open_and_manual_field_comparison",
  "external_original_pdf_open_and_manual_field_comparison"]);
const MAX_PER_CLAIM=20;
export function findSourceObservationReceipts(scope:ReceiptScope):SourceReceiptGateResult{
  const accepted:ReceiptCandidate[]=[];
  const rejected:Array<{path:string;reason:string}>=[];
  // JSON1 query uses exact claim ID rather than reading 200+ company archives
  // or hardcoding a folder/issuer. The limit prevents unbounded payloads.
  const rows=db().prepare(`
    SELECT path, frontmatter FROM notes
    WHERE json_valid(frontmatter)
      AND json_extract(frontmatter, '$.type')='primary_source_verification_receipt'
      AND json_extract(frontmatter, '$.claim_id')=?
    ORDER BY path LIMIT ?`).all(scope.claimId,MAX_PER_CLAIM+1) as NoteRow[];
  const truncated=rows.length>MAX_PER_CLAIM;
  for(const r of rows.slice(0,MAX_PER_CLAIM)){
    let m:Obj;try{m=JSON.parse(r.frontmatter||"{}") as Obj}catch{
      rejected.push({path:r.path,reason:"malformed_frontmatter"});continue;
    }
    const fields:[keyof ReceiptScope,string][]=[
      ["domain","domain"],["entity","entity"],["metric","metric"],["period","period"]];
    const mismatched=fields.some(([k,f])=>text(m[f])?.toLowerCase()!==scope[k]?.toLowerCase());
    if(mismatched){rejected.push({path:r.path,reason:"entity_domain_metric_or_period_mismatch"});continue;}
    if(text(m.original_source)===null||!sameUrl(m.original_source as string,scope.originalSource)){
      rejected.push({path:r.path,reason:"original_source_url_mismatch"});continue;
    }
    if(scope.value===undefined||scope.value===null||scope.unit===undefined||scope.unit===null||
      text(m.value)!==scope.value.trim()||text(m.unit)?.toLowerCase()!==scope.unit.trim().toLowerCase()){
      rejected.push({path:r.path,reason:"numeric_value_or_unit_mismatch"});continue;
    }
    if(m.verification_status!=="selected_fields_checked_against_primary"||
      !method.has(String(m.verification_method))||!dateOkay(m.observed_at)||
      !text(m.source_locator)){
      rejected.push({path:r.path,reason:"missing_observation_method_date_or_locator"});continue;
    }
    const excerpt=text(m.source_excerpt);
    const digest=text(m.source_excerpt_sha256);
    if(!excerpt||!digest||!(/^[a-f0-9]{64}$/i).test(digest)||excerpt.length>5000||
       createHash("sha256").update(excerpt,"utf8").digest("hex")!==digest.toLowerCase()){
      rejected.push({path:r.path,reason:"excerpt_sha256_mismatch_or_missing"});continue;
    }
    if(m.owner_approved===true||m.thesis_change_approved===true){
      // Owner approval is a separate explicitly authorized Safe Edit flow.
      rejected.push({path:r.path,reason:"receipt_cannot_claim_owner_thesis_approval"});continue;
    }
    accepted.push({path:r.path,claimId:scope.claimId,sourceLocator:m.source_locator as string,
      observedAt:m.observed_at as string,excerptSha256:digest.toLowerCase(),
      storedSourceDocumentSha256:text(m.original_source_sha256),
      status:"consistent_stored_excerpt_only",externalSourceFetchedThisCall:false});
  }
  return {status:"receipt_metadata_and_excerpt_integrity_only",
    matchingReceipts:accepted,rejectedReceipts:rejected,returnedRows:rows.length,truncated,
    externalSourceFetchedThisCall:false,
    sourceDocumentBytesArchivedAndVerified:false,
    receiptReviewerIdentityCryptographicallyVerified:false,
    sourceIndependenceVerified:false,canApproveThesis:false};
}

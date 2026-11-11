/** IOS-ORCH-RI-001 / N9: bound one persisted Broker Claim to the native
 * text layer of ONE page of a hash-checked, user-preserved PDF.
 * PDF text extraction is byte-backed, NOT page visual, publisher or economic
 * semantic verification. All APIs are read-only and disabled without opt-in. */
import {createHash} from "node:crypto";
import fs from "node:fs";
import {pdfNativeInfo} from "./pdf-parser-n9";
import {z} from "zod";
import {inspectUserAttachment,MAX_USER_ATTACHMENT_BYTES} from "../user-attachment-vault";
import {readPersistedClaim} from "./canonical-claims";
import {estimateSchema} from "./claim-dimensions";
import {indexedRead} from "./investment-research-context";
import {claimSourceAnchorIssues} from "./claim-value-anchor";
import {resolveNotePath,openNoFollow} from "./paths";

export const N9_PDF_METHOD="IOS-RI001-N9-POPPLER-TEXT-2";
const digest=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
export const pdfPageEvidenceInputSchema=z.object({
  claimPath:z.string().min(1).max(300).describe("Exact existing, receipt-bound generated Broker Structured Claim path"),
  claimNoteSha256:z.string().regex(/^[a-f0-9]{64}$/).describe("SHA-256 of the entire persisted claim Markdown note"),
  attachmentSha256:z.string().regex(/^[a-f0-9]{64}$/).describe("SHA-256 of the actual existing user-preserved PDF attachment bytes"),
  page:z.number().int().min(1).max(2000).describe("One-based page of the original PDF to inspect")
}).strict();
export type PdfPageEvidenceInput=z.infer<typeof pdfPageEvidenceInputSchema>;
export interface PdfPageEvidencePreview{
  methodVersion:typeof N9_PDF_METHOD;
  status:"pdf_native_page_text_candidate_pending_semantic_review"|"hold";
  issues:string[];
  claim:{path:string;claimId:string;intakeId:string;claimReceiptId:string;sourcePath:string;
    sourceReceiptId:string;metric:string;period:string;value:string;unit:string;
    sourceExcerpt:string;sourceLocator:string;originalSourceUrl:string|null}|null;
  page:{page:number;actualPdfPageCount:number;nativeTextSha256:string;
    nativeTextCharacterCount:number;normalizedExcerptSha256:string;
    matchScope:"single_requested_native_text_page";originalPdfSha256:string;
    originalPdfByteLength:number}|null;
  locatorAgreement:{status:"not_checked"|"agrees"|"conflicts"|"ambiguous"|"not_verifiable";
    requestedPage:number;declaredPage:number|null;authority:"caller_declared_locator_only"};
  originalPdfByteReadbackVerified:boolean;
  originalPdfIsUserAttachment:true;
  sourceToAttachmentReceiptBound:boolean;
  publisherAuthenticated:false;
  pdfPageNativeTextMatch:boolean;
  pdfTextExtractionMethod:"poppler_pdftotext";
  pdfTextExtractionVisuallyVerified:false;
  pdfTablesAndFootnotesVisuallyVerified:false;
  pdfFullDocumentCoverageVerified:false;
  semanticFidelity:"not_assessed";
  claimValueTruthVerified:false;
  independentEvidenceIncrement:0;
  canAutoWrite:false;
  protectedNotesTouched:false;
  caveats:string[];
}
const caveats=[
  "Native PDF text is extracted directly from the exact hash-checked, user-preserved attachment, not from caller-supplied page text.",
  "The PDF is a user-supplied attachment; bytes and source association do not authenticate broker, publisher, filing or document edition.",
  "Only a normalized full excerpt and numeric token are checked against ONE page's native text. This does not visually verify charts, tables, footnotes, scan-only pages, hidden text or semantic claim fidelity.",
  "Page numbers are verified against native PDF page count, but text order and presentation may differ; OCR is not performed.",
  "A supported quote is a candidate for human/source-grounded assessment; it is never Verified Fact, Consensus, Guidance or permission to revise a Thesis, valuation, Portfolio or order.",
  "No original PDF is archived by this tool. The required user attachment must already have been preserved under an authorized earlier operation.",
];
const normalize=(s:string)=>s.normalize("NFC").replace(/[\s\u00a0]+/gu," ").trim();
function locatorAgreement(locator:string,page:number):PdfPageEvidencePreview["locatorAgreement"]{
  const matches=[...locator.matchAll(/(?:\b(?:pdf\s+)?page|\bp\.|หน้า(?:ที่)?)\s*[:#]?\s*([1-9]\d{0,3})(?![\p{L}\p{N}])/giu)];
  const result={requestedPage:page,declaredPage:null,authority:"caller_declared_locator_only" as const};
  if(matches.length!==1)return {...result,status:matches.length?"ambiguous":"not_verifiable"};
  const m=matches[0],tail=locator.slice(m.index!+m[0].length);
  // Ranges, decimal labels and lists cannot be reduced to one physical page.
  if(/^\s*(?:[-–—/]|[.,]\s*\d|(?:to|and|ถึง)\b)/iu.test(tail))return {...result,status:"ambiguous"};
  const declaredPage=Number(m[1]);
  return {...result,declaredPage,status:declaredPage===page?"agrees":"conflicts"};
}
function readOriginal(digestValue:string){
  const attached=inspectUserAttachment({sha256:digestValue,contentType:"application/pdf"});
  if(!attached.byteReadbackVerified)throw Error("n9_attachment_readback_hold");
  const abs=resolveNotePath(attached.path,{allowMissingExt:true});
  const fd=openNoFollow(abs);
  try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.size<16||st.size>MAX_USER_ATTACHMENT_BYTES||
      st.size!==attached.byteLength)throw Error("n9_attachment_size_hold");
    const bytes=fs.readFileSync(fd);
    if(digest(bytes)!==digestValue||!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))
      throw Error("n9_attachment_hash_or_type_hold");
    return {bytes,byteLength:bytes.length,path:attached.path};
  }finally{fs.closeSync(fd);}
}
export async function previewBrokerPdfPageEvidence(raw:unknown):Promise<PdfPageEvidencePreview>{
  const input=pdfPageEvidenceInputSchema.parse(raw);
  let agreement:PdfPageEvidencePreview["locatorAgreement"]={status:"not_checked",requestedPage:input.page,declaredPage:null,authority:"caller_declared_locator_only"};
  const base={
    locatorAgreement:agreement,
    methodVersion:N9_PDF_METHOD as typeof N9_PDF_METHOD,originalPdfByteReadbackVerified:false,
    originalPdfIsUserAttachment:true as const,sourceToAttachmentReceiptBound:false,
    publisherAuthenticated:false as const,pdfPageNativeTextMatch:false,
    pdfTextExtractionMethod:"poppler_pdftotext" as const,pdfTextExtractionVisuallyVerified:false as const,
    pdfTablesAndFootnotesVisuallyVerified:false as const,pdfFullDocumentCoverageVerified:false as const,
    semanticFidelity:"not_assessed" as const,claimValueTruthVerified:false as const,
    independentEvidenceIncrement:0 as const,canAutoWrite:false as const,
    protectedNotesTouched:false as const,caveats
  };
  const issues:string[]=[];
  if(process.env.N9_PDF_PAGE_TEXT_PREVIEW_ENABLED!=="1")
    return {...base,status:"hold",issues:["n9_native_pdf_preview_not_enabled"],claim:null,page:null};
  try{
    const c=readPersistedClaim(input.claimPath);
    const estimate=estimateSchema.safeParse(c.claim.estimate);
    if(digest(c.readbackText)!==input.claimNoteSha256||c.scope.domain!=="company"||
      c.claim.evidence_class!=="analyst_estimate"||
      !estimate.success||estimate.data.role!=="broker_estimate")
      throw Error("n9_broker_claim_binding_hold");
    const src=indexedRead(c.sourcePath);
    const expectedAttachment="07_Sources/ChatGPT/Attachments/"+input.attachmentSha256+".pdf";
    if(src.fm.input_format!=="pdf"||src.fm.source_kind!=="broker_research"||
      src.fm.attachment_path!==expectedAttachment||
      src.fm.attachment_status!=="hash_readback_verified_user_bytes")
      throw Error("n9_source_attachment_link_hold");
    agreement=locatorAgreement(String(c.claim.source_locator),input.page);
    if(agreement.status!=="agrees")throw Error("n9_claim_page_locator_"+agreement.status);
    const file=readOriginal(input.attachmentSha256);
    if(file.path!==expectedAttachment)throw Error("n9_source_attachment_link_hold");
    // The Claim's received-text excerpt has already been validated by
    // readPersistedClaim against its separately receipted original Source.
    // Now cross-check the very same excerpt against native PDF page text.
    const pdf=await pdfNativeInfo(file.bytes,input.page);
    // Async parsing yields to other operations. Recheck the same receipt-bound
    // Claim/Source, current index and attachment bytes before returning a match.
    if(process.env.N9_PDF_PAGE_TEXT_PREVIEW_ENABLED!=="1")throw Error("n9_native_pdf_preview_not_enabled");
    const current=readPersistedClaim(input.claimPath);
    if(digest(current.readbackText)!==input.claimNoteSha256||current.receiptKey!==c.receiptKey||
      current.sourceReceiptKey!==c.sourceReceiptKey||current.sourcePath!==c.sourcePath||
      indexedRead(current.sourcePath).raw!==src.raw)throw Error("n9_binding_changed_during_parse");
    readOriginal(input.attachmentSha256);
    const text=normalize(pdf.text),excerpt=normalize(String(c.claim.source_excerpt));
    const value=String(c.claim.value),qualification=typeof c.claim.qualification==="string"?
      c.claim.qualification:undefined;
    if(excerpt.length<12||text.length>12000||!text.includes(excerpt)||
      claimSourceAnchorIssues(text,excerpt,value,qualification).length)
      throw Error("n9_pdf_page_quote_or_value_unmatched");
    return {...base,locatorAgreement:agreement,status:"pdf_native_page_text_candidate_pending_semantic_review",
      issues,originalPdfByteReadbackVerified:true,sourceToAttachmentReceiptBound:true,
      pdfPageNativeTextMatch:true,
      claim:{path:input.claimPath,claimId:String(c.claim.claim_id),intakeId:c.intakeId,
        claimReceiptId:c.receiptKey,sourcePath:c.sourcePath,sourceReceiptId:c.sourceReceiptKey,
        metric:String(c.claim.metric),period:String(c.claim.period),value,
        unit:String(c.claim.unit),sourceExcerpt:String(c.claim.source_excerpt),
        sourceLocator:String(c.claim.source_locator),
        originalSourceUrl:typeof c.claim.original_source==="string"?c.claim.original_source:null},
      page:{page:input.page,actualPdfPageCount:pdf.count,nativeTextSha256:digest(pdf.text),
        nativeTextCharacterCount:pdf.text.length,normalizedExcerptSha256:digest(excerpt),
        matchScope:"single_requested_native_text_page" as const,
        originalPdfSha256:input.attachmentSha256,originalPdfByteLength:file.byteLength}};
  }catch(error){
    // Native parser stderr, absolute filesystem paths and arbitrary PDF
    // strings must NEVER cross the MCP response boundary on failure.
    const recognized=new Set(["n9_broker_claim_binding_hold","n9_source_attachment_link_hold",
      "n9_attachment_readback_hold","n9_attachment_size_hold","n9_attachment_hash_or_type_hold",
      "n9_pdf_page_count_invalid","n9_pdf_page_out_of_range","n9_page_text_over_limit",
      "n9_no_native_text_on_page","n9_pdf_page_quote_or_value_unmatched",
      "n9_native_pdf_preview_not_enabled","n9_binding_changed_during_parse",
      "n9_claim_page_locator_conflicts","n9_claim_page_locator_ambiguous","n9_claim_page_locator_not_verifiable",
      "n9_pdf_sandbox_unavailable","n9_pdf_sandbox_or_parser_unavailable","n9_pdf_parser_timeout",
      "n9_pdf_parser_output_limit","n9_pdf_parser_busy","n9_pdf_parser_input_hold","n9_pdf_parser_cleanup_hold"]);
    const reason=error instanceof Error&&recognized.has(error.message)?error.message:"n9_pdf_or_claim_binding_unavailable";
    return {...base,locatorAgreement:agreement,status:"hold",issues:[reason],claim:null,page:null};
  }
}

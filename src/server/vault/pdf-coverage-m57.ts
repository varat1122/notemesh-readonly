/** M5.7.1: read-only coverage/lineage preflight for externally extracted PDF pages.
 * This does not OCR, render, fetch, store or authenticate original PDF bytes.
 */
import {createHash} from "node:crypto";
import {inspectUserAttachment} from "../user-attachment-vault";

const digest=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
export type PdfPageExtraction={page:number;text:string;tables:"extracted"|"present_unextracted"|"none_reported"|"unknown";
  figures:"extracted"|"present_unextracted"|"none_reported"|"unknown";
  footnotes:"extracted"|"present_unextracted"|"none_reported"|"unknown"};
export function planPdfCoverageM57(input:{attachmentSha256:string;pageCount:number;pages:PdfPageExtraction[];
  extractionEngine:string;extractionDate:string;documentLabel:string}){
  if(!/^[a-f0-9]{64}$/.test(input.attachmentSha256))throw Error("M57_PDF_INVALID_ORIGINAL_DIGEST");
  if(!Number.isInteger(input.pageCount)||input.pageCount<1||input.pageCount>2000)throw Error("M57_PDF_PAGE_COUNT_OUT_OF_RANGE");
  if(!input.extractionEngine.trim()||input.extractionEngine.length>120||!input.documentLabel.trim()||input.documentLabel.length>200||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.extractionDate)||Number.isNaN(Date.parse(input.extractionDate))||
    new Date(input.extractionDate+"T00:00:00Z").toISOString().slice(0,10)!==input.extractionDate)
    throw Error("M57_PDF_EXTRACTION_PROVENANCE_REQUIRED");
  if(input.pages.length>input.pageCount)throw Error("M57_PDF_PAGE_COUNT_INCONSISTENT");
  const seen=new Set<number>();
  for(const p of input.pages){
    if(!Number.isInteger(p.page)||p.page<1||p.page>input.pageCount||seen.has(p.page))throw Error("M57_PDF_PAGE_NUMBER_INVALID_OR_DUPLICATE");
    if(p.text.length>12000)throw Error("M57_PDF_PAGE_TEXT_TOO_LONG: submit an externally verified page segmentation before planning");
    if(!["extracted","present_unextracted","none_reported","unknown"].includes(p.tables)||
       !["extracted","present_unextracted","none_reported","unknown"].includes(p.figures)||
       !["extracted","present_unextracted","none_reported","unknown"].includes(p.footnotes))
      throw Error("M57_PDF_INVALID_VISUAL_COVERAGE_STATUS");
    seen.add(p.page);
  }
  // Checking the immutable archived bytes is necessary, but still not proof
  // that a supplied page extraction actually corresponds to those bytes.
  const attachment=inspectUserAttachment({sha256:input.attachmentSha256,contentType:"application/pdf"});
  const pages=[...input.pages].sort((a,b)=>a.page-b.page).map(p=>({
    page:p.page,textSha256:digest(p.text),characterCount:p.text.length,
    extractionStatus:p.text.trim()?"provided_not_verified_against_pdf":"empty_text_requires_visual_review",
    tables:p.tables,figures:p.figures,footnotes:p.footnotes
  }));
  const missingPages=Array.from({length:input.pageCount},(_,i)=>i+1).filter(n=>!seen.has(n));
  const unresolvedVisualPages=pages.filter(p=>[p.tables,p.figures,p.footnotes].some(s=>s==="unknown"||s==="present_unextracted")).map(p=>p.page);
  const emptyTextPages=pages.filter(p=>p.characterCount===0||p.extractionStatus==="empty_text_requires_visual_review").map(p=>p.page);
  const complete=missingPages.length===0&&unresolvedVisualPages.length===0&&emptyTextPages.length===0;
  return {status:complete&&attachment.byteReadbackVerified?"manifest_complete_not_content_verified":"coverage_incomplete" as const,
    documentLabel:input.documentLabel,extractionEngine:input.extractionEngine,extractionDate:input.extractionDate,
    originalAttachment:{path:attachment.path,sha256:input.attachmentSha256,byteLength:attachment.byteLength,
      byteReadbackVerified:attachment.byteReadbackVerified,publisherVerified:false,remoteSyncVerified:false},
    pageCount:input.pageCount,submittedPageCount:pages.length,pages,missingPages,emptyTextPages,unresolvedVisualPages,
    extractionMatchesOriginalVerified:false,visualInterpretationVerified:false,
    writePerformed:false,protectedNotesTouched:false,
    warning:"This manifest tracks coverage and supplied page digests only. Every page's text/table/figure/footnote still needs attribution and actual PDF visual verification. No OCR, original PDF archive, new Source Receipt or Review write occurs."};
}

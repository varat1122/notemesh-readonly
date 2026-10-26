import {describe,it,expect,vi} from "vitest";
vi.mock("../user-attachment-vault",()=>({
  inspectUserAttachment:vi.fn(({sha256}:{sha256:string})=>({path:`07_Sources/ChatGPT/Attachments/${sha256}.pdf`,
    byteReadbackVerified:true,byteLength:1024,publisherVerified:false,remoteSyncVerified:false}))
}));
import {planPdfCoverageM57} from "./pdf-coverage-m57";
const sha="a".repeat(64);
const base={attachmentSha256:sha,pageCount:3,extractionEngine:"manual-fixture-v1",extractionDate:"2026-10-26",documentLabel:"Synthetic GS report"};
const page=(n:number,text:string)=>({page:n,text,tables:"none_reported" as const,figures:"none_reported" as const,footnotes:"none_reported" as const});
describe("M5.7.1 PDF coverage preflight does not manufacture extraction verification",()=>{
  it("reports missing pages and unextracted figures with exact page references",()=>{
    const p=planPdfCoverageM57({...base,pages:[page(1,"Page one"),{...page(3,"Page three"),figures:"present_unextracted"}]});
    expect(p.status).toBe("coverage_incomplete");
    expect(p.missingPages).toEqual([2]);
    expect(p.unresolvedVisualPages).toEqual([3]);
    expect(p.pages[0]).toMatchObject({page:1,characterCount:8});
    expect(p.extractionMatchesOriginalVerified).toBe(false);
    expect(p.writePerformed).toBe(false);
  });
  it("even a complete externally declared manifest does not verify OCR against actual PDF",()=>{
    const p=planPdfCoverageM57({...base,pages:[page(1,"A"),page(2,"B"),page(3,"C")]});
    expect(p.status).toBe("manifest_complete_not_content_verified");
    expect(p.originalAttachment.byteReadbackVerified).toBe(true);
    expect(p.extractionMatchesOriginalVerified).toBe(false);
    expect(p.visualInterpretationVerified).toBe(false);
  });
  it("rejects duplicate/out-of-range page identifiers and out-of-bounds text",()=>{
    expect(()=>planPdfCoverageM57({...base,pages:[page(1,"A"),page(1,"B")]})).toThrow("M57_PDF_PAGE_NUMBER_INVALID_OR_DUPLICATE");
    expect(()=>planPdfCoverageM57({...base,pages:[page(4,"A")]})).toThrow("M57_PDF_PAGE_NUMBER_INVALID_OR_DUPLICATE");
    expect(()=>planPdfCoverageM57({...base,pages:[page(1,"x".repeat(12001))]})).toThrow("M57_PDF_PAGE_TEXT_TOO_LONG");
  });
  it("never silently accepts invalid provenance dates",()=>{
    expect(()=>planPdfCoverageM57({...base,extractionDate:"2026-02-30",pages:[]})).toThrow("M57_PDF_EXTRACTION_PROVENANCE_REQUIRED");
  });
});

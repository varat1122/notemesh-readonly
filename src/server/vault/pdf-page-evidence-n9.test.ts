import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {syntheticPdf} from "../../../tests/fixtures/n9-pdf";
import type {WritebackInput} from "./investment-writeback-router";
import type {IntakeClaim} from "./canonical-claims";

vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()}));
const sha=(s:Buffer|string)=>createHash("sha256").update(s).digest("hex");
const actor="oauth:n9-pdf-native-text-fixture";
const quote="TESTCO FY2027 diluted EPS estimate 112.5 USD per share.";
let root:string,vault:string;
beforeEach(async()=>{
  vi.resetModules();
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n9-")));
  vault=path.join(root,"vault");
  for(const p of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])
    fs.mkdirSync(path.join(vault,p),{recursive:true});
  vi.stubEnv("DATA_DIR",root);
  vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,19).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");
  vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  vi.stubEnv("N9_PDF_PAGE_TEXT_PREVIEW_ENABLED","1");
  for(const p of ["01_Companies/TESTCO.md","05_Thesis/TESTCO - Current Thesis.md"]){
    fs.writeFileSync(path.join(vault,p),"# Protected synthetic original\n");
    (await import("./indexer")).reindexPath(p);
  }
});
afterEach(async()=>{
  expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTCO - Current Thesis.md"),"utf8"))
    .toBe("# Protected synthetic original\n");
  (await import("../db")).db().close();
  vi.restoreAllMocks();vi.unstubAllEnvs();
  fs.rmSync(root,{recursive:true,force:true});
});
async function fixture(locator="synthetic original PDF page 2, inline native text (not visually verified)"){
  const userAttachment=await import("../user-attachment-vault");
  const bytes=syntheticPdf(["TESTCO FY2027 diluted EPS 113.5 USD per share - superseded example.",quote]);
  const attachment=userAttachment.storeUserAttachment({base64:bytes.toString("base64"),
    contentType:"application/pdf"});
  const c:IntakeClaim={
    entity:"TESTCO",metric:"diluted EPS",value:"112.5",unit:"USD/share",
    period:"FY2027",evidenceClass:"analyst_estimate",statement:"Synthetic broker estimate only",
    sourceLocator:locator,
    sourceExcerpt:quote,verification:"unverified",
    estimate:{role:"broker_estimate",provider:"TESTBANK",forecastVintage:"2026-10-01"},
    accountingBasis:{standard:"GAAP",shareBasis:"diluted",scope:"consolidated",definition:"diluted EPS"}
  };
  const input:WritebackInput={
    domain:"company",entities:["TESTCO"],topic:"TESTCO synthetic PDF EPS",
    inputFormat:"pdf",sourceKind:"broker_research",sourceChat:"N9 synthetic native PDF",
    extractedText:quote,sourceLanguage:"en",publisher:"Synthetic TESTBANK",
    sourceUrl:"https://example.org/testco-2026-10-01.pdf",
    publicationDate:"2026-10-01",eventDate:"2026-10-01",
    rawAttachmentPath:attachment.path,rawAttachmentSha256:attachment.sha256,
    rawAttachmentContentType:"application/pdf",claims:[c],captureOnly:true
  };
  const {prepareCanonicalWriteback,applyCanonicalWriteback}=await import("../mcp/canonical-writeback");
  const p=prepareCanonicalWriteback(input,actor);
  expect(p.claimIssues).toEqual([]);
  const saved=await applyCanonicalWriteback({
    input,planId:p.planId,
    authorizations:p.previews.map(x=>({operationId:x.operationId,previewToken:x.previewToken,expectedHash:x.beforeHash}))
  },actor);
  expect(saved.steps.some(x=>x.kind==="structured_claim"&&x.state==="verified_existing")).toBe(true);
  const claimPath=saved.steps.find(x=>x.kind==="structured_claim")!.path;
  return {attachment,claimPath,claimNoteSha256:sha(fs.readFileSync(path.join(vault,claimPath)))};
}
async function preview(f:Awaited<ReturnType<typeof fixture>>,page:number,attachmentSha256=f.attachment.sha256){
  return (await import("./pdf-page-evidence-n9")).previewBrokerPdfPageEvidence({
    claimPath:f.claimPath,claimNoteSha256:f.claimNoteSha256,attachmentSha256,page});
}
describe("N9 native PDF page text, user-byte and structured claim binding",()=>{
  it("matches one original PDF page and original claim receipts without writing",async()=>{
    const f=await fixture(),database=(await import("../db")).db();
    const before=database.prepare("SELECT total_changes() n").get();
    const r=await preview(f,2);
    expect(r).toMatchObject({status:"pdf_native_page_text_candidate_pending_semantic_review",
      originalPdfByteReadbackVerified:true,sourceToAttachmentReceiptBound:true,
      publisherAuthenticated:false,pdfPageNativeTextMatch:true,
      pdfTextExtractionVisuallyVerified:false,pdfTablesAndFootnotesVisuallyVerified:false,
      canAutoWrite:false,protectedNotesTouched:false});
    expect(r.locatorAgreement).toEqual({status:"agrees",requestedPage:2,declaredPage:2,authority:"caller_declared_locator_only"});
    expect(r.page).toMatchObject({page:2,actualPdfPageCount:2,originalPdfSha256:f.attachment.sha256});
    expect(r.claim?.sourceExcerpt).toBe(quote);
    expect(r.claim?.claimReceiptId).toMatch(/^ICW-/);
    expect(database.prepare("SELECT total_changes() n").get()).toEqual(before);
  });
  it("L1 holds an explicit persisted page locator conflict even when the requested page contains the quote",async()=>{
    const f=await fixture("PDF page 1");
    const r=await preview(f,2);
    expect(r.status).toBe("hold");
    expect(r).toMatchObject({locatorAgreement:{status:"conflicts",requestedPage:2,declaredPage:1}});
  });
  it("H1 lets the event loop run while the actual benign PDF is parsed",async()=>{
    const f=await fixture();let progressed=false;
    const tick=new Promise<void>(resolve=>setImmediate(()=>{progressed=true;resolve();}));
    const result=await preview(f,2);
    expect(result.status).toBe("pdf_native_page_text_candidate_pending_semantic_review");
    expect(progressed).toBe(true);await tick;
  });
  it("does not match a similar numeric value on an unrelated PDF page",async()=>{
    const f=await fixture("PDF page 1");
    const wrong=await preview(f,1);
    expect(wrong).toMatchObject({status:"hold",claim:null,page:null,
      issues:["n9_pdf_page_quote_or_value_unmatched"]});

  });
  it("rejects an agreed locator outside the actual native page count",async()=>{
    const f=await fixture("PDF page 3");
    expect(await preview(f,3)).toMatchObject({status:"hold",issues:["n9_pdf_page_out_of_range"]});
  });
  it.each(["page 2-3","page 2 and page 3","page 2.5","page 2a","table summary"])("does not guess ambiguous/unstructured locator %s",async locator=>{
    const r=await preview(await fixture(locator),2);
    expect(r.status).toBe("hold");expect(r.pdfPageNativeTextMatch).toBe(false);
    expect(["ambiguous","not_verifiable"]).toContain(r.locatorAgreement.status);
  });
  it.each(["claim","source","attachment"])("rechecks %s binding after async parsing without issuing or rewriting receipts",async target=>{
    const f=await fixture(),parser=await import("./pdf-parser-n9");
    const real=parser.pdfNativeInfo;
    const c=(await import("./canonical-claims")).readPersistedClaim(f.claimPath);
    const d=(await import("../db")).db(),before=d.prepare("SELECT total_changes() n").get();
    vi.spyOn(parser,"pdfNativeInfo").mockImplementation(async(...args)=>{
      const result=await real(...args);
      fs.appendFileSync(path.join(vault,target==="claim"?f.claimPath:target==="source"?c.sourcePath:f.attachment.path),"synthetic drift");
      return result;
    });
    expect((await preview(f,2)).status).toBe("hold");
    expect(d.prepare("SELECT total_changes() n").get()).toEqual(before);
  });
  it("refuses a source-unrelated attachment digest and tampered original PDF bytes",async()=>{
    const f=await fixture();
    const unrelated=await preview(f,2,"0".repeat(64));
    expect(unrelated).toMatchObject({status:"hold",issues:["n9_source_attachment_link_hold"]});
    fs.appendFileSync(path.join(vault,f.attachment.path),"tampered");
    const tampered=await preview(f,2);
    expect(tampered.status).toBe("hold");expect(tampered.originalPdfByteReadbackVerified).toBe(false);
  });
  it("fails closed when the native PDF parser is disabled by the operator",async()=>{
    const f=await fixture();
    vi.stubEnv("N9_PDF_PAGE_TEXT_PREVIEW_ENABLED","0");
    const r=await preview(f,2);
    expect(r).toMatchObject({status:"hold",issues:["n9_native_pdf_preview_not_enabled"]});
  });
  it("holds without a runtime sandbox and never exposes native diagnostics or calls a fallback",async()=>{
    const f=await fixture(),parser=await import("./pdf-parser-n9");
    const called=vi.spyOn(parser,"pdfNativeInfo").mockRejectedValue(Error("n9_pdf_sandbox_unavailable"));
    expect(await preview(f,2)).toMatchObject({status:"hold",issues:["n9_pdf_sandbox_unavailable"],claim:null,page:null});
    expect(called).toHaveBeenCalledTimes(1);
    called.mockRejectedValue(Error("synthetic private native diagnostic"));
    expect(JSON.stringify(await preview(f,2))).not.toContain("synthetic private");
  });
  it("advertises a read-only MCP tool and fences the original user text",async()=>{
    const f=await fixture();
    const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
    const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
    const {createMcpServer}=await import("../mcp/server");
    const server=createMcpServer({read:true,write:false,label:"n9-disposable"});
    const client=new Client({name:"n9-pdf-probe",version:"1.0"});
    const [ct,st]=InMemoryTransport.createLinkedPair();
    try{
      await Promise.all([server.connect(st),client.connect(ct)]);
      const tool=(await client.listTools()).tools.find(x=>x.name==="preview_broker_pdf_page_evidence");
      expect(tool?.annotations).toMatchObject({readOnlyHint:true,openWorldHint:false});
      const result=await client.callTool({name:"preview_broker_pdf_page_evidence",
        arguments:{claimPath:f.claimPath,claimNoteSha256:f.claimNoteSha256,
          attachmentSha256:f.attachment.sha256,page:2}});
      expect(result.isError).not.toBe(true);
      const payload=JSON.parse((result.content as {type:string;text?:string}[]).find(x=>x.type==="text")!.text!);
      expect(payload.status).toBe("pdf_native_page_text_candidate_pending_semantic_review");
      expect(payload.claim.sourceExcerpt).toContain(payload.boundary);
      expect(payload.claim.sourceLocator).toContain(payload.boundary);
      expect(payload.canAutoWrite).toBe(false);
      // Same public MCP path admits no waiting queue; async errors are still
      // structured HOLDs rather than dropped promises or unhandled rejections.
      const args={claimPath:f.claimPath,claimNoteSha256:f.claimNoteSha256,attachmentSha256:f.attachment.sha256,page:2};
      const responses=await Promise.all([client.callTool({name:tool!.name,arguments:args}),client.callTool({name:tool!.name,arguments:args})]);
      const results=responses.map(r=>JSON.parse((r.content as {text:string}[])[0].text));
      expect(results.filter(r=>r.status==="pdf_native_page_text_candidate_pending_semantic_review")).toHaveLength(1);
      expect(results.find(r=>r.status==="hold").issues).toEqual(["n9_pdf_parser_busy"]);
    }finally{await client.close();await server.close();}
  });
});

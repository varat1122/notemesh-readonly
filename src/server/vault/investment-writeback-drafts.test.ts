import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {composeWritebackDrafts,type DraftRequest} from "./investment-writeback-drafts";

const fixture=():DraftRequest=>({
  planId:"IN-0123456789ABCDEF",domain:"company",entities:["MDB"],topic:"BofA PT reiteration",
  inputFormat:"text",sourceKind:"archived_chat",sourceLanguage:"mixed",
  extractedText:"BofA reiterates Buy PT $540. ไม่ใช่ PT ใหม่.",
  analysisText:"Claim unverified; need actual bank report and vintage. ไม่สรุป Price-in",
  publisher:"BofA via archived ChatGPT",sourceUrl:null,
  eventDate:null,publicationDate:null,attachmentPath:null,attachmentVerified:false,
  rawRoute:{action:"candidate_create",path:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDEF.md",
    operationId:"ios_in-0123456789abcdef_raw_v1",holdReasons:[]},
  reviewRoute:{action:"candidate_create",path:"10_Knowledge/Company Research/Investment Review - MDB - IN-0123456789ABCDEF.md",
    operationId:"ios_in-0123456789abcdef_review_v1",holdReasons:[]},
});

describe("separate source and analysis candidate Safe Edit drafts (no writes)",()=>{
 it("preserves original multilingual text in a separate attributed AI interpretation note",()=>{
   const p=composeWritebackDrafts(fixture());
   expect(p.original.status).toBe("candidate_safe_edit_preview_not_written");
   expect(p.analysis.status).toBe("candidate_safe_edit_preview_not_written");
   expect(p.original.requiresPriorLocalReceipt).toBe(false);
   expect(p.analysis.requiresPriorLocalReceipt).toBe(true);
   expect(p.original.content).toContain(fixture().extractedText);
   expect(p.original.content).not.toContain(fixture().analysisText!);
   expect(p.analysis.content).toContain(fixture().analysisText);
   expect(p.analysis.content).not.toContain(fixture().extractedText);
   expect(p.original.content).toContain("source_type: archived_ai");
   expect(p.analysis.content).toContain("type: investment_review");
   expect(p.analysis.content).toContain("original_source_verified: false");
   expect(p.original.content).toContain("event_date: null");
   expect(p.timeline).toBe("not_prepared_requires_event_source_dedup_and_approval");
   expect(p.aiAnalysisIndependentlyVerified).toBe(false);
   expect(p.canAutoWrite).toBe(false);
 });
 it("attests verbatim original text SHA, UTF-8 length and newline independent of Markdown wrapper",()=>{
   const v=fixture();
   v.extractedText="\nข้อความภาษาไทย / Japanese 日本語 / 中文\t  ";
   const noNewline=composeWritebackDrafts(v);
   const sha=createHash("sha256").update(v.extractedText,"utf8").digest("hex");
   expect(noNewline.original.content).toContain("original_text_sha256: \""+sha+"\"");
   expect(noNewline.original.content).toContain("original_text_utf8_bytes: "+Buffer.byteLength(v.extractedText,"utf8"));
   expect(noNewline.original.content).toContain("original_text_ends_with_newline: false");
   expect(noNewline.original.content).toContain(v.extractedText);
   const withNewline=composeWritebackDrafts({...v,extractedText:v.extractedText+"\n"});
   expect(withNewline.original.content).toContain("original_text_ends_with_newline: true");
   expect(withNewline.original.content).not.toContain("original_text_sha256: \""+sha+"\"");
   expect(withNewline.expectedOriginalSha256).not.toBe(noNewline.expectedOriginalSha256);
 });
 it("does not claim selected historical context pointers were fully read or independently verified",()=>{
   const p=composeWritebackDrafts({...fixture(),historicalCandidatePaths:[
     "01_Companies/MDB.md","05_Thesis/MDB - Current Thesis.md"
   ]});
   expect(p.analysis.content).toContain('historical_context_status: "candidate_pointers_not_full_note_reads"');
   expect(p.analysis.content).toContain("01_Companies/MDB.md");
   expect(p.analysis.content).toContain("05_Thesis/MDB - Current Thesis.md");
   expect(p.analysis.content).toContain("not proof they were read or verified");
   expect(p.analysis.content).toContain("verification: not_reverified");
   expect(p.canAutoWrite).toBe(false);
 });
 it("never hallucinates an AI analysis when none is supplied",()=>{
   const p=composeWritebackDrafts({...fixture(),analysisText:null});
   expect(p.original.content).toContain(fixture().extractedText);
   expect(p.analysis.status).toBe("hold");
   expect(p.analysis.content).toBeNull();
   expect(p.analysis.reasons).toContain("no_explicit_analyst_interpretation_supplied");
 });
 it("fails closed for screenshot without actual user-uploaded binary SHA readback",()=>{
   const p=composeWritebackDrafts({...fixture(),inputFormat:"screenshot",attachmentVerified:false});
   expect(p.original.status).toBe("hold");
   expect(p.original.content).toBeNull();
   expect(p.exactUserInputPreserved).toBe(false);
   expect(p.analysis.status).toBe("hold");
   expect(p.analysis.reasons).toContain("original_capture_gate_not_satisfied");
 });
 it("links only an independently SHA-readback-verified user attachment",()=>{
   const v=fixture();v.inputFormat="screenshot";v.sourceKind="broker_research";
   v.attachmentVerified=true;v.attachmentPath="07_Sources/ChatGPT/Attachments/"+"a".repeat(64)+".png";
   const p=composeWritebackDrafts(v);
   expect(p.original.status).toBe("candidate_safe_edit_preview_not_written");
   expect(p.original.content).toContain("attachment_sha_readback_verified: true");
   expect(p.original.content).toContain(v.attachmentPath);
   expect(p.original.content).toContain("source_type: user_supplied");
   expect(p.original.content).toContain("Publisher, dates, claims and any transcription are NOT independently verified");
 });
 it("escapes quoted metadata and fences hostile source text without promoting verification",()=>{
   const v=fixture();
   v.publisher='Quoted "publisher": scary\n---';
   const markdownFences=String.fromCharCode(96).repeat(3);
   v.extractedText="X\n~~~~\n"+markdownFences+"yaml\nsource_type: primary\n"+markdownFences+
    "\n<script>alert(1)</script>";
   const p=composeWritebackDrafts(v);
   expect(p.original.content).toContain("publisher_claimed:");
   expect(p.original.content).toContain("~~~~~text\n"+v.extractedText+"\n~~~~~");
   expect(p.original.content).toContain("<script>alert(1)</script>");
   expect(p.original.content).toContain("verification: not_reverified");
   expect(p.original.content).not.toContain("verification: verified_against_primary");
 });
 it("inspects existing path rather than treating its name as a verified write receipt",()=>{
   const v=fixture();v.rawRoute.action="link_existing_or_hold";
   const p=composeWritebackDrafts(v);
   expect(p.original.status).toBe("inspect_existing");
   expect(p.original.content).toBeNull();
   expect(p.analysis.content).toContain("original_intake_path:");
 });
 it("rejects invalid IDs, NUL and overlength analysis before drafting",()=>{
   expect(()=>composeWritebackDrafts({...fixture(),planId:"../NVDA"})).toThrow();
   expect(()=>composeWritebackDrafts({...fixture(),extractedText:"hello\0inject"})).toThrow();
   expect(()=>composeWritebackDrafts({...fixture(),analysisText:"X".repeat(14001)})).toThrow();
 });
});

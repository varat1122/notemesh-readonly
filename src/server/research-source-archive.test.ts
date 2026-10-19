import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string;
beforeEach(()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"source-archive-")));
  fs.mkdirSync(path.join(root,"vault"),{recursive:true});
  process.env.DATA_DIR=root;
  process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
  vi.resetModules();
});
afterEach(()=>{
  try{const store=requireDb();store?.close();}catch{/* Fixture may not have opened a database. */}
  fs.rmSync(root,{recursive:true,force:true});
  delete process.env.DATA_DIR;
});
function requireDb(){return null as {close():void}|null;}
const url="https://www.sec.gov/Archives/edgar/data/2488/000000248826000123/amd-20260627.htm";
const example=(content="<!doctype html><html><body>SEC original source version one: Q2 AMD revenue 11,536 million.</body></html>")=>({
  originalSource:url,bytes:Buffer.from(content),
  contentType:"text/html" as const,
  capturedAt:"2026-10-17T13:00:00Z",
  captureMethod:"authorized_external_download" as const,
  retrievedFrom:url,
  reviewerOrOperator:"source-ingest-qa",
  responseEtag:"v1"
});
describe("immutable source snapshot byte archive",()=>{
  it("retains actual exact bytes separately from Vault and persists verifiable SHA256 provenance",async()=>{
    const {captureOriginalDocumentBytes,inspectOriginalSourceHistory,sha256}=await import("./research-source-archive");
    const input=example();
    const snap=captureOriginalDocumentBytes(input);
    expect(snap.sha256).toBe(sha256(input.bytes));
    expect(snap.byteLength).toBe(input.bytes.length);
    expect(snap.revision).toBe(1);
    expect(snap.archiveStatus).toBe("intact_stored_bytes");
    expect(snap.publisherAuthenticityVerified).toBe(false);
    const blob=path.join(root,"source-archive","blobs",snap.sha256.slice(0,2),snap.sha256+".bin");
    expect(fs.readFileSync(blob).equals(input.bytes)).toBe(true);
    expect(fs.readdirSync(path.join(root,"vault"))).toEqual([]);
    const history=inspectOriginalSourceHistory(url);
    expect(history.revisionCount).toBe(1);
    expect(history.changesObserved).toBe(false);
    expect(history.snapshots[0].sha256).toBe(snap.sha256);
  });
  it("idempotently deduplicates repeated snapshots while keeping changed raw bytes as version 2",async()=>{
    const {captureOriginalDocumentBytes,inspectOriginalSourceHistory}=await import("./research-source-archive");
    const one=example();
    const initial=captureOriginalDocumentBytes(one);
    const repeated=captureOriginalDocumentBytes({...one,capturedAt:"2026-10-18T10:00:00Z",responseEtag:"same-document"});
    expect(repeated.snapshotId).toBe(initial.snapshotId);
    expect(repeated.revision).toBe(1);
    const second=captureOriginalDocumentBytes(example("<!doctype html><html><body>Amended original filed report 11,537 million.</body></html>"));
    expect(second.revision).toBe(2);
    expect(second.sha256).not.toBe(initial.sha256);
    const history=inspectOriginalSourceHistory(url);
    expect(history.revisionCount).toBe(2);
    expect(history.changesObserved).toBe(true);
    expect(history.snapshots.map(x=>x.revision)).toEqual([1,2]);
    expect(history.publisherAuthenticityVerified).toBe(false);
  });
  it("detects tampered stored bytes without changing or overwriting the archive",async()=>{
    const {captureOriginalDocumentBytes,inspectOriginalSourceHistory}=await import("./research-source-archive");
    const input=example();
    const snap=captureOriginalDocumentBytes(input);
    const blob=path.join(root,"source-archive","blobs",snap.sha256.slice(0,2),snap.sha256+".bin");
    fs.writeFileSync(blob,Buffer.alloc(input.bytes.length,0x7a));
    const inspected=inspectOriginalSourceHistory(url);
    expect(inspected.snapshots[0].archiveStatus).toBe("tampered_or_missing_bytes");
    expect(()=>captureOriginalDocumentBytes(input)).not.toThrow();
    // A duplicate request does not silently replace tampered evidence.
    expect(inspectOriginalSourceHistory(url).snapshots[0].archiveStatus).toBe("tampered_or_missing_bytes");
  });
  it("rejects invalid download provenance, bad PDF, HTTP source and out-of-bound files",async()=>{
    const {captureOriginalDocumentBytes}=await import("./research-source-archive");
    const input=example();
    expect(()=>captureOriginalDocumentBytes({...input,retrievedFrom:"https://phishing.example.org/document"})).toThrow("download_url_must_match_original_source");
    expect(()=>captureOriginalDocumentBytes({...input,originalSource:"http://www.sec.gov/unsafe",retrievedFrom:"http://www.sec.gov/unsafe"})).toThrow("source_url_must_be_standard_https");
    expect(()=>captureOriginalDocumentBytes({...input,contentType:"application/pdf"})).toThrow("file_is_not_pdf");
    expect(()=>captureOriginalDocumentBytes({...input,bytes:Buffer.from("X")})).toThrow("source_document_invalid_size");
    expect(()=>captureOriginalDocumentBytes({...input,bytes:Buffer.alloc(8*1024*1024+1)})).toThrow("source_document_invalid_size");
    expect(()=>captureOriginalDocumentBytes({...input,capturedAt:"2026-02-30T13:00:00Z"})).toThrow("capture_timestamp_invalid");
    expect(fs.readdirSync(path.join(root,"vault"))).toEqual([]);
  });
  it("keeps URL path/query case and canonical tracking-only variants distinct from changed source contents",async()=>{
    const {captureOriginalDocumentBytes,inspectOriginalSourceHistory}=await import("./research-source-archive");
    const input=example();
    const original=captureOriginalDocumentBytes(input);
    const tracking=inspectOriginalSourceHistory(url+"?utm_source=pilot");
    expect(tracking.snapshots[0].snapshotId).toBe(original.snapshotId);
    expect(inspectOriginalSourceHistory(url.replace("amd-20260627.htm","AMD-20260627.htm")).revisionCount).toBe(0);
  });
  it("never promotes the archive into a signed SEC document, source truth, or authorized Thesis approval",async()=>{
    const {captureOriginalDocumentBytes}=await import("./research-source-archive");
    const snap=captureOriginalDocumentBytes(example());
    expect(snap.archiveStatus).toBe("intact_stored_bytes");
    expect(snap.originalDocumentSignatureVerified).toBe(false);
    expect(snap.publisherAuthenticityVerified).toBe(false);
  });
});

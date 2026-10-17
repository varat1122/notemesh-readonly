import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root:string;
const sec="https://www.sec.gov/Archives/edgar/data/2488/000000248826000123/amd-20260627.htm";
const bytes="<html><body>Filed SEC Form 10-Q — raw bytes with revenue table 11,536 and 7,685</body></html>";
const html=(body=bytes)=>new Response(body,{status:200,headers:{"content-type":"text/html; charset=UTF-8",
  "content-length":String(Buffer.byteLength(body)),"etag":'"test-etag-2026-01"'}});
const adapter=(response:Response):typeof fetch=>vi.fn(async()=>response) as unknown as typeof fetch;
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"source-fetch-")));
 fs.mkdirSync(path.join(root,"vault"),{recursive:true});
 process.env.DATA_DIR=root;
 process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
 process.env.SOURCE_ARCHIVE_USER_AGENT="InvestmentOS-TestSuite/1.0 (test-only contact operator@example.org)";
 delete process.env.SOURCE_ARCHIVE_ALLOWED_HOSTS;
 vi.resetModules();
});
afterEach(()=>{
 fs.rmSync(root,{recursive:true,force:true});
 delete process.env.DATA_DIR;
 delete process.env.SOURCE_ARCHIVE_USER_AGENT;
 delete process.env.SOURCE_ARCHIVE_ALLOWED_HOSTS;
});
describe("vault:edit official source HTTP byte ingestion",()=>{
 it("fetches one allowed official original as bytes and records hash and version outside Vault",async()=>{
   const {fetchAndArchiveOfficialSource}=await import("./research-source-fetch");
   const fetched=vi.fn(async()=>html());
   const a=await fetchAndArchiveOfficialSource({url:sec,operator:"oauth:authorized-researcher"},fetched as unknown as typeof fetch);
   expect(a.status).toBe("archived_fetched_bytes_unverified_publisher");
   expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
   expect(a.byteLength).toBe(Buffer.byteLength(bytes));
   expect(a.revision).toBe(1);
   expect(a.publisherAuthenticityVerified).toBe(false);
   expect(a.vaultModified).toBe(false);
   const opts=fetched.mock.calls[0]?.[1] as RequestInit;
   expect(opts.redirect).toBe("manual");
   expect(opts.method).toBe("GET");
   expect(fs.readdirSync(path.join(root,"vault"))).toEqual([]);
   const same=await fetchAndArchiveOfficialSource({url:sec,operator:"oauth:authorized-researcher"},adapter(html()));
   expect(same.revision).toBe(1);
   const later=await fetchAndArchiveOfficialSource({url:sec,operator:"oauth:authorized-researcher"},adapter(html(bytes+" changes")));
   expect(later.revision).toBe(2);
 });
 it("refuses unallowlisted hostname or HTTP URL before any network call",async()=>{
   const {fetchAndArchiveOfficialSource}=await import("./research-source-fetch");
   const fn=vi.fn(async()=>html());
   await expect(fetchAndArchiveOfficialSource({url:"https://www.sec.gov.evil.org/10q",operator:"oauth:research"},fn as unknown as typeof fetch)).rejects.toThrow("source_host_not_allowlisted");
   await expect(fetchAndArchiveOfficialSource({url:"http://www.sec.gov/10q",operator:"oauth:research"},fn as unknown as typeof fetch)).rejects.toThrow("source_url_not_standard_https");
   await expect(fetchAndArchiveOfficialSource({url:"https://127.0.0.1/admin",operator:"oauth:research"},fn as unknown as typeof fetch)).rejects.toThrow("source_host_not_allowlisted");
   expect(fn).not.toHaveBeenCalled();
 });
 it("rejects redirects and HTTP failures without writing raw bytes",async()=>{
   const {fetchAndArchiveOfficialSource}=await import("./research-source-fetch");
   const input={url:sec,operator:"oauth:research"};
   await expect(fetchAndArchiveOfficialSource(input,adapter(new Response(null,{status:302,headers:{location:"http://127.0.0.1/"}})))).rejects.toThrow("source_http_redirect_blocked");
   await expect(fetchAndArchiveOfficialSource(input,adapter(new Response(null,{status:403})))).rejects.toThrow("source_http_status_403");
   expect(fs.readdirSync(path.join(root,"vault"))).toEqual([]);
 });
 it("enforces content type and size on header and streaming body",async()=>{
   const {fetchAndArchiveOfficialSource}=await import("./research-source-fetch");
   const input={url:sec,operator:"oauth:research"};
   await expect(fetchAndArchiveOfficialSource(input,adapter(new Response("not a filing",{status:200,headers:{"content-type":"image/png"}})))).rejects.toThrow("source_content_type_not_supported");
   const oversized=new Response("body",{status:200,headers:{"content-type":"text/html","content-length":String(9*1024*1024)}});
   await expect(fetchAndArchiveOfficialSource(input,adapter(oversized))).rejects.toThrow("source_document_size_limit");
   const streaming=new Response("X".repeat(8*1024*1024+1),{status:200,headers:{"content-type":"text/html"}});
   await expect(fetchAndArchiveOfficialSource(input,adapter(streaming))).rejects.toThrow("source_document_size_limit");
 });
 it("requires configured real-contact user agent and authorized OAuth operator",async()=>{
   const {fetchAndArchiveOfficialSource}=await import("./research-source-fetch");
   const f=vi.fn(async()=>html());
   delete process.env.SOURCE_ARCHIVE_USER_AGENT;
   await expect(fetchAndArchiveOfficialSource({url:sec,operator:"oauth:research"},f as unknown as typeof fetch)).rejects.toThrow("SOURCE_ARCHIVE_USER_AGENT required");
   process.env.SOURCE_ARCHIVE_USER_AGENT="InvestmentOS Test/1.0 with real contact";
   await expect(fetchAndArchiveOfficialSource({url:sec,operator:"api-key:legacy"},f as unknown as typeof fetch)).rejects.toThrow("source_archive_requires_authenticated_oauth_operator");
   expect(f).not.toHaveBeenCalled();
 });
});

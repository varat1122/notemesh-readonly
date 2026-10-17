import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
let root:string,vault:string;
const jpg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]),Buffer.from("synthetic screenshot bytes preserved exactly")]);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from("synthetic PNG image bytes")]);
const pdf=Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"user-screenshot-vault-")));
 vault=path.join(root,"vault");fs.mkdirSync(vault,{recursive:true});
 process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,4).toString("base64");
 process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
});
afterEach(()=>{
 fs.rmSync(root,{recursive:true,force:true});
 delete process.env.DATA_DIR;delete process.env.SAFE_EDIT_ENABLED;delete process.env.SAFE_EDIT_SINGLE_WRITER;
});
describe("content-addressed, no-clobber original user attachment",()=>{
 it("writes exact screenshot JPEG bytes into the vault and reopens SHA-256",async()=>{
  const {storeUserAttachment,inspectUserAttachment}=await import("./user-attachment-vault");
  const saved=storeUserAttachment({base64:jpg.toString("base64"),contentType:"image/jpeg"});
  expect(saved.status).toBe("stored_and_readback_verified");
  expect(saved.path).toMatch(/^07_Sources\/ChatGPT\/Attachments\/[a-f0-9]{64}\.jpg$/);
  expect(saved.byteLength).toBe(jpg.length);
  expect(saved.byteReadbackVerified).toBe(true);
  expect(saved.publisherVerified).toBe(false);
  expect(saved.ocrVerified).toBe(false);
  expect(saved.mobileSyncVerified).toBe(false);
  expect(fs.readFileSync(path.join(vault,saved.path)).equals(jpg)).toBe(true);
  const check=inspectUserAttachment({sha256:saved.sha256,contentType:"image/jpeg"});
  expect(check.byteReadbackVerified).toBe(true);
  const {db}=await import("./db");
  const count=(db().prepare("SELECT COUNT(*) AS n FROM attachments WHERE path=?").get(saved.path) as {n:number}).n;
  expect(count).toBe(1);
 });
 it("reupload is idempotent, existing content never rewritten",async()=>{
  const {storeUserAttachment}=await import("./user-attachment-vault");
  const a=storeUserAttachment({base64:png.toString("base64"),contentType:"image/png"});
  const b=storeUserAttachment({base64:png.toString("base64"),contentType:"image/png"});
  expect(a.duplicate).toBe(false);expect(b.duplicate).toBe(true);
  expect(a.sha256).toBe(b.sha256);
  expect(fs.readFileSync(path.join(vault,a.path)).equals(png)).toBe(true);
 });
 it("accepts a PDF input with exact original bytes, never claims text was extracted",async()=>{
  const {storeUserAttachment}=await import("./user-attachment-vault");
  const s=storeUserAttachment({base64:pdf.toString("base64"),contentType:"application/pdf"});
  expect(s.byteReadbackVerified).toBe(true);
  expect(s.path.endsWith(".pdf")).toBe(true);
  expect(s.ocrVerified).toBe(false);
 });
 it("rejects MIME spoofing and malformed base64 without creating a file",async()=>{
  const {storeUserAttachment}=await import("./user-attachment-vault");
  expect(()=>storeUserAttachment({base64:jpg.toString("base64"),contentType:"application/pdf"})).toThrow(/magic/);
  expect(()=>storeUserAttachment({base64:"AAAA-000",contentType:"image/png"})).toThrow(/base64/);
  expect(fs.readdirSync(vault)).toHaveLength(0);
 });
 it("rejects tampered existing bytes rather than overwrite and reports failed inspection",async()=>{
  const {storeUserAttachment,inspectUserAttachment}=await import("./user-attachment-vault");
  const s=storeUserAttachment({base64:jpg.toString("base64"),contentType:"image/jpeg"});
  fs.writeFileSync(path.join(vault,s.path),Buffer.alloc(jpg.length,0x42));
  const checked=inspectUserAttachment({sha256:s.sha256,contentType:"image/jpeg"});
  expect(checked.status).toBe("missing_or_hash_mismatch");
  expect(()=>storeUserAttachment({base64:jpg.toString("base64"),contentType:"image/jpeg"})).toThrow(/hash_conflict/);
 });
 it("rejects path escape and refuses symlinked archive parents",async()=>{
  const {inspectUserAttachment,storeUserAttachment}=await import("./user-attachment-vault");
  expect(()=>inspectUserAttachment({sha256:"../etc/passwd",contentType:"image/jpeg"})).toThrow();
  fs.mkdirSync(path.join(vault,"07_Sources"),{recursive:true});
  fs.symlinkSync(root,path.join(vault,"07_Sources","ChatGPT"));
  expect(()=>storeUserAttachment({base64:jpg.toString("base64"),contentType:"image/jpeg"})).toThrow();
  expect(fs.existsSync(path.join(root,"Attachments"))).toBe(false);
 });
 it("requires Safe Edit deployment guard, never falls back to unprotected write",async()=>{
  const {storeUserAttachment}=await import("./user-attachment-vault");
  process.env.SAFE_EDIT_ENABLED="0";
  expect(()=>storeUserAttachment({base64:jpg.toString("base64"),contentType:"image/jpeg"})).toThrow(/disabled/);
  expect(fs.readdirSync(vault)).toHaveLength(0);
 });
});

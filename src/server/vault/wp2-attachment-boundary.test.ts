/** WP2 synthetic oracle P12/N21: the dedicated content-addressed 07_Sources/ChatGPT/Attachments
 * writer keeps working after the migration epoch as a NONCANONICAL attachment (real local bytes);
 * generic/raw writes into protected 07_Sources/** fail, and attachment bytes/receipts never mint
 * canonical Source authority. Canonical writeback apply uses SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "./investment-writeback-router";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
const actor="oauth:wp2-attachment-fixture",sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from("WP2 synthetic PNG image bytes")]);
let root:string,vault:string;
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-attach-")));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,41).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","Notes"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"05_Thesis/protected.md"),"# Protected unchanged\n");fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");
 (await import("./indexer")).reindexPath("01_Companies/TESTA.md");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),ops:n("safe_edit_operations"),plan:n("canonical_plan"),witness:n("canonical_witness"),consumption:n("witness_consumption"),receipt:n("safe_edit_operations","WHERE status='written'")};
}

it("P12 positive + N21: attachment writer works post-epoch as noncanonical; protected 07_Sources raw/generic writes fail; no canonical authority minted",async()=>{
 const admission=await import("../safe-edit/admission"),attach=await import("../user-attachment-vault");
 admission.establishMigrationEpoch("wp2-fixture-admin");
 const before=await ledger();
 const saved=attach.storeUserAttachment({base64:png.toString("base64"),contentType:"image/png"});
 expect(saved.path).toMatch(/^07_Sources\/ChatGPT\/Attachments\//);
 expect(fs.readFileSync(path.join(vault,saved.path)).equals(png)).toBe(true);
 expect(attach.inspectUserAttachment({sha256:sha(png),contentType:"image/png"})).toMatchObject({byteReadbackVerified:true});
 expect(attach.storeUserAttachment({base64:png.toString("base64"),contentType:"image/png"})).toMatchObject({duplicate:true});
 const afterAttach=await ledger();
 // The attachment is not a canonical record: no plan, witness, consumption or Safe Edit receipt.
 expect({...afterAttach,raw_file:before.raw_file}).toEqual(before);
 const pr=await import("../safe-edit/protected-records");
 expect(pr.canonicalNamespaceKind(saved.path)).toBeNull();expect(pr.isProtectedPrefix(saved.path)).toBe(true);
 // N21: generic Safe Edit and raw writers cannot write protected 07_Sources/**.
 const engine=await import("../safe-edit/engine"),notes=await import("./notes"),folders=await import("./folders");
 for(const p of ["07_Sources/ChatGPT/Attachments/forged.md","07_sources/ChatGPT/x.md"])
  expect(()=>engine.preview({operationId:"wp2-attach-generic",path:p,reason:"probe",change:{kind:"create",content:"# x\n"}},actor),p).toThrow();
 expect(()=>notes.createNote("07_Sources/ChatGPT/Attachments/raw.md","# raw\n")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>notes.moveNote(saved.path,"Notes/stolen.png")).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>notes.deleteNote(saved.path)).toThrow(/canonical_or_protected_raw_write_refused/);
 expect(()=>folders.moveFolder("07_Sources","Archive")).toThrow(/canonical_or_protected_raw_write_refused/);
 // Attachment bytes/receipt cannot become canonical Source authority.
 const reader=await import("./investment-research-context");
 expect(()=>reader.createReceipt("source_intake",saved.path,png.toString("utf8"))).toThrow(/create_receipt_unverified|receipt_store_missing/);
 // Once the canonical writeback module is loaded, no other module can claim its plan capability;
 // a separately claimable scope still refuses an attachment path as a canonical member.
 const c=await import("../mcp/canonical-writeback");
 expect(()=>admission.claimCanonicalPlanCapability("writeback")).toThrow(/canonical_plan_capability_already_claimed/);
 const open=admission.claimCanonicalPlanCapability("revision");
 expect(()=>open({intakeId:null,actor,recipeVersion:"probe",members:[{kind:"review_revision",operationId:"ICR-"+sha(png).slice(0,32),
  path:saved.path,change:{kind:"append",content:"x"}}]})).toThrow(/canonical_plan_member_scope_hold/);
 expect(await ledger()).toEqual(afterAttach);
 // Adjacent positive: a canonical Source referencing the attachment is still written only through the kernel.
 const input:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic attachment capture",inputFormat:"screenshot",sourceKind:"social_repost",
  sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"WP2 attachment fixture",sourceUrl:null,originalDocumentAccess:"not_obtained",
  extractedText:"SYNTHETIC TESTA screenshot text: an ordinary manual page.",captureOnly:true,
  rawAttachmentSha256:sha(png),rawAttachmentContentType:"image/png"} as WritebackInput;
 const prep=c.prepareCanonicalWriteback(input,actor);
 const out=await c.applyCanonicalWriteback({input,planId:prep.planId,authorizations:prep.previews.map(p=>({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash}))},actor);
 expect(out.status).toBe("source_saved_analysis_pending");
 const src=out.steps[0];expect(src.path).toMatch(/^00_Inbox\/ChatGPT\//);
 expect(admission.operationProvenanceTier(src.receiptKey)).toBe("server_witnessed");
 expect(fs.readFileSync(path.join(vault,saved.path)).equals(png)).toBe(true);
 expect(fs.readFileSync(path.join(vault,src.path),"utf8")).toContain(sha(png));
});

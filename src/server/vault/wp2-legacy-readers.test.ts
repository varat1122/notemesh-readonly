/** WP2 R-2 regression (pre-fix reproduction preserved separately as evidence): on the original
 * candidate a witnessless generic append on a server_witnessed Review was accepted before the
 * epoch and the chain was then mislabelled/denied. OFF, authority path only: SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "./investment-writeback-router";
import {legacyJournalWrite} from "../../../tests/source-event-fixture";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
const actor="oauth:wp2-direct-helper-fixture",sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const review={headlineTh:"TESTA ชี้แจงรายละเอียดคู่มือสมมติ",translationTh:"TESTA เผยแพร่คู่มือสมมติสำหรับการใช้งานและมีคำอธิบายการติดตั้ง",
 whatChangedTh:"รายละเอียดคู่มือเป็นข้อความที่ได้รับ ยังไม่ได้ยืนยันว่ามีผลต่อการลงทุน",mechanismTh:"ยังไม่มีหลักฐานแสดงผลต่อรายได้ กำไร หรือความสัมพันธ์ระหว่างบริษัท",
 thesisImplicationTh:"ไม่เปลี่ยน Thesis หรือ Portfolio จากข้อความดังกล่าว ต้องตรวจหลักฐานเพิ่มเติม",counterEvidenceTh:"ข้อมูลอาจซ้ำกับคู่มือเดิม และยังไม่มีการตรวจสอบต้นฉบับอย่างเป็นอิสระ",
 requiredEvidenceTh:"ต้องอ่านเอกสารต้นฉบับและเปรียบเทียบกับประวัติก่อนยกระดับข้อกล่าวอ้าง"};
const base:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic manual event",inputFormat:"text",sourceKind:"news_media",
 sourceLanguage:"en",sourceChannel:"fixture",contentTypes:["other"],sourceChat:"WP2 direct helper mechanics",sourceUrl:"https://example.org/wp2/direct",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC TESTA: An ordinary manual explains product installation.",researchReview:review};
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-direct-")));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,37).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis","Notes"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 for(const [p,t] of [["05_Thesis/protected.md","# Protected unchanged\n"],["01_Companies/TESTA.md","# TESTA\n"],["Notes/Ordinary.md","# Ordinary\noriginal line\n"]])fs.writeFileSync(path.join(vault,p),t);
 const ix=await import("../vault/indexer");for(const p of ["01_Companies/TESTA.md","Notes/Ordinary.md"])ix.reindexPath(p);
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/protected.md"),"utf8")).toBe("# Protected unchanged\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),ops:n("safe_edit_operations"),plan:n("canonical_plan"),witness:n("canonical_witness"),consumption:n("witness_consumption"),
  epoch:has("authority_epoch")?d.prepare("SELECT * FROM authority_epoch ORDER BY scope_kind,scope_id").all():[],receipt:n("safe_edit_operations","WHERE status='written'"),index:n("notes")};
}
const auth=(p:{operationId:string;previewToken?:string|null;beforeHash:string})=>({operationId:p.operationId,previewToken:p.previewToken!,expectedHash:p.beforeHash});

async function savedReview(){
 const c=await import("../mcp/canonical-writeback"),prep=c.prepareCanonicalWriteback(base,actor);
 const out=await c.applyCanonicalWriteback({input:base,planId:prep.planId,authorizations:prep.previews.map(auth)},actor);
 expect(out.status).toBe("saved_verified");
 const rev=out.steps.find(s=>s.kind==="canonical_review")!,raw0=fs.readFileSync(path.join(vault,rev.path),"utf8");
 return {rev,raw0,heading:raw0.split("\n").find(l=>l.startsWith("## "))!.slice(3)};
}
it("R-2 fixed: a witnessless generic append/replace on a server_witnessed Review is refused before any epoch; reader keeps the witnessed tier",async()=>{
 const engine=await import("../safe-edit/engine"),admission=await import("../safe-edit/admission"),reader=await import("./investment-research-context");
 const {rev,raw0,heading}=await savedReview();
 expect(admission.migrationEpoch()).toBeNull();
 const before=await ledger();
 expect(()=>engine.preview({operationId:"r2-generic-append-1",path:rev.path,reason:"R-2 regression",
  change:{kind:"append",heading,content:"R-2 generic append",date:"2026-11-14"}},actor)).toThrow(/canonical_review_revision_dedicated_route_required/);
 expect(()=>engine.preview({operationId:"r2-generic-replace-1",path:rev.path,reason:"R-2 regression",
  change:{kind:"replace",oldText:heading,newText:heading+" changed"}},actor)).toThrow(/canonical_review_revision_dedicated_route_required/);
 expect(await ledger()).toEqual(before);
 expect(fs.readFileSync(path.join(vault,rev.path),"utf8")).toBe(raw0);
 expect(reader.receiptProvenance("canonical_review",rev.path,raw0)).toMatchObject({receiptId:rev.receiptKey,tier:"server_witnessed",baseSha256:null});
 expect(reader.createReceipt("canonical_review",rev.path,raw0)).toBe(rev.receiptKey);
});
it("R-2 reader semantics: a witnessless append found in an existing journal on a witnessed origin is never uplifted (fail-closed)",async()=>{
 const reader=await import("./investment-research-context");
 const {rev,heading}=await savedReview();
 // Synthetic out-of-band history (e.g. imported from the original candidate's journal).
 const {after}=await legacyJournalWrite(rev.path,"r2-legacy-append-1",actor,{kind:"append",heading,content:"out-of-band append",date:"2026-11-14"});
 const p=reader.receiptProvenance("canonical_review",rev.path,after);
 expect(p.tier).not.toBe("server_witnessed");expect(p.tier).not.toBe("server_witnessed_revision_on_legacy_base");
 expect(()=>reader.createReceipt("canonical_review",rev.path,after)).toThrow(/create_receipt_unverified/);
});

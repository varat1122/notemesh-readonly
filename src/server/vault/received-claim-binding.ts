/** RI001-3 received-text binding. A predicted operation reference is NOT a
 * receipt. Only readback of the actual Source journal can establish persistence. */
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {splitFrontmatter} from "./markdown";
import {indexedRead,createReceipt} from "./investment-research-context";
import {preservedSubmittedText} from "./research-decision-v2";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const receivedBindingSchema=z.object({
  version:z.literal("RI001-RECEIVED-1"),origin:z.literal("received_user_source"),originalPublisherUrl:z.null(),
  intakeId:z.string().regex(/^IN-[A-F0-9]{16}$/),sourcePath:z.string(),sourceNoteSha256:hash,preservedTextSha256:hash,
  sourceReceiptOperationId:z.string().regex(/^ICW-[a-f0-9]{32}$/),receiptRequirement:z.literal("durable_source_receipt_before_claim_write"),
  quote:z.object({start:z.number().int().nonnegative(),end:z.number().int().positive(),text:z.string().min(1).max(3000).refine(s=>Boolean(s.trim())),
    locator:z.string(),declaredLocator:z.string().trim().min(1).max(500)}).strict()
}).strict();
export function receivedClaimBinding(intakeId:string,sourcePath:string,sourceContent:string,text:string,quote:string,declaredLocator:string){
  const start=text.indexOf(quote),digest=sha(sourceContent),end=start+quote.length;
  if(start<0)throw Error("claim_literal_source_anchor_missing");
  return receivedBindingSchema.parse({version:"RI001-RECEIVED-1",origin:"received_user_source",originalPublisherUrl:null,
    intakeId,sourcePath,sourceNoteSha256:digest,preservedTextSha256:sha(text),sourceReceiptOperationId:"ICW-"+sha(["source_intake",sourcePath,digest].join("\n")).slice(0,32),
    receiptRequirement:"durable_source_receipt_before_claim_write",quote:{start,end,text:quote,locator:`utf16:${start}:${end}`,declaredLocator}});
}
export function verifyReceivedClaimSource(raw:unknown,stage:"preview"|"apply",actor?:string){
  const b=receivedBindingSchema.parse(raw);
  if(b.sourcePath!==`00_Inbox/ChatGPT/Investment Intake - ${b.intakeId}.md`||
    b.sourceReceiptOperationId!=="ICW-"+sha(["source_intake",b.sourcePath,b.sourceNoteSha256].join("\n")).slice(0,32))throw Error("received_claim_source_identity_hold");
  let source:string;let receiptStatus:"pending_not_issued"|"durable_verified";
  // A prepared Source is usable only to preview. Apply/cold read require the
  // actual physical/indexed Source and exact written receipt. Never mint one.
  const op=db().prepare("SELECT actor,status,after_text,after_hash,payload FROM safe_edit_operations WHERE id=?").get(b.sourceReceiptOperationId) as
    {actor:string;status:string;after_text:string;after_hash:string;payload:string}|undefined;
  if(stage==="preview"&&op?.status==="preview"&&op.actor===actor){
    const p=JSON.parse(op.payload);
    if(p.path!==b.sourcePath||p.operationId!==b.sourceReceiptOperationId||p.change?.kind!=="create"||p.change.content!==op.after_text||op.after_hash!==sha(op.after_text))throw Error("received_claim_source_preview_hold");
    source=op.after_text;receiptStatus="pending_not_issued";
  }else{
    const read=indexedRead(b.sourcePath);source=read.raw;
    if(createReceipt("source_intake",b.sourcePath,source)!==b.sourceReceiptOperationId)throw Error("received_claim_source_receipt_hold");
    const row=db().prepare("SELECT body FROM notes_fts WHERE path=? AND notes_fts MATCH ?").get(b.sourcePath,"InvestmentIntake"+b.intakeId.slice(3)) as {body:string}|undefined;
    if(!row||row.body!==read.body)throw Error("received_claim_source_index_hold");
    receiptStatus="durable_verified";
  }
  const fm=splitFrontmatter(source).data,text=preservedSubmittedText(source);
  const original=text===null?null:[text,text+"\n"].find(s=>sha(s)===b.preservedTextSha256);
  if(sha(source)!==b.sourceNoteSha256||fm.intake_id!==b.intakeId||fm.type!=="investment_source_intake"||
    fm.source_text_sha256!==b.preservedTextSha256||(fm.source_url!=null&&fm.source_url!=="")||!original||
    b.quote.end>b.quote.start+3000||b.quote.end>original.length||original.slice(b.quote.start,b.quote.end)!==b.quote.text||
    b.quote.locator!==`utf16:${b.quote.start}:${b.quote.end}`)throw Error("received_claim_source_binding_hold");
  return {binding:b,original,receiptStatus};
}

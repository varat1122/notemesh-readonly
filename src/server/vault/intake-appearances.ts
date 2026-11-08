/** Durable received appearances live in the existing Safe Edit event journal.
 * This module is SELECT/readback only. Only canonical prepare records events
 * through the Safe Edit engine; no Source IDs, bytes or receipts are rewritten. */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {env} from "../env";
import {indexedRead,createReceipt} from "./investment-research-context";
import type {WritebackInput} from "./investment-writeback-router";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const text=(max:number)=>z.string().trim().min(1).max(max);
export const appearanceSchema=z.object({key:text(120),channel:text(80),locator:text(600),
  receivedAt:z.string().datetime({offset:true}).nullable()}).strict().describe("Optional durable received-appearance accounting. Use a stable occurrence key for retries and a different key for each separate message/file appearance. Channel/locator/time are attributed, not independently authenticated. receivedAt is the reported arrival time, null if unknown; server admission time is recorded separately. Does not change Source identity or evidence independence.");
export type AppearanceInput=z.infer<typeof appearanceSchema>;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const appearancePayloadSchema=z.object({version:z.literal("RI001-APPEARANCE-1"),appearanceId:z.string().regex(/^IAP-[A-F0-9]{32}$/),
  actorSha256:digest,appearance:appearanceSchema,intakeId:z.string().regex(/^IN-[A-F0-9]{16}$/),
  sourcePath:text(600),sourceOperationId:text(80),sourceNoteSha256:digest,
  receivedText:z.string().min(1).max(12000),receivedTextSha256:digest,
  inputFormat:text(40),sourceKind:text(80),sourceChat:text(120),sourceUrl:z.string().max(1000).nullable(),
  publisher:z.string().max(160).nullable(),attributedOrigin:z.string().max(160).nullable(),
  sourceChannel:z.string().max(80).nullable(),sourceLanguage:z.string().max(35).nullable(),
  attachmentPath:z.string().max(600).nullable(),attachmentSha256:digest.nullable(),
  eventDate:z.string().nullable(),publicationDate:z.string().nullable()}).strict();
export type AppearancePayload=z.infer<typeof appearancePayloadSchema>;
export function canonicalAppearance(input:WritebackInput,source:{path:string;receiptKey:string;expectedSha256:string},intakeId:string,actor:string):AppearancePayload|null{
  if(!input.appearance)return null;
  const appearance=appearanceSchema.parse(input.appearance),actorSha256=sha(actor);
  return appearancePayloadSchema.parse({version:"RI001-APPEARANCE-1",appearanceId:"IAP-"+sha(JSON.stringify([actorSha256,appearance.key])).slice(0,32).toUpperCase(),
    actorSha256,appearance,intakeId,sourcePath:source.path,sourceOperationId:source.receiptKey,sourceNoteSha256:source.expectedSha256,
    receivedText:input.extractedText,receivedTextSha256:sha(input.extractedText),inputFormat:input.inputFormat,sourceKind:input.sourceKind,
    sourceChat:input.sourceChat,sourceUrl:input.sourceUrl??null,publisher:input.publisher??null,attributedOrigin:input.attributedOrigin??null,
    sourceChannel:input.sourceChannel??null,sourceLanguage:input.sourceLanguage??null,
    attachmentPath:input.rawAttachmentPath??null,attachmentSha256:input.rawAttachmentSha256??null,eventDate:input.eventDate??null,publicationDate:input.publicationDate??null});
}
export function sealAppearance(payload:AppearancePayload,recordedAt:string){
  const body=JSON.stringify(appearancePayloadSchema.parse(payload));
  return {appearanceId:payload.appearanceId,body,recordedAt,seal:createHmac("sha256",env.encryptionKey).update("raw-appearance-v1\0"+recordedAt+"\0"+body).digest("hex")};
}
export function appearanceRows(appearanceId:string){
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get())return [];
  return db().prepare(`SELECT at,operation_id,actor,detail FROM safe_edit_events WHERE event='raw_appearance'
    AND json_valid(detail) AND json_extract(detail,'$.appearanceId')=? LIMIT 2`).all(appearanceId) as AppearanceRow[];
}
interface AppearanceRow {at:string;operation_id:string;actor:string;detail:string}
function decode(row:AppearanceRow){
  const envelope=z.object({appearanceId:z.string(),body:z.string().max(100000),recordedAt:z.string().datetime(),seal:digest}).strict().parse(JSON.parse(row.detail));
  const seal=createHmac("sha256",env.encryptionKey).update("raw-appearance-v1\0"+envelope.recordedAt+"\0"+envelope.body).digest("hex");
  if(!timingSafeEqual(Buffer.from(seal,"hex"),Buffer.from(envelope.seal,"hex")))throw Error("appearance_journal_integrity_hold");
  const payload=appearancePayloadSchema.parse(JSON.parse(envelope.body));
  if(payload.appearanceId!==envelope.appearanceId||payload.actorSha256!==sha(row.actor)||payload.sourceOperationId!==row.operation_id||
    payload.sourcePath!==`00_Inbox/ChatGPT/Investment Intake - ${payload.intakeId}.md`||sha(payload.receivedText)!==payload.receivedTextSha256||
    payload.appearanceId!=="IAP-"+sha(JSON.stringify([payload.actorSha256,payload.appearance.key])).slice(0,32).toUpperCase()||
    row.at!==envelope.recordedAt)throw Error("appearance_journal_binding_hold");
  return payload;
}
export function requireAppearance(payload:AppearancePayload){
  const rows=appearanceRows(payload.appearanceId);
  if(rows.length!==1||JSON.stringify(decode(rows[0]))!==JSON.stringify(payload))throw Error("appearance_missing_or_conflicting_retry_hold");
  return appearanceView(rows[0],false);
}
function appearanceView(row:AppearanceRow,includeText:boolean){
  const p=decode(row);
  let disposition:"pending_source"|"source_bound"|"binding_hold"="binding_hold",reason:string|null="source_receipt_readback_unverified";
  const operation=db().prepare("SELECT status FROM safe_edit_operations WHERE id=?").get(p.sourceOperationId) as {status:string}|undefined;
  if(operation?.status==="preview"){disposition="pending_source";reason="source_preview_not_written";}
  else if(operation?.status==="written")try{
    const source=indexedRead(p.sourcePath);
    if(sha(source.raw)!==p.sourceNoteSha256||source.fm.source_text_sha256!==p.receivedTextSha256||source.fm.intake_id!==p.intakeId||
      createReceipt("source_intake",p.sourcePath,source.raw)!==p.sourceOperationId)throw Error("unbound");
    disposition="source_bound";reason=null;
  }catch{/* Historical bytes/receipts stay unchanged; report current revalidation HOLD. */}
  const {receivedText,...summary}=p;
  return {...summary,...(includeText?{receivedText}:{}),recordedAt:row.at,reportedReceivedAt:p.appearance.receivedAt,
    disposition,reason,originIndependenceIncrement:0,sourceAuthenticity:"not_verified",locatorAuthority:"caller_declared",
    bindingMeaning:"exact_preserved_source_receipt_only_not_verified_economic_event"};
}
export function inspectIntakeAppearances(intakeId:string,appearanceId?:string,offset=0){
  z.string().regex(/^IN-[A-F0-9]{16}$/).parse(intakeId);
  if(appearanceId)z.string().regex(/^IAP-[A-F0-9]{32}$/).parse(appearanceId);
  z.number().int().min(0).max(100000).parse(offset);
  const exists=db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get();
  const rows=exists?db().prepare(`SELECT at,operation_id,actor,detail FROM safe_edit_events WHERE event='raw_appearance' AND json_valid(detail)
    AND json_valid(json_extract(detail,'$.body')) AND json_extract(json_extract(detail,'$.body'),'$.intakeId')=?
    AND (? IS NULL OR json_extract(detail,'$.appearanceId')=?) ORDER BY rowid LIMIT 26 OFFSET ?`).all(intakeId,appearanceId??null,appearanceId??null,offset) as AppearanceRow[]:[];
  const items=rows.slice(0,25).map(row=>appearanceView(row,!!appearanceId));
  return {version:"RI001-APPEARANCE-1",intakeId,items,offset,hasMore:rows.length>25,
    coverage:"recorded_canonical_appearances_only_no_historical_backfill",writesPerformed:false};
}

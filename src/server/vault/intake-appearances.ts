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
  return db().prepare(`SELECT rowid,at,operation_id,actor,detail FROM safe_edit_events WHERE event='raw_appearance'
    AND CASE WHEN json_valid(detail) THEN json_extract(detail,'$.appearanceId') END=? ORDER BY rowid LIMIT 2`).all(appearanceId) as AppearanceRow[];
}
interface AppearanceRow {rowid:number;at:string;operation_id:string;actor:string;detail:string}
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
/** No journal creation. Known conflicting/corrupt retries fail before Preview.
 * A malformed scoped row cannot be silently bypassed by issuing another ID. */
export function checkAppearanceRetry(payload:AppearancePayload){
  const rows=appearanceRows(payload.appearanceId);
  if(rows.length)requireAppearance(payload);
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get())return;
  const unreadable=db().prepare(`SELECT 1 FROM safe_edit_events WHERE event='raw_appearance' AND operation_id=?
    AND CASE WHEN json_valid(detail) THEN json_type(detail,'$.appearanceId')='text' AND json_valid(json_extract(detail,'$.body')) ELSE 0 END IS NOT 1 LIMIT 1`).get(payload.sourceOperationId);
  if(unreadable)throw Error("appearance_scoped_journal_unreadable_hold");
}
function failureReason(error:unknown){
  return error instanceof Error&&["appearance_journal_integrity_hold","appearance_journal_binding_hold","appearance_missing_or_conflicting_retry_hold"].includes(error.message)?error.message:"appearance_journal_readback_hold";
}
export function appearanceReadback(payload:AppearancePayload){
  try{return requireAppearance(payload);}catch(error){return {appearanceId:payload.appearanceId,intakeId:payload.intakeId,
    disposition:"binding_hold" as const,reason:failureReason(error),originIndependenceIncrement:0,sourceAuthenticity:"not_verified"};}
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
type InspectionAppearance=Partial<Omit<ReturnType<typeof appearanceView>,"appearanceId">>&{
  recordRef:string;appearanceId:string|null;intakeId:string;disposition:"pending_source"|"source_bound"|"binding_hold";reason:string|null};
export function inspectIntakeAppearances(intakeId:string,appearanceId?:string,offset=0){
  z.string().regex(/^IN-[A-F0-9]{16}$/).parse(intakeId);
  if(appearanceId)z.string().regex(/^IAP-[A-F0-9]{32}$/).parse(appearanceId);
  z.number().int().min(0).max(100000).parse(offset);
  const exists=db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get();
  // Scope through the existing owning Source operation, not corruptible JSON
  // inside the appearance. Malformed rows retain their place in pagination.
  const rows=exists?db().prepare(`SELECT e.rowid,e.at,e.operation_id,e.actor,e.detail FROM safe_edit_events e
    JOIN safe_edit_operations o ON o.id=e.operation_id WHERE e.event='raw_appearance'
    AND CASE WHEN json_valid(o.payload) THEN json_extract(o.payload,'$.path') END=?
    AND (? IS NULL OR CASE WHEN json_valid(e.detail) THEN json_extract(e.detail,'$.appearanceId') END=?
      OR CASE WHEN json_valid(e.detail) THEN json_extract(e.detail,'$.appearanceId') END IS NULL)
    ORDER BY e.rowid LIMIT 26 OFFSET ?`).all(`00_Inbox/ChatGPT/Investment Intake - ${intakeId}.md`,appearanceId??null,appearanceId??null,offset) as AppearanceRow[]:[];
  const items:InspectionAppearance[]=rows.slice(0,25).map(row=>{
    try{const view=appearanceView(row,!!appearanceId);if(view.intakeId!==intakeId)throw Error("appearance_journal_binding_hold");
      return {...view,recordRef:`appearance-event:${row.rowid}`};}
    catch(error){return {recordRef:`appearance-event:${row.rowid}`,appearanceId:null,intakeId,disposition:"binding_hold" as const,
      reason:failureReason(error),originIndependenceIncrement:0,sourceAuthenticity:"not_verified"};}
  });
  // If even Source-operation ownership is damaged, do not guess an Intake or
  // claim a complete clean journal. Valid scoped rows remain individually usable.
  const unscopedJournalHold=!!(exists&&db().prepare(`SELECT 1 FROM safe_edit_events e LEFT JOIN safe_edit_operations o ON o.id=e.operation_id
    WHERE e.event='raw_appearance' AND (o.id IS NULL OR CASE WHEN json_valid(o.payload) THEN json_type(o.payload,'$.path')='text' ELSE 0 END IS NOT 1) LIMIT 1`).get());
  return {version:"RI001-APPEARANCE-1",intakeId,items,offset,hasMore:rows.length>25,integrityHolds:items.filter(x=>x.disposition==="binding_hold").length,
    unscopedJournalHold,
    coverage:"recorded_canonical_appearances_only_no_historical_backfill",writesPerformed:false};
}

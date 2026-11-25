/** Explicit received-source declaration only; never geographic/primary truth.
 * Pure validation shared by capture and physical readback. No IO or authority. */
import {z} from "zod";
import {judgeHash,exactTextReference,stableJudgeJson} from "./research-judge-contract";
export const MACRO_SOURCE_POLICY="RI001-MACRO-SOURCE-SCOPE-1";
export const MACRO_HISTORY_POLICY="RI001-MACRO-HISTORY-1";
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const macroSubjectSchema=z.object({version:z.literal(MACRO_SOURCE_POLICY),kind:z.literal("country"),
  label:z.string().min(1).max(120),anchor:z.object({quote:z.string().min(1).max(160),
    locator:z.string().max(80),sourceSha256:hash}).strict()}).strict();
/** v1 input type, unchanged (existing typed callers use it). Runtime validation
 * accepts the versioned union; see MacroSubjectInput. */
export type MacroSubject=z.infer<typeof macroSubjectSchema>;
export const macroKey=(label:string)=>label.trim().normalize("NFC").toUpperCase();
export const macroHistoryScopeSchema=z.object({version:z.literal(MACRO_HISTORY_POLICY),key:z.string().min(1).max(120),
  label:z.string().min(1).max(120)}).strict().refine(s=>s.key===macroKey(s.label));
export type MacroHistoryScope=z.infer<typeof macroHistoryScopeSchema>;
const macroSourceScopeV1Schema=macroSubjectSchema.extend({key:z.string().min(1).max(120),
  authority:z.literal("source_declared_not_geographic_verification")}).strict();
// B1 (MACRO_SOURCE_POLICY_V2): a sender declaration kept OUTSIDE the received
// publisher text. Nothing is inserted into or anchored inside the original; the
// declaration is bound by the whole-note Safe Edit receipt. It states what the
// sender declared, never that the publisher authored it or that it is true.
export const MACRO_SOURCE_POLICY_V2="RI001-MACRO-SOURCE-SCOPE-2";
export const macroSenderDeclarationSchema=z.object({version:z.literal(MACRO_SOURCE_POLICY_V2),kind:z.literal("country"),
  label:z.string().min(1).max(120)}).strict();
const macroSourceScopeV2Schema=macroSenderDeclarationSchema.extend({key:z.string().min(1).max(120),
  authority:z.literal("sender_declared_not_publisher_authored")}).strict();
/** Versioned input: v1 (exact first-line declaration already present in the
 * received text) or v2 (separate sender declaration). Version literals never mix. */
export const macroSubjectInputSchema=z.union([macroSubjectSchema,macroSenderDeclarationSchema]);
export type MacroSubjectInput=z.infer<typeof macroSubjectInputSchema>;
export const macroSourceScopeSchema=z.union([macroSourceScopeV1Schema,macroSourceScopeV2Schema]);
export type MacroSourceScope=z.infer<typeof macroSourceScopeSchema>;
export type MacroScopeResolution={binding:MacroSourceScope|null;reason:string|null};
// Deliberately narrow grammar: one declaration, no lists/conjunctions/aliases.
// Unsupported real country names stay unscoped.
const labelInvalid=(label:string)=>macroKey(label).length>120||label!==label.trim()||!/^\p{L}[\p{L}\p{M} '-]*$/u.test(label)||/\b(?:and|or)\b/i.test(label);
export function validateMacroSubject(value:unknown,text:string,domain:string,entities?:string[]):MacroScopeResolution{
  const v2=macroSenderDeclarationSchema.safeParse(value);
  if(v2.success){
    if(domain!=="macro")return {binding:null,reason:"macro_subject_contract_hold"};
    const s=v2.data,key=macroKey(s.label);
    if(labelInvalid(s.label)||(entities&&(entities.length!==1||macroKey(entities[0])!==key)))
      return {binding:null,reason:"macro_sender_declaration_hold"};
    return {binding:{...s,key,authority:"sender_declared_not_publisher_authored"},reason:null};
  }
  const p=macroSubjectSchema.safeParse(value);
  if(!p.success||domain!=="macro")return {binding:null,reason:"macro_subject_contract_hold"};
  const s=p.data,key=macroKey(s.label),line="Macro subject: "+s.label;
  // v1: first complete line of the received text, exactly one declaration.
  if(key.length>120||s.label!==s.label.trim()||!/^\p{L}[\p{L}\p{M} '-]*$/u.test(s.label)||/\b(?:and|or)\b/i.test(s.label)||
    (text.match(/macro\s+subject\s*:/gi)??[]).length!==1||text.split(/\r?\n/,1)[0]!==line||
    s.anchor.quote!==line||s.anchor.locator!==`utf16:0:${line.length}`||
    !exactTextReference({key:"received_source",...s.anchor},text,judgeHash(text))||
    (entities&&(entities.length!==1||macroKey(entities[0])!==key)))
    return {binding:null,reason:"macro_subject_anchor_hold"};
  return {binding:{...s,key,authority:"source_declared_not_geographic_verification"},reason:null};
}
export function readMacroSourceScope(value:unknown,preserved:string,recordedTextSha:unknown):MacroSourceScope{
  const p=macroSourceScopeSchema.safeParse(value);
  if(!p.success)throw Error("macro_source_scope_hold");
  // The original fence removes one terminal LF; restore ONLY by exact stored
  // SHA, never by whitespace normalization or a caller assertion.
  const text=[preserved,preserved+"\n"].find(s=>judgeHash(s)===recordedTextSha);
  if(text===undefined)throw Error("macro_source_text_hold");
  if(p.data.version===MACRO_SOURCE_POLICY_V2){
    // v2 is read only as v2; a v1 note is never reinterpreted as a sender declaration.
    const {key:ignoredKey,authority:ignoredAuthority,...declaration}=p.data;
    void ignoredKey;void ignoredAuthority;
    const checked=validateMacroSubject(declaration,text,"macro");
    if(!checked.binding||stableJudgeJson(checked.binding)!==stableJudgeJson(p.data))throw Error("macro_source_scope_hold");
    return checked.binding;
  }
  const {key:ignoredKey,authority:ignoredAuthority,...input}=p.data;
  void ignoredKey;void ignoredAuthority;
  const checked=validateMacroSubject(input,text,"macro");
  if(!checked.binding||stableJudgeJson(checked.binding)!==stableJudgeJson(p.data))throw Error("macro_source_scope_hold");
  return checked.binding;
}
export const macroHistoryScope=(b:MacroSourceScope):MacroHistoryScope=>({version:MACRO_HISTORY_POLICY,key:b.key,label:b.label});

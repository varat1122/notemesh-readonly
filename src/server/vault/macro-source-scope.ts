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
export type MacroSubject=z.infer<typeof macroSubjectSchema>;
export const macroKey=(label:string)=>label.trim().normalize("NFC").toUpperCase();
export const macroHistoryScopeSchema=z.object({version:z.literal(MACRO_HISTORY_POLICY),key:z.string().min(1).max(120),
  label:z.string().min(1).max(120)}).strict().refine(s=>s.key===macroKey(s.label));
export type MacroHistoryScope=z.infer<typeof macroHistoryScopeSchema>;
export const macroSourceScopeSchema=macroSubjectSchema.extend({key:z.string().min(1).max(120),
  authority:z.literal("source_declared_not_geographic_verification")}).strict();
export type MacroSourceScope=z.infer<typeof macroSourceScopeSchema>;
export type MacroScopeResolution={binding:MacroSourceScope|null;reason:string|null};
export function validateMacroSubject(value:unknown,text:string,domain:string,entities?:string[]):MacroScopeResolution{
  const p=macroSubjectSchema.safeParse(value);
  if(!p.success||domain!=="macro")return {binding:null,reason:"macro_subject_contract_hold"};
  const s=p.data,key=macroKey(s.label),line="Macro subject: "+s.label;
  // Deliberately narrow grammar: first complete line, one declaration, no
  // lists/conjunctions/aliases. Unsupported real country names stay unscoped.
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
  const {key:ignoredKey,authority:ignoredAuthority,...input}=p.data;
  void ignoredKey;void ignoredAuthority;
  const checked=validateMacroSubject(input,text,"macro");
  if(!checked.binding||stableJudgeJson(checked.binding)!==stableJudgeJson(p.data))throw Error("macro_source_scope_hold");
  return checked.binding;
}
export const macroHistoryScope=(b:MacroSourceScope):MacroHistoryScope=>({version:MACRO_HISTORY_POLICY,key:b.key,label:b.label});

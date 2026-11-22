/** Bounded READ-ONLY discovery of receipted Source-only text, not issuer fact
 * verification. Historical Source bytes carry no authenticated issuer field:
 * scope is an exact lexical mention of an independently resolved Hub/alias in
 * the preserved received text. It establishes neither subject role, listing
 * equivalence, event identity nor primary authority. */
import {createHash} from "node:crypto";
import {db} from "../db";
import {canonicalSourceUrl} from "../source-url";
import {createReceipt,receiptProvenance,indexedRead} from "./investment-research-context";
import {preservedSubmittedText} from "./research-decision-v2";
import {RetrievalObserver} from "./investment-retrieval-coverage";
import {inspectCanonicalKnowledgeMetadata} from "./investment-knowledge-schema";
import {judgeExclusionSql,type JudgeSelectionPolicy} from "./queries";

import {readMacroSourceScope,type MacroHistoryScope,type MacroSourceScope} from "./macro-source-scope";
import {stableJudgeJson} from "./research-judge-contract";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const prefix="00_Inbox/ChatGPT/Investment Intake - ";
const sourcePath=/^00_Inbox\/ChatGPT\/Investment Intake - (IN-[A-F0-9]{16})\.md$/;
export interface SourceMentionScope {contextKey:string;labels:string[];macroScope?:MacroHistoryScope}
export interface StandaloneSourceBinding {
  status:"receipted_source_only";intakeId:string;sourceReceiptId:string;sourceSha256:string;receivedTextSha256:string;
  contextKeys:string[];matchedLabels:string[];scopeBasis:"literal_received_text_mention_of_resolved_hub"|"receipted_source_declared_macro_subject";
  macroScope?:MacroSourceScope;indexBindingSha256?:string;sourceRecordedAt?:string;sourceActor?:string;
  subjectRole:"not_established";sourceFamily:{canonicalUrl:string|null;economicEventEquivalence:"not_established"};
  provenance:{sourceKind:string|null;publisher:string|null;authority:"receipt_preserves_attribution_not_source_authenticity"};
  eventDate:string|null;publicationDate:string|null;independentEvidenceIncrement:0;primaryVerification:"not_performed";
}
export interface StandaloneSourceScan {contextKey:string;paths:string[];complete:boolean;reasons:string[]}
const boundedText=(x:unknown,n:number)=>typeof x==="string"&&x.length<=n?x:null;
function mentions(text:string,label:string){
  const t=text.normalize("NFC").toUpperCase(),key=label.normalize("NFC").toUpperCase();
  const word=(s:string)=>/[\p{L}\p{M}\p{N}_.-]/u.test(s);
  for(let at=t.indexOf(key);at>=0;at=t.indexOf(key,at+1))if(
    !word([...t.slice(0,at)].at(-1)??"")&&!word([...t.slice(at+key.length)][0]??""))return true;
  return false;
}
export function discoverStandaloneSources(scopes:SourceMentionScope[],reviewSourcePaths:string[],observer:RetrievalObserver,policy?:JudgeSelectionPolicy,intakeId?:string){
  const bindings=new Map<string,StandaloneSourceBinding>(),scans:StandaloneSourceScan[]=[];
  for(const scope of scopes){
    const scan:StandaloneSourceScan={contextKey:scope.contextKey,paths:[],complete:true,reasons:[]};scans.push(scan);
    const labels=[...new Set(scope.labels)].sort();
    if(!labels.length)continue;
    // FTS posting-list lookup + canonical path range + stable ordering. No
    // global Source universe materialization. Known Review-associated Sources
    // (including HOLD bundles) cannot fall back to standalone admission.
    // Own exact writes are excluded
    // before the sentinel/bound, using the existing server-only Judge policy.
    const match="body : ("+labels.map(s=>'"'+s.replace(/"/g,'""')+'"').join(" OR ")+")";
    let candidates:{path:string}[]=[];
    try{candidates=observer.search("standalone_source",labels.join(" / ").slice(0,1200),"00_Inbox/ChatGPT",()=>
      db().prepare(`SELECT notes.path FROM notes_fts JOIN notes ON notes.rowid=notes_fts.rowid AND notes.path=notes_fts.path
        WHERE notes_fts MATCH ? AND notes.path>=? AND notes.path<?${judgeExclusionSql(policy,"notes.path")}
        ${reviewSourcePaths.length?`AND notes.path NOT IN (${reviewSourcePaths.map(()=>"?").join(",")})`:""}
        ${intakeId?"AND notes.path=?":""} ORDER BY notes.path LIMIT 17`)
        .all(match,prefix,prefix+"\uffff",...policy?.excludedPaths??[],...reviewSourcePaths,...intakeId?[prefix+intakeId+".md"]:[]) as {path:string}[]);
    }catch{scan.complete=false;scan.reasons.push("standalone_source_search_unavailable");continue;}
    if(candidates.length>16){scan.complete=false;scan.reasons.push("standalone_source_candidate_limit");}
    for(const c of candidates.slice(0,16)){
      const id=sourcePath.exec(c.path)?.[1];if(!id)continue;
      try{const binding=observer.read("standalone_source",c.path,()=>{
        const note=indexedRead(c.path),text=preservedSubmittedText(note.raw);
        // Receipt-bound original text only. No frontmatter issuer, publisher,
        // caller intake label, URL token or filename is an issuer assertion.
        const macro=scope.macroScope;
        if(macro&&note.fm.macro_subject===undefined)return null; // Legacy stays unscoped, never backfilled.
        const declared=macro&&text!==null?readMacroSourceScope(note.fm.macro_subject,text,note.fm.source_text_sha256):null;
        const matched=macro&&declared?[declared.label]:text?labels.filter(label=>mentions(text,label)):[];
        if(!macro&&text!==null&&!matched.length)return null;
        if(!text||note.fm.type!=="investment_source_intake"||note.fm.intake_id!==id||
          ![sha(text),sha(text+"\n")].includes(String(note.fm.source_text_sha256)))throw Error("source_text_binding_hold");
        const row=db().prepare(`SELECT notes_fts.body FROM notes JOIN notes_fts ON notes.rowid=notes_fts.rowid
          WHERE notes.path=? AND notes_fts.path=? AND notes_fts MATCH ? LIMIT 1`).get(c.path,c.path,"InvestmentIntake"+id.slice(3)) as {body:string}|undefined;
        if(!row||row.body!==note.body)throw Error("source_index_binding_hold");
        const receipt=createReceipt("source_intake",c.path,note.raw),metadata=inspectCanonicalKnowledgeMetadata(c.path,note.fm);
        if(metadata.warnings.some(w=>w==="invalid_event_date"||w==="invalid_published_at"))throw Error("source_chronology_hold");
        let macroBinding:{macroScope:MacroSourceScope;indexBindingSha256:string;sourceRecordedAt:string;sourceActor:string}|undefined;
        if(macro){
          if(!declared||receiptProvenance("source_intake",c.path,note.raw).tier!=="server_witnessed")throw Error("macro_source_witness_hold");
          const operation=db().prepare("SELECT actor,receipt FROM safe_edit_operations WHERE id=? AND status='written'").get(receipt) as {actor:string;receipt:string}|undefined;
          const recordedAt=operation?JSON.parse(operation.receipt).writtenAt:undefined;
          if(!operation||typeof recordedAt!=="string"||!Number.isFinite(Date.parse(recordedAt))||Date.parse(recordedAt)>Date.now())throw Error("macro_source_recorded_time_hold");
          // Older receipts may contain a declared Macro label on broker
          // research. Verify their original receipt first; do not promote that
          // origin into Macro history or rewrite the preserved Source.
          if(note.fm.source_kind==="broker_research")return null;
          if(declared.key!==macro.key)return null; // Proven other scope, not an operational failure.
          macroBinding={macroScope:declared,sourceRecordedAt:recordedAt,sourceActor:operation.actor,
            indexBindingSha256:sha(stableJudgeJson({path:c.path,frontmatter:note.fm,bodySha256:sha(row.body),token:"InvestmentIntake"+id.slice(3)}))};
        }
        return {...macroBinding,status:"receipted_source_only",intakeId:id,sourceReceiptId:receipt,sourceSha256:sha(note.raw),receivedTextSha256:String(note.fm.source_text_sha256),
          contextKeys:[scope.contextKey],matchedLabels:matched,scopeBasis:macro?"receipted_source_declared_macro_subject":"literal_received_text_mention_of_resolved_hub",subjectRole:"not_established",
          sourceFamily:{canonicalUrl:canonicalSourceUrl(boundedText(note.fm.source_url,1000)),economicEventEquivalence:"not_established"},
          provenance:{sourceKind:boundedText(note.fm.source_kind,80),publisher:boundedText(note.fm.attributed_publisher,160),authority:"receipt_preserves_attribution_not_source_authenticity"},
          eventDate:metadata.eventDate,publicationDate:metadata.publishedAt,independentEvidenceIncrement:0,primaryVerification:"not_performed"} satisfies StandaloneSourceBinding;
      });
      if(binding){const prior=bindings.get(c.path);if(prior){prior.contextKeys=[...new Set([...prior.contextKeys,...binding.contextKeys])].sort();prior.matchedLabels=[...new Set([...prior.matchedLabels,...binding.matchedLabels])].sort();}else bindings.set(c.path,binding);
        scan.paths.push(c.path);}
      }catch{scan.complete=false;scan.reasons.push("standalone_source_receipt_readback_hold");}
    }
    scan.reasons=[...new Set(scan.reasons)];
  }
  return {bindings,scans};
}

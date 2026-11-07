/** Conservative research-use projection, never a write receipt or promotion.
 * No database, model call, date inference or historical metadata rewrite. */
import {z} from "zod";

export const RESEARCH_STATE_POLICY="RI001-DRAFT-1";
export const draftMetadata={research_state_version:RESEARCH_STATE_POLICY,
  research_status:"draft",usage_tier:"historical_analysis_only",
  independent_evidence_increment:0,comparator_eligible:false,
  critic_independence:"not_verified"} as const;
type Metadata=Record<string,unknown>;
export interface ResearchTrust {
  policy_version:typeof RESEARCH_STATE_POLICY;
  research_status:"source_only"|"draft"|"unclassified";
  declared_research_status:"source_only"|"draft"|"reviewed"|"superseded"|"disputed"|"unknown"|null;
  usage_tier:"attributed_source_only"|"historical_analysis_only";
  independent_evidence_increment:0;
  comparator_eligible:false;
  critic_independence:"not_verified";
  primary_authority:false;
  owner_thesis_authority:false;
  persistence_verification:"not_assessed_by_trust_projection";
  metadata_status:"conservative_declaration"|"legacy_unclassified"|"unsupported_declaration_hold";
  analysis_as_of:string|null;
  analysis_created_at:string|null;
  dates_provenance:"note_declared_not_reverified";
}
const instant=z.string().datetime({offset:true});
const timestamp=(x:unknown)=>{const r=instant.safeParse(x);return r.success?r.data:null;};
const statuses=new Set(["source_only","draft","reviewed","superseded","disputed"]);
export function researchTrust(path:string,metadata:unknown):ResearchTrust|null {
  const fm:Metadata=metadata&&typeof metadata==="object"&&!Array.isArray(metadata)
    ?metadata as Metadata:{research_state_version:"invalid_metadata"};
  const source=fm.type==="investment_source_intake";
  const review=["investment_research_review","investment_review","news_thesis_review","research_note",
    "preferred_research_note","research_update","macro_research_note","research_synthesis"].includes(typeof fm.type==="string"?fm.type:"");
  const historical=["chatgpt_analysis","chatgpt_history","chatgpt_export","archived_ai"].includes(typeof fm.source_type==="string"?fm.source_type:"")||path.startsWith("07_Sources/ChatGPT/");
  const claim=fm.type==="investment_structured_claim_register";
  const hasState=Object.keys(draftMetadata).some(key=>key in fm);
  if(!source&&!review&&!historical&&!claim&&!hasState)return null;
  const declared=fm.research_status==null?null:typeof fm.research_status==="string"&&statuses.has(fm.research_status)?fm.research_status as NonNullable<ResearchTrust["declared_research_status"]>:"unknown";
  const draft=review&&Object.entries(draftMetadata).every(([key,value])=>fm[key]===value);
  // Even legacy 'reviewed', forged critic labels and primary metadata remain
  // data. There is no accepted server promotion/independent-critic contract yet.
  const validSource=source&&(!hasState||Object.entries(draftMetadata).every(([key,value])=>
    fm[key]===(key==="research_status"?"source_only":key==="usage_tier"?"attributed_source_only":value)));
  return {policy_version:RESEARCH_STATE_POLICY,research_status:validSource?"source_only":draft?"draft":"unclassified",
    declared_research_status:declared,usage_tier:validSource?"attributed_source_only":"historical_analysis_only",
    independent_evidence_increment:0,comparator_eligible:false,critic_independence:"not_verified",
    primary_authority:false,owner_thesis_authority:false,persistence_verification:"not_assessed_by_trust_projection",
    metadata_status:draft||validSource?"conservative_declaration":hasState?"unsupported_declaration_hold":"legacy_unclassified",
    analysis_as_of:timestamp(fm.knowledge_cutoff_as_of),analysis_created_at:timestamp(fm.analysis_created_at),
    dates_provenance:"note_declared_not_reverified"};
}

/** Generic Safe Edit has no reviewed/comparator/critic promotion authority.
 * Unchanged historical declarations remain immutable data, never new authority.
 * A managed Draft cannot shed its labels via rollback/frontmatter replacement. */
export function assertResearchStateAuthority(before:Metadata,after:Metadata){
  const keys=Object.keys(draftMetadata);
  if(keys.every(k=>JSON.stringify(before[k])===JSON.stringify(after[k]))&&before.type===after.type)return;
  const managed=keys.some(k=>k in before||k in after);
  if(!managed)return; // Accepted legacy writers remain unclassified on read.
  const expected=after.type==="investment_source_intake"
    ?{...draftMetadata,research_status:"source_only",usage_tier:"attributed_source_only"}:draftMetadata;
  if(!["investment_source_intake","investment_research_review"].includes(typeof after.type==="string"?after.type:"")||
    !Object.entries(expected).every(([key,value])=>after[key]===value))
    throw Error("research_state_promotion_or_label_removal_hold");
  // No change of artifact class can demote a Review to a Source-only exemption.
  if(Object.keys(before).length&&before.type!==after.type)throw Error("research_state_artifact_transition_hold");
}

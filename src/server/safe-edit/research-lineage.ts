/** Read-only validation shared by canonical planning and Safe Edit admission.
 * A write receipt proves persistence, never the semantic truth of analysis. */
import {createHash} from "node:crypto";
import {splitFrontmatter} from "../vault/markdown";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
export interface ReviewLineageRecord {
  id:string;payload:string;after_text:string;after_hash:string;status:string;actor:string;
}
export function hasRuntimeReviewLineage(content:string){
  const fm=splitFrontmatter(content).data;
  return fm.type==="investment_research_review"&&
    ["analysis_created_at","analysis_input_sha256","analysis_created_at_provenance"].some(k=>k in fm);
}
export function assertReviewChronology(r:ReviewLineageRecord,previewAt:string|undefined){
  if(!hasRuntimeReviewLineage(r.after_text))return;
  const fm=splitFrontmatter(r.after_text).data;
  let p;try{p=JSON.parse(r.payload);}catch{throw Error("review_runtime_chronology_unverified");}
  const created=typeof fm.analysis_created_at==="string"?Date.parse(fm.analysis_created_at):NaN;
  const admitted=previewAt?Date.parse(previewAt):NaN;
  if(!["preview","written"].includes(r.status)||r.after_hash!==sha(r.after_text)||
    p.change?.kind!=="create"||p.change.content!==r.after_text||p.operationId!==r.id||
    r.id!=="ICW-"+sha(["canonical_review",p.path,r.after_hash].join("\n")).slice(0,32)||
    !/^[a-f0-9]{64}$/.test(String(fm.analysis_input_sha256))||
    fm.analysis_created_at_provenance!=="runtime_canonical_review_proposal"||
    !Number.isFinite(created)||!Number.isFinite(admitted)||created>admitted||admitted-created>60000)
    throw Error("review_runtime_chronology_unverified");
}
export function assertReviewPreviewAdmission(content:string,canonical:boolean){
  if(!hasRuntimeReviewLineage(content))return;
  if(!canonical)throw Error("canonical_review_requires_prepare");
  const created=Date.parse(String(splitFrontmatter(content).data.analysis_created_at)),now=Date.now();
  if(!Number.isFinite(created)||created>now||now-created>60000)throw Error("review_runtime_chronology_unverified");
}

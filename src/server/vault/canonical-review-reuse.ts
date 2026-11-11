/** Intake identity is not economic-event identity. Read-only reconciliation:
 * selecting an existing Review never grants an append/replacement permission. */
import {z} from "zod";
import {createHash} from "node:crypto";
import type {Pack} from "./investment-context";
import {createReceipt,discoverCanonicalResearch,indexedRead,type ContextBundle} from "./investment-research-context";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
export const existingReviewSelectionSchema=z.object({
 path:z.string().max(700).regex(/^10_Knowledge\/Company Research\/Investment Review - [^/]+ - IN-[A-F0-9]{16}\.md$/),
 expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),
 receiptId:z.string().regex(/^ICW-[a-f0-9]{32}$/),
 relationship:z.enum(["duplicate","added_detail","correction","contradiction"]),
 comparisonBasis:z.string().trim().min(40).max(2000),
}).strict().describe("Read-only existing Company Review selection, not event adjudication or update authority. Exact receipt/hash/scope are revalidated; any revision remains HOLD pending separately authorized exact-diff reviewer/CAS workflow.");
export type ExistingReviewSelection=z.infer<typeof existingReviewSelectionSchema>;
export interface ReviewReuse {
 version:"C1-REVIEW-REUSE-1";
 status:"no_reuse_selected"|"hold_event_adjudication"|"hold_review_binding"|"revision_proposal_only";
 reasons:string[];candidates:ContextBundle[];candidateScope:"bounded_company_reviews_not_semantic_event_matches";
 selection:ExistingReviewSelection|null;selectedReview:ContextBundle|null;
 source:{path:string;sha256:string|null;receiptId:string|null;status:"pending"|"verified_existing"|"HOLD"};
 proposal:{previousReviewSha256:string;previousReviewReceiptId:string;additionalSourcePath:string;
   additionalSourceReceiptId:string;relationship:ExistingReviewSelection["relationship"];comparisonBasis:string;
   requiredGates:string[];safeEditRequest:null}|null;
 duplicateAdjudicated:false;independentEvidenceIncrement:0;writeAuthority:false;
}
export function planReviewReuse(input:{selection?:ExistingReviewSelection;domain:string;planId:string;sourcePath:string;
 existingSourcePath:string|null;sourceUrl?:string|null;eventDate:string|null;publicationDate:string|null;pack:Pack;historicalCandidatePaths:string[]}):ReviewReuse{
 const candidates=input.pack.contextBundles.filter(b=>b.intakeId!==input.planId);
 const result:ReviewReuse={version:"C1-REVIEW-REUSE-1",status:"no_reuse_selected",reasons:[],candidates,
  candidateScope:"bounded_company_reviews_not_semantic_event_matches",selection:input.selection??null,selectedReview:null,
  source:{path:input.sourcePath,sha256:null,receiptId:null,status:"pending"},proposal:null,
  duplicateAdjudicated:false,independentEvidenceIncrement:0,writeAuthority:false};
 if(input.existingSourcePath)try{
  const source=indexedRead(input.sourcePath);
  result.source={path:input.sourcePath,sha256:sha(source.raw),receiptId:createReceipt("source_intake",input.sourcePath,source.raw),status:"verified_existing"};
 }catch{result.source.status="HOLD";}
 if(input.selection){
  result.status="hold_review_binding";
  const parsed=existingReviewSelectionSchema.safeParse(input.selection);
  if(!parsed.success){result.reasons.push("invalid_existing_review_selection");return result;}
  const selection=parsed.data,id=selection.path.match(/(IN-[A-F0-9]{16})\.md$/)![1];
  if(input.domain!=="company"||!input.pack.issuerResolution.length||input.pack.issuerResolution.some(r=>
    !["exact_existing_title","indexed_alias"].includes(r.status))){result.reasons.push("existing_review_identity_scope_hold");return result;}
  // Exact-ID fallback still uses bounded discovery and the current resolved Hub.
  // It cannot widen scope by guessing filename aliases or by following metadata.
  const scans=input.pack.issuerResolution.map(r=>discoverCanonicalResearch(r.contextKey!,id,[r.contextKey!,r.requested]));
  const found=scans.flatMap(s=>s.reviews).find(r=>r.path===selection.path)?.bundle;
  if(!found||found.status!=="BOUND_SOURCE_REVIEW"||found.reviewSha256!==selection.expectedSha256||found.reviewReceiptId!==selection.receiptId||
    scans.some(s=>!s.complete)||input.pack.retrieval.status!=="operational_complete"){
   result.reasons.push("existing_review_receipt_scope_or_readback_hold");return result;
  }
  result.selectedReview=found;
  if(found.intakeId===input.planId){result.reasons.push("same_intake_use_existing_canonical_retry");return result;}
  if(result.source.status!=="verified_existing"||!result.source.receiptId){result.reasons.push("preserve_source_before_review_reconciliation");return result;}
  result.status="revision_proposal_only";result.reasons.push("existing_review_revision_authority_required");
  result.proposal={previousReviewSha256:found.reviewSha256,previousReviewReceiptId:found.reviewReceiptId!,
   additionalSourcePath:input.sourcePath,additionalSourceReceiptId:result.source.receiptId,
   relationship:selection.relationship,comparisonBasis:selection.comparisonBasis,
   requiredGates:["fresh_semantic_source_event_comparison","fresh_sealed_assessment_of_revision_and_history",
    "separately_authorized_reviewer_exact_diff","new_revision_preview","compare_and_swap_before_hash","receipt_readback_index_links"],safeEditRequest:null};
  return result;
 }
 // Unknown origin is not proof of novelty. Only a relevant bounded historical
 // Review scope triggers this uncertainty HOLD; a first eligible Draft remains
 // possible, and known-date/URL new-event admission retains its existing gates.
 const ownReview=input.pack.contextBundles.some(b=>b.intakeId===input.planId&&b.status==="BOUND_SOURCE_REVIEW");
 if(!ownReview&&input.domain==="company"&&(!input.sourceUrl||!input.eventDate||!input.publicationDate)&&
   (candidates.length||input.historicalCandidatePaths.some(p=>!p.endsWith(` - ${input.planId}.md`)))){
  result.status="hold_event_adjudication";result.reasons.push("missing_origin_with_historical_review_candidates_not_proof_new_event");
 }
 return result;
}

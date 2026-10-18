/**
 * Preview-only, authenticated-stage handoff. Actual actor authorization is
 * enforced by createSafeEditMcpServer's OAuth wrapper; this function never
 * applies or approves a Vault mutation.
 *
 * The input is independently routed at call-time; do not accept caller-
 * supplied path/operation ID/content/receipts as authorization.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { resolveNotePath, openNoFollow } from "../vault/paths";
import { planInvestmentWriteback, type WritebackInput } from "../vault/investment-writeback-router";
import { inspectCoordinatedWritebackBatch } from "./coordinated-batch-status";
import { preview } from "./engine";

export function previewInvestmentIntakeStage(
 input:WritebackInput,stage:"raw_input"|"research_review",actor:string,
) {
 if(input.inputFormat!=="text")
   throw Error("This preview endpoint accepts TEXT only; capture original screenshot/PDF bytes through the separately authorized attachment workflow");
 const plan=planInvestmentWriteback(input);
 const draft=stage==="raw_input"?plan.safeEditDrafts.original:plan.safeEditDrafts.analysis;
 const current=plan.coordination.steps.find(step=>step.kind===stage);
 if(!current||!draft.path||draft.path!==current.path||draft.operationId!==current.operationId)
   throw Error("Coordinated stage identity/path mismatch");
 if(current.action!=="preview_create"||draft.status!=="candidate_safe_edit_preview_not_written"||!draft.content)
   throw Error("Stage held: content unavailable, binary or existing-note identity review required");
 if(stage==="research_review") {
   const receipts=inspectCoordinatedWritebackBatch(plan.planId,actor);
   const raw=receipts.stages.find(step=>step.kind==="raw_input");
   if(raw?.state!=="locally_verified"||typeof raw.path!=="string"||
      raw.operationId!==plan.coordination.steps[0].operationId||
      raw.path!==plan.coordination.steps[0].path||
      raw.afterHash!==plan.safeEditDrafts.expectedOriginalSha256)
     throw Error("Independent, same-OAuth raw source write/readback/reindex receipt required before research review preview");
   // The indexed receipt describes the point of the prior write. Synced
   // Obsidian notes may change afterwards; re-open the current inode and
   // verify the exact bytes now instead of trusting a stale journal.
   const abs=resolveNotePath(raw.path);
   const fd=openNoFollow(abs);
   try {
     const st=fs.fstatSync(fd);
     if(!st.isFile()||st.nlink!==1||st.size>100000)
       throw Error("Raw source inode is not an approved single-link Markdown file");
     const liveHash=createHash("sha256").update(fs.readFileSync(fd)).digest("hex");
     if(liveHash!==raw.afterHash)
       throw Error("Raw source changed after last Safe Edit receipt; historical input review and re-approval required");
   } finally {fs.closeSync(fd);}
 }
 const result=preview({
   operationId:current.operationId,path:current.path,
   reason:stage==="raw_input"?
     "Preserve exact attributed original user-supplied investment text without independent source verification":
     "Create separate not-primary AI analysis only after verified raw input write",
   change:{kind:"create",content:draft.content},
 },actor);
 return {
   status:"safe_edit_preview_only_not_applied" as const,
   planId:plan.planId,stage,operationId:current.operationId,
   preview:result,
   prerequisites:{
     sourceSavedAndIndexed:stage==="research_review",
     approvalAndApplySeparatelyRequired:true,
     originalPublisherVerified:false,
     canAutoUpdateThesis:false,
     remoteMobileSyncConfirmed:false,
   },
   warnings:[
     "Review full exact diff before applying with a separate authorized Safe Edit operation.",
     "This is user-supplied text and separately attributed AI opinion, not independently verified primary evidence.",
     "Existing target paths, stale previews, incomplete sources and cross-actor receipts are never automatically adopted.",
   ],
 };
}

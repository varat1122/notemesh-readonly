/** Authenticated owner transport orchestration; no model or alternate writer. */
import {readVaultFile,resolveNotePath} from "../vault/paths";
import {db} from "../db";
import {assertGitPilot} from "./git-pilot-policy";
import {exclusive,cleanBase,commitApprovedEdits} from "./git-pilot";
import {inputSchema,validatePreflight} from "./investment-graph-bundle";
import {prepareRealInvestmentReviewHandoff} from "./investment-review-preparation";
import {verifyAuthorizedInvestmentGraphReadback} from "./knowledge-graph-readback";
import {preview,apply,status,adminPreview,recordGitPilot,gitPilotContext,sha256,validateApprovedEdit} from "./engine";
import {applySchema,operationId} from "./schema";
import {z} from "zod";

export function assertOwnerResearch(){
  assertGitPilot();
  if(process.env.GIT_RESEARCH_WRITEBACK_M4!=="1") throw Error("Owner research writeback disabled");
}
function ownerActor(actor:string){
  if(!/^staging-owner-research:[A-Za-z0-9_-]{1,120}$/.test(actor)) throw Error("Authenticated owner session required");
}
const read=(p:string)=>readVaultFile(resolveNotePath(p));
const argsSchema=z.object({analysis:applySchema,timeline:applySchema}).strict();
function operations(i:z.infer<typeof inputSchema>){return [
  {id:i.operationRoot+"-analysis",path:i.analysisPath,kind:"create"},
  {id:i.operationRoot+"-timeline",path:i.timelinePath,kind:"append"},
];}
function anchorHashes(i:z.infer<typeof inputSchema>){
  const paths=[i.sourcePath,i.timelinePath,"01_Companies/"+i.issuer+".md",
    "05_Thesis/"+i.issuer+" - Current Thesis.md","05_Thesis/"+i.issuer+" - Evidence Register.md"];
  return Object.fromEntries(paths.map(p=>{
    const indexed=db().prepare("SELECT 1 FROM notes WHERE path=?").get(p);
    if(!indexed) {try {read(p);throw Error("Unindexed review anchor");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT") throw e;}return [p,null];}
    return [p,sha256(read(p))];
  }));
}
export async function previewOwnerResearch(input:unknown,actor:string){
  assertOwnerResearch();ownerActor(actor);
  const i=inputSchema.parse(input);
  if(i.recoverTimelineOnly) throw Error("Recovery requires manual review; no replay transport");
  return exclusive(async()=>{
    assertOwnerResearch();
    const base=await cleanBase([i.analysisPath,i.timelinePath],false);
    const context=prepareRealInvestmentReviewHandoff({issuer:i.issuer,eventKey:i.eventKey,period:i.period,sourcePath:i.sourcePath,question:"Review historical thesis and counter-evidence before owner-approved writeback"});
    if(context.status!=="real_vault_review_context_prepared_no_write") throw Error("Duplicate event review required");
    const {marker,evMarker}=validatePreflight(i);
    const ops=operations(i),anchors=anchorHashes(i);
    // Exactly the existing graph bundle's create + section append; approvals
    // are NOT supplied by the package and are never auto-granted here.
    return gitPilotContext.run({base,operations:ops},()=>{
      const analysis=preview({operationId:ops[0].id,path:ops[0].path,reason:"Owner-reviewed historical AI research draft",change:{kind:"create",content:i.analysisMarkdown}},actor);
      const timeline=preview({operationId:ops[1].id,path:ops[1].path,reason:"Owner-reviewed Company Evolution backlink",change:{kind:"append",heading:i.timelineHeading,date:i.timelineDate,content:[marker,evMarker,"- [["+i.analysisPath.slice(0,-3)+"]] — Historical AI analysis; not independently verified."].join("\n")}},actor);
      if(!analysis.previewToken||!timeline.previewToken) throw Error("Existing operation: retain original review; no automatic recovery");
      const reviewHash=sha256(JSON.stringify({i,base,anchors,after:[analysis.afterHash,timeline.afterHash]}));
      recordGitPilot(ops[0].id,actor,{state:"research_preview",base,reviewHash,package:i,anchors,context});
      recordGitPilot(ops[1].id,actor,{state:"research_preview",base,reviewHash});
      return {analysis,timeline,reviewHash,gitBase:base,context,anchors};
    });
  });
}
function bound(root:string,actor:string){
  operationId.parse(root);ownerActor(actor);
  const analysis=status(root+"-analysis",actor),timeline=status(root+"-timeline",actor);
  const binding=analysis.receipt?.gitPilot;
  if(!binding?.package||binding.reviewHash!==timeline.receipt?.gitPilot?.reviewHash) throw Error("Missing bound research package");
  const i=inputSchema.parse(binding.package);
  if(i.operationRoot!==root||analysis.path!==i.analysisPath||timeline.path!==i.timelinePath||
    binding.base!==timeline.receipt?.gitPilot?.base||binding.reviewHash!==sha256(JSON.stringify({i,base:binding.base,anchors:binding.anchors,after:[analysis.afterHash,timeline.afterHash]}))) throw Error("Research binding mismatch");
  return {i,analysis,timeline,binding};
}
export function ownerResearchStatus(root:string,actor:string){
  assertOwnerResearch();const s=bound(root,actor);
  return {analysis:s.analysis,timeline:s.timeline,reviewHash:s.binding.reviewHash,context:s.binding.context,anchors:s.binding.anchors,
    previews:[adminPreview(s.analysis.operationId),adminPreview(s.timeline.operationId)]};
}
export async function applyOwnerResearch(input:unknown,actor:string){
  assertOwnerResearch();ownerActor(actor);const args=argsSchema.parse(input);
  if(!args.analysis.operationId.endsWith("-analysis")) throw Error("Invalid research operation");
  return exclusive(async()=>{
    assertOwnerResearch();
    const root=args.analysis.operationId.slice(0,-9),s=bound(root,actor),{i,binding}=s;
    if(args.timeline.operationId!==root+"-timeline") throw Error("Mismatched operation pair");
    if(binding.state!=="research_preview"||s.timeline.receipt?.gitPilot?.state!=="research_preview")
      return {status:"manual_review_or_previously_completed_no_write",analysis:s.analysis,timeline:s.timeline,newWriteExecuted:false};
    // Validate BOTH original tokens, active approvals and all CAS before the
    // first write. UI fields never authorize or replace server-stored bytes.
    const a=validateApprovedEdit(args.analysis,actor),t=validateApprovedEdit(args.timeline,actor);
    if(await cleanBase([i.analysisPath,i.timelinePath],false)!==binding.base) throw Error("Stale approved Git HEAD");
    validatePreflight(i);
    if(JSON.stringify(anchorHashes(i))!==JSON.stringify(binding.anchors)) throw Error("Reviewed anchors changed");
    if(sha256(read(i.timelinePath))!==t.beforeHash) throw Error("Timeline CAS changed");
    const ops=operations(i),record=(detail:Record<string,unknown>)=>{
      // First receipt is authoritative if a crash interrupts the second log.
      recordGitPilot(ops[0].id,actor,detail);recordGitPilot(ops[1].id,actor,detail);
    };
    record({state:"research_applying"});
    try {
      gitPilotContext.run({base:binding.base,operations:ops},()=>{
        apply(args.analysis,actor);apply(args.timeline,actor);
      });
      const graphInput={analysisOperationId:ops[0].id,timelineOperationId:ops[1].id,analysisPath:i.analysisPath,timelinePath:i.timelinePath,sourcePath:i.sourcePath};
      verifyAuthorizedInvestmentGraphReadback(graphInput,actor);
      await commitApprovedEdits(binding.base,root,[{path:i.analysisPath,kind:"A",afterHash:a.afterHash},{path:i.timelinePath,kind:"M",afterHash:t.afterHash}],record);
      const graph=verifyAuthorizedInvestmentGraphReadback(graphInput,actor);
      record({state:"research_verified",graph});
      return {status:"owner_research_git_and_graph_verified",graph,analysis:status(ops[0].id,actor),timeline:status(ops[1].id,actor),deviceSyncVerified:false};
    } catch(e){
      // Preserve push_unknown/pushed/verified state on Git failure. Every
      // attempted Apply is terminal for this transport; never silent retry.
      recordGitPilot(ops[0].id,actor,{manualReviewRequired:true});
      throw e;
    }
  });
}

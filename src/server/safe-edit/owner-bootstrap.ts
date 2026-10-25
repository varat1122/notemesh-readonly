/** Fixed synthetic bootstrap through the existing owner/Safe Edit/Git boundary. */
import {z} from "zod";
import {db} from "../db";
import {readVaultFile,resolveNotePath} from "../vault/paths";
import {splitFrontmatter} from "../vault/markdown";
import {BOOTSTRAP_FIXTURES as fixtures,BOOTSTRAP_ROOT} from "./synthetic-bootstrap-fixtures";
import {assertOwnerResearch,ownerActor} from "./owner-research";
import {assertM4Window} from "./m4-window";
import {exclusive,cleanBase,commitApprovedEdits} from "./git-pilot";
import {preview,apply,status,adminPreview,recordGitPilot,gitPilotContext,sha256,validateApprovedEdit} from "./engine";
import {applySchema} from "./schema";
import {inputSchema} from "./investment-graph-bundle";

const manifest=fixtures.map(f=>({id:f.id,path:f.path,sha256:sha256(f.content)}));
const manifestHash=sha256(JSON.stringify(manifest));
const ops=fixtures.map(f=>({id:f.id,path:f.path,kind:"create"}));
const argsSchema=z.array(applySchema).length(fixtures.length);
export function assertOwnerBootstrap(){
  assertOwnerResearch();
  if(process.env.GIT_RESEARCH_BOOTSTRAP_M4!=="1") throw Error("Synthetic bootstrap disabled");
}
function records(actor:string){
  ownerActor(actor);
  const rows=fixtures.map(f=>status(f.id,actor));
  const base=rows[0].receipt?.gitPilot?.base;
  if(!base||rows.some((r,n)=>r.path!==fixtures[n].path||r.afterHash!==manifest[n].sha256||
    r.receipt?.gitPilot?.manifestHash!==manifestHash||r.receipt?.gitPilot?.base!==base))throw Error("Bootstrap journal binding mismatch");
  return {rows,base};
}
export function ownerBootstrapStatus(actor:string){
  assertOwnerBootstrap();const {rows,base}=records(actor);
  return {operationRoot:BOOTSTRAP_ROOT,manifestHash,gitBase:base,records:rows,previews:fixtures.map(f=>adminPreview(f.id))};
}
export async function previewOwnerBootstrap(actor:string){
  assertOwnerBootstrap();ownerActor(actor);
  return exclusive(async()=>{
    assertOwnerBootstrap();const base=await cleanBase(fixtures.map(f=>f.path),true);
    return gitPilotContext.run({base,operations:ops,bootstrap:true},()=>{
      const previews=fixtures.map(f=>preview({operationId:f.id,path:f.path,reason:"Owner-reviewed fixed synthetic M4 bootstrap; no investment evidence",change:{kind:"create",content:f.content}},actor));
      if(previews.some(p=>!p.previewToken))throw Error("Existing bootstrap operation; retain original tab and reconcile manually");
      for(const f of fixtures)recordGitPilot(f.id,actor,{state:"bootstrap_preview",base,manifestHash});
      return {operationRoot:BOOTSTRAP_ROOT,manifestHash,gitBase:base,previews};
    });
  });
}
function verifyBootstrap(actor:string){
  const {rows}=records(actor),hashes:Record<string,string>={};
  for(const [n,f] of fixtures.entries()){
    const raw=readVaultFile(resolveNotePath(f.path)),parsed=splitFrontmatter(raw),hash=sha256(raw),r=rows[n];
    const indexed=db().prepare("SELECT n.size,n.frontmatter,f.body FROM notes n JOIN notes_fts f ON f.rowid=n.rowid WHERE n.path=?").get(f.path) as {size:number;frontmatter:string;body:string}|undefined;
    if(raw!==f.content||hash!==r.afterHash||r.status!=="written"||r.receipt?.write!=="written"||r.receipt?.readback!=="verified"||r.receipt?.reindex!=="verified"||
      !indexed||indexed.size!==Buffer.byteLength(raw)||indexed.frontmatter!==JSON.stringify(parsed.data)||indexed.body!==parsed.body)throw Error("Bootstrap physical/receipt/FTS hash mismatch");
    hashes[f.path]=hash;
  }
  return hashes;
}
/** Uses actual readback SHA, never a proposed digest as a live receipt. */
function researchPackage(hashes:Record<string,string>){
  const sourcePath=fixtures[0].path,sourceSha=hashes[sourcePath],timelinePath=fixtures[3].path;
  const operationRoot="m4-acceptance-a-20261025",eventKey="M4TEST-SYNTH-A-20261025";
  return inputSchema.parse({operationRoot,issuer:"M4TEST",eventKey,period:"SYNTHETIC",timelineDate:"2026-10-25",timelineHeading:"Evolution",
    analysisPath:"08_Daily_Weekly/Research Indexes/Investment Review - M4TEST - "+eventKey+".md",timelinePath,sourcePath,expectedSourceSha256:sourceSha,
    analysisMarkdown:["---","type: investment_review","entity: M4TEST","event_key: "+eventKey,"operation_id: "+operationRoot,"source_type: archived_ai","independent_evidence: false","verification: not_reverified","status: draft","analysis_origin: synthetic_acceptance_fixture","source_path: "+sourcePath,"source_sha256: "+sourceSha,"---","# Synthetic acceptance analysis","<!-- investment-os-operation:"+operationRoot+" -->","<!-- investment-os-event:"+eventKey+" -->","This is a fictional operational fixture, not investment research. Source A suggests hypothetical demand; conversion to revenue is unknown. Margins, earnings, cash flow and ROIC cannot be inferred. Counter-evidence is missing. No thesis update is authorized.",... [sourcePath,fixtures[2].path,timelinePath].map(p=>"[["+p.slice(0,-3)+"]]"),""].join("\n")});
}
export async function applyOwnerBootstrap(input:unknown,actor:string){
  assertOwnerBootstrap();ownerActor(actor);const args=argsSchema.parse(input);
  if(args.some((a,n)=>a.operationId!==fixtures[n].id))throw Error("Bootstrap operation scope/order mismatch");
  return exclusive(async()=>{
    assertOwnerBootstrap();const {rows,base}=records(actor);
    if(rows.some(r=>r.receipt?.gitPilot?.state!=="bootstrap_preview"))return {status:"bootstrap_previously_attempted_no_write",records:rows,newWriteExecuted:false};
    for(const [n,a] of args.entries()){
      const p=validateApprovedEdit(a,actor);
      if(p.path!==fixtures[n].path||p.afterHash!==manifest[n].sha256||p.beforeHash!==sha256(""))throw Error("Bootstrap approved content mismatch");
    }
    if(await cleanBase(fixtures.map(f=>f.path),true)!==base)throw Error("Approved bootstrap Git HEAD changed");
    assertM4Window("write");
    const record=(detail:Record<string,unknown>)=>{for(const f of fixtures)recordGitPilot(f.id,actor,detail);};
    record({state:"bootstrap_applying"});
    try{
      gitPilotContext.run({base,operations:ops,bootstrap:true},()=>args.forEach(a=>apply(a,actor)));
      verifyBootstrap(actor);
      await commitApprovedEdits(base,BOOTSTRAP_ROOT,manifest.map(f=>({path:f.path,kind:"A",afterHash:f.sha256})),record);
      const hashes=verifyBootstrap(actor);
      record({state:"bootstrap_verified"});
      return {status:"synthetic_bootstrap_git_physical_fts_verified",operationRoot:BOOTSTRAP_ROOT,sourceHashes:hashes,records:records(actor).rows,
        researchPackage:researchPackage(hashes),nextStep:"Read back Source A and freeze current Git HEAD; separately import/review/approve/apply the research package. Never automatically apply it.",deviceSyncVerified:false};
    }catch(e){recordGitPilot(fixtures[0].id,actor,{manualReviewRequired:true});throw e;}
  });
}

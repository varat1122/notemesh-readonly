/** Scope freshness, not exhaustive recall or semantic truth. Server-only policy:
 * own writes are excluded BEFORE discovery bounds, and only with exact durable
 * create receipts plus actor/journal/byte identity. No intake-metadata exemption.
 * Generic apply invokes this synchronously INSIDE Safe Edit's cross-process
 * write lock, after the existing sync-pause guard. Canonical apply uses that
 * same admission for each note. This is not isolation from unmanaged writers
 * that bypass the existing single-writer/sync/lock authority contract. */
import fs from "node:fs";
import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {buildInvestmentContextPack,type Pack} from "./investment-context";
import {createReceipt} from "./investment-research-context";
import {retrievalScopeSchema,retrievalOperationallyComplete,type RetrievalCoverage} from "./investment-retrieval-coverage";
import {m2VaultReadDeps} from "./research-decision-v2";
import {resolveNotePath} from "./paths";
import {splitFrontmatter} from "./markdown";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const hash=z.string().regex(/^[a-f0-9]{64}$/),path=z.string().min(1).max(1000);
const identity=z.object({requested:z.string().max(120),contextKey:z.string().nullable(),hubPath:path.nullable(),
  status:z.enum(["exact_existing_title","indexed_alias","unresolved","ambiguous_hold","readback_hold","index_limit_hold","invalid_hold"]),hubSha256:hash.nullable()}).strict();
const selected=z.object({path,sha256:hash,role:z.string().max(40),evidenceUse:z.enum(["historical_context_only","unverified_candidate"]),
  excerptSha256:hash,counterEvidence:z.boolean(),line:z.number().int(),truncated:z.boolean(),matchedMacroScopes:z.array(z.string()).max(4)}).strict();
export const judgeScopeSchema=z.object({version:z.literal(1),policy:z.literal("bounded_path_discovery_role_chronology_v1"),
  scope:retrievalScopeSchema,issuerResolution:z.array(identity).max(6),selection:z.array(selected).max(8)}).strict();
export type JudgeScope=z.infer<typeof judgeScopeSchema>;
export interface JudgeTarget {path:string;sha256:string;operationId:string;kind:"source_intake"|"structured_claim"|"canonical_review"}
export function judgeTargets(plan:{safeEditWorkflow?:{steps:{path:string;expectedSha256:string;receiptKey:string;kind:JudgeTarget["kind"]}[]}|null}):JudgeTarget[]{
  return (plan.safeEditWorkflow?.steps??[]).map(s=>({path:s.path,sha256:s.expectedSha256,operationId:s.receiptKey,kind:s.kind}));
}
export function judgeOwnWrites(targets:JudgeTarget[],intakeId:string,actor:string):string[]{
  if(targets.length>10||new Set(targets.map(t=>t.path)).size!==targets.length)throw Error("research_judge_self_write_scope_hold");
  const excluded:string[]=[];
  const hasJournal=!!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get();
  for(const t of targets){
    const row=hasJournal?db().prepare("SELECT actor,status,after_hash FROM safe_edit_operations WHERE id=?").get(t.operationId) as
      {actor:string;status:string;after_hash:string}|undefined:undefined;
    const indexed=!!db().prepare("SELECT 1 FROM notes WHERE path=?").get(t.path);
    const abs=resolveNotePath(t.path); // Symlinks/unsafe paths fail closed.
    if(!fs.existsSync(abs)&&!indexed&&row?.status!=="written")continue;
    const note=m2VaultReadDeps.readIndexed(t.path);
    if(!note?.indexed||!note.searchable||sha(note.content)!==t.sha256||splitFrontmatter(note.content).data.intake_id!==intakeId||
      row?.actor!==actor||row.status!=="written"||row.after_hash!==t.sha256||createReceipt(t.kind,t.path,note.content)!==t.operationId)
      throw Error("research_judge_self_write_receipt_hold");
    excluded.push(t.path);
  }
  return excluded;
}
export function judgeContext(scope:RetrievalCoverage["scope"],targets:JudgeTarget[],intakeId:string,actor:string):Pack{
  return buildInvestmentContextPack(scope,{excludedPaths:judgeOwnWrites(targets,intakeId,actor)});
}
/** Hash the exact content used to construct excerpts; a readback race cannot
 * pair yesterday's excerpt with today's hash. Also bind Hub context even when
 * the Hub itself falls outside the selected-note budget. */
export function judgeScopeWitness(context:Pack):JudgeScope{
  if(!retrievalOperationallyComplete(context.retrieval))throw Error("research_judge_scope_operational_hold");
  const issuerResolution=context.issuerResolution.map(r=>{
    let hubSha256:string|null=null;
    if(r.hubPath){const note=m2VaultReadDeps.readIndexed(r.hubPath);if(!note?.indexed||!note.searchable||Buffer.byteLength(note.content)>100000)throw Error("research_judge_identity_readback_hold");hubSha256=sha(note.content);}
    return {...r,hubSha256};
  });
  const selection=context.items.map(item=>{
    const note=m2VaultReadDeps.readIndexed(item.path);
    if(!note?.indexed||!note.searchable||Buffer.byteLength(note.content)>100000||sha(note.content)!==item.contentSha256)throw Error("research_judge_selection_readback_hold");
    return {path:item.path,sha256:item.contentSha256,role:item.role,evidenceUse:item.evidenceUse,
      excerptSha256:sha(item.excerpt),counterEvidence:item.counterEvidenceExcerptIncluded,line:item.line,truncated:item.truncated,matchedMacroScopes:item.matchedMacroScopes};
  });
  return judgeScopeSchema.parse({version:1,policy:"bounded_path_discovery_role_chronology_v1",scope:context.retrieval.scope,issuerResolution,selection});
}
export function judgeScopeCurrent(witness:unknown,retrieval:unknown,targets:JudgeTarget[],intakeId:string,actor:string):boolean{
  const parsed=judgeScopeSchema.safeParse(witness);
  if(!parsed.success||!retrievalOperationallyComplete(retrieval)||
    JSON.stringify(parsed.data.scope)!==JSON.stringify(retrievalScopeSchema.parse(retrieval.scope)))return false;
  try{
    const current=judgeScopeWitness(judgeContext(parsed.data.scope,targets,intakeId,actor));
    return JSON.stringify(current)===JSON.stringify(parsed.data);
  }catch{return false;}
}

/** Admission evidence in the EXISTING Safe Edit event journal. No new schema.
 * Only canonical prepare records it; no wire caller can insert a gate event. */
import {db} from "../db";
import {splitFrontmatter} from "../vault/markdown";
import {JUDGE_VERSION,judgeHash,judgeHistoryCurrent} from "../vault/research-judge";
import {judgeScopeCurrent,type JudgeScope} from "../vault/research-judge-scope";
import type {RetrievalCoverage} from "../vault/investment-retrieval-coverage";
import {m2VaultReadDeps} from "../vault/research-decision-v2";
import {createReceipt} from "../vault/investment-research-context";
export interface JudgeGate {
  version:string;
  intakeId:string;actor:string;decision:"PASS"|"HOLD"|"FAIL";packetDigest:string;resultDigest:string|null;expiresAt:number;
  history:{path:string;sha256:string}[];
  retrieval:RetrievalCoverage|null;
  scopeWitness:JudgeScope|null;
  targets:{path:string;sha256:string;operationId:string;kind:"source_intake"|"structured_claim"|"canonical_review";eligible:boolean}[];
}
export function currentJudgeGate(intakeId:string):JudgeGate|null {
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get())return null;
  const row=db().prepare(`SELECT detail FROM safe_edit_events WHERE event='research_judge_gate'
    AND json_extract(detail,'$.intakeId')=? ORDER BY rowid DESC LIMIT 1`).get(intakeId) as {detail:string}|undefined;
  return row?JSON.parse(row.detail):null;
}
function gateFor(path:string,before:string,after:string):JudgeGate|null {
  const ids=[before,after].map(s=>splitFrontmatter(s).data.intake_id).filter((x):x is string=>typeof x==="string"&&/^IN-[A-F0-9]{16}$/.test(x));
  // Also find enrolled paths when a generic edit strips/forges metadata.
  if(db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get()){
    const row=db().prepare(`SELECT json_extract(detail,'$.intakeId') id FROM safe_edit_events
      WHERE event='research_judge_gate' AND EXISTS (SELECT 1 FROM json_each(detail,'$.targets')
      WHERE json_extract(value,'$.path')=?) ORDER BY rowid DESC LIMIT 1`).get(path) as {id:string}|undefined;
    if(row)ids.push(row.id);
  }
  const gates=[...new Set(ids)].flatMap(id=>{const g=currentJudgeGate(id);return g?[g]:[];});
  if(gates.length>1)throw Error("research_judge_intake_scope_hold");
  return gates[0]??null;
}
export function assertResearchJudgeWrite(path:string,before:string,after:string,actor:string,stage:"preview"|"apply"){
  const g=gateFor(path,before,after);if(!g)return;
  const target=g.targets.find(t=>t.path===path&&t.sha256===judgeHash(after));
  if(!target?.eligible||before!==""||g.actor!==actor)throw Error("research_judge_exact_bytes_or_actor_hold");
  // Source preservation is independent of semantic outcome and packet expiry.
  if(target.kind==="source_intake")return;
  // Earlier gates could retain PASS after non-PASS apply (v4), or lacked
  // current identity/selection binding (v3), upstream
  // completeness (v2) or exact citation
  // spans (v1). Preserve their journal/receipts, but never reuse that authority for
  // a pending Claim/Review write after the contract upgrade.
  if(g.version!==JUDGE_VERSION)throw Error("research_judge_contract_version_hold");
  if(g.decision!=="PASS"||Date.now()>g.expiresAt||!judgeHistoryCurrent(g.history)||!judgeScopeCurrent(g.scopeWitness,g.retrieval,g.targets,g.intakeId,g.actor))throw Error("research_judge_semantic_or_stale_hold");
  if(stage==="apply")for(const prerequisite of g.targets.filter(t=>t.kind==="source_intake"||target.kind==="canonical_review"&&t.kind==="structured_claim")){
    const read=m2VaultReadDeps.readIndexed(prerequisite.path);
    let receiptVerified=false;
    if(read)try{receiptVerified=createReceipt(prerequisite.kind,prerequisite.path,read.content)===prerequisite.operationId;}catch{/* Exact existing receipt contract, never repair. */}
    if(!receiptVerified||!read?.indexed||!read.searchable||judgeHash(read.content)!==prerequisite.sha256)
      throw Error("research_judge_prerequisite_readback_hold");
  }
}

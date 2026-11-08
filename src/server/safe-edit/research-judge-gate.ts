/** Admission evidence in the EXISTING Safe Edit event journal. No new schema.
 * Only canonical prepare records it; no wire caller can insert a gate event. */
import {RESEARCH_STATE_POLICY} from "../vault/research-state";
import {db} from "../db";
import {splitFrontmatter} from "../vault/markdown";
import {JUDGE_VERSION,judgeHash,judgeHistoryCurrent} from "../vault/research-judge";
import {judgeScopeCurrent,type JudgeScope} from "../vault/research-judge-scope";
import type {RetrievalCoverage} from "../vault/investment-retrieval-coverage";
import {m2VaultReadDeps} from "../vault/research-decision-v2";
import {createReceipt} from "../vault/investment-research-context";
export interface JudgeGate {
  version:string;
  researchStatePolicy:string;
  intakeId:string;actor:string;decision:"PASS"|"HOLD"|"FAIL";packetDigest:string;resultDigest:string|null;expiresAt:number;
  packetEnvelopeDigest:string|null;packetIssuedAt:number|null;resultEnvelopeDigest?:string|null;revokedAt?:number;
  history:{path:string;sha256:string}[];
  retrieval:RetrievalCoverage|null;
  scopeWitness:JudgeScope|null;
  targets:{path:string;sha256:string;operationId:string;kind:"source_intake"|"structured_claim"|"canonical_review";eligible:boolean}[];
}
export function assertJudgeAdmissionOrder(current:JudgeGate|null,next:Pick<JudgeGate,"packetEnvelopeDigest"|"packetIssuedAt"|"resultEnvelopeDigest"|"decision">){
  if(!current)return;
  // Legacy gates lack envelope identity, not terminal-state authority. Never
  // let missing identity (or an invalid withdrawal clock) erase HOLD/FAIL.
  if(current.decision!=="PASS"&&!Number.isSafeInteger(current.revokedAt))throw Error("research_judge_withdrawal_time_hold");
  const same=!!current.packetEnvelopeDigest&&next.packetEnvelopeDigest===current.packetEnvelopeDigest;
  // Non-PASS is terminal for this exact envelope, including a new result on
  // the same envelope. Only a later sealed envelope + bound attestation recovers.
  if(same&&current.decision!=="PASS"&&next.decision==="PASS")throw Error("research_judge_revoked_envelope_hold");
  if(current.packetEnvelopeDigest&&!same&&(next.packetIssuedAt===null||next.packetIssuedAt<=(current.packetIssuedAt??0)))throw Error("research_judge_obsolete_admission_hold");
  if(current.decision!=="PASS"&&(next.decision==="PASS"||!same&&next.packetEnvelopeDigest)){
    if(typeof next.packetIssuedAt!=="number"||!Number.isSafeInteger(next.packetIssuedAt)||next.packetIssuedAt<=current.revokedAt!)
      throw Error("research_judge_reassessment_not_fresh_hold");
    if(next.decision==="PASS"&&(!next.packetEnvelopeDigest||next.resultEnvelopeDigest!==next.packetEnvelopeDigest))
      throw Error("research_judge_fresh_assessment_binding_hold");
  }
}
function journalTime(value:unknown):number {
  if(typeof value!=="string")return NaN;
  const time=Date.parse(value);
  return Number.isSafeInteger(time)&&new Date(time).toISOString()===value?time:NaN;
}
export function currentJudgeGate(intakeId:string):JudgeGate|null {
  if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get())return null;
  const row=db().prepare(`SELECT detail,at,rowid FROM safe_edit_events WHERE event='research_judge_gate'
    AND json_extract(detail,'$.intakeId')=? ORDER BY rowid DESC LIMIT 1`).get(intakeId) as {detail:string;at:string;rowid:number}|undefined;
  if(!row)return null;
  const gate=JSON.parse(row.detail) as JudgeGate;
  // Read legacy HOLD timestamps from their actual server journal, never rewrite
  // old events or infer freshness from a caller's claimed assessment time.
  if(gate.decision!=="PASS"&&gate.revokedAt===undefined)gate.revokedAt=journalTime(row.at);
  if(gate.decision!=="PASS"&&!gate.packetEnvelopeDigest){
    // Old format has only the server event time. Do not invent envelope fields
    // or accept ambiguous/reversed legacy admission chronology. Read-only.
    const previous=db().prepare(`SELECT at FROM safe_edit_events WHERE event='research_judge_gate'
      AND json_extract(detail,'$.intakeId')=? AND rowid<? ORDER BY rowid DESC LIMIT 1`).get(intakeId,row.rowid) as {at:string}|undefined;
    const at=journalTime(row.at),before=previous?journalTime(previous.at):-Infinity;
    gate.revokedAt=at>before?at:NaN;
  }
  return gate;
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
  if(g.version!==JUDGE_VERSION||g.researchStatePolicy!==RESEARCH_STATE_POLICY)throw Error("research_judge_contract_version_hold");
  // Pending pre-remediation gates lack an exact envelope/admission binding.
  // Re-prepare with a valid packet; do not upgrade historical journal entries.
  if(!g.packetEnvelopeDigest||!(/^[a-f0-9]{64}$/).test(g.packetEnvelopeDigest)||!Number.isSafeInteger(g.packetIssuedAt))throw Error("research_judge_admission_binding_hold");
  if(g.decision!=="PASS"||Date.now()>g.expiresAt||!judgeHistoryCurrent(g.history)||!judgeScopeCurrent(g.scopeWitness,g.retrieval,g.targets,g.intakeId,g.actor))throw Error("research_judge_semantic_or_stale_hold");
  if(stage==="apply")for(const prerequisite of g.targets.filter(t=>t.kind==="source_intake"||target.kind==="canonical_review"&&t.kind==="structured_claim")){
    const read=m2VaultReadDeps.readIndexed(prerequisite.path);
    let receiptVerified=false;
    if(read)try{receiptVerified=createReceipt(prerequisite.kind,prerequisite.path,read.content)===prerequisite.operationId;}catch{/* Exact existing receipt contract, never repair. */}
    if(!receiptVerified||!read?.indexed||!read.searchable||judgeHash(read.content)!==prerequisite.sha256)
      throw Error("research_judge_prerequisite_readback_hold");
  }
}

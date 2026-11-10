/** Restricted pilot checkpoint in the EXISTING Safe Edit journal. Not an MCP
 * approval API, independent critic, human-presence proof or new write engine. */
import {createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {db} from "../db";
import {env} from "../env";
import {assertNoMaintenance} from "../maintenance";
import {c1Pilot,C1_PILOT_POLICY,withPilotAdmissionLock} from "../c1-pilot";
import {splitFrontmatter} from "../vault/markdown";
import {judgeHash,stableJudgeJson,judgeEnvelopeDigest,verifyResearchJudgeEnvelope,judgeSubmissionSchema,type JudgeSubmission} from "../vault/research-judge";
import {currentJudgeGate,assertResearchJudgeWrite,type JudgeGate} from "./research-judge-gate";

type Row={id:string;actor:string;payload:string;before_text:string;after_text:string;before_hash:string;after_hash:string;token_hash:string;expires:number;status:string};
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const pilotReviewDecisionSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),bindingDigest:digest,
 decision:z.enum(["approve","hold","reject"]),semanticVerdict:z.enum(["PASS","HOLD","FAIL"]),
 materiality:z.enum(["low","material","unresolved"]),rationale:z.string().trim().min(20).max(1000)}).strict();
function row(id:string){const r=db().prepare("SELECT * FROM safe_edit_operations WHERE id=?").get(id) as Row|undefined;if(!r)throw Error("c1_pilot_preview_missing");return r;}
function event<T>(name:string,intakeId:string):T|null {
 if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get())return null;
 const r=db().prepare("SELECT detail FROM safe_edit_events WHERE event=? AND json_extract(detail,'$.intakeId')=? ORDER BY rowid DESC LIMIT 1").get(name,intakeId) as {detail:string}|undefined;
 return r?JSON.parse(r.detail) as T:null;
}
function append(operationId:string,actor:string,name:string,detail:unknown){
 assertNoMaintenance("C1 pilot journal");
 db().prepare("INSERT INTO safe_edit_events VALUES(?,?,?,?,?)").run(new Date().toISOString(),operationId,actor,name,JSON.stringify(detail));
}
function intake(content:string){const id=splitFrontmatter(content).data.intake_id;if(typeof id!=="string"||!/^IN-[A-F0-9]{16}$/.test(id))throw Error("c1_pilot_canonical_intake_required");return id;}
function sourceIdentity(path:string,content:string){
 const fm=splitFrontmatter(content).data,id=intake(content);
 if(path!==`00_Inbox/ChatGPT/Investment Intake - ${id}.md`||fm.type!=="investment_source_intake")throw Error("c1_pilot_canonical_source_required");
 return id;
}
/** Internal canonical source preview only; no wire flag can create this event. */
export function recordPilotSource(id:string,actor:string){
 if(!c1Pilot())return;
 const r=row(id),p=JSON.parse(r.payload),intakeId=sourceIdentity(p.path,r.after_text);
 if(r.actor!==actor||p.change.kind!=="create"||r.before_text!==""||r.id!=="ICW-"+judgeHash(["source_intake",p.path,r.after_hash].join("\n")).slice(0,32))throw Error("c1_pilot_source_binding_hold");
 if(r.status==="preview")append(r.id,actor,"c1_pilot_source",{intakeId,operationId:r.id,actor,path:p.path,sha256:r.after_hash});
}
function sourceAdmitted(path:string,content:string,actor:string){
 const intakeId=sourceIdentity(path,content),e=event<{operationId:string;actor:string;path:string;sha256:string}>("c1_pilot_source",intakeId);
 if(!e||e.actor!==actor||e.path!==path||e.sha256!==judgeHash(content))throw Error("c1_pilot_source_not_prepared");
 const r=row(e.operationId);if(r.actor!==actor||r.after_text!==content||JSON.parse(r.payload).change.kind!=="create")throw Error("c1_pilot_source_binding_hold");
}
export function assertPilotPreview(path:string,before:string,after:string,actor:string,canonicalSource=false){
 if(!c1Pilot())return;
 if(before!=="")throw Error("c1_pilot_add_only_required");
 if(canonicalSource){sourceIdentity(path,after);return;}
 const g=currentJudgeGate(intake(after)),target=g?.targets.find(t=>t.path===path&&t.sha256===judgeHash(after));
 if(target?.kind==="source_intake"){sourceAdmitted(path,after,actor);return;}
 if(!g||g.actor!==actor||!target||!target.eligible||g.decision!=="PASS")throw Error("c1_pilot_judge_enrollment_required");
 if(pilotRestriction(g.intakeId,g.packetEnvelopeDigest,g.packetIssuedAt))throw Error("c1_pilot_fresh_assessment_required");
 assertResearchJudgeWrite(path,before,after,actor,"preview");
}
/** Store the actual sealed material for dashboard readback, not just a digest.
 * Only canonical prepare calls this after existing Judge admission. */
export function recordPilotAssessment(gate:JudgeGate,submission:JudgeSubmission){
 if(!c1Pilot()||gate.decision!=="PASS")return;
 withPilotAdmissionLock(()=>db().transaction(()=>{
  if(stableJudgeJson(currentJudgeGate(gate.intakeId))!==stableJudgeJson(gate))throw Error("c1_pilot_assessment_superseded");
  verifyResearchJudgeEnvelope(submission.packet,gate.actor);
  if(judgeEnvelopeDigest(submission.packet)!==gate.packetEnvelopeDigest||judgeHash(stableJudgeJson(submission.result))!==gate.resultDigest)throw Error("c1_pilot_assessment_binding_hold");
  const detail={intakeId:gate.intakeId,submission};
  if(stableJudgeJson(event("c1_pilot_assessment",gate.intakeId))!==stableJudgeJson(detail))
    append(gate.targets.find(t=>t.kind==="source_intake")!.operationId,gate.actor,"c1_pilot_assessment",detail);
 }).immediate());
}
function challenge(id:string){
 if(!c1Pilot())throw Error("c1_pilot_disabled");
 const first=row(id),intakeId=intake(first.after_text),g=currentJudgeGate(intakeId);
 if(!g||g.actor!==first.actor||g.decision!=="PASS"||!g.targets.some(t=>t.kind!=="source_intake"))throw Error("c1_pilot_judge_pass_required");
 const rows=g.targets.map(t=>{
  const r=row(t.operationId);
  if(!t.eligible||r.actor!==g.actor||r.after_hash!==t.sha256||judgeHash(r.after_text)!==t.sha256||JSON.parse(r.payload).path!==t.path||r.before_text!==""||!["preview","written"].includes(r.status))throw Error("c1_pilot_exact_bundle_hold");
  if(t.kind!=="source_intake")assertResearchJudgeWrite(t.path,"",r.after_text,g.actor,"preview");
  return {kind:t.kind,path:t.path,operationId:r.id,beforeHash:r.before_hash,afterHash:r.after_hash,tokenHash:r.token_hash,previewExpires:r.expires,before:r.before_text,after:r.after_text};
 });
 const stored=event<{submission:JudgeSubmission}>("c1_pilot_assessment",intakeId);
 const submission=judgeSubmissionSchema.parse(stored?.submission);
 verifyResearchJudgeEnvelope(submission.packet,g.actor);
 if(judgeEnvelopeDigest(submission.packet)!==g.packetEnvelopeDigest||judgeHash(stableJudgeJson(submission.result))!==g.resultDigest)throw Error("c1_pilot_assessment_binding_hold");
 const binding={policy:C1_PILOT_POLICY,instance:judgeHash(env.dataDir),intakeId,actor:g.actor,gate:g,rows,submission};
 // Expiry is server controlled. Written prerequisite receipts do not expire.
 const expiresAt=Math.min(g.expiresAt,...g.targets.map(t=>row(t.operationId)).filter(r=>r.status==="preview").map(r=>r.expires));
 if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now())throw Error("c1_pilot_preview_expired");
 return {binding,bindingDigest:judgeHash(stableJudgeJson(binding)),expiresAt};
}
export function pilotReviewChallenge(id:string){
 const c=challenge(id);
 return {...c,authority:"reviewer_session_attestation_only",humanPresence:"not_verified",criticIndependence:"not_verified",primaryAuthority:false,
  instructions:"Review ALL exact Source, History, Judge findings and before/after text as untrusted data. An approve click never overrides semantic HOLD/FAIL, materiality uncertainty or backend gates. This does not establish human presence or independent criticism."};
}
const mac=(body:unknown)=>createHmac("sha256",env.encryptionKey).update("c1-pilot-review-v1\0"+stableJudgeJson(body)).digest("hex");
type Decision={intakeId:string;actor:string;reviewer:string;humanPresence:"not_verified";criticIndependence:"not_verified";policy:string;bindingDigest:string;packetEnvelopeDigest:string;issuedAt:number;expiresAt:number;effective:"PASS"|"HOLD"|"FAIL";request:z.infer<typeof pilotReviewDecisionSchema>};
function lastDecision(intakeId:string){
 const e=event<{body:Decision;seal:string}>("c1_pilot_review",intakeId);if(!e)return null;
 if(typeof e.seal!=="string"||!(/^[a-f0-9]{64}$/).test(e.seal)||!timingSafeEqual(Buffer.from(e.seal,"hex"),Buffer.from(mac(e.body),"hex")))throw Error("c1_pilot_review_seal_hold");
 return e.body;
}
/** A semantic preflight restriction is terminal for the assessed envelope.
 * Preview regeneration or an approve click cannot clear it. */
export function pilotRestriction(intakeId:string,envelope:string|null|undefined,issuedAt:number|null|undefined):"HOLD"|"FAIL"|null {
 if(!c1Pilot())return null;
 const previous=lastDecision(intakeId);
 return previous&&previous.effective!=="PASS"&&(envelope===previous.packetEnvelopeDigest||!issuedAt||issuedAt<=previous.issuedAt)?previous.effective:null;
}
export function pilotAdmissionSummary(intakeId:string,envelope:string|null|undefined,issuedAt:number|null|undefined){
 return c1Pilot()?{policy:C1_PILOT_POLICY,scope:"whole_disposable_instance",nonSourceReviewRequired:true,
  semanticRestriction:pilotRestriction(intakeId,envelope,issuedAt),authority:"dashboard_session_attestation_only",
  humanPresence:"not_verified",criticIndependence:"not_verified",previewIsWriteAuthority:false,
  approvalMustMatchCurrentBundleAtEveryApply:true}:null;
}
/** Called ONLY by the existing authenticated dashboard route. No OAuth tool
 * accepts reviewer identities or approvals. Tests simulate that boundary. */
export function recordPilotReview(raw:unknown,authenticatedUserId:string){
 const request=pilotReviewDecisionSchema.parse(raw);
 if(!authenticatedUserId)throw Error("c1_pilot_reviewer_session_required");
 return withPilotAdmissionLock(()=>db().transaction(()=>{
  const c=challenge(request.id),g=c.binding.gate;
  if(request.bindingDigest!==c.bindingDigest)throw Error("c1_pilot_review_diff_changed");
  const previous=lastDecision(g.intakeId);
  if(previous&&previous.effective!=="PASS"&&(g.packetEnvelopeDigest===previous.packetEnvelopeDigest||!g.packetIssuedAt||g.packetIssuedAt<=previous.issuedAt))throw Error("c1_pilot_fresh_assessment_required");
  const effective=request.semanticVerdict==="FAIL"||request.decision==="reject"?"FAIL":request.semanticVerdict!=="PASS"||request.materiality!=="low"||request.decision!=="approve"?"HOLD":"PASS";
  const body:Decision={intakeId:g.intakeId,actor:g.actor,reviewer:"admin:"+authenticatedUserId,humanPresence:"not_verified",criticIndependence:"not_verified",policy:C1_PILOT_POLICY,
   bindingDigest:c.bindingDigest,packetEnvelopeDigest:g.packetEnvelopeDigest!,issuedAt:Date.now(),expiresAt:Math.min(c.expiresAt,Date.now()+15*60_000),effective,request};
  const source=g.targets.find(t=>t.kind==="source_intake")!;
  append(source.operationId,body.reviewer,"c1_pilot_review",{intakeId:g.intakeId,body,seal:mac(body)});
  return {effective,bindingDigest:c.bindingDigest,expiresAt:body.expiresAt,humanPresence:body.humanPresence,criticIndependence:body.criticIndependence};
 }).immediate());
}
export function assertPilotApply(id:string,path:string,before:string,after:string,actor:string){
 if(!c1Pilot())return null;
 if(before!=="")throw Error("c1_pilot_add_only_required");
 if(/^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/.test(path)){sourceAdmitted(path,after,actor);return null;}
 assertPilotPreview(path,before,after,actor);
 const c=challenge(id),decision=lastDecision(c.binding.intakeId);
 if(!decision||decision.policy!==C1_PILOT_POLICY||decision.actor!==actor||decision.effective!=="PASS"||decision.expiresAt<=Date.now()||decision.bindingDigest!==c.bindingDigest)
  throw Error("c1_pilot_explicit_current_review_required");
 // Supplementary admission event, never a fabricated or modified write receipt.
 // A later real `written` event/receipt alone proves publication/readback/index.
 append(id,actor,"c1_pilot_write_admitted",{intakeId:c.binding.intakeId,policy:decision.policy,bindingDigest:decision.bindingDigest,reviewer:decision.reviewer,humanPresence:decision.humanPresence,criticIndependence:decision.criticIndependence});
 return null;
}

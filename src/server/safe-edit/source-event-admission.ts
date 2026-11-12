/** Bounded semantic assessment adapter. Reuses existing receipts, exact-span
 * validation, issuer/selection witness, terminal admission ordering and journal.
 * There is no model invocation or independent semantic/issuer verification. */
import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {db} from "../db";
import {env} from "../env";
import {assertNoMaintenance} from "../maintenance";
import {revisionPilotRequired,withPilotAdmissionLock} from "../c1-pilot";
import {assertRevisionPilot,verifyRevisionCandidate,type CanonicalRevisionInput} from "./canonical-review-revision-pilot";
import {assertJudgeAdmissionOrder,currentJudgeGate} from "./research-judge-gate";
import {SOURCE_EVENT_POLICY,sourceEventEnvelopeSchema,sourceEventSubmissionSchema,type SourceEventSubmission} from "../vault/source-event-contract";
import {judgeHash as sha,stableJudgeJson as stable,exactTextReference} from "../vault/research-judge-contract";
import {judgeContext,judgeScopeWitness,judgeScopeCurrent,type JudgeScope,type JudgeTarget} from "../vault/research-judge-scope";
import {retrievalOperationallyComplete,type RetrievalCoverage} from "../vault/investment-retrieval-coverage";
import {indexedRead,createReceipt} from "../vault/investment-research-context";
import {preservedSubmittedText,m2VaultReadDeps} from "../vault/research-decision-v2";
import {planInvestmentWriteback,type WritebackInput} from "../vault/investment-writeback-router";
import {isGeneratedClaimPath,readPersistedClaim} from "../vault/canonical-claims";
import {splitFrontmatter} from "../vault/markdown";
import {isResearchReviewType,researchTrust} from "../vault/research-state";
import type {PreviewInput} from "./schema";

type Target={path:string;beforeHash:string;afterHash:string|null;operationId:string|null;change:PreviewInput["change"]};
export interface EventProposal {kind:"create"|"revise";entity:string;intakeId:string;inputDigest:string;
 reviewPath:string;sources:string[];targets:Target[];ownWrites:JudgeTarget[];scope:RetrievalCoverage["scope"];knowledgeCutoff:string|null}
const event="source_event_gate",empty=sha("");
const hashObject=(v:unknown)=>sha(stable(v));
const envelopeHash=(p:SourceEventSubmission["packet"])=>hashObject(p);
const mac=(kind:string,v:unknown)=>createHmac("sha256",env.encryptionKey).update(kind+"\0"+stable(v)).digest("hex");
const validMac=(kind:string,v:unknown,s:unknown)=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s)&&timingSafeEqual(Buffer.from(mac(kind,v),"hex"),Buffer.from(s,"hex"));
function withoutAssessment<T extends object>(input:T){const clean={...input} as T&{sourceEvent?:unknown;researchJudge?:unknown};delete clean.sourceEvent;delete clean.researchJudge;return clean;}
export function canonicalEventProposal(input:WritebackInput,suppliedPlan?:ReturnType<typeof planInvestmentWriteback>):EventProposal{
 const clean=withoutAssessment(input),plan=suppliedPlan??planInvestmentWriteback(clean),steps=plan.safeEditWorkflow?.steps;
 const review=steps?.find(s=>s.kind==="canonical_review"),source=steps?.find(s=>s.kind==="source_intake");
 if(clean.domain!=="company"||clean.entities.length!==1||!clean.researchReview||!review||!source)throw Error("source_event_typed_single_issuer_review_required");
 const targets=steps!.filter(s=>s.kind!=="source_intake").map(s=>{
   // Existing deterministic create bytes remain recoverable on exact retry.
   if(!s.safeEditRequest&&s.state!=="verified_existing")throw Error("source_event_pending_review_recipe_hold");
   const change=s.safeEditRequest?.change??({kind:"create" as const,content:indexedRead(s.path).raw});
   return {path:s.path,operationId:s.receiptKey,beforeHash:empty,afterHash:s.expectedSha256,change};
 });
 return {kind:"create",entity:clean.entities[0],intakeId:plan.planId,inputDigest:hashObject(clean),reviewPath:review.path,
   sources:[source.path],targets,ownWrites:steps!.filter(s=>s.kind!=="source_intake").map(s=>({path:s.path,sha256:s.expectedSha256,operationId:s.receiptKey,kind:s.kind})),
   scope:{question:clean.entities[0]+": "+clean.topic,issuers:[clean.entities[0]],focus:clean.focus??"general",maxNotes:8,maxChars:12000},
   knowledgeCutoff:clean.researchLineage?.knowledgeCutoffAsOf??null};
}
export function revisionEventProposal(input:CanonicalRevisionInput):EventProposal{
 const c=verifyRevisionCandidate(input),clean=withoutAssessment(input);
 return {kind:"revise",entity:input.entity,intakeId:c.review.fm.intake_id as string,inputDigest:hashObject(clean),reviewPath:input.existingReview.path,
   sources:c.sourcePaths,targets:[{path:input.existingReview.path,beforeHash:input.existingReview.expectedSha256,afterHash:null,operationId:null,
     change:{kind:"append",heading:c.review.raw.includes("## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)")?"บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)":"Research analysis (AI interpretation; not approved Thesis)",content:c.body,date:input.reviewDate}}],
   ownWrites:[],scope:{question:input.entity+": "+input.existingReview.comparisonBasis,issuers:[input.entity],focus:"general",maxNotes:8,maxChars:12000},knowledgeCutoff:null};
}
/** Semantic assessment precedes Preview. Its server-created analysis clock is
 * intentionally pending, like Research Judge's analysisCreatedAt=null. Only
 * that runtime-generated field is projected; all caller prose/claims stay exact.
 * Enrollment + dashboard approval subsequently bind the actual complete bytes,
 * operation IDs and runtime chronology under the existing Preview contract. */
function semanticProposal(p:EventProposal):EventProposal{
 if(p.kind!=="create")return p;
 const targets=p.targets.map(t=>{
   if(t.path!==p.reviewPath||t.change.kind!=="create")return t;
   const fm=splitFrontmatter(t.change.content).data;
   if(fm.analysis_created_at_provenance!=="runtime_canonical_review_proposal")return t;
   const content=t.change.content.replace(/^analysis_created_at: "[^"\n]+"\n/m,'analysis_created_at: "<pending_runtime_preview_time>"\n');
   const afterHash=sha(content),operationId="ICW-"+sha(["canonical_review",t.path,afterHash].join("\n")).slice(0,32);
   return {...t,afterHash,operationId,change:{...t.change,content}};
 });
 return {...p,targets,ownWrites:p.ownWrites.map(t=>{const target=targets.find(x=>x.path===t.path)!;return {...t,sha256:target.afterHash!,operationId:target.operationId!};})};
}
function sourceRead(path:string){
 if(!/^00_Inbox\/ChatGPT\/Investment Intake - IN-[A-F0-9]{16}\.md$/.test(path))throw Error("source_event_source_path_hold");
 const n=indexedRead(path),id=path.match(/IN-[A-F0-9]{16}/)![0],receiptId=createReceipt("source_intake",path,n.raw),part=preservedSubmittedText(n.raw);
 const text=part===null?undefined:[part,part+"\n"].find(s=>sha(s)===n.fm.source_text_sha256);
 const fts=db().prepare("SELECT body FROM notes_fts WHERE path=? AND notes_fts MATCH ?").get(path,"InvestmentIntake"+id.slice(3)) as {body:string}|undefined;
 if(!text||n.fm.type!=="investment_source_intake"||n.fm.intake_id!==id||fts?.body!==n.body)throw Error("source_event_source_readback_hold");
 return {path,intakeId:id,sha256:sha(n.raw),text,textSha256:sha(text),receiptId,
   familyRef:receiptId,originalLocator:n.fm.source_url??null,publisher:n.fm.attributed_publisher??null,
   declaredMetadata:{sourceKind:n.fm.source_kind??null,inputFormat:n.fm.input_format??null,sourceLanguage:n.fm.source_language??null,
     sourceChat:n.fm.source_chat??null,sourceChannel:n.fm.source_channel??null,attributedOrigin:n.fm.attributed_origin??null,
     originalDocumentAccess:n.fm.original_document_access??null,attachmentStatus:n.fm.attachment_status??null,receivedAt:n.fm.received_at??null},
   eventDate:n.fm.event_date??null,publicationDate:n.fm.published_at??null,provenance:"received_source_not_publisher_authentication"};
}
function historicalRead(path:string){
 const read=m2VaultReadDeps.readIndexed(path);
 if(!read?.indexed||!read.searchable||Buffer.byteLength(read.content)>100000)throw Error("source_event_history_readback_hold");
 const parsed=splitFrontmatter(read.content),row=db().prepare("SELECT frontmatter FROM notes WHERE path=?").get(path) as {frontmatter:string|null};
 const fts=db().prepare("SELECT body FROM notes_fts WHERE path=?").get(path) as {body:string}|undefined;
 // Untyped historical notes legitimately index no frontmatter as SQL NULL.
 if(stable(JSON.parse(row.frontmatter??"null")??{})!==stable(parsed.data)||fts?.body!==parsed.body)throw Error("source_event_history_index_drift_hold");
 const n={raw:read.content,fm:parsed.data},isSource=/^00_Inbox\/ChatGPT\/Investment Intake - IN-/.test(path),isReview=/^10_Knowledge\/Company Research\/Investment Review - .+ - IN-/.test(path);
 let receiptId:string|null=null,source:null|ReturnType<typeof sourceRead>=null,receiptBinding="historical_unverified";
 if(isSource){receiptId=sourceRead(path).receiptId;receiptBinding="received_source_receipt";}
 if(isGeneratedClaimPath(path)){
   const bound=readPersistedClaim(path);
   if(!bound.reviewScanComplete)throw Error("source_event_claim_review_binding_hold");
   receiptId=bound.receiptKey;source=sourceRead(bound.sourcePath);receiptBinding="source_claim_receipts";
 }
 if(isReview){
   const journal=db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_operations'").get();
   const recorded=journal&&db().prepare("SELECT 1 FROM safe_edit_operations WHERE json_extract(payload,'$.path')=? LIMIT 1").get(path);
   if(recorded){receiptId=createReceipt("canonical_review",path,n.raw);source=sourceRead(n.fm.original_source_path as string);receiptBinding="source_review_receipts";}
   else receiptBinding="legacy_historical_unverified";
 }
 return {path,sha256:sha(n.raw),text:n.raw,receiptId,source,receiptBinding,researchTrust:researchTrust(path,n.fm)};
}
function context(proposal:EventProposal,actor:string){
 const pack=judgeContext(proposal.scope,proposal.ownWrites,proposal.intakeId,actor),constraints:string[]=[];
 let witness:JudgeScope|null=null;
 try{witness=judgeScopeWitness(pack);}catch{constraints.push("source_event_history_operational_hold");}
 if(!retrievalOperationallyComplete(pack.retrieval))constraints.push("source_event_history_operational_hold");
 if(pack.issuerResolution.length!==1||pack.issuerResolution.some(r=>!["exact_existing_title","indexed_alias"].includes(r.status)))constraints.push("source_event_issuer_resolution_hold");
 const history:ReturnType<typeof historicalRead>[]=[];
 for(const item of pack.items)try{const h=historicalRead(item.path);if(h.sha256!==item.contentSha256)throw Error();history.push(h);}catch{constraints.push("source_event_selected_history_readback_hold");}
 return {witness,retrieval:pack.retrieval,history,constraints,omitted:pack.omitted.slice(0,30),incomplete:pack.incomplete.slice(0,30),
   candidateReviews:pack.contextBundles.slice(0,12),candidatesTruncated:pack.contextBundles.length>12,
   effectiveIssuerId:pack.issuerResolution[0]?.hubPath??null};
}
type PacketBody={policy:typeof SOURCE_EVENT_POLICY;nonce:string;proposal:EventProposal;sources:ReturnType<typeof sourceRead>[];context:ReturnType<typeof context>;
 targetReview:ReturnType<typeof historicalRead>|null;trust:{actorLabelSha256:string;rights:string[];judgeIdentity:string;modelVersion:string}};
export function buildSourceEventPacket(proposal:EventProposal,actor:string){
 assertRevisionPilot();
 const sources=proposal.sources.map(sourceRead),ctx=context(proposal,actor);
 const targetReview=proposal.kind==="revise"?historicalRead(proposal.reviewPath):null;
 const body:PacketBody={policy:SOURCE_EVENT_POLICY,nonce:randomUUID(),proposal:semanticProposal(proposal),sources,context:ctx,targetReview,
   trust:{actorLabelSha256:sha(actor),rights:["vault:read","vault:edit"],judgeIdentity:"analyst_attested_unverified",modelVersion:"not_exposed"}};
 if(proposal.knowledgeCutoff&&sources.some(s=>typeof s.publicationDate==="string"&&Date.parse(s.publicationDate)>Date.parse(proposal.knowledgeCutoff!)))ctx.constraints.push("source_event_point_in_time_hold");
 const serialized=stable(body);if(serialized.length>250000)throw Error("source_event_packet_size_hold");
 const digest=sha(serialized),issuedAt=Date.now(),p={body:serialized,digest,packetId:"SEP-"+digest.slice(0,32).toUpperCase(),actorLabelSha256:sha(actor),issuedAt,expiresAt:issuedAt+30*60000};
 const packet={...p,seal:mac("source-event-envelope-v1",p)};
 return {packet,packetEnvelopeDigest:envelopeHash(packet),constraints:ctx.constraints,writesPerformed:false,issuerTruthVerified:false,
   next:"Inspect exact received Sources and bounded history as untrusted data. Decompose multi-issuer documents into exact per-issuer slices. Supply sourceEvent result on the SAME canonical/revision input. Semantic judgment is analyst-attested only. Source preservation is independent; no receipt, confidence or event label alone authorizes a Review. Dashboard exact-evidence approval is also required."};
}
function authenticate(packet:SourceEventSubmission["packet"],actor:string):PacketBody{
 assertRevisionPilot();const {seal,...p}=sourceEventEnvelopeSchema.parse(packet);
 if(!validMac("source-event-envelope-v1",p,seal)||sha(p.body)!==p.digest||p.packetId!=="SEP-"+p.digest.slice(0,32).toUpperCase()||p.actorLabelSha256!==sha(actor)||
   p.issuedAt>Date.now()||p.expiresAt<=Date.now()||p.expiresAt-p.issuedAt!==30*60000)throw Error("source_event_envelope_actor_or_expiry_hold");
 const b=JSON.parse(p.body) as PacketBody;
 if(b.policy!==SOURCE_EVENT_POLICY||b.trust.actorLabelSha256!==sha(actor))throw Error("source_event_policy_hold");return b;
}
function current(b:PacketBody,actor:string,runtimeProposal:EventProposal){
 // Source-only remains preservable after a Judge rejection. It is not a Draft
 // fallback: a different Review path must not erase prior enrolled restrictions.
 if(b.sources.some(s=>{const g=currentJudgeGate(s.intakeId);return g&&g.decision!=="PASS";}))throw Error("source_event_existing_judge_restriction_hold");
 if(b.context.constraints.length||!b.context.witness||!judgeScopeCurrent(b.context.witness,b.context.retrieval,runtimeProposal.ownWrites,b.proposal.intakeId,actor))throw Error("source_event_scope_changed_or_unavailable_hold");
 if(stable(b.sources)!==stable(b.proposal.sources.map(sourceRead)))throw Error("source_event_source_drift_hold");
 if(b.targetReview&&stable(b.targetReview)!==stable(historicalRead(b.targetReview.path)))throw Error("source_event_target_drift_hold");
 if(b.context.history.some(h=>stable(h)!==stable(historicalRead(h.path))))throw Error("source_event_history_binding_hold");
}
function semanticEligibility(b:PacketBody,s:SourceEventSubmission){
 const r=s.result,reasons:string[]=[];
 if(r.packetDigest!==s.packet.digest||r.packetEnvelopeDigest!==envelopeHash(s.packet))throw Error("source_event_result_binding_hold");
 const evidence=new Map<string,{text:string;sha256:string}>(b.sources.map((x,i)=>["source_"+i,{text:x.text,sha256:x.textSha256}]));
 b.context.history.forEach((h,i)=>evidence.set("history_"+i,h));
 if(b.targetReview)evidence.set("target_review",b.targetReview);
 const validRef=(ref:SourceEventSubmission["result"]["event"]["references"][number])=>{const e=evidence.get(ref.key);return exactTextReference(ref,e?.text,e?.sha256);};
 if(r.disposition!=="PASS"||Object.values(r.checks).some(v=>v!=="PASS"))reasons.push("source_event_semantic_hold");
 const issuer=b.context.effectiveIssuerId;
 if(!issuer||r.event.effectiveIssuerId!==issuer)reasons.push("source_event_issuer_mismatch");
 for(const [i] of b.sources.entries())if(!r.sourceBindings.some(x=>x.sourceKey==="source_"+i))reasons.push("source_event_missing_source_assessment");
 for(const binding of r.sourceBindings){
   if(!/^source_\d+$/.test(binding.sourceKey)||!evidence.has(binding.sourceKey)||binding.effectiveIssuerId!==issuer||
      !["primary_subject","related_issuer"].includes(binding.relation)||binding.coverage==="not_obtained"||
      binding.references.some(ref=>ref.key!==binding.sourceKey||!validRef(ref)))reasons.push("source_event_issuer_slice_hold");
   if(binding.relation==="related_issuer"&&(!binding.supportedRelationship||binding.supportedRelationship.references.some(ref=>ref.key!==binding.sourceKey||!validRef(ref))))reasons.push("source_event_relationship_hold");
 }
 if(new Set(r.sourceBindings.map(x=>x.sliceId)).size!==r.sourceBindings.length)reasons.push("source_event_slice_identity_hold");
 const expected=b.context.history.map((_,i)=>"history_"+i);
 if(stable([...r.event.consideredHistoryKeys].sort())!==stable(expected.sort())||r.event.references.some(ref=>!validRef(ref))||r.event.counterEvidenceRefs.some(ref=>!validRef(ref)))reasons.push("source_event_history_or_reference_hold");
 if(!["complete_for_bounded_scope","bounded_omission"].includes(r.event.coverage)||r.event.materiality==="unknown"||
   Object.values(r.event.comparison).includes("ambiguous"))reasons.push("source_event_uncertainty_hold");
 if(b.context.history.length&&!r.event.references.some(ref=>ref.key.startsWith("history_")))reasons.push("source_event_history_evidence_required");
 if(!r.event.references.some(ref=>ref.key.startsWith("source_")))reasons.push("source_event_source_evidence_required");
 if(b.proposal.kind==="create"&&(r.event.relation!=="new_event"||r.event.action!=="create_new_review"||r.event.targetReviewPath!==null))reasons.push("source_event_create_requires_new_event");
 if(b.proposal.kind==="revise"&&(r.event.relation!=="added_detail"||r.event.action!=="append_revision"||r.event.materiality!=="low"||r.event.targetReviewPath!==b.proposal.reviewPath||!r.event.references.some(ref=>ref.key==="target_review")))reasons.push("source_event_revision_requires_low_risk_added_detail");
 return [...new Set(reasons)];
}
export type EventAdmission={runtimeProposal:EventProposal;submission:SourceEventSubmission;body:PacketBody;decision:"PASS"|"HOLD"|"FAIL";reasons:string[]};
export function evaluateSourceEvent(proposal:EventProposal,s:unknown,actor:string):EventAdmission{
 const submission=sourceEventSubmissionSchema.parse(s),body=authenticate(submission.packet,actor);
 if(stable(body.proposal)!==stable(semanticProposal(proposal)))throw Error("source_event_exact_proposal_hold");
 const reasons=semanticEligibility(body,submission);
 try{current(body,actor,proposal);}catch(e){reasons.push(e instanceof Error?e.message:"source_event_freshness_hold");}
 return {runtimeProposal:proposal,submission,body,decision:submission.result.disposition==="FAIL"?"FAIL":reasons.length?"HOLD":"PASS",reasons};
}
type Gate=EventAdmission&{actor:string;targets:Target[];packetEnvelopeDigest:string;packetIssuedAt:number;resultEnvelopeDigest:string;revokedAt?:number};
export function sourceEventOperationId(a:EventAdmission):string{
 return "ICR-"+sha(stable([a.body.proposal.inputDigest,a.submission.packet.actorLabelSha256,envelopeHash(a.submission.packet)])).slice(0,32);
}
function tableExists(){return !!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safe_edit_events'").get();}
function gateFor(path:string):Gate|null{
 if(!tableExists())return null;
 const row=db().prepare("SELECT detail FROM safe_edit_events WHERE event=? AND EXISTS (SELECT 1 FROM json_each(detail,'$.body.targets') WHERE json_extract(value,'$.path')=?) ORDER BY rowid DESC LIMIT 1").get(event,path) as {detail:string}|undefined;
 if(!row)return null;const wrapper=JSON.parse(row.detail) as {body:Gate;seal:string};
 if(!validMac("source-event-gate-v1",wrapper.body,wrapper.seal))throw Error("source_event_journal_integrity_hold");return wrapper.body;
}
/** Serialized by the existing admission lock and SQLite IMMEDIATE transaction. */
export function enrollSourceEvent(a:EventAdmission,actor:string){
 return withPilotAdmissionLock(()=>enrollLocked(a,actor));
}
function enrollLocked(a:EventAdmission,actor:string){
 assertNoMaintenance("source event admission");assertRevisionPilot();
 const g:Gate={...a,actor,targets:a.runtimeProposal.targets.map(t=>({...t,operationId:t.operationId??sourceEventOperationId(a)})),
   packetEnvelopeDigest:envelopeHash(a.submission.packet),packetIssuedAt:a.submission.packet.issuedAt,resultEnvelopeDigest:a.submission.result.packetEnvelopeDigest,
   ...(a.decision!=="PASS"?{revokedAt:Date.now()}:{})};
 if(!tableExists())throw Error("source_event_preserved_source_required");
 db().transaction(()=>{
   const prev=gateFor(g.body.proposal.reviewPath);
   if(prev?.actor!==undefined&&prev.actor!==actor)throw Error("source_event_existing_actor_hold");
   assertJudgeAdmissionOrder(prev,g);
   if(prev?.packetEnvelopeDigest===g.packetEnvelopeDigest&&prev.decision!=="PASS"&&g.decision!=="PASS")return;
   if(prev&&prev.packetEnvelopeDigest===g.packetEnvelopeDigest&&prev.decision===g.decision&&stable(prev.submission.result)===stable(g.submission.result))return;
   // Same envelope cannot change an approved assessment into a different PASS.
   if(prev?.packetEnvelopeDigest===g.packetEnvelopeDigest&&g.decision==="PASS")throw Error("source_event_fresh_assessment_required");
   const quota=db().prepare("SELECT count(*) n,coalesce(sum(length(detail)),0) bytes FROM safe_edit_events WHERE event=?").get(event) as {n:number;bytes:number};
   // Quota never suppresses withdrawal of already granted authority.
   if((quota.n>=128||quota.bytes+stable(g).length>32000000)&&!(prev?.decision==="PASS"&&g.decision!=="PASS"))throw Error("source_event_journal_quota_hold");
   db().prepare("INSERT INTO safe_edit_events VALUES(?,?,?,?,?)").run(new Date().toISOString(),g.targets[0].operationId,actor,event,JSON.stringify({body:g,seal:mac("source-event-gate-v1",g)}));
 }).immediate();
 return g;
}
/** Authenticate an exact matching restrictive assessment before outer schema,
 * appearance/token/planner failures. Unrelated/obsolete callers cannot revoke. */
export function withdrawSourceEvent(raw:unknown,actor:string){
 let submission:SourceEventSubmission,body:PacketBody,reasons:string[];
 try{
   submission=sourceEventSubmissionSchema.parse(raw);body=authenticate(submission.packet,actor);
   reasons=semanticEligibility(body,submission);
 }catch{return;} // Unauthenticated input has no revocation authority.
 if(!reasons.length)return;
 const prev=gateFor(body.proposal.reviewPath);
 if(!prev||prev.actor!==actor||prev.packetEnvelopeDigest!==envelopeHash(submission.packet))return;
 // A valid withdrawal must not disappear on journal/lock failure. Surface the
 // refusal so the caller can retry; the authoritative transaction rechecks order.
 enrollSourceEvent({runtimeProposal:prev.runtimeProposal,submission,body,decision:submission.result.disposition==="FAIL"?"FAIL":"HOLD",reasons},actor);
}
export function isCompanyReviewWrite(path:string,before:string,after:string){
 if(path.startsWith("10_Knowledge/Company Research/")&&!/\/Investment Claim - ICL-/.test(path))return true;
 return [before,after].some(text=>{const fm=splitFrontmatter(text).data;return isResearchReviewType(fm.type)&&!["macro","industry","asset"].includes(String(fm.review_scope));});
}
export function assertSourceEventWrite(operationId:string,path:string,before:string,after:string,actor:string,change:PreviewInput["change"],stage:"preview"|"apply",dedicated=false){
 const g=gateFor(path),required=revisionPilotRequired()&&isCompanyReviewWrite(path,before,after);
 if(!g&&!required)return;
 if(!g||stage==="preview"&&!dedicated)throw Error("source_event_dedicated_assessment_required");
 authenticate(g.submission.packet,actor);
 const target=g.targets.find(t=>t.path===path&&t.operationId===operationId);
 if(g.actor!==actor||g.decision!=="PASS"||!target||target.beforeHash!==sha(before)||target.afterHash!==null&&target.afterHash!==sha(after)||stable(target.change)!==stable(change))throw Error("source_event_exact_action_or_assessment_hold");
 current(g.body,actor,g.runtimeProposal);
}
export function sourceEventReviewEvidence(path:string){
 const g=gateFor(path);if(!g)return null;
 authenticate(g.submission.packet,g.actor);current(g.body,g.actor,g.runtimeProposal);
 if(g.decision!=="PASS")throw Error("source_event_assessment_hold");
 return {contractVersion:SOURCE_EVENT_POLICY,assessment:g.submission.result,packet:g.body,packetEnvelopeDigest:g.packetEnvelopeDigest,
   issuerAssociation:"analyst_attested_not_independently_verified",independentEvidenceIncrement:0,comparatorEligible:false};
}
export function assertEnrolledSourceEvent(a:EventAdmission,actor:string){
 const g=gateFor(a.body.proposal.reviewPath);
 if(!g||g.actor!==actor||g.decision!=="PASS"||a.decision!=="PASS"||g.packetEnvelopeDigest!==envelopeHash(a.submission.packet)||stable(g.submission.result)!==stable(a.submission.result))throw Error("source_event_exact_enrollment_required");
 current(g.body,actor,g.runtimeProposal);
}
export const hasSourceEventGate=(path:string)=>gateFor(path)!==null;
export const sourceEventTargets=(path:string)=>gateFor(path)?.targets??[];
export const sourceEventRequired=revisionPilotRequired;

/** NEW SYNTHETIC binding fixtures. Results/approvals are simulated; no claim
 * of actual LLM accuracy, independent criticism or genuine human presence. */
import type {SourceEventSubmission} from "../src/server/vault/source-event-contract";
import type {EventProposal} from "../src/server/safe-edit/source-event-admission";
export async function assessed(proposal:EventProposal,actor:string):Promise<SourceEventSubmission>{
 const {buildSourceEventPacket}=await import("../src/server/safe-edit/source-event-admission");
 const {SOURCE_EVENT_POLICY,ISSUER_BIND_POLICY,EVENT_ID_POLICY}=await import("../src/server/vault/source-event-contract");
 const built=buildSourceEventPacket(proposal,actor),body=JSON.parse(built.packet.body);
 const ref=(key:string,text:string,sourceSha256:string)=>({key,quote:text.slice(0,100),locator:`utf16:0:${Math.min(text.length,100)}`,sourceSha256});
 const sourceRefs=body.sources.map((s:{text:string;textSha256:string},i:number)=>ref("source_"+i,s.text,s.textSha256));
 const historyRefs=body.context.history.map((h:{text:string;sha256:string},i:number)=>ref("history_"+i,h.text,h.sha256));
 const target=body.targetReview;
 return {packet:built.packet,result:{contractVersion:SOURCE_EVENT_POLICY,packetDigest:built.packet.digest,packetEnvelopeDigest:built.packetEnvelopeDigest,
 disposition:"PASS",methodVersion:"SYNTHETIC-MECHANICAL-1",criticIndependence:"not_verified",
 sourceBindings:sourceRefs.map((r:typeof sourceRefs[number],i:number)=>({bindingVersion:ISSUER_BIND_POLICY,sourceKey:r.key,sliceId:"slice_"+i,
 effectiveIssuerId:body.context.effectiveIssuerId??"unresolved",documentRelation:"single_issuer",relation:"primary_subject",
 semanticRationale:"Synthetic fixture association supplied for deterministic binding tests only.",references:[r],supportedRelationship:null,
 coverage:"excerpt_only",limitations:["Fixture only; original publisher not independently verified"]})),
 event:{decisionVersion:EVENT_ID_POLICY,effectiveIssuerId:body.context.effectiveIssuerId??"unresolved",
 relation:proposal.kind==="create"?"new_event":"added_detail",action:proposal.kind==="create"?"create_new_review":"append_revision",
 targetReviewPath:target?.path??null,materiality:"low",semanticRationale:"Synthetic exact-source comparison, not financial verification or LLM evaluation.",
 materialityRationale:"The synthetic manual annotation has no asserted financial or investment authority.",
 comparison:{economicSubject:proposal.kind==="create"?"different":"same",period:"not_applicable",role:"same",vintage:"not_applicable",sourceFamily:"unknown",materialDelta:"Synthetic manual content only; no asserted economic confirmation."},
 consideredHistoryKeys:historyRefs.map((r:typeof sourceRefs[number])=>r.key),
 references:[sourceRefs[0],...(historyRefs.length?[historyRefs[0]]:[]),...(target?[ref("target_review",target.text,target.sha256)]:[])],counterEvidenceRefs:[],
 coverage:"bounded_omission",coverageRationale:"Only the bounded server-selected evidence was supplied and reviewed in this simulated fixture."},
 checks:{sourceEntailment:"PASS",issuerAssociation:"PASS",eventIdentity:"PASS",periodRoleVintage:"PASS",coverageCounterEvidence:"PASS",pointInTime:"PASS",injectionIsolation:"PASS",protectedAuthority:"PASS"}}};
}
export async function approveFixture(id:string){
 const engine=await import("../src/server/safe-edit/engine"),v=engine.adminPreview(id);
 engine.approve(id,"simulated-dashboard-reviewer",v.afterHash,v.reviewedEvidenceDigest);
}

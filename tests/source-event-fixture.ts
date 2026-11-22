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
/** WP2 synthetic fixture writer: canonical Source/Review/Claim records are written
 * through the kernel route (server plan + witness + applyCanonicalStep), never the
 * generic Safe Edit route, which OD-04+OD-06 refuse in every mode. The plan
 * capability is claimed in an isolated module registry that is reset afterwards,
 * so the test's own canonical modules can claim it normally. `legacy:true` then
 * removes only the WP2 kernel rows, simulating history written before WP2. */
export async function kernelCanonicalCreate(entries:{kind:"source_intake"|"canonical_review"|"structured_claim";path:string;content:string}[],actor:string,opts:{legacy?:boolean;reason?:string}={}){
 const {vi}=await import("vitest");
 const {createHash}=await import("node:crypto");
 const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
 vi.resetModules();
 const admission=await import("../src/server/safe-edit/admission"),engine=await import("../src/server/safe-edit/engine");
 const members=entries.map(e=>({kind:e.kind,operationId:"ICW-"+sha([e.kind,e.path,sha(e.content)].join("\n")).slice(0,32),path:e.path,change:{kind:"create" as const,content:e.content}}));
 const handle=admission.claimCanonicalPlanCapability("writeback")({intakeId:null,actor,recipeVersion:"TEST-SYNTHETIC-FIXTURE",members});
 const results:{operationId:string;path:string;previewToken:string;beforeHash:string;afterHash:string}[]=[];
 for(const m of members){
  const fn=m.kind==="source_intake"?engine.previewCanonicalSource:m.kind==="canonical_review"?engine.previewCanonicalReview:engine.previewCanonicalClaim;
  const p=fn(handle,{operationId:m.operationId,path:m.path,reason:opts.reason??"WP2 synthetic canonical fixture",change:m.change},actor);
  if(!p.previewToken)throw Error("fixture_preview_token_missing");
  engine.applyCanonicalStep({operationId:p.operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor);
  results.push({operationId:p.operationId,path:p.path,previewToken:p.previewToken,beforeHash:p.beforeHash,afterHash:p.afterHash});
 }
 if(opts.legacy){
  const d=(await import("../src/server/db")).db();
  for(const m of members){const w=admission.witnessFor(m.operationId);if(!w)continue;
   d.prepare("DELETE FROM witness_consumption WHERE witness_id=?").run(w.witness_id);d.prepare("DELETE FROM canonical_witness WHERE witness_id=?").run(w.witness_id);
   d.prepare("DELETE FROM canonical_plan WHERE plan_id=? AND NOT EXISTS(SELECT 1 FROM canonical_witness WHERE plan_id=?)").run(w.plan_id,w.plan_id);}
 }
 vi.resetModules();
 return results;
}
/** WP2 synthetic PRE-WP2 HISTORY fixture: one written generic journal row for a
 * canonical path, exactly as the pre-WP2 generic Safe Edit route recorded it
 * (row + preview/write_started/written events + receipt + bytes + index). The
 * WP2 engine refuses to produce such rows (OD-04+OD-06); readers must still read
 * them as legacy history. `after` defaults to a marked append at the end. */
export async function legacyJournalWrite(path:string,operationId:string,actor:string,
 change:{kind:"append";heading:string;content:string;date:string}|{kind:"replace";oldText:string;newText:string}){
 const fs=await import("node:fs"),nodePath=await import("node:path"),{createHash}=await import("node:crypto");
 const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
 const {env}=await import("../src/server/env"),{db}=await import("../src/server/db"),{reindexPath}=await import("../src/server/vault/indexer");
 const abs=nodePath.join(env.vaultDir,path),before=fs.readFileSync(abs,"utf8");
 const after=change.kind==="append"?`${before}\n### ${change.date} · ${operationId}\n\n${change.content}\n\n<!-- safe-edit:${operationId} -->\n`:before.replace(change.oldText,change.newText);
 const payload={operationId,path,reason:"Synthetic pre-WP2 legacy history fixture",change};
 const t0=new Date(Date.now()-2000).toISOString(),t1=new Date().toISOString();
 const receipt={operationId,path,beforeHash:sha(before),afterHash:sha(after),writtenAt:t1,write:"written",readback:"verified",reindex:"verified",
  sync:"unverified",remoteSync:"unverified",mobileSync:"unverified",backup:`safe-edit-backups/${operationId}.md`,approval:null,review:null};
 fs.writeFileSync(abs,after);reindexPath(path);
 const d=db();
 d.prepare("INSERT INTO safe_edit_operations VALUES(?,?,?,?,?,?,?,?,?,'written',NULL,?)").run(operationId,actor,JSON.stringify(payload),before,after,sha(before),sha(after),sha(operationId),0,JSON.stringify(receipt));
 const ev=d.prepare("INSERT INTO safe_edit_events VALUES(?,?,?,?,?)");
 ev.run(t0,operationId,actor,"preview",JSON.stringify({path,beforeHash:sha(before),afterHash:sha(after),reason:payload.reason}));
 ev.run(t1,operationId,actor,"write_started",JSON.stringify({path,beforeHash:sha(before),afterHash:sha(after)}));
 ev.run(t1,operationId,actor,"written",JSON.stringify({path,beforeHash:sha(before),afterHash:sha(after)}));
 return {operationId,before,after};
}

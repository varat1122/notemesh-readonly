import {describe,it,expect} from "vitest";
import {
  buildCoordinatedWriteback,reconcileCoordinatedWriteback,
  type CoordinatorInput,type CoordinatedStage,type TrustedEditStatus,
} from "./investment-writeback-coordination";

const makeInput=():CoordinatorInput=>({
  planId:"IN-0123456789ABCDEF",inputFormat:"text",rawAttachmentVerified:false,
  eventDate:"2026-10-14",duplicateCandidate:false,duplicateAdjudicated:false,
  sourceIndependenceVerified:false,
  routes:[
    {kind:"raw_input",action:"candidate_create",path:"00_Inbox/ChatGPT/Investment Intake - IN-0123456789ABCDEF.md"},
    {kind:"research_review",action:"candidate_create",path:"10_Knowledge/Company Research/Investment Review - MDB - IN-0123456789ABCDEF.md"},
    {kind:"company_timeline_candidate",action:"candidate_append_after_review",path:"08_Daily_Weekly/Research Indexes/Company Evolution - MDB.md"},
  ],
});
const receipt=(s:CoordinatedStage,overrides:Partial<TrustedEditStatus>={}):TrustedEditStatus=>({
  operationId:s.operationId,path:s.path!,status:"written",afterHash:"a".repeat(64),
  receipt:{path:s.path!,afterHash:"a".repeat(64),write:"written",readback:"verified",reindex:"verified",
    remoteSync:"unverified",mobileSync:"unverified"},
  ...overrides,
});

describe("P1a coordinated writeback plan (never applies edits)",()=>{
  it("uses stable bounded Safe Edit IDs with source before separately attributed research",()=>{
    const a=buildCoordinatedWriteback(makeInput());
    const b=buildCoordinatedWriteback(makeInput());
    expect(a).toEqual(b);
    expect(a.steps.map(x=>x.kind)).toEqual(["raw_input","research_review","company_timeline_candidate"]);
    expect(a.steps[1].dependsOn).toEqual([a.steps[0].operationId]);
    expect(a.steps[2].dependsOn).toEqual([a.steps[0].operationId,a.steps[1].operationId]);
    for(const x of a.steps)expect(x.operationId).toMatch(/^[a-z0-9_-]{8,80}$/);
    expect(a.status).toBe("read_only_coordination_not_written");
    expect(a.sourceAndReviewSeparate).toBe(true);
    expect(a.protectedThesisWrites).toBe(false);
  });
  it("rejects arbitrary caller-selected plan IDs and incomplete dual record routing",()=>{
    expect(()=>buildCoordinatedWriteback({...makeInput(),planId:"../05_Thesis"})).toThrow();
    expect(()=>buildCoordinatedWriteback({...makeInput(),routes:[makeInput().routes[0]]})).toThrow();
  });
  it("holds screenshot-derived raw input until matching original user bytes have readback",()=>{
    const p=buildCoordinatedWriteback({...makeInput(),inputFormat:"screenshot"});
    expect(p.steps[0].action).toBe("hold");
    expect(p.steps[0].holdReasons).toContain("original_user_binary_not_sha_readback_verified");
    expect(reconcileCoordinatedWriteback(p,[]).map(x=>x.state))
      .toEqual(["hold","awaiting_dependency","hold"]);
    const verified=buildCoordinatedWriteback({...makeInput(),inputFormat:"screenshot",rawAttachmentVerified:true});
    expect(verified.steps[0].action).toBe("preview_create");
  });
  it("allows only raw text preview first and defers review until local verified receipt",()=>{
    const p=buildCoordinatedWriteback(makeInput());
    expect(reconcileCoordinatedWriteback(p,[]).map(x=>x.state))
      .toEqual(["ready_for_preview","awaiting_dependency","hold"]);
    const preview:TrustedEditStatus={...receipt(p.steps[0]),status:"preview",receipt:null};
    expect(reconcileCoordinatedWriteback(p,[preview]).map(x=>x.state))
      .toEqual(["awaiting_approval","awaiting_dependency","hold"]);
  });
  it("reuses durable actor-scoped receipts on retry without blindly recreating notes",()=>{
    const p=buildCoordinatedWriteback(makeInput());
    const raw=receipt(p.steps[0]);
    const step=reconcileCoordinatedWriteback(p,[raw]);
    expect(step.map(x=>x.state)).toEqual(["applied_verified","ready_for_preview","hold"]);
    const research=receipt(p.steps[1]);
    expect(reconcileCoordinatedWriteback(p,[raw,research]).map(x=>x.state))
      .toEqual(["applied_verified","applied_verified","hold"]);
  });
  it("detects partial published write and requires manual repair, no replay",()=>{
    const p=buildCoordinatedWriteback(makeInput());
    const partial=receipt(p.steps[0],{status:"writing"});
    expect(reconcileCoordinatedWriteback(p,[partial]).map(x=>x.state))
      .toEqual(["repair_required","awaiting_dependency","hold"]);
    const unindexed=receipt(p.steps[0],{receipt:{
      path:p.steps[0].path!,write:"written",readback:"verified",reindex:"unverified"}});
    expect(reconcileCoordinatedWriteback(p,[unindexed])[0].state).toBe("repair_required");
  });
  it("rejects mismatched paths, hashes, duplicate receipts and out-of-order writes",()=>{
    const p=buildCoordinatedWriteback(makeInput());
    const raw=receipt(p.steps[0]);
    expect(reconcileCoordinatedWriteback(p,[receipt(p.steps[0],{path:"05_Thesis/NVDA - Current Thesis.md"})])[0].state)
      .toBe("conflict");
    expect(reconcileCoordinatedWriteback(p,[raw,raw])[0].state).toBe("conflict");
    expect(reconcileCoordinatedWriteback(p,[receipt(p.steps[0],{receipt:{
      path:p.steps[0].path!,afterHash:"b".repeat(64),write:"written",readback:"verified",reindex:"verified"}})])[0].state)
      .toBe("conflict");
    expect(reconcileCoordinatedWriteback(p,[receipt(p.steps[1])])[1].state).toBe("conflict");
  });
  it("never promotes duplicate candidate, uncertain event date or unverified source to timeline writes",()=>{
    const p=buildCoordinatedWriteback({...makeInput(),eventDate:null,duplicateCandidate:true});
    expect(p.steps[2].holdReasons).toEqual(expect.arrayContaining([
      "economic_event_date_unknown",
      "exact_claim_duplicate_candidate_link_dont_recreate",
      "historical_event_and_source_family_dedup_not_adjudicated",
      "original_source_not_independently_verified",
    ]));
    const statuses=p.steps.map(s=>receipt(s));
    expect(reconcileCoordinatedWriteback(p,statuses)[2].state).toBe("conflict");
  });
  it("inspects a pre-existing raw path rather than treating mere existence as idempotent success",()=>{
    const input=makeInput();
    input.routes[0]={...input.routes[0],action:"link_existing_or_hold"};
    const p=buildCoordinatedWriteback(input);
    expect(reconcileCoordinatedWriteback(p,[]).map(x=>x.state))
      .toEqual(["inspect_existing","awaiting_dependency","hold"]);
  });
});

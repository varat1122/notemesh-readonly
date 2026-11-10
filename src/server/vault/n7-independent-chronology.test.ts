import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import type {SupplyChainCandidate,SupplyChainEvidenceRef,SupplyChainPreview} from "./supply-chain-intelligence";

// Independent IOS-ORCH-RI-001 / N7 semantic and chronology probes. All issuers,
// text, persistence receipts and clocks below are disposable synthetic data.
let root:string,vault:string,sequence:number;
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const cutoff="2026-11-05T00:00:00Z",oldTime="2026-11-02T12:00:00.000Z";
const now="2026-11-10T12:00:00.000Z";
const direct="MODULECO supplies packaged modules to SYSTEMCO; the commercial volume is not disclosed.";
const actor="oauth:n7-independent-synthetic";
type Saved=SupplyChainEvidenceRef&{raw:string;text:string;published:string|null;event:string|null};

beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ios-ri001-n7-independent-")));
  vault=path.join(root,"vault");sequence=0;
  for(const folder of ["00_Inbox/ChatGPT","10_Knowledge/Company Research"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  vi.stubEnv("DATA_DIR",root);vi.stubEnv("ENCRYPTION_KEY",Buffer.alloc(32,11).toString("base64"));
  vi.stubEnv("SAFE_EDIT_ENABLED","1");vi.stubEnv("SAFE_EDIT_SINGLE_WRITER","1");
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);vi.resetModules();
  await add("01_Companies/MODULECO.md","# Synthetic MODULECO\n");
  await add("01_Companies/SYSTEMCO.md","# Synthetic SYSTEMCO\n");
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
async function add(relative:string,text:string){
  const full=path.join(vault,relative);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,text);
  (await import("./indexer")).reindexPath(relative);
}
async function persist(kind:"source_intake"|"canonical_review"|"structured_claim",relative:string,content:string,writtenAt=oldTime,previewAt=writtenAt){
  const {preview,apply}=await import("../safe-edit/engine");
  const operationId="ICW-"+sha([kind,relative,sha(content)].join("\n")).slice(0,32);
  vi.setSystemTime(previewAt);
  const p=preview({operationId,path:relative,reason:"Independent N7 synthetic persistence fixture",change:{kind:"create",content}},actor);
  vi.setSystemTime(writtenAt);
  expect(apply({operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor).status).toBe("written");
  vi.setSystemTime(now);return operationId;
}
async function saved(text=direct,options:{published?:string|null;event?:string|null;writtenAt?:string;previewAt?:string}={}):Promise<Saved>{
  const intakeId="IN-"+sha(String(++sequence)+text).slice(0,16).toUpperCase();
  const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${intakeId}.md`;
  const published=options.published===undefined?"2026-11-01":options.published;
  const event=options.event===undefined?"2026-10-31":options.event;
  const raw=["---","type: investment_source_intake",`intake_id: ${intakeId}`,"source_type: user_supplied",
    "verification: not_reverified","source_kind: issuer_release","attributed_publisher: Synthetic attributed issuer",
    `source_url: https://example.com/n7-independent-${sequence}`,`source_text_sha256: ${sha(text)}`,
    `event_date: ${JSON.stringify(event)}`,`published_at: ${JSON.stringify(published)}`,"---","",
    `Source token: InvestmentIntake${intakeId.slice(3)}`,"","## User-supplied original language text","",
    "```text",text,"```","","## Evidence boundary","Synthetic unverified attribution, not authenticated fact.",""].join("\n");
  await persist("source_intake",sourcePath,raw,options.writtenAt,options.previewAt);
  return {intakeId,sourcePath,sourceNoteSha256:sha(raw),quote:text,raw,text,published,event};
}
function ref(s:Saved):SupplyChainEvidenceRef{
  return {intakeId:s.intakeId,sourcePath:s.sourcePath,sourceNoteSha256:s.sourceNoteSha256,quote:s.quote};
}
function candidate(source:SupplyChainEvidenceRef,overrides:Partial<SupplyChainCandidate>={}):SupplyChainCandidate{
  return {localKey:"module_system",subject:"MODULECO",object:"SYSTEMCO",predicate:"supplier_to",direction:"subject_to_object",
    assertionOrigin:"source_statement",lifecycle:"active",sourceRefs:[source],counterEvidenceRefs:[],relatedEvidenceRefs:[],
    mechanism:"Caller proposes a supply relationship; no economic adjudication has occurred.",
    confidenceBasis:"Exact attributed text only; source authenticity is unknown.",invalidation:"A correction or commercial discontinuation requires review.",
    ambiguity:null,validity:{from:null,to:null},valueChain:{subjectStage:"components",objectStage:"systems"},
    transmission:[{stage:"revenue_conversion",mechanism:"Shipment, acceptance and price must be evidenced before revenue conversion.",magnitude:null}],...overrides};
}
async function preview(candidates:SupplyChainCandidate[]=[],asOf:string|null=cutoff,issuers=["MODULECO","SYSTEMCO"]){
  return (await import("./supply-chain-intelligence")).previewSupplyChainRelationships({
    question:"Evaluate MODULECO and SYSTEMCO supply chain evidence and chronology.",issuers,candidates,...asOf?{asOf}:{}});
}
function noAuthority(out:SupplyChainPreview){
  expect(out).toMatchObject({writesPerformed:false,sourceAuthenticityVerified:false,semanticEntailment:"not_assessed",
    independentEvidenceIncrement:0,economicRelationshipVerified:false,comparatorEligible:false,canAutoWrite:false,canWriteProtectedNotes:false});
  for(const c of out.candidates)expect(c).toMatchObject({semanticEntailment:"not_assessed",effectiveExposureMagnitude:"unknown",independentEvidenceIncrement:0});
}
function redacted(out:SupplyChainPreview,code:string){
  expect(out.candidates[0]).toMatchObject({status:"hold",proposal:null,bindings:[],subjectHubPath:null,objectHubPath:null,declaredTemporalStatus:"unknown"});
  expect(out.candidates[0].issues).toContain(code);noAuthority(out);
}
async function review(source:Saved,writtenAt=oldTime){
  const relative=`10_Knowledge/Company Research/Investment Review - MODULECO - ${source.intakeId}.md`;
  const raw=["---","type: investment_research_review","review_scope: company",`intake_id: ${source.intakeId}`,
    'company_hubs: ["01_Companies/MODULECO.md", "01_Companies/SYSTEMCO.md"]',
    `original_source_path: ${JSON.stringify(source.sourcePath)}`,"source_type: chatgpt_analysis","verification: not_reverified",
    `event_date: ${JSON.stringify(source.event)}`,`published_at: ${JSON.stringify(source.published)}`,"---","",
    `Source token: InvestmentIntake${source.intakeId.slice(3)}`,`[[${source.sourcePath.slice(0,-3)}]]`,"## Research analysis",
    "Synthetic unverified interpretation only; no quantitative exposure adjudication.",""].join("\n");
  await persist("canonical_review",relative,raw,writtenAt);return {path:relative,noteSha256:sha(raw)};
}

describe("Independent N7 semantic and point-in-time assessment",()=>{
  it("keeps a direct attributed supplier statement useful but unverified and makes no writes",async()=>{
    const s=await saved(),r=ref(s),database=(await import("../db")).db();
    const before=database.prepare("SELECT total_changes() AS n").get();
    const out=await preview([candidate(r)]);
    expect(out.candidates[0]).toMatchObject({status:"pending_semantic_review",issues:[],proposal:{proposalOrigin:"caller_supplied_reasoning"}});
    expect(out.candidates[0].bindings[0]).toMatchObject({sourcePath:s.sourcePath,quote:direct,recordedAt:oldTime,occurrenceCount:1});
    expect(out.sourceCatalog[0]).toMatchObject({eventDate:"2026-10-31",publicationDate:"2026-11-01",recordedAt:oldTime});
    expect(database.prepare("SELECT total_changes() AS n").get()).toEqual(before);noAuthority(out);
    expect(fs.readFileSync(path.join(vault,s.sourcePath),"utf8")).toBe(s.raw);
  });
  it("holds declared co-mention as a supplier edge while preserving eligible evidence for review",async()=>{
    const s=await saved("MODULECO and SYSTEMCO appeared in a sector list; the source states no supply agreement.");
    const out=await preview([candidate(ref(s),{assertionOrigin:"co_mention"})]);
    expect(out.candidates[0]).toMatchObject({status:"hold",issues:["n7_co_mention_not_relationship_evidence"]});
    expect(out.candidates[0].proposal).not.toBeNull();expect(out.candidates[0].bindings).toHaveLength(1);noAuthority(out);
  });
  it.each(["partner_of","technology_enables","potential_beneficiary_of"] as const)("never converts %s or design-win reasoning into recognized earnings or FCF",async predicate=>{
    const s=await saved("MODULECO and SYSTEMCO announced a design qualification partnership. Orders, delivery, prices and cash collection are undisclosed.");
    const out=await preview([candidate(ref(s),{predicate,assertionOrigin:"analyst_interpretation",transmission:[
      {stage:"revenue_conversion",mechanism:"Analyst proposes that qualification could support future orders.",magnitude:"USD 50 million"},
      {stage:"ocf_fcf_roic",mechanism:"Analyst proposes cash conversion, but working capital and capex are not established.",magnitude:"USD 20 million"}
    ]})]);
    expect(out.candidates[0].status).toBe("hypothesis_pending_review");
    expect(out.candidates[0].proposal?.transmission[1].proposedMagnitude).toBe("USD 20 million");noAuthority(out);
  });
  it("does not pretend exact quote matching adjudicates a deliberately reversed direction",async()=>{
    const s=await saved();
    const out=await preview([candidate(ref(s),{subject:"SYSTEMCO",object:"MODULECO"})]);
    expect(out.candidates[0].status).toBe("pending_semantic_review");
    expect(out.candidates[0].proposal).toMatchObject({subject:"SYSTEMCO",object:"MODULECO",proposalOrigin:"caller_supplied_reasoning"});
    noAuthority(out);
  });
  it("does not convert a customer's capex decline into an equally sized supplier revenue effect",async()=>{
    const s=await saved("SYSTEMCO lowered planned capex by 10%; MODULECO was discussed as one possible vendor without a disclosed revenue share.");
    const out=await preview([candidate(ref(s),{assertionOrigin:"analyst_interpretation",transmission:[{
      stage:"revenue_conversion",mechanism:"Caller assumes MODULECO revenue follows SYSTEMCO capex one for one; this is unverified.",magnitude:"-10%"} ]})]);
    expect(out.candidates[0].proposal?.transmission[0].proposedMagnitude).toBe("-10%");noAuthority(out);
  });
  it.each(["contradicted","retracted"] as const)("retains support, counter-evidence and lifecycle links for a declared %s relationship",async lifecycle=>{
    const support=await saved(),counter=await saved("SYSTEMCO denied purchasing MODULECO modules; the old relationship statement is disputed.");
    const out=await preview([candidate(ref(support),{lifecycle,counterEvidenceRefs:[ref(counter)],relatedEvidenceRefs:[ref(counter)]})]);
    expect(out.candidates[0]).toMatchObject({status:"hold",issues:[`n7_declared_${lifecycle}_relationship_hold`]});
    expect(out.candidates[0].bindings.map(b=>b.role)).toEqual(["support","counter","lifecycle"]);
    expect(out.candidates[0].proposal).not.toBeNull();noAuthority(out);
  });
  it("redacts an entire candidate that references a future correction, but retains independently eligible older Source text",async()=>{
    const old=await saved(),future=await saved("FUTURE_CORRECTION_SECRET: SYSTEMCO retracted the MODULECO relationship statement.",
      {published:"2026-11-06",writtenAt:"2026-11-07T00:00:00.000Z"});
    const c=candidate(ref(old),{lifecycle:"correction",relatedEvidenceRefs:[ref(future)],mechanism:"FUTURE_REASONING_SECRET is derived from the later correction."});
    const out=await preview([c]);redacted(out,"n7_recorded_after_cutoff");
    expect(out.sourceCatalog.map(x=>x.sourcePath)).toContain(old.sourcePath);
    expect(JSON.stringify(out)).not.toContain(future.sourcePath);expect(JSON.stringify(out)).not.toContain("FUTURE_");
    const earlierOnly=await preview([candidate(ref(old))]);
    expect(earlierOnly.candidates[0].status).toBe("pending_semantic_review");
    expect(earlierOnly.sourceCatalog.map(x=>x.sourcePath)).not.toContain(future.sourcePath);noAuthority(earlierOnly);
  });
  it("does not use an earlier event date as proof of public availability",async()=>{
    const s=await saved("FUTURE_PUBLICATION_SECRET: MODULECO and SYSTEMCO have an attributed supply arrangement.",
      {event:"2026-10-01",published:"2026-11-06"});
    const out=await preview([candidate(ref(s))]);redacted(out,"n7_publication_not_available_by_cutoff");
    expect(out.sourceCatalog).toEqual([]);expect(JSON.stringify(out)).not.toContain("FUTURE_PUBLICATION_SECRET");
  });
  it("does not use publication, event date or file mtime instead of the later server recording time",async()=>{
    const s=await saved("LATE_RECORDING_SECRET: MODULECO supplies SYSTEMCO, according to the submitted historical account.",
      {writtenAt:"2026-11-06T01:00:00.000Z"});
    fs.utimesSync(path.join(vault,s.sourcePath),new Date("2020-01-01"),new Date("2020-01-01"));
    const out=await preview([candidate(ref(s))]);redacted(out,"n7_recorded_after_cutoff");
    expect(out.sourceCatalog).toEqual([]);expect(JSON.stringify(out)).not.toContain(s.sourcePath);
  });
  it("uses actual written time even when a valid preview was issued before the cutoff",async()=>{
    const s=await saved(direct,{previewAt:"2026-11-04T23:59:59.000Z",writtenAt:"2026-11-05T00:00:01.000Z"});
    const out=await preview([candidate(ref(s))]);redacted(out,"n7_recorded_after_cutoff");
    const after=await preview([candidate(ref(s))],"2026-11-05T00:00:01Z");
    expect(after.candidates[0].status).toBe("pending_semantic_review");
    expect(after.candidates[0].bindings[0].recordedAt).toBe("2026-11-05T00:00:01.000Z");
  });
  it("treats a date-only publication conservatively across timezones and compares explicit offsets as instants",async()=>{
    const s=await saved(direct,{published:"2026-11-05"});
    redacted(await preview([candidate(ref(s))],"2026-11-06T13:59:59Z"),"n7_publication_not_available_by_cutoff");
    const utc=await preview([candidate(ref(s))],"2026-11-06T14:00:00Z");
    const offset=await preview([candidate(ref(s))],"2026-11-06T21:00:00+07:00");
    expect(utc.candidates[0].status).toBe("pending_semantic_review");expect(utc.candidates).toEqual(offset.candidates);
  });
  it("keeps missing publication unknown instead of substituting the event or recording date",async()=>{
    const s=await saved(direct,{published:null,event:"2026-10-01"});
    const out=await preview([candidate(ref(s))]);
    expect(out.candidates[0].status).toBe("pending_semantic_review");
    expect(out.sourceCatalog[0]).toMatchObject({publicationDate:null,eventDate:"2026-10-01",recordedAt:oldTime});
    expect(out.viewMode).toBe("availability_bounded_current_index");
    expect(out.coverage.limitations.join(" ")).toContain("Unknown publication remains unknown");noAuthority(out);
  });
  it("separates prospective validity from already recorded evidence and does not imply active realized exposure",async()=>{
    const s=await saved("MODULECO and SYSTEMCO announced that a supply program may begin in January 2027; no current sales are claimed.");
    const out=await preview([candidate(ref(s),{validity:{from:"2027-01-01",to:null}})]);
    expect(out.candidates[0]).toMatchObject({status:"pending_semantic_review",declaredTemporalStatus:"prospective"});noAuthority(out);
  });
  it("redacts a future estimate vintage even when the underlying Source was already recorded",async()=>{
    const s=await saved();
    const out=await preview([candidate(ref(s),{estimateVintage:"2026-11-06",mechanism:"FUTURE_ESTIMATE_SECRET"})]);
    redacted(out,"n7_estimate_vintage_after_cutoff");expect(JSON.stringify(out)).not.toContain("FUTURE_ESTIMATE_SECRET");
  });
  it("does not count repeated same-origin quotes as additional independent evidence",async()=>{
    const s=await saved(direct+"\n"+direct),r={...ref(s),quote:direct};
    const out=await preview([candidate(r,{sourceRefs:[r,r]})]);
    expect(out.candidates[0].status).toBe("pending_semantic_review");
    expect(out.candidates[0].bindings.every(b=>b.occurrenceCount===2&&b.uniqueSpan===null)).toBe(true);noAuthority(out);
  });
  it("does not infer a DR underlying identity or accept an alias collision",async()=>{
    const s=await saved();
    const missing=await preview([candidate(ref(s),{subject:"TH:MODULE80"})],cutoff,["TH:MODULE80","SYSTEMCO"]);
    redacted(missing,"n7_endpoint_identity_hold");
    await add("01_Companies/OTHERCO.md","---\naliases: [MODULECO]\n---\n# Synthetic OTHERCO\n");
    const collision=await preview([candidate(ref(s))]);redacted(collision,"n7_endpoint_identity_hold");
  });
  it("withholds a future persisted Claim even though its exact Source was available before the cutoff",async()=>{
    const s=await saved("MODULECO planned 100 modules for SYSTEMCO in 2027; this is an unverified source statement.");
    const {planClaimNotes}=await import("./canonical-claims");
    const {splitFrontmatter}=await import("./markdown");
    const notes=planClaimNotes({domain:"company",entities:["MODULECO"],topic:"Synthetic planned modules",inputFormat:"text",sourceKind:"issuer_release",
      sourceUrl:String(splitFrontmatter(s.raw).data.source_url),extractedText:s.text,claims:[{entity:"MODULECO",metric:"planned modules",period:"2027",
        value:"100",unit:"modules",statement:s.text,evidenceClass:"unverified_claim",verification:"unverified",
        sourceLocator:"Synthetic received text",sourceExcerpt:s.text}]},s.intakeId,s.sourcePath,s.raw);
    expect(notes).toHaveLength(1);expect(notes[0].issues).toEqual([]);
    await persist("structured_claim",notes[0].path,notes[0].content,"2026-11-06T12:00:00.000Z");
    const sourceRef={...ref(s),claimRef:{path:notes[0].path,noteSha256:sha(notes[0].content)}};
    const present=await preview([candidate(sourceRef)],null);
    expect(present.candidates[0].status).toBe("pending_semantic_review");
    expect(present.candidates[0].bindings[0].claim?.recordedAt).toBe("2026-11-06T12:00:00.000Z");
    const out=await preview([candidate(sourceRef)]);redacted(out,"n7_recorded_after_cutoff");
    expect(JSON.stringify(out)).not.toContain(notes[0].path);expect(out.sourceCatalog.map(x=>x.sourcePath)).toContain(s.sourcePath);
  });
  it("withholds a Source with missing receipt time rather than using its unchanged file bytes or metadata",async()=>{
    const s=await saved(),database=(await import("../db")).db();
    database.prepare("UPDATE safe_edit_operations SET receipt=json_remove(receipt,'$.writtenAt') WHERE json_extract(payload,'$.path')=?").run(s.sourcePath);
    const out=await preview([candidate(ref(s))]);redacted(out,"n7_retrieval_operational_hold");
    expect(out.sourceCatalog).toEqual([]);expect(JSON.stringify(out)).not.toContain(s.sourcePath);
    expect(fs.readFileSync(path.join(vault,s.sourcePath),"utf8")).toBe(s.raw);
  });
  it("withholds a future paired Review without leaking its path or using its origin time for current bytes",async()=>{
    const s=await saved(),futureReview=await review(s,"2026-11-06T12:00:00.000Z");
    const current=await preview([candidate({...ref(s),reviewRef:futureReview})],null);
    expect(current.candidates[0].status).toBe("pending_semantic_review");
    // Bound Sources cannot fall back to standalone scope. The unavailable
    // Review cannot lend its issuer scope, so this earlier guard may fire.
    const out=await preview([candidate({...ref(s),reviewRef:futureReview})]);redacted(out,"n7_reference_outside_endpoint_scope");
    expect(JSON.stringify(out)).not.toContain(futureReview.path);
    expect(out.sourceCatalog.map(x=>x.sourcePath)).toContain(s.sourcePath);
  });
  it("holds appended Review current bytes under asOf rather than backdating them to creation",async()=>{
    const s=await saved(),oldReview=await review(s),engine=await import("../safe-edit/engine");
    const prior=await preview([candidate({...ref(s),reviewRef:oldReview})]);
    expect(prior.candidates[0].status).toBe("pending_semantic_review");
    vi.setSystemTime("2026-11-06T12:00:00.000Z");
    const operationId="ILK-N7-INDEPENDENT-APPEND";
    const p=engine.preview({operationId,path:oldReview.path,reason:"N7 synthetic future Review append",change:{
      kind:"append",heading:"Research analysis",date:"2026-11-06",content:"FUTURE_APPEND_SECRET changes the analyst interpretation, not verified economics."}},actor);
    expect(engine.apply({operationId,previewToken:p.previewToken,expectedHash:p.beforeHash},actor).status).toBe("written");
    vi.setSystemTime(now);
    const current={path:oldReview.path,noteSha256:sha(fs.readFileSync(path.join(vault,oldReview.path),"utf8"))};
    const out=await preview([candidate({...ref(s),reviewRef:current})]);redacted(out,"n7_reference_outside_endpoint_scope");
    expect(JSON.stringify(out)).not.toContain("FUTURE_APPEND_SECRET");expect(JSON.stringify(out)).not.toContain(current.path);
    const present=await preview([candidate({...ref(s),reviewRef:current})],null);
    expect(present.candidates[0].status).toBe("pending_semantic_review");
    expect(present.candidates[0].bindings[0].review?.recordedAt).toBeNull();noAuthority(present);
  });
});

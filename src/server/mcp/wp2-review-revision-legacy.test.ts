/** WP2 synthetic oracles P07–P10 / N11, N20 (F-04): OFF-mode dedicated ICR route after the
 * migration epoch, legacy adoption and base_tier inheritance at revision depth 1, 2 and 3.
 * "Legacy" history is a SYNTHETIC pre-WP2 fixture: identical journal rows with the WP2 kernel
 * rows removed (the tables did not exist before WP2). Dashboard approval is simulated.
 * Authority path only: SYNC_DOUBLE_NOT_PERSISTENCE_PROOF. */
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {createHash} from "node:crypto";
import type {WritebackInput} from "../vault/investment-writeback-router";
import type {CanonicalRevisionInput} from "../safe-edit/canonical-review-revision-pilot";
vi.mock("../safe-edit/sync",()=>({withPausedSync:async<T>(run:()=>T)=>run()})); // SYNC_DOUBLE_NOT_PERSISTENCE_PROOF
vi.mock("~/server/auth",()=>({runAuthMigrations:async()=>{},auth:{api:{getSession:async()=>({user:{id:"synthetic-dashboard-reviewer"}})}}}));
import {assessed} from "../../../tests/source-event-fixture";
const actor="oauth:wp2-legacy-revision-fixture",sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
let root:string,vault:string;
const researchReview={headlineTh:"TESTA อัปเดตคู่มือที่ยังต้องตรวจต้นฉบับ",translationTh:"TESTA ออกคำชี้แจงเกี่ยวกับคู่มือสำหรับการใช้งานระบบสมมติ",
 whatChangedTh:"เป็นการกล่าวอ้างด้านเอกสารคู่มือ ไม่ใช่รายได้หรือกำไรที่เกิดขึ้นจริง",mechanismTh:"ยังไม่มีหลักฐานแสดงว่ารายละเอียดคู่มือมีผลต่อคำสั่งซื้อหรือการรับรู้รายได้",
 thesisImplicationTh:"คงมุมมองเดิม ไม่เปลี่ยน Thesis หรือ Portfolio จากรายละเอียดเอกสาร",counterEvidenceTh:"ข้อความส่งต่ออาจอ้างถึงรายละเอียดที่มีในเอกสารเดิม ต้องตรวจต้นฉบับ",
 requiredEvidenceTh:"ตรวจเอกสารที่ออกโดยผู้ผลิตและวันที่เผยแพร่ก่อนยกระดับข้อกล่าวอ้าง"};
const original:WritebackInput={domain:"company",entities:["TESTA"],topic:"Synthetic TESTA ordinary manual",inputFormat:"text",
 sourceKind:"news_media",sourceLanguage:"en",sourceChannel:"synthetic",contentTypes:["other"],
 sourceChat:"WP2 legacy revision fixture",sourceUrl:"https://example.org/testa/manual",eventDate:"2026-10-01",publicationDate:"2026-10-01",
 originalDocumentAccess:"not_obtained",extractedText:"SYNTHETIC: TESTA issued an ordinary product manual on October 1.",researchReview};
const repost=(n:number):WritebackInput=>({...original,sourceKind:"social_repost",sourceUrl:null,eventDate:null,publicationDate:null,
 extractedText:`SYNTHETIC forwarded detail ${n}: the manual appendix provides an additional installation note.`});
beforeEach(async()=>{vi.resetModules();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"wp2-legacy-off-")));vault=path.join(root,"vault");
 Object.assign(process.env,{DATA_DIR:root,ENCRYPTION_KEY:Buffer.alloc(32,39).toString("base64"),SAFE_EDIT_ENABLED:"1",SAFE_EDIT_SINGLE_WRITER:"1"});
 for(const f of ["00_Inbox/ChatGPT","10_Knowledge/Company Research","01_Companies","05_Thesis"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"01_Companies/TESTA.md"),"# TESTA\n");fs.writeFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"# protected fixture\n");
 const ix=await import("../vault/indexer");ix.reindexPath("01_Companies/TESTA.md");ix.reindexPath("05_Thesis/TESTA - Current Thesis.md");
});
afterEach(async()=>{expect(fs.readFileSync(path.join(vault,"05_Thesis/TESTA - Current Thesis.md"),"utf8")).toBe("# protected fixture\n");
 (await import("../db")).db().close();fs.rmSync(root,{recursive:true,force:true});vi.useRealTimers();
 for(const k of ["DATA_DIR","ENCRYPTION_KEY","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];});
const raw=(p:string)=>fs.readFileSync(path.join(vault,p),"utf8");
function files(dir=vault,b=""):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),b+e.name+"/"):[b+e.name+":"+sha(fs.readFileSync(path.join(dir,e.name)))]).sort();}
async function ledger(){
 const d=(await import("../db")).db(),has=(t:string)=>Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const n=(t:string,w="")=>has(t)?(d.prepare(`SELECT count(*) n FROM ${t} ${w}`).get() as {n:number}).n:0;
 return {raw_file:files(),plan:n("canonical_plan"),witness:n("canonical_witness"),consumption:n("witness_consumption"),receipt:n("safe_edit_operations","WHERE status='written'")};
}
async function save(input:WritebackInput){
 const c=await import("./canonical-writeback"),p=c.prepareCanonicalWriteback(input,actor);
 return c.applyCanonicalWriteback({input,planId:p.planId,authorizations:p.previews.map(t=>({operationId:t.operationId,previewToken:t.previewToken,expectedHash:t.beforeHash}))},actor);
}
/** Synthetic pre-WP2 fixture: drop only the WP2 kernel rows; journal rows, bytes and receipts are untouched. */
async function asPreWp2(ids:string[]){
 const a=await import("../safe-edit/admission"),d=(await import("../db")).db();
 for(const id of ids){const w=a.witnessFor(id);if(!w)continue;d.prepare("DELETE FROM witness_consumption WHERE witness_id=?").run(w.witness_id);d.prepare("DELETE FROM canonical_witness WHERE witness_id=?").run(w.witness_id);}
}
async function revisionInput(reviewPath:string,receiptId:string,sourceStep:{path:string;receiptKey:string},text:string):Promise<CanonicalRevisionInput>{
 const input:CanonicalRevisionInput={existingReview:{path:reviewPath,expectedSha256:sha(raw(reviewPath)),receiptId,relationship:"added_detail",
  comparisonBasis:"Synthetic analyst comparison: this is a low-risk detail to the same manual, without independent issuer verification."},
  entity:"TESTA",reviewDate:"2026-11-12",methodVersion:"TEST-SYNTHETIC-1",
  additionalSources:[{path:sourceStep.path,sha256:sha(raw(sourceStep.path)),receiptId:sourceStep.receiptKey}],
  analystAssessment:{disposition:"PASS",eventRelation:"added_detail",materiality:"low",
   assessment:"The forwarded appendix detail is only a historical Draft annotation and does not assert earnings or financial guidance.",
   counterEvidence:"The original publisher document was not independently read. Same-event identity is an analyst proposal, not a verified fact.",
   requiredEvidence:"Read the real original and confirm the appendix reference before using it in any investment decision.",
   criticIndependence:"not_verified",independentEvidenceIncrement:0},revisionText:text};
 input.sourceEvent=await assessed((await import("../safe-edit/source-event-admission")).revisionEventProposal(input),actor);
 return input;
}
async function revise(input:CanonicalRevisionInput){
 const bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
 const p=bridge.prepareCanonicalReviewRevision(input,actor),view=engine.adminPreview(p.operationId);
 engine.approve(p.operationId,"synthetic-dashboard-reviewer",view.afterHash,"reviewedEvidenceDigest" in view?view.reviewedEvidenceDigest as string:undefined);
 const authorization={operationId:p.operationId,previewToken:p.preview.previewToken!,expectedHash:p.preview.beforeHash};
 return {prepared:p,result:await bridge.applyCanonicalReviewRevision({input,operationId:p.operationId,authorization},actor),authorization};
}

it("P07–P10 + F-04: legacy Review adopted once, then depth 2 and 3 inherit the historical base_tier; readers never uplift to server_witnessed",async()=>{
 const admission=await import("../safe-edit/admission"),reader=await import("../vault/investment-research-context");
 const first=await save(original);expect(first.status).toBe("saved_verified");
 const review=first.steps.find(s=>s.kind==="canonical_review")!,source=first.steps.find(s=>s.kind==="source_intake")!;
 await asPreWp2(first.steps.map(s=>s.receiptKey));
 const originalBytes=raw(review.path);
 // P08 (OD-04 paired OD-06): with generic canonical edits refused in every mode, the
 // dedicated OFF ICR route is usable without any migration epoch; generic append is refused.
 const engine0=await import("../safe-edit/engine"),heading=originalBytes.split("\n").find(l=>l.startsWith("## "))!.slice(3);
 const preLedger=await ledger();
 expect(()=>engine0.preview({operationId:"generic-append-probe-1",path:review.path,reason:"generic canonical append probe",
  change:{kind:"append",heading,content:"probe",date:"2026-11-14"}},actor)).toThrow(/canonical_review_revision_dedicated_route_required/);
 expect(await ledger()).toEqual(preLedger);
 expect(admission.migrationEpoch()).toBeNull();
 // P07: old receipts remain readable and are labelled legacy.
 expect(reader.receiptProvenance("canonical_review",review.path,originalBytes)).toMatchObject({receiptId:review.receiptKey,tier:"legacy_origin_unverified",baseSha256:null});
 expect(reader.createReceipt("source_intake",source.path,raw(source.path))).toBe(source.receiptKey);
 const tiers:string[]=[],bases:(string|null)[]=[];
 for(let depth=1;depth<=3;depth++){
  const extra=await save({...repost(depth),captureOnly:true,researchReview:undefined});
  expect(admission.operationProvenanceTier(extra.steps[0].receiptKey)).toBe("server_witnessed");
  vi.setSystemTime(Date.now()+10);
  const input=await revisionInput(review.path,review.receiptKey,extra.steps[0],`Synthetic additional detail at depth ${depth}; no independent evidence.`);
  const {prepared,result,authorization}=await revise(input);
  // Depth 1 runs before any epoch, depths 2-3 after it: F-04 inheritance crosses the cutover.
  if(depth===1)admission.establishMigrationEpoch("wp2-fixture-admin");
  expect(prepared.targetProvenanceTier).toBe(depth===1?"legacy_origin_unverified":"server_witnessed_revision_on_legacy_base");
  expect(prepared.legacyTargetAdoption).toEqual({baseTier:"legacy_origin_unverified",baseSha256:sha(originalBytes),resultTier:"server_witnessed_revision_on_legacy_base"});
  expect(result.status).toBe("revision_saved_verified");
  const w=admission.witnessFor(prepared.operationId)!;
  expect(w).toMatchObject({kind:"review_revision",mode:"off",base_tier:"legacy_origin_unverified",base_sha256:sha(originalBytes)});
  expect(admission.operationProvenanceTier(prepared.operationId)).toBe("server_witnessed_revision_on_legacy_base");
  const now=raw(review.path),p=reader.receiptProvenance("canonical_review",review.path,now);
  tiers.push(p.tier);bases.push(p.baseSha256);
  expect(reader.createReceipt("canonical_review",review.path,now)).toBe(review.receiptKey);
  // Idempotent retry; generic apply never consumes the ICR witness.
  const bridge=await import("./canonical-review-revision"),engine=await import("../safe-edit/engine");
  expect((await bridge.applyCanonicalReviewRevision({input,operationId:prepared.operationId,authorization},actor)).status).toBe("revision_saved_verified");
  expect(()=>engine.apply(authorization,actor)).toThrow(/dedicated_route_required/);
  expect(now.startsWith(originalBytes.slice(0,originalBytes.indexOf("## บทวิเคราะห์")))).toBe(true);
 }
 expect(tiers).toEqual(Array(3).fill("server_witnessed_revision_on_legacy_base"));
 expect(bases).toEqual(Array(3).fill(sha(originalBytes)));
 expect(tiers).not.toContain("server_witnessed");
 // Context reader (consumer of the read-only RC-4 cone's createReceipt): identity stays the
 // legacy origin receipt, never a primary/verified uplift.
 const bundle=reader.discoverCanonicalResearch("TESTA").reviews.find(r=>r.path===review.path)?.bundle;
 expect(bundle).toMatchObject({reviewReceiptId:review.receiptKey,primaryVerification:"not_performed",economicEventEquivalence:"not_established"});
 expect(fs.readdirSync(path.join(vault,"10_Knowledge/Company Research"))).toHaveLength(1);
});

it("N11/N20: unwitnessed_post_epoch or unknown base cannot be adopted; zero plan, witness, receipt, file effects",async()=>{
 const admission=await import("../safe-edit/admission"),reader=await import("../vault/investment-research-context"),bridge=await import("./canonical-review-revision");
 admission.establishMigrationEpoch("wp2-fixture-admin");
 const first=await save(original);
 const review=first.steps.find(s=>s.kind==="canonical_review")!;
 const extra=await save({...repost(1),captureOnly:true,researchReview:undefined});
 expect(reader.receiptProvenance("canonical_review",review.path,raw(review.path)).tier).toBe("server_witnessed");
 // (a) witness invalidated after the epoch -> unwitnessed_post_epoch.
 const w=admission.witnessFor(review.receiptKey)!,d=(await import("../db")).db();
 d.prepare("DELETE FROM witness_consumption WHERE witness_id=?").run(w.witness_id);
 expect(reader.receiptProvenance("canonical_review",review.path,raw(review.path)).tier).toBe("unwitnessed_post_epoch");
 const before=await ledger();
 // Refused already while binding the revision proposal (fail-closed before any plan/preview).
 await expect(revisionInput(review.path,review.receiptKey,extra.steps[0],"probe a")).rejects.toThrow(/create_receipt_unverified/);
 expect(await ledger()).toEqual(before);
 void bridge;
 // (b) unknown base: bytes changed outside any journal (external writer) -> no verified receipt.
 d.prepare("INSERT INTO witness_consumption VALUES(?,?,?)").run(w.witness_id,review.receiptKey,new Date().toISOString());
 fs.appendFileSync(path.join(vault,review.path),"\nexternal unjournaled bytes\n");
 const before2=await ledger();
 await expect(revisionInput(review.path,review.receiptKey,extra.steps[0],"probe b")).rejects.toThrow();
 expect(await ledger()).toEqual(before2);
 expect(()=>reader.receiptProvenance("canonical_review",review.path,raw(review.path))).toThrow(/create_receipt_unverified|receipt/);
 const held=reader.discoverCanonicalResearch("TESTA").reviews.find(r=>r.path===review.path)?.bundle;
 expect(held).toMatchObject({status:"HOLD",reviewReceiptId:null});
});

it("adjacent positive: witnessed (non-legacy) Review revision stays server_witnessed with no base",async()=>{
 const admission=await import("../safe-edit/admission"),reader=await import("../vault/investment-research-context");
 admission.establishMigrationEpoch("wp2-fixture-admin");
 const first=await save(original),review=first.steps.find(s=>s.kind==="canonical_review")!;
 const extra=await save({...repost(1),captureOnly:true,researchReview:undefined});
 const {prepared,result}=await revise(await revisionInput(review.path,review.receiptKey,extra.steps[0],"Witnessed base revision."));
 expect(prepared).toMatchObject({targetProvenanceTier:"server_witnessed",legacyTargetAdoption:null});
 expect(result.status).toBe("revision_saved_verified");
 expect(admission.witnessFor(prepared.operationId)).toMatchObject({base_tier:null,base_sha256:null});
 expect(reader.receiptProvenance("canonical_review",review.path,raw(review.path))).toMatchObject({tier:"server_witnessed",baseSha256:null});
});

it("M56-A full positive (DUPLICATE link-only): read-only M56 proposal -> dedicated Canonical Review revision (relation=duplicate sealed as duplicate_link_only + dashboard approval + witness/CAS) -> already_linked; mislabels and generic append refused",async()=>{
 const admission=await import("../safe-edit/admission"),reader=await import("../vault/investment-research-context"),engine=await import("../safe-edit/engine");
 const {planInvestmentWriteback}=await import("../vault/investment-writeback-router");
 const {kernelCanonicalCreate}=await import("../../../tests/source-event-fixture");
 // Historical English-format Company Review (+ its Source) as synthetic pre-WP2 history.
 const steps=planInvestmentWriteback(original).safeEditWorkflow!.steps;
 const src=steps.find(s=>s.kind==="source_intake")!,rev=steps.find(s=>s.kind==="canonical_review")!;
 let reviewText=(rev.safeEditRequest!.change as {content:string}).content;
 for(const [th,en] of [["## ที่มาของต้นฉบับ","## Source provenance"],["## บทวิเคราะห์ (การตีความของ AI ไม่ใช่ Thesis ที่อนุมัติแล้ว)","## Research analysis (AI interpretation; not approved Thesis)"]])reviewText=reviewText.replace(th,en);
 await kernelCanonicalCreate([{kind:"source_intake",path:src.path,content:(src.safeEditRequest!.change as {content:string}).content},
  {kind:"canonical_review",path:rev.path,content:reviewText}],actor,{legacy:true});
 // Same-event Source in another language edition of the same publisher family.
 const other=await save({...original,captureOnly:true,researchReview:undefined,sourceLanguage:"th",sourceUrl:"https://th.example.org/testa/manual-th",
  extractedText:"SYNTHETIC (Thai edition): TESTA issued an ordinary product manual on October 1."});
 const otherPath=other.steps[0].path,before=raw(rev.path),ledgerBefore=await ledger();
 const {planDuplicateSourceLinkM56}=await import("../vault/event-review-relation-m56");
 const request={reviewPath:rev.path,additionalSourcePath:otherPath,eventAnchor:"testa-manual-annotation-2026",
  comparisonBasis:"Both synthetic editions describe the same October 1 ordinary manual release from the same publisher family; not a second economic event.",linkedOnDate:"2026-11-14"};
 const plan=planDuplicateSourceLinkM56(request);
 expect(plan).toMatchObject({status:"requires_dedicated_review_revision",writePerformed:false,safeEditRequest:null});
 expect(await ledger()).toEqual(ledgerBefore); // the planning tool stays read-only
 const recipe=plan.status==="requires_dedicated_review_revision"?plan.canonicalReviewRevision:null;
 expect(recipe!.existingReview).toMatchObject({path:rev.path,expectedSha256:sha(before),relationship:"duplicate"});
 expect(recipe!.additionalSources).toEqual([{path:otherPath,sha256:sha(raw(otherPath)),receiptId:other.steps[0].receiptKey}]);
 expect(recipe!.revisionText).toContain("not independent confirmation");
 // OD-10 F-5: no pre-approved judgement; a copied-forward placeholder fails the revision schema.
 const completion=plan.status==="requires_dedicated_review_revision"?plan.requiredCompletion:null;
 expect(completion!.analystAssessment).toMatchObject({criticIndependence:"not_verified",independentEvidenceIncrement:0});
 for(const k of ["disposition","eventRelation","materiality"] as const)expect(completion!.analystAssessment[k]).toMatch(/^<analyst-selected: /);
 const {canonicalRevisionInputSchema}=await import("../safe-edit/canonical-review-revision-pilot");
 expect(canonicalRevisionInputSchema.safeParse({...recipe!,analystAssessment:{...completion!.analystAssessment,assessment:"x".repeat(40),counterEvidence:"x".repeat(40),requiredEvidence:"x".repeat(40)}}).success).toBe(false);
 // The former generic append route is refused for the canonical Review.
 expect(()=>engine.preview({operationId:"ILK-former-generic-append-2",path:rev.path,reason:"former M56 generic append",
  change:{kind:"append",heading:"Source provenance",date:"2026-11-14",content:recipe!.revisionText}},actor)).toThrow(/dedicated_route_required|canonical_route_required/);
 const input:CanonicalRevisionInput={...recipe!,analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",
  assessment:"The second edition repeats the same manual release; it adds a language edition only, not new evidence or financial guidance.",
  counterEvidence:"Edition equivalence is an analyst proposal; the publisher's original pages were not independently compared byte-for-byte.",
  requiredEvidence:"Compare both editions with the publisher's canonical page before relying on any detail.",
  criticIndependence:"not_verified",independentEvidenceIncrement:0}};
 const gate=await import("../safe-edit/source-event-admission"),bridge=await import("./canonical-review-revision");
 const d=(await import("../db")).db(),events=()=>d.prepare("SELECT count(*) FROM safe_edit_events").pluck().get();
 const sealed=async(relation:"duplicate"|"added_detail",action:"duplicate_link_only"|"append_revision")=>{
  vi.setSystemTime(Date.now()+10);const sub=await assessed(gate.revisionEventProposal(input),actor);
  sub.result.event.relation=relation;sub.result.event.action=action;return sub;};
 // Negative 1: the analyst seals added_detail for a duplicate request -> refused BEFORE enrollment (no mislabel).
 let l0=await ledger();const e0=events();
 expect(()=>bridge.prepareCanonicalReviewRevision({...input,sourceEvent:null as never},actor)).toThrow();
 const mislabel=await sealed("added_detail","append_revision");
 expect(()=>bridge.prepareCanonicalReviewRevision({...input,sourceEvent:mislabel},actor)).toThrow(/revision_event_relation_binding_hold/);
 expect(await ledger()).toEqual(l0);expect(events()).toBe(e0);
 // Negative 2: duplicate relation with the add-detail action is not a contract pair -> HOLD, zero canonical effects.
 const mixed=await sealed("duplicate","append_revision");
 expect(()=>bridge.prepareCanonicalReviewRevision({...input,sourceEvent:mixed},actor)).toThrow(/source_event_revision_requires_low_risk_added_detail/);
 expect(await ledger()).toEqual(l0);
 // Negative 3: a material duplicate is never admitted.
 l0=await ledger();
 expect(()=>bridge.prepareCanonicalReviewRevision({...input,analystAssessment:{...input.analystAssessment,materiality:"material"},sourceEvent:mixed},actor)).toThrow(/revision_material_or_unresolved_hold/);
 expect(await ledger()).toEqual(l0);
 // Positive: duplicate sealed as duplicate_link_only.
 input.sourceEvent=await sealed("duplicate","duplicate_link_only");
 const {prepared,result}=await revise(input);
 expect(result.status).toBe("revision_saved_verified");
 expect(prepared.legacyTargetAdoption).toMatchObject({baseTier:"legacy_origin_unverified",baseSha256:sha(before)});
 expect(admission.operationProvenanceTier(prepared.operationId)).toBe("server_witnessed_revision_on_legacy_base");
 const after=raw(rev.path);
 expect(after.startsWith(before.slice(0,before.indexOf("## Research analysis")))).toBe(true);
 expect(after).toContain(`[[${otherPath.slice(0,-3)}]]`);expect(after).toContain("independent_evidence_increment=0");
 expect(after).toContain("### Duplicate Source link (link only; same event already covered; not new evidence or a new event)");
 expect(after).not.toContain("### Source-linked evidence addendum");
 expect(after).toContain("event relation proposal: duplicate");
 expect(reader.receiptProvenance("canonical_review",rev.path,after).tier).toBe("server_witnessed_revision_on_legacy_base");
 // OD-10 F-4: idempotent only after the domain + receipt checks, labelled as a text reference.
 const ledgerLinked=await ledger();
 expect(planDuplicateSourceLinkM56(request)).toMatchObject({status:"already_linked",linkEvidence:"text_reference_only",canonicalReviewRevision:null,
  reviewVersionSha256:sha(after),safeEditRequest:null,writePerformed:false});
 expect(await ledger()).toEqual(ledgerLinked);
 // Negative: Review bytes that no receipt verifies -> HOLD, never already_linked (synthetic on-disk drift).
 fs.appendFileSync(path.join(vault,rev.path),"\nunreceipted drift\n");
 const drifted=planDuplicateSourceLinkM56(request);
 expect(drifted).toMatchObject({status:"hold_receipt_unverified",canonicalReviewRevision:null,writePerformed:false});
 expect(drifted).not.toHaveProperty("linkEvidence");
});

/* M56-P1 (Owner-approved Phase 1): V2 Industry-IN on a synthetic pre-WP2 (legacy) base keeps the
 * composite F-04 tier at depth 1/2/3; historical non-IN Reviews (any domain, even with a forged
 * `verified_against_primary` label) stay read-only. SYNTHETIC analyst attestation only. */
async function sealedSubject(input:unknown,relation:"duplicate"|"added_detail",action:"duplicate_link_only"|"append_revision"){
 const sea=await import("../safe-edit/source-event-admission"),pilot=await import("../safe-edit/canonical-review-revision-pilot");
 const built=sea.buildSourceEventPacket(sea.subjectRevisionEventProposal(pilot.subjectRevisionInputSchema.parse(input)),actor),body=JSON.parse(built.packet.body);
 expect(built.constraints).toEqual([]);
 const ref=(key:string,text:string,s256:string)=>({key,quote:text.slice(0,100),locator:`utf16:0:${Math.min(text.length,100)}`,sourceSha256:s256});
 const sources=body.sources.map((s:{text:string;textSha256:string},i:number)=>ref("source_"+i,s.text,s.textSha256));
 const history=body.context.history.map((h:{text:string;sha256:string},i:number)=>ref("history_"+i,h.text,h.sha256)),subject=body.proposal.subject;
 return {packet:built.packet,result:{contractVersion:pilot.SUBJECT_SOURCE_EVENT_POLICY,packetDigest:built.packet.digest,packetEnvelopeDigest:built.packetEnvelopeDigest,
  disposition:"PASS",methodVersion:"SYNTHETIC-MECHANICAL-SUBJECT-1",criticIndependence:"not_verified",
  sourceBindings:sources.map((r:{key:string},i:number)=>({bindingVersion:pilot.SUBJECT_BIND_POLICY,sourceKey:r.key,sliceId:"slice_"+i,domain:subject.domain,effectiveSubjectId:subject.key,
   relation:"primary_subject",semanticRationale:"Synthetic fixture subject association for deterministic binding tests only.",references:[r],coverage:"excerpt_only",limitations:["Fixture only"]})),
  event:{decisionVersion:pilot.SUBJECT_EVENT_ID_POLICY,effectiveSubjectId:subject.key,relation,action,targetReviewPath:body.targetReview.path,materiality:"low",
   semanticRationale:"Synthetic exact-source comparison, not economic verification or LLM evaluation.",materialityRationale:"Synthetic same-event coverage; no financial authority asserted.",
   comparison:{economicSubject:"same",geography:"same",metric:"same",unit:"same",period:"same",role:"same",vintage:"not_applicable",sourceFamily:"same_family",materialDelta:"Synthetic same-event text only; no asserted change."},
   consideredHistoryKeys:history.map((r:{key:string})=>r.key),references:[sources[0],...(history.length?[history[0]]:[]),ref("target_review",body.targetReview.text,body.targetReview.sha256)],
   counterEvidenceRefs:[],coverage:"bounded_omission",coverageRationale:"Only the bounded server-selected evidence was supplied and reviewed in this simulated fixture."},
  checks:{sourceEntailment:"PASS",subjectAssociation:"PASS",eventIdentity:"PASS",periodRoleVintage:"PASS",unitMetricGeography:"PASS",coverageCounterEvidence:"PASS",pointInTime:"PASS",injectionIsolation:"PASS",protectedAuthority:"PASS"}}};
}
const industryOriginal:WritebackInput={...original,domain:"industry",entities:["Memory Semiconductors"],topic:"Synthetic memory price",sourceUrl:"https://example.org/memory/tracker-a",
 extractedText:"SYNTHETIC: Memory Semiconductors contract prices rose in October 2026, a synthetic tracker reported."};
it("M56-P1-10 + F-04: V2 Industry-IN on a legacy base keeps server_witnessed_revision_on_legacy_base at depth 1, 2 and 3; never uplifted",async()=>{
 for(const f of ["02_Industries_Themes","10_Knowledge/Industry and Concepts"])fs.mkdirSync(path.join(vault,f),{recursive:true});
 fs.writeFileSync(path.join(vault,"02_Industries_Themes/Memory Semiconductors.md"),"# Memory Semiconductors\n");
 (await import("../vault/indexer")).reindexPath("02_Industries_Themes/Memory Semiconductors.md");
 const admission=await import("../safe-edit/admission"),reader=await import("../vault/investment-research-context"),bridge=await import("./canonical-review-revision");
 const {preservedSubmittedText}=await import("../vault/research-decision-v2"),{splitFrontmatter}=await import("../vault/markdown");
 const first=await save(industryOriginal);expect(first.status).toBe("saved_verified");
 const review=first.steps.find(s=>s.kind==="canonical_review")!,source=first.steps.find(s=>s.kind==="source_intake")!;
 expect(review.path.startsWith("10_Knowledge/Industry and Concepts/")).toBe(true);
 await asPreWp2(first.steps.map(s=>s.receiptKey));
 const originalBytes=raw(review.path);
 expect(reader.receiptProvenance("canonical_review",review.path,originalBytes).tier).toBe("legacy_origin_unverified");
 const src=raw(source.path),part=preservedSubmittedText(src)!,text=[part,part+"\n"].find(t=>sha(t)===splitFrontmatter(src).data.source_text_sha256)!;
 const q="Memory Semiconductors contract prices rose in October 2026",at=text.indexOf(q);
 const tiers:string[]=[];
 for(let depth=1;depth<=3;depth++){
  const extra=await save({...industryOriginal,captureOnly:true,researchReview:undefined,sourceUrl:`https://www${depth}.example.org/memory/repost`,
   extractedText:`SYNTHETIC repost ${depth}: Memory Semiconductors contract prices rose in October 2026, the tracker repeated.`});
  vi.setSystemTime(Date.now()+10);
  const input:Record<string,unknown>={selectorVersion:"M56-REVIEW-SELECTOR-2",entity:"industry",
   existingReview:{path:review.path,intakeId:review.path.match(/IN-[A-F0-9]{16}/)![0],expectedSha256:sha(raw(review.path)),receiptId:review.receiptKey,reviewScope:"industry",
    originalSourcePath:source.path,relationship:"duplicate",comparisonBasis:"Synthetic repost of the same October 2026 memory price rise from one publisher family; not a new event."},
   subject:{domain:"industry",hubPath:"02_Industries_Themes/Memory Semiconductors.md",topic:"DRAM contract pricing",period:"October 2026",
    evidence:[{key:"original_source",quote:q,locator:`utf16:${at}:${at+q.length}`,sourceSha256:sha(text)}]},
   additionalSources:[{path:extra.steps[0].path,sha256:sha(raw(extra.steps[0].path)),receiptId:extra.steps[0].receiptKey}],
   reviewDate:"2026-11-14",methodVersion:"TEST-SYNTHETIC-SUBJECT-1",revisionText:`Synthetic duplicate link at depth ${depth}; no independent evidence.`,
   analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"Synthetic repost of the same dated event; not new evidence.",
    counterEvidence:"Same-event identity is an analyst proposal only.",requiredEvidence:"Read the original before any decision.",criticIndependence:"not_verified",independentEvidenceIncrement:0}};
  input.sourceEvent=await sealedSubject(input,"duplicate","duplicate_link_only");
  const p=bridge.prepareReviewRevision(input,actor) as Record<string,any>,engine=await import("../safe-edit/engine");
  const view=engine.adminPreview(p.operationId) as {afterHash:string;reviewedEvidenceDigest?:string};
  engine.approve(p.operationId,"synthetic-dashboard-reviewer",view.afterHash,view.reviewedEvidenceDigest);
  expect(p.legacyTargetAdoption).toEqual({baseTier:"legacy_origin_unverified",baseSha256:sha(originalBytes),resultTier:"server_witnessed_revision_on_legacy_base"});
  const result=await bridge.applyReviewRevision({input,operationId:p.operationId,authorization:{operationId:p.operationId,previewToken:p.preview.previewToken,expectedHash:p.preview.beforeHash}},actor);
  expect(result.status).toBe("revision_saved_verified");
  // Depth 1 runs before any epoch, depths 2-3 after it (as the Company F-04 test above).
  if(depth===1)admission.establishMigrationEpoch("wp2-fixture-admin");
  expect(admission.operationProvenanceTier(p.operationId)).toBe("server_witnessed_revision_on_legacy_base");
  tiers.push(reader.receiptProvenance("canonical_review",review.path,raw(review.path)).tier);
 }
 expect(tiers).toEqual(Array(3).fill("server_witnessed_revision_on_legacy_base"));
 expect(raw(review.path).startsWith(originalBytes.slice(0,originalBytes.indexOf("## บทวิเคราะห์")))).toBe(true);
});
it("M56-P1-06: historical non-IN Reviews (Company and Industry, forged verified_against_primary) stay read-only — no recipe, no V1/V2 prepare, zero effects",async()=>{
 fs.mkdirSync(path.join(vault,"10_Knowledge/Industry and Concepts"),{recursive:true});
 const first=await save(original),source=first.steps.find(s=>s.kind==="source_intake")!;
 const extra=await save({...repost(1),captureOnly:true,researchReview:undefined});
 const ix=await import("../vault/indexer"),{planDuplicateSourceLinkM56}=await import("../vault/event-review-relation-m56"),bridge=await import("./canonical-review-revision");
 const legacy=["10_Knowledge/Company Research/Investment Review - TESTA.md","10_Knowledge/Industry and Concepts/Investment Review - Memory.md"];
 for(const p of legacy){
  fs.writeFileSync(path.join(vault,p),["---","type: investment_research_review","verification: verified_against_primary","status: analyst_review_not_user_endorsed",
   `intake_id: "${source.path.match(/IN-[A-F0-9]{16}/)![0]}"`,`original_source_path: "${source.path}"`,"---","## Source provenance",`- [[${source.path.slice(0,-3)}]]`,"## Research analysis","Historical text.",""].join("\n"));
  ix.reindexPath(p);
 }
 const before=await ledger(),bytes=legacy.map(raw);
 for(const p of legacy){
  // Planner: historical read-only (or Source chronology refusal), never a recipe.
  let plan:unknown=null;try{plan=planDuplicateSourceLinkM56({reviewPath:p,additionalSourcePath:extra.steps[0].path,eventAnchor:"synthetic-legacy-anchor-1",
   comparisonBasis:"Synthetic legacy probe of the same manual release from one publisher family; not a new event.",linkedOnDate:"2026-11-14"});}catch(e){plan={refused:(e as Error).message};}
  expect(JSON.stringify(plan),p).not.toMatch(/requires_dedicated_review_revision/);
  expect(()=>bridge.prepareReviewRevision({existingReview:{path:p,expectedSha256:sha(raw(p)),receiptId:"ICW-"+"b".repeat(32),relationship:"duplicate",
   comparisonBasis:"Synthetic legacy probe of the same manual release from one publisher family."},entity:"TESTA",additionalSources:[{path:extra.steps[0].path,sha256:sha(raw(extra.steps[0].path)),receiptId:extra.steps[0].receiptKey}],
   reviewDate:"2026-11-14",methodVersion:"T",analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"x",counterEvidence:"x",requiredEvidence:"x",criticIndependence:"not_verified",independentEvidenceIncrement:0},revisionText:"x"},actor),p).toThrow();
  expect(()=>bridge.prepareReviewRevision({selectorVersion:"M56-REVIEW-SELECTOR-2",entity:"industry",existingReview:{path:p,intakeId:"IN-0000000000000000",expectedSha256:sha(raw(p)),receiptId:"ICW-"+"b".repeat(32),
   reviewScope:"industry",originalSourcePath:source.path,relationship:"duplicate",comparisonBasis:"Synthetic legacy probe of the same manual release from one publisher family."},
   subject:{domain:"industry",hubPath:"02_Industries_Themes/Memory.md",topic:"t",period:null,evidence:[{key:"original_source",quote:"SYNTHETIC",locator:"utf16:0:9",sourceSha256:"0".repeat(64)}]},
   additionalSources:[{path:extra.steps[0].path,sha256:sha(raw(extra.steps[0].path)),receiptId:extra.steps[0].receiptKey}],reviewDate:"2026-11-14",methodVersion:"T",
   analystAssessment:{disposition:"PASS",eventRelation:"duplicate",materiality:"low",assessment:"x",counterEvidence:"x",requiredEvidence:"x",criticIndependence:"not_verified",independentEvidenceIncrement:0},revisionText:"x"},actor),p)
   .toThrow(/revision_subject_domain_scope_hold/);
 }
 expect(await ledger()).toEqual(before);expect(legacy.map(raw)).toEqual(bytes);
 const reader=await import("../vault/investment-research-context");
 for(const p of legacy)expect(()=>reader.createReceipt("canonical_review",p,raw(p)),p).toThrow(); // no synthesized ICW receipt
});

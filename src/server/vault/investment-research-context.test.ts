import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {kernelCanonicalCreate,legacyJournalWrite} from "../../../tests/source-event-fixture";

let root:string,vault:string;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const MRVL="IN-5B42E415CA57E41E",TSMC="IN-828DC9F6F955DA8B",OLD="IN-1111111111111111";
beforeEach(async()=>{
  root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"ri-context-")));vault=path.join(root,"vault");
  process.env.DATA_DIR=root;process.env.ENCRYPTION_KEY??=Buffer.alloc(32,7).toString("base64");
  process.env.SAFE_EDIT_ENABLED="1";process.env.SAFE_EDIT_SINGLE_WRITER="1";vi.resetModules();
  for(const folder of ["00_Inbox/ChatGPT","01_Companies","10_Knowledge/Company Research","05_Thesis","06_Portfolio"])
    fs.mkdirSync(path.join(vault,folder),{recursive:true});
  for(const issuer of ["MRVL","TSMC","NVDA"])await seed(`01_Companies/${issuer}.md`,`# ${issuer} company context`);
});
afterEach(()=>{
  fs.rmSync(root,{recursive:true,force:true});
  for(const k of ["DATA_DIR","SAFE_EDIT_ENABLED","SAFE_EDIT_SINGLE_WRITER"])delete process.env[k];vi.restoreAllMocks();
});
async function seed(p:string,raw:string){
  fs.mkdirSync(path.dirname(path.join(vault,p)),{recursive:true});fs.writeFileSync(path.join(vault,p),raw);
  (await import("./indexer")).reindexPath(p);
}
// Real Safe Edit receipts in an isolated Vault; the IDs mirror the dispatch,
// but all prose and claimed facts are synthetic, not a copy of live research.
async function saved(issuer:string,id:string,published:string|null,event:string|null=null,legacy=false){
  const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
  const reviewPath=`10_Knowledge/Company Research/Investment Review - ${issuer} - ${id}.md`;
  const chronology=`event_date: ${JSON.stringify(event)}\npublished_at: ${JSON.stringify(published)}`;
  const tag=`Source token: InvestmentIntake${id.slice(3)}`;
  const source=`---\ntype: investment_source_intake\nintake_id: ${id}\nsource_type: user_supplied\nsource_url: https://example.org/unchanged-url\nsource_text_sha256: ${sha(id)}\n${chronology}\n---\n${tag}\nSynthetic submitted text ${id}.`;
  const review=`---\ntype: investment_research_review\n${legacy?"":"review_scope: company\n"}intake_id: ${id}\ncompany_hubs: ["01_Companies/${issuer}.md"]\noriginal_source_path: "${sourcePath}"\nsource_type: chatgpt_analysis\nverification: not_reverified\n${chronology}\n---\n# Investment Review — ${issuer}\n${tag}\n[[${sourcePath.slice(0,-3)}]]\n## Research analysis\nSynthetic unverified cash conversion discussion.\n## Counter-evidence\nSynthetic capacity and margin risks require original evidence.`;
  // WP2: synthetic pre-WP2 history (kernel-written bytes/journal, kernel rows removed).
  await kernelCanonicalCreate([{kind:"source_intake",path:sourcePath,content:source},{kind:"canonical_review",path:reviewPath,content:review}],
    "oauth:ri-fixture",{legacy:true,reason:"Synthetic RI-001 fixture"});
  return {sourcePath,reviewPath,source,review};
}
async function pack(issuer:string,extra:Record<string,unknown>={}){
  return (await import("./investment-context")).buildInvestmentContextPack({question:`${issuer} latest research and cash conversion`,issuers:[issuer],maxNotes:12,maxChars:16000,...extra});
}
describe("MI04 point-in-time exact version eligibility",()=>{
  const cutoff="2026-11-02T16:59:59.999Z";
  afterEach(()=>vi.useRealTimers());
  it("MI04 final repro PIT: two eligible reviews survive six then seven future-only discoveries",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"));
    const earlier=await saved("NVDA",OLD,"2026-10-28");
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));await saved("NVDA",MRVL,"2026-11-01");
    for(let i=4;i<=9;i++){
      vi.setSystemTime(new Date(`2026-11-0${i}T00:00:00.000Z`));
      await saved("NVDA","IN-"+String(i).padStart(16,"0"),`2026-11-0${i}`);
    }
    const before=await pack("NVDA",{historyCutoff:cutoff,maxNotes:16,maxChars:18000});
    expect(before.researchCoverage[0].historicalComparator).toMatchObject({status:"FOUND",paths:[earlier.reviewPath],scanComplete:false});
    vi.setSystemTime(new Date("2026-11-10T00:00:00.000Z"));
    const future=await saved("NVDA","IN-0000000000000010","2026-11-10");
    const after=await pack("NVDA",{historyCutoff:cutoff,maxNotes:16,maxChars:18000});
    expect(after.items.some(i=>i.path===future.reviewPath)).toBe(false);
    expect(after.researchCoverage[0].historicalComparator).toEqual(before.researchCoverage[0].historicalComparator);
    expect(after.items.map(i=>i.path).sort()).toEqual(before.items.map(i=>i.path).sort());
    const notes=await import("./notes"),spy=vi.spyOn(notes,"readNote");
    const {discoverCanonicalResearch}=await import("./investment-research-context");
    const d=(await import("../db")).db(),changes=d.prepare("SELECT total_changes() AS n").get();
    const scan=discoverCanonicalResearch("NVDA",undefined,["NVDA"],undefined,undefined,cutoff);
    expect(scan.reviews).toHaveLength(2);expect(scan.pitExcluded).toHaveLength(7);
    expect(spy.mock.calls.filter(([p])=>p.startsWith("10_Knowledge/"))).toHaveLength(2);
    expect(spy.mock.calls.some(([p])=>p===future.reviewPath||p===future.sourcePath)).toBe(false);
    expect(scan.scopeDefinition.physicalReviewReadLimit).toBe(8);
    expect(d.prepare("SELECT total_changes() AS n").get()).toEqual(changes);
    spy.mockRestore();
  });
  it("MI04 final PIT bounds: unknown receipt candidates retain 100+sentinel and eight physical reads",async()=>{
    for(let i=0;i<101;i++){
      const id="IN-"+i.toString(16).toUpperCase().padStart(16,"0");
      await seed(`10_Knowledge/Company Research/Investment Review - NVDA - ${id}.md`,
        `---\ntype: investment_research_review\nreview_scope: company\nintake_id: ${id}\ncompany_hubs: ["01_Companies/NVDA.md"]\npublished_at: 2026-11-10\nknown_at: 2026-11-10\n---\nUnreceipted synthetic declaration.`);
    }
    const notes=await import("./notes"),spy=vi.spyOn(notes,"readNote");
    const scan=(await import("./investment-research-context")).discoverCanonicalResearch("NVDA",undefined,["NVDA"],undefined,undefined,cutoff);
    expect(scan.complete).toBe(false);
    expect(scan.pitExcluded).toEqual([]);
    expect(scan.reasons).toEqual(expect.arrayContaining(["canonical_scope_scan_limit","canonical_read_limit","pit_admission_unverified"]));
    expect(scan.deferredReviews).toHaveLength(92);
    expect(spy.mock.calls.filter(([p])=>p.startsWith("10_Knowledge/"))).toHaveLength(8);
    expect(scan.reviews.every(r=>r.bundle.status==="HOLD")).toBe(true);
    spy.mockRestore();
  });
  it("MI04 final PIT receipt: forged known-at cannot become a verified future exclusion",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    const target=await saved("NVDA",OLD,"2026-11-01");
    const d=(await import("../db")).db(),id="ICW-"+sha(["canonical_review",target.reviewPath,sha(target.review)].join("\n")).slice(0,32);
    d.prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.writtenAt','2026-11-10T00:00:00.000Z') WHERE id=?").run(id);
    const scan=(await import("./investment-research-context")).discoverCanonicalResearch("NVDA",undefined,["NVDA"],undefined,undefined,cutoff);
    expect(scan.pitExcluded).toEqual([]);expect(scan.reasons).toContain("pit_admission_unverified");
    const p=await pack("NVDA",{historyCutoff:cutoff});
    expect(p.items.some(i=>i.path===target.reviewPath)).toBe(false);
    expect(p.discovery.paths.find(x=>x.path===target.reviewPath)?.reasons).toContain("pit_receipt_unverified");
  });
  it("MI04 final Source citation offsets bind preserved submitted text inside the receipted wrapper",async()=>{
    const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${OLD}.md`,quote="Cash conversion fell.";
    const submitted="# NVDA earnings\n🔎 The statement “"+quote+"” was withdrawn.\n\n## Counter-evidence\n"+quote;
    const source=`---\ntype: investment_source_intake\nintake_id: ${OLD}\nsource_kind: news_media\nsource_text_sha256: ${sha(submitted)}\n---\nInvestmentIntake${OLD.slice(3)}\n## User-supplied original language text\n\n`+
      "\x60\x60\x60text\n"+submitted+"\n\x60\x60\x60\n";
    await kernelCanonicalCreate([{kind:"source_intake",path:sourcePath,content:source}],"oauth:ri-fixture",{legacy:true,reason:"Synthetic citation wrapper fixture"});
    const judge=await import("./research-judge");
    const {packet}=judge.buildResearchJudgePacket({domain:"company",entities:["NVDA"],topic:"earnings",inputFormat:"text",
      sourceKind:"news_media",contentTypes:["other"],extractedText:"Synthetic fresh NVDA source."},"oauth:mi04-final");
    const history=judge.verifyResearchJudgeEnvelope(packet,"oauth:mi04-final").history.find(h=>h.path===sourcePath)!;
    expect(history.sourceReceiptKey).toMatch(/^ICW-/);
    expect(history.counterEvidence).toBe(true);
    expect(history.citationSpans.find(s=>s.text===quote)).toEqual({start:source.lastIndexOf(quote),end:source.lastIndexOf(quote)+quote.length,text:quote});
    for(const span of history.citationSpans)expect(source.slice(span.start,span.end)).toBe(span.text);
    expect(fs.readFileSync(path.join(vault,sourcePath),"utf8")).toBe(source);
  });
  it("MI04 delta repro 1: future-only discovery cannot certify a historical comparator",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    const old=await saved("NVDA",OLD,"2026-11-01");
    const before=await pack("NVDA",{historyCutoff:cutoff});
    expect(before.researchCoverage[0].historicalComparator.status).toBe("SCAN_INCOMPLETE");
    vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z"));
    const future=await saved("NVDA",MRVL,"2026-11-04");
    const after=await pack("NVDA",{historyCutoff:cutoff});
    expect(after.items.map(i=>i.path).sort()).toEqual(before.items.map(i=>i.path).sort());
    expect(after.items.some(i=>i.path===old.reviewPath)).toBe(true);
    expect(after.items.some(i=>i.path===future.reviewPath)).toBe(false);
    expect.soft(after.researchCoverage[0].historicalComparator).toEqual(before.researchCoverage[0].historicalComparator);
    expect.soft(after.researchCoverage[0].canonicalReview).toEqual(before.researchCoverage[0].canonicalReview);
    expect.soft(after.researchCoverage[0].counterEvidence).toEqual(before.researchCoverage[0].counterEvidence);
    expect(after.researchCoverage[0].chronology).toBe("SCAN_INCOMPLETE");
  });
  it.each(["2026-11-01T23:29:52.370Z",cutoff])("admits exact receipted bytes known at %s, with unverified trust and no writes",async time=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(time));
    const target=await saved("NVDA",OLD,"2026-11-02");
    const d=(await import("../db")).db(),before=d.prepare("SELECT total_changes() AS n").get();
    const p=await pack("NVDA",{historyCutoff:cutoff,maxNotes:8,maxChars:12000});
    const item=p.items.find(i=>i.path===target.reviewPath);
    expect(item).toMatchObject({evidenceUse:"historical_context_only",declaredVerification:"not_reverified",
      pointInTime:{cutoff,knownAt:time,sha256:sha(target.review)}});
    expect(item?.schemaCompatibility.independenceAssessment).toBe("not_independent_archived_ai");
    expect(item?.schemaCompatibility.canAutoUpdateThesis).toBe(false);
    expect(p.contextBundles[0].status).toBe("BOUND_SOURCE_REVIEW");
    expect(p.retrieval.scope.historyCutoff).toBe(cutoff);
    const {judgeScopeWitness,judgeScopeCurrent}=await import("./research-judge-scope");
    const witness=judgeScopeWitness(p);
    expect(witness.scope.historyCutoff).toBe(cutoff);
    expect(judgeScopeCurrent(witness,p.retrieval,[],"IN-FFFFFFFFFFFFFFFF","oauth:mi04")).toBe(true);
    expect(judgeScopeCurrent(witness,{...p.retrieval,scope:{...p.retrieval.scope,historyCutoff:"2026-11-01T00:00:00.000Z"}},[],"IN-FFFFFFFFFFFFFFFF","oauth:mi04")).toBe(false);
    expect(d.prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(fs.readFileSync(path.join(vault,target.reviewPath),"utf8")).toBe(target.review);
  });
  it("MI04 delta PIT: two eligible versions retain their comparator when a future review appears",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"));
    const earlier=await saved("NVDA",OLD,"2026-10-28");
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    await saved("NVDA",MRVL,"2026-11-01");
    const before=await pack("NVDA",{historyCutoff:cutoff});
    expect(before.researchCoverage[0].historicalComparator).toMatchObject({status:"FOUND",paths:[earlier.reviewPath],scanComplete:false});
    vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z"));await saved("NVDA",TSMC,"2026-11-04");
    const after=await pack("NVDA",{historyCutoff:cutoff});
    expect(after.researchCoverage).toEqual(before.researchCoverage);
    expect(after.researchCoverage[0].latestReviewPaths).toEqual([]);
  });
  it.each([null,"2026-11-01"])("MI04 delta PIT: unknown or overlapping eligible chronology (%s) stays incomplete",async published=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    await saved("NVDA",OLD,"2026-11-01");await saved("NVDA",MRVL,published);
    const before=await pack("NVDA",{historyCutoff:cutoff});
    vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z"));await saved("NVDA",TSMC,"2026-11-04");
    const after=await pack("NVDA",{historyCutoff:cutoff});
    expect(after.researchCoverage[0].historicalComparator).toEqual(before.researchCoverage[0].historicalComparator);
    expect(after.researchCoverage[0].historicalComparator).toMatchObject({status:"SCAN_INCOMPLETE",paths:[],scanComplete:false});
    expect(after.researchCoverage[0].historicalComparator.reasons).toContain("publication_order_unresolved");
  });
  it.each(["one_ms_late","future_publication","receipt_time_forged","receipt_actor","body_drift","index_drift","index_path"])("PIT negative: %s",async fault=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(fault==="one_ms_late"?"2026-11-02T17:00:00.000Z":"2026-11-01T23:29:52.370Z"));
    const target=await saved("NVDA",OLD,fault==="future_publication"?"2026-11-04":"2026-11-02");
    const d=(await import("../db")).db();
    const id="ICW-"+sha(["canonical_review",target.reviewPath,sha(target.review)].join("\n")).slice(0,32);
    // Adversarial disposable corruption, not a production receipt or override.
    if(fault==="receipt_time_forged")d.prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.writtenAt','2026-10-01T00:00:00.000Z') WHERE id=?").run(id);
    if(fault==="receipt_actor")d.prepare("UPDATE safe_edit_events SET actor='wrong-actor' WHERE operation_id=? AND event='written'").run(id);
    if(fault==="body_drift")await seed(target.reviewPath,target.review+"\nUnreceipted edit");
    if(fault==="index_drift")d.prepare("UPDATE notes_fts SET body='wrong-index-body' WHERE rowid=(SELECT rowid FROM notes WHERE path=?)").run(target.reviewPath);
    if(fault==="index_path")d.prepare("UPDATE notes_fts SET path='Wrong.md' WHERE rowid=(SELECT rowid FROM notes WHERE path=?)").run(target.reviewPath);
    const p=await pack("NVDA",{historyCutoff:cutoff});
    expect(p.items.some(i=>i.path===target.reviewPath)).toBe(false);
    expect(p.contextBundles.some(b=>b.status==="BOUND_SOURCE_REVIEW")).toBe(false);
    expect(p.researchFallback.candidates.every(c=>c.bindingStatus==="HOLD"&&c.receiptId===null)).toBe(true);
    expect(p.incomplete.length).toBeGreaterThan(0);
    if(fault==="index_drift"||fault==="index_path")expect(p.retrieval.status).toBe("operational_hold");
    else expect(p.discovery.paths.find(x=>x.path===target.reviewPath)?.disposition).toBe("PIT_HOLD");
  });
  it("does not reclassify an unexpected receipt-store read failure as an intentional PIT omission",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    const target=await saved("NVDA",OLD,"2026-11-01");
    const reader=await import("./investment-research-context");
    vi.spyOn(reader,"receiptVersionAt").mockImplementation(()=>{throw Error("SQLITE_BUSY synthetic read failure");});
    const p=await pack("NVDA",{historyCutoff:cutoff});
    expect(p.retrieval.status).toBe("operational_hold");
    expect(p.items.some(i=>i.path===target.reviewPath)).toBe(false);
    expect(p.retrieval.failures.some(f=>f.path===target.reviewPath&&f.stage==="selection")).toBe(true);
    expect(JSON.stringify(p.retrieval)).not.toContain("SQLITE_BUSY");
  });
  it.each([false,true])("checks the last revision receipt instead of borrowing origin known-at (late=%s)",async late=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    const target=await saved("NVDA",OLD,"2026-11-01");
    vi.setSystemTime(new Date(late?"2026-11-03T00:00:00.000Z":"2026-11-02T00:00:00.000Z"));
    const id="ILK-MI04-SYNTHETIC-REVISION";
    await legacyJournalWrite(target.reviewPath,id,"oauth:ri-fixture",{kind:"append",heading:"Research analysis",date:"2026-11-02",content:"Synthetic additional context only."});
    const p=await pack("NVDA",{historyCutoff:cutoff});
    const item=p.items.find(i=>i.path===target.reviewPath);
    if(late){expect(item).toBeUndefined();expect(p.discovery.paths.find(x=>x.path===target.reviewPath)?.reasons).toContain("pit_after_cutoff");}
    else expect(item?.pointInTime).toMatchObject({versionReceiptId:id,knownAt:"2026-11-02T00:00:00.000Z"});
  });
  it("rejects malformed cutoff instead of silently disabling PIT",async()=>{
    for(const historyCutoff of ["2026-11-02","2026-11-02T16:59:59","2026-02-30T00:00:00.000Z","yesterday"])
      await expect(pack("NVDA",{historyCutoff})).rejects.toThrow();
  });
  it("MI04-shaped older receipted analysis survives all four budgets amid superficial context, without forced path selection",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-01T23:29:52.370Z"));
    await seed("01_Companies/AMD.md","# AMD\nSynthetic Hub");
    const target=await saved("AMD",OLD,"2026-11-02");
    for(let i=0;i<18;i++)await seed(`10_Knowledge/Company Research/AMD - earnings background ${i}.md`,"---\ncompany: AMD\n---\n# AMD Q3\n"+"Synthetic superficial overview. ".repeat(100));
    const question="AMD Q3 ปี 2026 โตแรงหรือไม่ และมีหลักฐานเพียงพอหรือยังที่จะสรุปว่าราคาหุ้นถูก ลูกค้า AI ได้ ROI และต้องเพิ่มน้ำหนักลงทุน? ตอบแยกส่วนที่พิสูจน์ได้กับสิ่งที่ต้องหาเพิ่ม";
    const build=(await import("./investment-context")).buildInvestmentContextPack;
    for(const budget of [{},{maxNotes:16},{maxChars:18000},{maxNotes:16,maxChars:18000}]){
      const p=build({question,historyCutoff:cutoff,...budget});
      expect(p.question).toBe(question);expect(p.issuers).toEqual(["AMD"]);
      expect(p.items.some(i=>i.path===target.reviewPath)).toBe(true);
      expect(p.items.find(i=>i.path===target.reviewPath)?.declaredVerification).toBe("not_reverified");
      expect(p.excerptChars).toBeLessThanOrEqual(budget.maxChars??12000);expect(p.selected).toBeLessThanOrEqual(budget.maxNotes??11);
    }
  });
  it("omits a later receipted version despite old publication and filesystem dates",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-03T00:00:00.000Z"));
    const target=await saved("NVDA",OLD,"2026-11-02");
    fs.utimesSync(path.join(vault,target.reviewPath),new Date("2000-01-01"),new Date("2000-01-01"));
    const p=await pack("NVDA",{historyCutoff:cutoff});
    expect(p.items.some(i=>i.path===target.reviewPath||i.path===target.sourcePath)).toBe(false);
    expect(p.discovery.paths.find(x=>x.path===target.reviewPath)?.reasons).toContain("pit_after_cutoff");
    expect(p.contextBundles.some(b=>b.status==="BOUND_SOURCE_REVIEW")).toBe(false);
  });
  it("rejects an unreceipted historical claim of verification, not granting eligibility from metadata",async()=>{
    const target="10_Knowledge/Company Research/NVDA - historical earnings.md";
    await seed(target,"---\ncompany: NVDA\nsource_type: chatgpt_analysis\nverification: verified_against_primary\npublished_at: 2026-11-01\nknown_at: 2026-11-01\n---\n# NVDA earnings\nSynthetic claim with no server receipt.");
    const p=await pack("NVDA",{historyCutoff:cutoff});
    expect(p.items.some(i=>i.path===target)).toBe(false);
    expect(p.discovery.paths.find(x=>x.path===target)?.reasons).toContain("pit_receipt_unverified");
  });
});
describe("RI-001 canonical Review discovery and intake-bound assembly",()=>{
  it("finds the latest MRVL canonical Review under research intent without inventing protected roles",async()=>{
    const target=await saved("MRVL",MRVL,"2026-11-02");
    for(let i=0;i<40;i++)await seed(`10_Knowledge/Company Research/MRVL research cash conversion ${i}.md`,"---\ncompany: MRVL\nsource_type: chatgpt_history\npublished_at: 2025-01-01\n---\n# MRVL research cash conversion\nRepeated historical analyst text.");
    const p=await pack("MRVL",{maxNotes:5,maxChars:4500});
    expect(p.items.map(x=>x.path)).toContain(target.reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("FOUND");
    expect(p.issuerCoverage[0].missingRoles).toEqual(expect.arrayContaining(["thesis","evidence_register"]));
    expect(fs.existsSync(path.join(vault,"05_Thesis/MRVL - Current Thesis.md"))).toBe(false);
    expect(p.items.find(x=>x.path===target.reviewPath)?.evidenceUse).toBe("historical_context_only");
  });
  it("assembles TSMC Source/Review only by matching intake, readback receipt and link, retaining unknown event date",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    const p=await pack("TSMC");
    expect(p.items.map(x=>x.path)).toEqual(expect.arrayContaining([target.sourcePath,target.reviewPath]));
    expect(p.contextBundles).toEqual([expect.objectContaining({intakeId:TSMC,reviewPath:target.reviewPath,sourcePath:target.sourcePath,
      status:"BOUND_SOURCE_REVIEW",eventDate:null,publishedAt:"2026-11-02",economicEventEquivalence:"not_established",primaryVerification:"not_performed"})]);
  });
  async function appendSyntheticReview(path:string,id:string){
    // WP2: a generic canonical append is refused now; this is pre-WP2 legacy history.
    await legacyJournalWrite(path,id,"oauth:ri-fixture",{kind:"append",heading:"Research analysis",date:"2026-11-07",
      content:"Synthetic duplicate context only. No verified primary claims or independent evidence increment."});
  }
  it("binds a Source to a Review through create + two receipted appends without upgrading trust",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    await appendSyntheticReview(target.reviewPath,"ILK-SYNTH-RI001-APPEND-A");
    await appendSyntheticReview(target.reviewPath,"ILK-SYNTH-RI001-APPEND-B");
    const {db}=await import("../db");
    const before=db().prepare("SELECT total_changes() AS n").get() as {n:number};
    const rawBefore=fs.readFileSync(path.join(vault,target.reviewPath),"utf8");
    const p=await pack("TSMC",{intakeId:TSMC});
    const bundle=p.contextBundles.find(b=>b.intakeId===TSMC);
    const creationId="ICW-"+sha(["canonical_review",target.reviewPath,sha(target.review)].join("\n")).slice(0,32);
    expect(bundle).toMatchObject({status:"BOUND_SOURCE_REVIEW",reviewReceiptId:creationId,
      sourcePath:target.sourcePath,primaryVerification:"not_performed",economicEventEquivalence:"not_established"});
    expect(p.items.find(item=>item.path===target.reviewPath)?.researchTrust?.comparator_eligible).toBe(false);
    expect(fs.readFileSync(path.join(vault,target.reviewPath),"utf8")).toBe(rawBefore);
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
  });
  it.each(["append_receipt_removed","append_status_interrupted","append_receipt_tampered",
    "external_edit_after_append","replace_after_append"] as const)("holds an invalid or unsupported Review revision chain: %s",async fault=>{
      const target=await saved("TSMC",TSMC,"2026-11-02");
      const id="ILK-SYNTH-RI001-APPEND-ONE";
      await appendSyntheticReview(target.reviewPath,id);
      const {db}=await import("../db");
      if(fault==="append_receipt_removed")
        db().prepare("DELETE FROM safe_edit_operations WHERE id=?").run(id);
      if(fault==="append_status_interrupted")
        db().prepare("UPDATE safe_edit_operations SET status='writing' WHERE id=?").run(id);
      if(fault==="append_receipt_tampered")
        db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.readback','pending') WHERE id=?").run(id);
      if(fault==="external_edit_after_append"){
        const now=fs.readFileSync(path.join(vault,target.reviewPath),"utf8");
        await seed(target.reviewPath,now+"\nUnreceipted synthetic change.");
      }
      if(fault==="replace_after_append"){
        // Pre-WP2 legacy history: a generic body replace on the Review journal.
        await legacyJournalWrite(target.reviewPath,"RI001-SYNTH-REPLACE","oauth:ri-fixture",{kind:"replace",
          oldText:"Synthetic unverified cash conversion discussion.",newText:"Synthetic altered cash conversion interpretation."});
      }
      const p=await pack("TSMC",{intakeId:TSMC});
      expect(p.contextBundles).toEqual([expect.objectContaining({
        status:"HOLD",reason:"create_receipt_unverified",reviewReceiptId:null,sourceReceiptId:null
      })]);
      expect(p.items.map(x=>x.path)).not.toContain(target.sourcePath);
    });
  const receiptTamperCases=[
    ["approval","admin:forged"],
    ["review",{verification:"verified"}],
    ["remoteSync","verified"],
    ["sync","verified"],
    ["mobileSync","verified"],
    ["backup","other.md"],
    ["writtenAt","2000-01-01T00:00:00.000Z"],
    ["unexpectedAuthority","verified"],
  ] as const;
  it.each(receiptTamperCases)("RC-01: HOLDs append receipt %s tamper",async(field,value)=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    const id="ILK-SYNTH-RI001-METADATA";
    await appendSyntheticReview(target.reviewPath,id);
    const {db}=await import("../db");
    db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,?,json(?)) WHERE id=?")
      .run("$."+field,JSON.stringify(value),id);
    const p=await pack("TSMC",{intakeId:TSMC});
    expect(p.contextBundles).toEqual([expect.objectContaining({
      status:"HOLD",reason:"create_receipt_unverified",reviewReceiptId:null,sourceReceiptId:null
    })]);
    expect(p.items.map(x=>x.path)).not.toContain(target.sourcePath);
  });
  it.each(receiptTamperCases)("RC-01: HOLDs creation receipt %s tamper",async(field,value)=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    await appendSyntheticReview(target.reviewPath,"ILK-SYNTH-RI001-APPEND-CREATE-CHECK");
    const {db}=await import("../db");
    const id="ICW-"+sha(["canonical_review",target.reviewPath,sha(target.review)].join("\n")).slice(0,32);
    db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,?,json(?)) WHERE id=?")
      .run("$."+field,JSON.stringify(value),id);
    expect((await pack("TSMC",{intakeId:TSMC})).contextBundles)
      .toEqual([expect.objectContaining({status:"HOLD",reason:"create_receipt_unverified"})]);
  });
  it("RC-01: Source create-only receipt cannot claim verified remote delivery",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");
    const {db}=await import("../db");
    const id="ICW-"+sha(["source_intake",target.sourcePath,sha(target.source)].join("\n")).slice(0,32);
    db().prepare("UPDATE safe_edit_operations SET receipt=json_set(receipt,'$.remoteSync','verified') WHERE id=?").run(id);
    expect((await pack("TSMC",{intakeId:TSMC})).contextBundles)
      .toEqual([expect.objectContaining({status:"HOLD",reason:"create_receipt_unverified"})]);
  });
  it.each(["written_audit_missing","written_audit_mismatched_hash","forged_approval_row"] as const)("RC-01: HOLDs missing or inconsistent authoritative journal event: %s",async fault=>{
      const target=await saved("TSMC",TSMC,"2026-11-02");
      const id="ILK-SYNTH-RI001-AUDIT";
      await appendSyntheticReview(target.reviewPath,id);
      const {db}=await import("../db");
      if(fault==="written_audit_missing")
        db().prepare("DELETE FROM safe_edit_events WHERE operation_id=? AND event='written'").run(id);
      if(fault==="written_audit_mismatched_hash")
        db().prepare("UPDATE safe_edit_events SET detail=json_set(detail,'$.afterHash','tampered') WHERE operation_id=? AND event='written'").run(id);
      if(fault==="forged_approval_row")
        db().prepare("UPDATE safe_edit_operations SET approval=?,receipt=json_set(receipt,'$.approval',?) WHERE id=?")
          .run("admin:forged","admin:forged",id);
      expect((await pack("TSMC",{intakeId:TSMC})).contextBundles)
        .toEqual([expect.objectContaining({status:"HOLD",reason:"create_receipt_unverified"})]);
    });
  it("keeps different TSMC events on the same URL separate and supports explicit intake scope",async()=>{
    const first=await saved("TSMC",OLD,"2026-09-01","2026-08-31");
    const second=await saved("TSMC",TSMC,"2026-11-02","2026-11-01");
    const p=await pack("TSMC");
    expect(p.contextBundles.filter(x=>x.status==="BOUND_SOURCE_REVIEW").map(x=>x.intakeId)).toEqual([TSMC,OLD]);
    const scoped=await pack("TSMC",{intakeId:OLD});
    expect(scoped.contextBundles.map(x=>x.reviewPath)).toEqual([first.reviewPath]);
    expect(scoped.items.map(x=>x.path)).not.toContain(second.reviewPath);
    expect(scoped.items.map(x=>x.path)).not.toContain(second.sourcePath);
  });
  it.each(["source_missing","receipt_missing","receipt_pending","source_drift","link_missing","fts_missing","wrong_source","date_mismatch","stale_metadata"])("HOLDs %s without borrowing another event Source",async fault=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");await saved("TSMC",OLD,"2026-09-01");
    const {db}=await import("../db");
    if(fault==="source_missing")fs.unlinkSync(path.join(vault,target.sourcePath));
    if(fault==="receipt_missing")db().prepare("DELETE FROM safe_edit_operations WHERE json_extract(payload,'$.path')=?").run(target.sourcePath);
    if(fault==="receipt_pending")db().prepare("UPDATE safe_edit_operations SET status='writing' WHERE json_extract(payload,'$.path')=?").run(target.sourcePath);
    if(fault==="source_drift")fs.appendFileSync(path.join(vault,target.sourcePath),"\nUnreceipted edit");
    if(fault==="link_missing")db().prepare("DELETE FROM links WHERE source_path=?").run(target.reviewPath);
    if(fault==="fts_missing")db().prepare("DELETE FROM notes_fts WHERE path=?").run(target.sourcePath);
    if(fault==="wrong_source")await seed(target.reviewPath,target.review.replace(target.sourcePath,`00_Inbox/ChatGPT/Investment Intake - ${OLD}.md`));
    if(fault==="date_mismatch")await seed(target.sourcePath,target.source.replace('event_date: null','event_date: "2026-10-10"'));
    if(fault==="stale_metadata")fs.writeFileSync(path.join(vault,target.reviewPath),target.review.replace("2026-11-02","2025-01-01"));
    const p=await pack("TSMC",{intakeId:TSMC});
    expect(p.contextBundles.some(x=>x.status==="BOUND_SOURCE_REVIEW")).toBe(false);
    expect(p.items.map(x=>x.path)).not.toContain(target.sourcePath);
    expect(p.items.some(x=>x.path.includes(OLD))).toBe(false);
    expect(p.researchCoverage[0].canonicalReview.scanComplete).toBe(fault!=="stale_metadata");
  });
  it("does not treat TSMC alias fixtures as a trusted/live instrument mapping",async()=>{
    await saved("TSMC",TSMC,"2026-11-02");
    const p=await pack("TSM");
    expect(p.issuerResolution[0].status).toBe("unresolved");
    expect(p.contextBundles).toEqual([]);
    expect(p.items.some(x=>x.path.includes("TSMC"))).toBe(false);
  });
  it("uses declared publication chronology rather than mtime or event date for latest Review",async()=>{
    const old=await saved("MRVL",OLD,"2026-01-01","2027-01-01");
    const current=await saved("MRVL",MRVL,"2026-11-02",null);
    fs.utimesSync(path.join(vault,old.reviewPath),new Date("2030-01-01"),new Date("2030-01-01"));
    const p=await pack("MRVL");
    expect(p.researchCoverage[0].latestReviewPaths).toEqual([current.reviewPath]);
    expect(p.researchCoverage[0].historicalComparator.status).toBe("FOUND");
    expect(p.researchCoverage[0].historicalComparator.paths).toContain(old.reviewPath);
    expect(p.researchCoverage[0].counterEvidence.status).toBe("FOUND");
  });
  it.each([null,"2026-11-02T01:00:00Z"])("does not assert latest across unknown/overlapping publication chronology %s",async published=>{
    await saved("MRVL",OLD,published);await saved("MRVL",MRVL,"2026-11-02");
    const p=await pack("MRVL");
    expect(p.researchCoverage[0].chronology).toBe("ORDER_UNKNOWN");
    expect(p.researchCoverage[0].historicalComparator.status).toBe("SCAN_INCOMPLETE");
  });
  it("distinguishes NOT_FOUND in completed canonical scope from a scope overflow",async()=>{
    let p=await pack("MRVL");expect(p.researchCoverage[0].canonicalReview.status).toBe("NOT_FOUND");
    const {db}=await import("../db");
    const add=db().prepare("INSERT INTO notes(path,title,mtime,size,frontmatter) VALUES(?,?,0,0,?)");
    db().transaction(()=>{for(let i=0;i<101;i++){
      const id="IN-"+i.toString(16).toUpperCase().padStart(16,"0");
      add.run(`10_Knowledge/Company Research/Investment Review - MRVL - ${id}.md`,"Review",JSON.stringify({type:"investment_research_review",intake_id:id,review_scope:"company",published_at:"2026-01-01"}));
    }})();
    p=await pack("MRVL");expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
  });
  it("does not misclassify present-but-omitted counter-evidence as NOT_FOUND",async()=>{
    await saved("NVDA",OLD,"2026-09-01");await saved("NVDA",TSMC,"2026-10-01");await saved("NVDA",MRVL,"2026-11-02");
    const p=await pack("NVDA",{maxNotes:5,maxChars:4500});
    expect(p.researchCoverage[0].canonicalReview.status).toBe("FOUND");
    expect(p.researchCoverage[0].counterEvidence.status).not.toBe("NOT_FOUND");
  });
  it("does not initialize a missing receipt store during read-only discovery",async()=>{
    const p="10_Knowledge/Company Research/Investment Review - MRVL - "+MRVL+".md";
    await seed(p,`---\ntype: investment_research_review\nintake_id: ${MRVL}\nreview_scope: company\npublished_at: 2026-11-02\n---\n# Synthetic unreceipted Review`);
    const {db}=await import("../db");const before=db().prepare("SELECT total_changes() AS n").get();
    const result=await pack("MRVL");
    expect(result.contextBundles[0].status).toBe("HOLD");
    expect(db().prepare("SELECT 1 FROM sqlite_master WHERE name='safe_edit_operations'").get()).toBeUndefined();
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
  });
  it("keeps note bytes, receipts, index and protected state unchanged across context and decision reads",async()=>{
    const target=await saved("NVDA",MRVL,"2026-11-02");
    for(const p of ["05_Thesis/NVDA - Current Thesis.md","05_Thesis/NVDA - Evidence Register.md","06_Portfolio/Positions.md"])
      await seed(p,"# Protected fixture\nNever alter this text.");
    const {db}=await import("../db");
    const paths=(db().prepare("SELECT path FROM notes ORDER BY path").all() as {path:string}[]).map(x=>x.path);
    const bytes=paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"));
    const receipts=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    const changes=db().prepare("SELECT total_changes() AS n").get();
    const p=await pack("NVDA");
    expect(p.contextBundles[0].status).toBe("BOUND_SOURCE_REVIEW");
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
    const input={domain:"company" as const,entity:"NVDA",metric:"revenue",period:"Q3",originalSource:"https://example.org/fixture",statement:"NVDA synthetic claim requires primary verification"};
    const packet=buildInvestmentDecisionPacket(input,reviewInvestmentClaim(input));
    expect(packet.historicalContext.contextBundles[0].reviewPath).toBe(target.reviewPath);
    expect(packet.historicalContext.researchCoverage[0].canonicalReview.status).toBe("FOUND");
    expect(packet.historicalContext.noteDeclaredPrimaryCandidates).not.toContain(target.sourcePath);
    expect(packet.claimGate.externalPrimaryVerification).toBe("not_performed");
    expect(packet.claimGate.sourceIndependence).toBe("not_assessed");
    expect(paths.map(p=>fs.readFileSync(path.join(vault,p),"utf8"))).toEqual(bytes);
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(receipts);
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(changes);
  });
  it("keeps invalid and unscoped intake selectors fail-closed",async()=>{
    const {buildInvestmentContextPack}=await import("./investment-context");
    expect(()=>buildInvestmentContextPack({question:"Latest research",intakeId:MRVL})).toThrow(/issuer scope/);
    expect(()=>buildInvestmentContextPack({question:"MRVL research",issuers:["MRVL"],intakeId:"../other"})).toThrow(/valid intake/);
  });
  it("reports the readback limit without asserting latest or bypassing it through FTS",async()=>{
    for(let i=0;i<9;i++)await saved("MRVL","IN-"+i.toString(16).toUpperCase().padStart(16,"0"),`2026-0${i+1}-01`);
    const p=await pack("MRVL");
    expect(p.contextBundles).toHaveLength(8);
    expect(p.researchCoverage[0]).toMatchObject({chronology:"SCAN_INCOMPLETE",latestReviewPaths:[],canonicalReview:{scanComplete:false}});
    expect(p.researchCoverage[0].canonicalReview.reasons).toContain("canonical_read_limit");
    expect(p.items.some(x=>x.path.includes("IN-0000000000000000"))).toBe(false);
  });
  it("exposes exact intake selection and coverage through the read-only MCP contract",async()=>{
    const target=await saved("TSMC",TSMC,"2026-11-02");await saved("TSMC",OLD,"2026-09-01");
    const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
    const {InMemoryTransport}=await import("@modelcontextprotocol/sdk/inMemory.js");
    const {createMcpServer}=await import("../mcp/server");
    const [ct,st]=InMemoryTransport.createLinkedPair();
    const server=createMcpServer({read:true,write:false,label:"ri-read-fixture"});
    const client=new Client({name:"ri-read-fixture",version:"1.0"});
    try{
      await Promise.all([server.connect(st),client.connect(ct)]);
      const response=await client.callTool({name:"investment_context_pack",arguments:{question:"TSMC latest research",issuers:["TSMC"],intakeId:TSMC}});
      expect(response.isError).not.toBe(true);
      const blocks=response.content as {type:string;text?:string}[];
      const result=JSON.parse(blocks.find(x=>x.type==="text")!.text!);
      expect(result.contextBundles).toHaveLength(1);
      expect(result.contextBundles[0]).toMatchObject({reviewPath:target.reviewPath,sourcePath:target.sourcePath,status:"BOUND_SOURCE_REVIEW"});
      expect(result.researchCoverage[0].canonicalReview.status).toBe("FOUND");
      expect(result.items.some((x:{path:string})=>x.path.includes(OLD))).toBe(false);
      expect((await client.callTool({name:"investment_context_pack",arguments:{question:"TSMC research",issuers:["TSMC"],intakeId:"../unsafe"}})).isError).toBe(true);
    }finally{await client.close();await server.close();}
  });
});

describe("RI-001 minimal legacy Review compatibility",()=>{
  const id="IN-539504749F0D4BEA";
  const reviewPath=`10_Knowledge/Company Research/Investment Review - SMTC - ${id}.md`;
  const sourcePath=`00_Inbox/ChatGPT/Investment Intake - ${id}.md`;
  async function legacy(hub="SMTC",fields:Record<string,unknown>={}){
    await seed(`01_Companies/${hub}.md`,hub==="SMTC"?"# SMTC":"---\naliases: [SMTC]\n---\n# Synthetic explicit alias");
    await seed(sourcePath,`---\ntype: investment_source_intake\nintake_id: ${id}\n---\nSource token: InvestmentIntake${id.slice(3)}\nSynthetic submitted source.`);
    const fm={type:"investment_research_review",intake_id:id,company_hubs:[`01_Companies/${hub}.md`],original_source_path:sourcePath,...fields};
    await seed(reviewPath,"---\n"+Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+"\n---\n# SMTC synthetic legacy research\nNo primary verification claimed.");
  }
  it("returns the reported SMTC legacy shape as historical context, with incomplete coverage and no receipt/primary promotion",async()=>{
    await legacy("SMTC",{source_type:"primary",verification:"verified_against_primary"});
    const protectedPath="05_Thesis/SMTC - Current Thesis.md";
    await seed(protectedPath,"# Protected fixture\nKeep these historical bytes unchanged.");
    const {db}=await import("../db");
    const before=db().prepare("SELECT total_changes() AS n").get();
    const paths=[reviewPath,sourcePath,protectedPath];
    const bytes=paths.map(p=>fs.readFileSync(path.join(vault,p)));
    const p=await pack("SMTC");
    expect(p.items.find(x=>x.path===reviewPath)).toMatchObject({role:"research",evidenceUse:"historical_context_only"});
    expect(p.items.map(x=>x.path)).not.toContain(sourcePath);
    expect(p.contextBundles).toEqual([expect.objectContaining({reviewPath,status:"HOLD",reason:"legacy_review_scope_missing",sourcePath:null,primaryVerification:"not_performed"})]);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({status:"SCAN_INCOMPLETE",scanComplete:false,reasons:expect.arrayContaining(["legacy_review_scope_missing"])});
    const {reviewInvestmentClaim}=await import("./investment-claim-review");
    const {buildInvestmentDecisionPacket}=await import("./investment-decision-packet");
    const claim={domain:"company" as const,entity:"SMTC",metric:"revenue",period:"2026",statement:"SMTC synthetic research statement",originalSource:"https://example.org/fixture"};
    const decision=buildInvestmentDecisionPacket(claim,reviewInvestmentClaim(claim));
    expect(decision.historicalContext.sourcePointers.map(x=>x.path)).toContain(reviewPath);
    expect(decision.historicalContext.noteDeclaredPrimaryCandidates).not.toContain(reviewPath);
    expect(db().prepare("SELECT 1 FROM sqlite_master WHERE name='safe_edit_operations'").get()).toBeUndefined();
    expect(db().prepare("SELECT total_changes() AS n").get()).toEqual(before);
    expect(paths.map(p=>fs.readFileSync(path.join(vault,p)))).toEqual(bytes);
  });
  it("does not bind missing review_scope even when create receipts, FTS and readback exist",async()=>{
    await seed("01_Companies/SMTC.md","# SMTC");
    await saved("SMTC",id,"2026-11-02",null,true);
    const {db}=await import("../db");const receipts=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all();
    expect((await pack("SMTC")).contextBundles[0]).toMatchObject({status:"HOLD",reason:"legacy_review_scope_missing",reviewReceiptId:null,sourceReceiptId:null});
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(receipts);
  });
  it.each(["SMTC","Semtech"])("accepts an alias-subject filename through existing unambiguous Hub readback for %s",async query=>{
    await legacy("Semtech");
    const p=await pack(query);
    expect(p.issuerResolution[0].contextKey).toBe("Semtech");
    expect(p.items.find(x=>x.path===reviewPath)?.evidenceUse).toBe("historical_context_only");
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
    expect((await pack("NVDA")).items.map(x=>x.path)).not.toContain(reviewPath);
  });
  it("does not admit a filename alias that collides with a second Hub even when the requested Hub title is unique",async()=>{
    await legacy("Semtech");await seed("01_Companies/OTHER.md","---\naliases: [SMTC]\n---\n# OTHER");
    const p=await pack("Semtech");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
  });
  it("reports bounded alias discovery as incomplete instead of implying a missing legacy Review",async()=>{
    await legacy("Semtech");
    await seed("01_Companies/Semtech.md","---\naliases: "+JSON.stringify([...Array.from({length:12},(_,i)=>`A${i}`),"SMTC"])+"\n---\n# Semtech");
    const p=await pack("Semtech");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview).toMatchObject({status:"SCAN_INCOMPLETE",scanComplete:false,reasons:expect.arrayContaining(["legacy_subject_alias_limit"])});
  });
  it.each(["missing_hub","ambiguous","stale_hub","stale_review"])("does not use compatibility to bypass %s",async fault=>{
    await legacy();
    if(fault==="missing_hub"){
      fs.unlinkSync(path.join(vault,"01_Companies/SMTC.md"));
      (await import("../db")).db().prepare("DELETE FROM notes WHERE path=?").run("01_Companies/SMTC.md");
    }
    if(fault==="ambiguous")await seed("01_Companies/OTHER.md","---\naliases: [SMTC]\n---\n# Other");
    if(fault==="stale_hub")fs.writeFileSync(path.join(vault,"01_Companies/SMTC.md"),"---\naliases: [OTHER]\n---\n# Changed without reindex");
    if(fault==="stale_review")fs.writeFileSync(path.join(vault,reviewPath),"---\ntype: investment_research_review\nintake_id: IN-0000000000000000\n---\n# Changed without reindex");
    const p=await pack("SMTC");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
    expect(p.contextBundles.some(x=>x.status==="BOUND_SOURCE_REVIEW")).toBe(false);
  });
  it.each([
    {review_scope:"industry"},{review_scope:["company"]},{type:["investment_research_review"]},
    {intake_id:OLD},{company_hubs:["01_Companies/NVDA.md"]},{company_hubs:"../../outside"},{company:"NVDA"}
  ])("rejects conflicting or malformed legacy metadata %j without a false NOT_FOUND",async fields=>{
    await legacy("SMTC",fields);
    const p=await pack("SMTC");
    expect(p.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(p.researchCoverage[0].canonicalReview.status).toBe("SCAN_INCOMPLETE");
  });
  it("preserves intakeId selection and valid canonical receipt binding alongside the legacy Review",async()=>{
    await legacy();const valid=await saved("SMTC",OLD,"2026-11-01");
    const a=await pack("SMTC",{intakeId:id});
    expect(a.items.map(x=>x.path)).toContain(reviewPath);
    expect(a.items.map(x=>x.path)).not.toContain(valid.reviewPath);
    const b=await pack("SMTC",{intakeId:OLD});
    expect(b.items.map(x=>x.path)).not.toContain(reviewPath);
    expect(b.contextBundles).toEqual([expect.objectContaining({reviewPath:valid.reviewPath,status:"BOUND_SOURCE_REVIEW"})]);
  });
});

/** M56-P1-11: bounded per-domain discovery of same-subject Industry-IN / Macro-IN Reviews.
 * Only the domain folder is scanned (<=200 indexed rows); unclassifiable metadata or more than
 * six matches is an explicit incomplete scan (fail-closed), never silently promoted. */
describe("M56-P1 bounded subject Review discovery",()=>{
  const ind="10_Knowledge/Industry and Concepts/Investment Review - ",mac="10_Knowledge/Macro and Markets/Investment Review - ";
  const review=(id:string,scope:string,hubs:string[]|string|null,body="Synthetic review body.")=>`---\ntype: investment_research_review\nreview_scope: ${scope}\nintake_id: ${id}\n${
    hubs===null?"":`industry_hubs: ${JSON.stringify(hubs)}\n`}---\n${body}\n`;
  const id=(n:number)=>"IN-"+n.toString(16).toUpperCase().padStart(16,"0");
  it("industry: exact Hub only, excludes the target and other Hubs, counts historical non-IN, never scans other folders",async()=>{
    const hub="02_Industries_Themes/Memory.md";
    await seed(`${ind}Memory - ${id(1)}.md`,review(id(1),"industry",[hub]));
    await seed(`${ind}Memory - ${id(2)}.md`,review(id(2),"industry",[hub,"02_Industries_Themes/Foundry.md"]));
    await seed(`${ind}Foundry - ${id(3)}.md`,review(id(3),"industry",["02_Industries_Themes/Foundry.md"]));
    await seed(`${ind}Memory legacy.md`,"---\ntype: investment_research_review\n---\nHistorical.\n");
    await seed(`10_Knowledge/Company Research/Investment Review - MRVL - ${id(4)}.md`,review(id(4),"industry",[hub]));
    const {discoverSubjectReviews}=await import("./investment-research-context");
    expect(discoverSubjectReviews("industry",{hubPath:hub},[`${ind}Memory - ${id(1)}.md`])).toEqual({domain:"industry",
      paths:[`${ind}Memory - ${id(2)}.md`],complete:true,reasons:[],historicalNonInSkipped:1});
  });
  it("macro: Source-stated geography in the indexed body; malformed metadata or a scope mismatch makes the scan incomplete",async()=>{
    await seed(`${mac}Thailand - ${id(5)}.md`,review(id(5),"macro",null,"Bank of Thailand policy rate held in October 2026."));
    await seed(`${mac}Korea - ${id(6)}.md`,review(id(6),"macro",null,"Bank of Korea policy rate."));
    const {discoverSubjectReviews}=await import("./investment-research-context");
    expect(discoverSubjectReviews("macro",{geography:"Thailand"},[])).toMatchObject({paths:[`${mac}Thailand - ${id(5)}.md`],complete:true});
    await seed(`${mac}Odd - ${id(7)}.md`,review(id(7),"industry",null));
    expect(discoverSubjectReviews("macro",{geography:"Thailand"},[])).toMatchObject({complete:false,reasons:["subject_metadata_unresolved"]});
  });
  it("read and scan limits: more than six matches or more than 200 domain rows are explicit incomplete scans",async()=>{
    const hub="02_Industries_Themes/Memory.md";
    for(let n=10;n<17;n++)await seed(`${ind}Memory - ${id(n)}.md`,review(id(n),"industry",[hub]));
    const {discoverSubjectReviews}=await import("./investment-research-context");
    const seven=discoverSubjectReviews("industry",{hubPath:hub},[]);
    expect(seven).toMatchObject({complete:false,reasons:["subject_read_limit"]});expect(seven.paths).toHaveLength(6);
    for(let n=100;n<300;n++)await seed(`${ind}Other - ${id(n)}.md`,review(id(n),"industry",["02_Industries_Themes/Other.md"]));
    expect(discoverSubjectReviews("industry",{hubPath:hub},[]).reasons).toContain("subject_scope_scan_limit");
  },60_000);
});

describe("P0 R2 bounded canonical overflow diagnostics",()=>{
  async function newer(count:number){
    for(let i=1;i<=count;i++){
      const id=`IN-${String(i).padStart(16,"0")}`;
      await seed(`10_Knowledge/Company Research/Investment Review - NVDA - ${id}.md`,
        `---\ntype: investment_research_review\nreview_scope: company\nintake_id: ${id}\npublished_at: 2026-11-10\ncompany_hubs: ["01_Companies/NVDA.md"]\nsource_type: chatgpt_analysis\nverification: not_reverified\n---\n# SYNTHETIC NVDA newer unreceipted review\n`);
    }
  }
  it("keeps 8 physical reads and permits an exact bounded reread only through the existing receipt contract",async()=>{
    const target=await saved("NVDA",OLD,"2026-11-02"),before=fs.readFileSync(path.join(vault,target.reviewPath));
    await newer(9);
    const {discoverCanonicalResearch}=await import("./investment-research-context"),{db}=await import("../db"),notes=await import("./notes");
    const journal=db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all(),changes=db().prepare("SELECT total_changes() n").get();
    const spy=vi.spyOn(notes,"readNote");
    const scan=discoverCanonicalResearch("NVDA",undefined,["NVDA"]);
    expect(spy.mock.calls.filter(([p])=>p.startsWith("10_Knowledge/Company Research/Investment Review - "))).toHaveLength(8);
    expect(spy.mock.calls.some(([p])=>p===target.reviewPath)).toBe(false);
    expect(scan.deferredReviews.find(x=>x.path===target.reviewPath)).toEqual({path:target.reviewPath,intakeId:OLD,publishedAt:"2026-11-02",reason:"canonical_read_limit"});
    expect(scan.deferredReviews.every(x=>!("bundle" in x)&&!("reviewReceiptId" in x)&&!("reviewSha256" in x))).toBe(true);
    spy.mockClear();const exact=discoverCanonicalResearch("NVDA",OLD,["NVDA"]);
    expect(exact.scopeDefinition.intakeId).toBe(OLD);expect(exact.deferredReviews).toEqual([]);
    expect(exact.reviews).toHaveLength(1);expect(exact.reviews[0].bundle).toMatchObject({status:"BOUND_SOURCE_REVIEW",economicEventEquivalence:"not_established",primaryVerification:"not_performed"});
    expect(spy.mock.calls.filter(([p])=>p===target.reviewPath)).toHaveLength(1);
    expect(db().prepare("SELECT total_changes() n").get()).toEqual(changes);
    expect(db().prepare("SELECT * FROM safe_edit_operations ORDER BY id").all()).toEqual(journal);
    expect(fs.readFileSync(path.join(vault,target.reviewPath))).toEqual(before);
  });
  it("100+sentinel metadata limit, 8 reads, 92 deferred maximum and 12 fallback limit remain bounded",async()=>{
    await newer(105);const notes=await import("./notes"),spy=vi.spyOn(notes,"readNote");
    const {discoverCanonicalResearch}=await import("./investment-research-context");
    const scan=discoverCanonicalResearch("NVDA",undefined,["NVDA"]);
    expect(scan.complete).toBe(false);expect(scan.reasons).toEqual(expect.arrayContaining(["canonical_scope_scan_limit","canonical_read_limit"]));
    expect(scan.deferredReviews).toHaveLength(92);expect(scan.reviews).toHaveLength(8);
    expect(spy.mock.calls.filter(([p])=>p.startsWith("10_Knowledge/Company Research/Investment Review - "))).toHaveLength(8);
    spy.mockRestore();const p=await pack("NVDA");
    expect(p.researchFallback.candidates).toHaveLength(12);expect(p.researchFallback.truncated).toBe(true);
    expect(p.researchCoverage[0].canonicalReview.scanComplete).toBe(false);
  });
  it("scope definition preserves exact exclusions and malformed metadata never becomes deferred evidence",async()=>{
    const target=await saved("NVDA",OLD,"2026-11-02");await newer(9);
    const wrong="10_Knowledge/Company Research/Investment Review - NVDA - IN-2222222222222222.md";
    await seed(wrong,"---\ntype: investment_research_review\nreview_scope: macro\nintake_id: IN-2222222222222222\n---\n# SYNTHETIC mismatched scope");
    const {discoverCanonicalResearch}=await import("./investment-research-context");
    const p=discoverCanonicalResearch("NVDA",undefined,["NVDA"],undefined,{excludedPaths:[target.reviewPath]});
    expect(p.scopeDefinition).toEqual({pathPrefixes:["10_Knowledge/Company Research/Investment Review - NVDA - "],intakeId:null,excludedPaths:[target.reviewPath],metadataLimit:100,physicalReviewReadLimit:8,includesNonCanonicalResearch:false});
    expect(p.reasons).toContain("canonical_metadata_unresolved");
    expect([...p.reviews,...p.deferredReviews].some(x=>x.path===target.reviewPath||x.path===wrong)).toBe(false);
  });
});

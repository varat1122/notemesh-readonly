import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {retrieveOfflineNarrativeEvidence} from "./offline-narrative-evidence-context";
import {verifyOfflineSnapshotCoverage} from "./snapshot-coverage-acceptance";

let live:string,snapshot:string,vault:string;
const synth="SYNTH";
const source="https://example.org/fictional/quarterly-release";
const sourceHash="a".repeat(64);
function note(body:string,opts:{sourceType?:string;eventKey?:string}={}){
 return [
  "---",
  "type: research_note",
  "entity: "+synth,
  "source_type: "+(opts.sourceType??"primary"),
  "verification: not_reverified",
  "original_source: "+source,
  "original_source_sha256: '"+sourceHash+"'",
  "event_key: "+(opts.eventKey??"SYNTH-2026Q3"),
  "event_date: '2026-09-25'",
  "published_at: '2026-09-26T10:00:00Z'",
  "imported_at: '2026-09-27T10:00:00Z'",
  "---",
  "# Historical note",
  body,"",
 ].join("\n");
}
function put(p:string,body:string,opts:{sourceType?:string;eventKey?:string}={}){
 const file=path.join(vault,p);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,note(body,opts));
}
beforeEach(()=>{
 live=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-narr-live-")));
 snapshot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"nm-narr-copy-")));
 vault=path.join(live,"vault");fs.mkdirSync(vault);
 process.env.DATA_DIR=live;
 process.env.ENCRYPTION_KEY??=Buffer.alloc(32,3).toString("base64");
 vi.resetModules();Reflect.deleteProperty(globalThis,"__vaultIndexer");
});
afterEach(()=>{
 Reflect.deleteProperty(globalThis,"__vaultIndexer");
 for(const d of [live,snapshot])fs.rmSync(d,{force:true,recursive:true});
 delete process.env.DATA_DIR;delete process.env.RAILWAY_PROJECT_ID;
 delete process.env.RAILWAY_ENVIRONMENT_ID;
});
async function fixture(){
 const {indexer}=await import("./indexer");await indexer().rebuild();
 fs.cpSync(vault,path.join(snapshot,"vault"),{
   recursive:true,preserveTimestamps:true,
 });
 const {db}=await import("../db");
 await db().backup(path.join(snapshot,"app.sqlite"));
 const checked=verifyOfflineSnapshotCoverage(snapshot);
 if(checked.status!=="snapshot_markdown_index_reconciled_not_originals_verified")
   throw Error("narrative_fixture_unreconciled");
 return checked.markdownContentManifestSha256;
}
const args=(manifest:string,extra:Record<string,unknown>={})=>({
 snapshotRoot:snapshot,expectedMarkdownManifestSha256:manifest,
 entity:synth,keywords:["capacity","delivery"],...extra,
});
describe("PR #85 offline narrative evidence retrieval — strictly lexical/untrusted",()=>{
 it("finds indexed historical prose and exact physical line numbers, no thesis conclusion",async()=>{
   const p="10_Knowledge/SYNTH - Legacy History.md";
   put(p,"SYNTH capacity delivery is under discussion in this fictional scenario.");
   const manifest=await fixture();
   const report=retrieveOfflineNarrativeEvidence(args(manifest));
   expect(report).toMatchObject({
     status:"offline_lexical_history_packet_requires_analyst_review",
     classification:"lexical_context_not_new_or_duplicate_proof",
     confidence:"only_exact_indexed_phrase_and_physical_excerpts_matched",
     thesisImpactVerified:false,issuerClaimsVerified:false,
     ownerApprovalGranted:false,canAutoWrite:false,canAutoUpdateThesis:false,
     vaultModified:false,
   });
   expect(report.references).toHaveLength(1);
   expect(report.references[0]).toMatchObject({
     path:p,eventDate:"2026-09-25",
     publishedAt:"2026-09-26T10:00:00Z",
     importedAt:"2026-09-27T10:00:00Z",
     retrievalMeaning:"lexical_mention_not_fact_verification",
   });
   const excerpt=report.references[0].exactLineCitations[0];
   expect(excerpt.line).toBeGreaterThan(12);
   expect(excerpt.excerpt).toContain("capacity delivery");
   expect(excerpt.matchedTerms).toContain("synth");
   expect(excerpt.quoteKind).toBe("untrusted_historical_note_text");
   expect(report.scope.historicalProseSemanticallyExhaustive).toBe(false);
 });
 it("treats repeated original URL/hash declarations as one family, not independent sources",async()=>{
   put("10_Knowledge/A.md","SYNTH capacity review.");
   put("10_Knowledge/B.md","SYNTH delivery review.");
   const result=retrieveOfflineNarrativeEvidence(args(await fixture()));
   expect(result.references).toHaveLength(2);
   expect(result.references.every(r=>r.sameDeclaredSourceFamilyAsOtherNotes)).toBe(true);
   expect(new Set(result.references.map(r=>r.sourceFamilyDeclarationKey)).size).toBe(1);
   expect(result.scope.checkedPrimarySourceAuthenticity).toBe(false);
 });
 it("excludes protected Thesis, but archived AI remains flagged historical context",async()=>{
   put("05_Thesis/NVDA - Current Thesis.md","SYNTH capacity review.");
   put("07_Sources/ChatGPT/SYNTH old chat.md",
     "SYNTH delivery mentioned earlier.",{sourceType:"archived_ai"});
   const report=retrieveOfflineNarrativeEvidence(args(await fixture()));
   expect(report.scope.protectedCandidatesExcluded).toBeGreaterThanOrEqual(1);
   expect(report.references.some(r=>r.path.startsWith("05_Thesis/"))).toBe(false);
   const old=report.references.find(r=>r.path.includes("ChatGPT"));
   expect(old?.independence).toBe("not_independent_archived_ai");
   expect(old?.retrievalMeaning).toBe("lexical_mention_not_fact_verification");
 });
 it("ignores code fences and HTML comment snippets as claim-like evidence",async()=>{
   put("10_Knowledge/SYNTH Code.md",
    ["\u0060\u0060\u0060text","SYNTH capacity secret",
     "\u0060\u0060\u0060","<!-- SYNTH delivery secret -->",
     "Real fictional prose about SYNTH delivery."].join("\n"));
   const report=retrieveOfflineNarrativeEvidence(args(await fixture()));
   const excerpts=report.references.flatMap(r=>r.exactLineCitations);
   expect(excerpts).toHaveLength(1);
   expect(excerpts[0].excerpt).toBe("Real fictional prose about SYNTH delivery.");
 });
 it("rejects stale manifest and changed markdown bytes",async()=>{
   const p="10_Knowledge/SYNTH Historic.md";
   put(p,"SYNTH capacity review.");
   const manifest=await fixture();
   expect(()=>retrieveOfflineNarrativeEvidence(args("f".repeat(64))))
     .toThrow("narrative_snapshot_manifest_or_index_stale_hold");
   fs.writeFileSync(path.join(snapshot,"vault",p),
     note("SYNTH delivery changed after indexing."));
   expect(()=>retrieveOfflineNarrativeEvidence(args(manifest)))
     .toThrow("narrative_snapshot_manifest_or_index_stale_hold");
 });
 it("rejects malformed search grammar and Railway/live access",async()=>{
   put("10_Knowledge/SYNTH Old.md","SYNTH capacity review.");
   const manifest=await fixture();
   expect(()=>retrieveOfflineNarrativeEvidence(
     args(manifest,{keywords:['capacity" OR SECRET']})))
     .toThrow("narrative_search_requires_bounded_entity_and_keywords");
   expect(()=>retrieveOfflineNarrativeEvidence(
     args(manifest,{snapshotRoot:live}))).toThrow();
   process.env.RAILWAY_PROJECT_ID="synthetic-hold";
   expect(()=>retrieveOfflineNarrativeEvidence(args(manifest))).toThrow();
 });
 it("reports no lexical results as scoped-only, not novelty proof",async()=>{
   put("10_Knowledge/Other.md","Other synthetic historical topic unrelated.");
   const report=retrieveOfflineNarrativeEvidence(args(await fixture()));
   expect(report.references).toEqual([]);
   expect(report.scope.historicalProseSemanticallyExhaustive).toBe(false);
   expect(report.classification).toBe("lexical_context_not_new_or_duplicate_proof");
 });
});
